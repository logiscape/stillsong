import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri dev server settings: fixed port, no auto-open. 1433 keeps clear of the
// sibling apps on 1430/1431 and of Stillsong 1's dev server on 1432, so both
// versions can run `tauri dev` side by side.
export default defineConfig({
  plugins: [react({ jsxRuntime: 'classic' })],
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
      '@state': path.resolve(__dirname, 'src/state'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  clearScreen: false,
  server: {
    port: 1433,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
});
