import { defineConfig, globalIgnores } from "eslint/config";
import typescript from "eslint-config-next/typescript";

// Reuse the TypeScript-only preset already pinned by the root toolchain. No
// Next.js, React or browser rules apply to server code.
export function serverConfig(tsconfigRootDir) {
  return defineConfig([
    ...typescript,
    {
      files: ["src/**/*.ts"],
      rules: {
        // Existing transport/test doubles use explicit any. Tighten those as
        // their contracts are migrated; promise correctness is enforced now.
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-unused-expressions": "error",
        "no-async-promise-executor": "error",
        "no-constant-binary-expression": "error",
        "no-unsafe-finally": "error",
        "no-loss-of-precision": "error",
        eqeqeq: ["error", "always", { null: "ignore" }],
      },
    },
    {
      files: ["src/**/*.ts"],
      ignores: ["src/**/*.test.ts"],
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } },
      rules: {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
        "@typescript-eslint/await-thenable": "error",
      },
    },
    globalIgnores(["dist/**", "node_modules/**"]),
  ]);
}
