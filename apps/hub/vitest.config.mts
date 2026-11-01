/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/hub',
  test: {
    name: '@gpt/hub',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // The score specs clone and push real repositories over HTTP and parse
    // real Guitar Pro files: 1–3 s each alone, past the 5 s default once
    // every project's suite runs in parallel.
    testTimeout: 20_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
