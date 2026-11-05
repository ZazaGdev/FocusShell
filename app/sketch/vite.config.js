// Builds the Sketch board (#94) into renderer/sketch/, loaded only when a pane's Sketch
// button is first pressed. Run with `npm run sketch`; `npm install` and `dist` run it too.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const out = here('../renderer/sketch');

// Excalidraw fetches its fonts from EXCALIDRAW_ASSET_PATH at runtime, so they ship beside the
// bundle. Xiaolai (13 MB of CJK glyphs) is left out.
const fonts = here('../node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const copyFonts = {
  name: 'copy-excalidraw-fonts',
  closeBundle() {
    if (!existsSync(fonts)) return;
    for (const name of readdirSync(fonts)) if (name !== 'Xiaolai') cpSync(`${fonts}/${name}`, `${out}/fonts/${name}`, { recursive: true });
  },
};

export default defineConfig({
  root: here('.'),
  plugins: [react(), copyFonts],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  // The diagram import (Mermaid) is not part of the board; a stub keeps 3.5 MB out.
  resolve: { alias: { '@excalidraw/mermaid-to-excalidraw': here('./mermaid-stub.js') } },
  build: {
    outDir: out,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    lib: { entry: here('./board.jsx'), formats: ['es'], fileName: () => 'board.js', cssFileName: 'board' },
  },
});
