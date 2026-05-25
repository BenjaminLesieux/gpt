/// <reference types='vitest' />
import { defineConfig } from "vite";
import * as path from "path";

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      "@gpt/gpt-core": path.resolve(
        import.meta.dirname,
        "../../packages/gpt-core/src/index.ts"
      ),
    },
  },
  test: {
    name: "@gpt/cli",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,mts}"],
    testTimeout: 15000,
    reporters: ["default"],
  },
});
