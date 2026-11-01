import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.setViewportSize({ width: 320, height: 900 });
});

for (const theme of ["light", "dark"]) {
  test(`Phase 4 ${theme}: operation reason, policy, retry key and error focus`, async ({ page }) => {
    await syntheticSession(page.context(), "admin");
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.goto("/admin/requests");
    await page.getByRole("button", { name: /Review Synthetic Lawn/ }).click();
    const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
    await dialog.getByLabel("Change", { exact: false }).selectOption("customer_cancel");
    // TRACE-131: the consequence is the server preview of the assessed command.
    await expect(dialog.getByText(/Refund under the policy: 50%/)).toBeVisible();
    await dialog.getByRole("button", { name: "Review service change" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Record this service change?" });
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Record change" })).toBeDisabled();
    await confirm.getByLabel("Reason (required)").fill("Synthetic cancellation reason");
    const first = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/rpc/record_job_operation"));
    await confirm.getByRole("button", { name: "Record change" }).click();
    const payload = (await first).postDataJSON();
    expect(payload).toMatchObject({ _kind: "customer_cancel", _reason: "Synthetic cancellation reason", _waived: false, _expected: { status: "matched" } });
    await expect(confirm.getByRole("alert")).toBeFocused();
    const retry = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/rpc/record_job_operation"));
    await confirm.getByRole("button", { name: "Record change" }).click();
    expect((await retry).postDataJSON()._operation_key).toBe(payload._operation_key);
    await expect(confirm.getByRole("alert")).toBeFocused();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/phase4-operations-${theme}.png`, fullPage: true });
  });
}

test("Phase 4: homeowner fallback requires explicit confirmation", async ({ page }) => {
  await syntheticSession(page.context(), "homeowner");
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    await route.fulfill({ response, json: rows.map((row: { id: string }) => row.id.endsWith("010") ? { ...row, matching_status: "awaiting_consent" } : row) });
  });
  // TRACE-099: the outcome is read from the consent record; none exists here, so it isn't saved.
  await page.route("**/rest/v1/matching_fallback_consents?**", route => route.fulfill({ json: [] }));
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  await expect(page.getByText("Awaiting provider", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow another provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Allow another provider?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  const request = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/rpc/consent_to_provider_fallback"));
  await confirm.getByRole("button", { name: "Allow other providers" }).click();
  expect((await request).postDataJSON()._request_id).toBe("00000000-0000-4000-8000-000000000010");
  await expect(confirm.getByRole("alert")).toBeFocused();
});

test("Phase 4: resolution remains visible while homeowner appeals", async ({ page }) => {
  await syntheticSession(page.context(), "homeowner");
  await page.route("**/rest/v1/disputes?**", route => route.fulfill({ json: [{ id: "00000000-0000-4000-8000-000000000080" }] }));
  // TRACE-133: the decision, its version and the appeal right come from dispute_detail.
  await page.route("**/rest/v1/rpc/dispute_detail", route => route.fulfill({ json: {
    job_id: "00000000-0000-4000-8000-000000000010", viewer: "homeowner", status: "completed", checked_at: "2030-11-01T15:00:00Z", vendor_completed_at: "2030-10-30T15:00:00Z",
    disputes: [{ dispute_id: "00000000-0000-4000-8000-000000000080", status: "resolved", raised_at: "2030-10-31T15:00:00Z", reason: "Synthetic issue",
      completion_at: "2030-10-30T15:00:00Z", window_ends_at: "2030-11-01T15:00:00Z", resolution_version: 2, resolution_notes: "Synthetic original decision",
      resolved_at: "2030-11-01T14:00:00Z", ticket_number: "TKT-080", decisions: [], appeals: [], can_appeal: true, can_submit: false, submissions: [] }],
    refund: { payment_record: true, authorization: "none", movement: "none" }, payout: { state: "dispute_hold" } } }));
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  await expect(page.getByText("Synthetic original decision")).toBeVisible();
  await expect(page.getByText("No refund has been authorized.")).toBeVisible();
  await page.getByRole("button", { name: "Appeal this decision" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Appeal this decision?" });
  await confirm.getByLabel("Reason (required)").fill("Synthetic appeal evidence");
  const request = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/rpc/appeal_dispute_resolution"));
  await confirm.getByRole("button", { name: "Submit appeal", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ _reason: "Synthetic appeal evidence", _expected_version: 2 });
  await expect(confirm.getByRole("alert")).toBeFocused();
});

test("Phase 4: quoted vendor offer guidance agrees with the acceptance control", async ({ page }) => {
  await syntheticSession(page.context(), "vendor");
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    await route.fulfill({ response, json: rows.map((row: { id: string }) => row.id.endsWith("010") ? { ...row, status: "quoted", matching_status: "offered" } : row) });
  });
  await page.goto("/vendor/jobs");
  await expect(page.getByRole("button", { name: "Accept offer", exact: true })).toBeEnabled();
  await expect(page.getByText(/Accepting commits you to this request/)).toBeVisible();
  await expect(page.getByText("Not open for a response", { exact: true })).toHaveCount(0);
});
