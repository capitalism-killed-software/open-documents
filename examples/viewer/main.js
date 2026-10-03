import '@open-documents/viewer';
import { configure, toDocx } from '@open-documents/core';

configure({ wasmUrl: new URL('./pdfium.wasm', import.meta.url) });

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const viewer = /** @type {any} */ ($('viewer'));
const word = /** @type {HTMLButtonElement} */ ($('word'));
const status = $('status');
let name = 'document.pdf';

viewer.addEventListener('od-load', (/** @type {any} */ e) => {
  name = e.detail.name;
  word.disabled = false;
  const { pageCount } = e.detail;
  status.textContent = `${name}: ${pageCount} page${pageCount === 1 ? '' : 's'}. Download saves every change.`;
});
viewer.addEventListener('od-error', (/** @type {any} */ e) => (status.textContent = e.detail.message));

// The library runs in the page too: this turns what is shown, changes included, into Word.
word.onclick = async () => {
  word.disabled = true;
  status.textContent = 'Making the Word file…';
  try {
    const docx = await toDocx(await viewer.save());
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    link.download = `${name.replace(/\.pdf$/i, '')}.docx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    status.textContent = `${link.download} is in your downloads.`;
  } catch (err) {
    status.textContent = String(/** @type {Error} */ (err)?.message ?? err);
  } finally {
    word.disabled = false;
  }
};

// Drop a PDF anywhere on the page to open it.
let depth = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++depth === 1) document.body.classList.add('dragging');
});
document.addEventListener('dragleave', () => {
  if (--depth === 0) document.body.classList.remove('dragging');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0;
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) viewer.load(file).catch(() => {});
});
