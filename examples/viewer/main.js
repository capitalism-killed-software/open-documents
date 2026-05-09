import '@open-documents/viewer';
import { configure, rotate, removePages } from '@open-documents/core';

configure({ wasmUrl: new URL('./pdfium.wasm', import.meta.url) });

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const viewer = /** @type {any} */ ($('viewer'));
const buttons = ['rotate', 'remove', 'download'].map((id) => /** @type {HTMLButtonElement} */ ($(id)));
/** @type {Uint8Array | null} */
let current = null;
let name = 'document.pdf';

/** @param {Uint8Array} bytes */
async function show(bytes, page = 1) {
  current = bytes;
  const { pageCount } = await viewer.load(bytes, { name });
  if (page > 1) viewer.goToPage(Math.min(page, pageCount));
  buttons.forEach((b) => (b.disabled = false));
  /** @type {HTMLButtonElement} */ ($('remove')).disabled = pageCount < 2;
  $('status').textContent = `${name}: ${pageCount} page${pageCount === 1 ? '' : 's'}`;
}

/** @type {HTMLInputElement} */ ($('pick')).onchange = async (e) => {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (!file) return;
  name = file.name;
  await show(new Uint8Array(await file.arrayBuffer()));
};

$('rotate').onclick = async () => {
  const page = viewer.page;
  // save first, so changes made in the viewer come along
  await show(await rotate(await viewer.save(), { angle: 90, pages: [page] }), page);
};

$('remove').onclick = async () => {
  const page = viewer.page;
  await show(await removePages(await viewer.save(), [page]), page);
};

$('download').onclick = async () => {
  const bytes = current ? await viewer.save() : null;
  if (!bytes) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = name.replace(/\.pdf$/i, '') + '-edited.pdf';
  a.click();
};

viewer.addEventListener('od-error', (/** @type {any} */ e) => ($('status').textContent = e.detail.message));
