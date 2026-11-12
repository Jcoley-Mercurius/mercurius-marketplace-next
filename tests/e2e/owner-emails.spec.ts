// TRACE-154 (Phase 7.2C-1): synthetic browser evidence for the Owner Emails page. The overview,
// acknowledgement and contact-detail RPCs and the resend route are served from an in-memory
// store that applies the page's own keyset cursor, filter and limit, and mirrors the database's
// attestation and operator rules. The database contract itself is SQL 120.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const cors = { "access-control-allow-origin": "http://127.0.0.1:3103", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

// Sentinels: submitted content that must never reach the list.
const SENTINEL = { subject: "Sentinel subject do not list", message: "Sentinel message do not list", email: "sentinel.sender@example.test", name: "Sentinelfirst" };

type Row = {
  id: string; source_id: string; created_at: string; state: string; attempts: number;
  last_error_code: string | null; sent_at: string | null; acknowledged_at: string | null; acknowledged_reason: string | null;
};
const ATTENTION = ["failed", "missed", "unknown", "resend_requested"];
const sourceId = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// A larger n is older; every fifth pair shares a timestamp so ties cross page boundaries.
const at = (n: number) => new Date(Date.UTC(2026, 10, 12, 15, 0, 0) - Math.floor(n / 2) * 60_000).toISOString().replace("Z", "+00:00");
const row = (n: number, state: string, extra: Partial<Row> = {}): Row => ({
  id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`, source_id: sourceId(n), created_at: at(n), state,
  attempts: state === "missed" ? 0 : 1, last_error_code: state === "failed" ? "provider_refused" : state === "unknown" ? "provider_server_error" : null,
  sent_at: state === "sent" ? at(n) : null, acknowledged_at: state === "acknowledged" ? at(n) : null,
  acknowledged_reason: state === "acknowledged" ? "Read it in the admin" : null, ...extra,
});

class Store {
  rows: Row[];
  overviewCalls: Array<Record<string, unknown>> = [];
  detailCalls: Array<Record<string, unknown>> = [];
  ackCalls: Array<Record<string, unknown>> = [];
  resendCalls: Array<Record<string, unknown>> = [];
  failOverview = 0;
  holdOverview: Promise<void> | null = null;
  detailRefusal: { status: number; code: string } | null = null;
  resendResponse: { status: number; body: Record<string, unknown> } = { status: 200, body: { state: "sent", message: "Resend accepted the email. Confirm it arrived in the owner inbox." } };
  constructor(rows: Row[]) { this.rows = rows; }
  sorted() { return [...this.rows].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1)); }
  overview(body: Record<string, unknown>) {
    const limit = Math.min(100, Math.max(1, Number(body.p_limit ?? 50)));
    const settled = body.p_include_settled === true;
    const before = body.p_before_created_at as string | null;
    const beforeId = body.p_before_id as string | null;
    const listed = this.sorted().filter((r) => (settled || ATTENTION.includes(r.state))
      && (!before || r.created_at < before || (r.created_at === before && r.id < beforeId!)));
    const page = listed.slice(0, limit);
    const attention = this.rows.filter((r) => ATTENTION.includes(r.state)).length;
    return {
      checked_at: "2026-11-12T16:00:00+00:00", stale_after_minutes: 10, limit,
      attention_count: { total: attention, contact_submission: attention, renewal_document: 0 },
      next_cursor: listed.length > limit ? { created_at: page.at(-1)!.created_at, id: page.at(-1)!.id } : null,
      items: page.map((r) => ({
        kind: "contact_submission", source_id: r.source_id, label: "Contact submission", reference: r.source_id.slice(0, 8),
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
      if (this.failOverview > 0) { this.failOverview -= 1; return json(500, { code: "XX000", message: "Synthetic outage" }); }
      return json(200, this.overview(body));
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

const rows = (page: Page) => page.getByRole("list", { name: "Contact form emails" }).getByRole("listitem");
const rowFor = (page: Page, n: number) => rows(page).filter({ hasText: `Ref ${sourceId(n).slice(0, 8)}` });

test("exact count with bounded pages, Load older, and no submitted content in the list", async ({ page }) => {
  const store = new Store(fixture());
  await open(page, store);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Owner emails");
  await expect(page.getByText("Contact form emails needing attention")).toBeVisible();
  await expect(page.locator("p.font-heading").first()).toHaveText("130");
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText("Showing 50 of 130 needing attention")).toBeVisible();
  await expect(rows(page).first()).toContainText("Contact submission");
  await expect(rows(page).first()).toContainText(`Ref ${sourceId(1).slice(0, 8)}`);
  await expect(page.getByText("Messages saved before email tracking began are not listed here and cannot be resent.")).toBeVisible();

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
  expect(store.overviewCalls.at(-1)).toMatchObject({ p_include_settled: true, p_before_created_at: null, p_kind: "contact_submission" });
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

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`owner emails ${theme} ${width}px: axe and reflow, list and dialogs`, async ({ page }) => {
      await open(page, new Store([row(1, "unknown"), row(2, "failed"), row(3, "missed"), row(4, "sent")]), { theme, width });
      await expect(rows(page)).toHaveCount(3);
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
