import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno Edge Functions run under a different runtime — they have their own typecheck.
    "supabase/functions/**",
    // k6 load test scripts are k6-runtime, not Node/browser.
    "tests/loadtest/**",
    // Generated types from Supabase.
    "src/lib/database.types.ts",
    // Legacy Prisma seed.
    "prisma/seed.ts",
  ]),
]);

export default eslintConfig;
