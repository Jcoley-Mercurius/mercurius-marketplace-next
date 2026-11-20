// TRACE-155 (Phase 7.3D-1): synthetic browser evidence for the Email evidence page: collection
// state, the audited start/stop controls, history, coverage meanings, retention and purge duty,
// and the test-probe control. The readback and commands are served per test; the probe route is
// the real built route, which is off by default (no EMAIL_EVIDENCE_PROBES_ENABLED), except where a
// test serves its answer. The database contract is SQL 125.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const OPERATOR = "00000000-0000-4000-8000-0000000a11ce";
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, json: value });

const retention = (extra: Record<string, unknown> = {}) => ({
  retained: 0, retained_linked: 0, retained_unlinked: 0, expired: 0, oldest_expired_expires_at: null, latest_expires_at: null,
  purge_duty: false, last_purge: null, ...extra,
});
const event = (seq: number, at: string, reason: string) => ({ seq, action: seq % 2 ? "arm" : "disarm", occurred_at: at, actor: OPERATOR, reason });
const NEVER = { checked_at: "2026-11-20T18:00:00+00:00", armed: false, armed_at: null, retry_horizon_seconds: 100800, history: [], intervals: [], retention: retention() };
const ARMED = {
  checked_at: "2026-11-20T18:00:00+00:00", armed: true, armed_at: "2026-11-20T17:00:00+00:00", retry_horizon_seconds: 100800,
  history: [event(1, "2026-11-18T15:00:00+00:00", "Synthetic rehearsal start"), event(2, "2026-11-19T15:00:00+00:00", "Synthetic rehearsal stop"),
    event(3, "2026-11-20T17:00:00+00:00", "Synthetic collection after registration")],
  intervals: [{ armed_from: "2026-11-18T15:00:00+00:00", disarmed_at: "2026-11-19T15:00:00+00:00" }, { armed_from: "2026-11-20T17:00:00+00:00", disarmed_at: null }],
  retention: retention({ retained: 5, retained_linked: 3, retained_unlinked: 2, purge_duty: true, latest_expires_at: "2027-02-18T17:00:00+00:00",
    last_purge: { ran_at: "2026-11-20T12:00:00+00:00", deleted: 2, remaining_expired: 0, remaining_over_cap: false } }),
};

async function open(page: Page, readback: () => unknown, options: { theme?: string; width?: number; role?: "admin" | "vendor" } = {}) {
  await page.route("**/rpc/email_evidence_arming_readback", (route) => json(route, readback()));
  await syntheticSession(page.context(), options.role ?? "admin");
  await page.addInitScript((value) => localStorage.setItem("theme", value), options.theme ?? "light");
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await page.goto("/admin/email-evidence");
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

for (const [theme, width] of [["light", 1440], ["dark", 1440], ["light", 320]] as const) {
  test(`never started (${theme}, ${width} px): state, empty history, coverage meanings and nothing stored; accessible`, async ({ page }) => {
    await open(page, () => NEVER, { theme, width });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Email evidence");
    await expect(page.getByTestId("collection-state")).toHaveText("Not collecting provider reports. Collection has never been started.");
    await expect(page.getByRole("button", { name: "Start collecting reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop collecting reports" })).toHaveCount(0);
    await expect(page.getByText("Collection has never been started.", { exact: true })).toBeVisible();
    await expect(page.getByText("Sent while reports were collected, but collection stopped within 28 hours, so a report may have been missed")).toBeVisible();
    await expect(page.getByText("Sent while provider reports were not being collected")).toBeVisible();
    await expect(page.getByTestId("purge-duty")).toHaveText("No provider reports are stored. There is nothing to purge.");
    await accessible(page);
  });
}

test("armed with history: newest first with reason and operator; purge duty continues with no expired reports", async ({ page }) => {
  await open(page, () => ARMED);
  await expect(page.getByTestId("collection-state")).toContainText("Collecting provider reports since Nov 20, 2026");
  const entries = page.getByRole("list", { name: "Collection history" }).getByRole("listitem");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("Collection started · Nov 20, 2026");
  await expect(entries.nth(0)).toContainText("Synthetic collection after registration");
  await expect(entries.nth(1)).toContainText("Collection stopped · Nov 19, 2026");
  await expect(entries.nth(2)).toContainText("Synthetic rehearsal start");
  await expect(entries.nth(0)).toContainText("Operator account …0a11ce");
  await expect(page.getByTestId("purge-duty")).toHaveText(/^No report has expired yet, but reports are still stored\. Keep running the operator purge/);
  await expect(page.getByText("Last purge Nov 20, 2026")).toContainText("2 deleted, 0 expired left.");
  await expect(page.getByRole("button", { name: "Stop collecting reports" })).toBeVisible();
  await accessible(page);
});

test("start collecting: attestation and reason are required; the command gets one trimmed line; the page reloads", async ({ page }) => {
  let state: unknown = NEVER;
  const sent: unknown[] = [];
  await page.route("**/rpc/email_evidence_arm", async (route) => {
    sent.push(route.request().postDataJSON());
    state = { ...ARMED, history: [event(1, "2026-11-20T18:01:00+00:00", "Synthetic start")], armed_at: "2026-11-20T18:01:00+00:00",
      intervals: [{ armed_from: "2026-11-20T18:01:00+00:00", disarmed_at: null }] };
    await json(route, { seq: 1, action: "arm", armed: true, occurred_at: "2026-11-20T18:01:00+00:00" });
  });
  await open(page, () => state);
  await page.getByRole("button", { name: "Start collecting reports" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("recording a start does neither");
  const confirm = dialog.getByRole("button", { name: "Start collecting" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Reason/).fill("  Synthetic\nstart  ");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/The owner has authorized arming/).check();
  await confirm.click();
  await expect(page.getByTestId("collection-state")).toContainText("Collecting provider reports since");
  expect(sent).toEqual([{ p_reason: "Synthetic start" }]);
  await expect(page.getByRole("list", { name: "Collection history" }).getByRole("listitem")).toHaveCount(1);
});

test("stop collecting: a database refusal is shown in the dialog and nothing changes", async ({ page }) => {
  await page.route("**/rpc/email_evidence_disarm", (route) =>
    json(route, { code: "55000", message: "Delivery evidence is not armed", details: null, hint: null }, 400));
  await open(page, () => ARMED);
  await page.getByRole("button", { name: "Stop collecting reports" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Stored reports stay until purged");
  await dialog.getByLabel(/Reason/).fill("Synthetic stop");
  await dialog.getByRole("button", { name: "Stop collecting" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Delivery evidence is not armed");
  await accessible(page);
});

test("test probe, real route: off by default, so nothing is sent; the request names only the choice", async ({ page }) => {
  const bodies: unknown[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/admin/email-evidence-probe")) bodies.push(request.postDataJSON()); });
  await open(page, () => NEVER);
  await page.getByRole("button", { name: "Send a test email" }).click();
  const dialog = page.getByRole("alertdialog");
  const options = dialog.getByLabel(/Test address/).locator("option");
  await expect(options).toHaveText(["Choose one", "Delivered test address", "Bounced test address", "Complained test address", "Suppressed test address"]);
  await dialog.getByLabel(/Test address/).selectOption("bounced");
  await dialog.getByRole("button", { name: "Send test" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Test probes are turned off on this deployment. Nothing was sent.");
  expect(bodies).toEqual([{ choice: "bounced" }]);
});

test("test probe, served answer: the verdict is transport evidence only; an undocumented address says so", async ({ page }) => {
  await page.route("http://127.0.0.1:3103/api/admin/email-evidence-probe", (route) => json(route, {
    state: "sent", choice: "suppressed", verdict: "expected_event_not_observed",
    readback: { checked_at: "2026-11-20T18:00:00+00:00", not_probe: false, receipts: [
      { event_type: "email.sent", fact: "accepted", bounce_type: null, bounce_subtype: null, provider_created_at: "2026-11-20T18:00:01+00:00", received_at: "2026-11-20T18:00:02+00:00", state: "unlinked" }] },
  }));
  await open(page, () => NEVER);
  await page.getByRole("button", { name: "Send a test email" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel(/Test address/).selectOption("suppressed");
  await dialog.getByRole("button", { name: "Send test" }).click();
  const result = page.getByTestId("probe-result");
  await expect(result).toContainText("Suppressed test address: Provider reports received, but not the expected one");
  await expect(result).toContainText("Which report this address produces is not documented");
  await expect(result).toContainText("Accepted by Resend for delivery · Provider time Nov 20, 2026");
  await accessible(page);
});

test("test probe, provider failure: reported once, never retried", async ({ page }) => {
  let calls = 0;
  await page.route("http://127.0.0.1:3103/api/admin/email-evidence-probe", (route) => {
    calls += 1;
    return json(route, { state: "unknown", message: "The test email's result is unknown. It was not retried; check the Resend log before trying again." }, 502);
  });
  await open(page, () => NEVER);
  await page.getByRole("button", { name: "Send a test email" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel(/Test address/).selectOption("delivered");
  await dialog.getByRole("button", { name: "Send test" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The test email's result is unknown. It was not retried; check the Resend log before trying again.");
  await expect(page.getByTestId("probe-result")).toHaveText("");
  expect(calls).toBe(1);
});

test("non-operators cannot open the page", async ({ page }) => {
  let reads = 0;
  await page.route("**/rpc/email_evidence_arming_readback", (route) => { reads += 1; return route.fallback(); });
  await open(page, () => NEVER, { role: "vendor" });
  // The proxy or the admin layout turns the vendor away before the page mounts.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Email evidence" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start collecting reports" })).toHaveCount(0);
  expect(reads).toBe(0);
});

test("owner emails: rule 9 and 10 labels say what collection covered", async ({ page }) => {
  const summary = (rule: number, coverage: string) => ({ rule, coverage, delivered_fact: false, non_delivery_proven: false, needs_review: false, reported: [] });
  // The fixture server's three synthetic applications (failed, unknown, sent).
  const byApplication: Record<string, ReturnType<typeof summary>> = {
    "00000000-0000-4000-8000-000000000050": summary(9, "partial"),
    "00000000-0000-4000-8000-000000000051": summary(10, "gap"),
    "00000000-0000-4000-8000-000000000052": summary(9, "complete"),
  };
  await page.route("**/rpc/application_email_evidence", (route) => json(route, { checked_at: "2026-11-20T18:00:00+00:00",
    items: (route.request().postDataJSON() as { p_applications: string[] }).p_applications.map((id) => ({
      application_id: id, attempt: 1, has_conflict: false, conflict_reasons: [], attempts: [], summary: byApplication[id] })) }));
  await syntheticSession(page.context(), "admin");
  await page.goto("/admin/recruiting");
  await page.getByRole("button", { name: /Show all \d+ applications/ }).click();
  const list = page.getByRole("list", { name: "Application emails" });
  await expect(list).toContainText("No provider report received; collection stopped within 28 hours of sending, so a report may have been missed");
  await expect(list).toContainText("Delivery evidence not available: reports were not being collected when this was sent");
  await expect(list).toContainText("No provider report received in the 28 hours reports were collected after sending");
});
