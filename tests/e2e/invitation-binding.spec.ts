import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-070 synthetic browser evidence. The fixture never claims a real invitation,
// acceptance, account binding or role grant; receipt states are mocked readbacks.
const contractor = "00000000-0000-4000-8000-000000000052";
const version = "00000000-0000-4000-8000-000000000051";
const attempt = "00000000-0000-4000-8000-000000000056";
const invitedAccount = "00000000-0000-4000-8000-000000000057";

const receipt = {
  attempt_id: attempt, auth_user_id: invitedAccount, accepted_at: new Date().toISOString(),
  account_email: "applicant@example.invalid", account_confirmed: true,
  for_current_version: true, bound: false,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
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

async function confirmBinding(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("button", { name: "Bind accepted account" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Bind the account that accepted the invitation?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(confirm.getByRole("button", { name: "Bind account", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("Recipient accepted the reviewed invitation");
  return confirm;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`accepted invitation panel ${theme} ${width}px`, async ({ page }) => {
    await overview(page, { accepted_invitation: receipt });
    const dialog = await openAccount(page, theme, width);
    await expect(dialog.getByText("Invitation accepted")).toBeVisible();
    await expect(dialog.getByText("Accepting account")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Bind accepted account" })).toBeVisible();
    // The stated-identity path stays available; the receipt does not replace it.
    await expect(dialog.getByRole("button", { name: "Link existing account" })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/invitation-binding-${theme}-${width}.png`, fullPage: true });
  });
}

test("no receipt offers no binding action", async ({ page }) => {
  const dialog = await openAccount(page);
  await expect(dialog.getByText("Invitation accepted")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Bind accepted account" })).toHaveCount(0);
});

test("binding sends the read-back revision and receipt and replays one key on retry", async ({ page }) => {
  await overview(page, { accepted_invitation: receipt });
  const dialog = await openAccount(page);
  const confirm = await confirmBinding(page, dialog);
  const first = page.waitForRequest("**/rpc/vendor_bind_invited_account");
  await confirm.getByRole("button", { name: "Bind account", exact: true }).click();
  const sent = (await first).postDataJSON();
  expect(sent).toMatchObject({
    p_contractor: contractor, p_expected_revision: 1, p_attempt: attempt,
    p_reason: "Recipient accepted the reviewed invitation",
  });
  // No identity is sent: the database takes it from the receipt.
  expect(sent).not.toHaveProperty("p_auth_user");
  expect(sent.p_key).toBe(`invitation-bind:${sent.p_key.split(":")[1]}:1:${attempt}`);
  // The fixture refuses the mutation, so the confirmation must stay open.
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
  const retry = page.waitForRequest("**/rpc/vendor_bind_invited_account");
  await confirm.getByRole("button", { name: "Bind account", exact: true }).click();
  expect((await retry).postDataJSON().p_key).toBe(sent.p_key);
});

test("binding succeeds only when the readback shows the invitation binding", async ({ page }) => {
  let bound = false;
  await page.route("**/rpc/vendor_bind_invited_account", route => {
    bound = true;
    return route.fulfill({ json: { contractor_id: contractor, auth_user_id: invitedAccount, invitation_attempt_id: attempt, action: "link", onboarding_revision: 2, recorded: true } });
  });
  await page.route("**/rpc/vendor_account_link_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, accepted_invitation: receipt, ...(bound ? {
      linked: true, linked_user_id: invitedAccount, linked_email: "applicant@example.invalid",
      link_reviewed: true, link_source: "accepted_invitation", onboarding_revision: 2,
      accepted_invitation: { ...receipt, bound: true },
      decisions: [{ action: "link", auth_user_id: invitedAccount, recipient_email: "applicant@example.invalid",
        invitation_attempt_id: attempt, onboarding_revision: 2, reason: "Recipient accepted the reviewed invitation",
        created_at: new Date().toISOString() }],
    } : {}) } });
  });
  const dialog = await openAccount(page);
  const confirm = await confirmBinding(page, dialog);
  await confirm.getByRole("button", { name: "Bind account", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(dialog.getByText("Reviewed link")).toBeVisible();
  await expect(dialog.getByText("Accepted invitation", { exact: true })).toBeVisible();
  await expect(dialog.getByText("holds no vendor role yet", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bind accepted account" })).toHaveCount(0);
  await dialog.getByText("Recorded decisions (1)").click();
  await expect(dialog.getByText("Accepted invitation bound", { exact: false })).toBeVisible();
});

test("a stated-identity readback does not confirm an invitation binding", async ({ page }) => {
  let bound = false;
  await page.route("**/rpc/vendor_bind_invited_account", route => {
    bound = true;
    return route.fulfill({ json: { recorded: true } });
  });
  await page.route("**/rpc/vendor_account_link_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, accepted_invitation: receipt, ...(bound ? {
      linked: true, linked_user_id: invitedAccount, linked_email: "applicant@example.invalid",
      link_reviewed: true, link_source: "stated_identity", onboarding_revision: 2,
    } : {}) } });
  });
  const dialog = await openAccount(page);
  const confirm = await confirmBinding(page, dialog);
  await confirm.getByRole("button", { name: "Bind account", exact: true }).click();
  // The readback is linked, so the unlinked controls unmount; the operator is told the
  // change was not confirmed and sees what the server actually reports.
  await expect(page.getByText("Account action could not be completed")).toBeVisible();
  await expect(page.getByText("did not confirm this account change", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Stated account identity", { exact: true })).toBeVisible();
  await expect(page.getByText("Accepted account bound")).toHaveCount(0);
});

for (const [name, change, message] of [
  ["a superseded application revision", { for_current_version: false }, "earlier application revision"],
  ["an unconfirmed account", { account_confirmed: false }, "no longer confirmed"],
  ["a changed account address", { account_email: "moved@example.invalid" }, "no longer matches the reviewed application recipient"],
] as const) {
  test(`a receipt for ${name} is explained, not offered`, async ({ page }) => {
    await overview(page, { accepted_invitation: { ...receipt, ...change } });
    const dialog = await openAccount(page);
    await expect(dialog.getByText("Invitation accepted")).toBeVisible();
    await expect(dialog.getByText(message, { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Bind accepted account" })).toHaveCount(0);
  });
}

test("a live invitation blocks binding in place", async ({ page }) => {
  await overview(page, { accepted_invitation: receipt, invitation_live: true });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("the two paths are mutually exclusive", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bind accepted account" })).toHaveCount(0);
});

test("a superseded receipt directs the operator to link its account by ID", async ({ page }) => {
  await overview(page, { accepted_invitation: { ...receipt, for_current_version: false } });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("cannot be re-invited; link it by account ID below", { exact: false })).toBeVisible();
  const field = dialog.getByLabel("Account identity (required)", { exact: true });
  await expect(field).toHaveValue("");
  await dialog.getByRole("button", { name: "Use this account ID" }).click();
  // The form is filled, not submitted: the operator still confirms with a reason.
  await expect(field).toHaveValue(invitedAccount);
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toBeEnabled();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("an unverifiable receipt offers no account ID shortcut", async ({ page }) => {
  await overview(page, { accepted_invitation: { ...receipt, for_current_version: false, account_confirmed: false } });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("Invitation accepted")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use this account ID" })).toHaveCount(0);
});

test("the invitation panel refuses to re-invite a recipient who holds an account", async ({ page }) => {
  await page.route("**/rpc/vendor_invitation_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, recipient_account_id: invitedAccount } });
  });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("a new invitation cannot be sent to it", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Prepare invitation" })).toHaveCount(0);
});

// DEC-2026-028: a provider activated with no bound account is repaired by suspend,
// bind, activate. The live provider is told to suspend; the suspended one is offered
// the binding.
test("an active provider with no account is told to suspend before binding", async ({ page }) => {
  await overview(page, { accepted_invitation: receipt, onboarding_status: "active", onboarding_revision: 2 });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("suspend it, bind the account here, then activate it again", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bind accepted account" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Link existing account" })).toHaveCount(0);
});

test("a suspended provider offers the accepted-account binding", async ({ page }) => {
  await overview(page, { accepted_invitation: receipt, onboarding_status: "suspended", onboarding_revision: 3 });
  const dialog = await openAccount(page);
  await expect(dialog.getByText("then activate it again from the checklist", { exact: false })).toBeVisible();
  const confirm = await confirmBinding(page, dialog);
  const sent = page.waitForRequest("**/rpc/vendor_bind_invited_account");
  await confirm.getByRole("button", { name: "Bind account", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({ p_contractor: contractor, p_expected_revision: 3, p_attempt: attempt });
});
