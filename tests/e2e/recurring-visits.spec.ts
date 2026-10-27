// TRACE-123 (Phase 6.6): recurring plan visits for operations, homeowner and provider. Operations
// adds one visit at an Eastern wall time from a device in another timezone; blocked outcomes,
// lost responses and retries are read back; the plan itself offers no start or work statuses.
// TRACE-124: the cadence anchor, proposed visits (with an explicit daylight-saving choice), linking
// an off-cadence visit, pause and "stop future visits" with the visits that stay in place.
// Synthetic fixture only; outcomes come from stubbed read-backs, and the real commands are proven
// by SQL 095/096 and scripts/recurring-visit-concurrency.mjs and recurring-cadence-concurrency.mjs.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const planId = "00000000-0000-4000-8000-000000000010";
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;

type Row = Record<string, unknown>;
type Reply = "ok" | "abort" | { status: number; body: Row };
type State = { visits: Row[]; history: Row[]; calls: Row[]; create?: Reply; read?: Reply; onCreate?: (body: Row) => Row;
  planState?: string; anchor?: Row | null; admin?: Row; commands?: Row[]; onCommand?: (rpc: string, body: Row) => void };

const terms = { provider: "Synthetic Vendor", package: "Synthetic lawn plan", price_level: "Weekly", pricing_mode: "fixed", frequency: "weekly",
  visit_price: 40, visit_total: 45, has_addons: true, accepted_at: "2030-10-01T12:00:00Z" };
const readback = (state: State): Row => ({ series_id: planId, timezone: "America/New_York", frequency: "weekly", status: "scheduled", has_provider: true,
  terms, visits: state.visits, history: state.history, plan_state: state.planState ?? "active", anchor: state.anchor ?? null, ...(state.admin ?? {}) });
const visit = (overrides: Row): Row => ({ id: crypto.randomUUID(), visit_key: crypto.randomUUID(), starts_at: "2030-11-05T14:00:00Z", local_start: "2030-11-05T09:00:00",
  status: "matched", matching_status: "offered", offer: "pending", plan_provider: true, provider_completed_at: null, homeowner_confirmed_at: null, payment: "none", ...overrides });
const attempt = (overrides: Row): Row => ({ id: crypto.randomUUID(), at: "2030-10-20T15:00:00Z", outcome: "created", code: null, starts_at: "2030-11-05T14:00:00Z",
  local_start: "2030-11-05T09:00:00", occurrence_id: null, actor: "operations", reason: "Agreed by phone", operation_key: null, ...overrides });
const reply = (route: Route, value: Reply, ok: unknown) => value === "abort" ? route.abort("failed")
  : value === "ok" ? route.fulfill({ json: ok }) : route.fulfill({ status: value.status, json: value.body });

/** The fixture records what the command would: a visit (unless blocked) and this caller's attempt. */
const creates = (state: State, outcome: "created" | "blocked" = "created", code: string | null = null) => (body: Row) => {
  const id = crypto.randomUUID();
  if (outcome === "created") state.visits = [...state.visits, visit({ id, starts_at: body._starts_at, local_start: body._local_start })];
  state.history = [...state.history, attempt({ outcome, code, starts_at: body._starts_at, local_start: body._local_start, reason: body._reason,
    occurrence_id: outcome === "created" ? id : null, operation_key: body._operation_key })];
  return { outcome, code, occurrence_id: outcome === "created" ? id : null, starts_at: body._starts_at };
};

async function open(page: Page, role: "admin" | "homeowner" | "vendor", state: State, width = 1440) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.setViewportSize({ width, height: 1000 });
  await syntheticSession(page.context(), role);
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const plan = (row: Row) => row.id === planId ? { ...row, status: "scheduled", matching_status: "matched", frequency: "weekly", recurrence_parent_id: null, scheduled_start_at: null } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(plan) : plan(rows) });
  });
  await page.route("**/rest/v1/rpc/job_schedule", route => route.fulfill({ json: { timezone: "America/New_York", status: "scheduled", matching_status: "matched",
    has_provider: true, recurring: true, appointment: null, open_request: null, history: [] } }));
  await page.route("**/rest/v1/rpc/recurring_series", route => reply(route, state.read ?? "ok", readback(state)));
  await page.route(/rest\/v1\/rpc\/admin_(record_recurring_anchor|resolve_cadence_date|set_recurring_plan_state)$/, async route => {
    const rpc = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = route.request().postDataJSON() as Row;
    (state.commands ??= []).push({ rpc, ...body });
    state.onCommand?.(rpc, body);
    return route.fulfill({ json: {} });
  });
  await page.route(/rest\/v1\/rpc\/admin_create_(recurring|cadence)_visit$/, async route => {
    const body = route.request().postDataJSON() as Row;
    state.calls.push(body);
    const result = state.onCreate?.(body) ?? {};
    return reply(route, state.create ?? "ok", result);
  });
  if (role === "admin") {
    await page.goto("/admin/requests");
    await page.getByRole("button", { name: /Review Synthetic Lawn/ }).click();
    return page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  }
  if (role === "homeowner") {
    await page.goto("/dashboard?tab=upcoming");
    await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
    return page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  }
  await page.goto("/vendor/jobs");
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  return page.locator("[data-slot=card]").filter({ hasText: "Synthetic Lawn Service" });
}

test.describe("device in Pacific Time", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  for (const width of [320, 1440]) {
    test(`admin ${width}px: adds a 9:00 AM Eastern visit from a Pacific device and reads it back`, async ({ page }) => {
      test.slow(); // two axe scans and a full-page screenshot
      const state: State = { visits: [], history: [], calls: [] };
      state.onCreate = creates(state);
      const dialog = await open(page, "admin", state, width);
      const panel = dialog.getByRole("region", { name: "Recurring visits" });
      await expect(panel.getByTestId("series-terms")).toHaveText("Weekly · $45.00 a visit, including add-ons · Synthetic Vendor");
      await expect(panel.getByText("No visits have been added yet.")).toBeVisible();
      await expect(panel.getByText(/the 60-day and 24-hour proposal limits don’t apply.*when each visit is charged isn’t set up yet/)).toBeVisible();
      await expect(panel.getByRole("button", { name: "Review visit" })).toBeDisabled();
      expect(await axe(page)).toEqual([]);

      await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Date (Eastern Time)").fill("2030-11-05");
      await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Time (Eastern Time)").fill("09:00");
      await expect(panel.getByText("Selected: Tue, Nov 5, 2030, 9:00 AM EST")).toBeVisible();
      await expect(panel.getByText(/there it is Tue, Nov 5, 6:00 AM PST/)).toBeVisible();
      await panel.getByRole("button", { name: "Review visit" }).click();
      const confirm = page.getByRole("alertdialog", { name: "Add this visit?" });
      await expect(confirm).toContainText("Tue, Nov 5, 2030, 9:00 AM EST");
      await expect(confirm).toContainText("no other provider or price is used");
      await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await confirm.getByLabel("Reason (required)").fill("Agreed with the homeowner by phone");
      await confirm.getByRole("button", { name: "Add visit" }).click();
      await expect(confirm).toBeHidden();

      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]).toMatchObject({ _series_id: planId, _starts_at: "2030-11-05T14:00:00.000Z", _local_start: "2030-11-05T09:00:00", _reason: "Agreed with the homeowner by phone" });
      await expect(panel.getByRole("status").filter({ hasText: "Visit added" })).toHaveText("Visit added: Tue, Nov 5, 2030, 9:00 AM EST. The provider accepts it separately.");
      const visits = panel.getByRole("list").first();
      await expect(visits.getByRole("listitem")).toHaveCount(1);
      await expect(visits.getByRole("listitem").first()).toContainText("Waiting for the provider to accept this visit");
      await expect(visits.getByRole("listitem").first()).toContainText("Payment: Not invoiced");
      await expect(panel.getByRole("listitem").filter({ hasText: "Visit added: Tue, Nov 5, 2030, 9:00 AM EST" })).toContainText("Reason: Agreed with the homeowner by phone");
      expect(await page.locator("[role=dialog]").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await axe(page)).toEqual([]);
      await page.screenshot({ path: `test-results/trace123-admin-visits-${width}.png`, fullPage: true });
    });
  }
});

test("admin: a blocked visit explains why, adds nothing and keeps the attempt in history", async ({ page }) => {
  const state: State = { visits: [], history: [], calls: [] };
  state.onCreate = creates(state, "blocked", "terms_changed");
  const panel = (await open(page, "admin", state)).getByRole("region", { name: "Recurring visits" });
  await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Date (Eastern Time)").fill("2030-11-12");
  await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Time (Eastern Time)").fill("09:00");
  await panel.getByRole("button", { name: "Review visit" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Add this visit?" });
  await confirm.getByLabel("Reason (required)").fill("Next week");
  await confirm.getByRole("button", { name: "Add visit" }).click();
  await expect(confirm).toBeHidden();
  await expect(panel.getByRole("alert")).toHaveText("The provider’s price, package or the property changed since the plan was accepted. No visit was added and no other price or provider was used.");
  await expect(panel.getByText("No visits have been added yet.")).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "Not added: Tue, Nov 12, 2030, 9:00 AM EST" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("admin: a lost response is confirmed from the readback; an unconfirmed failure keeps its key for the retry", async ({ page }) => {
  const state: State = { visits: [], history: [], calls: [], create: "abort" };
  const record = creates(state);
  state.onCreate = body => record(body); // recorded, then the response is lost
  const panel = (await open(page, "admin", state)).getByRole("region", { name: "Recurring visits" });
  await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Date (Eastern Time)").fill("2030-11-05");
  await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Time (Eastern Time)").fill("09:00");
  await panel.getByRole("button", { name: "Review visit" }).click();
  let confirm = page.getByRole("alertdialog", { name: "Add this visit?" });
  await confirm.getByLabel("Reason (required)").fill("First visit");
  await confirm.getByRole("button", { name: "Add visit" }).click();
  await expect(confirm).toBeHidden();
  await expect(panel.getByRole("status").filter({ hasText: "Visit added" })).toBeVisible();

  // Not recorded and no response: nothing is claimed; the retry sends the same key.
  state.onCreate = undefined;
  await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Date (Eastern Time)").fill("2030-11-12");
  await panel.getByRole("group", { name: /^Visit time/ }).getByLabel("Time (Eastern Time)").fill("09:00");
  await panel.getByRole("button", { name: "Review visit" }).click();
  confirm = page.getByRole("alertdialog", { name: "Add this visit?" });
  await confirm.getByLabel("Reason (required)").fill("Second visit");
  await confirm.getByRole("button", { name: "Add visit" }).click();
  await expect(confirm.getByRole("alert")).toBeVisible();
  await confirm.getByRole("button", { name: "Add visit" }).click();
  await expect(confirm.getByRole("alert")).toBeVisible();
  expect(state.calls).toHaveLength(3);
  expect(state.calls[2]._operation_key).toBe(state.calls[1]._operation_key);
  expect(state.calls[1]._operation_key).not.toBe(state.calls[0]._operation_key);
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("couldn’t confirm whether the visit was added");
  await expect(panel.getByRole("list").first().getByRole("listitem")).toHaveCount(1);
});

test("admin: the plan offers no work statuses and no caller-keyed visit change", async ({ page }) => {
  const state: State = { visits: [], history: [], calls: [] };
  const dialog = await open(page, "admin", state);
  await expect(dialog.getByRole("region", { name: "Recurring visits" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "In Progress", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Pending", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /Change/ }).locator("option", { hasText: "new visit" })).toHaveCount(0);
});

test("homeowner: reads each visit and its payment, with no way to add one", async ({ page }) => {
  test.slow();
  const state: State = { calls: [], history: [attempt({ outcome: "created" })], visits: [
    visit({ status: "scheduled", matching_status: "matched", offer: "accepted", payment: "awaiting_payment" }),
    visit({ starts_at: "2030-11-12T14:00:00Z", local_start: "2030-11-12T09:00:00" }),
  ] };
  const dialog = await open(page, "homeowner", state);
  const panel = dialog.getByRole("region", { name: "Recurring visits" });
  await expect(panel.getByTestId("series-terms")).toHaveText("Weekly · $45.00 a visit, including add-ons · Synthetic Vendor");
  await expect(panel).toContainText("each visit is paid on its own");
  const items = panel.getByRole("list").first().getByRole("listitem");
  await expect(items.nth(0)).toContainText("Provider accepted this visit");
  await expect(items.nth(0)).toContainText("Payment: Payment requested");
  await expect(items.nth(1)).toContainText("Waiting for the provider to accept this visit");
  await expect(panel.getByRole("heading", { name: "Add a visit" })).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "Visit history" })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test("provider: the plan card has no start action; details show visits without payment", async ({ page }) => {
  test.slow();
  const state: State = { calls: [], history: [], visits: [visit({ status: "scheduled", matching_status: "matched", offer: "accepted", payment: null })] };
  const card = await open(page, "vendor", state, 320);
  await expect(card.getByText("Recurring plan · each visit is offered and started separately")).toBeVisible();
  await expect(card.getByRole("button", { name: "Start job" })).toHaveCount(0);
  await card.getByRole("button", { name: "View job", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Recurring visits" });
  await expect(panel.getByRole("listitem").first()).toContainText("Provider accepted this visit");
  await expect(panel).not.toContainText("Payment:");
  await expect(panel).not.toContainText("paid on its own");
  await expect(panel.getByRole("heading", { name: "Add a visit" })).toHaveCount(0);
  expect(await page.locator("[role=dialog]").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await axe(page)).toEqual([]);
});

test("load failure offers a retry; a permission refusal does not", async ({ page }) => {
  const state: State = { visits: [], history: [], calls: [], read: "abort" };
  const panel = (await open(page, "homeowner", state)).getByRole("region", { name: "Recurring visits" });
  await expect(panel.getByRole("alert")).toHaveText("The visits couldn’t be loaded. Nothing was changed.");
  state.read = "ok";
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByText("No visits have been added yet.")).toBeVisible();

  state.read = { status: 403, body: { code: "42501", message: "Not a participant in this service" } };
  await page.reload();
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  const refused = page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Recurring visits" });
  await expect(refused.getByRole("alert")).toHaveText("You don’t have access to this plan’s visits.");
  await expect(refused.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

// TRACE-124 ------------------------------------------------------------------------------------

const preview = (overrides: Row): Row => ({ as_of: "2030-10-28T15:00:00Z", today: "2030-10-28", horizon_end: "2030-12-27", state: "active", unavailable: null,
  anchor_id: "a1", upcoming: 0, capacity: 2, proposals: [], next: null, ...overrides });
const adminExtras = (overrides: Row = {}): Row => ({ anchor_id: "a1", cadence: preview({}), anchors: [], lifecycle: [], resolutions: [], ...overrides });

test.describe("cadence from a Pacific device", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("admin 320px: a fall-back proposal needs EDT or EST chosen before it is added through the cadence path", async ({ page }) => {
    test.slow();
    const ambiguous = { cadence_date: "2030-11-03", index: 1, local_start: "2030-11-03T01:30:00", kind: "ambiguous", starts_at: null, opens_on: "2030-10-28",
      choices: [{ abbreviation: "EDT", starts_at: "2030-11-03T05:30:00Z" }, { abbreviation: "EST", starts_at: "2030-11-03T06:30:00Z" }] };
    const ok = { cadence_date: "2030-11-10", index: 2, local_start: "2030-11-10T01:30:00", kind: "ok", starts_at: "2030-11-10T06:30:00Z", opens_on: "2030-10-28",
      choices: [{ abbreviation: "EST", starts_at: "2030-11-10T06:30:00Z" }] };
    const state: State = { visits: [], history: [], calls: [], anchor: { starts_at: "2030-10-27T05:30:00Z", local_start: "2030-10-27T01:30:00" },
      admin: adminExtras({ cadence: preview({ proposals: [ambiguous, ok], next: ambiguous }) }) };
    const record = creates(state);
    state.onCreate = body => {
      (state.admin!.cadence as Row).proposals = ((state.admin!.cadence as Row).proposals as Row[]).filter(p => p.cadence_date !== body._cadence_date);
      return record(body);
    };
    const panel = (await open(page, "admin", state, 320)).getByRole("region", { name: "Recurring visits" });
    await expect(panel.getByTestId("plan-schedule")).toHaveText("Active · Weekly, counted from Sun, Oct 27, 2030, 1:30 AM EDT");
    const schedule = panel.getByRole("region", { name: "Plan schedule" });
    const items = schedule.getByRole("listitem");
    await expect(items.nth(0)).toContainText("Clocks fall back on this date, so the plan’s time happens twice. Choose EDT or EST");
    await expect(items.nth(1)).toContainText("Sun, Nov 10, 2030, 1:30 AM EST");
    await expect(items.nth(0).getByRole("button", { name: "Review proposed visit" })).toBeDisabled();
    await items.nth(0).getByText("Sun, Nov 3, 2030, 1:30 AM EST").click();
    await items.nth(0).getByRole("button", { name: "Review proposed visit" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Add this proposed visit?" });
    await expect(confirm).toContainText("Sun, Nov 3, 2030, 1:30 AM EST");
    await expect(confirm).toContainText("Added from the plan’s cadence");
    await confirm.getByLabel("Reason (required)").fill("Weekly visit");
    await confirm.getByRole("button", { name: "Add visit" }).click();
    await expect(confirm).toBeHidden();
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ _series_id: planId, _anchor_id: "a1", _cadence_date: "2030-11-03", _starts_at: "2030-11-03T06:30:00.000Z",
      _local_start: "2030-11-03T01:30:00", _reason: "Weekly visit" });
    await expect(schedule.getByRole("status").filter({ hasText: "Proposed visit added" })).toHaveText("Proposed visit added: Sun, Nov 3, 2030, 1:30 AM EST. The provider accepts it separately.");
    await expect(schedule.getByRole("listitem").filter({ hasText: "Review proposed visit" })).toHaveCount(1);
    await expect(panel.getByRole("heading", { name: "Add a visit manually" })).toBeVisible();
    expect(await page.locator("[role=dialog]").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: "test-results/trace124-admin-cadence-320.png", fullPage: true });
  });
});

test("admin: records the agreed anchor with its basis, explains an empty horizon and links an off-cadence visit", async ({ page }) => {
  test.slow();
  const offCadence = visit({ id: "00000000-0000-4000-8000-0000000000aa", starts_at: "2030-11-14T19:00:00Z", local_start: "2030-11-14T14:00:00", on_cadence: false, replaces: null });
  const state: State = { visits: [offCadence], history: [], calls: [],
    admin: adminExtras({ anchor_id: null, cadence: preview({ anchor_id: null, unavailable: "no_anchor" }) }) };
  state.onCommand = (rpc, body) => {
    if (rpc === "admin_record_recurring_anchor") {
      state.anchor = { starts_at: body._starts_at, local_start: body._local_start };
      state.admin = adminExtras({ upcoming: 1, cadence: preview({ capacity: 1, upcoming: 1,
        next: { cadence_date: "2030-12-31", opens_on: "2030-11-01", index: 8, local_start: "2030-12-31T09:00:00", kind: "ok", choices: [], starts_at: "2030-12-31T14:00:00Z" } }),
        anchors: [{ id: "a1", at: "2030-10-28T15:00:00Z", starts_at: body._starts_at, local_start: body._local_start, basis: body._basis, reason: body._reason,
          replaces_anchor_id: null, actor: "operations", operation_key: body._operation_key }] });
    }
  };
  const panel = (await open(page, "admin", state)).getByRole("region", { name: "Recurring visits" });
  const schedule = panel.getByRole("region", { name: "Plan schedule" });
  await expect(schedule.getByTestId("no-proposals")).toHaveText("Record the agreed first visit time to see proposed visits.");
  const anchorTime = schedule.getByRole("group", { name: /^Agreed first visit/ });
  await anchorTime.getByLabel("Date (Eastern Time)").fill("2030-11-05");
  await anchorTime.getByLabel("Time (Eastern Time)").fill("09:00");
  await expect(schedule.getByRole("button", { name: "Review anchor" })).toBeDisabled();
  await schedule.getByLabel("How this time was agreed").fill("Confirmed with the homeowner and provider by phone");
  await schedule.getByRole("button", { name: "Review anchor" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record this anchor?" });
  await expect(confirm).toContainText("Tue, Nov 5, 2030, 9:00 AM EST");
  await expect(confirm).toContainText("No visit is added.");
  await confirm.getByLabel("Reason (required)").fill("First visit agreed");
  await confirm.getByRole("button", { name: "Record anchor" }).click();
  await expect(confirm).toBeHidden();
  expect(state.commands![0]).toMatchObject({ rpc: "admin_record_recurring_anchor", _expected_anchor_id: null, _starts_at: "2030-11-05T14:00:00.000Z",
    _local_start: "2030-11-05T09:00:00", _basis: "Confirmed with the homeowner and provider by phone", _reason: "First visit agreed" });
  await expect(panel.getByTestId("plan-schedule")).toHaveText("Active · Weekly, counted from Tue, Nov 5, 2030, 9:00 AM EST");
  await expect(schedule.getByTestId("no-proposals")).toHaveText(
    "No cadence date falls in the next 60 days that is at least 24 hours away. Next cadence date: Tue, Dec 31, 2030; it can be proposed from Fri, Nov 1, 2030.");
  await expect(schedule.getByRole("listitem").filter({ hasText: "Cadence anchor recorded" })).toContainText("How it was agreed: Confirmed with the homeowner and provider by phone");
  await expect(panel.getByRole("list").first().getByRole("listitem")).toContainText("Off-cadence visit");

  await schedule.getByLabel("Replaces the cadence date").selectOption({ label: "Tue, Nov 12, 2030" });
  await expect(schedule.getByLabel("Replaces the cadence date").locator("option")).toHaveText(["Not a replacement", "Tue, Nov 12, 2030", "Tue, Nov 19, 2030"]);
  await schedule.getByRole("button", { name: "Link visit" }).click();
  const link = page.getByRole("alertdialog", { name: "Link this visit to a cadence date?" });
  await expect(link).toContainText("appointment, provider, price and payment don’t change");
  await link.getByLabel("Reason (required)").fill("Make-up for the holiday");
  await link.getByRole("button", { name: "Link visit" }).click();
  await expect(link).toBeHidden();
  expect(state.commands![1]).toMatchObject({ rpc: "admin_resolve_cadence_date", _anchor_id: "a1", _cadence_date: "2030-11-12", _kind: "replaced",
    _occurrence_id: offCadence.id, _reason: "Make-up for the holiday" });
  expect(await axe(page)).toEqual([]);
});

test("admin: pause, then stop future visits; existing visits stay in place and new visits can't be added", async ({ page }) => {
  test.slow();
  const state: State = { visits: [visit({ on_cadence: true })], history: [attempt({})], calls: [],
    anchor: { starts_at: "2030-11-05T14:00:00Z", local_start: "2030-11-05T09:00:00" }, admin: adminExtras({ cadence: preview({ upcoming: 1, capacity: 1 }) }) };
  state.onCommand = (rpc, body) => {
    const to = body._action === "pause" ? "paused" : body._action === "resume" ? "active" : "ended";
    state.planState = to;
    state.admin = adminExtras({ cadence: preview({ state: to, unavailable: to === "active" ? null : to }),
      lifecycle: [...((state.admin?.lifecycle as Row[]) ?? []), { id: crypto.randomUUID(), at: "2030-10-28T15:00:00Z", action: body._action,
        from_state: body._expected_state, to_state: to, reason: body._reason, actor: "operations", operation_key: body._operation_key }] });
  };
  const panel = (await open(page, "admin", state)).getByRole("region", { name: "Recurring visits" });
  const schedule = panel.getByRole("region", { name: "Plan schedule" });
  await schedule.getByRole("button", { name: "Pause plan" }).click();
  let confirm = page.getByRole("alertdialog", { name: "Pause this plan?" });
  await expect(confirm).toContainText("Existing visits and open offers stay in place");
  await confirm.getByLabel("Reason (required)").fill("Homeowner travelling");
  await confirm.getByRole("button", { name: "Pause plan" }).click();
  await expect(confirm).toBeHidden();
  await expect(panel.getByTestId("plan-schedule")).toContainText("Paused · no new visits");
  await expect(schedule.getByTestId("no-proposals")).toHaveText("The plan is paused. Nothing is proposed until operations resumes it.");
  await expect(panel.getByText("The plan is paused. Resume it to add visits.")).toBeVisible();
  await expect(schedule.getByRole("button", { name: "Resume plan" })).toBeVisible();

  await schedule.getByRole("button", { name: "Stop future visits" }).click();
  confirm = page.getByRole("alertdialog", { name: "Stop future visits for this plan?" });
  await expect(confirm).toContainText("This is final");
  await expect(confirm).toContainText("Existing visits and open offers remain in place and each needs to be handled individually; nothing is cancelled, charged or refunded");
  await expect(confirm).toContainText("1 visit is in place now.");
  await confirm.getByLabel("Reason (required)").fill("Homeowner ending service");
  await confirm.getByRole("button", { name: "Stop future visits" }).click();
  await expect(confirm).toBeHidden();
  expect(state.commands!.map(c => [c._action, c._expected_state])).toEqual([["pause", "active"], ["stop", "paused"]]);
  await expect(panel.getByTestId("plan-schedule")).toContainText("Future visits stopped");
  const inPlace = schedule.getByTestId("visits-in-place");
  await expect(inPlace).toContainText("didn’t cancel these visits or their open offers");
  await expect(inPlace.getByRole("listitem")).toHaveText(["Tue, Nov 5, 2030, 9:00 AM EST · Waiting for the provider to accept this visit"]);
  await expect(schedule.getByRole("button", { name: /Pause plan|Resume plan|Stop future visits|Review anchor|Review new anchor/ })).toHaveCount(0);
  await expect(panel.getByText("Future visits for this plan were stopped.", { exact: true })).toBeVisible();
  await expect(schedule.getByRole("listitem").filter({ hasText: "Future visits stopped" })).toContainText("Reason: Homeowner ending service");
  expect(await axe(page)).toEqual([]);
});

test("homeowner: sees that the plan is paused and its cadence, with no schedule controls", async ({ page }) => {
  const state: State = { visits: [visit({})], history: [], calls: [], planState: "paused", anchor: { starts_at: "2030-11-05T14:00:00Z", local_start: "2030-11-05T09:00:00" } };
  const panel = (await open(page, "homeowner", state)).getByRole("region", { name: "Recurring visits" });
  await expect(panel.getByTestId("plan-schedule")).toHaveText("Paused · no new visits · Weekly, counted from Tue, Nov 5, 2030, 9:00 AM EST");
  await expect(panel.getByRole("region", { name: "Plan schedule" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Pause|Resume|Stop future visits|Skip/ })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});
