import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const attempt = "d4000000-0000-4000-8000-000000000001";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(
      new URL(route.request().url()).origin,
    )
      ? route.continue()
      : route.abort(),
  );
});
for (const [theme, width] of [
  ["light", 320],
  ["dark", 1440],
] as const) {
  test(`invitation acceptance ${theme} ${width}px`, async ({ page }) => {
    await syntheticSession(page.context(), "homeowner");
    await page.addInitScript(
      (theme) => localStorage.setItem("theme", theme),
      theme,
    );
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    await page.route("**/functions/v1/vendor-invite", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        action: "accept",
        attempt_id: attempt,
      });
      requests++;
      await route.fulfill({ json: { status: "accepted", activated: false } });
    });
    await page.goto(`/invitation?attempt=${attempt}`);
    await expect(
      page.getByRole("button", { name: "Accept invitation" }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page
        .locator("main")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/invitation-${theme}-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      page.getByRole("heading", { name: "Invitation accepted" }),
    ).toBeVisible();
    await expect(
      page.getByText("Your acceptance has been recorded.", { exact: false }),
    ).toBeVisible();
    expect(requests).toBe(1);
  });
}
test("invitation failure remains retryable without showing activation", async ({
  page,
}) => {
  await syntheticSession(page.context(), "homeowner");
  await page.goto(`/invitation?attempt=${attempt}`);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be accepted");
  await expect(
    page.getByRole("button", { name: "Accept invitation" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Invitation accepted" }),
  ).toHaveCount(0);
});
test("invitation needs a valid link and authenticated recipient", async ({
  page,
}) => {
  await page.goto("/invitation?attempt=invalid");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("incomplete");
  await expect(
    page.getByRole("button", { name: "Accept invitation" }),
  ).toHaveCount(0);
  await page.goto(`/invitation?attempt=${attempt}`);
  await expect(
    page.getByRole("link", { name: "Sign in to continue" }),
  ).toHaveAttribute(
    "href",
    `/login?redirect=${encodeURIComponent(`/invitation?attempt=${attempt}`)}`,
  );
});

test("password setup preserves the invitation and requires explicit acceptance", async ({
  page,
}) => {
  await syntheticSession(page.context(), "homeowner");
  let acceptances = 0;
  await page.route("**/functions/v1/vendor-invite", async (route) => {
    acceptances++;
    await route.fulfill({ json: { status: "accepted", activated: false } });
  });
  await page.goto(`/set-password?invitation=${attempt}&redirect=%2Fdashboard`);
  await page
    .getByLabel("New password", { exact: true })
    .fill("Synthetic-only-Password-42");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("Synthetic-only-Password-42");
  await page.getByRole("button", { name: "Set password & continue" }).click();
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
  await expect(page).toHaveURL(`/invitation?attempt=${attempt}`, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Accept invitation" }),
  ).toBeVisible();
  expect(acceptances).toBe(0);
});
