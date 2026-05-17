# The viewer in your framework

`<od-viewer>` is a custom element, so frameworks treat it like any HTML element. Import the
package once, serve `pdfium.wasm`, and use the tag.

```sh
npm install @open-documents/viewer
cp node_modules/@embedpdf/pdfium/dist/pdfium.wasm public/
```

## React (19)

```jsx
import '@open-documents/viewer';
import { useRef } from 'react';

export function Contract({ url }) {
  const viewer = useRef(null);
  const download = async () => {
    const bytes = await viewer.current.save();
    // send bytes to your server, or offer them as a download
  };
  return (
    <>
      <od-viewer ref={viewer} src={url} wasm-url="/pdfium.wasm" annotate="true" onod-change={(e) => console.log(e.detail)} />
      <button onClick={download}>Save</button>
    </>
  );
}
```

React 19 passes custom-element events through `on<event-name>` props as written above. On
React 18, add listeners in a `useEffect` with `viewer.current.addEventListener('od-change', ...)`.

## Vue (3)

Tell Vue the tag is a custom element (in `vite.config.js`:
`vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('od-') } } })`), then:

```vue
<script setup>
import '@open-documents/viewer';
import { ref } from 'vue';
const viewer = ref(null);
const save = async () => console.log(await viewer.value.save());
</script>

<template>
  <od-viewer ref="viewer" :src="url" wasm-url="/pdfium.wasm" organize="true" @od-change="(e) => console.log(e.detail)" />
  <button @click="save">Save</button>
</template>
```

## Svelte (5)

```svelte
<script>
  import '@open-documents/viewer';
  let viewer;
  let { url } = $props();
</script>

<od-viewer bind:this={viewer} src={url} wasm-url="/pdfium.wasm" onod-page={(e) => console.log(e.detail.page)}></od-viewer>
<button onclick={async () => console.log(await viewer.save())}>Save</button>
```

## Angular

Add `CUSTOM_ELEMENTS_SCHEMA` to the component, import the package in `main.ts`, then use the
tag in templates with `(od-change)="onChange($event)"` and `#viewer` for a reference.

## Plain HTML

```html
<script type="module">import '@open-documents/viewer';</script>
<od-viewer src="/contract.pdf" wasm-url="/pdfium.wasm"></od-viewer>
```

Bundlers that copy assets for you (Vite's `?url` imports, for example) can supply the WASM path:
`import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'`, then `wasm-url={wasmUrl}`.
