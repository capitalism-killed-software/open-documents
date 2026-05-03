import { OdViewer } from './element.js';

if (typeof customElements !== 'undefined' && !customElements.get('od-viewer')) {
  customElements.define('od-viewer', OdViewer);
}

export { OdViewer };
