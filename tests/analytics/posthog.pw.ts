import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { CONSENT_COOKIE } from "../../src/lib/analytics/policy";

type Event = { event: string; properties: Record<string, unknown> };
const host = "http://127.0.0.1:3104";

async function isolate(page: Page, options: { outage?: boolean } = {}) {
  const events: Event[] = [];
  const replays: string[] = [];
  const requests: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname.endsWith("posthog.com")) {
      requests.push(url.pathname);
      if (options.outage) return route.abort();
      if (/\/static\//.test(url.pathname)) return route.fulfill({ path: resolve("node_modules/posthog-js/dist/recorder.js"), contentType: "application/javascript" });
      if (/\/flags/.test(url.pathname)) return route.fulfill({ json: { featureFlags: {}, sessionRecording: { endpoint: "/s/", recorderVersion: "v2", sampleRate: "1", minimumDurationMilliseconds: 0, masking: { maskAllInputs: true, maskTextSelector: "*", blockSelector: "img" }, urlBlocklist: [{ url: ".*[?#].*", matching: "regex" }] } } });
      const buffer = request.postDataBuffer();
      if (buffer) {
        let data = buffer;
        if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
        const text = data.toString();
        try {
          const parsed = JSON.parse(text); const rows = Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed];
          for (const row of rows) { if (row.event === "$snapshot") replays.push(JSON.stringify(row)); else if (row.event) events.push(row); }
        } catch { /* The assertions below require readable captured outcomes, not request counts alone. */ }
      }
      return route.fulfill({ json: { status: 1 }, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    if (url.port === "55832") {
      if (url.pathname.includes("/auth/")) return route.fulfill({ status: 401, json: { message: "Synthetic visitor" } });
      return route.fulfill({ json: [], headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    }
    if (url.origin === host) return route.continue();
    return route.abort();
  });
  return { events, replays, requests };
}

test("no collection before consent; tagged campaign and navigation are redacted after opt-in; refusal stops future traffic", async ({ page }) => {
  const captured = await isolate(page);
  await page.goto("/faq?utm_source=facebook&utm_medium=paid-social&utm_campaign=lee-county&code=SECRET_CODE#access_token=SECRET_TOKEN");
  const panel = page.getByRole("region", { name: "Usage analytics preferences" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(captured.requests).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("ph_")))).toEqual([]);
  await panel.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect.poll(() => captured.events.some(event => event.event === "$pageview")).toBe(true);
  const view = captured.events.find(event => event.event === "$pageview")!;
  expect(view.properties).toMatchObject({ utm_source: "facebook", utm_medium: "paid-social", utm_campaign: "lee-county", $current_url: host + "/faq" });
  expect(JSON.stringify(captured.events)).not.toMatch(/SECRET_CODE|SECRET_TOKEN|access_token/);
  expect(captured.replays).toEqual([]);
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect.poll(() => captured.events.filter(event => event.event === "$pageview").length).toBe(2);
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await panel.getByRole("button", { name: "Decline analytics", exact: true }).click();
  const previous = captured.events.length;
  await page.getByRole("link", { name: "Terms of Service", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  expect(captured.events.length).toBe(previous);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("ph_") && !k.includes("opt_in_out")))).toEqual([]);
});

test("masked public replay excludes text and inputs, and never records the request form", async ({ page }) => {
  await page.context().addCookies([{ name: CONSENT_COOKIE, value: "v1-granted", url: host }]);
  const captured = await isolate(page);
  await page.goto("/faq");
  await expect.poll(() => captured.requests.some(path => path.includes("recorder"))).toBe(true);
  await page.evaluate(() => {
    const element = document.createElement("section");
    element.innerHTML = '<p>PRIVATE_REPLAY_TEXT</p><input value="PRIVATE_REPLAY_INPUT"><img src="/PRIVATE_REPLAY_IMAGE.png">';
    document.querySelector("main")!.appendChild(element);
    element.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Trigger a new snapshot before navigating, then wait for the SDK's recording batch.
  await page.getByRole("heading", { level: 1 }).click();
  await expect.poll(() => captured.replays.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(captured.replays.join("\n")).not.toMatch(/PRIVATE_REPLAY_TEXT|PRIVATE_REPLAY_INPUT|PRIVATE_REPLAY_IMAGE/);
  await page.goto("/login?redirect=%2Frequest&code=PRIVATE_AUTH_CODE");
  await page.getByLabel("Email", { exact: true }).fill("private-person@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("PRIVATE_PASSWORD_SENTINEL");
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
  expect(captured.replays.join("\n")).not.toMatch(/private-person|PRIVATE_PASSWORD|PRIVATE_AUTH_CODE/);
  expect(JSON.stringify(captured.events)).not.toMatch(/private-person|PRIVATE_PASSWORD|PRIVATE_AUTH_CODE/);
});

test("browser privacy signals keep tracking off and preferences are usable at 320px", async ({ page }) => {
  const captured = await isolate(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  await page.context().addCookies([{ name: CONSENT_COOKIE, value: "v1-granted", url: host }]);
  await page.goto("/faq");
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  const panel = page.getByRole("region", { name: "Usage analytics preferences" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Allow analytics", exact: true })).toBeDisabled();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('section[aria-label="Usage analytics preferences"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(captured.requests).toEqual([]);
  await page.screenshot({ path: "test-results/posthog-preferences-320.png", fullPage: false });
});

test("a blocked analytics service cannot stop browsing", async ({ page }) => {
  await isolate(page, { outage: true });
  await page.goto("/faq");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
});
