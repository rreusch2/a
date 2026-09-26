import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@agents/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
