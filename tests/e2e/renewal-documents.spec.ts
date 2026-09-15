import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-073 synthetic browser evidence. Submissions, storage and decisions are mocked
// readbacks and requests; nothing here claims a real document, provider or review. The
// real route, Storage and database round trip is recorded separately in validation.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const contractor = "00000000-0000-4000-8000-000000000052";
const day = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * day).toISOString();
const path = (kind: string, n: number) =>
  `renewals/${contractor}/${kind}/00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}-synthetic-${kind}.pdf`;
const ownDocuments = [
  { id: "00000000-0000-4000-8000-000000000731", kind: "insurance", file_name: "synthetic-insurance.pdf", submitted_as: "provider", created_at: at(-1), state: "submitted", note: null, decided_at: null },
  { id: "00000000-0000-4000-8000-000000000732", kind: "license", file_name: "synthetic-license.pdf", submitted_as: "operator", created_at: at(-9), state: "accepted", note: null, decided_at: at(-8) },
  { id: "00000000-0000-4000-8000-000000000733", kind: "license", file_name: "synthetic-license-scan.jpg", submitted_as: "provider", created_at: at(-12), state: "declined", note: "Synthetic: the policy period is cut off. Send the full certificate.", decided_at: at(-11) },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

function own(page: Page, body: () => Record<string, unknown>) {
  return page.route("**/rpc/vendor_own_renewal_documents", route =>
    route.fulfill({ json: { accepting: true, open_limit: 5, documents: ownDocuments, ...body() } }));
}

async function openVendorPage(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "vendor");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/vendor/compliance");
  await expect(page.getByRole("heading", { level: 1, name: "Compliance documents" })).toBeVisible();
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor compliance documents ${theme} ${width}px`, async ({ page }) => {
    await own(page, () => ({}));
    await openVendorPage(page, theme, width);
    await expect(page.getByRole("heading", { name: "Upload a renewed document" })).toBeVisible();
    const list = page.getByRole("list", { name: "Your submissions" });
    await expect(list.getByText("Awaiting review")).toBeVisible();
    await expect(list.getByText("Accepted", { exact: true })).toBeVisible();
    await expect(list.getByText("Declined", { exact: true })).toBeVisible();
    await expect(list.getByText("Synthetic: the policy period is cut off. Send the full certificate.")).toBeVisible();
    await expect(list.getByText("Uploaded for you by Mercurius", { exact: false })).toBeVisible();
    await expect(page.getByText("does not change your status or listing", { exact: false })).toBeVisible();
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (width >= 1024) {
      const nav = page.getByRole("navigation", { name: "vendor navigation" });
      await expect(nav.getByRole("link", { name: "Compliance Documents" })).toHaveAttribute("aria-current", "page");
    }
    await page.screenshot({ path: `test-results/renewal-documents-vendor-${theme}-${width}.png`, fullPage: true });
  });
}

test("a vendor upload asks for a grant, uploads to storage and is confirmed by rereading", async ({ page }) => {
  let submitted = false;
  await own(page, () => submitted
    ? { documents: [{ id: "00000000-0000-4000-8000-000000000799", kind: "license", file_name: "Renewed-License.pdf", submitted_as: "provider", created_at: at(0), state: "submitted", note: null, decided_at: null }, ...ownDocuments] }
    : {});
  const grantPath = `renewals/00000000-0000-4000-8000-000000000002/license/00000000-0000-4000-8000-000000000798-Renewed-License.pdf`;
  const grants: unknown[] = [];
  const submits: unknown[] = [];
  const uploads: string[] = [];
  await page.route("**/api/renewal-documents", route => {
    grants.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { path: grantPath, token: "synthetic-upload-token" } });
  });
  await page.route("**/storage/v1/object/upload/sign/**", route => {
    uploads.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ json: { Key: `vendor-documents/${grantPath}` }, headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:3103" } });
  });
  await page.route("**/api/renewal-documents/submit", route => {
    submits.push(route.request().postDataJSON());
    submitted = true;
    return route.fulfill({ json: { documentId: "00000000-0000-4000-8000-000000000799", kind: "license", recorded: true } });
  });
  await openVendorPage(page, "light", 1440);
  const submit = page.getByRole("button", { name: "Submit document" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Document type (required)", { exact: true }).selectOption("license");
  await page.getByLabel("File (required)", { exact: true }).setInputFiles({ name: "Renewed License.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic") });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("status").getByText("License submitted. Mercurius will review it and record the new expiry.")).toBeVisible();
  expect(grants).toEqual([{ kind: "license", file: { name: "Renewed License.pdf", type: "application/pdf", size: 18 } }]);
  expect(uploads).toEqual([`PUT /storage/v1/object/upload/sign/vendor-documents/${grantPath}`]);
  expect(submits).toEqual([{ path: grantPath }]);
  await expect(page.getByRole("list", { name: "Your submissions" }).getByText("License · Renewed-License.pdf")).toBeVisible();
  await expect(submit).toBeDisabled();
});

test("a vendor sees the refusal when the server does not accept the upload", async ({ page }) => {
  await own(page, () => ({ documents: [] }));
  await page.route("**/api/renewal-documents", route =>
    route.fulfill({ status: 400, json: { error: "Too many renewal documents are awaiting review" } }));
  await openVendorPage(page, "light", 1440);
  await page.getByLabel("Document type (required)", { exact: true }).selectOption("insurance");
  await page.getByLabel("File (required)", { exact: true }).setInputFiles({ name: "coi.png", mimeType: "image/png", buffer: Buffer.from("synthetic") });
  await page.getByRole("button", { name: "Submit document" }).click();
  await expect(page.getByText("Too many renewal documents are awaiting review")).toBeVisible();
  await expect(page.getByRole("status").getByText("submitted.", { exact: false })).toHaveCount(0);
});

test("a vendor file of the wrong type is refused before upload", async ({ page }) => {
  let requested = false;
  await own(page, () => ({ documents: [] }));
  await page.route("**/api/renewal-documents", route => { requested = true; return route.abort(); });
  await openVendorPage(page, "light", 320);
  await page.getByLabel("Document type (required)", { exact: true }).selectOption("license");
  await page.getByLabel("File (required)", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic") });
  await expect(page.getByText("Use a PDF, JPG, PNG, WebP, HEIC, or HEIF file.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit document" })).toBeDisabled();
  expect(requested).toBe(false);
});

test("the upload waits when five documents for an item await review", async ({ page }) => {
  await own(page, () => ({
    documents: Array.from({ length: 5 }, (_, index) => ({ ...ownDocuments[0], id: `00000000-0000-4000-8000-00000000074${index}` })),
  }));
  await openVendorPage(page, "light", 1440);
  await page.getByLabel("Document type (required)", { exact: true }).selectOption("insurance");
  await expect(page.getByText("You have 5 insurance documents awaiting review.", { exact: false })).toBeVisible();
  await page.getByLabel("File (required)", { exact: true }).setInputFiles({ name: "coi.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF synthetic") });
  await expect(page.getByRole("button", { name: "Submit document" })).toBeDisabled();
  await page.getByLabel("Document type (required)", { exact: true }).selectOption("license");
  await expect(page.getByRole("button", { name: "Submit document" })).toBeEnabled();
});

test("providers not yet active see why uploads are unavailable", async ({ page }) => {
  await own(page, () => ({ accepting: false, documents: [] }));
  await openVendorPage(page, "light", 320);
  await expect(page.getByRole("heading", { name: "Renewal uploads are not available yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact Mercurius" })).toHaveAttribute("href", "/contact");
  await expect(page.getByRole("heading", { name: "Upload a renewed document" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No documents submitted yet" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
});

test("a failed load offers a retry", async ({ page }) => {
  let calls = 0;
  await page.route("**/rpc/vendor_own_renewal_documents", route => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } })
      : route.fulfill({ json: { accepting: true, open_limit: 5, documents: [] } });
  });
  await openVendorPage(page, "light", 320);
  const alert = page.getByRole("alert").filter({ hasText: "Compliance documents unavailable" });
  await expect(alert).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Upload a renewed document" })).toBeVisible();
});

// Operator surfaces.
const checklistItems = ["identity", "agreement", "coverage", "license", "insurance", "bank_authorization", "profile_pricing", "availability", "test_notification"]
  .map((kind, index) => ({
    kind, evidence_id: `00000000-0000-4000-8000-0000000006${String(index).padStart(2, "0")}`, requirement_version: `${kind}-v1`,
    evidence_ref: ["license", "insurance"].includes(kind) ? `synthetic/applicant/${kind}.pdf` : `Synthetic ${kind}`,
    accepted_at: at(-300), expires_at: kind === "license" ? at(-1) : ["insurance"].includes(kind) ? at(200) : null,
    state: kind === "license" ? "expired" : "current", renewal_due: false,
  }));
const operatorDocuments = [
  { id: "00000000-0000-4000-8000-000000000751", contractor_id: contractor, kind: "license", file_name: "synthetic-license.pdf", storage_path: path("license", 51),
    mime_type: "application/pdf", size_bytes: 120_000, submitted_as: "provider", created_at: at(-1), state: "submitted", note: null, decided_at: null, evidence_id: null },
  { id: "00000000-0000-4000-8000-000000000752", contractor_id: contractor, kind: "insurance", file_name: "synthetic-insurance.pdf", storage_path: path("insurance", 52),
    mime_type: "application/pdf", size_bytes: 80_000, submitted_as: "operator", created_at: at(-3), state: "declined", note: "Synthetic: wrong insured name.", decided_at: at(-2), evidence_id: null },
];

async function openOperatorChecklist(page: Page, overview: () => Record<string, unknown>, theme = "light", width = 320) {
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    Object.assign(data, { contractor_id: contractor, onboarding_status: "active", onboarding_revision: 4, onboarding_version_id: "00000000-0000-4000-8000-000000000051", review_started: true });
    await route.fulfill({ response, json: data });
  });
  await page.route("**/rpc/vendor_onboarding_checklist", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, onboarding_status: "active", onboarding_revision: 4, items: checklistItems, renewal_notice_days: 30 } });
  });
  await page.route("**/rpc/vendor_renewal_document_overview", route =>
    route.fulfill({ json: { contractor_id: contractor, onboarding_status: "active", open_limit: 5, documents: operatorDocuments, ...overview() } }));
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/applications");
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByRole("heading", { name: "Renewal documents" })).toBeVisible();
  return dialog;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`operator renewal documents ${theme} ${width}px`, async ({ page }) => {
    const dialog = await openOperatorChecklist(page, () => ({}), theme, width);
    const list = dialog.getByRole("list", { name: "Renewal documents" });
    await expect(list.getByText("License · synthetic-license.pdf")).toBeVisible();
    await expect(list.getByText("Awaiting review")).toBeVisible();
    await expect(list.getByText("Note to provider: Synthetic: wrong insured name.")).toBeVisible();
    await expect(list.getByRole("button", { name: "Decline" })).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Upload for review" })).toBeDisabled();
    await list.getByText("License · synthetic-license.pdf").scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(tags).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/renewal-documents-operator-${theme}-${width}.png` });
  });
}

test("an operator declines with a note the provider sees", async ({ page }) => {
  const dialog = await openOperatorChecklist(page, () => ({}));
  await dialog.getByRole("list", { name: "Renewal documents" }).getByRole("button", { name: "Decline" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Decline this renewal document?" });
  await expect(confirm.getByText("which the provider sees", { exact: false })).toBeVisible();
  const decline = confirm.getByRole("button", { name: "Decline", exact: true });
  await expect(decline).toBeDisabled();
  await confirm.getByLabel("Note to the provider (required)", { exact: true }).fill("Synthetic: the certificate is unreadable.");
  const request = page.waitForRequest("**/rpc/vendor_decline_renewal_document");
  await decline.click();
  const sent = (await request).postDataJSON();
  expect(sent).toMatchObject({ p_document: operatorDocuments[0].id, p_note: "Synthetic: the certificate is unreadable." });
  expect(sent.p_key).toMatch(new RegExp(`^renewal-decline:[0-9a-f-]+:${operatorDocuments[0].id}$`));
  // The fixture refuses the mutation, so the confirmation stays open with its error.
  await expect(confirm.getByRole("alert")).toBeFocused();
});

test("an operator accepts a renewal document by recording it as license evidence", async ({ page }) => {
  const dialog = await openOperatorChecklist(page, () => ({}));
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("license");
  const document = dialog.getByLabel("Document (required)", { exact: true });
  await expect(document.locator("optgroup")).toHaveCount(2);
  await expect(document.locator('optgroup[label="Renewal documents awaiting review"] option')).toHaveCount(1);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("insurance");
  await expect(document.locator('optgroup[label="Renewal documents awaiting review"]')).toHaveCount(0);
  await dialog.getByLabel("Checklist item (required)", { exact: true }).selectOption("license");
  await dialog.getByLabel("Requirement version (required)", { exact: true }).fill("state-license-v2");
  await document.selectOption(operatorDocuments[0].storage_path);
  await dialog.getByLabel("Reviewed at (required)", { exact: true }).fill("2026-01-01T09:00");
  await dialog.getByLabel("Expires (required)", { exact: true }).fill("2099-01-01T09:00");
  await dialog.getByRole("button", { name: "Replace evidence" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record this checklist evidence?" });
  await expect(confirm.getByText("Accepts the license renewal document synthetic-license.pdf, which the provider will see as accepted.", { exact: false })).toBeVisible();
  const request = page.waitForRequest("**/rpc/vendor_record_checklist_evidence");
  await confirm.getByRole("button", { name: "Record", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    p_contractor: contractor, p_kind: "license", p_reference: operatorDocuments[0].storage_path,
    p_supersedes: checklistItems[3].evidence_id, p_expires: new Date("2099-01-01T09:00").toISOString(),
  });
  await expect(confirm.getByRole("alert")).toBeFocused();
});

test("an operator uploads a document on the provider's behalf", async ({ page }) => {
  const grants: unknown[] = [];
  await page.route("**/api/renewal-documents", route => {
    grants.push(route.request().postDataJSON());
    return route.fulfill({ status: 403, json: { error: "Onboarding operator required" } });
  });
  const dialog = await openOperatorChecklist(page, () => ({}), "light", 1440);
  await dialog.getByLabel("Document for (required)", { exact: true }).selectOption("insurance");
  await dialog.getByLabel("File (required)", { exact: true }).setInputFiles({ name: "emailed-coi.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF synthetic") });
  await dialog.getByRole("button", { name: "Upload for review" }).click();
  await expect(page.getByText("Onboarding operator required")).toBeVisible();
  expect(grants).toEqual([{ kind: "insurance", contractorId: contractor, file: { name: "emailed-coi.pdf", type: "application/pdf", size: 14 } }]);
});

test("a provider under review offers no renewal upload", async ({ page }) => {
  const dialog = await openOperatorChecklist(page, () => ({ onboarding_status: "review", documents: [] }));
  await expect(dialog.getByText("No renewal documents have been submitted.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Upload for review" })).toHaveCount(0);
});

test("the compliance expiry page lists renewal documents awaiting review", async ({ page }) => {
  await page.route("**/rpc/vendor_evidence_renewal_queue", route => route.fulfill({
    json: { evaluated_at: new Date().toISOString(), notice_days: 30, cutover_enforced: false, entries: [] },
  }));
  await page.route("**/rpc/vendor_renewal_document_queue", route => route.fulfill({
    json: { evaluated_at: new Date().toISOString(), entries: [{ ...operatorDocuments[0], name: "Synthetic Renewal Services", onboarding_status: "active" }] },
  }));
  await syntheticSession(page.context(), "admin");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/compliance/renewals");
    await expect(page.getByRole("heading", { name: "Renewal documents awaiting review (1)" })).toBeVisible();
    const list = width < 1280
      ? page.getByRole("list", { name: "Renewal documents awaiting review" })
      : page.getByRole("table", { name: "Renewal documents awaiting review" });
    await expect(list.getByRole("link", { name: "Synthetic Renewal Services" })).toHaveAttribute("href", `/admin/vendors/${contractor}`);
    await expect(list.getByText("License · synthetic-license.pdf")).toBeVisible();
    await expect(list.getByText("By the provider")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No evidence needs renewal" })).toBeVisible();
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});
