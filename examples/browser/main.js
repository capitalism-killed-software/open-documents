import { configure, inspect, thumbnails, merge, split, rotate, watermark } from '@open-documents/core';

configure({ wasmUrl: new URL('./pdfium.wasm', import.meta.url) });

/** @type {{ name: string, bytes: Uint8Array }[]} */
const files = [];
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const buttons = ['merge', 'split', 'rotate', 'watermark'].map((id) => /** @type {HTMLButtonElement} */ ($(id)));

/** @param {FileList | File[]} list */
async function add(list) {
  for (const file of list) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const [{ pageCount }, [thumb]] = await Promise.all([inspect(bytes), thumbnails(bytes, { pages: [1], width: 150 })]);
      files.push({ name: file.name, bytes });
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = URL.createObjectURL(new Blob([thumb.data], { type: 'image/png' }));
      img.alt = `First page of ${file.name}`;
      li.append(img, `${file.name} (${pageCount} page${pageCount === 1 ? '' : 's'})`);
      $('files').append(li);
    } catch (err) {
      status(`${file.name}: ${/** @type {Error} */ (err).message}`);
    }
  }
  buttons.forEach((b) => (b.disabled = files.length === 0));
}

/**
 * @param {string} name
 * @param {Uint8Array} bytes
 */
function offer(name, bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = name;
  a.textContent = `Download ${name}`;
  $('results').append(a);
}

/** @param {string} text */
function status(text) {
  $('status').textContent = text;
}

/**
 * @param {string} label
 * @param {() => Promise<void>} work
 */
async function run(label, work) {
  $('results').replaceChildren();
  status(`${label}…`);
  const started = performance.now();
  try {
    await work();
    status(`${label}: done in ${Math.round(performance.now() - started)} ms.`);
  } catch (err) {
    status(`${label} failed: ${/** @type {Error} */ (err).message}`);
  }
}

const stem = (/** @type {string} */ name) => name.replace(/\.pdf$/i, '');

$('merge').onclick = () => run('Merging', async () => offer('merged.pdf', await merge(files.map((f) => f.bytes), { bookmarks: true })));
$('split').onclick = () =>
  run('Splitting', async () => {
    for (const f of files) {
      const parts = await split(f.bytes);
      parts.forEach((part, i) => offer(`${stem(f.name)}-${i + 1}.pdf`, part));
    }
  });
$('rotate').onclick = () =>
  run('Rotating', async () => {
    for (const f of files) offer(`${stem(f.name)}-rotated.pdf`, await rotate(f.bytes, { angle: 90 }));
  });
$('watermark').onclick = () =>
  run('Watermarking', async () => {
    for (const f of files) offer(`${stem(f.name)}-draft.pdf`, await watermark(f.bytes, { text: 'DRAFT' }));
  });

const drop = $('drop');
/** @type {HTMLInputElement} */ ($('pick')).onchange = (e) => add(/** @type {HTMLInputElement} */ (e.target).files ?? []);
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add('over');
};
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  add([...(e.dataTransfer?.files ?? [])].filter((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf')));
};
