import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-069 synthetic browser evidence. The fixture never claims real evidence, a real
// account, a role grant or an activation; decision states are mocked readbacks.
const contractor = "00000000-0000-4000-8000-000000000052";
const version = "00000000-0000-4000-8000-000000000051";
const kinds = ["identity", "agreement", "coverage", "license", "insurance", "bank_authorization", "profile_pricing", "availability", "test_notification"];
const now = new Date().toISOString();
const complete = kinds.map(kind => ({
  kind, evidence_id: `00000000-0000-4000-8000-0000000001${String(kinds.indexOf(kind)).padStart(2, "0")}`,
  requirement_version: `${kind}-v1`, evidence_ref: ["license", "insurance"].includes(kind) ? `synthetic/applicant/${kind}.pdf` : `Synthetic ${kind} reference`,
  accepted_at: now, expires_at: ["license", "insurance"].includes(kind) ? new Date(Date.now() + 3e10).toISOString() : null, state: "current",
}));

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

function checklist(page: Page, body: Record<string, unknown> | (() => Record<string, unknown>)) {
  return page.route("**/rpc/vendor_onboarding_checklist", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, ...(typeof body === "function" ? body() : body) } });
  });
}

async function openChecklist(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Applications" })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("heading", { name: "Activation checklist" })).toBeVisible();
  await expect(dialog.getByText("0 of 9 current").or(dialog.getByText("9 of 9 current"))).toBeVisible();
  return dialog;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`activation checklist ${theme} ${width}px`, async ({ page }) => {
    const dialog = await openChecklist(page, theme, width);
    await expect(dialog.getByText("0 of 9 current")).toBeVisible();
    await expect(dialog.getByText("Missing", { exact: true })).toHaveCount(9);
    await expect(dialog.getByText("Test notification received", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Activate provider" })).toBeDisabled();
    await expect(dialog.getByText("Activation is unavailable. Every checklist item must be current first.")).toBeVisible();
    // Scoped to this slice's surface; the queue table behind it carries the recorded
    // TRACE-065 dark-theme contrast defect.
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await dialog.getByRole("heading", { name: "Activation checklist" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/onboarding-checklist-${theme}-${width}.png` });
  });
}

test("license evidence is an application document with a required expiry", async ({ page }) => {
  const dialog = await openChecklist(page);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("license");
  const document = dialog.getByLabel("Document (required)", { exact: true });
  await expect(document.locator("option")).toHaveText(["Select a document", "license.pdf", "insurance.pdf"]);
  await expect(dialog.getByLabel("Expires (required)", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Reviewed at (required)", { exact: true })).toHaveValue("");
  const record = dialog.getByRole("button", { name: "Record evidence" });
  await dialog.getByLabel("Requirement version (required)", { exact: true }).fill("state-license-v1");
  await document.selectOption("synthetic/applicant/license.pdf");
  await dialog.getByLabel("Reviewed at (required)", { exact: true }).fill("2026-01-01T09:00");
  await expect(record).toBeDisabled();
  await dialog.getByLabel("Expires (required)", { exact: true }).fill("2020-01-01T09:00");
  await expect(dialog.getByText("Enter an expiry in the future.")).toBeVisible();
  await expect(record).toBeDisabled();
  await dialog.getByLabel("Expires (required)", { exact: true }).fill("2099-01-01T09:00");
  await expect(record).toBeEnabled();
});

test("payout evidence warns against entering bank details", async ({ page }) => {
  const dialog = await openChecklist(page);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("bank_authorization");
  await expect(dialog.getByText("Never enter account or routing numbers.", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Evidence reference (required)", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Expires", { exact: true })).toBeVisible();
});

test("recording sends the entered evidence and replays one key on retry", async ({ page }) => {
  const dialog = await openChecklist(page);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("identity");
  await dialog.getByLabel("Requirement version (required)", { exact: true }).fill("identity-check-v1");
  await dialog.getByLabel("Evidence reference (required)", { exact: true }).fill("Case SYN-1");
  await dialog.getByLabel("Reviewed at (required)", { exact: true }).fill("2026-01-01T09:00");
  await dialog.getByRole("button", { name: "Record evidence" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record this checklist evidence?" });
  await expect(confirm.getByText("It activates nothing, grants no role and publishes no listing.", { exact: false })).toBeVisible();
  const first = page.waitForRequest("**/rpc/vendor_record_checklist_evidence");
  await confirm.getByRole("button", { name: "Record", exact: true }).click();
  const sent = (await first).postDataJSON();
  expect(sent).toMatchObject({
    p_contractor: contractor, p_kind: "identity", p_requirement: "identity-check-v1", p_reference: "Case SYN-1",
    p_accepted: new Date("2026-01-01T09:00").toISOString(),
  });
  expect(sent.p_supersedes).toBeUndefined();
  expect(sent.p_expires).toBeUndefined();
  expect(sent.p_key).toMatch(/^checklist:[0-9a-f-]+:identity:new:[0-9a-f]+$/);
  // The fixture refuses the mutation, so the confirmation stays open.
  await expect(confirm.getByRole("alert")).toBeFocused();
  const retry = page.waitForRequest("**/rpc/vendor_record_checklist_evidence");
  await confirm.getByRole("button", { name: "Record", exact: true }).click();
  expect((await retry).postDataJSON().p_key).toBe(sent.p_key);
});

test("recorded evidence is confirmed only by the readback", async ({ page }) => {
  let recorded = false;
  await page.route("**/rpc/vendor_record_checklist_evidence", route => {
    recorded = true;
    return route.fulfill({ json: { contractor_id: contractor, evidence_id: complete[0].evidence_id, kind: "identity", recorded: true } });
  });
  await checklist(page, () => recorded ? {
    items: [{ ...complete[0], requirement_version: "identity-check-v1", evidence_ref: "Case SYN-1" },
      ...kinds.slice(1).map(kind => ({ kind, evidence_id: null, requirement_version: null, evidence_ref: null, accepted_at: null, expires_at: null, state: "missing" }))],
  } : {});
  const dialog = await openChecklist(page);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("identity");
  await dialog.getByLabel("Requirement version (required)", { exact: true }).fill("identity-check-v1");
  await dialog.getByLabel("Evidence reference (required)", { exact: true }).fill("Case SYN-1");
  await dialog.getByLabel("Reviewed at (required)", { exact: true }).fill("2026-01-01T09:00");
  await dialog.getByRole("button", { name: "Record evidence" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record this checklist evidence?" });
  await confirm.getByRole("button", { name: "Record", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(dialog.getByText("1 of 9 current")).toBeVisible();
  await expect(dialog.getByText("identity-check-v1 · Case SYN-1", { exact: false })).toBeVisible();
});

test("replacing evidence names the current evidence", async ({ page }) => {
  await checklist(page, { items: complete, checklist_current: true });
  const dialog = await openChecklist(page);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("agreement");
  await dialog.getByLabel("Requirement version (required)", { exact: true }).fill("agreement-v2");
  await dialog.getByLabel("Evidence reference (required)", { exact: true }).fill("Signed agreement v2");
  await dialog.getByLabel("Reviewed at (required)", { exact: true }).fill("2026-01-01T09:00");
  await dialog.getByRole("button", { name: "Replace evidence" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record this checklist evidence?" });
  await expect(confirm.getByText("Supersedes the current evidence for this item", { exact: false })).toBeVisible();
  const request = page.waitForRequest("**/rpc/vendor_record_checklist_evidence");
  await confirm.getByRole("button", { name: "Record", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ p_kind: "agreement", p_supersedes: complete[1].evidence_id });
});

test("activation states the role outcome and is confirmed by the readback", async ({ page }) => {
  let decided = false;
  await page.route("**/rpc/vendor_decide_onboarding", route => {
    decided = true;
    return route.fulfill({ json: 2 });
  });
  await checklist(page, () => ({
    items: complete, checklist_current: true, account_linked: true, account_reviewed: true,
    account_email: "applicant@example.invalid",
    ...(decided ? { onboarding_status: "active", onboarding_revision: 2, vendor_role_held: true, eligible: true,
      events: [{ revision: 2, action: "activate", before_status: "review", after_status: "active", reason: "All checks reviewed", created_at: now }],
      last_role_decision: { outcome: "granted", onboarding_revision: 2 } } : {}),
  }));
  const dialog = await openChecklist(page);
  await dialog.getByRole("button", { name: "Activate provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Activate this provider?" });
  await expect(confirm.getByText("Grants the vendor role to applicant@example.invalid", { exact: false })).toBeVisible();
  await expect(confirm.getByText("Matching also requires active packages and coverage", { exact: false })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Activate", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("All checks reviewed");
  const request = page.waitForRequest("**/rpc/vendor_decide_onboarding");
  await confirm.getByRole("button", { name: "Activate", exact: true }).click();
  const sent = (await request).postDataJSON();
  expect(sent).toMatchObject({ p_contractor: contractor, p_expected_revision: 1, p_action: "activate", p_reason: "All checks reviewed" });
  expect(sent.p_key).toMatch(/^onboarding-decision:[0-9a-f-]+:1:activate$/);
  await expect(confirm).not.toBeVisible();
  await expect(dialog.getByText("Active · revision 2")).toBeVisible();
  await expect(dialog.getByText("Vendor role held")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Suspend provider" })).toBeVisible();
});

test("activation without a reviewed account says no role follows", async ({ page }) => {
  await checklist(page, { items: complete, checklist_current: true });
  const dialog = await openChecklist(page);
  await dialog.getByRole("button", { name: "Activate provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Activate this provider?" });
  await expect(confirm.getByText("No reviewed account is bound, so no vendor role is granted", { exact: false })).toBeVisible();
});

test("a decision the readback does not confirm keeps the confirmation open", async ({ page }) => {
  await page.route("**/rpc/vendor_decide_onboarding", route => route.fulfill({ json: 2 }));
  await checklist(page, { items: complete, checklist_current: true });
  const dialog = await openChecklist(page);
  await dialog.getByRole("button", { name: "Reject provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Reject this provider?" });
  await confirm.getByRole("textbox").fill("Synthetic rejection");
  await confirm.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm).toBeVisible();
});

test("an active provider offers suspension and renewal only", async ({ page }) => {
  await checklist(page, { items: complete, checklist_current: true, onboarding_status: "active", onboarding_revision: 3, vendor_role_held: true });
  const dialog = await openChecklist(page);
  await expect(dialog.getByRole("button", { name: "Activate provider" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Reject provider" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Record renewal" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Suspend provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Suspend this provider?" });
  await expect(confirm.getByText("The vendor role is kept", { exact: false })).toBeVisible();
});

test("a suspended provider's renewal does not lift the suspension", async ({ page }) => {
  await checklist(page, { items: complete, checklist_current: true, onboarding_status: "suspended", onboarding_revision: 4 });
  const dialog = await openChecklist(page);
  await expect(dialog.getByRole("button", { name: "Reactivate provider" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Record renewal" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record renewal for this provider?" });
  await expect(confirm.getByText("It does not lift the suspension.", { exact: false })).toBeVisible();
});

test("a rejected provider takes no evidence or decisions", async ({ page }) => {
  await checklist(page, { onboarding_status: "rejected", onboarding_revision: 2 });
  const dialog = await openChecklist(page);
  await expect(dialog.getByText("This provider was rejected, so it takes no further evidence.")).toBeVisible();
  await expect(dialog.getByLabel("Checklist item (required)", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Onboarding decision" })).toHaveCount(0);
});

test("a superseded application revision blocks evidence in place", async ({ page }) => {
  await checklist(page, { version_current: false });
  const dialog = await openChecklist(page);
  await expect(dialog.getByText("Rebind onboarding to the current version before recording evidence", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Checklist item (required)", { exact: true })).toHaveCount(0);
});
