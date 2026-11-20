// TRACE-154 (Phase 7.2C-1 and 7.2C-2): synthetic browser evidence for the Owner Emails page,
// with contact-submission and provider renewal-document rows. The overview,
// acknowledgement and contact-detail RPCs and the resend route are served from an in-memory
// store that applies the page's own keyset cursor, filter and limit, and mirrors the database's
// attestation and operator rules. The database contract itself is SQL 120.
// TRACE-155 (7.3C-1): the store also serves owner_email_evidence for the requested rows and
// owner_email_evidence_counts. By default every row reads rule 10 and the receiver is unarmed,
// as production does until 7.3D; the evidence contract itself is SQL 122.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const cors = { "access-control-allow-origin": "http://127.0.0.1:3103", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

// Sentinels: submitted content that must never reach the list.
const SENTINEL = { subject: "Sentinel subject do not list", message: "Sentinel message do not list", email: "sentinel.sender@example.test", name: "Sentinelfirst" };

type Kind = "contact_submission" | "renewal_document";
type Row = {
  kind: Kind; id: string; source_id: string; created_at: string; state: string; attempts: number;
  last_error_code: string | null; sent_at: string | null; acknowledged_at: string | null; acknowledged_reason: string | null;
};
const ATTENTION = ["failed", "missed", "unknown", "resend_requested"];
const sourceId = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// A larger n is older; every fifth pair shares a timestamp so ties cross page boundaries.
const at = (n: number) => new Date(Date.UTC(2026, 10, 12, 15, 0, 0) - Math.floor(n / 2) * 60_000).toISOString().replace("Z", "+00:00");
const row = (n: number, state: string, extra: Partial<Row> = {}): Row => ({
  kind: "contact_submission", id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`, source_id: sourceId(n), created_at: at(n), state,
  attempts: state === "missed" ? 0 : 1, last_error_code: state === "failed" ? "provider_refused" : state === "unknown" ? "provider_server_error" : null,
  sent_at: state === "sent" ? at(n) : null, acknowledged_at: state === "acknowledged" ? at(n) : null,
  acknowledged_reason: state === "acknowledged" ? "Read it in the admin" : null, ...extra,
});

const renewalRow = (n: number, state: string, extra: Partial<Row> = {}) => row(n, state, { kind: "renewal_document", ...extra });
const BUSINESS = "Synthetic Renewal Provider";

type Summary = { rule: number; delivered_fact: boolean; non_delivery_proven: boolean; needs_review: boolean; reported: string[] };
type Report = { fact: string; provider_created_at: string | null; bounce_type: string | null; bounce_subtype: string | null; excluded: string | null };
type EvidenceAttempt = Summary & { attempt: number; has_conflict: boolean; reports: Report[] };
type Evidence = { attempt: number; summary: Summary; has_conflict: boolean; conflict_reasons: string[]; attempts: EvidenceAttempt[] };
const summaryFor = (rule: number, reported: string[] = []): Summary => ({
  rule, reported, delivered_fact: [1, 2, 3, 4].includes(rule), non_delivery_proven: rule === 5, needs_review: [1, 2, 3, 5, 6].includes(rule),
});
const report = (fact: string, extra: Partial<Report> = {}): Report => ({ fact, provider_created_at: "2026-11-18T15:00:00+00:00", bounce_type: null, bounce_subtype: null, excluded: null, ...extra });
const ZERO_COUNTS = {
  checked_at: "2026-11-12T16:00:00+00:00", receiver_armed: false, not_delivered: 0, to_review: 0, conflicting_rows: 0,
  conflicting_reports: { conflict_disagree: 0, conflict_id_ambiguous: 0, conflict_tag_invalid: 0, content_conflict: 0 },
  unmatched_reports: { total: 0, by_type: {} }, retention_backlog: { expired: 0, expired_over_cap: false, oldest_expires_at: null },
};

class Store {
  rows: Row[];
  overviewCalls: Array<Record<string, unknown>> = [];
  detailCalls: Array<Record<string, unknown>> = [];
  ackCalls: Array<Record<string, unknown>> = [];
  resendCalls: Array<Record<string, unknown>> = [];
  failOverview = 0;
  holdOverview: Promise<void> | null = null;
  /** Holds only the next overview response (for stale-response checks). */
  holdNext: Promise<void> | null = null;
  detailRefusal: { status: number; code: string } | null = null;
  resendResponse: { status: number; body: Record<string, unknown> } = { status: 200, body: { state: "sent", message: "Resend accepted the email. Confirm it arrived in the owner inbox." } };
  evidenceCalls: Array<Record<string, unknown>> = [];
  countsCalls = 0;
  evidence: Record<string, Partial<Evidence>> = {};
  evidenceCounts: Record<string, unknown> = ZERO_COUNTS;
  failEvidence = false;
  failCounts = false;
  constructor(rows: Row[]) { this.rows = rows; }
  sorted() { return [...this.rows].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1)); }
  overview(body: Record<string, unknown>) {
    const limit = Math.min(100, Math.max(1, Number(body.p_limit ?? 50)));
    const settled = body.p_include_settled === true;
    const before = body.p_before_created_at as string | null;
    const beforeId = body.p_before_id as string | null;
    const kind = (body.p_kind ?? null) as Kind | null;
    const listed = this.sorted().filter((r) => (settled || ATTENTION.includes(r.state)) && (!kind || r.kind === kind)
      && (!before || r.created_at < before || (r.created_at === before && r.id < beforeId!)));
    const page = listed.slice(0, limit);
    const attention = (k?: Kind) => this.rows.filter((r) => ATTENTION.includes(r.state) && (!k || r.kind === k)).length;
    return {
      checked_at: "2026-11-12T16:00:00+00:00", stale_after_minutes: 10, limit,
      attention_count: { total: attention(), contact_submission: attention("contact_submission"), renewal_document: attention("renewal_document") },
      next_cursor: listed.length > limit ? { created_at: page.at(-1)!.created_at, id: page.at(-1)!.id } : null,
      items: page.map((r) => ({
        kind: r.kind, source_id: r.source_id, label: r.kind === "contact_submission" ? "Contact submission" : `${BUSINESS} — License`,
        reference: r.source_id.slice(0, 8),
        submitted_at: r.created_at, state: r.state, attempts: r.attempts, last_error_code: r.last_error_code, sent_at: r.sent_at,
        requested_at: null, acknowledged_at: r.acknowledged_at, acknowledged_reason: r.acknowledged_reason,
        needs_attention: ATTENTION.includes(r.state),
      })),
    };
  }
  async rpc(route: Route) {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const name = new URL(request.url()).pathname.split("/").pop();
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const json = (status: number, value: unknown) => route.fulfill({ status, headers: cors, json: value });
    if (name === "owner_email_overview") {
      this.overviewCalls.push(body);
      if (this.holdOverview) await this.holdOverview;
      if (this.holdNext) { const held = this.holdNext; this.holdNext = null; await held; }
      if (this.failOverview > 0) { this.failOverview -= 1; return json(500, { code: "XX000", message: "Synthetic outage" }); }
      return json(200, this.overview(body));
    }
    if (name === "owner_email_evidence") {
      this.evidenceCalls.push(body);
      if (this.failEvidence) return json(500, { code: "XX000", message: "Synthetic evidence outage" });
      const sources = (body.p_sources ?? []) as string[];
      return json(200, {
        checked_at: "2026-11-12T16:00:00+00:00",
        items: this.rows.filter((r) => sources.includes(r.source_id)).map((r) => ({
          kind: r.kind, source_id: r.source_id, attempt: r.attempts, summary: summaryFor(10), has_conflict: false, conflict_reasons: [], attempts: [],
          ...this.evidence[r.source_id],
        })),
      });
    }
    if (name === "owner_email_evidence_counts") {
      this.countsCalls += 1;
      if (this.failCounts) return json(500, { code: "XX000", message: "Synthetic counts outage" });
      return json(200, this.evidenceCounts);
    }
    if (name === "owner_email_contact_submission") {
      this.detailCalls.push(body);
      if (this.detailRefusal) return json(this.detailRefusal.status, { code: this.detailRefusal.code, message: "Onboarding operator required" });
      return json(200, {
        id: body.p_source, submitted_at: "2026-11-12T14:59:00+00:00", first_name: SENTINEL.name, last_name: "Sender",
        email: SENTINEL.email, phone: null, subject: SENTINEL.subject, message: `${SENTINEL.message}\nSecond line.`,
      });
    }
    if (name === "owner_email_acknowledge") {
      this.ackCalls.push(body);
      const target = this.rows.find((r) => r.source_id === body.p_source)!;
      if (["missed", "unknown"].includes(target.state) && body.p_inbox_checked !== true) {
        return json(400, { code: "55000", message: "Check the owner inbox and the Resend log before acknowledging an uncertain email" });
      }
      target.state = "acknowledged";
      target.acknowledged_at = "2026-11-12T16:01:00+00:00";
      target.acknowledged_reason = String(body.p_reason);
      return json(200, { state: "acknowledged" });
    }
    return json(404, { message: "unexpected rpc" });
  }
  async resend(route: Route) {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.resendCalls.push(body);
    if (this.resendResponse.status === 200) {
      const target = this.rows.find((r) => r.source_id === body.sourceId);
      if (target) { target.state = "sent"; target.sent_at = "2026-11-12T16:02:00+00:00"; target.attempts += 1; }
    }
    return route.fulfill({ status: this.resendResponse.status, json: this.resendResponse.body });
  }
}

function fixture() {
  // 130 needing attention (100 failed, 15 missed, 15 unknown) and 20 settled.
  return [
    ...Array.from({ length: 100 }, (_, i) => row(i + 1, "failed")),
    ...Array.from({ length: 15 }, (_, i) => row(i + 101, "missed")),
    ...Array.from({ length: 15 }, (_, i) => row(i + 116, "unknown")),
    ...Array.from({ length: 10 }, (_, i) => row(i + 131, "sent")),
    ...Array.from({ length: 10 }, (_, i) => row(i + 141, "acknowledged")),
  ];
}

async function open(page: Page, store: Store, options: { role?: "admin" | "vendor"; theme?: string; width?: number } = {}) {
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.fallback() : route.abort();
  });
  await page.route("http://127.0.0.1:55831/rest/v1/rpc/owner_email_*", (route) => store.rpc(route));
  await page.route("http://127.0.0.1:3103/api/admin/owner-emails", (route) => store.resend(route));
  await syntheticSession(page.context(), options.role ?? "admin");
  await page.addInitScript((value) => localStorage.setItem("theme", value), options.theme ?? "light");
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await page.goto("/admin/owner-emails");
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

const rows = (page: Page) => page.getByRole("list", { name: "Owner emails" }).getByRole("listitem");
const summary = (page: Page, term: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term}$`) }) }).locator("dd");
const rowFor = (page: Page, n: number) => rows(page).filter({ hasText: `Ref ${sourceId(n).slice(0, 8)}` });

test("exact count with bounded pages, Load older, and no submitted content in the list", async ({ page }) => {
  const store = new Store(fixture());
  await open(page, store);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Owner emails");
  await expect(page.getByText("Owner emails needing attention")).toBeVisible();
  await expect(summary(page, "Total")).toHaveText("130");
  await expect(summary(page, "Contact form")).toHaveText("130");
  await expect(summary(page, "Renewal documents")).toHaveText("0");
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText("Showing 50 of 130 needing attention")).toBeVisible();
  await expect(rows(page).first()).toContainText("Contact submission");
  await expect(rows(page).first()).toContainText(`Ref ${sourceId(1).slice(0, 8)}`);
  await expect(page.getByText("Messages and documents saved before email tracking began are not listed here and cannot be resent.")).toBeVisible();

  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(100);
  await expect(page.getByText("Showing 100 of 130 needing attention")).toBeVisible();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(130);
  await expect(page.getByRole("button", { name: "Load older" })).toHaveCount(0);
  await expect(page.getByText(/Showing \d+ of 130/)).toHaveCount(0);
  // Each page followed the previous page's cursor; none was skipped or repeated.
  expect(store.overviewCalls.map((call) => [call.p_limit, call.p_before_created_at === null])).toEqual([[50, true], [50, false], [50, false]]);
  const refs = await rows(page).locator("span.font-mono").allTextContents();
  expect(new Set(refs).size).toBe(130);

  const text = await page.locator("main").innerText();
  for (const value of Object.values(SENTINEL)) expect(text).not.toContain(value);
  expect(store.detailCalls).toHaveLength(0);
});

test("show all resets to the first page; settled rows have no actions", async ({ page }) => {
  const store = new Store(fixture());
  await open(page, store);
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(100);
  const toggle = page.getByRole("button", { name: "Show all tracked emails" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Show only emails needing attention" })).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(50);
  expect(store.overviewCalls.at(-1)).toMatchObject({ p_include_settled: true, p_before_created_at: null, p_kind: null });
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(100);
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(150);
  await expect(page.getByRole("button", { name: "Load older" })).toHaveCount(0);
  const sent = rowFor(page, 131);
  await expect(sent.getByText("Accepted by Resend")).toBeVisible();
  await expect(sent.getByRole("button", { name: "Resend email" })).toHaveCount(0);
  await expect(sent.getByRole("button", { name: "View submission" })).toBeVisible();
  await expect(rowFor(page, 141)).toContainText("Reason: Read it in the admin");
});

test("labels each state and error category with its next action", async ({ page }) => {
  const store = new Store([
    row(1, "failed", { last_error_code: "provider_rate_limited" }),
    row(2, "failed", { last_error_code: "provider_not_configured" }),
    row(3, "unknown"),
    row(4, "missed"),
    row(5, "resend_requested"),
  ]);
  await open(page, store);
  await expect(rowFor(page, 1)).toContainText("Failed");
  await expect(rowFor(page, 1)).toContainText("Resend rate limit. Resend later.");
  await expect(rowFor(page, 2)).toContainText("Email is not configured. No email was sent. Configuration needs fixing before a resend.");
  await expect(rowFor(page, 3)).toContainText("Result unknown");
  await expect(rowFor(page, 3)).toContainText("Check the owner inbox and Resend log before resending.");
  await expect(rowFor(page, 4)).toContainText("No recorded attempt");
  await expect(rowFor(page, 4)).not.toContainText("Never sent");
  await expect(rowFor(page, 4)).toContainText("A previous release may have sent it.");
  await expect(rowFor(page, 5)).toContainText("Resend requested");
});

test("loading, error with retry, and both empty states", async ({ page }) => {
  const store = new Store([]);
  let release!: () => void;
  store.holdOverview = new Promise((resolve) => { release = resolve; });
  store.failOverview = 1;
  await open(page, store);
  await expect(page.getByText("Loading owner emails...")).toBeVisible();
  release();
  store.holdOverview = null;
  await expect(page.getByRole("heading", { name: "Owner emails could not be loaded" })).toBeVisible();
  await expect(page.getByText("Synthetic outage")).toBeVisible();
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No owner emails need attention." })).toBeVisible();
  await page.getByRole("button", { name: "Show all tracked emails" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No tracked owner emails yet." })).toBeVisible();
});

test("an uncertain resend needs the no-email attestation before it is sent; a failed one does not", async ({ page }) => {
  const store = new Store([row(1, "failed"), row(2, "unknown")]);
  await open(page, store);
  await rowFor(page, 2).getByRole("button", { name: "Resend email" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await expect(dialog).toContainText("An earlier email may already have arrived.");
  const confirm = dialog.getByRole("button", { name: "Resend", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "I checked the owner inbox and the Resend log and found no email for this submission." }).check();
  await expect(confirm).toBeEnabled();
  const overviewBefore = store.overviewCalls.length;
  await confirm.click();
  await expect(page.getByText("Resend recorded")).toBeVisible();
  expect(store.resendCalls).toEqual([{ kind: "contact_submission", sourceId: sourceId(2), confirmNoEmail: true }]);
  // The list reloads from the database after the action.
  await expect.poll(() => store.overviewCalls.length).toBeGreaterThan(overviewBefore);
  await expect(rowFor(page, 2)).toHaveCount(0);

  await rowFor(page, 1).getByRole("button", { name: "Resend email" }).click();
  const direct = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await expect(direct.getByRole("checkbox")).toHaveCount(0);
  await direct.getByRole("button", { name: "Resend", exact: true }).click();
  await expect.poll(() => store.resendCalls.length).toBe(2);
  expect(store.resendCalls[1]).toEqual({ kind: "contact_submission", sourceId: sourceId(1), confirmNoEmail: false });
});

test("a refused resend keeps the dialog open with the database message and claims nothing", async ({ page }) => {
  const store = new Store([row(1, "failed")]);
  store.resendResponse = { status: 409, body: { error: "This owner email cannot be resent from sending" } };
  await open(page, store);
  await rowFor(page, 1).getByRole("button", { name: "Resend email" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await dialog.getByRole("button", { name: "Resend", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This owner email cannot be resent from sending");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(page.getByText("Email was not resent")).toBeVisible();
  await expect(page.getByText("Resend recorded")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(rowFor(page, 1)).toContainText("Failed");
});

test("acknowledging an uncertain email needs a reason and the inbox-check attestation, and works when the email was found", async ({ page }) => {
  const store = new Store([row(1, "missed"), row(2, "failed")]);
  await open(page, store);
  await rowFor(page, 1).getByRole("button", { name: "Acknowledge" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Acknowledge without email?" });
  await expect(dialog).toContainText("including if the email did arrive");
  const confirm = dialog.getByRole("button", { name: "Acknowledge", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("What you found and why no further email is needed").fill("Found it in the owner inbox; sent by the previous release");
  await expect(confirm).toBeDisabled();
  // The attestation is about checking, not about finding nothing.
  await dialog.getByRole("checkbox", { name: "I checked the owner inbox and the Resend log for this submission." }).check();
  await confirm.click();
  await expect(page.getByText("Acknowledged", { exact: true })).toBeVisible();
  expect(store.ackCalls).toEqual([{ p_kind: "contact_submission", p_source: sourceId(1), p_reason: "Found it in the owner inbox; sent by the previous release", p_inbox_checked: true }]);
  await expect(rowFor(page, 1)).toHaveCount(0);

  await rowFor(page, 2).getByRole("button", { name: "Acknowledge" }).click();
  const direct = page.getByRole("alertdialog", { name: "Acknowledge without email?" });
  await expect(direct.getByRole("checkbox")).toHaveCount(0);
  await expect(direct.getByRole("button", { name: "Acknowledge", exact: true })).toBeDisabled();
  await direct.getByLabel("Reason").fill("Read it here and replied");
  await direct.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect.poll(() => store.ackCalls.length).toBe(2);
  expect(store.ackCalls[1]).toMatchObject({ p_inbox_checked: false });
});

test("a lost resend response refreshes a committed uncertain outcome without retrying or claiming success", async ({ page }) => {
  const target = row(1, "failed");
  const store = new Store([target]);
  await open(page, store);
  await expect(rows(page)).toHaveCount(1);
  await page.route("http://127.0.0.1:3103/api/admin/owner-emails", async (route) => {
    store.resendCalls.push(route.request().postDataJSON());
    // The command committed, but the browser did not receive its response.
    target.state = "unknown";
    target.attempts += 1;
    target.last_error_code = "provider_timeout_or_network";
    await route.abort("failed");
  });
  const before = store.overviewCalls.length;
  await rowFor(page, 1).getByRole("button", { name: "Resend email" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await dialog.getByRole("button", { name: "Resend", exact: true }).click();
  await expect.poll(() => store.overviewCalls.length).toBeGreaterThan(before);
  await expect(dialog.getByRole("alert")).toContainText("Review the refreshed state");
  await expect(dialog.getByRole("checkbox")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Resend", exact: true })).toBeDisabled();
  await expect(page.getByText("Resend result unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Resend recorded", { exact: true })).toHaveCount(0);
  expect(store.resendCalls).toHaveLength(1);
  // The open alert dialog hides the background list from role selectors. Check the
  // refreshed row after closing it, as an operator would; keep the dialog checks above.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rowFor(page, 1)).toContainText("Result unknown");
});

test("a lost acknowledgement response reads back the committed state without claiming success", async ({ page }) => {
  const target = row(1, "failed");
  const store = new Store([target]);
  await open(page, store);
  await expect(rows(page)).toHaveCount(1);
  await page.route("http://127.0.0.1:55831/rest/v1/rpc/owner_email_acknowledge", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    store.ackCalls.push(route.request().postDataJSON());
    target.state = "acknowledged";
    target.acknowledged_at = "2026-11-12T16:01:00+00:00";
    target.acknowledged_reason = "Read the saved submission";
    await route.abort("failed");
  });
  const before = store.overviewCalls.length;
  await rowFor(page, 1).getByRole("button", { name: "Acknowledge" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Acknowledge without email?" });
  await dialog.getByLabel("Reason").fill("Read the saved submission");
  await dialog.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect.poll(() => store.overviewCalls.length).toBeGreaterThan(before);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("Acknowledged", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Acknowledgement not confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Not acknowledged", { exact: true })).toHaveCount(0);
  expect(store.ackCalls).toHaveLength(1);
});

test("contact detail loads only on demand, keeps the URL, and is discarded on close", async ({ page }) => {
  const store = new Store([row(1, "failed")]);
  await open(page, store);
  const url = page.url();
  await expect(rows(page)).toHaveCount(1);
  expect(store.detailCalls).toHaveLength(0);
  await rowFor(page, 1).getByRole("button", { name: "View submission" }).click();
  const dialog = page.getByRole("dialog", { name: "Contact submission" });
  await expect(dialog).toContainText(SENTINEL.subject);
  await expect(dialog).toContainText(SENTINEL.email);
  await expect(dialog).toContainText("Not provided");
  await expect(dialog).toContainText(`${SENTINEL.name} Sender`);
  expect(store.detailCalls).toEqual([{ p_source: sourceId(1) }]);
  expect(page.url()).toBe(url);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(SENTINEL.subject)).toHaveCount(0);
  expect(await page.content()).not.toContain(SENTINEL.message);
  expect(page.url()).toBe(url);
});

test("a refused detail request shows an access error and no content", async ({ page }) => {
  const store = new Store([row(1, "failed")]);
  store.detailRefusal = { status: 403, code: "42501" };
  await open(page, store);
  await rowFor(page, 1).getByRole("button", { name: "View submission" }).click();
  const dialog = page.getByRole("dialog", { name: "Contact submission" });
  await expect(dialog.getByRole("alert")).toHaveText("You do not have access to this submission.");
  await expect(dialog).not.toContainText(SENTINEL.subject);
});

test("Owner Emails sits under Trust & Support and is current", async ({ page }) => {
  await open(page, new Store([]));
  const nav = page.getByRole("navigation", { name: "admin navigation" });
  const link = nav.getByRole("link", { name: "Owner Emails" });
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(link).toHaveAttribute("href", "/admin/owner-emails");
});

test("non-admin sessions cannot open Owner Emails", async ({ page }) => {
  const store = new Store(fixture());
  await open(page, store, { role: "vendor" });
  // The proxy or the admin layout turns the vendor away before the page mounts.
  await expect(page.getByRole("heading", { name: "Owner emails" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Owner emails" })).toHaveCount(0);
  expect(store.overviewCalls).toHaveLength(0);
});

// 7.2C-2 ------------------------------------------------------------------------------------
function mixedFixture() {
  // 160 needing attention, alternating kinds so equal timestamps (pairs) cross kinds and page
  // boundaries: 80 contact and 80 renewal. Then 10 settled of each kind.
  return [
    ...Array.from({ length: 160 }, (_, i) => (i % 2 === 0 ? row : renewalRow)(i + 1, ["failed", "missed", "unknown", "resend_requested"][i % 4])),
    ...Array.from({ length: 10 }, (_, i) => row(i + 161, "sent")),
    ...Array.from({ length: 10 }, (_, i) => renewalRow(i + 171, "acknowledged")),
  ];
}

test("7.2C-2: mixed kinds show exact totals and per-kind counts; filters reset paging", async ({ page }) => {
  const store = new Store(mixedFixture());
  await open(page, store);
  await expect(summary(page, "Total")).toHaveText("160");
  await expect(summary(page, "Contact form")).toHaveText("80");
  await expect(summary(page, "Renewal documents")).toHaveText("80");
  const group = page.getByRole("group", { name: "Filter by email kind" });
  await expect(group.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText("Showing 50 of 160 needing attention")).toBeVisible();
  // Newest first with id tie-breaks: rows 1-49 and 51 (pairs share a timestamp), so 26 contact and 24 renewal.
  await expect(rows(page).filter({ hasText: "Renewal document" })).toHaveCount(24);
  await expect(rows(page).filter({ hasText: "Contact submission" })).toHaveCount(26);
  expect(store.overviewCalls.at(-1)).toMatchObject({ p_kind: null, p_before_created_at: null });

  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(100);
  await group.getByRole("button", { name: "Renewal documents" }).click();
  await expect(group.getByRole("button", { name: "Renewal documents" })).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(50);
  expect(store.overviewCalls.at(-1)).toMatchObject({ p_kind: "renewal_document", p_before_created_at: null, p_before_id: null });
  await expect(page.getByText("Showing 50 of 80 needing attention")).toBeVisible();
  await expect(rows(page).filter({ hasText: "Contact submission" })).toHaveCount(0);
  // The summary still reports every kind.
  await expect(summary(page, "Total")).toHaveText("160");

  await group.getByRole("button", { name: "Contact form" }).click();
  await expect(rows(page)).toHaveCount(50);
  expect(store.overviewCalls.at(-1)).toMatchObject({ p_kind: "contact_submission", p_before_created_at: null });
  await expect(page.getByText("Showing 50 of 80 needing attention")).toBeVisible();
  await expect(rows(page).filter({ hasText: BUSINESS })).toHaveCount(0);

  // Refresh also starts again from the first page of the current filter.
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(80);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(rows(page)).toHaveCount(50);
  expect(store.overviewCalls.at(-1)).toMatchObject({ p_kind: "contact_submission", p_before_created_at: null });
});

test("7.2C-2: keyset pages across tied timestamps and both kinds skip and repeat nothing", async ({ page }) => {
  const store = new Store(mixedFixture());
  await open(page, store);
  await page.getByRole("button", { name: "Show all tracked emails" }).click();
  await expect(rows(page)).toHaveCount(50);
  for (const expected of [100, 150, 180]) {
    await page.getByRole("button", { name: "Load older" }).click();
    await expect(rows(page)).toHaveCount(expected);
  }
  await expect(page.getByRole("button", { name: "Load older" })).toHaveCount(0);
  const refs = await rows(page).locator("span.font-mono").allTextContents();
  expect(new Set(refs).size).toBe(180);
  // Each request followed the previous page's last row.
  const pages = store.overviewCalls.slice(-4);
  expect(pages.map((call) => call.p_before_created_at === null)).toEqual([true, false, false, false]);
});

test("7.2C-2: a response for an earlier filter is discarded", async ({ page }) => {
  const store = new Store(mixedFixture());
  await open(page, store);
  await expect(rows(page)).toHaveCount(50);
  let release!: () => void;
  store.holdNext = new Promise((resolve) => { release = resolve; });
  const group = page.getByRole("group", { name: "Filter by email kind" });
  await group.getByRole("button", { name: "Contact form" }).click();
  await expect.poll(() => store.overviewCalls.at(-1)?.p_kind).toBe("contact_submission");
  await group.getByRole("button", { name: "Renewal documents" }).click();
  await expect(page.getByText("Showing 50 of 80 needing attention")).toBeVisible();
  await expect(rows(page).filter({ hasText: "Contact submission" })).toHaveCount(0);
  release();
  // The late contact response arrives and must not replace the renewal list.
  await expect.poll(() => store.overviewCalls.length).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(300);
  await expect(rows(page).filter({ hasText: "Contact submission" })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: BUSINESS })).toHaveCount(50);
});

test("7.2C-2: renewal rows link to Compliance Expiry and never open contact detail", async ({ page }) => {
  const store = new Store([renewalRow(1, "failed"), row(2, "failed")]);
  await open(page, store);
  const renewal = rowFor(page, 1);
  await expect(renewal).toContainText("Renewal document");
  await expect(renewal).toContainText(`${BUSINESS} — License`);
  const link = renewal.getByRole("link", { name: `Open Compliance Expiry to review ${BUSINESS} — License` });
  await expect(link).toHaveAttribute("href", "/admin/compliance/renewals");
  await expect(renewal.getByRole("button", { name: "View submission" })).toHaveCount(0);
  await expect(rowFor(page, 2).getByRole("button", { name: "View submission" })).toBeVisible();
  await expect(rowFor(page, 2).getByRole("link", { name: /Compliance Expiry/ })).toHaveCount(0);
  const url = page.url();
  await link.click();
  await expect(page).toHaveURL(/\/admin\/compliance\/renewals$/);
  expect(store.detailCalls).toHaveLength(0);
  expect(url).not.toContain(sourceId(1));
});

test("7.2C-2: renewal recovery needs the renewal attestations and sends the renewal kind", async ({ page }) => {
  const store = new Store([renewalRow(1, "unknown"), renewalRow(2, "missed"), renewalRow(3, "failed")]);
  await open(page, store);
  await rowFor(page, 1).getByRole("button", { name: "Resend email" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await expect(dialog).toContainText("show no email for this renewal document");
  const confirm = dialog.getByRole("button", { name: "Resend", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "I checked the owner inbox and the Resend log and found no email for this renewal document." }).check();
  await confirm.click();
  await expect(page.getByText("Resend recorded")).toBeVisible();
  expect(store.resendCalls).toEqual([{ kind: "renewal_document", sourceId: sourceId(1), confirmNoEmail: true }]);
  await expect(rowFor(page, 1)).toHaveCount(0);

  await rowFor(page, 2).getByRole("button", { name: "Acknowledge" }).click();
  const ack = page.getByRole("alertdialog", { name: "Acknowledge without email?" });
  await ack.getByLabel("What you found and why no further email is needed").fill("Found the renewal email in the owner inbox");
  await expect(ack.getByRole("button", { name: "Acknowledge", exact: true })).toBeDisabled();
  await ack.getByRole("checkbox", { name: "I checked the owner inbox and the Resend log for this renewal document." }).check();
  await ack.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(page.getByText("No email was sent. The renewal document stays saved.")).toBeVisible();
  expect(store.ackCalls).toEqual([{ p_kind: "renewal_document", p_source: sourceId(2), p_reason: "Found the renewal email in the owner inbox", p_inbox_checked: true }]);

  await rowFor(page, 3).getByRole("button", { name: "Acknowledge" }).click();
  const direct = page.getByRole("alertdialog", { name: "Acknowledge without email?" });
  await expect(direct).toContainText("already being reviewed in Compliance Expiry");
  await expect(direct.getByRole("checkbox")).toHaveCount(0);
});

test("7.2C-2: a lost renewal resend response refreshes without retrying or claiming success", async ({ page }) => {
  const target = renewalRow(1, "failed");
  const store = new Store([target]);
  await open(page, store);
  await expect(rows(page)).toHaveCount(1);
  await page.route("http://127.0.0.1:3103/api/admin/owner-emails", async (route) => {
    store.resendCalls.push(route.request().postDataJSON());
    target.state = "unknown";
    target.attempts += 1;
    target.last_error_code = "provider_timeout_or_network";
    await route.abort("failed");
  });
  const before = store.overviewCalls.length;
  await rowFor(page, 1).getByRole("button", { name: "Resend email" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await dialog.getByRole("button", { name: "Resend", exact: true }).click();
  await expect.poll(() => store.overviewCalls.length).toBeGreaterThan(before);
  await expect(dialog.getByRole("alert")).toContainText("Review the refreshed state");
  await expect(dialog.getByRole("checkbox", { name: /for this renewal document/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Resend", exact: true })).toBeDisabled();
  await expect(page.getByText("Resend recorded", { exact: true })).toHaveCount(0);
  expect(store.resendCalls).toEqual([{ kind: "renewal_document", sourceId: sourceId(1), confirmNoEmail: false }]);
  // Close the alert dialog before locating background rows by role.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rowFor(page, 1)).toContainText("Result unknown");
});

test("7.2C-2: filters are keyboard operable", async ({ page }) => {
  const store = new Store(mixedFixture());
  await open(page, store);
  const renewals = page.getByRole("group", { name: "Filter by email kind" }).getByRole("button", { name: "Renewal documents" });
  await renewals.focus();
  await expect(renewals).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(renewals).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => store.overviewCalls.at(-1)?.p_kind).toBe("renewal_document");
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`owner emails ${theme} ${width}px: axe and reflow, list and dialogs`, async ({ page }) => {
      await open(page, new Store([row(1, "unknown"), row(2, "failed"), row(3, "missed"), row(4, "sent"), renewalRow(5, "failed"), renewalRow(6, "unknown")]), { theme, width });
      await expect(rows(page)).toHaveCount(5);
      await accessible(page);
      await rowFor(page, 1).getByRole("button", { name: "Acknowledge" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await accessible(page);
      await page.keyboard.press("Escape");
      await rowFor(page, 2).getByRole("button", { name: "View submission" }).click();
      await expect(page.getByRole("dialog", { name: "Contact submission" })).toContainText(SENTINEL.subject);
      await accessible(page);
    });
  }
}

// 7.3C-1 ------------------------------------------------------------------------------------
const count = (page: Page, term: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${term.replace(/[()]/g, "\\$&")}$`) }) }).locator("dd");

function evidenceFixture() {
  const store = new Store([row(1, "sent"), row(2, "sent"), row(3, "sent"), row(4, "unknown"), row(5, "failed", { attempts: 2 }), renewalRow(6, "sent")]);
  store.evidence = {
    [sourceId(1)]: { summary: summaryFor(4), attempts: [{ attempt: 1, has_conflict: false, ...summaryFor(4), reports: [report("delivered"), report("accepted", { provider_created_at: null })] }] },
    [sourceId(2)]: { summary: summaryFor(5, ["bounced_permanent"]), attempts: [{ attempt: 1, has_conflict: false, ...summaryFor(5, ["bounced_permanent"]),
      reports: [report("bounced_permanent", { bounce_type: "permanent", bounce_subtype: "no_email" })] }] },
    [sourceId(3)]: { summary: summaryFor(2, ["bounced_permanent"]), has_conflict: true, conflict_reasons: ["stored_conflict"],
      attempts: [{ attempt: 1, has_conflict: true, ...summaryFor(2, ["bounced_permanent"]), reports: [
        report("delivered"), report("bounced_permanent", { bounce_type: "permanent", provider_created_at: "2026-11-18T15:00:00+00:00" }),
        report("complained", { excluded: "stored_conflict", provider_created_at: null }),
      ] }] },
    [sourceId(4)]: { summary: summaryFor(10), has_conflict: true, conflict_reasons: ["current_conflict"],
      attempts: [{ attempt: 1, has_conflict: true, ...summaryFor(10), reports: [report("delivered", { excluded: "current_conflict" })] }] },
    [sourceId(5)]: { attempt: 2, summary: summaryFor(10), attempts: [{ attempt: 1, has_conflict: false, ...summaryFor(6), reports: [report("bounced_transient", { bounce_type: "transient", bounce_subtype: "mailbox_full" })] }] },
    [sourceId(6)]: { summary: summaryFor(1), attempts: [{ attempt: 1, has_conflict: false, ...summaryFor(1), reports: [report("delivered"), report("complained")] }] },
  };
  store.evidenceCounts = {
    ...ZERO_COUNTS, receiver_armed: true, not_delivered: 1, to_review: 2, conflicting_rows: 2,
    conflicting_reports: { conflict_disagree: 1, conflict_id_ambiguous: 0, conflict_tag_invalid: 2, content_conflict: 1 },
    unmatched_reports: { total: 7, by_type: { "email.delivered": 7 } },
    retention_backlog: { expired: 3, expired_over_cap: false, oldest_expires_at: "2026-11-10T12:00:00+00:00" },
  };
  return store;
}

test("7.3C-1: each row shows its evidence summary, disclaimer, conflict signal and per-attempt history", async ({ page }) => {
  const store = evidenceFixture();
  await open(page, store);
  await page.getByRole("button", { name: "Show all tracked emails" }).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(rowFor(page, 1)).toContainText("Delivery evidence: Handed to the recipient's mail server. Not proof it reached the inbox or was read");
  await expect(rowFor(page, 2)).toContainText("Delivery evidence: Not delivered: Resend reported a permanent bounce");
  await expect(rowFor(page, 3)).toContainText("Provider reports disagree: handed to the mail server, and also reported bounced permanently");
  await expect(rowFor(page, 3)).toContainText("Conflicting provider report — excluded from this summary.");
  await expect(rowFor(page, 3)).not.toContainText("can count again");
  await expect(rowFor(page, 4)).toContainText("Delivery evidence: Delivery evidence not available");
  await expect(rowFor(page, 4)).toContainText("excluded while current email records disagree with it. If the conflicting record is removed, this report can count again.");
  await expect(rowFor(page, 5)).toContainText("Delivery evidence (attempt 2): Delivery evidence not available");
  await expect(rowFor(page, 6)).toContainText("Handed to the mail server; the recipient marked it as spam");
  // The row's state badge is unchanged by evidence: a sent row still reads "Accepted by Resend".
  await expect(rowFor(page, 2).getByText("Accepted by Resend", { exact: true })).toBeVisible();
  // History is collapsed until opened, per attempt, with provider times as received.
  const history = rowFor(page, 3).getByText("Provider report history");
  await expect(rowFor(page, 3).getByText("Excluded: conflicting report")).toBeHidden();
  await history.click();
  await expect(rowFor(page, 3).getByText(/^Attempt 1: Provider reports disagree/)).toBeVisible();
  await expect(rowFor(page, 3).getByText(/Handed to the mail server; the recipient marked it as spam · Provider time not given · Excluded: conflicting report/)).toBeVisible();
  await rowFor(page, 5).getByText("Provider report history").click();
  await expect(rowFor(page, 5)).toContainText("Attempt 1: Bounce reported (temporary or undetermined); delivery not established");
  await expect(rowFor(page, 5)).toContainText("Temporary bounce reported (inconclusive) (mailbox full)");
  await rowFor(page, 4).getByText("Provider report history").click();
  await expect(rowFor(page, 4)).toContainText("Excluded while current email records disagree with it");
  // Evidence never removes or adds an action.
  await expect(rowFor(page, 5).getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(rowFor(page, 2).getByRole("button", { name: "Resend email" })).toHaveCount(0);
  // S-50: no label says Delivered, Received, Read or Confirmed alone, and nothing says "later".
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\b(Delivered|Received|Read|Confirmed)\b/);
  expect(text).not.toMatch(/\blater\b/i);
});

test("7.3C-1: the additive counts sit beside the unchanged attention counts", async ({ page }) => {
  const store = evidenceFixture();
  await open(page, store);
  await expect(page.getByText("Delivery evidence from Resend", { exact: true })).toBeVisible();
  await expect(count(page, "Not delivered (Resend reported)")).toHaveText("1");
  await expect(count(page, "Provider reports to review")).toHaveText("2");
  await expect(count(page, "Emails with conflicting provider reports")).toHaveText("2");
  await expect(count(page, "Conflicting provider reports (all emails)")).toHaveText("4");
  await expect(count(page, "Unmatched provider reports")).toHaveText("7");
  await expect(count(page, "Expired reports awaiting deletion")).toHaveText("3");
  await expect(page.getByText(/Oldest expired report: Nov 10, 2026/)).toBeVisible();
  await expect(page.getByText("No coverage window is recorded for Resend delivery reports", { exact: false })).toHaveCount(0);
  // The existing attention summary is unchanged.
  await expect(summary(page, "Total")).toHaveText("2");
  await expect(summary(page, "Contact form")).toHaveText("2");
  await expect(summary(page, "Renewal documents")).toHaveText("0");
  expect(store.countsCalls).toBe(1);
});

test("7.3C-1: unarmed, every row reads rule 10 and the counts say no coverage window is recorded", async ({ page }) => {
  const store = new Store([row(1, "failed"), row(2, "unknown"), renewalRow(3, "missed")]);
  await open(page, store);
  await expect(rows(page)).toHaveCount(3);
  for (const n of [1, 2, 3]) await expect(rowFor(page, n)).toContainText("Delivery evidence: Delivery evidence not available");
  await expect(page.getByText("No coverage window is recorded for Resend delivery reports, so emails without a report show “Delivery evidence not available”.")).toBeVisible();
  await expect(count(page, "Not delivered (Resend reported)")).toHaveText("0");
  await expect(page.getByText("Provider report history")).toHaveCount(0);
  await expect(page.getByText(/Oldest expired report/)).toHaveCount(0);
});

test("7.3C-1: evidence is read for exactly the visible rows, page by page, and reset on reload", async ({ page }) => {
  const store = new Store(fixture());
  await open(page, store);
  await expect(rows(page)).toHaveCount(50);
  await expect.poll(() => store.evidenceCalls.length).toBe(1);
  const visible = await rows(page).locator("span.font-mono").allTextContents();
  expect((store.evidenceCalls[0].p_sources as string[]).map((id) => `Ref ${id.slice(0, 8)}`)).toEqual(visible);
  expect(store.evidenceCalls[0].p_kind).toBeNull();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(100);
  await expect.poll(() => store.evidenceCalls.length).toBe(2);
  expect(store.evidenceCalls[1].p_sources).toHaveLength(50);
  expect(new Set([...(store.evidenceCalls[0].p_sources as string[]), ...(store.evidenceCalls[1].p_sources as string[])]).size).toBe(100);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => store.evidenceCalls.length).toBe(3);
  expect(store.evidenceCalls[2].p_sources).toHaveLength(50);
  expect(store.countsCalls).toBe(2);
});

test("7.3C-1: a failed evidence read leaves the list and actions working and says so", async ({ page }) => {
  const store = new Store([row(1, "failed"), row(2, "unknown")]);
  store.failEvidence = true;
  store.failCounts = true;
  await open(page, store);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole("alert").filter({ hasText: "Delivery evidence could not be loaded. The email states and actions below are unaffected." })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Delivery evidence counts could not be loaded." })).toBeVisible();
  await expect(rowFor(page, 1)).not.toContainText("Delivery evidence:");
  await expect(rowFor(page, 1).getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(summary(page, "Total")).toHaveText("2");
  store.failEvidence = false;
  store.failCounts = false;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(rowFor(page, 1)).toContainText("Delivery evidence: Delivery evidence not available");
  await expect(page.getByRole("alert").filter({ hasText: "Delivery evidence could not be loaded" })).toHaveCount(0);
});

test("7.3C-1: the history disclosure is keyboard operable", async ({ page }) => {
  await open(page, evidenceFixture());
  await page.getByRole("button", { name: "Show all tracked emails" }).click();
  const disclosure = rowFor(page, 2).locator("summary", { hasText: "Provider report history" });
  await disclosure.focus();
  await expect(disclosure).toBeFocused();
  await expect(rowFor(page, 2).getByText(/^Attempt 1:/)).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(rowFor(page, 2).getByText("Attempt 1: Not delivered: Resend reported a permanent bounce")).toBeVisible();
  await expect(rowFor(page, 2)).toContainText("Permanent bounce reported (no such mailbox)");
  await page.keyboard.press("Enter");
  await expect(rowFor(page, 2).getByText(/^Attempt 1:/)).toBeHidden();
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`7.3C-1 owner emails ${theme} ${width}px: axe and reflow with evidence, counts and open history`, async ({ page }) => {
      await open(page, evidenceFixture(), { theme, width });
      await page.getByRole("button", { name: "Show all tracked emails" }).click();
      await expect(rows(page)).toHaveCount(6);
      await accessible(page);
      for (const n of [3, 4, 5]) await rowFor(page, n).getByText("Provider report history").click();
      await expect(rowFor(page, 3).getByText(/^Attempt 1:/)).toBeVisible();
      await accessible(page);
    });
  }
}
