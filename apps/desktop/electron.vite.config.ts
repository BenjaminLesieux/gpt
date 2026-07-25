import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { alphaTab } from "@coderline/alphatab-vite";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Rolldown (used by Vite 8) requires transform hooks to return `{ moduleType }`
 * alongside `{ code, map }`. The alphatab-vite plugin was written for Rollup and
 * omits this field, causing a hard build error. This wrapper injects it.
 */
function withRolldownFix(plugins: Plugin | Plugin[]): Plugin[] {
  const list = ([] as Plugin[]).concat(plugins as Plugin[]);
  return list.map((plugin) => {
    const { transform } = plugin;
    if (!transform) return plugin;

    const addModuleType = (result: unknown) => {
      if (
        result &&
        typeof result === "object" &&
        "code" in result &&
        !("moduleType" in result)
      ) {
        return { ...(result as object), moduleType: "js" };
      }
      return result;
    };

    const wrappedTransform =
      typeof transform === "function"
        ? async function (this: unknown, ...args: unknown[]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (transform as any).apply(this, args);
            return addModuleType(result);
          }
        : {
            ...(transform as object),
            handler: async function (this: unknown, ...args: unknown[]) {
              const result = await (
                (transform as { handler: (...a: unknown[]) => unknown }).handler
              ).apply(this, args);
              return addModuleType(result);
            },
          };

    return { ...plugin, transform: wrappedTransform as Plugin["transform"] };
  });
}

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
    plugins: [
        react(),
        tailwindcss(),
        ...withRolldownFix(alphaTab({ webWorkers: false, audioWorklets: false })),
      ],
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
