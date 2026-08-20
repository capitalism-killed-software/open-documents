// The viewer's insides: EmbedPDF's headless plugins, laid out with Preact and htm (no build
// step for JSX). The element in element.js owns this and talks to it through `controller`.
import { h } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/preact';
import { usePdfiumEngine } from '@embedpdf/engines/preact';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager';
import { DocumentContent } from '@embedpdf/plugin-document-manager/preact';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import { Viewport } from '@embedpdf/plugin-viewport/preact';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll';
import { Scroller, useScroll } from '@embedpdf/plugin-scroll/preact';
import { RenderPluginPackage } from '@embedpdf/plugin-render';
import { RenderLayer } from '@embedpdf/plugin-render/preact';
import { TilingPluginPackage } from '@embedpdf/plugin-tiling';
import { TilingLayer } from '@embedpdf/plugin-tiling/preact';
import { ZoomPluginPackage, ZoomMode } from '@embedpdf/plugin-zoom';
import { useZoom } from '@embedpdf/plugin-zoom/preact';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { PagePointerProvider, GlobalPointerProvider } from '@embedpdf/plugin-interaction-manager/preact';
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail';
import { ThumbnailsPane, ThumbImg } from '@embedpdf/plugin-thumbnail/preact';
import { SearchPluginPackage } from '@embedpdf/plugin-search';
import { SearchLayer, useSearch } from '@embedpdf/plugin-search/preact';
import { SelectionPluginPackage, SelectionLayer } from '@embedpdf/plugin-selection/preact';
import { ExportPluginPackage } from '@embedpdf/plugin-export/preact';
import { HistoryPluginPackage } from '@embedpdf/plugin-history';
import { AnnotationPluginPackage, AnnotationLayer, useAnnotation } from '@embedpdf/plugin-annotation/preact';
import { LockModeType } from '@embedpdf/plugin-annotation';
import { useCapability } from '@embedpdf/core/preact';
import { serializeFormWrites } from './form-writes.js';
import { FormPluginPackage } from '@embedpdf/plugin-form/preact';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { fontConfig } from './fonts.js';

const html = htm.bind(h);

/**
 * What the element can ask of the app, and what the app reports back. Filled in as the
 * pieces become ready.
 *
 * @typedef {object} Controller
 * @property {any} [registry]
 * @property {string | null} [documentId]
 * @property {(event: string, detail: object) => void} emit
 * @property {{ rotate: (page: number, angle: number) => Promise<any>, remove: (page: number) => Promise<any>, move: (from: number, to: number) => Promise<any> }} [organize]
 * @property {{ add: (field: any) => Promise<any>, names: () => string[] }} [design]
 */

/** The kinds of field the designer draws: tool id, label, and the start of new names. */
export const FIELD_TOOLS = [
  ['text', 'Text field', 'text'],
  ['checkbox', 'Check box', 'check'],
  ['dropdown', 'Dropdown', 'choice'],
  ['list', 'List', 'list'],
];

/** The annotation tools offered, in toolbar order: EmbedPDF tool id and label. */
export const TOOLS = [
  ['highlight', 'Highlight'],
  ['underline', 'Underline'],
  ['strikeout', 'Strike out'],
  ['ink', 'Pen'],
  ['freeText', 'Text'],
  ['textComment', 'Note'],
  ['square', 'Box'],
];

/**
 * @param {{ wasmUrl: string, fontsUrl: string | null, toolbar: boolean, sidebar: boolean, annotate: boolean, organize: boolean, author: string, controller: Controller, pending: { current: any } }} props
 */
export function App({ wasmUrl, fontsUrl, toolbar, sidebar, annotate, organize, design, author, controller, pending }) {
  // the engine restarts whenever its settings change, so keep the font settings the same object
  const fontFallback = useMemo(() => fontConfig(fontsUrl), [fontsUrl]);
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl, worker: true, fontFallback });
  // a new plugin list restarts the viewer and closes the document, so it depends on the author
  // only; everything else is decided at render time
  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, {}),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
    createPluginRegistration(ScrollPluginPackage),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(TilingPluginPackage),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
    // the label row holds the page number, and the page buttons when organising
    createPluginRegistration(ThumbnailPluginPackage, { width: 110, gap: 10, labelHeight: 26 }),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(ExportPluginPackage),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      annotationAuthor: author,
      deactivateToolAfterCreate: false,
      selectAfterCreate: false,
      // form fields are for filling in, not for moving about: locking them sends clicks to the field
      locked: { type: LockModeType.Include, categories: ['form'] },
    }),
    // form fields become inputs on the page, drawn by the annotation layer
    createPluginRegistration(FormPluginPackage),
  ], [author]);

  if (error) {
    controller.emit('od-error', { code: 'ENGINE_ERROR', message: String(error.message ?? error) });
    return html`<div class="frame"><p class="message error">The PDF engine could not start.</p></div>`;
  }
  if (isLoading || !engine) return html`<div class="frame"><p class="message">Loading…</p></div>`;

  return html`<${EmbedPDF}
    engine=${engine}
    plugins=${plugins}
    onInitialized=${async (/** @type {any} */ registry) => {
      controller.registry = registry;
      serializeFormWrites(registry.getPlugin?.('form'));
      if (pending.current) controller.open?.(pending.current);
    }}
  >
    ${(/** @type {any} */ { activeDocumentId }) => html`<${Shell} documentId=${activeDocumentId} toolbar=${toolbar} sidebar=${sidebar || organize} annotate=${annotate} organize=${organize} design=${design} controller=${controller} />`}
  </${EmbedPDF}>`;
}

/**
 * @param {{ documentId: string | null, toolbar: boolean, sidebar: boolean, annotate: boolean, organize: boolean, controller: Controller }} props
 */
function Shell({ documentId, toolbar, sidebar, annotate, organize, design, controller }) {
  const [showSidebar, setShowSidebar] = useState(sidebar);
  /** @type {[string | null, (tool: string | null) => void]} */
  const [fieldTool, setFieldTool] = useState(/** @type {string | null} */ (null));
  useEffect(() => {
    if (!design) setFieldTool(null);
  }, [design]);
  useEffect(() => setShowSidebar(sidebar), [sidebar]);
  if (!documentId) return html`<div class="frame"><p class="message">No document.</p></div>`;
  return html`<${DocumentContent} documentId=${documentId}>
    ${(/** @type {any} */ { isLoaded, isError, documentState }) => {
      if (isError) {
        const message = documentState?.error ?? 'This file could not be opened.';
        return html`<div class="frame"><p class="message error">${String(message)}</p></div>`;
      }
      if (!isLoaded) return html`<div class="frame"><p class="message">Opening…</p></div>`;
      return html`<div class="frame">
        ${toolbar && html`<${Toolbar} documentId=${documentId} showSidebar=${showSidebar} onToggleSidebar=${() => setShowSidebar((s) => !s)} />`}
        ${toolbar && annotate && html`<${AnnotationTools} documentId=${documentId} />`}
        ${toolbar && design && html`<${FieldTools} active=${fieldTool} onPick=${setFieldTool} />`}
        <${Changes} documentId=${documentId} controller=${controller} />
        <div class="body">
          ${showSidebar && html`<${Sidebar} documentId=${documentId} organize=${organize} controller=${controller} />`}
          <${Pages} documentId=${documentId} controller=${controller} fieldTool=${design ? fieldTool : null} />
        </div>
      </div>`;
    }}
  </${DocumentContent}>`;
}

/**
 * @param {{ documentId: string, showSidebar: boolean, onToggleSidebar: () => void }} props
 */
function Toolbar({ documentId, showSidebar, onToggleSidebar }) {
  const zoom = useZoom(documentId);
  const scroll = useScroll(documentId);
  const search = useSearch(documentId);
  const [pageText, setPageText] = useState('');
  const [query, setQuery] = useState('');
  const current = scroll.state.currentPage;
  const total = scroll.state.totalPages;
  useEffect(() => setPageText(String(current)), [current]);

  const goTo = () => {
    const n = Number(pageText);
    if (Number.isInteger(n) && n >= 1 && n <= total) scroll.provides?.scrollToPage({ pageNumber: n });
    else setPageText(String(current));
  };
  const runSearch = () => {
    if (query.trim()) search.provides?.searchAllPages(query.trim());
    else search.provides?.stopSearch();
  };
  const found = search.state?.total ?? 0;
  const active = search.state?.activeResultIndex ?? -1;

  return html`<div class="bar" part="toolbar">
    <button title="Pages" aria-label="Show pages" aria-pressed=${String(showSidebar)} onClick=${onToggleSidebar}>☰</button>
    <button title="Previous page" aria-label="Previous page" disabled=${current <= 1} onClick=${() => scroll.provides?.scrollToPreviousPage()}>‹</button>
    <input class="page-input" aria-label="Page" value=${pageText} onInput=${(/** @type {any} */ e) => setPageText(e.currentTarget.value)} onKeyDown=${(/** @type {KeyboardEvent} */ e) => e.key === 'Enter' && goTo()} onBlur=${goTo} />
    <span class="muted">of ${total}</span>
    <button title="Next page" aria-label="Next page" disabled=${current >= total} onClick=${() => scroll.provides?.scrollToNextPage()}>›</button>
    <span class="grow"></span>
    <button title="Zoom out" aria-label="Zoom out" onClick=${() => zoom.provides?.zoomOut()}>−</button>
    <span class="muted" aria-live="polite">${Math.round((zoom.state?.currentZoomLevel ?? 1) * 100)}%</span>
    <button title="Zoom in" aria-label="Zoom in" onClick=${() => zoom.provides?.zoomIn()}>+</button>
    <button title="Fit width" onClick=${() => zoom.provides?.requestZoom(ZoomMode.FitWidth)}>Fit</button>
    <span class="grow"></span>
    <input class="search" type="search" placeholder="Search" aria-label="Search the document" value=${query}
      onInput=${(/** @type {any} */ e) => setQuery(e.currentTarget.value)}
      onKeyDown=${(/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'Enter') return;
        if (search.state?.query === query.trim() && found) (e.shiftKey ? search.provides?.previousResult() : search.provides?.nextResult());
        else runSearch();
      }} />
    <span class="muted results">${search.state?.query ? `${found ? active + 1 : 0} of ${found}` : ''}</span>
    <button title="Previous match" aria-label="Previous match" disabled=${!found} onClick=${() => search.provides?.previousResult()}>↑</button>
    <button title="Next match" aria-label="Next match" disabled=${!found} onClick=${() => search.provides?.nextResult()}>↓</button>
  </div>`;
}

/** @param {{ documentId: string }} props */
function AnnotationTools({ documentId }) {
  const annotation = useAnnotation(documentId);
  const { provides: history } = useCapability('history');
  const active = annotation.state?.activeToolId ?? null;
  const selected = annotation.state?.selectedUids ?? [];
  // re-render when the history changes, so undo and redo enable and disable
  const [, tick] = useState(0);
  useEffect(() => /** @type {any} */ (history)?.onHistoryChange?.(() => tick((n) => n + 1)), [history]);
  const h = /** @type {any} */ (history);
  return html`<div class="bar tools" part="annotation-toolbar" role="toolbar" aria-label="Annotate">
    <button aria-pressed=${String(active === null)} onClick=${() => annotation.provides?.setActiveTool(null)}>Select</button>
    ${TOOLS.map(([id, label]) => html`<button data-tool=${id} aria-pressed=${String(active === id)} onClick=${() => annotation.provides?.setActiveTool(active === id ? null : id)}>${label}</button>`)}
    <span class="grow"></span>
    <button aria-label="Delete the selected annotation" disabled=${!selected.length} onClick=${() => {
      const a = /** @type {any} */ (annotation.provides);
      for (const t of a?.getSelectedAnnotations() ?? []) a.deleteAnnotation(t.object.pageIndex, t.object.id);
    }}>Delete</button>
    <button aria-label="Undo" disabled=${!h?.canUndo?.()} onClick=${() => h?.undo()}>Undo</button>
    <button aria-label="Redo" disabled=${!h?.canRedo?.()} onClick=${() => h?.redo()}>Redo</button>
  </div>`;
}

/** Tells the element when annotations and form fields change. @param {{ documentId: string, controller: Controller }} props */
function Changes({ documentId, controller }) {
  const annotation = useAnnotation(documentId);
  const { provides: forms } = useCapability('form');
  useEffect(() => {
    const scope = /** @type {any} */ (forms)?.forDocument?.(documentId);
    if (!scope?.onFieldValueChange) return undefined;
    return scope.onFieldValueChange((/** @type {any} */ e) => {
      const field = e.widget?.field;
      controller.emit('od-change', { type: 'field', page: e.pageIndex + 1, name: field?.name ?? null, value: field?.value ?? null });
    });
  }, [forms, documentId]);
  useEffect(() => {
    const scope = /** @type {any} */ (annotation.provides);
    if (!scope?.onAnnotationEvent) return undefined;
    return scope.onAnnotationEvent((/** @type {any} */ e) => {
      // EmbedPDF reports a new annotation twice, before and after it is written into the PDF
      if (e.committed === false) return;
      if (e.type === 'create' || e.type === 'update' || e.type === 'delete') {
        const subtype = /** @type {any} */ (PdfAnnotationSubtype)[e.annotation?.type];
        controller.emit('od-change', {
          type: e.type,
          page: (e.pageIndex ?? e.annotation?.pageIndex ?? 0) + 1,
          annotation: typeof subtype === 'string' ? subtype.toLowerCase() : null,
        });
      }
    });
  }, [annotation.provides]);
  return null;
}

/** @param {{ documentId: string, organize: boolean, controller: Controller }} props */
function Sidebar({ documentId, organize, controller }) {
  const scroll = useScroll(documentId);
  const [dragging, setDragging] = useState(/** @type {number | null} */ (null));
  const [over, setOver] = useState(/** @type {number | null} */ (null));
  const [busy, setBusy] = useState(false);
  /** @param {() => Promise<any> | undefined} work */
  const act = async (work) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (err) {
      controller.emit('od-error', { code: /** @type {any} */ (err)?.code ?? 'ENGINE_ERROR', message: String(/** @type {any} */ (err)?.message ?? err) });
    } finally {
      setBusy(false);
    }
  };
  return html`<div class=${`sidebar${organize ? ' organize' : ''}${busy ? ' busy' : ''}`} part="sidebar">
    <${ThumbnailsPane} documentId=${documentId} style=${{ height: '100%' }}>
      ${(/** @type {any} */ m) => {
        const n = m.pageIndex + 1;
        const cls = `thumb${scroll.state.currentPage === n ? ' current' : ''}${over === n && dragging !== n ? ' drop' : ''}`;
        return html`<div
          key=${m.pageIndex}
          class=${cls}
          data-thumb=${n}
          style=${{ top: m.top, height: m.wrapperHeight }}
          draggable=${organize ? 'true' : 'false'}
          onClick=${() => scroll.provides?.scrollToPage({ pageNumber: n })}
          onDragStart=${(/** @type {DragEvent} */ e) => {
            setDragging(n);
            e.dataTransfer?.setData('text/plain', String(n));
          }}
          onDragOver=${(/** @type {DragEvent} */ e) => {
            if (dragging === null) return;
            e.preventDefault();
            setOver(n);
          }}
          onDragLeave=${() => setOver((o) => (o === n ? null : o))}
          onDrop=${(/** @type {DragEvent} */ e) => {
            e.preventDefault();
            const from = dragging;
            setDragging(null);
            setOver(null);
            if (from !== null && from !== n) act(() => controller.organize?.move(from, n));
          }}
          onDragEnd=${() => {
            setDragging(null);
            setOver(null);
          }}
        >
          <${ThumbImg} documentId=${documentId} meta=${m} alt=${`Page ${n}`} style=${{ width: m.width, height: m.height }} />
          <div class="thumb-label" onClick=${(/** @type {Event} */ e) => organize && e.stopPropagation()}>
            ${organize && html`<button aria-label=${`Turn page ${n} left`} onClick=${() => act(() => controller.organize?.rotate(n, -90))}>↺</button>`}
            <span>${n}</span>
            ${organize && html`<button aria-label=${`Turn page ${n} right`} onClick=${() => act(() => controller.organize?.rotate(n, 90))}>↻</button>`}
            ${organize && html`<button aria-label=${`Delete page ${n}`} disabled=${scroll.state.totalPages < 2} onClick=${() => act(() => controller.organize?.remove(n))}>✕</button>`}
          </div>
        </div>`;
      }}
    </${ThumbnailsPane}>
  </div>`;
}

/** @param {{ active: string | null, onPick: (tool: string | null) => void }} props */
function FieldTools({ active, onPick }) {
  return html`<div class="bar tools" part="field-toolbar" role="toolbar" aria-label="Add form fields">
    <button aria-pressed=${String(active === null)} onClick=${() => onPick(null)}>Done</button>
    ${FIELD_TOOLS.map(([id, label]) => html`<button data-field-tool=${id} aria-pressed=${String(active === id)} onClick=${() => onPick(active === id ? null : id)}>${label}</button>`)}
    <span class="grow"></span>
    <span class="muted">${active ? 'Drag on a page to place it' : ''}</span>
  </div>`;
}

/**
 * Over a page while a field tool is picked: drag a box, name the field, add it.
 *
 * @param {{ documentId: string, tool: string, pageIndex: number, controller: Controller }} props
 */
function DesignLayer({ documentId, tool, pageIndex, controller }) {
  // CSS pixels per point: the page is drawn at the zoom level
  const scale = useZoom(documentId).state?.currentZoomLevel ?? 1;
  /** @type {[{ x: number, y: number, w: number, h: number } | null, (r: any) => void]} */
  const [box, setBox] = useState(/** @type {any} */ (null));
  /** @type {[{ x: number, y: number, w: number, h: number } | null, (r: any) => void]} */
  const [draft, setDraft] = useState(/** @type {any} */ (null));
  const [name, setName] = useState('');
  const [options, setOptions] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const start = useRef(/** @type {{ x: number, y: number } | null} */ (null));
  const where = (/** @type {PointerEvent} */ e) => {
    const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0 || draft) return;
    e.stopPropagation();
    e.preventDefault();
    /** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
    start.current = where(e);
    setBox({ ...start.current, w: 0, h: 0 });
  };
  const move = (/** @type {PointerEvent} */ e) => {
    if (!start.current) return;
    e.stopPropagation();
    const p = where(e);
    const s = start.current;
    setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = (/** @type {PointerEvent} */ e) => {
    if (!start.current) return;
    e.stopPropagation();
    start.current = null;
    // a click, not a drag: a field of a usual size where it was clicked
    const fallback = tool === 'checkbox' ? { w: 14, h: 14 } : tool === 'list' ? { w: 150, h: 60 } : { w: 180, h: 22 };
    const placed = box && box.w >= 6 && box.h >= 6 ? box : { x: box?.x ?? 0, y: box?.y ?? 0, w: fallback.w * scale, h: fallback.h * scale };
    setBox(null);
    const prefix = FIELD_TOOLS.find(([id]) => id === tool)?.[2] ?? 'field';
    const taken = new Set(controller.design?.names() ?? []);
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n++;
    setName(`${prefix}${n}`);
    setOptions('');
    setError('');
    setDraft(placed);
  };
  const add = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const choices = options.split(',').map((o) => o.trim()).filter(Boolean);
      await controller.design?.add({
        type: tool,
        name: name.trim(),
        page: pageIndex + 1,
        x: round(draft.x / scale),
        y: round(draft.y / scale),
        width: round(draft.w / scale),
        height: round(draft.h / scale),
        ...(tool === 'dropdown' || tool === 'list' ? { options: choices } : {}),
      });
      setDraft(null);
    } catch (err) {
      setError(String(/** @type {Error} */ (err)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };
  const shown = draft ?? box;
  const choice = tool === 'dropdown' || tool === 'list';
  return html`<div class="design-layer" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up}>
    ${shown && html`<div class="draft-box" style=${{ left: `${shown.x}px`, top: `${shown.y}px`, width: `${shown.w}px`, height: `${shown.h}px` }}></div>`}
    ${draft && html`<form class=${`draft-panel${busy ? ' busy' : ''}`} style=${{ left: `${draft.x}px`, top: `${draft.y + draft.h + 6}px` }}
        onPointerDown=${(/** @type {Event} */ e) => e.stopPropagation()}
        onSubmit=${(/** @type {Event} */ e) => { e.preventDefault(); add(); }}>
      <label>Name <input name="field-name" value=${name} onInput=${(/** @type {any} */ e) => setName(e.currentTarget.value)} required /></label>
      ${choice && html`<label>Options <input name="field-options" placeholder="one, two, three" value=${options} onInput=${(/** @type {any} */ e) => setOptions(e.currentTarget.value)} /></label>`}
      ${error && html`<p class="draft-error" role="alert">${error}</p>`}
      <div class="draft-buttons"><button type="submit">Add</button><button type="button" onClick=${() => setDraft(null)}>Cancel</button></div>
    </form>`}
  </div>`;
}

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;

/** @param {{ documentId: string, controller: Controller, fieldTool?: string | null }} props */
function Pages({ documentId, controller, fieldTool = null }) {
  const scroll = useScroll(documentId);
  const { currentPage, totalPages } = scroll.state;
  useEffect(() => {
    if (totalPages) controller.emit('od-page', { page: currentPage, pageCount: totalPages });
  }, [currentPage, totalPages]);
  // the viewport measures itself from its own style, so it needs a real size here
  // pointer providers hand clicks and drags to whatever tool is active: selecting text,
  // drawing, placing notes
  return html`<${GlobalPointerProvider} documentId=${documentId} style=${{ flex: '1', minWidth: '0', height: '100%', display: 'flex' }}>
    <${Viewport} documentId=${documentId} class="viewport" style=${{ flex: '1', minWidth: '0', height: '100%', background: 'var(--od-bg)' }}>
      <${Scroller} documentId=${documentId} renderPage=${(/** @type {any} */ { width, height, pageIndex, scale, rotation }) => html`
        <${PagePointerProvider} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} rotation=${rotation} class="page" style=${{ width, height }} data-page=${pageIndex + 1}>
          <${RenderLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${1} />
          <${TilingLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
          <${SearchLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
          <${SelectionLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
          <${AnnotationLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
          ${fieldTool && html`<${DesignLayer} documentId=${documentId} tool=${fieldTool} pageIndex=${pageIndex} controller=${controller} />`}
        </${PagePointerProvider}>`} />
    </${Viewport}>
  </${GlobalPointerProvider}>`;
}
