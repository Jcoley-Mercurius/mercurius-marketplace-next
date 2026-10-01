import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-084 and TRACE-090 synthetic browser evidence. The application retention queue, overview, route
// and commands are mocked readbacks and requests; nothing here claims a real application,
// document or deletion. The database contracts are suites 051 and 057.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const day = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * day).toISOString();
const applicationId = "00000000-0000-4000-8000-000000000050";
const otherApplication = "00000000-0000-4000-8000-000000000090";
const filePath = (application: string, kind: string, n: number) =>
  `${application}/${kind}/00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}-synthetic-${kind}-${n}.pdf`;
const file = (n: number, overrides: Record<string, unknown>) => ({
  application_id: otherApplication, business_name: "Synthetic Closed Applicant", application_status: "rejected",
  path: filePath(otherApplication, "license", n), kind: "license", file_name: `synthetic-license-${n}.pdf`,
  attached: true, uploaded_at: at(-200), closure_outcome: "rejected", closed_at: at(-120), closure_source: "closure", retention_ends_at: at(-30),
  retention_state: "retained", retention_since: null, quarantine_ends_at: null, object_location: "documents",
  bound_to_evidence: false, held: false,
  ...overrides,
});
const due = file(1, {});
const heldDue = file(2, { business_name: "Synthetic Held Applicant", kind: "insurance", file_name: "synthetic-insurance-2.pdf", held: true,
  closure_outcome: "abandoned", path: filePath(otherApplication, "insurance", 2) });
const deletable = file(3, { retention_state: "quarantined", retention_since: at(-20), quarantine_ends_at: at(-6), object_location: "quarantine" });
const reopened = file(4, { retention_state: "quarantined", retention_since: at(-20), quarantine_ends_at: at(-6), object_location: "quarantine",
  closure_outcome: null, closed_at: null, closure_source: null, retention_ends_at: null, application_status: "pending" });
const kept = file(5, { bound_to_evidence: true, business_name: "Synthetic Rejected Provider", closure_source: "onboarding" });
// TRACE-090: uploads never attached, on an open application with no closure.
const unattached = (n: number, overrides: Record<string, unknown>) => file(n, {
  application_id: applicationId, business_name: "Synthetic Open Applicant", application_status: "pending",
  path: filePath(applicationId, "other", n), kind: "other", file_name: `synthetic-other-${n}.pdf`, attached: false, uploaded_at: at(-9),
  closure_outcome: null, closed_at: null, closure_source: null, retention_ends_at: at(-2 + 1 / 12),
  ...overrides,
});
const unattachedDue = unattached(6, {});
const unattachedQuarantined = unattached(7, { retention_state: "quarantined", retention_since: at(-15), quarantine_ends_at: at(-1), object_location: "quarantine" });
const hold = { application_id: otherApplication, business_name: "Synthetic Held Applicant", reason: "Synthetic investigation", placed_at: at(-2) };
const unrecorded = { application_id: "00000000-0000-4000-8000-000000000091", business_name: "Synthetic Legacy Applicant", status: "rejected", has_provider: false };

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

function queue(page: Page, body: () => Record<string, unknown>) {
  return page.route("**/rpc/vendor_application_retention_queue", route => route.fulfill({
    json: {
      evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, unattached_days: 7, upload_grant_hours: 2,
      due: [due, heldDue], unattached_due: [], quarantined: [deletable, reopened], kept: [kept], unattached_kept: [],
      unrecorded: [unrecorded], holds: [hold], ...body(),
    },
  }));
}

async function openRetention(page: Page, theme = "light", width = 1440) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/compliance/retention");
  await expect(page.getByRole("heading", { level: 2, name: "Application documents" })).toBeVisible();
}

const list = (page: Page, name: string) =>
  page.viewportSize()!.width < 1280 ? page.getByRole("list", { name, exact: true }) : page.getByRole("table", { name, exact: true });

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`application document retention ${theme} ${width}px`, async ({ page }) => {
    await queue(page, () => ({ unattached_due: [unattachedDue] }));
    await openRetention(page, theme, width);
    await expect(page.getByRole("heading", { name: "Application documents due for quarantine (2)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Uploads never attached to an application (1)" })).toBeVisible();
    const unattachedList = list(page, "Uploads never attached to an application");
    await expect(unattachedList.getByText("Never attached · uploaded", { exact: false })).toBeVisible();
    await expect(unattachedList.getByRole("button", { name: "Quarantine" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Application documents in quarantine (2)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kept as compliance evidence (1)" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Application retention holds" }).getByText("Synthetic investigation")).toBeVisible();
    await expect(page.getByRole("list", { name: "Closed without a recorded time" }).getByText("Synthetic Legacy Applicant")).toBeVisible();
    const dueList = list(page, "Application documents due for quarantine");
    await expect(dueList.getByRole("button", { name: "Quarantine" })).toHaveCount(1);
    await expect(dueList.getByText("On retention hold. Release the hold before quarantining.")).toBeVisible();
    const quarantined = list(page, "Application documents in quarantine");
    await expect(quarantined.getByRole("button", { name: "Restore" })).toHaveCount(2);
    await expect(quarantined.getByRole("button", { name: "Delete permanently" })).toHaveCount(1);
    await expect(quarantined.getByText("Application reopened; deletion is closed")).toBeVisible();
    await expect(list(page, "Kept as compliance evidence").getByRole("button")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/application-retention-${theme}-${width}.png`, fullPage: true });
  });
}

test("application quarantine asks for a reason, calls the route and is confirmed by rereading", async ({ page }) => {
  let moved = false;
  const sent: Record<string, unknown>[] = [];
  await queue(page, () => (moved
    ? { due: [heldDue], quarantined: [{ ...due, retention_state: "quarantined", retention_since: at(0), quarantine_ends_at: at(14), object_location: "quarantine" }, deletable, reopened] }
    : {}));
  await page.route("**/api/vendor-applications/retention", route => {
    sent.push(route.request().postDataJSON());
    moved = true;
    return route.fulfill({ json: { applicationId: otherApplication, path: due.path, action: "quarantine", recorded: true, underHold: false } });
  });
  await openRetention(page);
  await list(page, "Application documents due for quarantine").getByRole("button", { name: "Quarantine" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Move this document to quarantine?" });
  await expect(confirm.getByText("The application and its closure do not change.", { exact: false })).toBeVisible();
  const submit = confirm.getByRole("button", { name: "Quarantine", exact: true });
  await expect(submit).toBeDisabled();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: retention period ended.");
  await submit.click();
  await expect(page.getByText("Document quarantined")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ applicationId: otherApplication, path: due.path, action: "quarantine", reason: "Synthetic: retention period ended." });
  expect(sent[0].key).toBe(`application-retention:${String(sent[0].key).split(":")[1]}:quarantine:${due.path}:closed`);
  await expect(page.getByRole("heading", { name: "Application documents in quarantine (3)" })).toBeVisible();
});

test("an application deletion refused by the server keeps the dialog open", async ({ page }) => {
  await queue(page, () => ({}));
  await page.route("**/api/vendor-applications/retention", route =>
    route.fulfill({ status: 400, json: { error: "This application is on a retention hold" } }));
  await openRetention(page);
  await list(page, "Application documents in quarantine").getByRole("button", { name: "Delete permanently" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this document permanently?" });
  await expect(confirm.getByText("This cannot be undone.", { exact: false })).toBeVisible();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: quarantine ended.");
  await confirm.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(page.getByText("This application is on a retention hold")).toBeVisible();
});

test("an operator releases an application hold from the queue", async ({ page }) => {
  let released = false;
  const requests: Record<string, unknown>[] = [];
  await queue(page, () => (released ? { holds: [], due: [due, { ...heldDue, held: false }] } : {}));
  await page.route("**/rpc/vendor_release_application_retention_hold", route => {
    requests.push(route.request().postDataJSON());
    released = true;
    return route.fulfill({ json: { application_id: otherApplication, action: "released", recorded: true } });
  });
  await openRetention(page, "light", 320);
  await page.getByRole("list", { name: "Application retention holds" }).getByRole("button", { name: "Release hold" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Release this retention hold?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: investigation closed.");
  await confirm.getByRole("button", { name: "Release hold", exact: true }).click();
  await expect(page.getByText("Retention hold released")).toBeVisible();
  expect(requests[0]).toMatchObject({ p_application: otherApplication, p_reason: "Synthetic: investigation closed." });
  await expect(page.getByText("No application is on a retention hold.")).toBeVisible();
  await expect(list(page, "Application documents due for quarantine").getByRole("button", { name: "Quarantine" })).toHaveCount(2);
});

// Applications dialog: recorded closure, legacy record, provider path, holds and file states.
async function openApplication(page: Page, overview: () => Record<string, unknown>, application: Record<string, unknown> = {}) {
  await page.route("**/rest/v1/vendor_applications*", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({ response, json: rows.map(row => ({ ...row, ...application })) });
  });
  await page.route("**/rpc/vendor_application_retention_overview", route => route.fulfill({
    json: {
      application_id: applicationId, application_status: "pending", has_provider: false, closure: null, closable: true,
      close_outcomes: ["rejected", "abandoned"], retention_days: 90, quarantine_days: 14, hold: null, provider_held: false, files: [],
      ...overview(),
    },
  }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/applications");
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("heading", { name: "Closure and retention" })).toBeVisible();
  return dialog;
}

test("an operator rejects an application with a reason, confirmed by rereading", async ({ page }) => {
  let closed = false;
  const requests: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_close_application", route => {
    requests.push(route.request().postDataJSON());
    closed = true;
    return route.fulfill({ json: { application_id: applicationId, outcome: "rejected", closed_at: at(0), recorded: true } });
  });
  // The onboarding panel remounts on the new status and rereads its own readback.
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, application_status: closed ? "rejected" : "pending" } });
  });
  const dialog = await openApplication(page, () => (closed
    ? { application_status: "rejected", closure: { outcome: "rejected", closed_at: at(0), source: "closure", reason: "Synthetic: licensing not met." },
        closable: false, close_outcomes: [] }
    : {}));
  await expect(dialog.getByRole("button", { name: "Mark abandoned" })).toBeVisible();
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Reject this application?" });
  await expect(confirm.getByText("kept 90 days from today", { exact: false })).toBeVisible();
  const submit = confirm.getByRole("button", { name: "Reject", exact: true });
  await expect(submit).toBeDisabled();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: licensing not met.");
  await submit.click();
  await expect(page.getByText("Application rejected", { exact: true })).toBeVisible();
  expect(requests[0]).toMatchObject({ p_application: applicationId, p_outcome: "rejected", p_reason: "Synthetic: licensing not met." });
  expect(requests[0].p_key).toMatch(new RegExp(`^application-close:[0-9a-f-]+:${applicationId}:rejected$`));
  await expect(dialog.getByText("Recorded on this application: Synthetic: licensing not met.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  // TRACE-105: the header badge shows the queue state, not the raw status column.
  await expect(dialog.locator('[data-slot="dialog-header"]').getByText("Rejected", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Closed applications cannot start onboarding review.")).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(tags).analyze()).violations).toEqual([]);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("a legacy rejection offers only to record it", async ({ page }) => {
  const dialog = await openApplication(page, () => ({ application_status: "rejected", close_outcomes: ["rejected"] }), { status: "rejected" });
  await expect(dialog.getByRole("button", { name: "Record rejection" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark abandoned" })).toHaveCount(0);
  await expect(dialog.getByText("without a recorded time or reason", { exact: false })).toBeVisible();
});

test("an application with a provider is decided through onboarding review", async ({ page }) => {
  const dialog = await openApplication(page, () => ({ has_provider: true, closable: false, close_outcomes: [] }));
  await expect(dialog.getByText("Reject it through onboarding review", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
});

test("credential documents moved by retention offer no Open and evidence is reported kept", async ({ page }) => {
  const license = filePath(applicationId, "license", 11);
  const insurance = filePath(applicationId, "insurance", 12);
  const other = filePath(applicationId, "other", 13);
  const dialog = await openApplication(page, () => ({
    application_status: "rejected", closable: false, close_outcomes: [],
    closure: { outcome: "rejected", closed_at: at(-120), source: "onboarding", reason: "Synthetic onboarding rejection" },
    files: [
      file(11, { application_id: applicationId, path: license, retention_state: "quarantined", bound_to_evidence: false }),
      file(12, { application_id: applicationId, path: insurance, kind: "insurance", retention_state: "deleted" }),
      file(13, { application_id: applicationId, path: other, kind: "other", bound_to_evidence: true }),
    ],
  }), { status: "rejected", document_urls: [license, insurance, other] });
  const documents = dialog.getByRole("heading", { name: "Credential documents" }).locator("..");
  await expect(documents.getByText("In quarantine", { exact: true })).toBeVisible();
  await expect(documents.getByText("Deleted", { exact: true })).toBeVisible();
  await expect(documents.getByRole("button")).toHaveCount(1);
  await expect(documents.getByRole("button", { name: /synthetic-other-13\.pdf/ })).toBeVisible();
  await expect(dialog.getByText("Provider rejected in onboarding review: Synthetic onboarding rejection")).toBeVisible();
  await expect(dialog.getByText("1 document is compliance evidence and is kept.", { exact: false })).toBeVisible();
});

test("an operator places an application hold, confirmed by rereading", async ({ page }) => {
  let held = false;
  const requests: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_place_application_retention_hold", route => {
    requests.push(route.request().postDataJSON());
    held = true;
    return route.fulfill({ json: { application_id: applicationId, action: "placed", recorded: true } });
  });
  const dialog = await openApplication(page, () => (held ? { hold: { reason: "Synthetic legal hold", placed_at: at(0) } } : {}));
  await expect(dialog.getByText("No application hold")).toBeVisible();
  await dialog.getByRole("button", { name: "Place application hold" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Place an application hold?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic legal hold");
  await confirm.getByRole("button", { name: "Place application hold", exact: true }).click();
  await expect(page.getByText("Application hold placed")).toBeVisible();
  expect(requests[0]).toMatchObject({ p_application: applicationId, p_reason: "Synthetic legal hold" });
  expect(requests[0].p_key).toMatch(new RegExp(`^application-hold:[0-9a-f-]+:${applicationId}:place:0$`));
  await expect(dialog.getByText("Application hold in force")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Release application hold" })).toBeVisible();
});

test("a failed application queue load offers a retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/rpc/vendor_application_retention_queue", route => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } })
      : route.fulfill({ json: { evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, unattached_days: 7,
          upload_grant_hours: 2, due: [], unattached_due: [], quarantined: [], kept: [], unattached_kept: [], unrecorded: [], holds: [] } });
  });
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/compliance/retention");
  await expect(page.getByRole("alert").filter({ hasText: "Application document retention unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No application document is in quarantine.")).toBeVisible();
  await expect(page.getByText("Every closed application has a recorded closure.")).toBeVisible();
});

// TRACE-085: the page totals count renewal and application documents together.
test("queue totals add application documents and are withheld until that queue loads", async ({ page }) => {
  const renewal = { contractor_id: "00000000-0000-4000-8000-000000000070", name: "Synthetic Renewal Provider", kind: "license",
    file_name: "synthetic-renewal.pdf", decided_at: at(-120), retention_state: "retained", retention_since: null,
    retention_ends_at: at(-30), quarantine_ends_at: null, object_location: "documents", held: false };
  await page.route("**/rpc/vendor_document_retention_queue", route => route.fulfill({
    json: { evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14,
      due: [{ ...renewal, id: "00000000-0000-4000-8000-000000000071" }], quarantined: [],
      holds: [{ contractor_id: renewal.contractor_id, name: renewal.name, reason: "Synthetic provider hold", placed_at: at(-1) }] },
  }));
  let calls = 0;
  await page.route("**/rpc/vendor_application_retention_queue", route => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } })
      : route.fulfill({ json: { evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, unattached_days: 7,
          upload_grant_hours: 2, due: [due, heldDue], unattached_due: [unattachedDue], quarantined: [deletable, reopened], kept: [kept],
          unattached_kept: [], unrecorded: [], holds: [hold] } });
  });
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/compliance/retention");
  const totals = page.getByRole("region", { name: "Queue totals" });
  await expect(page.getByRole("alert").filter({ hasText: "Application document retention unavailable" })).toBeVisible();
  await expect(totals.getByText("Application queue not loaded")).toHaveCount(3);

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Application documents due for quarantine (2)" })).toBeVisible();
  expect(calls).toBe(2);
  const total = (label: string) => totals.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
  await expect(total("Due for quarantine")).toHaveText("4");
  await expect(total("In quarantine")).toHaveText("2");
  await expect(total("Retention holds")).toHaveText("2");
  await expect(totals.getByText("Application queue not loaded")).toHaveCount(0);
});

// TRACE-090: a never-attached upload has no closure, yet quarantine and deletion stay open.
test("a never-attached upload is quarantined and, once its quarantine ends, may be deleted", async ({ page }) => {
  let moved = false;
  const sent: Record<string, unknown>[] = [];
  await queue(page, () => (moved
    ? { unattached_due: [], quarantined: [unattachedQuarantined, { ...unattachedDue, retention_state: "quarantined", retention_since: at(0), quarantine_ends_at: at(14), object_location: "quarantine" }] }
    : { unattached_due: [unattachedDue], quarantined: [unattachedQuarantined], unattached_kept: [unattached(8, { bound_to_evidence: true })] }));
  await page.route("**/api/vendor-applications/retention", route => {
    sent.push(route.request().postDataJSON());
    moved = true;
    return route.fulfill({ json: { applicationId, path: unattachedDue.path, action: "quarantine", recorded: true, underHold: false } });
  });
  await openRetention(page);
  const quarantined = list(page, "Application documents in quarantine");
  await expect(quarantined.getByText("Application reopened; deletion is closed")).toHaveCount(0);
  await expect(quarantined.getByRole("button", { name: "Delete permanently" })).toHaveCount(1);
  await expect(list(page, "Kept as compliance evidence").getByText("Never attached · uploaded", { exact: false })).toBeVisible();

  await list(page, "Uploads never attached to an application").getByRole("button", { name: "Quarantine" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Move this document to quarantine?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: never attached; 7 days passed.");
  await confirm.getByRole("button", { name: "Quarantine", exact: true }).click();
  await expect(page.getByText("Document quarantined")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ applicationId, path: unattachedDue.path, action: "quarantine" });
  await expect(page.getByRole("heading", { name: "Uploads never attached to an application (0)" })).toBeVisible();
  await expect(page.getByText("No upload is waiting past its clock.")).toBeVisible();
});
