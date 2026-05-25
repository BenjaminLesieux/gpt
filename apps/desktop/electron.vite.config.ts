import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { alphaTab } from "@coderline/alphatab-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: __dirname,
    plugins: [react(), tailwindcss(), alphaTab()],
    resolve: {
      conditions: ["@gpt/source", "module", "browser", "development|production"],
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    // Prevent esbuild from pre-bundling alphaTab so that the alphaTab Vite
    // plugin can transform its import.meta.url worker/worklet references.
    optimizeDeps: {
      exclude: ["@coderline/alphatab"],
    },
    server: {
      port: 4200,
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html"),
      },
    },
  },
});
