import { defineConfig } from "@playwright/test";

// Isolated local lane for the provider directory's cards (TRACE-156 / P2A). It runs only the
// directory spec against this worktree's own production build on its own port, so it cannot
// collide with another session using the default lane (3103 / 55831) or the gallery lane (3123).
// No fixture server is needed: the spec stubs every public read and aborts every request outside
// the app's origin. The port fails closed if it is already in use.
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55841 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
//     MDS_CATALOG_ENABLED=1 npm run build
//   npx playwright test --config playwright.provider-directory.config.ts
const port = Number(process.env.PROVIDER_DIRECTORY_PORT ?? 3133);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "provider-directory-cards.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: [{
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/providers`,
    reuseExistingServer: false,
    env: {
      // The directory is a public route; the gate only keeps the review gallery out of the build.
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55841",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "mds-synthetic-anon-key",
    },
  }],
});
