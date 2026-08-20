// Styles live inside the shadow root, so they neither leak into the host page nor pick its
// styles up. Colours and sizes can be changed from outside through the --od-* custom properties.
export const STYLES = `
:host {
  --od-bg: #e8e8ea;
  --od-bar: #ffffff;
  --od-ink: #1d1d1f;
  --od-muted: #6e6e73;
  --od-line: #d2d2d7;
  --od-accent: #0b63ce;
  --od-height: 600px;
  display: block;
  height: var(--od-height);
  font: 13px/1.4 -apple-system, "Segoe UI", "Liberation Sans", Arial, sans-serif;
  color: var(--od-ink);
  contain: content;
}
.frame { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--od-line); border-radius: 6px; overflow: hidden; background: var(--od-bg); }
.bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--od-bar); border-bottom: 1px solid var(--od-line); flex-wrap: wrap; }
.bar .grow { flex: 1; }
.bar button { font: inherit; min-width: 30px; height: 30px; padding: 0 8px; border: 1px solid var(--od-line); border-radius: 5px; background: var(--od-bar); color: var(--od-ink); cursor: pointer; }
.bar button:hover:not(:disabled) { border-color: var(--od-muted); }
.bar button:disabled { opacity: 0.4; cursor: default; }
.bar button[aria-pressed="true"] { background: var(--od-accent); border-color: var(--od-accent); color: #fff; }
.bar input { font: inherit; height: 28px; border: 1px solid var(--od-line); border-radius: 5px; padding: 0 6px; background: var(--od-bar); color: var(--od-ink); }
.bar .page-input { width: 3.5em; text-align: right; }
.bar .search { width: 12em; }
.bar .muted { color: var(--od-muted); }
.bar.tools { padding-top: 4px; padding-bottom: 4px; }
.body { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 150px; border-right: 1px solid var(--od-line); background: var(--od-bar); }
.thumb { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; }
.thumb img { box-shadow: 0 0 0 1px var(--od-line); background: #fff; }
.thumb.current img { box-shadow: 0 0 0 2px var(--od-accent); }
.thumb-label { display: flex; align-items: center; gap: 4px; height: 24px; margin-top: 2px; }
.thumb-label span { font-size: 11px; color: var(--od-muted); min-width: 1.5em; text-align: center; }
.thumb.drop img { box-shadow: 0 -3px 0 0 var(--od-accent), 0 0 0 1px var(--od-line); }
.thumb-label button { font: inherit; font-size: 12px; width: 26px; height: 22px; padding: 0; border: 1px solid var(--od-line); border-radius: 4px; background: var(--od-bar); color: var(--od-ink); cursor: pointer; }
.thumb-label button:disabled { opacity: 0.4; cursor: default; }
.organize .thumb { cursor: grab; }
.busy { opacity: 0.6; pointer-events: none; }
.viewport { flex: 1; min-width: 0; }
.page { position: relative; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }
/* page images are pictures of the page, not things to drag: a native image drag would cancel
   the pointer events that drawing and selecting rely on */
.page img { pointer-events: none; -webkit-user-drag: none; user-select: none; }
/* the form designer: a layer over the page that takes the pointer while a field tool is picked */
.design-layer { position: absolute; inset: 0; z-index: 10; cursor: crosshair; touch-action: none; }
.draft-box { position: absolute; border: 1.5px dashed var(--od-accent); background: rgba(11, 99, 206, 0.08); pointer-events: none; }
.draft-panel { position: absolute; z-index: 11; display: flex; flex-direction: column; gap: 6px; min-width: 200px; padding: 8px; background: var(--od-bar); border: 1px solid var(--od-line); border-radius: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); cursor: default; }
.draft-panel label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--od-muted); }
.draft-panel input { font: inherit; height: 26px; border: 1px solid var(--od-line); border-radius: 4px; padding: 0 6px; color: var(--od-ink); }
.draft-buttons { display: flex; gap: 6px; }
.draft-buttons button { font: inherit; height: 28px; padding: 0 10px; border: 1px solid var(--od-line); border-radius: 5px; background: var(--od-bar); cursor: pointer; }
.draft-buttons button[type="submit"] { background: var(--od-accent); border-color: var(--od-accent); color: #fff; }
.draft-error { margin: 0; color: #b3261e; font-size: 12px; }
.message { margin: auto; padding: 24px; color: var(--od-muted); text-align: center; }
.message.error { color: #b3261e; }
`;
