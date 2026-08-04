import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  {
    rules: {
      // Phase 0 keeps the existing client-loading pattern stable. Refactor these effects during the data/auth phases.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@calmboard/database",
              message: "The web application must call the API instead of importing the database package.",
            },
            {
              name: "drizzle-orm",
              message: "Drizzle belongs in the database package and server repository layers.",
            },
            {
              name: "pg",
              message: "PostgreSQL access is not allowed in the web application.",
            },
          ],
          patterns: [
            {
              group: ["@/db", "@/db/*", "@calmboard/database/*", "drizzle-orm/*", "pg/*"],
              message: "The web application must call the API instead of importing a database adapter.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx", "src/features/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@calmboard/database",
              message: "UI code must call an application/API boundary instead of importing the database package.",
            },
            {
              name: "drizzle-orm",
              message: "Drizzle belongs in the database and server repository layers.",
            },
            {
              name: "pg",
              message: "PostgreSQL access is not allowed in the web application.",
            },
          ],
          patterns: [
            {
              group: ["@/db", "@/db/*", "@calmboard/database/*", "drizzle-orm/*", "pg/*"],
              message: "UI code must call an application/API boundary instead of importing the web database adapter.",
            },
            {
              group: ["@/features/*/api", "@/features/*/public-api", "@/features/*/actions-api"],
              message:
                "UI components must use a feature hook or operation boundary instead of importing transport APIs.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "UI components must use a typed feature API service instead of calling fetch directly.",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
