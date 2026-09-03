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
    "coverage/**",
    "next-env.d.ts",
    ".claude/**",
    ".agents/**",
    ".codex/**",
    "supabase/functions/**",
    "supabase/runtime-tests/**", // Checked separately by Deno.
    "supabase/.temp/**",
    "supabase/.audit/**",
    "supabase/.branches/**",
  ]),
]);

export default eslintConfig;
