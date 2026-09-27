import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/generated/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        URL: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        structuredClone: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/processing/execute.ts", "src/processing/engine.worker.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@myanlex/application",
              allowTypeImports: true,
              message:
                "Runtime application services belong in the worker executor.",
            },
            {
              name: "@myanlex/core",
              message: "Use the public application boundary.",
            },
            {
              name: "@myanlex/playground",
              message: "Private playground dependencies are forbidden.",
            },
            {
              name: "@myanlex/sdk",
              message: "No API execution in milestone one.",
            },
          ],
        },
      ],
    },
  },
);
