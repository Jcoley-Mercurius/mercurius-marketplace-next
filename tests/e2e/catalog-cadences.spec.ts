import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-110/111 (DEC-2026-035/036) synthetic browser evidence: the Service Catalog editor
// sets which cadences a service offers. The catalog row and the update are mocked; the
// database contract is SQL 081.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const service = {
  id: "synthetic-lawn", name: "Synthetic lawn care", category_id: "synthetic-outdoor", icon: "Leaf", descriptor: "Synthetic mowing",
  is_popular: false, is_active: true, weekly_price: 40, monthly_price: 120, one_time_price: 60, default_frequency: "weekly",
  available_frequencies: ["weekly", "monthly", "one-time"], sort_order: 0, pricing_mode: "fixed", default_deposit_amount: null,
};

test("the catalog editor offers every cadence and saves them in catalog order", async ({ page }) => {
  const updates: unknown[] = [];
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/service_categories?*", route => route.fulfill({ json: [
    { id: "synthetic-outdoor", name: "Synthetic outdoor", icon: "Leaf", description: "", sort_order: 0, is_active: true },
  ] }));
  await page.route("**/rest/v1/services_catalog?*", route => {
    if (route.request().method() === "PATCH") { updates.push(route.request().postDataJSON()); return route.fulfill({ status: 204, body: "" }); }
    return route.fulfill({ json: [service] });
  });
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/catalog");
  await page.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Service" });
  const offered = dialog.getByRole("group", { name: "Cadences offered" });
  await expect(offered.getByRole("checkbox", { name: "Weekly" })).toBeChecked();
  await expect(offered.getByRole("checkbox", { name: "Every two weeks" })).not.toBeChecked();
  await expect(offered.getByRole("checkbox", { name: "Every two months" })).not.toBeChecked();

  await offered.getByRole("checkbox", { name: "Every two months" }).check();
  await offered.getByRole("checkbox", { name: "Every two weeks" }).check();
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Service updated")).toBeVisible();
  expect(updates).toHaveLength(1);
  expect((updates[0] as { available_frequencies: string[] }).available_frequencies)
    .toEqual(["weekly", "bi-monthly", "monthly", "every-two-months", "one-time"]);
});

test("the catalog editor keeps the default cadence among those offered", async ({ page }) => {
  const updates: unknown[] = [];
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/service_categories?*", route => route.fulfill({ json: [
    { id: "synthetic-outdoor", name: "Synthetic outdoor", icon: "Leaf", description: "", sort_order: 0, is_active: true },
  ] }));
  await page.route("**/rest/v1/services_catalog?*", route => {
    if (route.request().method() === "PATCH") updates.push(route.request().postDataJSON());
    return route.fulfill({ json: [service] });
  });
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/catalog");
  await page.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Service" });
  await dialog.getByRole("group", { name: "Cadences offered" }).getByRole("checkbox", { name: "Weekly" }).uncheck();
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("The default cadence must be one the service offers.")).toBeVisible();
  expect(updates).toHaveLength(0);
});
