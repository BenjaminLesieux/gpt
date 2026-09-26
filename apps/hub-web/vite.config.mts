/// <reference types='vitest' />
import { resolve } from 'node:path';
import { alphaTab } from '@coderline/alphatab-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * The hub serves this bundle itself in production, so every route the API
 * owns has to reach Fastify in development too — otherwise the dev server
 * answers `/auth/login` with index.html and the session cookie is never set.
 */
const API_PREFIXES = ['/auth', '/git', '/health', '/invites'];
const API_ORIGIN = process.env.HUB_API_ORIGIN ?? 'http://localhost:3000';

/**
 * `/scores` is shared: the list and everything score-scoped are the API, but
 * `/scores/<id>` on its own is a page this dev server has to serve itself.
 * Proxying it sends the browser the hub's built index.html, which points at
 * asset hashes the dev server does not have — a blank screen and a 404.
 *
 * The same split the hub makes in `app/plugins/web.ts`; a regex key is how
 * Vite expresses it. Keep the two in step.
 */
const SCORE_API = ['^/scores$', '^/scores\\?', '^/scores/[^/]+/'];

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
      [...API_PREFIXES, ...SCORE_API].map((prefix) => [
        prefix,
        { target: API_ORIGIN, changeOrigin: false },
      ])
    ),
  },
  preview: {
    port: 4220,
    host: 'localhost',
  },
  // alphaTab ships its own worker, worklet, music font and soundfont; the
  // plugin emits them and rewrites the paths. The same one the companion
  // uses, so the web player and the desktop one render from identical assets.
  plugins: [react(), tailwindcss(), alphaTab()],
  // esbuild pre-bundling would rewrite alphaTab's import.meta.url references
  // before the plugin gets to see its worker and worklet entry points.
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
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
    setupFiles: ['src/test-setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    includeSource: ['src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
