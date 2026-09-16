import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-074 synthetic browser evidence. The retention queue, route and hold commands are
// mocked readbacks and requests; nothing here claims a real document, provider or
// deletion. The real route, Storage and database round trip is recorded in validation.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const day = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * day).toISOString();
const providerA = "00000000-0000-4000-8000-000000000081";
const providerB = "00000000-0000-4000-8000-000000000082";
const id = (n: number) => `00000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`;
const entry = (n: number, overrides: Record<string, unknown>) => ({
  id: id(n), contractor_id: providerA, name: "Synthetic Retention Services", kind: "license", file_name: `synthetic-license-${n}.pdf`,
  storage_path: `renewals/${providerA}/license/${id(n)}-synthetic-license-${n}.pdf`, mime_type: "application/pdf", size_bytes: 90_000,
  submitted_as: "provider", created_at: at(-130), state: "declined", note: "Synthetic decline", decided_at: at(-120), evidence_id: null,
  retention_state: "retained", retention_since: null, retention_ends_at: at(-30), quarantine_ends_at: null, object_location: "documents", held: false,
  ...overrides,
});
const due = entry(1, {});
const heldDue = entry(2, { contractor_id: providerB, name: "Synthetic Held Provider", kind: "insurance", file_name: "synthetic-insurance-2.pdf", held: true });
const deletable = entry(3, { retention_state: "quarantined", retention_since: at(-20), quarantine_ends_at: at(-6), object_location: "quarantine" });
const waiting = entry(4, { retention_state: "quarantined", retention_since: at(-9), quarantine_ends_at: at(5), object_location: "quarantine" });
const hold = { contractor_id: providerB, name: "Synthetic Held Provider", reason: "Synthetic investigation", placed_at: at(-2) };

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

function queue(page: Page, body: () => Record<string, unknown>) {
  return page.route("**/rpc/vendor_document_retention_queue", route => route.fulfill({
    json: { evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, due: [due, heldDue], quarantined: [deletable, waiting], holds: [hold], ...body() },
  }));
}

async function openRetention(page: Page, theme = "light", width = 1440) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/compliance/retention");
  await expect(page.getByRole("heading", { level: 1, name: "Document retention" })).toBeVisible();
}

const list = (page: Page, name: string) =>
  page.viewportSize()!.width < 1280 ? page.getByRole("list", { name }) : page.getByRole("table", { name });

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`document retention queue ${theme} ${width}px`, async ({ page }) => {
    await queue(page, () => ({}));
    await openRetention(page, theme, width);
    await expect(page.getByRole("heading", { name: "Due for quarantine (2)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "In quarantine (2)" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Retention holds" }).getByText("Synthetic investigation")).toBeVisible();
    const dueList = list(page, "Due for quarantine");
    await expect(dueList.getByRole("button", { name: "Quarantine" })).toHaveCount(1);
    await expect(dueList.getByText("On retention hold. Release the hold before quarantining.")).toBeVisible();
    const quarantined = list(page, "In quarantine");
    await expect(quarantined.getByRole("button", { name: "Restore" })).toHaveCount(2);
    await expect(quarantined.getByRole("button", { name: "Delete permanently" })).toHaveCount(1);
    await expect(quarantined.getByText("Deletion opens in 5 days")).toBeVisible();
    await expect(quarantined.getByText("Deletion is open")).toBeVisible();
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (width >= 1024) {
      const nav = page.getByRole("navigation", { name: "admin navigation" });
      await expect(nav.getByRole("link", { name: "Document Retention" })).toHaveAttribute("aria-current", "page");
    }
    await page.screenshot({ path: `test-results/renewal-retention-${theme}-${width}.png`, fullPage: true });
  });
}

test("quarantine asks for a reason, calls the route and is confirmed by rereading", async ({ page }) => {
  let moved = false;
  const sent: Record<string, unknown>[] = [];
  await queue(page, () => (moved ? { due: [heldDue], quarantined: [{ ...due, retention_state: "quarantined", retention_since: at(0), quarantine_ends_at: at(14), object_location: "quarantine" }, deletable, waiting] } : {}));
  await page.route("**/api/renewal-documents/retention", route => {
    sent.push(route.request().postDataJSON());
    moved = true;
    return route.fulfill({ json: { documentId: due.id, action: "quarantine", recorded: true, underHold: false } });
  });
  await openRetention(page);
  await list(page, "Due for quarantine").getByRole("button", { name: "Quarantine" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Move this document to quarantine?" });
  await expect(confirm.getByText("operators cannot open it", { exact: false })).toBeVisible();
  const submit = confirm.getByRole("button", { name: "Quarantine", exact: true });
  await expect(submit).toBeDisabled();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: retention period ended.");
  await submit.click();
  await expect(page.getByText("Document quarantined")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ documentId: due.id, action: "quarantine", reason: "Synthetic: retention period ended." });
  expect(sent[0].key).toMatch(new RegExp(`^renewal-retention:[0-9a-f-]+:quarantine:${due.id}:declined$`));
  await expect(page.getByRole("heading", { name: "In quarantine (3)" })).toBeVisible();
});

test("permanent deletion warns it cannot be undone and keeps the dialog open on refusal", async ({ page }) => {
  await queue(page, () => ({}));
  await page.route("**/api/renewal-documents/retention", route =>
    route.fulfill({ status: 400, json: { error: "This provider is on a retention hold" } }));
  await openRetention(page);
  await list(page, "In quarantine").getByRole("button", { name: "Delete permanently" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this document permanently?" });
  await expect(confirm.getByText("This cannot be undone.", { exact: false })).toBeVisible();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: quarantine ended.");
  await confirm.getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(page.getByText("This provider is on a retention hold")).toBeVisible();
});

test("a queue that does not confirm the step is reported, not assumed", async ({ page }) => {
  await queue(page, () => ({}));
  await page.route("**/api/renewal-documents/retention", route =>
    route.fulfill({ json: { documentId: waiting.id, action: "restore", recorded: true, underHold: false } }));
  await openRetention(page);
  await list(page, "In quarantine").getByRole("button", { name: "Restore" }).nth(1).click();
  const confirm = page.getByRole("alertdialog", { name: "Restore this document?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: keep for review.");
  await confirm.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("The server did not confirm this step. Review the queue before retrying.")).toBeVisible();
  await expect(confirm.getByRole("alert")).toBeFocused();
});

test("an operator releases a retention hold", async ({ page }) => {
  let released = false;
  await queue(page, () => (released ? { holds: [], due: [due, { ...heldDue, held: false }] } : {}));
  const requests: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_release_retention_hold", route => {
    requests.push(route.request().postDataJSON());
    released = true;
    return route.fulfill({ json: { contractor_id: providerB, action: "released", recorded: true } });
  });
  await openRetention(page, "light", 320);
  await page.getByRole("list", { name: "Retention holds" }).getByRole("button", { name: "Release hold" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Release this retention hold?" });
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic: investigation closed.");
  await confirm.getByRole("button", { name: "Release hold", exact: true }).click();
  await expect(page.getByText("Retention hold released")).toBeVisible();
  expect(requests[0]).toMatchObject({ p_contractor: providerB, p_reason: "Synthetic: investigation closed." });
  await expect(page.getByText("No provider is on a retention hold.")).toBeVisible();
  await expect(list(page, "Due for quarantine").getByRole("button", { name: "Quarantine" })).toHaveCount(2);
});

test("a failed load offers a retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/rpc/vendor_document_retention_queue", route => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } })
      : route.fulfill({ json: { evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, due: [], quarantined: [], holds: [] } });
  });
  await openRetention(page, "light", 320);
  await expect(page.getByRole("alert").filter({ hasText: "Document retention queue unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No declined document has passed its 90-day retention period.")).toBeVisible();
  await expect(page.getByText("No document is in quarantine.")).toBeVisible();
});

// Provider activation checklist: hold placement and retention badges.
const checklistContractor = "00000000-0000-4000-8000-000000000052";
async function openChecklist(page: Page, overview: () => Record<string, unknown>) {
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    Object.assign(data, { contractor_id: checklistContractor, onboarding_status: "active", onboarding_revision: 4, onboarding_version_id: "00000000-0000-4000-8000-000000000051", review_started: true });
    await route.fulfill({ response, json: data });
  });
  await page.route("**/rpc/vendor_renewal_document_overview", route => route.fulfill({
    json: {
      contractor_id: checklistContractor, onboarding_status: "active", open_limit: 5, retention_hold: null,
      documents: [
        { ...entry(5, { contractor_id: checklistContractor, retention_state: "quarantined" }) },
        { ...entry(6, { contractor_id: checklistContractor, kind: "insurance", file_name: "synthetic-insurance-6.pdf", retention_state: "deleted" }) },
        { ...entry(7, { contractor_id: checklistContractor, file_name: "synthetic-license-7.pdf" }) },
      ],
      ...overview(),
    },
  }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/applications");
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("heading", { name: "Renewal documents" })).toBeVisible();
  return dialog;
}

test("the checklist shows retention state and offers Open only for retained files", async ({ page }) => {
  const dialog = await openChecklist(page, () => ({}));
  const documents = dialog.getByRole("list", { name: "Renewal documents" });
  await expect(documents.getByText("In quarantine", { exact: true })).toBeVisible();
  await expect(documents.getByText("Deleted", { exact: true })).toBeVisible();
  await expect(documents.getByRole("button", { name: /^Open / })).toHaveCount(1);
  await expect(documents.getByRole("button", { name: "Open synthetic-license-7.pdf" })).toBeVisible();
  await expect(documents.getByText("The file was deleted under the retention policy. This record remains.")).toBeVisible();
  await expect(dialog.getByText("No retention hold")).toBeVisible();
  await documents.scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(tags).analyze()).violations).toEqual([]);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("an operator places a retention hold from the checklist, confirmed by rereading", async ({ page }) => {
  let held = false;
  const requests: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_place_retention_hold", route => {
    requests.push(route.request().postDataJSON());
    held = true;
    return route.fulfill({ json: { contractor_id: checklistContractor, action: "placed", recorded: true } });
  });
  const dialog = await openChecklist(page, () => (held ? { retention_hold: { reason: "Synthetic legal hold", placed_at: at(0) } } : {}));
  await dialog.getByRole("button", { name: "Place hold" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Place a retention hold?" });
  await expect(confirm.getByText("Nothing else about the provider changes.", { exact: false })).toBeVisible();
  await confirm.getByLabel("Reason (required)", { exact: true }).fill("Synthetic legal hold");
  await confirm.getByRole("button", { name: "Place hold", exact: true }).click();
  await expect(page.getByText("Retention hold placed")).toBeVisible();
  expect(requests[0]).toMatchObject({ p_contractor: checklistContractor, p_reason: "Synthetic legal hold" });
  expect(requests[0].p_key).toMatch(/^retention-hold-place:[0-9a-f-]+:0$/);
  await expect(dialog.getByText("Retention hold in force")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Release hold" })).toBeVisible();
});
