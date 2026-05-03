// The viewer's insides: EmbedPDF's headless plugins, laid out with Preact and htm (no build
// step for JSX). The element in element.js owns this and talks to it through `controller`.
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
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
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail';
import { ThumbnailsPane, ThumbImg } from '@embedpdf/plugin-thumbnail/preact';
import { SearchPluginPackage } from '@embedpdf/plugin-search';
import { SearchLayer, useSearch } from '@embedpdf/plugin-search/preact';
import { SelectionPluginPackage, SelectionLayer } from '@embedpdf/plugin-selection/preact';
import { ExportPluginPackage } from '@embedpdf/plugin-export/preact';
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
 */

/**
 * @param {{ wasmUrl: string, fontsUrl: string | null, toolbar: boolean, sidebar: boolean, controller: Controller, pending: { current: any } }} props
 */
export function App({ wasmUrl, fontsUrl, toolbar, sidebar, controller, pending }) {
  // the engine restarts whenever its settings change, so keep the font settings the same object
  const fontFallback = useMemo(() => fontConfig(fontsUrl), [fontsUrl]);
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl, worker: true, fontFallback });
  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, {}),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
    createPluginRegistration(ScrollPluginPackage),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(TilingPluginPackage),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
    createPluginRegistration(ThumbnailPluginPackage, { width: 110, gap: 10, labelHeight: 16 }),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(ExportPluginPackage),
  ], []);

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
      if (pending.current) controller.open?.(pending.current);
    }}
  >
    ${(/** @type {any} */ { activeDocumentId }) => html`<${Shell} documentId=${activeDocumentId} toolbar=${toolbar} sidebar=${sidebar} controller=${controller} />`}
  </${EmbedPDF}>`;
}

/**
 * @param {{ documentId: string | null, toolbar: boolean, sidebar: boolean, controller: Controller }} props
 */
function Shell({ documentId, toolbar, sidebar, controller }) {
  const [showSidebar, setShowSidebar] = useState(sidebar);
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
        <div class="body">
          ${showSidebar && html`<${Sidebar} documentId=${documentId} />`}
          <${Pages} documentId=${documentId} controller=${controller} />
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
function Sidebar({ documentId }) {
  const scroll = useScroll(documentId);
  return html`<div class="sidebar" part="sidebar">
    <${ThumbnailsPane} documentId=${documentId} style=${{ height: '100%' }}>
      ${(/** @type {any} */ m) => html`<div
        key=${m.pageIndex}
        class=${`thumb${scroll.state.currentPage === m.pageIndex + 1 ? ' current' : ''}`}
        style=${{ top: m.top, height: m.wrapperHeight }}
        onClick=${() => scroll.provides?.scrollToPage({ pageNumber: m.pageIndex + 1 })}
      >
        <${ThumbImg} documentId=${documentId} meta=${m} alt=${`Page ${m.pageIndex + 1}`} />
        <span>${m.pageIndex + 1}</span>
      </div>`}
    </${ThumbnailsPane}>
  </div>`;
}

/** @param {{ documentId: string, controller: Controller }} props */
function Pages({ documentId, controller }) {
  const scroll = useScroll(documentId);
  const { currentPage, totalPages } = scroll.state;
  useEffect(() => {
    if (totalPages) controller.emit('od-page', { page: currentPage, pageCount: totalPages });
  }, [currentPage, totalPages]);
  // the viewport measures itself from its own style, so it needs a real size here
  return html`<${Viewport} documentId=${documentId} class="viewport" style=${{ flex: '1', minWidth: '0', height: '100%', background: 'var(--od-bg)' }}>
    <${Scroller} documentId=${documentId} renderPage=${(/** @type {any} */ { width, height, pageIndex, scale }) => html`
      <div class="page" style=${{ width, height }} data-page=${pageIndex + 1}>
        <${RenderLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${1} />
        <${TilingLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
        <${SearchLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
        <${SelectionLayer} documentId=${documentId} pageIndex=${pageIndex} scale=${scale} />
      </div>`} />
  </${Viewport}>`;
}
