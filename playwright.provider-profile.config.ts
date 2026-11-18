import { defineConfig } from "@playwright/test";

// Isolated local lane for the provider profile route (TRACE-156 / P2B). It runs the profile
// route spec against this worktree's own production build on its own port, so it cannot collide
// with the default lane (3103 / 55831), the gallery lane (3123) or the directory lane (3133). No
// fixture server is needed: the spec serves every public read itself and aborts every request
// outside the app's origin. The gallery stays on so the comparison images can be taken. The port
// fails closed if it is already in use.
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55851 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
//     MDS_CATALOG_ENABLED=1 npm run build
//   npx playwright test --config playwright.provider-profile.config.ts
const port = Number(process.env.PROVIDER_PROFILE_PORT ?? 3153);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "provider-profile-route.spec.ts",
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
      MDS_CATALOG_ENABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55851",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "mds-synthetic-anon-key",
    },
  }],
});
