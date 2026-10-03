import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-065 synthetic browser evidence; the fixture never claims a real mutation.
const application = "00000000-0000-4000-8000-000000000050";
const version = "00000000-0000-4000-8000-000000000051";
const contractor = "00000000-0000-4000-8000-000000000052";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

async function openApplication(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Applications" })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("button", { name: "Start onboarding review" })).toBeVisible();
  return dialog;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`onboarding review start ${theme} ${width}px`, async ({ page }) => {
    const dialog = await openApplication(page, theme, width);
    await expect(dialog.getByText("Approve & Send Invite")).toHaveCount(0);
    await expect(dialog.getByText("No account, vendor access, invitation or public listing is created.", { exact: false })).toBeVisible();
    // Scoped to this slice's surface. The queue table behind it carries a pre-existing
    // fixed light palette that fails dark-theme contrast; recorded in the slice report.
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/onboarding-intake-${theme}-${width}.png`, fullPage: true });
  });
}

test("onboarding start requires a reason and keeps a failed confirmation open with one retry key", async ({ page }) => {
  const dialog = await openApplication(page);
  await dialog.getByRole("button", { name: "Start onboarding review" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Start onboarding review?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(confirm.getByRole("button", { name: "Start review", exact: true })).toBeDisabled();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic intake reviewed");
  const first = page.waitForRequest("**/rpc/vendor_start_onboarding_review");
  await confirm.getByRole("button", { name: "Start review", exact: true }).click();
  const sent = (await first).postDataJSON();
  expect(sent).toMatchObject({ p_application: application, p_expected_version: version, p_reason: "Synthetic intake reviewed" });
  expect(sent.p_key).toMatch(/^onboarding-review:[0-9a-f-]{36}$/);
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="alertdialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  const retry = page.waitForRequest("**/rpc/vendor_start_onboarding_review");
  await confirm.getByRole("button", { name: "Start review", exact: true }).click();
  expect((await retry).postDataJSON().p_key).toBe(sent.p_key);
  await expect(confirm).toBeVisible();
});

test("onboarding start success follows server readback", async ({ page }) => {
  let started = false;
  await page.route("**/rpc/vendor_start_onboarding_review", async route => {
    started = true;
    await route.fulfill({ json: { contractor_id: contractor, onboarding_status: "review", onboarding_revision: 1, created: true } });
  });
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    if (started) Object.assign(data, { contractor_id: contractor, onboarding_status: "review", onboarding_revision: 1, onboarding_version_id: version, review_started: true });
    await route.fulfill({ response, json: data });
  });
  const dialog = await openApplication(page);
  await dialog.getByRole("button", { name: "Start onboarding review" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Start onboarding review?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic intake reviewed");
  await confirm.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  // TRACE-105: the header follows onboarding while the legacy status column still says pending.
  await expect(dialog.locator('[data-slot="dialog-header"]').getByText("In review", { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-slot="dialog-header"]').getByText("pending", { exact: false })).toHaveCount(0);
  await expect(dialog.getByText("Revision 1.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start onboarding review" })).toHaveCount(0);
});

test("onboarding start without confirming readback stays open", async ({ page }) => {
  await page.route("**/rpc/vendor_start_onboarding_review", route =>
    route.fulfill({ json: { contractor_id: contractor, onboarding_status: "review", onboarding_revision: 1, created: true } }));
  const dialog = await openApplication(page);
  await dialog.getByRole("button", { name: "Start onboarding review" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Start onboarding review?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic intake reviewed");
  await confirm.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeVisible();
  await expect(confirm).toBeVisible();
});

// TRACE-105: an application from an access-managed provider's confirmed contact opens
// review on that provider's record.
const existingProvider = "00000000-0000-4000-8000-000000000053";

async function asExistingProvider(page: Page, bound: boolean, started: () => boolean = () => false) {
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.existing_provider = { contractor_id: existingProvider, name: "Synthetic Existing Provider", bound, onboarding: started(), excluded: false, live_attempt: false };
    if (started()) Object.assign(data, { contractor_id: existingProvider, onboarding_status: "review", onboarding_revision: 1, onboarding_version_id: version, review_started: true });
    await route.fulfill({ response, json: data });
  });
}

async function openExisting(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/applications");
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("button", { name: "Start review for existing provider" })).toBeVisible();
  return dialog;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`existing provider review start ${theme} ${width}px`, async ({ page }) => {
    await asExistingProvider(page, true);
    const dialog = await openExisting(page, theme, width);
    await expect(dialog.getByRole("link", { name: "Synthetic Existing Provider" })).toHaveAttribute("href", `/admin/vendors/${existingProvider}`);
    await expect(dialog.getByText("Review opens on that provider's record, not a new one.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Start onboarding review" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}

test("existing provider without a reviewed binding cannot start review", async ({ page }) => {
  await asExistingProvider(page, false);
  const dialog = await openExisting(page);
  await expect(dialog.getByText("has no reviewed account binding yet", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start review for existing provider" })).toBeDisabled();
});

test("existing provider start names the provider and follows server readback", async ({ page }) => {
  let started = false;
  await asExistingProvider(page, true, () => started);
  await page.route("**/rpc/r0_start_existing_provider_review", async route => {
    started = true;
    await route.fulfill({ json: { contractor_id: existingProvider, onboarding_status: "review", onboarding_revision: 1, created: true, existing_provider: true } });
  });
  const dialog = await openExisting(page);
  await dialog.getByRole("button", { name: "Start review for existing provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Start onboarding review for the existing provider?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Existing provider applied");
  const request = page.waitForRequest("**/rpc/r0_start_existing_provider_review");
  await confirm.getByRole("button", { name: "Start review", exact: true }).click();
  const sent = (await request).postDataJSON();
  expect(sent).toMatchObject({ p_application: application, p_expected_version: version, p_contractor: existingProvider, p_reason: "Existing provider applied" });
  expect(sent.p_key).toMatch(/^onboarding-review:[0-9a-f-]{36}$/);
  await expect(confirm).not.toBeVisible();
  await expect(dialog.getByText("Revision 1.", { exact: false })).toBeVisible();
  // The account came through the access binding: no linking or invitation panels.
  await expect(dialog.getByRole("heading", { name: "Provider account" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Provider invitation" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Activation checklist" })).toBeVisible();
});
