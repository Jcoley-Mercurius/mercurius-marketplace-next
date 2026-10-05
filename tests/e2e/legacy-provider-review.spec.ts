// TRACE-105 / DEC-2026-027: legacy provider review without an application. Synthetic
// readbacks only; the server's list, refusals and checklist rules are covered in SQL 074.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const contractor = "00000000-0000-4000-8000-000000000074";
const ready = { listed: true, started: false, onboarding: false, contact: true, excluded: false, live_attempt: false, open_application: false };

async function open(page: Page, status: Record<string, unknown>, width = 1440) {
  const state = { status, started: false, starts: [] as Record<string, unknown>[] };
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: contractor, name: "Synthetic Legacy Vendor", services: [], badges: [], is_active: true } }));
  for (const path of ["contractor_gallery", "contractor_service_zips", "coverage_areas", "vendor_applications"])
    await page.route(`**/rest/v1/${path}?*`, route => route.fulfill({ json: [] }));
  await page.route("**/rpc/get_contractor_contact", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/r0_legacy_review_status", route => route.fulfill({ json: state.started ? { ...state.status, started: true, onboarding: true } : state.status }));
  await page.route("**/rpc/r0_start_legacy_provider_review", route => {
    state.starts.push(route.request().postDataJSON());
    state.started = true;
    return route.fulfill({ json: { contractor_id: contractor, onboarding_status: "review", onboarding_revision: 1, created: true } });
  });
  await page.route("**/rpc/vendor_onboarding_checklist", route => state.started
    ? route.fallback()
    : route.fulfill({ status: 400, json: { message: "Onboarding record not found" } }));
  await page.route("**/rpc/vendor_renewal_document_overview", route => route.fulfill({ json: {
    contractor_id: contractor, onboarding_status: state.started ? "review" : null, operator_upload: state.started, open_limit: 5, documents: [],
  } }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/admin/vendors/${contractor}`);
  await expect(page.getByText("This provider is not under onboarding review", { exact: false })).toBeVisible();
  return state;
}

for (const width of [320, 1440]) {
  test(`a listed legacy provider starts review and gets the operator upload at ${width}px`, async ({ page }) => {
    const state = await open(page, ready, width);
    await expect(page.getByText("Legacy provider (DEC-2026-027)", { exact: false })).toBeVisible();
    // Scoped to this slice's panel; the vendor page's Visibility switches carry a
    // pre-existing unnamed-switch defect (button-name), recorded in the handoff.
    expect((await new AxeBuilder({ page }).include('[aria-label="Legacy provider review"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Start legacy review", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Start onboarding review for this legacy provider?" });
    await expect(dialog.getByText("No email, evidence, approval, role change or public listing results.", { exact: false })).toBeVisible();
    await dialog.getByRole("textbox", { name: /^Reason/ }).fill("Documents and agreement on file (synthetic)");
    await dialog.getByRole("button", { name: "Start review", exact: true }).click();
    await expect(page.getByText("0 of 9 current")).toBeVisible();
    await expect(page.getByText("Upload a document the provider sent Mercurius directly", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start legacy review" })).toHaveCount(0);
    expect(state.starts).toHaveLength(1);
    expect(state.starts[0]).toMatchObject({ p_contractor: contractor, p_reason: "Documents and agreement on file (synthetic)" });
    expect(String(state.starts[0].p_key)).toMatch(new RegExp(`^legacy-review:${contractor}:`));
    await page.screenshot({ path: `test-results/legacy-provider-review-${width}.png`, fullPage: true });
  });
}

test("a blocked legacy provider sees why and cannot start", async ({ page }) => {
  await open(page, { ...ready, live_attempt: true });
  await expect(page.getByText("Close the live access invitation first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start legacy review", exact: true })).toBeDisabled();
});

test("a provider outside the legacy list is not offered the start", async ({ page }) => {
  await open(page, { listed: false });
  await expect(page.getByRole("button", { name: "Start legacy review" })).toHaveCount(0);
});
