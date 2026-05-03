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
.body { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 150px; border-right: 1px solid var(--od-line); background: var(--od-bar); }
.thumb { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; }
.thumb img { box-shadow: 0 0 0 1px var(--od-line); background: #fff; }
.thumb.current img { box-shadow: 0 0 0 2px var(--od-accent); }
.thumb span { font-size: 11px; color: var(--od-muted); margin-top: 2px; }
.viewport { flex: 1; min-width: 0; }
.page { position: relative; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }
.message { margin: auto; padding: 24px; color: var(--od-muted); text-align: center; }
.message.error { color: #b3261e; }
`;
