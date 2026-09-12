import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-066 synthetic browser evidence. The fixture never claims a real dispatch,
// Auth call, role grant or activation.
const contractor = "00000000-0000-4000-8000-000000000052";
const version = "00000000-0000-4000-8000-000000000051";
const attemptId = "00000000-0000-4000-8000-000000000053";
const recipientAuthUser = "00000000-0000-4000-8000-000000000054";

type Attempt = {
  attempt_id: string;
  status: string;
  expires_at: string;
  created_at: string;
  expired: boolean;
  live: boolean;
  dispatch_state: string | null;
  auth_user_id: string | null;
  accepted: boolean;
};

const attempt = (overrides: Partial<Attempt> = {}): Attempt => ({
  attempt_id: attemptId,
  status: "prepared",
  expires_at: new Date(Date.now() + 2 * 86400000).toISOString(),
  created_at: new Date().toISOString(),
  expired: false,
  live: true,
  dispatch_state: null,
  auth_user_id: null,
  accepted: false,
  ...overrides,
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  // A provider already under review owns the invitation queue.
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

async function openInvitation(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Applications" })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("heading", { name: "Provider invitation" })).toBeVisible();
  return dialog;
}

// The slice owns this section. The dialog around it carries a pre-existing MDS
// defect recorded in the slice report: its footer bleeds past the padding box by
// the scrollbar width once the content scrolls.
function panel(dialog: ReturnType<Page["getByRole"]>) {
  return dialog.locator("section").filter({ hasText: "Provider invitation" });
}

function overview(page: Page, body: Record<string, unknown>) {
  return page.route("**/rpc/vendor_invitation_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, ...body } });
  });
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`invitation queue ${theme} ${width}px`, async ({ page }) => {
    const dialog = await openInvitation(page, theme, width);
    await expect(dialog.getByText("No invitation has been prepared for this provider.")).toBeVisible();
    // The legacy always-blocked control is gone rather than failing on click.
    await expect(dialog.getByRole("button", { name: /^(Send|Resend) invite$/ })).toHaveCount(0);
    // Scoped to this slice's surface. The queue table behind it carries a pre-existing
    // fixed light palette that fails dark-theme contrast; recorded in the slice report.
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await panel(dialog).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/invitation-operations-${theme}-${width}.png`, fullPage: true });
  });
}

test("expiry has no default and gates preparation", async ({ page }) => {
  const dialog = await openInvitation(page);
  const field = dialog.getByLabel("Invitation expiry (required)", { exact: true });
  await expect(field).toHaveValue("");
  await expect(dialog.getByText("There is no default expiry", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Prepare invitation" })).toBeDisabled();
  await field.fill("2020-01-01T09:00");
  await expect(dialog.getByText("Enter an expiry in the future.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Prepare invitation" })).toBeDisabled();
  await field.fill("2031-03-04T09:30");
  await expect(dialog.getByRole("button", { name: "Prepare invitation" })).toBeEnabled();
});

test("preparation sends the operator expiry and replays one key on retry", async ({ page }) => {
  const dialog = await openInvitation(page);
  await dialog.getByLabel("Invitation expiry (required)", { exact: true }).fill("2031-03-04T09:30");
  await dialog.getByRole("button", { name: "Prepare invitation" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Prepare this invitation?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  const first = page.waitForRequest("**/functions/v1/vendor-invite");
  await confirm.getByRole("button", { name: "Prepare", exact: true }).click();
  const sent = (await first).postDataJSON();
  const expiry = new Date("2031-03-04T09:30").toISOString();
  expect(sent).toMatchObject({ action: "prepare", contractor_id: contractor, expires_at: expiry });
  expect(sent.business_key).toBe(`invitation:${sent.business_key.split(":")[1]}:${expiry}`);
  // The fixture refuses the mutation, so the confirmation must stay open.
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
  const retry = page.waitForRequest("**/functions/v1/vendor-invite");
  await confirm.getByRole("button", { name: "Prepare", exact: true }).click();
  expect((await retry).postDataJSON().business_key).toBe(sent.business_key);
});

test("preparation succeeds only when the readback shows a prepared attempt", async ({ page }) => {
  let prepared = false;
  await page.route("**/functions/v1/vendor-invite", route => {
    prepared = true;
    return route.fulfill({ json: { attempt_id: attemptId, status: "prepared", emailed: false } });
  });
  await page.route("**/rpc/vendor_invitation_overview", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, attempt: prepared ? attempt() : null } });
  });
  const dialog = await openInvitation(page);
  await dialog.getByLabel("Invitation expiry (required)", { exact: true }).fill("2031-03-04T09:30");
  await dialog.getByRole("button", { name: "Prepare invitation" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Prepare this invitation?" });
  await confirm.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(dialog.getByText("Prepared, not sent")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send invitation" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Prepare invitation" })).toHaveCount(0);
});

test("a prepared attempt that the readback does not confirm keeps the dialog open", async ({ page }) => {
  await page.route("**/functions/v1/vendor-invite", route =>
    route.fulfill({ json: { attempt_id: attemptId, status: "prepared", emailed: false } }));
  const dialog = await openInvitation(page);
  await dialog.getByLabel("Invitation expiry (required)", { exact: true }).fill("2031-03-04T09:30");
  await dialog.getByRole("button", { name: "Prepare invitation" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Prepare this invitation?" });
  await confirm.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
});

test("a disabled delivery environment is reported, not retried", async ({ page }) => {
  await overview(page, { attempt: attempt() });
  await page.route("**/functions/v1/vendor-invite", route =>
    route.fulfill({ status: 503, json: { error: "INVITATION_DELIVERY_DISABLED", emailed: false } }));
  const dialog = await openInvitation(page);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Send this invitation?" });
  await confirm.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("INVITATION_DELIVERY_DISABLED")).toBeVisible();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  // Nothing was sent, so the attempt is still only prepared.
  await expect(dialog.getByText("Prepared, not sent")).toBeVisible();
});

test("an unknown provider result requires an exact Auth identity to reconcile", async ({ page }) => {
  await overview(page, { attempt: attempt({ status: "unknown", dispatch_state: "unknown" }) });
  const dialog = await openInvitation(page);
  await expect(dialog.getByText("Unknown — reconcile before any further dispatch")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send invitation" })).toHaveCount(0);
  const reconcile = dialog.getByRole("button", { name: "Reconcile result" });
  await expect(reconcile).toBeDisabled();
  const field = dialog.getByLabel("Auth user ID (required)", { exact: true });
  await field.fill("not-a-user-id");
  await expect(dialog.getByText("Enter the exact Auth user ID.")).toBeVisible();
  await expect(reconcile).toBeDisabled();
  await field.fill(recipientAuthUser);
  await expect(reconcile).toBeEnabled();
  const request = page.waitForRequest("**/functions/v1/vendor-invite");
  await reconcile.click();
  await page.getByRole("alertdialog", { name: "Reconcile this invitation?" })
    .getByRole("button", { name: "Reconcile", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    action: "reconcile", attempt_id: attemptId, auth_user_id: recipientAuthUser,
  });
});

test("closure requires a reason and expiry cannot be recorded early", async ({ page }) => {
  await overview(page, { attempt: attempt({ status: "submitted", dispatch_state: "provider_accepted", auth_user_id: recipientAuthUser }) });
  const dialog = await openInvitation(page);
  await expect(dialog.getByText("Auth accepted the invitation (delivery not asserted)")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Record expiry" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Revoke invitation" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Revoke this invitation?" });
  await expect(confirm.getByRole("button", { name: "Revoke", exact: true })).toBeDisabled();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic operator stop");
  const request = page.waitForRequest("**/functions/v1/vendor-invite");
  await confirm.getByRole("button", { name: "Revoke", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    action: "close", attempt_id: attemptId, status: "revoked", reason: "Synthetic operator stop",
  });
});

test("a past expiry can be recorded and an accepted receipt closes the attempt", async ({ page }) => {
  await overview(page, {
    attempt: attempt({
      status: "submitted", dispatch_state: "provider_accepted", auth_user_id: recipientAuthUser,
      expires_at: new Date(Date.now() - 3600000).toISOString(), expired: true,
    }),
  });
  const dialog = await openInvitation(page);
  await expect(dialog.getByText("Past expiry")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Record expiry" })).toBeVisible();

  await overview(page, {
    attempt: attempt({ status: "accepted", live: false, dispatch_state: "provider_accepted", auth_user_id: recipientAuthUser, accepted: true }),
    prior_attempts: [{ attempt_id: "00000000-0000-4000-8000-000000000055", status: "revoked", expires_at: new Date().toISOString(), created_at: new Date().toISOString() }],
  });
  await page.keyboard.press("Escape");
  const reopened = await openInvitation(page);
  await expect(reopened.getByText("Accepted by recipient")).toBeVisible();
  await expect(reopened.getByText("Recipient receipt")).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Revoke invitation" })).toHaveCount(0);
  await expect(reopened.getByText("Earlier attempts (1)")).toBeVisible();
  // A closed attempt frees the slot; preparation is available again.
  await expect(reopened.getByRole("button", { name: "Prepare invitation" })).toBeVisible();
});

test("an invitation blocked by provider state explains itself instead of offering an action", async ({ page }) => {
  await overview(page, { account_linked: true });
  const dialog = await openInvitation(page);
  await expect(dialog.getByText("existing-account linking is a separate reviewed path", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Prepare invitation" })).toHaveCount(0);
});
