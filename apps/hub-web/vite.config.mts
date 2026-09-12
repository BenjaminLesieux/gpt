/// <reference types='vitest' />
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * The hub serves this bundle itself in production, so every route the API
 * owns has to reach Fastify in development too — otherwise the dev server
 * answers `/auth/login` with index.html and the session cookie is never set.
 */
const API_PREFIXES = ['/auth', '/scores', '/git', '/health'];
const API_ORIGIN = process.env.HUB_API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/hub-web',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
    // Workspace packages publish their TypeScript sources under this
    // condition, the same one tsconfig.base.json resolves types through.
    // Without it @gpt/ui resolves to a dist nothing in dev rebuilds.
    conditions: ['@gpt/source', ...defaultClientConditions],
  },
  server: {
    port: 4220,
    host: 'localhost',
    proxy: Object.fromEntries(
      API_PREFIXES.map((prefix) => [prefix, { target: API_ORIGIN, changeOrigin: false }])
    ),
  },
  preview: {
    port: 4220,
    host: 'localhost',
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  define: {
    'import.meta.vitest': undefined,
  },
  test: {
    name: 'hub-web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    includeSource: ['src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
