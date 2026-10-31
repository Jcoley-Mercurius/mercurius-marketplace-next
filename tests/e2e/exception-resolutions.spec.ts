import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-132 (Phase 6.9B): the homeowner's answer to a provider's proposed time, replacement consent,
// the operations proposal and reschedule initiator, later waivers and plan stop requests. Outcomes come
// from stubbed read-backs; the real commands are proven by SQL 102 and exception-resolutions-concurrency.mjs.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

type Row = Record<string, unknown>;
const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
const lawn = "00000000-0000-4000-8000-000000000010";
const pending = "00000000-0000-4000-8000-000000000013";
const appointment = "2030-11-12T19:30:00.000Z";
const proposed = "2030-11-14T15:00:00.000Z";

const schedule = (over: Row): Row => ({ timezone: "America/New_York", status: "scheduled", matching_status: "matched", has_provider: true, recurring: false,
  appointment, open_request: null, history: [], replacement: null, ...over });
const providerRequest = (answer: Row | null = null): Row => ({ id: "00000000-0000-4000-8000-0000000000e1", actor: "provider", at: "2030-11-01T15:00:00Z",
  reason: "Crew unavailable", requested_start: proposed, initiator: "provider", fee: 0, fee_responsibility: "none", fee_waived_later: false,
  requires_homeowner_acceptance: true, answer, expected: { request_id: "00000000-0000-4000-8000-0000000000e1", appointment, contractor_id: "c" } });
const replacement = (over: Row): Row => ({ state: "awaiting_homeowner", withdrawn_at: "2030-11-01T15:00:00Z", original_start: appointment,
  search_deadline: "2030-11-11T19:30:00Z", search_closed: false, inside_search_deadline: false,
  proposal: { id: "00000000-0000-4000-8000-0000000000f1", contractor_id: "c2", provider_name: "Synthetic Replacement", starts_at: proposed,
    created_at: "2030-11-02T15:00:00Z", reason: "Agreed by phone", after_search_deadline: false, answer: null },
  expected: { proposal_id: "00000000-0000-4000-8000-0000000000f1", contractor_id: "c2", starts_at: proposed },
  admin_expected: { contractor_id: "c2", proposal_id: "00000000-0000-4000-8000-0000000000f1" }, ...over });

async function homeowner(page: Page, job: "Lawn" | "Pending", theme = "light", width = 320) {
  await syntheticSession(page.context(), "homeowner");
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: `Open Synthetic ${job} Service details` }).click();
  return page.getByRole("dialog", { name: `Synthetic ${job} Service` });
}
async function admin(page: Page, width = 1440) {
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/requests");
  await page.getByRole("button", { name: /Review Synthetic Lawn/ }).first().click();
  return page.getByRole("dialog", { name: "Synthetic Lawn Service" });
}
/** Serves job_schedule from state and records each command body. */
async function stub(page: Page, state: { schedule: Row }, commands: Record<string, Row[]>, reply: (rpc: string, body: Row) => Row | { status: number; body: Row } = () => ({})) {
  await page.route("**/rest/v1/rpc/job_schedule", route => route.fulfill({ json: state.schedule }));
  await page.route(/rest\/v1\/rpc\/(respond_to_reschedule_request|homeowner_respond_replacement|admin_propose_replacement|record_job_operation)$/, async (route: Route) => {
    const rpc = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = route.request().postDataJSON() as Row;
    (commands[rpc] ??= []).push(body);
    const result = reply(rpc, body);
    return "status" in result && typeof result.status === "number" ? route.fulfill({ status: result.status, json: (result as { body: Row }).body }) : route.fulfill({ json: result });
  });
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`homeowner ${theme} ${width}px: answers a provider's proposed time with no fee; the appointment stays`, async ({ page }) => {
    const state = { schedule: schedule({ open_request: providerRequest() }) };
    const commands: Record<string, Row[]> = {};
    await stub(page, state, commands, (rpc, body) => {
      state.schedule = schedule({ open_request: providerRequest({ accepted: true, at: "2030-11-02T15:00:00Z", reason: null }),
        history: [{ id: "r1", kind: "reschedule_response", outcome: "accepted", actor: "homeowner", at: "2030-11-02T15:00:00Z", reason: null,
          previous_start: appointment, new_start: null, requested_start: proposed, operation_key: body._response_key }] });
      return { accepted: true };
    });
    const dialog = await homeowner(page, "Pending", theme, width);
    const request = dialog.getByTestId("open-request");
    await expect(request.getByText(/no rescheduling fee applies to you/)).toBeVisible();
    await expect(request.getByText(/your current appointment stays until you agree to a new time and Mercurius records it/)).toBeVisible();
    await expect(dialog.getByTestId("appointment-state")).toHaveText("Reschedule requested");
    await axe(page);
    await noHorizontalScroll(page);
    await request.getByRole("button", { name: "Accept proposed time" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Accept the provider’s proposed time?" });
    await expect(confirm.getByText(/Your appointment stays .* until Mercurius records the new time\. No fee applies\./)).toBeVisible();
    await confirm.getByRole("button", { name: "Accept time" }).click();
    await expect(page.getByText(/You accepted .*The appointment changes when Mercurius records it\./)).toBeVisible();
    expect(commands.respond_to_reschedule_request).toHaveLength(1);
    expect(commands.respond_to_reschedule_request[0]).toMatchObject({ _accept: true, _request_id: "00000000-0000-4000-8000-0000000000e1",
      _expected: { request_id: "00000000-0000-4000-8000-0000000000e1", appointment, contractor_id: "c" } });
    await expect(request.getByRole("button", { name: "Accept proposed time" })).toHaveCount(0);
  });
}

test("homeowner: a stale answer is refused, explained, and the schedule is read again", async ({ page }) => {
  const state = { schedule: schedule({ open_request: providerRequest() }) };
  let reads = 0;
  await stub(page, state, {}, () => ({ status: 409, body: { code: "40001", message: "This request was answered or replaced since you opened it. Review the current details." } }));
  await page.route("**/rest/v1/rpc/job_schedule", route => { reads += 1; return route.fulfill({ json: state.schedule }); });
  const dialog = await homeowner(page, "Pending");
  const before = reads;
  await dialog.getByRole("button", { name: "Decline" }).click();
  await page.getByRole("alertdialog", { name: "Decline the provider’s proposed time?" }).getByRole("button", { name: "Decline time" }).click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toBeVisible();
  expect(reads).toBeGreaterThan(before);
});

test("homeowner (keyboard): accepts both the replacement provider and the time; nothing was inherited", async ({ page }) => {
  const state = { schedule: schedule({ status: "matched", matching_status: "awaiting_homeowner", replacement: replacement({}) }) };
  const commands: Record<string, Row[]> = {};
  await stub(page, state, commands, () => { state.schedule = schedule({ appointment: proposed, replacement: replacement({ state: "accepted", expected: null }) }); return { accepted: true }; });
  const dialog = await homeowner(page, "Pending");
  await expect(dialog.getByTestId("appointment-state")).toHaveText("Replacement waiting for the homeowner");
  await expect(dialog.getByText(/isn't carried over/)).toBeVisible();
  const section = dialog.getByTestId("replacement");
  await expect(section.getByText("Accept your replacement provider?")).toBeVisible();
  await expect(section.getByText(/Synthetic Replacement on/)).toBeVisible();
  await axe(page);
  await section.getByRole("button", { name: "Accept replacement" }).focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Accept this provider and time?" });
  await expect(confirm.getByText(/for the price you already agreed/)).toBeVisible();
  await confirm.getByRole("button", { name: "Accept replacement" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Accepted: Synthetic Replacement on .* Your service is scheduled\./)).toBeVisible();
  expect(commands.homeowner_respond_replacement[0]).toMatchObject({ _accept: true, _proposal_id: "00000000-0000-4000-8000-0000000000f1",
    _expected: { proposal_id: "00000000-0000-4000-8000-0000000000f1", contractor_id: "c2", starts_at: proposed } });
});

test("admin: a provider's unanswered time can't be used, and a request must say who asked", async ({ page }) => {
  const state = { schedule: schedule({ open_request: providerRequest() }) };
  const commands: Record<string, Row[]> = {};
  await stub(page, state, commands, () => ({ operation_id: "x" }));
  const dialog = await admin(page);
  await expect(dialog.getByTestId("proposal-answer")).toHaveText(/Waiting for the homeowner to accept or decline/);
  await expect(dialog.getByRole("button", { name: "Use requested time" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Keep current appointment" })).toBeVisible();
  const form = dialog.getByRole("heading", { name: "Request a different time" }).locator("..");
  await form.getByLabel("Date (Eastern Time)").fill("2030-11-20");
  await form.getByLabel("Time (Eastern Time)").fill("09:00");
  await expect(form.getByRole("button", { name: "Review request" })).toBeDisabled();
  await form.getByLabel(/Who asked for the new time/).selectOption("provider");
  await form.getByRole("button", { name: "Review request" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Send this time request?" });
  await confirm.getByLabel("Reason (required)").fill("Provider called");
  await confirm.getByRole("button", { name: "Send request" }).click();
  await expect.poll(() => commands.record_job_operation?.length ?? 0).toBe(1);
  expect(commands.record_job_operation[0]).toMatchObject({ _kind: "reschedule_request", _initiator: "provider" });
  await axe(page);
});

test("admin 320px: proposes a replacement and a time from the read it showed", async ({ page }) => {
  const state = { schedule: schedule({ status: "matched", matching_status: "awaiting_homeowner", replacement: replacement({ state: "awaiting_proposal", proposal: null, expected: null,
    admin_expected: { contractor_id: "c2", proposal_id: null } }) }) };
  const commands: Record<string, Row[]> = {};
  await stub(page, state, commands, (_rpc, body) => { state.schedule = schedule({ status: "matched", matching_status: "awaiting_homeowner",
    replacement: replacement({ proposal: { ...(replacement({}).proposal as Row), starts_at: body._starts_at } }), history: [{ id: "p1", kind: "replacement_proposal",
      outcome: "proposed", actor: "operations", at: "2030-11-02T15:00:00Z", reason: body._reason, previous_start: appointment, new_start: body._starts_at,
      requested_start: null, provider_name: "Synthetic Replacement", operation_key: body._proposal_key }] }); return { id: "p1" }; });
  const dialog = await admin(page, 320);
  const section = dialog.getByTestId("replacement");
  await expect(section.getByText(/Propose the provider and an appointment time for the homeowner to accept/)).toBeVisible();
  await section.getByRole("button", { name: "Use original time" }).click();
  await section.getByRole("button", { name: "Review proposal" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Propose this replacement to the homeowner?" });
  await expect(confirm.getByText(/Nothing is scheduled until they accept/)).toBeVisible();
  await confirm.getByLabel("Reason (required)").fill("Replacement can keep the original time");
  await confirm.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByText(/Replacement proposed for .* Nothing is scheduled until the homeowner accepts\./)).toBeVisible();
  expect(commands.admin_propose_replacement[0]).toMatchObject({ _starts_at: appointment, _local_start: "2030-11-12T14:30:00",
    _expected: { contractor_id: "c2", proposal_id: null } });
  await noHorizontalScroll(page);
  await axe(page);
});

test("homeowner and admin: a later waiver shows the original, what was refunded and what is still owed — never as sent", async ({ page }) => {
  const outcome = { job_id: pending, status: "cancelled", cancelled: true,
    entitlement: { state: "refund_due", refund_percent: 100, basis: "exception_accepted_later", amount: 11700, captured: 11700 },
    authorization: { state: "partly_authorized", amount: 5850 }, movement: { state: "partly_settled", settled: 5850 },
    adjustment: { id: "a", kind: "waiver", at: "2030-11-03T15:00:00Z", reason: "Storm", original_percent: 50, original_basis: "notice_24_to_72_hours", operation_id: "o", original_amount: 5850 },
    remaining: { state: "supplemental_review", amount: 5850 }, cancel_operation_id: "o",
    follow_up: [{ code: "supplemental_refund_needs_review", message: "An exception accepted after the cancellation raised what is owed." }] };
  await page.route("**/rest/v1/rpc/job_cancellation_outcome", route => route.fulfill({ json: outcome }));
  const dialog = await homeowner(page, "Pending");
  const status = dialog.getByRole("region", { name: "Refund status" });
  await expect(status.getByText("Originally assessed at 50% ($58.50). Mercurius later accepted an exception, so 100% is owed.")).toBeVisible();
  await expect(status.getByText(/\$58\.50 more is owed to you after the exception\. .* it hasn't been sent yet\./)).toBeVisible();
  await expect(status.getByText(/^Refunded/)).toHaveCount(0);
  await axe(page);
});

test("admin: accepts an exception after a cancellation with a reason and the read it showed", async ({ page }) => {
  const commands: Row[] = [];
  await page.route("**/rest/v1/rpc/job_cancellation_outcome", route => route.fulfill({ json: { job_id: lawn, status: "pending", cancelled: true,
    entitlement: { state: "refund_due", refund_percent: 50, basis: "notice_24_to_72_hours", amount: 5850, captured: 11700 },
    authorization: { state: "authorized", amount: 5850 }, movement: { state: "settled", settled: 5850 }, remaining: { state: "none", amount: 0 },
    cancel_operation_id: "00000000-0000-4000-8000-0000000000d1", follow_up: [] } }));
  await page.route("**/rest/v1/rpc/admin_waiver_preview", route => route.fulfill({ json: { operation_id: "00000000-0000-4000-8000-0000000000d1", kind: "customer_cancel",
    allowed: true, refusal: null, original: { refund_percent: 50, fee: null, basis: "notice_24_to_72_hours", at: "2030-11-01T15:00:00Z" }, revised: { refund_percent: 100 },
    refund: { authorization: { amount: 5850 }, entitlement: { captured: 11700 } }, expected: { operation_id: "d1", authorizations: 1, refunds: 1 } } }));
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const cancel = (row: Row) => row.id === lawn ? { ...row, status: "pending" } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(cancel) : cancel(rows) });
  });
  await page.route("**/rest/v1/rpc/admin_record_waiver_adjustment", async route => { commands.push(route.request().postDataJSON()); await route.fulfill({ json: { kind: "waiver" } }); });
  const dialog = await admin(page);
  await dialog.getByRole("button", { name: "Accept exception after cancellation" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Accept a weather or emergency exception?" });
  await expect(confirm.getByText(/stays recorded at 50%.*No money moves\. Any additional refund needs its own reviewed authorization/)).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Record exception" })).toBeDisabled();
  await confirm.getByLabel("Reason (required)").fill("Hurricane warning for Lee County");
  await confirm.getByRole("button", { name: "Record exception" }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ _operation_id: "00000000-0000-4000-8000-0000000000d1", _reason: "Hurricane warning for Lee County",
    _expected: { operation_id: "d1", authorizations: 1, refunds: 1 } });
});

async function planRows(page: Page) {
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const plan = (row: Row) => row.id === lawn ? { ...row, status: "scheduled", matching_status: "matched", frequency: "weekly", recurrence_parent_id: null, scheduled_start_at: null } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(plan) : plan(rows) });
  });
  await page.route("**/rest/v1/rpc/job_schedule", route => route.fulfill({ json: schedule({ recurring: true, appointment: null }) }));
  await page.route("**/rest/v1/rpc/recurring_series", route => route.fulfill({ json: { series_id: lawn, timezone: "America/New_York", frequency: "weekly",
    status: "scheduled", has_provider: true, terms: null, visits: [], history: [], plan_state: "active", anchor: null } }));
}
const visitsInPlace = [{ id: "v1", status: "scheduled", matching_status: "matched", scheduled_start_at: appointment, provider_name: "Synthetic Vendor", offer_open: false,
  cancellation: { allowed: true, refund_percent: 100, basis: "notice_72_hours_or_more" }, payment: null }];

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`homeowner ${theme} ${width}px: asks to stop future visits; nothing is presented as cancelled`, async ({ page }) => {
    await planRows(page);
    let preview: Row = { series_id: lawn, plan_state: "active", expected_state: "active", accepted: true, request: null, visits: visitsInPlace };
    const sent: Row[] = [];
    await page.route("**/rest/v1/rpc/recurring_plan_stop_preview", route => route.fulfill({ json: preview }));
    await page.route("**/rest/v1/rpc/homeowner_request_plan_stop", async route => {
      sent.push(route.request().postDataJSON());
      preview = { ...preview, request: { id: "q", at: "2030-11-02T15:00:00Z", reason: "Moving", state: "open", closed_at: null, resolution: null } };
      await route.fulfill({ json: { request_id: "q", state: "requested", replayed: false } });
    });
    const dialog = await homeowner(page, "Lawn", theme, width);
    const stop = dialog.getByTestId("plan-stop");
    await expect(stop.getByText(/stays in place; cancelling it now would refund 100%/)).toBeVisible();
    await stop.getByRole("button", { name: "Ask to stop future visits" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Ask Mercurius to stop future visits?" });
    await expect(confirm.getByText(/Nothing is cancelled by this request/)).toBeVisible();
    await confirm.getByLabel("Reason (required)").fill("Moving");
    await confirm.getByRole("button", { name: "Send request" }).click();
    await expect(stop.getByTestId("plan-stop-state")).toHaveText(/Nothing has been cancelled\./);
    expect(sent[0]).toMatchObject({ _series_id: lawn, _reason: "Moving" });
    await expect(stop.getByRole("button", { name: "Ask to stop future visits" })).toHaveCount(0);
    await noHorizontalScroll(page);
    await axe(page);
  });
}

test("admin: sees the homeowner's stop request with each visit's consequence and may close it", async ({ page }) => {
  await planRows(page);
  await page.route("**/rest/v1/rpc/recurring_plan_stop_preview", route => route.fulfill({ json: { series_id: lawn, plan_state: "active", expected_state: "active", accepted: true,
    request: { id: "q", at: "2030-11-02T15:00:00Z", reason: "Moving", state: "open", closed_at: null, resolution: null },
    visits: [{ ...visitsInPlace[0], payment: { captured: 4500, open_checkout: false } }] } }));
  const dialog = await admin(page);
  const stop = dialog.getByTestId("plan-stop");
  await expect(stop.getByText(/The homeowner asked on .* Review the visits below, then use Stop future visits/)).toBeVisible();
  await expect(stop.getByText(/Paid so far: yes\./)).toBeVisible();
  await expect(stop.getByRole("button", { name: "Close without stopping" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Stop future visits" })).toBeVisible();
  await axe(page);
});

test("homeowner: a stop status that can't load says so and offers a retry", async ({ page }) => {
  await planRows(page);
  let fail = true;
  await page.route("**/rest/v1/rpc/recurring_plan_stop_preview", route => fail ? route.fulfill({ status: 500, json: { message: "boom" } })
    : route.fulfill({ json: { series_id: lawn, plan_state: "active", expected_state: "active", accepted: true, request: null, visits: [] } }));
  const dialog = await homeowner(page, "Lawn");
  await expect(dialog.getByText("We couldn’t load the plan’s stop status.")).toBeVisible();
  fail = false;
  await dialog.getByTestId("plan-stop").getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("button", { name: "Ask to stop future visits" })).toBeVisible();
});

test("public policy: provider requests, replacement consent and plan stops match DEC-2026-053", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/reschedule-policy");
  await expect(page.getByText(/No fee for you\. Your appointment stays until you accept a new time/)).toBeVisible();
  await expect(page.getByText(/you accept both the replacement provider and the appointment\s+time before anything is scheduled/)).toBeVisible();
  await expect(page.getByText(/visits already in place stay until each one is handled/)).toBeVisible();
  await noHorizontalScroll(page);
  await axe(page);
});
