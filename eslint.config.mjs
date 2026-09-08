// @ts-check
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

// ─── Shared base (all packages) ─────────────────────────────────────────────

const base = tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.nx/**",
      "**/out-tsc/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Enforce explicit return types only on exported functions — internal helpers get inference
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Allow _ prefix for intentionally unused vars (Effect-ts pattern)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Prefer type imports to avoid circular bundling issues
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Allow void in expression positions (Effect.runPromise().catch(...))
      "@typescript-eslint/no-floating-promises": "off",
    },
  }
);

// ─── React surface (desktop + alphatab-react) ────────────────────────────────
// Uses @eslint-react/eslint-plugin (ESLint 10 compatible) instead of the legacy
// eslint-plugin-react@7.x whose Component-based rules break on ESLint 10.

const react = tseslint.config(
  ...base,
  // Spread the @eslint-react recommended config (registers the plugin + default rules)
  eslintReact.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      // Hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Components — enforce `function` declarations for named (PascalCase) components.
      // react/function-component-definition from eslint-plugin-react@7.x is broken on
      // ESLint 10 (uses removed getFilename API), so we use no-restricted-syntax instead.
      "no-restricted-syntax": [
        "error",
        {
          selector: "VariableDeclarator[id.name=/^[A-Z]/] > ArrowFunctionExpression",
          message:
            "React components must use `function` declarations, not arrow functions. Use `function MyComponent() {}` instead.",
        },
      ],

      // Styling — ban CSS modules; use Tailwind CSS or styled-components instead
      "no-restricted-imports": [
        "error",
        {
          patterns: ["**/*.module.css", "**/*.module.scss", "**/*.module.sass", "**/*.module.less"],
        },
      ],

      // @eslint-react equivalents for formerly-broken eslint-plugin-react rules
      "@eslint-react/no-array-index-key": "warn",
      "@eslint-react/no-nested-component-definitions": "error",
      "@eslint-react/dom-no-unsafe-target-blank": "error",

      // Accessibility
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
    },
  }
);

// ─── Non-React surface (gpt-core) ────────────────────────────────────────────

const node = tseslint.config(...base, {
  rules: {
    // The diff walks a whole score in one pass; splitting it up to satisfy a
    // line count would not make it easier to follow.
    "max-lines-per-function": "off",
  },
});

// ─── Per-project overrides ────────────────────────────────────────────────────

export default tseslint.config(
  // packages/gpt-core
  {
    files: ["packages/gpt-core/**/*.ts"],
    extends: [...node],
  },
  // packages/alphatab-react
  {
    files: ["packages/alphatab-react/**/*.{ts,tsx}"],
    extends: [...react],
  },
  // apps/companion (Tauri webview: panel + extended window)
  {
    files: ["apps/companion/src/**/*.{ts,tsx}"],
    extends: [...react],
  },
  // apps/hub (Fastify server)
  {
    files: ["apps/hub/src/**/*.ts"],
    extends: [...node],
  },
  // Test files — relax some rules
  {
    files: ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  }
);
