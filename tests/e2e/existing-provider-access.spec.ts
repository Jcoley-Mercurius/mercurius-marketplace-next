// TRACE-105: command retry identity and existing-account acceptance handoff.
import { test, expect, type Page } from "@playwright/test";
import { syntheticSession } from "../fixtures/browser-session";

const contractor = "00000000-0000-4000-8000-000000000002";
const account = "00000000-0000-4000-8000-000000000004";
const makeAttempt = (overrides = {}) => ({
  attempt_id: "00000000-0000-4000-8000-000000000053", mode: "existing_account",
  status: "prepared", expires_at: "2099-01-01T00:00:00Z", expired: false, live: true,
  existing_account_id: account, dispatch_state: null, accepted: false,
  accepted_account_confirmed: true, for_current_contact: true, ...overrides,
});
const makeOverview = () => ({
  contractor_id: contractor, name: "Synthetic Vendor", application_onboarding: false,
  excluded: false, account_linked: false, linked_user_id: account, bound_by_access: false,
  vendor_role_held: false, eligible: false,
  contact: { contact_id: "synthetic", email: "owner@example.test", confirmation: "Owner confirmed", recorded_at: "2026-09-30T00:00:00Z" },
  attempt: null as ReturnType<typeof makeAttempt> | null, prior_attempts: [], bindings: [],
});

async function open(page: Page, state: ReturnType<typeof makeOverview>) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: contractor, name: "Synthetic Vendor", services: [], badges: [], is_active: false } }));
  for (const path of ["contractor_gallery", "contractor_service_zips", "coverage_areas"])
    await page.route(`**/rest/v1/${path}?*`, route => route.fulfill({ json: [] }));
  await page.route("**/rpc/get_contractor_contact", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/r0_provider_access_overview", route => route.fulfill({ json: state }));
  await syntheticSession(page.context(), "admin");
  await page.goto(`/admin/vendors/${contractor}`);
  await expect(page.getByRole("heading", { name: "Owner-confirmed contact" })).toBeVisible();
}

async function confirm(page: Page, trigger: string, title: string, button: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: title });
  await dialog.getByRole("textbox", { name: /^Reason/ }).fill("Synthetic verification");
  await dialog.getByRole("button", { name: button, exact: true }).click();
  return dialog;
}

test("contact and prepare retries retain keys; later operations get new keys and expiry", async ({ page }) => {
  const state = makeOverview();
  const contacts: Record<string, string>[] = [];
  const preparations: Record<string, string>[] = [];
  await open(page, state);
  await page.route("**/rpc/r0_record_provider_contact", route => {
    contacts.push(route.request().postDataJSON());
    return route.fulfill(contacts.length === 1 ? { status: 503, json: { message: "Synthetic transient failure" } } : { json: { recorded: true } });
  });
  await page.getByLabel("Confirmed business email").fill(state.contact.email);
  await page.getByLabel("Owner confirmation", { exact: true }).fill("Owner confirmed");
  const dialog = await confirm(page, "Replace contact", "Record the owner-confirmed contact", "Record contact");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Record contact", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await confirm(page, "Replace contact", "Record the owner-confirmed contact", "Record contact");
  await expect(dialog).not.toBeVisible();
  expect(contacts[0].p_key).toBe(contacts[1].p_key);
  expect(contacts[2].p_key).not.toBe(contacts[1].p_key);

  await page.route("**/functions/v1/vendor-invite", route => {
    const body = route.request().postDataJSON();
    if (body.action === "close") {
      state.attempt = makeAttempt({ status: "revoked", live: false });
    } else {
      preparations.push(body);
      if (preparations.length === 1) return route.fulfill({ status: 503, json: { error: "Synthetic transient failure" } });
      state.attempt = makeAttempt({ expires_at: body.expires_at });
    }
    return route.fulfill({ json: {} });
  });
  await page.getByLabel("Existing account ID (optional)").fill(account);
  await page.getByRole("button", { name: "Prepare access", exact: true }).click();
  await expect(page.getByText("Synthetic transient failure").last()).toBeVisible();
  await page.getByRole("button", { name: "Prepare access", exact: true }).click();
  const url = page.getByLabel("Acceptance URL");
  await expect(url).toHaveValue(`http://127.0.0.1:3103/invitation?attempt=${state.attempt?.attempt_id}&kind=existing_provider`);
  await url.focus();
  expect(await url.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBe((await url.inputValue()).length);
  const closed = await confirm(page, "Revoke access invitation", "Revoke the access invitation", "Revoke");
  await expect(closed).not.toBeVisible();
  await expect(url).toHaveCount(0);
  await page.getByLabel("Invitation expiry (days)").fill("10");
  await page.getByRole("button", { name: "Prepare access", exact: true }).click();
  await expect(url).toBeVisible();
  expect(preparations[0]).toEqual(preparations[1]);
  expect(preparations[2].business_key).not.toBe(preparations[1].business_key);
  expect(preparations[2].expires_at).not.toBe(preparations[1].expires_at);
});

test("release retries retain the key; releasing the same account after rebinding gets a new key", async ({ page }) => {
  const state = makeOverview();
  Object.assign(state, { account_linked: true, bound_by_access: true, attempt: makeAttempt({ status: "accepted", live: false, accepted: true }) });
  await open(page, state);
  const keys: string[] = [];
  await page.route("**/rpc/r0_release_provider_access", route => {
    keys.push(route.request().postDataJSON().p_key);
    if (keys.length === 1) return route.fulfill({ status: 503, json: { message: "Synthetic transient failure" } });
    Object.assign(state, { account_linked: false, bound_by_access: false });
    return route.fulfill({ json: { recorded: true } });
  });
  await page.route("**/rpc/r0_bind_provider_access", route => {
    Object.assign(state, { account_linked: true, bound_by_access: true });
    return route.fulfill({ json: { recorded: true } });
  });
  const dialog = await confirm(page, "Release binding", "Release this account binding", "Release");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Release", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const binding = await confirm(page, "Bind accepted account", "Bind the accepted account to this profile", "Bind account");
  await expect(binding).not.toBeVisible();
  await confirm(page, "Release binding", "Release this account binding", "Release");
  await expect(dialog).not.toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[1]);
});

for (const overrides of [{ mode: "new_account" }, { status: "accepted" }, { live: false }, { expired: true }]) {
  test(`acceptance URL is hidden for ${JSON.stringify(overrides)}`, async ({ page }) => {
    const state = makeOverview();
    state.attempt = makeAttempt(overrides);
    await open(page, state);
    await expect(page.getByLabel("Acceptance URL")).toHaveCount(0);
  });
}
