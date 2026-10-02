// TRACE-105 (R0.5): the vendor application offers Lee County service areas only (CFG-001, DEC-2026-021).
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const leeCounty = [
  "Cape Coral", "Fort Myers", "Fort Myers Beach", "North Fort Myers", "Estero", "Lehigh Acres",
  "Bonita Springs", "Sanibel / Captiva", "Pine Island", "Alva", "Boca Grande",
];

// TRACE-105: categories and services come from the catalog; a synthetic catalog stands in.
async function routeCatalog(page: Page) {
  await page.route(/\/rest\/v1\/service_categories/, (route) => route.fulfill({ json: [
    { id: "cleaning", name: "Cleaning" }, { id: "lawn-landscape", name: "Lawn & Landscape" },
  ] }));
  await page.route(/\/rest\/v1\/services_catalog/, (route) => route.fulfill({ json: [
    { id: "pressure-washing", name: "Pressure Washing", category_id: "cleaning" },
    { id: "lawn-mowing", name: "Lawn Care", category_id: "lawn-landscape" },
    { id: "tree-trimming", name: "Tree Trimming", category_id: "lawn-landscape" },
  ] }));
}

async function openServiceAreaStep(page: Page) {
  await routeCatalog(page);
  await page.goto("/vendors/apply");
  await page.locator("#businessName").fill("Synthetic Lawn Test LLC");
  await page.locator("#primaryCategory").selectOption("Lawn & Landscape");
  await page.locator("#teamSize").selectOption("Just me");
  await page.locator("#years").fill("3");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#firstName").fill("Synthetic");
  await page.locator("#email").fill("synthetic.vendor@example.test");
  await page.locator("#phone").fill("239-555-0100");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Service Area" })).toBeVisible();
}

function areaGroup(page: Page) {
  return page.locator("div.space-y-3").filter({ hasText: "Areas you serve" }).first();
}

for (const width of [320, 1440]) {
  test(`service area step lists Lee County only at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openServiceAreaStep(page);
    await expect(page.getByText("Where you work in Lee County and what you offer.")).toBeVisible();
    await expect(areaGroup(page).getByRole("button")).toHaveText(leeCounty);
    for (const outside of ["Naples", "Punta Gorda"]) {
      await expect(page.getByRole("button", { name: outside, exact: true })).toHaveCount(0);
    }
    expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("selected Lee County areas reach review and the submission payload", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/vendor-applications", async (route) => {
    submitted = route.request().postDataJSON()?.application;
    await route.fulfill({ status: 400, json: { error: "Synthetic stop before persistence." } });
  });
  await openServiceAreaStep(page);
  await areaGroup(page).getByRole("button", { name: "Cape Coral", exact: true }).click();
  await areaGroup(page).getByRole("button", { name: "Pine Island", exact: true }).click();
  await page.getByRole("button", { name: "Lawn Care", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Cape Coral, Pine Island")).toBeVisible();
  await page.getByRole("button", { name: /submit/i }).click();
  await expect.poll(() => submitted?.service_areas).toBe("Cape Coral, Pine Island");
});

test("services come from the catalog, primary category first, with a described Other", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/vendor-applications", async (route) => {
    submitted = route.request().postDataJSON()?.application;
    await route.fulfill({ status: 400, json: { error: "Synthetic stop before persistence." } });
  });
  await openServiceAreaStep(page);
  await expect(page.getByRole("group").first()).toHaveAttribute("aria-label", "Lawn & Landscape");

  // Other alone does not satisfy the step.
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await page.locator("#otherServices").fill("Lanai rescreening");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose at least one service from our list, and describe any Other services.")).toBeVisible();

  const tree = page.getByRole("button", { name: "Tree Trimming", exact: true });
  await tree.click();
  await expect(tree).toHaveAttribute("aria-pressed", "true");
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Tree Trimming, Other: Lanai rescreening")).toBeVisible();
  await page.getByRole("button", { name: /submit/i }).click();
  await expect.poll(() => submitted?.services).toEqual(["tree-trimming", "Other: Lanai rescreening"]);
  expect(submitted?.primary_category).toBe("Lawn & Landscape");
});
