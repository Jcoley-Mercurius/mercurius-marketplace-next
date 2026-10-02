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
    `/login/vendor?redirect=${encodeURIComponent(`/invitation?attempt=${attempt}`)}`,
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

// TRACE-105: access to an existing business profile uses its own wording and receipt.
for (const [theme, width] of [
  ["light", 320],
  ["dark", 1440],
] as const) {
  test(`existing-provider access acceptance ${theme} ${width}px`, async ({ page }) => {
    await syntheticSession(page.context(), "homeowner");
    await page.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    let requests = 0;
    await page.route("**/functions/v1/vendor-invite", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        action: "accept",
        source: "existing_provider",
        attempt_id: attempt,
      });
      requests++;
      await route.fulfill({ json: { status: "accepted", activated: false } });
    });
    await page.goto(`/invitation?attempt=${attempt}&kind=existing_provider`);
    await expect(page.getByRole("heading", { name: "Confirm access to your business profile" })).toBeVisible();
    await expect(page.getByText("does not approve your business", { exact: false })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations,
    ).toEqual([]);
    expect(await page.locator("main").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "Invitation accepted" })).toBeVisible();
    await expect(page.getByText("Mercurius will confirm the connection to your business profile", { exact: false })).toBeVisible();
    await expect(page.getByText("activated", { exact: false })).toHaveCount(0);
    expect(requests).toBe(1);
  });
}

test("existing-provider access keeps its kind through sign-in and password setup", async ({ page }) => {
  await page.goto(`/invitation?attempt=${attempt}&kind=existing_provider`);
  await expect(page.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
    "href",
    `/login/vendor?redirect=${encodeURIComponent(`/invitation?attempt=${attempt}&kind=existing_provider`)}`,
  );
  await syntheticSession(page.context(), "homeowner");
  let acceptances = 0;
  await page.route("**/functions/v1/vendor-invite", async (route) => {
    acceptances++;
    await route.fulfill({ json: { status: "accepted", activated: false } });
  });
  await page.goto(`/set-password?invitation=${attempt}&kind=existing_provider`);
  await page.getByLabel("New password", { exact: true }).fill("Synthetic-only-Password-42");
  await page.getByLabel("Confirm password", { exact: true }).fill("Synthetic-only-Password-42");
  await page.getByRole("button", { name: "Set password & continue" }).click();
  await expect(page).toHaveURL(`/invitation?attempt=${attempt}&kind=existing_provider`, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Confirm access to your business profile" })).toBeVisible();
  expect(acceptances).toBe(0);
});

// TRACE-105: an emailed link decides the account even when another account is signed in.
function linkSession(sub: string, email: string) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub, aud: "authenticated", role: "authenticated", exp: expires, fixture: "mds-only", testRole: "homeowner" })}.synthetic-signature`;
  return { access_token: token, refresh_token: "link-fixture-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user: { id: sub, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
}
const invitedId = "d4000000-0000-4000-8000-0000000000aa";
const invitedEmail = "invited.provider@example.invalid";
const linkPath = `/set-password?invitation=${attempt}&kind=existing_provider&token_hash=synthetic-hash&type=invite`;

test("invitation link verifies its own account while an admin is signed in", async ({ page }) => {
  await syntheticSession(page.context(), "admin");
  const verified: unknown[] = [];
  const updatedBy: string[] = [];
  await page.route("**/auth/v1/verify**", async (route) => {
    verified.push(route.request().postDataJSON());
    await route.fulfill({ json: linkSession(invitedId, invitedEmail) });
  });
  await page.route("**/auth/v1/user**", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const token = (route.request().headers().authorization ?? "").replace(/^Bearer /, "");
    updatedBy.push(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub);
    await route.fulfill({ json: linkSession(invitedId, invitedEmail).user });
  });
  let acceptances = 0;
  await page.route("**/functions/v1/vendor-invite", async (route) => {
    acceptances++;
    await route.fulfill({ json: { status: "accepted", activated: false } });
  });
  await page.goto(linkPath);
  await expect.poll(() => verified).toEqual([expect.objectContaining({ token_hash: "synthetic-hash", type: "invite" })]);
  await expect(page.getByText(`This sets the password for ${invitedEmail}`, { exact: false })).toBeVisible();
  await expect(page).not.toHaveURL(/token_hash/);
  await page.getByLabel("New password", { exact: true }).fill("Synthetic-only-Password-42");
  await page.getByLabel("Confirm password", { exact: true }).fill("Synthetic-only-Password-42");
  await page.getByRole("button", { name: "Set password & continue" }).click();
  await expect(page).toHaveURL(`/invitation?attempt=${attempt}&kind=existing_provider`, { timeout: 15000 });
  expect(updatedBy).toEqual([invitedId]);
  expect(acceptances).toBe(0);
});

test("a failed invitation link never falls back to the signed-in account", async ({ page }) => {
  await syntheticSession(page.context(), "admin");
  let updates = 0;
  await page.route("**/auth/v1/verify**", (route) =>
    route.fulfill({ status: 403, json: { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" } }));
  await page.route("**/auth/v1/user**", async (route) => {
    if (route.request().method() === "PUT") updates++;
    await route.fallback();
  });
  await page.goto(linkPath);
  await expect(page.getByText("invalid or has expired", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page.getByText("admin@example.invalid")).toHaveCount(0);
  expect(updates).toBe(0);
});

test("an expired provider link sends the recipient to the vendor password reset", async ({ page }) => {
  await page.route("**/auth/v1/verify**", (route) =>
    route.fulfill({ status: 403, json: { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" } }));
  await page.goto(linkPath);
  const reset = page.getByRole("link", { name: "Send me a new link" });
  await expect(reset).toHaveAttribute("href", "/forgot-password?for=vendor");
  await reset.click();
  await expect(page.getByText("Vendor", { exact: true })).toBeVisible();
  await expect(page.getByText("Homeowner", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login/vendor");
});

test("the vendor sign-in reset link keeps the vendor portal", async ({ page }) => {
  await page.goto("/login/vendor");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password?for=vendor");
  await page.goto("/forgot-password");
  await expect(page.getByText("Homeowner", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
});
