import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

async function portal(page: Page, role: "admin" | "vendor", theme = "light", width = 320) {
  await syntheticSession(page.context(), role);
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(role === "admin" ? "/admin/requests" : "/vendor/jobs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(role === "admin" ? "Service Requests" : "Jobs & Requests");
  await expect((role === "admin" && width === 1440 ? page.getByRole("table", { name: "Service requests", exact: true }) : page).getByText("Synthetic Lawn Service", { exact: true }).first()).toBeVisible();
}

for (const role of ["admin", "vendor"] as const) {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 1440]) {
      test(`${role} ${theme} ${width}px: accessible live-shaped records`, async ({ page }) => {
        await portal(page, role, theme, width);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (role === "admin") {
          await expect(page.getByRole(width === 320 ? "list" : "table", { name: "Service requests", exact: true })).toBeVisible();
        }
        await page.screenshot({ path: `test-results/${role}-${theme}-${width}.png`, fullPage: true });
      });
    }
  }
}

test("admin quote fields, nested confirmation and persistent action errors", async ({ page }) => {
  await portal(page, "admin");
  const review = page.getByRole("button", { name: /Review Synthetic Lawn/ });
  await review.click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await expect(dialog).toBeVisible();
  const quote = dialog.getByLabel("Total amount ($) (required)", { exact: true });
  await quote.fill("0");
  await dialog.getByRole("button", { name: "Send Quote", exact: true }).click();
  await expect(quote).toBeFocused();
  await expect(quote).toHaveAccessibleDescription("Enter a quote amount greater than $0.");
  const release = dialog.getByRole("button", { name: "Release match", exact: true });
  await release.click();
  const confirm = page.getByRole("alertdialog", { name: "Release this vendor?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(release).toBeFocused();
  await dialog.getByRole("button", { name: "Save Note", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Action could not be completed" })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(review).toBeFocused();
});

test("vendor confirmation, mobile navigation and completion upload failure", async ({ page }) => {
  await portal(page, "vendor", "dark");
  const menu = page.getByRole("button", { name: "Open vendor menu" });
  await menu.click();
  await expect(page.getByRole("dialog", { name: "Vendor navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  await decline.click();
  const confirm = page.getByRole("alertdialog", { name: "Decline this request?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Decline request", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(decline).toBeFocused();
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  const complete = page.getByRole("dialog", { name: "Complete Synthetic Pool Service" });
  await complete.locator('input[type="file"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("synthetic image fixture") });
  await expect(complete.getByRole("alert")).toContainText("Photo upload failed");
  await expect(complete.getByRole("alert")).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

test("portal guards still reject absent and wrong-role sessions", async ({ page }) => {
  await page.goto("/admin/requests");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await syntheticSession(page.context(), "homeowner");
  await page.goto("/vendor/jobs");
  await expect(page).toHaveURL(/\/dashboard$/);
});

for (const theme of ["light", "dark"]) {
  test(`admin ${theme}: status correction requires an audited reason`, async ({ page }) => {
    await portal(page, "admin", theme);
    await page.getByRole("button", { name: /Review Synthetic Lawn/ }).click();
    const detail = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
    await expect(detail.getByRole("button", { name: /Homeowner Confirmed/i })).toHaveCount(0);
    await detail.getByRole("button", { name: "Scheduled", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Change request status?" });
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Change to Scheduled" })).toBeDisabled();
    await confirm.getByLabel("Reason (required)").fill("Synthetic operator correction");
    const request = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/rpc/transition_job_status"));
    await confirm.getByRole("button", { name: "Change to Scheduled" }).click();
    expect((await request).postDataJSON()).toMatchObject({ _to_status: "scheduled", _reason: "Synthetic operator correction" });
    await expect(confirm.getByRole("alert")).toBeFocused();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/phase4-admin-${theme}.png`, fullPage: true });
  });
}


for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`provider compliance operations ${theme} ${width}px`, async ({ page }) => {
    await syntheticSession(page.context(), "admin");
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/compliance");
    await expect(page.getByRole("heading", { name: "Provider compliance" })).toBeVisible();
    await expect(page.getByText("Synthetic Vendor", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Evidence bound", { exact: true })).toBeVisible();
    await expect(page.getByText("Needs evidence", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finalize cutover" })).toBeDisabled();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.locator("main").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/provider-compliance-${theme}-${width}.png`, fullPage: true });
  });
}

test("compliance evidence reuse sends the reviewed IDs and preserves errors", async ({ page }) => {
  await syntheticSession(page.context(), "admin");
  await page.route("**/rpc/vendor_compliance_operations", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.evidence = [{ id: "00000000-0000-4000-8000-000000000043", contractor_id: data.providers[0].id,
      current: true, kind: "license", requirement_version: "LEE-2026", evidence_ref: "synthetic-vendor/license.pdf",
      accepted_at: new Date(Date.now()-3600000).toISOString(), expires_at: new Date(Date.now()+86400000).toISOString() }];
    await route.fulfill({ response, json: data });
  });
  await page.goto("/admin/compliance");
  await page.getByLabel("Requirement", { exact: true }).selectOption("00000000-0000-4000-8000-000000000041");
  const request = page.waitForRequest("**/rpc/vendor_bind_requirement_evidence");
  await page.getByRole("button", { name: "Reuse current license evidence" }).click();
  expect((await request).postDataJSON()).toEqual({
    p_contractor: "00000000-0000-4000-8000-000000000002",
    p_requirement: "00000000-0000-4000-8000-000000000041",
    p_evidence: "00000000-0000-4000-8000-000000000043",
  });
  await expect(page.getByText("Action could not be completed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Requirement", { exact: true })).toHaveValue("00000000-0000-4000-8000-000000000041");
  await expect(page.getByRole("button", { name: "Finalize cutover" })).toBeDisabled();
});

test("compliance exclusion requires a reason and keeps a failed confirmation open", async ({ page }) => {
  await syntheticSession(page.context(), "admin");
  await page.goto("/admin/compliance");
  await page.getByRole("button", { name: "Exclude from beta" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Exclude provider" })).toBeDisabled();
  await dialog.getByLabel("Reason (required)", { exact: true }).fill("Synthetic incomplete requirements");
  const request = page.waitForRequest("**/rpc/vendor_record_cutover_decision");
  await dialog.getByRole("button", { name: "Exclude provider" }).click();
  expect((await request).postDataJSON()).toMatchObject({ p_disposition: "excluded", p_reason: "Synthetic incomplete requirements" });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exclude from beta" })).toBeFocused();
});

test("compliance inclusion and finalization follow successful server readback", async ({ page }) => {
  await syntheticSession(page.context(), "admin");
  let included = false;
  let enforced = false;
  await page.route("**/rpc/vendor_compliance_operations", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.providers[0].scoped_current = true;
    data.providers[0].decision = included ? "included" : null;
    data.control.enforced = enforced;
    await route.fulfill({ response, json: data });
  });
  await page.route("**/rpc/vendor_record_cutover_decision", async route => {
    expect(route.request().postDataJSON()).toMatchObject({ p_disposition: "included", p_reason: "Synthetic reviewed provider" });
    included = true;
    await route.fulfill({ json: null });
  });
  await page.route("**/rpc/vendor_finalize_cutover", async route => {
    expect(route.request().postDataJSON()).toEqual({ p_reason: "Synthetic inventory reviewed" });
    enforced = true;
    await route.fulfill({ json: null });
  });
  await page.goto("/admin/compliance");
  await expect(page.getByRole("button", { name: "Finalize cutover" })).toBeDisabled();
  await page.getByRole("button", { name: "Include in beta" }).click();
  let dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Reason (required)", { exact: true }).fill("Synthetic reviewed provider");
  await dialog.getByRole("button", { name: "Include provider", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Include in beta" })).toBeDisabled();
  await page.getByRole("button", { name: "Finalize cutover" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Reason (required)", { exact: true }).fill("Synthetic inventory reviewed");
  await dialog.getByRole("button", { name: "Finalize strict matching", exact: true }).click();
  await expect(page.getByText("Finalized", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize cutover" })).toHaveCount(0);
});

test("compliance document review submits the observed evidence head", async ({ page }) => {
  await syntheticSession(page.context(), "admin");
  await page.route("**/rpc/vendor_compliance_operations", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.evidence = [{ id: "00000000-0000-4000-8000-000000000044", contractor_id: data.providers[0].id,
      current: false, kind: "insurance", requirement_version: "LEE-2026", evidence_ref: "synthetic-vendor/insurance.pdf",
      accepted_at: "2025-01-01T00:00:00Z", expires_at: "2025-02-01T00:00:00Z" }];
    await route.fulfill({ response, json: data });
  });
  await page.goto("/admin/compliance");
  await page.getByLabel("Requirement", { exact: true }).selectOption("00000000-0000-4000-8000-000000000042");
  await expect(page.getByRole("button", { name: "Reuse current insurance evidence" })).toHaveCount(0);
  await page.getByLabel("Private application document", { exact: true }).selectOption("synthetic-vendor/insurance.pdf");
  await page.getByLabel("Reviewed at", { exact: true }).fill("2026-01-01T10:00");
  await page.getByLabel("Evidence expires", { exact: true }).fill("2027-01-01T10:00");
  const request = page.waitForRequest("**/rpc/vendor_record_requirement_document");
  await page.getByRole("button", { name: "Record reviewed evidence" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    p_supersedes: "00000000-0000-4000-8000-000000000044", p_document_path: "synthetic-vendor/insurance.pdf",
    p_requirement: "00000000-0000-4000-8000-000000000042", p_contractor: "00000000-0000-4000-8000-000000000002",
  });
  await expect(page.getByText("Action could not be completed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Private application document", { exact: true })).toHaveValue("synthetic-vendor/insurance.pdf");
});
