import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// @magpie/format is a workspace package shipped as TypeScript source, so bundle it
// instead of externalizing it like ordinary node_modules dependencies.
const bundleWorkspace = { exclude: ['@magpie/format'] };

export default defineConfig({
  main: {
    build: {
      externalizeDeps: bundleWorkspace,
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspace,
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          editor: resolve(__dirname, 'src/renderer/editor/index.html'),
          home: resolve(__dirname, 'src/renderer/home/index.html'),
        },
      },
    },
  },
});
