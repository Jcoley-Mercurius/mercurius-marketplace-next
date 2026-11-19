import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-156: assigning saved provider photos to services in the vendor and operator portals.
// Every row here is a stateful mock of the reads and commands the pages use. The database contract,
// including ownership, role and provider/service validity, is SQL 122.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const contractor = "00000000-0000-4000-8000-000000000002";
const shots = "test-results/photo-service-assignment";
const photoImage = (fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${fill}"/></svg>`)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

type Photo = { id: string; image_url: string; caption: string | null; sort_order: number; service_ids: string[] };
type Option = { service_id: string; service_name: string; is_applicable: boolean };
type World = {
  photos: Photo[];
  options: Option[];
  saves: Record<string, unknown>[];
  failSaves: number;
  failOptions: number;
};

const serviceOptions: Option[] = [
  { service_id: "gutter-cleaning", service_name: "Gutter cleaning", is_applicable: true },
  { service_id: "pool-service", service_name: "Pool service", is_applicable: true },
  { service_id: "window-cleaning", service_name: "Window cleaning", is_applicable: true },
];
const existingPhotos = (): Photo[] => [
  { id: "00000000-0000-4000-8000-0000000000a1", image_url: photoImage("#28536b"), caption: "Cleared gutter run", sort_order: 0, service_ids: [] },
  { id: "00000000-0000-4000-8000-0000000000a2", image_url: photoImage("#6b3d28"), caption: "Pool deck", sort_order: 1, service_ids: ["pool-service"] },
];
const asRow = ({ service_ids, ...photo }: Photo) => ({ ...photo, contractor_gallery_services: service_ids.map((service_id) => ({ service_id })) });

async function serve(page: Page, role: "vendor" | "admin", overrides: Partial<World> = {}) {
  const world: World = { photos: existingPhotos(), options: serviceOptions, saves: [], failSaves: 0, failOptions: 0, ...overrides };
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.protocol === "data:" || ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(url.origin) ? route.continue() : route.abort();
  });
  await page.route("**/rest/v1/contractors?*", (route) => route.fulfill({ json: {
    id: contractor, name: "Synthetic Gutter Co", user_id: "00000000-0000-4000-8000-000000000004", logo_url: null, bio: "Synthetic description", location: "Cape Coral, FL",
    services: ["gutter-cleaning", "pool-service", "window-cleaning"], badges: [], years_experience: 5, our_promise: null, verified_specialty: null,
    tagline: null, website: null, video_url: null, is_active: true, marketing_enabled: true,
  } }));
  for (const table of ["contractor_service_zips", "coverage_areas"]) await page.route(`**/rest/v1/${table}?*`, (route) => route.fulfill({ json: [] }));
  await page.route("**/rpc/get_contractor_contact", (route) => route.fulfill({ json: [{ email: "vendor@example.invalid", phone: "555-0100" }] }));
  await page.route("**/rest/v1/contractor_gallery?*", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { image_url: string; sort_order: number };
      const photo: Photo = { id: `00000000-0000-4000-8000-0000000001${String(world.photos.length).padStart(2, "0")}`, image_url: photoImage("#3f5b4b"), caption: null, sort_order: body.sort_order, service_ids: [] };
      world.photos.push(photo);
      return route.fulfill({ status: 201, json: asRow(photo) });
    }
    return route.fulfill({ json: world.photos.map(asRow) });
  });
  await page.route("**/rpc/contractor_photo_service_options", (route) => {
    if (world.failOptions > 0) {
      world.failOptions -= 1;
      return route.fulfill({ status: 503, json: { message: "Synthetic outage" } });
    }
    return route.fulfill({ json: world.options });
  });
  await page.route("**/rpc/set_contractor_gallery_photo_services", (route) => {
    const body = route.request().postDataJSON() as { p_gallery_id: string; p_service_ids: string[] };
    world.saves.push(body);
    if (world.failSaves > 0) {
      world.failSaves -= 1;
      return route.fulfill({ status: 400, json: { code: "22023", message: "That service is not available for this provider" } });
    }
    const saved = [...new Set(body.p_service_ids)].sort();
    world.photos = world.photos.map((photo) => photo.id === body.p_gallery_id ? { ...photo, service_ids: saved } : photo);
    return route.fulfill({ json: saved });
  });
  await page.route("**/storage/v1/object/sign/**", (route) => route.fulfill({ json: { signedURL: "/object/sign/vendor-media/synthetic.png?token=synthetic" } }));
  await page.route("**/storage/v1/object/vendor-media/**", (route) => route.fulfill({ json: { Id: "synthetic", Key: "vendor-media/synthetic.png" } }));
  await syntheticSession(page.context(), role);
  await page.goto(role === "vendor" ? "/vendor/profile" : `/admin/vendors/${contractor}`);
  await expect(page.locator("[data-photo-services]").first()).toBeVisible({ timeout: 20_000 });
  return world;
}

const tile = (page: Page, name: string) => page.locator("figure, div.space-y-2").filter({ has: page.getByRole("button", { name: `Edit services for ${name}` }) }).last();
const label = (page: Page, name: string) => tile(page, name).locator("[data-photo-services]");
const editor = (page: Page) => page.getByRole("dialog", { name: "Services in this photo" });
async function edit(page: Page, name: string) {
  await page.getByRole("button", { name: `Edit services for ${name}` }).click();
  await expect(editor(page)).toBeVisible();
}
const upload = (page: Page) => page.locator('input[type="file"][multiple]').setInputFiles({ name: "new-work.png", mimeType: "image/png", buffer: png });

for (const role of ["vendor", "admin"] as const) {
  test(`${role}: links an existing photo to several services and the choice survives a reload`, async ({ page }) => {
    const world = await serve(page, role);
    await expect(label(page, "Cleared gutter run")).toHaveText("Shown for: General business");
    await edit(page, "Cleared gutter run");
    await editor(page).getByRole("checkbox", { name: "Gutter cleaning" }).check();
    await editor(page).getByRole("checkbox", { name: "Window cleaning" }).check();
    await editor(page).getByRole("button", { name: "Save services" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(label(page, "Cleared gutter run")).toHaveText("Shown for: Gutter cleaning, Window cleaning");
    // The command names a photo and services only. Ownership and role are the server's to decide.
    expect(world.saves).toEqual([{ p_gallery_id: existingPhotos()[0].id, p_service_ids: ["gutter-cleaning", "window-cleaning"] }]);
    expect(world.photos).toHaveLength(2);

    await page.reload();
    await expect(label(page, "Cleared gutter run")).toHaveText("Shown for: Gutter cleaning, Window cleaning");
    await expect(label(page, "Pool deck")).toHaveText("Shown for: Pool service");
  });

  test(`${role}: a new upload is saved with the chosen services`, async ({ page }) => {
    const world = await serve(page, role);
    const picker = page.locator("[data-new-photo-services]");
    await expect(picker).toContainText("Nothing selected: new photos will be saved as General business.");
    await picker.getByRole("checkbox", { name: "Pool service" }).check();
    await picker.getByRole("checkbox", { name: "Gutter cleaning" }).check();
    await expect(picker).toContainText("New photos will be saved for: Gutter cleaning, Pool service.");
    await upload(page);
    await expect(page.locator("[data-photo-services]")).toHaveCount(3);
    await expect(page.locator("[data-photo-services]").nth(2)).toHaveText("Shown for: Gutter cleaning, Pool service");
    expect(world.saves).toHaveLength(1);
    expect((world.saves[0] as { p_service_ids: string[] }).p_service_ids.sort()).toEqual(["gutter-cleaning", "pool-service"]);
    // The choice applies to that batch only.
    await expect(picker.getByRole("checkbox", { name: "Pool service" })).not.toBeChecked();
  });

  test(`${role}: a new upload with no service stays General business`, async ({ page }) => {
    const world = await serve(page, role);
    await upload(page);
    await expect(page.locator("[data-photo-services]")).toHaveCount(3);
    await expect(page.locator("[data-photo-services]").nth(2)).toHaveText("Shown for: General business");
    expect(world.saves).toEqual([]);
  });
}

test("clearing every service returns a photo to General business", async ({ page }) => {
  await serve(page, "vendor");
  await edit(page, "Pool deck");
  await editor(page).getByRole("checkbox", { name: "Pool service" }).uncheck();
  await editor(page).getByRole("button", { name: "Save services" }).click();
  await expect(label(page, "Pool deck")).toHaveText("Shown for: General business");
});

test("cancelling leaves the saved services alone", async ({ page }) => {
  const world = await serve(page, "vendor");
  await edit(page, "Pool deck");
  await editor(page).getByRole("checkbox", { name: "Gutter cleaning" }).check();
  await editor(page).getByRole("button", { name: "Cancel" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(label(page, "Pool deck")).toHaveText("Shown for: Pool service");
  expect(world.saves).toEqual([]);
  await edit(page, "Pool deck");
  await expect(editor(page).getByRole("checkbox", { name: "Gutter cleaning" })).not.toBeChecked();
});

test("a refused save keeps the dialog open, says so and changes nothing", async ({ page }) => {
  const world = await serve(page, "vendor", { failSaves: 1 });
  await edit(page, "Pool deck");
  await editor(page).getByRole("checkbox", { name: "Gutter cleaning" }).check();
  await editor(page).getByRole("button", { name: "Save services" }).click();
  await expect(editor(page).getByRole("alert")).toHaveText("These services could not be saved. The photo is unchanged. Please try again.");
  expect(world.photos[1].service_ids).toEqual(["pool-service"]);
  await editor(page).getByRole("button", { name: "Save services" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(label(page, "Pool deck")).toHaveText("Shown for: Gutter cleaning, Pool service");
  expect(world.saves).toHaveLength(2);
});

test("a new photo whose services fail to save is reported as General business", async ({ page }) => {
  await serve(page, "vendor", { failSaves: 1 });
  await page.locator("[data-new-photo-services]").getByRole("checkbox", { name: "Pool service" }).check();
  await upload(page);
  await expect(page.locator("[data-photo-services]")).toHaveCount(3);
  await expect(page.locator("[data-photo-services]").nth(2)).toHaveText("Shown for: General business");
  await expect(page.getByText("1 photo was saved as General business")).toBeVisible();
  // The choice stays so the person can see what was intended and try again.
  await expect(page.locator("[data-new-photo-services]").getByRole("checkbox", { name: "Pool service" })).toBeChecked();
});

test("a withdrawn service is labelled on the photo that names it and offered nowhere else", async ({ page }) => {
  const options = [...serviceOptions, { service_id: "lawn-care", service_name: "Lawn care", is_applicable: false }];
  const photos = existingPhotos();
  photos[1].service_ids = ["lawn-care"];
  await serve(page, "vendor", { options, photos });
  await expect(page.locator("[data-new-photo-services]").getByRole("checkbox", { name: /Lawn care/ })).toHaveCount(0);
  await edit(page, "Pool deck");
  await expect(editor(page).getByRole("checkbox", { name: "Lawn care (no longer offered)" })).toBeChecked();
  await editor(page).getByRole("button", { name: "Cancel" }).click();
  await edit(page, "Cleared gutter run");
  await expect(editor(page).getByRole("checkbox", { name: /Lawn care/ })).toHaveCount(0);
});

test("unavailable services can be retried and never block the photo itself", async ({ page }) => {
  await serve(page, "vendor", { failOptions: 1 });
  const picker = page.locator("[data-new-photo-services]");
  await expect(picker.getByRole("alert")).toContainText("Services could not be loaded. New photos will be saved as General business.");
  await expect(label(page, "Pool deck")).toHaveText("Shown for: 1 service");
  await picker.getByRole("button", { name: "Try again" }).click();
  await expect(picker.getByRole("checkbox", { name: "Pool service" })).toBeVisible();
  await expect(label(page, "Pool deck")).toHaveText("Shown for: Pool service");
});

test("a provider with no services keeps photos General business and says why", async ({ page }) => {
  await serve(page, "vendor", { options: [] });
  await expect(page.locator("[data-new-photo-services]")).toContainText("No services to choose yet.");
  await edit(page, "Cleared gutter run");
  await expect(editor(page)).toContainText("This photo stays General business.");
  await expect(editor(page).getByRole("button", { name: "Save services" })).toBeDisabled();
});

for (const width of [320, 768, 1440]) {
  test(`assignment at ${width}px: axe, keyboard focus and reflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await serve(page, "vendor");
    const section = page.locator('section[aria-labelledby="gallery-heading"]');
    await section.scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).include('section[aria-labelledby="gallery-heading"]').withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await section.screenshot({ path: `${shots}/vendor-gallery-${width}.png` });

    const trigger = page.getByRole("button", { name: "Edit services for Pool deck" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(editor(page)).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(tags).analyze()).violations).toEqual([]);
    const box = (await editor(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${shots}/vendor-editor-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(editor(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
