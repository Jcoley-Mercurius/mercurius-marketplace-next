import { defineConfig } from "@playwright/test";

// Isolated local lane for the dynamic-profile review gallery. It runs only the gallery spec
// against this worktree's own production build on its own port, so it cannot collide with
// another session using the default lane (3103 / 55831). No fixture server is needed: the
// gallery reads no backend, and the spec aborts every request outside the app's origin.
// The port fails closed if it is already in use.
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
//     MDS_CATALOG_ENABLED=1 npm run build
//   npx playwright test --config playwright.profile-gallery.config.ts
const port = Number(process.env.PROFILE_GALLERY_PORT ?? 3123);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "profile-gallery.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: [{
    command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/mds/profiles`,
    reuseExistingServer: false,
    env: {
      MDS_CATALOG_ENABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55831",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "mds-synthetic-anon-key",
    },
  }],
});
