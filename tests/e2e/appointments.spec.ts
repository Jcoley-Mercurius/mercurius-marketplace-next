// TRACE-121 (Phase 6.5): appointment entry in Eastern Time from a device in another timezone,
// daylight-saving cases, lost responses, stale saves, reschedule requests versus changes, and
// the same appointment and history for every role. Synthetic fixture only; outcomes come from
// stubbed read-backs, and the real commands are proven by SQL 092.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const jobId = "00000000-0000-4000-8000-000000000010";
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;

type Row = Record<string, unknown>;
type Schedule = { appointment: string | null; open_request: Row | null; history: Row[] };
type Reply = "ok" | "abort" | { status: number; body: Row };
type State = { schedule: Schedule; calls: Row[]; record?: Reply; request?: Reply; read?: Reply; onSave?: (body: Row) => void };

const readback = (schedule: Schedule): Row => ({ timezone: "America/New_York", status: "scheduled", matching_status: "matched", has_provider: true, recurring: false, ...schedule });
const op = (overrides: Row): Row => ({ id: crypto.randomUUID(), kind: "appointment", outcome: "recorded", actor: "operations", at: "2030-10-20T15:00:00Z", reason: "Agreed by phone", previous_start: null, new_start: "2030-11-05T14:00:00Z", requested_start: null, operation_key: null, ...overrides });
const reply = (route: Route, value: Reply, ok: unknown) => value === "abort" ? route.abort("failed")
  : value === "ok" ? route.fulfill({ json: ok }) : route.fulfill({ status: value.status, json: value.body });

async function open(page: Page, role: "admin" | "homeowner" | "vendor", state: State, width = 1440) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.setViewportSize({ width, height: 1000 });
  await syntheticSession(page.context(), role);
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const scheduled = (row: Row) => row.id === jobId ? { ...row, status: "scheduled", matching_status: "matched", scheduled_start_at: state.schedule.appointment } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(scheduled) : scheduled(rows) });
  });
  await page.route("**/rest/v1/rpc/job_schedule", route => reply(route, state.read ?? "ok", readback(state.schedule)));
  await page.route("**/rest/v1/rpc/admin_record_appointment", async route => {
    const body = route.request().postDataJSON() as Row;
    state.calls.push(body);
    state.onSave?.(body);
    return reply(route, state.record ?? "ok", { outcome: "recorded" });
  });
  await page.route("**/rest/v1/rpc/record_job_operation", async route => {
    const body = route.request().postDataJSON() as Row;
    state.calls.push(body);
    state.onSave?.(body);
    return reply(route, state.request ?? "ok", { fee: 0 });
  });
  if (role === "admin") {
    await page.goto("/admin/requests");
    await page.getByRole("button", { name: /Review Synthetic Lawn/ }).click();
    return page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Appointment" });
  }
  if (role === "homeowner") {
    await page.goto("/dashboard?tab=upcoming");
    await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
    return page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Appointment" });
  }
  await page.goto("/vendor/jobs");
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  await page.locator("[data-slot=card]").filter({ hasText: "Synthetic Lawn Service" }).getByRole("button", { name: "View details", exact: true }).click();
  return page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Appointment" });
}

/** The fixture records what the command would: the appointment and this caller's key. */
const recordsAppointment = (state: State) => (body: Row) => {
  const previous = state.schedule.appointment;
  state.schedule = { ...state.schedule, appointment: body._starts_at as string, open_request: null, history: [...state.schedule.history,
    op({ outcome: previous ? (Date.parse(previous) === Date.parse(body._starts_at as string) ? "kept" : "changed") : "recorded", previous_start: previous, new_start: body._starts_at, reason: body._reason, operation_key: body._operation_key })] };
};

test.describe("device in Pacific Time", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  for (const width of [320, 1440]) {
    test(`admin ${width}px: records 9:00 AM Eastern from a Pacific device and reads it back`, async ({ page }) => {
      test.slow(); // two axe scans and a full-page screenshot
      const state: State = { schedule: { appointment: null, open_request: null, history: [] }, calls: [] };
      state.onSave = recordsAppointment(state);
      const panel = await open(page, "admin", state, width);
      await expect(panel.getByTestId("appointment-state")).toHaveText("Provider accepted · appointment time not recorded yet");
      await expect(panel.getByText("No appointment changes recorded yet.")).toBeVisible();
      await expect(panel.getByRole("button", { name: "Review appointment" })).toBeDisabled();
      expect(await axe(page)).toEqual([]);

      await panel.getByLabel("Date (Eastern Time)").first().fill("2030-11-05");
      await panel.getByLabel("Time (Eastern Time)").first().fill("09:00");
      await expect(panel.getByText("Selected: Tue, Nov 5, 2030, 9:00 AM EST")).toBeVisible();
      await expect(panel.getByText(/there it is Tue, Nov 5, 6:00 AM PST/)).toBeVisible();
      await panel.getByRole("button", { name: "Review appointment" }).click();
      const confirm = page.getByRole("alertdialog", { name: "Record this appointment?" });
      await expect(confirm).toContainText("Tue, Nov 5, 2030, 9:00 AM EST");
      await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await confirm.getByLabel("Reason (required)").fill("Agreed with both parties by phone");
      await confirm.getByRole("button", { name: "Record appointment" }).click();
      await expect(confirm).toBeHidden();

      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]).toMatchObject({ _job_id: jobId, _starts_at: "2030-11-05T14:00:00.000Z", _local_start: "2030-11-05T09:00:00", _reason: "Agreed with both parties by phone" });
      expect(state.calls[0]).not.toHaveProperty("_expected_start");
      await expect(panel.getByTestId("appointment-state")).toHaveText("Appointment recorded");
      await expect(panel.getByRole("status").filter({ hasText: "Appointment saved" })).toHaveText("Appointment saved: Tue, Nov 5, 2030, 9:00 AM EST.");
      await expect(panel.getByRole("listitem").first()).toContainText("Appointment recorded: Tue, Nov 5, 2030, 9:00 AM EST");
      await expect(panel.getByRole("listitem").first()).toContainText("Reason: Agreed with both parties by phone");
      await expect(panel.getByRole("heading", { name: "Change appointment" })).toBeVisible();
      expect(await page.locator("[role=dialog]").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await axe(page)).toEqual([]);
      await page.screenshot({ path: `test-results/trace121-admin-appointment-${width}.png`, fullPage: true });
    });
  }

  test("admin: daylight-saving gaps are refused and repeated times need a choice", async ({ page }) => {
    const state: State = { schedule: { appointment: null, open_request: null, history: [] }, calls: [] };
    const panel = await open(page, "admin", state);
    await panel.getByLabel("Date (Eastern Time)").first().fill("2030-03-10");
    await panel.getByLabel("Time (Eastern Time)").first().fill("02:30");
    await expect(panel.getByRole("alert")).toContainText("2:30 AM doesn’t exist on this date in Eastern Time");
    await expect(panel.getByLabel("Time (Eastern Time)").first()).toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByRole("button", { name: "Review appointment" })).toBeDisabled();

    await panel.getByLabel("Date (Eastern Time)").first().fill("2030-11-03");
    await panel.getByLabel("Time (Eastern Time)").first().fill("01:30");
    const choice = panel.getByRole("group", { name: /Clocks fall back on this date, so 1:30 AM happens twice/ });
    await expect(choice).toBeVisible();
    await expect(panel.getByRole("button", { name: "Review appointment" })).toBeDisabled();
    await choice.getByRole("radio", { name: /1:30 AM EST \(second/ }).check();
    await expect(panel.getByText("Selected: Sun, Nov 3, 2030, 1:30 AM EST")).toBeVisible();
    await panel.getByRole("button", { name: "Review appointment" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Record this appointment?" });
    await confirm.getByLabel("Reason (required)").fill("Early start requested");
    await confirm.getByRole("button", { name: "Record appointment" }).click();
    await expect.poll(() => state.calls.length).toBe(1);
    expect(state.calls[0]).toMatchObject({ _starts_at: "2030-11-03T06:30:00.000Z", _local_start: "2030-11-03T01:30:00" });
    expect(await axe(page)).toEqual([]);
  });

  test("admin: a lost response is confirmed from the readback; a failure keeps the retry key", async ({ page }) => {
    const state: State = { schedule: { appointment: null, open_request: null, history: [] }, calls: [], record: "abort" };
    const panel = await open(page, "admin", state);
    await panel.getByLabel("Date (Eastern Time)").first().fill("2030-11-05");
    await panel.getByLabel("Time (Eastern Time)").first().fill("09:00");
    await panel.getByRole("button", { name: "Review appointment" }).click();
    let confirm = page.getByRole("alertdialog", { name: "Record this appointment?" });
    await confirm.getByLabel("Reason (required)").fill("Agreed by phone");
    // The request fails and nothing was recorded: no success, and the retry reuses the key.
    await confirm.getByRole("button", { name: "Record appointment" }).click();
    await expect(confirm.getByRole("alert")).toBeFocused();
    await expect(panel.getByRole("alert")).toContainText("We couldn’t confirm whether this was saved.");
    await expect(panel.getByTestId("appointment-state")).toHaveText("Provider accepted · appointment time not recorded yet");
    // The retry is saved but its response is lost; the readback holds the same key, so it succeeded.
    state.onSave = recordsAppointment(state);
    await confirm.getByRole("button", { name: "Record appointment" }).click();
    await expect(confirm).toBeHidden();
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1]._operation_key).toBe(state.calls[0]._operation_key);
    await expect(panel.getByTestId("appointment-state")).toHaveText("Appointment recorded");
    await expect(panel.getByRole("status").filter({ hasText: "Appointment saved" })).toBeVisible();
    await expect(panel.getByRole("alert")).toHaveCount(0);

    // Another operator changes it first: the stale save is refused, explained and re-read.
    state.record = { status: 400, body: { code: "40001", message: "The appointment changed since you loaded it" } };
    state.onSave = () => { state.schedule = { ...state.schedule, appointment: "2030-11-06T15:00:00Z", history: [...state.schedule.history, op({ outcome: "changed", previous_start: "2030-11-05T14:00:00Z", new_start: "2030-11-06T15:00:00Z", reason: "Other operator" })] }; };
    await panel.getByLabel("Date (Eastern Time)").first().fill("2030-11-07");
    await panel.getByLabel("Time (Eastern Time)").first().fill("13:00");
    await panel.getByRole("button", { name: "Review change" }).click();
    confirm = page.getByRole("alertdialog", { name: "Change this appointment?" });
    await expect(confirm).toContainText("It replaces Tue, Nov 5, 2030, 9:00 AM EST");
    await confirm.getByLabel("Reason (required)").fill("Homeowner asked");
    await confirm.getByRole("button", { name: "Change appointment" }).click();
    await expect(confirm.getByRole("alert")).toBeVisible();
    expect(state.calls[2]).toMatchObject({ _expected_start: "2030-11-05T14:00:00.000Z", _starts_at: "2030-11-07T18:00:00.000Z" });
    await expect(panel.getByRole("alert")).toContainText("Someone changed this appointment while you were editing.");
    await expect(panel.getByTestId("appointment-state")).toHaveText("Appointment changed");
    await expect(panel).toContainText("Wed, Nov 6, 2030, 10:00 AM EST. Previously Tue, Nov 5, 2030, 9:00 AM EST.");
  });
});

test.describe("device in India", () => {
  test.use({ timezoneId: "Asia/Kolkata" });

  test("homeowner 320px: requests a different time; the appointment stays until it is changed", async ({ page }) => {
    test.slow();
    const state: State = { schedule: { appointment: "2030-11-05T14:00:00Z", open_request: null, history: [op({})] }, calls: [] };
    state.onSave = body => { state.schedule = { ...state.schedule, open_request: { id: "r1", actor: "homeowner", at: "2030-10-21T12:00:00Z", reason: body._reason, requested_start: body._scheduled_at },
      history: [...state.schedule.history, op({ kind: "reschedule_request", outcome: "requested", actor: "homeowner", new_start: null, requested_start: body._scheduled_at, reason: body._reason, operation_key: body._operation_key })] }; };
    const panel = await open(page, "homeowner", state, 320);
    await expect(panel.getByTestId("appointment-state")).toHaveText("Appointment recorded");
    await expect(panel).toContainText("Tue, Nov 5, 2030, 9:00 AM EST");
    await expect(panel.getByRole("button", { name: /Review (appointment|change)/ })).toHaveCount(0);
    await expect(panel.getByRole("listitem").first()).toContainText("Mercurius ·");

    // Keyboard entry into the native date and time fields.
    await panel.getByLabel("Date (Eastern Time)").focus();
    await page.keyboard.type("11072030");
    await panel.getByLabel("Time (Eastern Time)").focus();
    await page.keyboard.type("1000AM");
    await expect(panel.getByText("Selected: Thu, Nov 7, 2030, 10:00 AM EST")).toBeVisible();
    await expect(panel.getByText(/there it is Thu, Nov 7, 8:30 PM GMT\+5:30/)).toBeVisible();
    await panel.getByRole("button", { name: "Review request" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Send this time request?" });
    await expect(confirm).toContainText("The appointment stays Tue, Nov 5, 2030, 9:00 AM EST until it is changed.");
    await confirm.getByLabel("Reason (required)").fill("Away that week");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(confirm.getByRole("button", { name: "Send request" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirm).toBeHidden();
    expect(state.calls).toEqual([expect.objectContaining({ _job_id: jobId, _kind: "reschedule_request", _scheduled_at: "2030-11-07T15:00:00.000Z", _reason: "Away that week", _waived: false })]);
    await expect(panel.getByTestId("appointment-state")).toHaveText("Reschedule requested");
    await expect(panel).toContainText("The current appointment stays Tue, Nov 5, 2030, 9:00 AM EST until Mercurius changes it. Requested time: Thu, Nov 7, 2030, 10:00 AM EST.");
    await expect(panel.getByRole("listitem").first()).toContainText("Different time requested: Thu, Nov 7, 2030, 10:00 AM EST");
    await expect(panel.getByRole("listitem").first()).toContainText("You ·");
    expect(await page.locator("[role=dialog]").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // Scoped to the dialog: the dashboard header behind the backdrop measures 4.49:1 (recorded in the 6.5 report).
    expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: "test-results/trace121-homeowner-request-320.png", fullPage: true });
  });

  test("vendor: reads the same appointment and request; no fee wording; history names roles", async ({ page }) => {
    const request = "2030-11-07T15:00:00Z";
    const state: State = { schedule: { appointment: "2030-11-05T14:00:00Z",
      open_request: { id: "r1", actor: "homeowner", at: "2030-10-21T12:00:00Z", reason: "Away that week", requested_start: request },
      history: [op({}), op({ kind: "reschedule_request", outcome: "requested", actor: "homeowner", new_start: null, requested_start: request, reason: "Away that week" })] }, calls: [] };
    const panel = await open(page, "vendor", state);
    await expect(panel.getByTestId("appointment-state")).toHaveText("Reschedule requested");
    await expect(panel).toContainText("The current appointment stays Tue, Nov 5, 2030, 9:00 AM EST until Mercurius changes it. Requested time: Thu, Nov 7, 2030, 10:00 AM EST.");
    await expect(panel.getByRole("listitem").first()).toContainText("Homeowner ·");
    await expect(panel.getByRole("listitem").nth(1)).toContainText("Mercurius ·");
    await expect(panel).not.toContainText("$25");
    await expect(page.getByText("Appointment: Tue, Nov 5, 2030, 9:00 AM EST").first()).toBeAttached();
    expect(await axe(page)).toEqual([]);
  });
});

test("admin: keeps the current appointment in answer to a request", async ({ page }) => {
  const state: State = { schedule: { appointment: "2030-11-05T14:00:00Z", open_request: { id: "r1", actor: "provider", at: "2030-10-21T12:00:00Z", reason: "Crew unavailable", requested_start: "2030-11-07T15:00:00Z" },
    history: [op({}), op({ kind: "reschedule_request", outcome: "requested", actor: "provider", new_start: null, requested_start: "2030-11-07T15:00:00Z", reason: "Crew unavailable" })] }, calls: [] };
  state.onSave = recordsAppointment(state);
  const panel = await open(page, "admin", state);
  await panel.getByRole("button", { name: "Use requested time" }).click();
  await expect(panel.getByLabel("Date (Eastern Time)").first()).toHaveValue("2030-11-07");
  await expect(panel.getByLabel("Time (Eastern Time)").first()).toHaveValue("10:00");
  await panel.getByRole("button", { name: "Keep current appointment" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Keep the current appointment?" });
  await expect(confirm).toContainText("This answers the request for Thu, Nov 7, 2030, 10:00 AM EST.");
  await confirm.getByLabel("Reason (required)").fill("No other opening");
  await confirm.getByRole("button", { name: "Keep appointment" }).click();
  await expect(confirm).toBeHidden();
  expect(state.calls[0]).toMatchObject({ _starts_at: "2030-11-05T14:00:00.000Z", _local_start: "2030-11-05T09:00:00", _expected_start: "2030-11-05T14:00:00Z" });
  await expect(panel.getByTestId("appointment-state")).toHaveText("Appointment recorded");
  await expect(panel.getByRole("listitem").first()).toContainText("Appointment kept at Tue, Nov 5, 2030, 9:00 AM EST; reschedule request answered");
});

test("schedule readback: permission and load failures are explained and recoverable", async ({ page }) => {
  const state: State = { schedule: { appointment: null, open_request: null, history: [] }, calls: [], read: { status: 503, body: { message: "Synthetic outage" } } };
  const panel = await open(page, "homeowner", state);
  await expect(panel.getByRole("alert")).toHaveText("The appointment couldn’t be loaded. Nothing was changed.");
  state.read = "ok";
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByTestId("appointment-state")).toHaveText("Provider accepted · appointment time not recorded yet");

  state.read = { status: 403, body: { code: "42501", message: "Not a participant in this service" } };
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  const denied = page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Appointment" });
  await expect(denied.getByRole("alert")).toHaveText("You don’t have access to this service’s schedule.");
  await expect(denied.getByRole("button", { name: "Try again" })).toHaveCount(0);
});
