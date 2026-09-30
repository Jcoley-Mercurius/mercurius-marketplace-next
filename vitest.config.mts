import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  // Mirrors tsconfig's "@/*" path, and stubs Next's bundled `server-only` guard, so server
  // modules and route handlers can be unit tested.
  resolve: { alias: { "@": path("./src"), "server-only": path("./tests/stubs/server-only.ts") } },
  test: { exclude: ["**/node_modules/**", "**/.next/**", "tests/e2e/**"], maxWorkers: 1 },
});
