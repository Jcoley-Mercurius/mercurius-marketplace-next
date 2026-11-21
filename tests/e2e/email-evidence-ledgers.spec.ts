// TRACE-155 (Phase 7.3C-2): synthetic browser evidence for the application-email evidence on
// Recruiting and the price-notice evidence on the price-draft panel. The evidence RPCs are served
// per test; by default the fixture server answers as production does until 7.3D (rule 10,
// receiver unarmed, zero counts). The database contract itself is SQL 124.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const APP = { failed: "00000000-0000-4000-8000-000000000050", unknown: "00000000-0000-4000-8000-000000000051", sent: "00000000-0000-4000-8000-000000000052" };

type Summary = { rule: number; delivered_fact: boolean; non_delivery_proven: boolean; needs_review: boolean; reported: string[] };
const summaryFor = (rule: number, reported: string[] = []): Summary => ({
  rule, reported, delivered_fact: [1, 2, 3, 4].includes(rule), non_delivery_proven: rule === 5, needs_review: [1, 2, 3, 5, 6].includes(rule),
});
const report = (fact: string, extra: Record<string, unknown> = {}) =>
  ({ fact, provider_created_at: "2026-11-18T15:00:00+00:00", bounce_type: null, bounce_subtype: null, excluded: null, ...extra });
const rowEvidence = (rule: number, extra: Record<string, unknown> = {}) =>
  ({ attempt: 1, summary: summaryFor(rule), has_conflict: false, conflict_reasons: [], attempts: [], ...extra });
const counts = (extra: { ledger?: Record<string, number>; armed?: boolean } = {}) => ({
  checked_at: "2026-11-19T16:00:00+00:00",
  ledger: { not_delivered: 0, to_review: 0, conflicting_rows: 0, ...extra.ledger },
  all_emails: { receiver_armed: extra.armed ?? false, conflicting_reports: { conflict_disagree: 1, conflict_id_ambiguous: 0, conflict_tag_invalid: 2, content_conflict: 1 },
    unmatched_reports: { total: 5, by_type: { "email.delivered": 5 } }, retention_backlog: { expired: 2, expired_over_cap: false, oldest_expires_at: "2026-11-10T12:00:00+00:00" } },
});

const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, json: value });

async function open(page: Page, path: string, theme = "light", width = 1440, role: "admin" | "vendor" = "admin") {
  await syntheticSession(page.context(), role);
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

const count = (page: Page, term: string) =>
  page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term.replace(/[()]/g, "\\$&")}$`) }) }).locator("dd");
/** S-50 over every evidence block: no label says Delivered, Received, Read or Confirmed alone, and nothing says "later". */
async function evidenceWordingIsTruthful(page: Page) {
  const text = (await page.locator("[data-testid=delivery-evidence]").allInnerTexts()).join("\n");
  expect(text).not.toMatch(/\b(Delivered|Received|Read|Confirmed)\b/);
  expect(text).not.toMatch(/\blater\b/i);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

// Recruiting ---------------------------------------------------------------------------------

const applications = (page: Page) => page.getByRole("list", { name: "Application emails" }).getByRole("listitem");
const appRow = (page: Page, name: string) => applications(page).filter({ hasText: name });

test("Recruiting: unarmed, each visible application email reads rule 10, with scoped counts", async ({ page }) => {
  const calls: string[][] = [];
  await page.route("**/rpc/application_email_evidence", async (route) => {
    calls.push((route.request().postDataJSON() as { p_applications: string[] }).p_applications);
    await route.fallback();
  });
  await open(page, "/admin/recruiting");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recruiting readiness");
  for (const name of ["Synthetic Applicant Services", "Synthetic Uncertain Services"]) {
    await expect(appRow(page, name)).toContainText("Delivery evidence: Delivery evidence not available");
  }
  await expect(page.getByText("No coverage window is recorded for Resend delivery reports, so emails without a report show “Delivery evidence not available”.")).toBeVisible();
  await expect(page.getByText("Application emails", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("All Mercurius emails", { exact: true })).toBeVisible();
  await expect(count(page, "Applications with conflicting provider reports")).toHaveText("0");
  // Exactly the visible rows: the two needing attention, then the third when shown.
  expect(calls).toEqual([[APP.failed, APP.unknown]]);
  await page.getByRole("button", { name: "Show all 3 applications" }).click();
  await expect(appRow(page, "Synthetic Delivered Services")).toContainText("Delivery evidence: Delivery evidence not available");
  expect(calls).toEqual([[APP.failed, APP.unknown], [APP.sent]]);
  // The existing attention summary and actions are unchanged.
  await expect(page.getByText("Application emails needing attention")).toBeVisible();
  await expect(appRow(page, "Synthetic Applicant Services").getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(appRow(page, "Synthetic Delivered Services").getByRole("button", { name: "Resend email" })).toHaveCount(0);
  await expect(page.getByText("Provider report history")).toHaveCount(0);
});

function recruitingEvidence() {
  return {
    [APP.failed]: rowEvidence(5, { summary: summaryFor(5, ["bounced_permanent"]), attempts: [{ attempt: 1, ...summaryFor(5, ["bounced_permanent"]), has_conflict: false,
      reports: [report("bounced_permanent", { bounce_type: "permanent", bounce_subtype: "no_email" })] }] }),
    [APP.unknown]: rowEvidence(10, { attempt: 2, has_conflict: true, conflict_reasons: ["current_conflict", "stored_conflict"], attempts: [
      { attempt: 1, ...summaryFor(10), has_conflict: true, reports: [
        report("delivered", { excluded: "current_conflict" }),
        report("delivered", { excluded: "stored_conflict", provider_created_at: null })] }] }),
    [APP.sent]: rowEvidence(4, { attempts: [{ attempt: 1, ...summaryFor(4), has_conflict: false, reports: [report("delivered")] }] }),
  };
}

test("Recruiting: summaries, both conflict wordings and the per-attempt history; actions unchanged", async ({ page }) => {
  const evidence = recruitingEvidence();
  await page.route("**/rpc/application_email_evidence", (route) => json(route, { checked_at: "2026-11-19T16:00:00+00:00",
    items: (route.request().postDataJSON() as { p_applications: string[] }).p_applications.map((id) => ({ application_id: id, ...evidence[id as keyof typeof evidence] })) }));
  await page.route("**/rpc/application_email_evidence_counts", (route) => json(route, counts({ ledger: { not_delivered: 0, to_review: 0, conflicting_rows: 1 }, armed: true })));
  await open(page, "/admin/recruiting");
  await page.getByRole("button", { name: "Show all 3 applications" }).click();
  await expect(appRow(page, "Synthetic Applicant Services")).toContainText("Delivery evidence: Not delivered: Resend reported a permanent bounce");
  const uncertain = appRow(page, "Synthetic Uncertain Services");
  await expect(uncertain).toContainText("Delivery evidence (attempt 2): Delivery evidence not available");
  await expect(uncertain).toContainText("Conflicting provider report — excluded from this summary.");
  await expect(uncertain).toContainText("excluded while current email records disagree with it. If the conflicting record is removed, this report can count again.");
  await expect(appRow(page, "Synthetic Delivered Services")).toContainText("Delivery evidence: Handed to the recipient's mail server. Not proof it reached the inbox or was read");
  // History is closed until opened.
  await expect(uncertain.getByText("Excluded while current email records disagree with it", { exact: true })).toBeHidden();
  await uncertain.getByText("Provider report history").click();
  await expect(uncertain).toContainText("Attempt 1: Delivery evidence not available");
  await expect(uncertain.getByText(/Provider time not given · Excluded: conflicting report/)).toBeVisible();
  await expect(uncertain.getByText("Excluded while current email records disagree with it", { exact: true })).toBeVisible();
  await appRow(page, "Synthetic Applicant Services").getByText("Provider report history").click();
  await expect(appRow(page, "Synthetic Applicant Services")).toContainText("Permanent bounce reported (no such mailbox)");
  // Evidence adds and removes no action; armed, so no "no coverage window" notice.
  await expect(uncertain.getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(uncertain.getByRole("button", { name: "Acknowledge" })).toBeVisible();
  await expect(appRow(page, "Synthetic Delivered Services").getByRole("button", { name: "Resend email" })).toHaveCount(0);
  await expect(page.getByText("No coverage window is recorded for Resend delivery reports", { exact: false })).toHaveCount(0);
  await expect(count(page, "Applications with conflicting provider reports")).toHaveText("1");
  await expect(count(page, "Conflicting provider reports (all emails)")).toHaveText("4");
  await expect(count(page, "Unmatched provider reports")).toHaveText("5");
  await expect(count(page, "Expired reports awaiting deletion")).toHaveText("2");
  await expect(page.getByText(/Oldest expired report: Nov 10, 2026/)).toBeVisible();
  await evidenceWordingIsTruthful(page);
});

test("Recruiting: more than 100 visible rows are read in batches of at most 100", async ({ page }) => {
  const ids = Array.from({ length: 230 }, (_, i) => `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`);
  await page.route("**/rpc/r0_application_notification_overview", (route) => json(route, { checked_at: "2026-11-19T16:00:00+00:00", stale_after_minutes: 10,
    items: ids.map((id, i) => ({ application_id: id, business_name: `Synthetic Batch ${i}`, application_status: "pending", submitted_at: "2026-11-19T15:00:00+00:00",
      state: "failed", attempts: 1, last_error: null, sent_at: null, requested_at: null, acknowledged_at: null, acknowledged_reason: null,
      updated_at: "2026-11-19T15:00:00+00:00", needs_attention: true })) }));
  const calls: string[][] = [];
  await page.route("**/rpc/application_email_evidence", (route) => {
    const batch = (route.request().postDataJSON() as { p_applications: string[] }).p_applications;
    calls.push(batch);
    return json(route, { checked_at: "2026-11-19T16:00:00+00:00", items: batch.map((id) => ({ application_id: id, ...rowEvidence(10) })) });
  });
  await open(page, "/admin/recruiting");
  await expect(applications(page)).toHaveCount(230);
  await expect(applications(page).last()).toContainText("Delivery evidence: Delivery evidence not available");
  expect(calls.map((batch) => batch.length).sort((a, b) => b - a)).toEqual([100, 100, 30]);
  expect(calls.flat().sort()).toEqual([...ids].sort());
});

test("Recruiting: a response for an earlier load is discarded", async ({ page }) => {
  let call = 0;
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/rpc/application_email_evidence", async (route) => {
    const n = ++call;
    const batch = (route.request().postDataJSON() as { p_applications: string[] }).p_applications;
    if (n === 1) await first;
    return json(route, { checked_at: "2026-11-19T16:00:00+00:00",
      items: batch.map((id) => ({ application_id: id, ...rowEvidence(n === 1 ? 4 : 5, { summary: summaryFor(n === 1 ? 4 : 5, n === 1 ? [] : ["provider_failed"]) }) })) });
  });
  await open(page, "/admin/recruiting");
  await expect.poll(() => call).toBe(1);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(appRow(page, "Synthetic Applicant Services")).toContainText("Not delivered: Resend reported a failure");
  releaseFirst();
  await page.waitForTimeout(300);
  await expect(appRow(page, "Synthetic Applicant Services")).toContainText("Not delivered: Resend reported a failure");
  await expect(appRow(page, "Synthetic Applicant Services")).not.toContainText("Handed to the recipient's mail server");
});

test("Recruiting: failed evidence and counts reads leave the list and its actions unchanged", async ({ page }) => {
  await page.route("**/rpc/application_email_evidence", (route) => json(route, { code: "XX000", message: "Synthetic evidence outage" }, 500));
  await page.route("**/rpc/application_email_evidence_counts", (route) => json(route, { code: "XX000", message: "Synthetic counts outage" }, 500));
  await open(page, "/admin/recruiting");
  await expect(page.getByRole("alert").filter({ hasText: "Delivery evidence could not be loaded. The email states and actions below are unaffected." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Delivery evidence counts could not be loaded." })).toBeVisible();
  await expect(appRow(page, "Synthetic Applicant Services")).not.toContainText("Delivery evidence:");
  await expect(appRow(page, "Synthetic Applicant Services").getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(appRow(page, "Synthetic Applicant Services").getByRole("button", { name: "Acknowledge" })).toBeVisible();
  await expect(page.getByText("Application emails needing attention")).toBeVisible();
  await expect(page.getByText("Synthetic evidence outage")).toHaveCount(0);
});

test("Recruiting: the history disclosure is keyboard operable", async ({ page }) => {
  const evidence = recruitingEvidence();
  await page.route("**/rpc/application_email_evidence", (route) => json(route, { checked_at: "2026-11-19T16:00:00+00:00",
    items: (route.request().postDataJSON() as { p_applications: string[] }).p_applications.map((id) => ({ application_id: id, ...evidence[id as keyof typeof evidence] })) }));
  await open(page, "/admin/recruiting");
  const disclosure = appRow(page, "Synthetic Applicant Services").locator("summary", { hasText: "Provider report history" });
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(appRow(page, "Synthetic Applicant Services").getByText("Attempt 1: Not delivered: Resend reported a permanent bounce")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(appRow(page, "Synthetic Applicant Services").getByText("Attempt 1: Not delivered: Resend reported a permanent bounce")).toBeHidden();
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`Recruiting evidence ${theme} ${width}px is accessible with history open`, async ({ page }) => {
      const evidence = recruitingEvidence();
      await page.route("**/rpc/application_email_evidence", (route) => json(route, { checked_at: "2026-11-19T16:00:00+00:00",
        items: (route.request().postDataJSON() as { p_applications: string[] }).p_applications.map((id) => ({ application_id: id, ...evidence[id as keyof typeof evidence] })) }));
      await page.route("**/rpc/application_email_evidence_counts", (route) => json(route, counts()));
      await open(page, "/admin/recruiting", theme, width);
      await page.getByRole("button", { name: "Show all 3 applications" }).click();
      for (const name of ["Synthetic Applicant Services", "Synthetic Uncertain Services", "Synthetic Delivered Services"]) {
        await appRow(page, name).getByText("Provider report history").click();
      }
      await expect(appRow(page, "Synthetic Uncertain Services")).toContainText("Attempt 1: Delivery evidence not available");
      await accessible(page);
    });
  }
}

test("Recruiting: non-operator sessions see no evidence", async ({ page }) => {
  await open(page, "/admin/recruiting", "light", 1440, "vendor");
  await expect(page.getByRole("heading", { name: "Recruiting readiness" })).toHaveCount(0);
  await expect(page.getByText("Delivery evidence from Resend")).toHaveCount(0);
});

// Price drafts ---------------------------------------------------------------------------------

const vendorB = "00000000-0000-4000-8000-000000000082";
const draftId = "00000000-0000-4000-8000-000000000087";
const emailedDraft = { id: draftId, contractor_id: vendorB, contractor_name: "Synthetic Roof Co", service_id: "synthetic-lawn", service_name: "Lawn care",
  name: "Synthetic lawn plan", description: null, prices: [{ frequency: "monthly", price: 45 }],
  status: "draft", package_id: null, created_by_email: "operator@example.invalid", created_at: "2026-10-16T12:00:00+00:00", updated_at: "2026-10-16T12:00:00+00:00",
  revision: "b".repeat(64), approval_state: "sent", approval_current: false, sent_at: "2026-11-18T12:00:00+00:00",
  vendor_link: { linked: false, vendor_role: false, email_on_file: true, blocker: "No vendor account is bound to this provider" },
  delivery: { channel: "email", status: "emailed", email: "unknown", email_attempts: 1, email_sent_at: null, email_error: null } };
const draftNotices = [
  { current: true, queued_at: "2026-11-18T12:00:00+00:00", state: "unknown", ...rowEvidence(4, { attempts: [{ attempt: 1, ...summaryFor(4), has_conflict: false, reports: [report("delivered")] }] }) },
  { current: false, queued_at: "2026-11-17T12:00:00+00:00", state: "sent", ...rowEvidence(5, { summary: summaryFor(5, ["provider_suppressed"]),
    attempts: [{ attempt: 1, ...summaryFor(5, ["provider_suppressed"]), has_conflict: false, reports: [report("provider_suppressed")] }] }) },
  { current: false, queued_at: "2026-11-16T12:00:00+00:00", state: "sent", ...rowEvidence(10) },
];

async function openDrafts(page: Page, options: { evidence?: unknown; evidenceStatus?: number; countsStatus?: number; theme?: string; width?: number; path?: string } = {}) {
  await page.route("**/rest/v1/vendor_packages?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/contractors?*", (route) => route.fulfill({ json: [{ id: vendorB, name: "Synthetic Roof Co" }] }));
  await page.route("**/rest/v1/services_catalog?*", (route) => route.fulfill({ json: [
    { id: "synthetic-lawn", name: "Lawn care", default_frequency: "monthly", available_frequencies: ["monthly"] }] }));
  await page.route("**/rest/v1/package_tiers?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/package_addons?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_template_addons?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/rpc/admin_package_contents", (route) => route.fulfill({ json: [] }));
  await page.route("**/rpc/admin_package_drafts", (route) => route.fulfill({ json: [emailedDraft] }));
  const calls: unknown[] = [];
  await page.route("**/rpc/package_draft_email_evidence", (route) => {
    calls.push(route.request().postDataJSON());
    return options.evidenceStatus ? json(route, { code: "XX000", message: "Synthetic evidence outage" }, options.evidenceStatus)
      : json(route, { checked_at: "2026-11-19T16:00:00+00:00", items: options.evidence ?? [{ draft_id: draftId, notices: draftNotices }] });
  });
  await page.route("**/rpc/package_draft_email_evidence_counts", (route) => options.countsStatus
    ? json(route, { code: "XX000", message: "Synthetic counts outage" }, options.countsStatus)
    : json(route, counts({ ledger: { not_delivered: 1, to_review: 0, conflicting_rows: 0 } })));
  await open(page, options.path ?? "/admin/vendor-prices", options.theme, options.width);
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Prices" })).toBeVisible();
  return calls;
}
const draftItem = (page: Page) => page.getByRole("list", { name: "Draft prices" }).getByRole("listitem").first();

test("Price drafts: the sent revision's notice and an earlier revision's notice each carry their own evidence", async ({ page }) => {
  const calls = await openDrafts(page);
  const item = draftItem(page);
  await expect(item).toContainText("Email notice delivery evidence: Handed to the recipient's mail server. Not proof it reached the inbox or was read");
  await expect(item).toContainText("Earlier revision's email notice (queued Nov 17, 2026");
  await expect(item).toContainText("Not delivered: Resend reported suppression");
  // An earlier notice without reports or conflicts adds nothing.
  await expect(item.getByText(/queued Nov 16, 2026/)).toHaveCount(0);
  // The existing email state and its resend are unchanged by evidence.
  await expect(item.getByText("Email result unknown", { exact: true })).toBeVisible();
  await expect(item.getByRole("button", { name: "Resend email" })).toBeVisible();
  await item.locator("summary", { hasText: "Provider report history" }).first().click();
  await expect(item).toContainText("Attempt 1: Handed to the recipient's mail server");
  expect(calls).toEqual([{ p_drafts: [draftId] }]);
  await expect(page.getByText("Price-approval email notices", { exact: true })).toBeVisible();
  await expect(count(page, "Not delivered (Resend reported)")).toHaveText("1");
  await expect(count(page, "Notices with conflicting provider reports")).toHaveText("0");
  await evidenceWordingIsTruthful(page);
});

test("Price drafts: a draft without notices shows no evidence; one vendor's view shows no ledger-wide counts", async ({ page }) => {
  await openDrafts(page, { evidence: [], path: `/admin/vendor-prices?vendor=${vendorB}` });
  await expect(draftItem(page)).toBeVisible();
  await expect(draftItem(page).locator("[data-testid=delivery-evidence]")).toHaveCount(0);
  await expect(page.getByText("Delivery evidence from Resend")).toHaveCount(0);
});

test("Price drafts: failed evidence and counts reads leave the drafts and their actions unchanged", async ({ page }) => {
  await openDrafts(page, { evidenceStatus: 500, countsStatus: 500 });
  await expect(page.getByRole("alert").filter({ hasText: "Email notice delivery evidence could not be loaded. The drafts and their actions below are unaffected." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Delivery evidence counts could not be loaded." })).toBeVisible();
  await expect(draftItem(page).getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(draftItem(page).getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic evidence outage")).toHaveCount(0);
});

for (const [theme, width] of [["light", 320], ["dark", 320], ["light", 1440], ["dark", 1440]] as const) {
  test(`Price-draft evidence ${theme} ${width}px is accessible with history open`, async ({ page }) => {
    await openDrafts(page, { theme, width });
    for (const summary of await draftItem(page).locator("summary", { hasText: "Provider report history" }).all()) await summary.click();
    await expect(draftItem(page)).toContainText("Attempt 1: Not delivered: Resend reported suppression");
    await accessible(page);
  });
}
