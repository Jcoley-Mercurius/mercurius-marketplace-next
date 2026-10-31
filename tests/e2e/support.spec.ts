import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-133 (Phase 6.10): support requests for homeowners and providers, the operations queue with
// triage and internal notes, and stale/permission recovery. Outcomes come from stubbed read-backs;
// the real commands, grants and races are proven by SQL 103 and support-concurrency.mjs.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

type Row = Record<string, unknown>;
const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const job = "00000000-0000-4000-8000-000000000010";
const ticket = (over: Row = {}): Row => ({ ticket_id: "00000000-0000-4000-8000-0000000000a1", ticket_number: "TKT-101", subject: "Gate code", description: "Where do I leave it?",
  kind: "general", status: "open", created_at: "2030-11-01T15:00:00Z", updated_at: "2030-11-01T15:00:00Z", closed_at: null,
  response_due_at: "2030-11-04T21:00:00Z", priority: "standard", version: 0, job: null, can_reply: true, messages: [], ...over });

async function open(page: Page, role: "homeowner" | "vendor" | "admin", path: string, theme = "light", width = 320) {
  await syntheticSession(page.context(), role);
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
}
async function capture(page: Page, pattern: RegExp, commands: Record<string, Row[]>, reply: (rpc: string, body: Row) => Row | { status: number; body: Row }) {
  await page.route(pattern, async (route: Route) => {
    const rpc = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = route.request().postDataJSON() as Row;
    (commands[rpc] ??= []).push(body);
    const result = reply(rpc, body);
    return "status" in result && typeof result.status === "number" ? route.fulfill({ status: result.status, json: (result as { body: Row }).body }) : route.fulfill({ json: result });
  });
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`homeowner ${theme} ${width}px: empty state, sends a request with a retry key, reads the reply and answers it`, async ({ page }) => {
    const state = { items: [] as Row[] };
    const commands: Record<string, Row[]> = {};
    await page.route("**/rest/v1/rpc/my_support_tickets", route => route.fulfill({ json: { checked_at: "2030-11-01T15:00:00Z", items: state.items } }));
    await capture(page, /rest\/v1\/rpc\/(open_support_ticket|post_support_message)$/, commands, (rpc, body) => {
      if (rpc === "open_support_ticket") {
        state.items = [ticket({ subject: body._subject, description: body._description, messages: [
          { id: "m1", role: "operations", visibility: "participant", body: "Leave it with the front desk.", at: "2030-11-01T16:00:00Z", mine: false }] })];
        return { ticket_id: "00000000-0000-4000-8000-0000000000a1", ticket_number: "TKT-101", replayed: false };
      }
      return { message_id: "m2", replayed: false };
    });
    await open(page, "homeowner", "/support", theme, width);
    await expect(page.getByRole("heading", { name: "No support requests yet" })).toBeVisible();
    await expect(page.getByText(/doesn’t change your service, open a dispute, start a refund or release a payment|doesn't change your service, open a dispute, start a refund or release a payment/)).toBeVisible();
    await expect(page.getByText(/within one business day/)).toBeVisible();
    await axe(page);
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "Send request" }).click();
    const missing = page.getByRole("alert").filter({ hasText: "Add a subject and describe what you need." });
    await expect(missing).toBeVisible();
    await expect(missing).toBeFocused();
    await page.getByLabel("Subject").fill("Gate code");
    await page.getByLabel("What do you need help with?").fill("Where do I leave it?");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Request TKT-101 sent" })).toBeVisible();
    expect(commands.open_support_ticket).toHaveLength(1);
    expect(commands.open_support_ticket[0]).toMatchObject({ _subject: "Gate code", _description: "Where do I leave it?", _job_id: null });
    expect(String(commands.open_support_ticket[0]._request_key)).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByText("Leave it with the front desk.")).toBeVisible();
    await page.getByLabel("Reply").fill("Thanks");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect.poll(() => commands.post_support_message?.length ?? 0).toBe(1);
    expect(commands.post_support_message[0]).toMatchObject({ _ticket_id: "00000000-0000-4000-8000-0000000000a1", _body: "Thanks" });
    await axe(page);
    await noHorizontalScroll(page);
  });
}

test("homeowner: a load failure shows a recoverable error; a resolved request offers a new request instead of a reply", async ({ page }) => {
  let fail = true;
  await page.route("**/rest/v1/rpc/my_support_tickets", route => fail
    ? route.fulfill({ status: 500, json: { message: "boom" } })
    : route.fulfill({ json: { items: [ticket({ status: "resolved", can_reply: false, closed_at: "2030-11-02T15:00:00Z" })] } }));
  await open(page, "homeowner", "/support");
  await expect(page.getByRole("alert").filter({ hasText: "Your requests couldn't be loaded" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.getByText(/This request is resolved\. If you still need help, send a new request\./)).toBeVisible();
  await expect(page.getByLabel("Reply")).toHaveCount(0);
  await axe(page);
});

test("provider 1440px: a request about the job it came from links that job; a refused link is explained", async ({ page }) => {
  const commands: Record<string, Row[]> = {};
  await page.route("**/rest/v1/rpc/my_support_tickets", route => route.fulfill({ json: { items: [] } }));
  await capture(page, /rest\/v1\/rpc\/open_support_ticket$/, commands, () => ({ status: 403, body: { code: "42501", message: "Link a service you are part of" } }));
  await open(page, "vendor", `/vendor/support?job=${job}`, "dark", 1440);
  await expect(page.getByRole("checkbox", { name: "About the service you came from" })).toBeChecked();
  await page.getByLabel("Subject").fill("Access");
  await page.getByLabel("What do you need help with?").fill("Locked gate");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /You don't have access to this/ })).toBeFocused();
  expect(commands.open_support_ticket[0]).toMatchObject({ _job_id: job });
  await axe(page);
  await noHorizontalScroll(page);
});

const queue = (items: Row[]): Row => ({ checked_at: "2030-11-01T15:00:00Z", counts: { open: items.length, overdue: 1, same_day: 0, unassigned: 1 },
  operators: [{ user_id: "00000000-0000-4000-8000-000000000003", name: "Synthetic Operator" }], items });
const queueItem = (over: Row = {}): Row => ({ ticket_id: "00000000-0000-4000-8000-0000000000a1", ticket_number: "TKT-101", subject: "Gate code", kind: "general",
  status: "open", priority: "standard", created_at: "2030-11-01T15:00:00Z", updated_at: "2030-11-01T15:00:00Z", response_due_at: "2030-11-01T21:00:00Z",
  overdue: true, next_action: "Review and respond to the customer", queue_owner: "project_owner", version: 0, assigned_to: null, assignee: null,
  requester: "Synthetic Homeowner", job_id: null, dispute_status: null, decision_recorded: null, messages: 1, ...over });
const detail = (over: Row = {}): Row => ({ ...ticket(), requester: { user_id: "u1", name: "Synthetic Homeowner", role: "homeowner" }, opened_by: "Synthetic Homeowner",
  next_action: "Review and respond to the customer", assigned_to: null, assignee: null, overdue: true, dispute: null, review_appeal: null,
  messages: [{ id: "n1", role: "operations", visibility: "internal", body: "Repeat caller", at: "2030-11-01T16:00:00Z", mine: true, author: "Synthetic Operator" }],
  history: [{ action: "opened", from: null, to: "open", reason: null, version: 0, at: "2030-11-01T15:00:00Z", by: "Synthetic Homeowner" }], ...over });

for (const [theme, width] of [["light", 1440], ["dark", 320]] as const) {
  test(`operations ${theme} ${width}px: queue shows owner, age, due and next action; triage sends the version read; stale is explained`, async ({ page }) => {
    const commands: Record<string, Row[]> = {};
    await page.route("**/rest/v1/rpc/admin_support_queue", route => route.fulfill({ json: queue([queueItem(), queueItem({ ticket_id: "00000000-0000-4000-8000-0000000000a2",
      ticket_number: "TKT-102", subject: "Service dispute", kind: "dispute", dispute_status: "open", overdue: false })]) }));
    await page.route("**/rest/v1/rpc/support_ticket_detail", async route => {
      const id = (route.request().postDataJSON() as Row)._ticket_id;
      return route.fulfill({ json: id === "00000000-0000-4000-8000-0000000000a2"
        ? detail({ ticket_id: id, ticket_number: "TKT-102", subject: "Service dispute", kind: "dispute", messages: [], dispute: { dispute_id: "d1", status: "open", resolution_version: 0 } })
        : detail() });
    });
    await capture(page, /rest\/v1\/rpc\/admin_update_support_ticket$/, commands, () => ({ status: 409, body: { code: "40001", message: "This request changed since you opened it" } }));
    await open(page, "admin", "/admin/tickets", theme, width);
    await expect(page.getByRole("heading", { name: "Support queue" })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
    await expect(page.getByText(/· overdue/).filter({ visible: true }).first()).toBeVisible();
    await axe(page);
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: /TKT-101 Gate code/ }).first().click();
    const dialog = page.getByRole("dialog", { name: /TKT-101: Gate code/ });
    await expect(dialog.getByText("Repeat caller")).toBeVisible();
    await expect(dialog.getByText(/Internal note/)).toBeVisible();
    await dialog.getByLabel("Status").selectOption("in-progress");
    await dialog.getByRole("button", { name: "Save change" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Record a reason for this change.");
    await dialog.getByLabel("Reason").fill("Taking it");
    await dialog.getByRole("button", { name: "Save change" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/This changed since you opened it\. Reload/);
    expect(commands.admin_update_support_ticket[0]).toMatchObject({ _ticket_id: "00000000-0000-4000-8000-0000000000a1", _expected_version: 0, _status: "in-progress", _reason: "Taking it" });
    await axe(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /TKT-102 Service dispute/ }).first().click();
    const dispute = page.getByRole("dialog", { name: /TKT-102: Service dispute/ });
    await expect(dispute.getByText(/This ticket closes with the dispute decision/)).toBeVisible();
    await expect(dispute.getByLabel("Status")).toBeDisabled();
    await axe(page);
  });
}

test("operations: a non-operator sees a permission error, not data", async ({ page }) => {
  await page.route("**/rest/v1/rpc/admin_support_queue", route => route.fulfill({ status: 403, json: { code: "42501", message: "Operations access required" } }));
  await open(page, "admin", "/admin/tickets", "light", 1440);
  await expect(page.getByText(/You don't have access to this/)).toBeVisible();
  await expect(page.getByRole("button", { name: /TKT-/ })).toHaveCount(0);
});
