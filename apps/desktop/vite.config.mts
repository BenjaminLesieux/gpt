/// <reference types='vitest' />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { alphaTab } from "@coderline/alphatab-vite";
import { resolve } from "node:path";

export default defineConfig(() => ({
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Both workspace packages resolve to source, matching tsconfig.base.json
      // and apps/companion. Without the gpt-core entry Vite falls through to its
      // package exports and serves packages/gpt-core/dist — so edits to the diff
      // engine appear in typecheck and tests but silently not in the running app
      // until someone remembers to rebuild.
      '@gpt/gpt-core': resolve(__dirname, '../../packages/gpt-core/src/index.ts'),
      '@gpt/alphatab-react': resolve(
        __dirname,
        '../../packages/alphatab-react/src/index.ts',
      ),
    },
  },
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4200,
    host: 'localhost',
  },
  plugins: [react(), tailwindcss(), alphaTab()],
  // Prevent esbuild from pre-bundling alphaTab so that the alphaTab Vite
  // plugin can transform its import.meta.url worker/worklet references.
  optimizeDeps: {
    exclude: ["@coderline/alphatab"],
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@gpt/desktop',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx,mts}'],
    setupFiles: ['./src/test-setup.ts'],
    reporters: ['default'],
  },
}));
