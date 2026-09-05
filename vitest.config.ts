import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
      '@state': path.resolve(__dirname, 'src/state'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  test: {
    include: ['src/engine/__tests__/**/*.test.ts', 'src/ui/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
