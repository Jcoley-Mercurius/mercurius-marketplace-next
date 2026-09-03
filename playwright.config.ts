import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3103",
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: [{
    command: "node tests/fixtures/portal-server.mjs",
    url: "http://127.0.0.1:55831/health",
    reuseExistingServer: false,
  }, {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3103",
    url: "http://127.0.0.1:3103/mds",
    reuseExistingServer: false,
    env: {
      MDS_CATALOG_ENABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55831",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "mds-synthetic-anon-key",
    },
  }],
});
