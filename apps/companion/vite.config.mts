/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { alphaTab } from '@coderline/alphatab-vite';
import { resolve } from 'node:path';

// Tauri injects TAURI_DEV_HOST when developing against a physical device.
const host = process.env.TAURI_DEV_HOST;
const isTauriDebug = !!process.env.TAURI_ENV_DEBUG;

export default defineConfig(() => ({
  root: __dirname,
  // Tauri owns the terminal during `tauri dev` — don't wipe its output.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@gpt/gpt-core': resolve(__dirname, '../../packages/gpt-core/src/index.ts'),
      '@gpt/alphatab-react': resolve(__dirname, '../../packages/alphatab-react/src/index.ts'),
    },
  },
  server: {
    // Fixed port: tauri.conf.json's devUrl points at it.
    port: 4210,
    strictPort: true,
    host: host || 'localhost',
    hmr: host ? { protocol: 'ws', host, port: 4211 } : undefined,
    watch: {
      // Rust sources are watched by the Tauri CLI, not by Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  plugins: [react(), tailwindcss(), alphaTab()],
  // esbuild pre-bundling would rewrite alphaTab's import.meta.url references
  // before the alphaTab plugin gets to see its worker/worklet entry points.
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    // The webview is WKWebView on macOS; no need to down-level further.
    target: 'safari15',
    minify: isTauriDebug ? false : 'esbuild',
    sourcemap: isTauriDebug,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        // Hotkey panel — created hidden at startup, toggled by the shortcut.
        panel: resolve(__dirname, 'index.html'),
        // Extended window — created lazily from the panel.
        extended: resolve(__dirname, 'extended.html'),
      },
    },
  },
  test: {
    name: '@gpt/companion',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx,mts}'],
    reporters: ['default'],
  },
}));
