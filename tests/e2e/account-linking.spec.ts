import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-067/068 synthetic browser evidence. The fixture never claims a real account,
// identity verification, role grant or activation; role states are mocked readbacks.
const contractor = "00000000-0000-4000-8000-000000000052";
const version = "00000000-0000-4000-8000-000000000051";
const existingAccount = "00000000-0000-4000-8000-000000000055";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  // A provider already under review owns the account panel.
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    Object.assign(data, {
      contractor_id: contractor, onboarding_status: "review", onboarding_revision: 1,
      onboarding_version_id: version, review_started: true,
    });
    await route.fulfill({ response, json: data });
  });
});

function overview(page: Page, body: Record<string, unknown>) {
  return page.route("**/rpc/vendor_account_link_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, ...body } });
  });
}

async function openAccount(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Applications" })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("heading", { name: "Provider account" })).toBeVisible();
  return dialog;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`account panel ${theme} ${width}px`, async ({ page }) => {
    const dialog = await openAccount(page, theme, width);
    await expect(dialog.getByText("applicant@example.invalid").first()).toBeVisible();
    await expect(dialog.getByText("None linked")).toBeVisible();
    // The legacy always-ungated control is gone rather than granting a role.
    await expect(dialog.getByRole("button", { name: "Link Account" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Link existing account" })).toBeVisible();
    // Scoped to this slice's surface. The queue table behind it carries a pre-existing
    // fixed light palette that fails dark-theme contrast; recorded in the slice report.
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/account-linking-${theme}-${width}.png`, fullPage: true });
  });
}

test("linking requires an exact account identity", async ({ page }) => {
  const dialog = await openAccount(page);
  const link = dialog.getByRole("button", { name: "Link existing account" });
  await expect(link).toBeDisabled();
  const field = dialog.getByLabel("Account identity (required)", { exact: true });
  await expect(field).toHaveValue("");
  await expect(dialog.getByText("no directory is searched from here", { exact: false })).toBeVisible();
  await field.fill("applicant@example.invalid");
  await expect(dialog.getByText("Enter the exact Auth user ID.")).toBeVisible();
  await expect(link).toBeDisabled();
  await field.fill(existingAccount);
  await expect(link).toBeEnabled();
});

test("linking sends the read-back revision and replays one key on retry", async ({ page }) => {
  const dialog = await openAccount(page);
  await dialog.getByLabel("Account identity (required)", { exact: true }).fill(existingAccount);
  await dialog.getByRole("button", { name: "Link existing account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Link this existing account?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  // A reason is required: the confirmation cannot be completed without one.
  await expect(confirm.getByRole("button", { name: "Link account", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("Applicant already holds a Mercurius account");
  const first = page.waitForRequest("**/rpc/vendor_link_existing_account");
  await confirm.getByRole("button", { name: "Link account", exact: true }).click();
  const sent = (await first).postDataJSON();
  expect(sent).toMatchObject({
    p_contractor: contractor, p_expected_revision: 1, p_auth_user: existingAccount,
    p_reason: "Applicant already holds a Mercurius account",
  });
  expect(sent.p_key).toBe(`account-link:${sent.p_key.split(":")[1]}:1:${existingAccount}`);
  // The fixture refuses the mutation, so the confirmation must stay open.
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
  const retry = page.waitForRequest("**/rpc/vendor_link_existing_account");
  await confirm.getByRole("button", { name: "Link account", exact: true }).click();
  expect((await retry).postDataJSON().p_key).toBe(sent.p_key);
});

test("linking succeeds only when the readback shows the reviewed binding", async ({ page }) => {
  let linked = false;
  await page.route("**/rpc/vendor_link_existing_account", route => {
    linked = true;
    return route.fulfill({ json: { contractor_id: contractor, auth_user_id: existingAccount, action: "link", onboarding_revision: 2, recorded: true } });
  });
  await page.route("**/rpc/vendor_account_link_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, ...(linked ? {
      linked: true, linked_user_id: existingAccount, linked_email: "applicant@example.invalid",
      link_reviewed: true, onboarding_revision: 2,
      decisions: [{ action: "link", auth_user_id: existingAccount, recipient_email: "applicant@example.invalid",
        onboarding_revision: 2, reason: "Applicant already holds a Mercurius account", created_at: new Date().toISOString() }],
    } : {}) } });
  });
  const dialog = await openAccount(page);
  await dialog.getByLabel("Account identity (required)", { exact: true }).fill(existingAccount);
  await dialog.getByRole("button", { name: "Link existing account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Link this existing account?" });
  await confirm.getByRole("textbox").fill("Applicant already holds a Mercurius account");
  await confirm.getByRole("button", { name: "Link account", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(dialog.getByText("Reviewed link")).toBeVisible();
  await expect(dialog.getByText("holds no vendor role yet", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Not granted")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Release account" })).toBeVisible();
  await expect(dialog.getByText("Recorded decisions (1)")).toBeVisible();
});

test("a binding the readback does not confirm keeps the dialog open", async ({ page }) => {
  await page.route("**/rpc/vendor_link_existing_account", route =>
    route.fulfill({ json: { contractor_id: contractor, auth_user_id: existingAccount, action: "link", onboarding_revision: 2, recorded: true } }));
  const dialog = await openAccount(page);
  await dialog.getByLabel("Account identity (required)", { exact: true }).fill(existingAccount);
  await dialog.getByRole("button", { name: "Link existing account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Link this existing account?" });
  await confirm.getByRole("textbox").fill("Applicant already holds a Mercurius account");
  await confirm.getByRole("button", { name: "Link account", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
});

test("an inherited link is reported and offers no action", async ({ page }) => {
  await overview(page, {
    linked: true, linked_user_id: existingAccount, linked_email: "legacy@example.invalid",
    link_reviewed: false,
  });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("Inherited link")).toBeVisible();
  await expect(dialog.getByText("follows the compliance cutover path", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Release account" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
});

test("an active provider must be suspended before its account is released", async ({ page }) => {
  await overview(page, {
    onboarding_status: "active", onboarding_revision: 3,
    linked: true, linked_user_id: existingAccount, linked_email: "applicant@example.invalid",
    link_reviewed: true,
  });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("Reviewed link")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Release account" })).toHaveCount(0);
  await expect(dialog.getByText("Suspend this provider before releasing its account", { exact: false })).toBeVisible();
});

test("releasing requires a reason and sends the read-back revision", async ({ page }) => {
  await overview(page, {
    onboarding_status: "review", onboarding_revision: 2,
    linked: true, linked_user_id: existingAccount, linked_email: "applicant@example.invalid",
    link_reviewed: true,
  });
  const dialog = await openAccount(page);
  await dialog.getByRole("button", { name: "Release account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Release this linked account?" });
  await expect(confirm.getByText("no compliance evidence is withdrawn", { exact: false })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Release", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("Applicant asked for a different account");
  const request = page.waitForRequest("**/rpc/vendor_release_linked_account");
  await confirm.getByRole("button", { name: "Release", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    p_contractor: contractor, p_expected_revision: 2,
    p_reason: "Applicant asked for a different account",
  });
});

test("a live invitation blocks linking in place instead of offering it", async ({ page }) => {
  await overview(page, { invitation_live: true });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("the two paths are mutually exclusive", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
  await expect(dialog.getByLabel("Account identity (required)", { exact: true })).toHaveCount(0);
});

test("a superseded application revision blocks linking in place", async ({ page }) => {
  await overview(page, { version_current: false });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("Rebind onboarding to the current version", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
});

test("an unusable reviewed recipient blocks linking in place", async ({ page }) => {
  await overview(page, { recipient_email: null, recipient_valid: false });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("no usable recipient address", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
});

test("a provider with no onboarding review is explained, not offered a retry", async ({ page }) => {
  await page.route("**/rpc/vendor_account_link_overview", route =>
    route.fulfill({ status: 400, json: { message: "Onboarding record not found" } }));
  const dialog = await openAccount(page);
  await expect(dialog.getByText("not under onboarding review", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
});

// TRACE-068: the panel reports the role the server says activation granted.
const reviewedActive = {
  onboarding_status: "active", onboarding_revision: 3,
  linked: true, linked_user_id: existingAccount, linked_email: "applicant@example.invalid",
  link_reviewed: true, vendor_role_held: true, vendor_role_from_activation: true,
  role_decisions: [{ action: "grant", outcome: "granted", auth_user_id: existingAccount,
    onboarding_revision: 3, created_at: new Date().toISOString() }],
};

for (const [theme, width] of [["dark", 320], ["light", 1440]] as const) {
  test(`an activation-granted role is reported ${theme} ${width}px`, async ({ page }) => {
    await overview(page, reviewedActive);
    const dialog = await openAccount(page, theme, width);
    await expect(dialog.getByText("Granted at activation", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Suspension keeps it; releasing the account withdraws it.")).toBeVisible();
    await dialog.getByText("Role decisions (1)").click();
    await expect(dialog.getByText("Vendor role granted at activation", { exact: false })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/activation-role-${theme}-${width}.png`, fullPage: true });
  });
}

test("releasing a suspended provider states that the granted role is withdrawn", async ({ page }) => {
  await overview(page, { ...reviewedActive, onboarding_status: "suspended", onboarding_revision: 4 });
  const dialog = await openAccount(page);
  await dialog.getByRole("button", { name: "Release account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Release this linked account?" });
  await expect(confirm.getByText("withdraws the vendor role activation granted to it", { exact: false })).toBeVisible();
});

test("a role held before activation is reported and kept on release", async ({ page }) => {
  await overview(page, {
    ...reviewedActive, onboarding_status: "suspended", onboarding_revision: 4,
    vendor_role_from_activation: false,
    role_decisions: [{ action: "grant", outcome: "already_held", auth_user_id: existingAccount,
      onboarding_revision: 3, created_at: new Date().toISOString() }],
  });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("Held before activation")).toBeVisible();
  await expect(dialog.getByText("does not withdraw a role activation did not grant", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Release account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Release this linked account?" });
  await expect(confirm.getByText("keeps any role it already holds", { exact: false })).toBeVisible();
});
