// Forms through PDFium's own form filler: fields are filled the way a person fills them (focus,
// type, press a key), so values and their appearances stay in step, and a file keeps whatever
// encryption it had. New fields are made with EmbedPDF's additions to PDFium.
import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { selectPages } from './modify.js';
import { pagePointToShown, shownRectToBox } from './geometry.js';
import { fail } from './errors.js';
import { numberIn, pageNumber } from './options.js';

const WIDGET = 20;
const TYPES = /** @type {const} */ ({ 1: 'button', 2: 'checkbox', 3: 'radio', 4: 'dropdown', 5: 'list', 6: 'text', 7: 'signature' });
const CREATE = /** @type {const} */ ({ text: 6, checkbox: 2, dropdown: 4, list: 5, signature: 7 });
const FLAG = { readOnly: 1, required: 2, multiline: 1 << 12, password: 1 << 13, editable: 1 << 18, multiSelect: 1 << 21, combo: 1 << 17 };
const RETURN_KEY = 13;
const HELVETICA = 4;
const SOLID = 1;
// flatten what a viewer shows; hidden annotations stay out
const FLAT_NORMAL_DISPLAY = 0;
const ANNOT_PRINT = 4;

/**
 * Where a field appears: a page and a rectangle in points as shown (top left, rotation applied).
 *
 * @typedef {object} Widget
 * @property {number} page
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} [exportValue]  for check boxes and radio buttons: the value it stands for
 */

/**
 * @typedef {object} FormField
 * @property {string} name
 * @property {'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button' | 'unknown'} type
 * @property {string | boolean | string[] | null} value  text and dropdown: the text; checkbox:
 *   ticked or not; radio: the export value of the chosen button, or null; list: the chosen
 *   options; signature and button: null
 * @property {string[]} options  dropdown and list choices; radio export values
 * @property {boolean} readOnly
 * @property {boolean} required
 * @property {boolean} multiline
 * @property {Widget[]} widgets
 */

/**
 * Every form field, with its value and where it appears.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ password?: string }} [options]
 * @returns {Promise<FormField[]>}
 */
export async function getFormFields(input, options = {}) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  return pdf.withDocument(bytes, options, (doc) => withForm(pdf, doc, (form) => readFields(pdf, doc, form)));
}

/**
 * Fill fields by name. Text fields take a string, check boxes true or false, radio groups the
 * export value of a button, dropdowns one of their options (any text if the dropdown is
 * editable), lists an option or a list of options. Everything is checked before anything is
 * changed. `flatten: true` then makes the values part of the pages.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {Record<string, string | boolean | string[]>} values
 * @param {{ password?: string, flatten?: boolean }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function fillForm(input, values, options = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail('INVALID_OPTION', 'values must be an object of field names and values.');
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;
  const out = pdf.withDocument(bytes, options, (doc) => {
    withForm(pdf, doc, (form) => {
      const fields = new Map(readFields(pdf, doc, form).map((f) => [f.name, f]));
      const unknown = Object.keys(values).filter((name) => !fields.has(name));
      if (unknown.length) fail('INVALID_OPTION', `No field named ${unknown.map((n) => `"${n}"`).join(', ')}. The fields are: ${[...fields.keys()].join(', ') || 'none'}.`);
      for (const [name, value] of Object.entries(values)) checkValue(/** @type {FormField} */ (fields.get(name)), value);
      const pages = fn.FPDF_GetPageCount(doc);
      for (let index = 0; index < pages; index++) {
        withFormPage(pdf, doc, form, index, (page) => eachWidget(pdf, form, page, (annot) => {
          const name = pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldName(form, annot, p, l));
          if (!(name in values)) return;
          setWidget(pdf, form, page, annot, /** @type {FormField} */ (fields.get(name)), values[name]);
        }));
      }
    });
    if (options.flatten) flattenPages(pdf, doc, undefined);
    return pdf.save(doc);
  });
  return options.flatten ? dropEmptyForm(out) : out;
}

/**
 * @typedef {object} NewField
 * @property {'text' | 'checkbox' | 'dropdown' | 'list' | 'signature'} type  a signature field is
 *   left empty, for signing later
 * @property {string} name
 * @property {number} page
 * @property {number} x  points from the left, as shown
 * @property {number} y  points from the top, as shown
 * @property {number} width
 * @property {number} height
 * @property {string | boolean | string[]} [value]
 * @property {string[]} [options]  dropdown and list choices
 * @property {boolean} [required]
 * @property {boolean} [readOnly]
 * @property {boolean} [multiline]  text fields
 * @property {boolean} [multiple]  lists: allow more than one choice
 * @property {number} [fontSize]  0 (the default) fits the text to the field
 */

/**
 * Add form fields to pages. Names must be new. On a page with a rotation the field is placed
 * where it is asked for as shown, and its text runs the way the page's own content does.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {NewField[]} fields
 * @param {{ password?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function addFormFields(input, fields, options = {}) {
  if (!Array.isArray(fields) || !fields.length) fail('INVALID_OPTION', 'fields must be a list of fields to add.');
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;
  /** @type {{ field: NewField, box: [number, number, number, number] }[]} */
  const signatures = [];
  const out = pdf.withDocument(bytes, options, (doc) => {
    withForm(pdf, doc, (form) => {
      const existing = new Set(readFields(pdf, doc, form).map((f) => f.name));
      const count = fn.FPDF_GetPageCount(doc);
      const seen = new Set();
      for (const field of fields) {
        checkNewField(field, count);
        if (existing.has(field.name) || seen.has(field.name)) fail('INVALID_OPTION', `There is already a field named "${field.name}".`);
        seen.add(field.name);
      }
      for (const field of fields) {
        if (field.type === 'signature') {
          signatures.push({ field, box: pdf.withPage(doc, field.page - 1, (page) => shownRectToBox(pdf.visibleBox(page), fn.FPDFPage_GetRotation(page), field)) });
          continue;
        }
        withFormPage(pdf, doc, form, field.page - 1, (page) => {
          const annot = pdf.withWideString(field.name, (name) => fn.EPDFPage_CreateFormField(page, form, CREATE[field.type], name));
          if (!annot) fail('ENGINE_ERROR', `Could not add the field "${field.name}".`);
          try {
            placeWidget(pdf, page, annot, field);
            fn.FPDFAnnot_SetFlags(annot, ANNOT_PRINT);
            if (field.type !== 'checkbox' && field.type !== 'signature') fn.EPDFAnnot_SetDefaultAppearance(annot, HELVETICA, field.fontSize ?? 0, 0, 0, 0);
            fn.EPDFAnnot_SetBorderStyle(annot, SOLID, 1);
            fn.EPDFAnnot_SetMKColor(annot, 0, 0x80, 0x80, 0x80);
            const flags = (field.readOnly ? FLAG.readOnly : 0) | (field.required ? FLAG.required : 0)
              | (field.multiline ? FLAG.multiline : 0) | (field.type === 'dropdown' ? FLAG.combo : 0)
              | (field.type === 'list' && field.multiple ? FLAG.multiSelect : 0);
            fn.FPDFAnnot_SetFormFieldFlags(form, annot, flags);
            if (field.options?.length) setOptions(pdf, form, annot, field.options);
            fn.EPDFAnnot_GenerateFormFieldAP(annot);
            fn.FPDFPage_GenerateContent(page);
          } finally {
            fn.FPDFPage_CloseAnnot(annot);
          }
        });
      }
    });
    return pdf.save(doc);
  });
  // a widget PDFium has just made cannot take the focus until the page is opened again, and
  // values written straight in are not drawn, so starting values are filled in on the saved file
  const toggles = Object.fromEntries(fields.filter((f) => f.value !== undefined && f.value !== false && f.value !== '').map((f) => [f.name, /** @type {string | boolean | string[]} */ (f.value)]));
  const filled = Object.keys(toggles).length ? await fillForm(out, toggles, options) : out;
  return signatures.length ? addSignatureFields(filled, signatures) : filled;
}

/**
 * Empty signature fields, for signing later. PDFium cannot make them, so they are written into
 * the form directly; that needs a file without encryption.
 *
 * @param {Uint8Array} bytes
 * @param {{ field: NewField, box: [number, number, number, number] }[]} list
 */
async function addSignatureFields(bytes, list) {
  const { PDFDocument, PDFString } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  if (doc.isEncrypted) fail('UNSUPPORTED_SECURITY', 'Signature fields can only be added to files without encryption. Decrypt it first, or let sign() make the field.');
  const acroForm = doc.getForm().acroForm;
  for (const { field, box } of list) {
    const page = doc.getPage(field.page - 1);
    const widget = doc.context.register(doc.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of(field.name),
      Rect: box,
      F: ANNOT_PRINT,
      P: page.ref,
    }));
    page.node.addAnnot(widget);
    acroForm.addField(widget);
  }
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/**
 * Make form fields and annotations part of the pages: they look the same, but can no longer be
 * changed or filled.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ pages?: import('./modify.js').PageSelection, password?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function flatten(input, options = {}) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const out = pdf.withDocument(bytes, options, (doc) => {
    flattenPages(pdf, doc, options.pages);
    return pdf.save(doc);
  });
  return dropEmptyForm(out);
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {import('./modify.js').PageSelection | undefined} pages
 */
function flattenPages(pdf, doc, pages) {
  for (const number of selectPages(pages, pdf.fn.FPDF_GetPageCount(doc))) {
    pdf.withPage(doc, number - 1, (page) => {
      if (!pdf.fn.FPDFPage_Flatten(page, FLAT_NORMAL_DISPLAY)) fail('ENGINE_ERROR', `Could not flatten page ${number}.`);
    });
  }
}

/**
 * PDFium leaves the form's catalogue entry behind after flattening. When no page has a field
 * left, take it out, so readers stop offering to fill a form that is gone. Encrypted files are
 * left as they are: rewriting them would lose their encryption.
 *
 * @param {Uint8Array} bytes
 */
async function dropEmptyForm(bytes) {
  const pdf = await engine();
  const left = pdf.withDocument(bytes, {}, (doc) => {
    if (pdf.fn.FPDF_GetFormType(doc) === 0) return -1;
    let widgets = 0;
    for (let i = 0; i < pdf.fn.FPDF_GetPageCount(doc); i++) {
      pdf.withPage(doc, i, (page) => {
        for (let a = 0; a < pdf.fn.FPDFPage_GetAnnotCount(page); a++) {
          const annot = pdf.fn.FPDFPage_GetAnnot(page, a);
          if (pdf.fn.FPDFAnnot_GetSubtype(annot) === WIDGET) widgets++;
          pdf.fn.FPDFPage_CloseAnnot(annot);
        }
      });
    }
    return widgets;
  });
  if (left !== 0) return bytes;
  const { PDFDocument, PDFName } = await import('@cantoo/pdf-lib');
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    if (doc.isEncrypted) return bytes;
    doc.catalog.delete(PDFName.of('AcroForm'));
    return await doc.save({ useObjectStreams: false });
  } catch {
    return bytes;
  }
}

/**
 * @template T
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {(form: number) => T} use
 * @returns {T}
 */
export function withForm(pdf, doc, use) {
  const { fn } = pdf;
  const info = fn.PDFiumExt_OpenFormFillInfo();
  const form = fn.PDFiumExt_InitFormFillEnvironment(doc, info);
  if (!form) {
    fn.PDFiumExt_CloseFormFillInfo(info);
    fail('ENGINE_ERROR', 'Could not open the form.');
  }
  try {
    return use(form);
  } finally {
    fn.PDFiumExt_ExitFormFillEnvironment(form);
    fn.PDFiumExt_CloseFormFillInfo(info);
  }
}

/**
 * @template T
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} form
 * @param {number} index
 * @param {(page: number) => T} use
 * @returns {T}
 */
export function withFormPage(pdf, doc, form, index, use) {
  return pdf.withPage(doc, index, (page) => {
    pdf.fn.FORM_OnAfterLoadPage(page, form);
    try {
      return use(page);
    } finally {
      pdf.fn.FORM_OnBeforeClosePage(page, form);
    }
  });
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} form
 * @param {number} page
 * @param {(annot: number) => void} use
 */
function eachWidget(pdf, form, page, use) {
  const { fn } = pdf;
  for (let i = 0; i < fn.FPDFPage_GetAnnotCount(page); i++) {
    const annot = fn.FPDFPage_GetAnnot(page, i);
    try {
      if (fn.FPDFAnnot_GetSubtype(annot) === WIDGET) use(annot);
    } finally {
      fn.FPDFPage_CloseAnnot(annot);
    }
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} form
 * @returns {FormField[]}
 */
function readFields(pdf, doc, form) {
  const { fn } = pdf;
  /** @type {Map<string, FormField>} */
  const fields = new Map();
  const count = fn.FPDF_GetPageCount(doc);
  for (let index = 0; index < count; index++) {
    withFormPage(pdf, doc, form, index, (page) => {
      const box = pdf.visibleBox(page);
      const turns = fn.FPDFPage_GetRotation(page);
      eachWidget(pdf, form, page, (annot) => {
        const name = pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldName(form, annot, p, l));
        const type = TYPES[/** @type {keyof typeof TYPES} */ (fn.FPDFAnnot_GetFormFieldType(form, annot))] ?? 'unknown';
        const flags = fn.FPDFAnnot_GetFormFieldFlags(form, annot);
        let field = fields.get(name);
        if (!field) {
          field = {
            name,
            type,
            value: null,
            options: [],
            readOnly: (flags & FLAG.readOnly) !== 0,
            required: (flags & FLAG.required) !== 0,
            multiline: type === 'text' && (flags & FLAG.multiline) !== 0,
            widgets: [],
          };
          fields.set(name, field);
          if (type === 'text') field.value = pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldValue(form, annot, p, l));
          if (type === 'checkbox') field.value = false;
          if (type === 'dropdown' || type === 'list') {
            const chosen = [];
            for (let i = 0; i < fn.FPDFAnnot_GetOptionCount(form, annot); i++) {
              const label = pdf.readUtf16((p, l) => fn.FPDFAnnot_GetOptionLabel(form, annot, i, p, l));
              field.options.push(label);
              if (fn.FPDFAnnot_IsOptionSelected(form, annot, i)) chosen.push(label);
            }
            field.value = type === 'list' ? chosen : pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldValue(form, annot, p, l));
          }
        }
        /** @type {Widget} */
        const widget = { page: index + 1, ...shownRect(pdf, annot, box, turns) };
        if (type === 'checkbox' || type === 'radio') {
          const exportValue = pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldExportValue(form, annot, p, l));
          widget.exportValue = exportValue;
          const checked = Boolean(fn.FPDFAnnot_IsChecked(form, annot));
          if (type === 'checkbox') field.value = field.value === true || checked;
          if (type === 'radio') {
            if (!field.options.includes(exportValue)) field.options.push(exportValue);
            if (checked) field.value = exportValue;
          }
        }
        field.widgets.push(widget);
      });
    });
  }
  return [...fields.values()];
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} annot
 * @param {[number, number, number, number]} box
 * @param {number} turns
 */
function shownRect(pdf, annot, box, turns) {
  // FS_RECTF is left, top, right, bottom
  const [left, top, right, bottom] = pdf.readFloats(4, (p) => pdf.fn.FPDFAnnot_GetRect(annot, p));
  const corners = [pagePointToShown(box, turns, left, top), pagePointToShown(box, turns, right, bottom)];
  const x = Math.min(corners[0][0], corners[1][0]);
  const y = Math.min(corners[0][1], corners[1][1]);
  return {
    x: round(x),
    y: round(y),
    width: round(Math.abs(corners[1][0] - corners[0][0])),
    height: round(Math.abs(corners[1][1] - corners[0][1])),
  };
}

/**
 * @param {FormField} field
 * @param {unknown} value
 */
function checkValue(field, value) {
  const where = `Field "${field.name}"`;
  switch (field.type) {
    case 'text':
      if (typeof value !== 'string') fail('INVALID_OPTION', `${where} is a text field: give it a string.`);
      return;
    case 'checkbox':
      if (typeof value !== 'boolean') fail('INVALID_OPTION', `${where} is a check box: give it true or false.`);
      if (field.readOnly && value !== field.value) fail('INVALID_OPTION', `${where} is read-only.`);
      return;
    case 'radio':
      if (typeof value !== 'string' || !field.options.includes(value)) fail('INVALID_OPTION', `${where} is a radio group: give it one of ${field.options.map((o) => `"${o}"`).join(', ')}.`);
      if (field.readOnly && value !== field.value) fail('INVALID_OPTION', `${where} is read-only.`);
      return;
    case 'dropdown':
      if (typeof value !== 'string') fail('INVALID_OPTION', `${where} is a dropdown: give it one of its options as a string.`);
      return;
    case 'list': {
      const chosen = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(chosen) || chosen.some((v) => !field.options.includes(v))) {
        fail('INVALID_OPTION', `${where} is a list: give it some of ${field.options.map((o) => `"${o}"`).join(', ')}.`);
      }
      if (field.readOnly) fail('INVALID_OPTION', `${where} is read-only.`);
      return;
    }
    default:
      fail('INVALID_OPTION', `${where} is a ${field.type} field, which cannot be filled with a value.`);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} form
 * @param {number} page
 * @param {number} annot
 * @param {Pick<FormField, 'type' | 'options' | 'value'> & { name?: string, readOnly?: boolean }} field
 * @param {string | boolean | string[]} value
 */
function setWidget(pdf, form, page, annot, field, value) {
  const { fn } = pdf;
  const focus = () => {
    if (!fn.FORM_SetFocusedAnnot(form, annot)) fail('ENGINE_ERROR', `Could not select the field "${field.name}".`);
  };
  try {
    if (field.type === 'text') {
      typeInto(pdf, form, page, annot, /** @type {string} */ (value), focus);
    } else if (field.type === 'checkbox') {
      if (Boolean(fn.FPDFAnnot_IsChecked(form, annot)) !== value) {
        focus();
        fn.FORM_OnChar(form, page, RETURN_KEY, 0);
      }
    } else if (field.type === 'radio') {
      const exportValue = pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldExportValue(form, annot, p, l));
      if (exportValue === value && !fn.FPDFAnnot_IsChecked(form, annot)) {
        focus();
        fn.FORM_OnChar(form, page, RETURN_KEY, 0);
      }
    } else if (field.type === 'dropdown') {
      const index = field.options.indexOf(/** @type {string} */ (value));
      if (index >= 0) {
        focus();
        fn.FORM_SetIndexSelected(form, page, index, 1);
      } else if ((fn.FPDFAnnot_GetFormFieldFlags(form, annot) & FLAG.editable) !== 0) {
        typeInto(pdf, form, page, annot, /** @type {string} */ (value), focus);
      } else {
        fail('INVALID_OPTION', `Field "${field.name}" takes one of ${field.options.map((o) => `"${o}"`).join(', ')}.`);
      }
    } else if (field.type === 'list') {
      const chosen = typeof value === 'string' ? [value] : /** @type {string[]} */ (value);
      focus();
      field.options.forEach((option, i) => fn.FORM_SetIndexSelected(form, page, i, chosen.includes(option) ? 1 : 0));
    }
  } finally {
    fn.FORM_ForceToKillFocus(form);
  }
}

/**
 * Type into a text field, or an editable dropdown, the way a person would: select what is
 * there and type over it, so PDFium draws the field again. Read-only fields refuse the focus,
 * so the flag comes off for the moment it takes.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} form
 * @param {number} page
 * @param {number} annot
 * @param {string} value
 * @param {() => void} focus
 */
function typeInto(pdf, form, page, annot, value, focus) {
  const { fn } = pdf;
  const flags = fn.FPDFAnnot_GetFormFieldFlags(form, annot);
  if (flags & FLAG.readOnly) fn.FPDFAnnot_SetFormFieldFlags(form, annot, flags & ~FLAG.readOnly);
  try {
    focus();
    fn.FORM_SelectAllText(form, page);
    pdf.withWideString(value, (v) => fn.FORM_ReplaceSelection(form, page, v));
    fn.FORM_ForceToKillFocus(form);
  } finally {
    if (flags & FLAG.readOnly) fn.FPDFAnnot_SetFormFieldFlags(form, annot, flags);
  }
}

/**
 * @param {NewField} field
 * @param {number} pageCount
 */
function checkNewField(field, pageCount) {
  if (!field || typeof field !== 'object') fail('INVALID_OPTION', 'Each field must be an object.');
  if (!(field.type in CREATE)) fail('INVALID_OPTION', `type must be one of ${Object.keys(CREATE).join(', ')}.`);
  if (typeof field.name !== 'string' || !field.name || field.name.includes('.')) fail('INVALID_OPTION', 'Each field needs a name, without dots.');
  pageNumber(field.page, 'page', pageCount);
  for (const key of /** @type {const} */ (['x', 'y'])) numberIn(field[key], key, -100_000, 100_000);
  for (const key of /** @type {const} */ (['width', 'height'])) numberIn(field[key], key, 1, 100_000);
  if (field.fontSize !== undefined) numberIn(field.fontSize, 'fontSize', 0, 300);
  if ((field.type === 'dropdown' || field.type === 'list') && (!Array.isArray(field.options) || !field.options.length || field.options.some((o) => typeof o !== 'string'))) {
    fail('INVALID_OPTION', `Field "${field.name}" needs options, a list of strings.`);
  }
  if (field.type === 'signature' && field.value !== undefined) fail('INVALID_OPTION', `Field "${field.name}" is a signature field: it is filled by signing, not with a value.`);
  if (field.value !== undefined) {
    const chosen = Array.isArray(field.value) ? field.value : [field.value];
    const ok = field.type === 'checkbox' ? typeof field.value === 'boolean'
      : field.type === 'list' ? chosen.every((v) => field.options?.includes(/** @type {string} */ (v))) && (chosen.length < 2 || field.multiple === true)
        : typeof field.value === 'string' && (field.type === 'text' || field.options?.includes(field.value));
    if (!ok) fail('INVALID_OPTION', `Field "${field.name}" has a value that does not suit a ${field.type} field.`);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {number} annot
 * @param {NewField} field
 */
function placeWidget(pdf, page, annot, field) {
  const { fn } = pdf;
  const [left, bottom, right, top] = shownRectToBox(pdf.visibleBox(page), fn.FPDFPage_GetRotation(page), field);
  const ptr = pdf.malloc(16);
  try {
    // FS_RECTF is left, top, right, bottom
    [left, top, right, bottom].forEach((v, i) => pdf.wasm.setValue(ptr + i * 4, v, 'float'));
    if (!fn.FPDFAnnot_SetRect(annot, ptr)) fail('ENGINE_ERROR', `Could not place the field "${field.name}".`);
  } finally {
    pdf.free(ptr);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} form
 * @param {number} annot
 * @param {string[]} options
 */
function setOptions(pdf, form, annot, options) {
  const list = pdf.malloc(options.length * 4);
  /** @type {number[]} */
  const strings = [];
  try {
    options.forEach((option, i) => {
      const size = (option.length + 1) * 2;
      const p = pdf.malloc(size);
      strings.push(p);
      pdf.wasm.stringToUTF16(option, p, size);
      pdf.wasm.setValue(list + i * 4, p, '*');
    });
    pdf.fn.EPDFAnnot_SetFormFieldOptions(form, annot, list, options.length);
  } finally {
    for (const p of strings) pdf.free(p);
    pdf.free(list);
  }
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 100) / 100;
}
