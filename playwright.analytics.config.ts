import { defineConfig } from "@playwright/test";

// Isolated synthetic lane. No hosted Supabase, email, payment or PostHog requests.
export default defineConfig({
  testDir: "./tests/analytics", testMatch: "**/*.pw.ts", workers: 1, retries: 0, timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3104", browserName: "chromium", reducedMotion: "reduce", trace: "retain-on-failure",
    // Exercise the real SDK's visitor path; production keeps its normal bot filter.
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3104",
    url: "http://127.0.0.1:3104/faq", reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55832", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key",
      NEXT_PUBLIC_POSTHOG_ENABLED: "1", NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_synthetic", NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com", NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED: "1",
    },
  },
});
