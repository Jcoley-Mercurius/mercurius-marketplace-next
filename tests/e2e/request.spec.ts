import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// Synthetic browser drafts only. No database, authentication or payment writes.
async function requestDraft(page: Page, step = "details", theme = "light", width = 390) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3103") return route.abort();
    if (url.pathname === "/api/request-coverage") return route.fulfill({ json: {
      status: "covered", area: null, checkedZip: "33904", message: "Synthetic covered area",
    } });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.addInitScript(({ step, theme }) => {
    localStorage.setItem("theme", theme);
    sessionStorage.setItem("nextRequestFlowState", JSON.stringify({
      step, selectedIds: ["general-home-service"], otherServiceDetails: "Synthetic test repair",
      city: "Cape Coral", stateCode: "FL",
    }));
  }, { step, theme });
  await page.goto("/request");
  await expect(page.locator("#request-step")).toBeVisible();
  if (step === "details") await expect(page.getByLabel("Street address", { exact: false })).toBeVisible();
}

test("request errors persist, link to fields, and step changes move focus", async ({ page }) => {
  await requestDraft(page);
  await page.getByRole("button", { name: "Continue to Review" }).click();
  const summary = page.getByRole("region", { name: "Please check your answers" });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link")).toHaveCount(2);
  await summary.getByRole("link", { name: "Enter the service street address." }).click();
  const street = page.getByLabel("Street address (required)", { exact: true });
  await expect(street).toBeFocused();
  await expect(street).toHaveAttribute("aria-invalid", "true");
  await expect(street).toHaveAccessibleDescription("Enter the service street address.");
  await street.fill("123 Synthetic Test Lane");
  await page.getByLabel("ZIP code (required)").fill("33904");
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 2);
  const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Window starts (required)").fill(date);
  await page.getByLabel("Window ends (required)").fill(date);
  await page.getByRole("button", { name: "Continue to Review" }).click();
  await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
  await expect(summary).toHaveCount(0);
  // Submit through the actual form so no hidden/native validation UI masks errors.
  await page.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link")).toHaveCount(4);
  await page.getByLabel("First name (required)").fill("Test");
  await page.getByLabel("Last name (required)").fill("Homeowner");
  await page.getByLabel("Email (required)", { exact: true }).fill("invalid-email");
  await page.getByLabel("Phone (required)", { exact: true }).fill("2395550100");
  await page.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(summary.getByRole("link")).toHaveText(["Enter a valid email address."]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#request-step")).toBeFocused();
  await expect(street).toHaveValue("123 Synthetic Test Lane");
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`request details ${theme} ${width}px: axe and reflow`, async ({ page }) => {
      await requestDraft(page, "details", theme, width);
      await page.getByRole("button", { name: "Continue to Review" }).click();
      await expect(page.getByRole("region", { name: "Please check your answers" })).toBeFocused();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.locator("main, main form, main section").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, children: Array.from(el.querySelectorAll("* ")).filter(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).slice(0, 8).map(child => child.outerHTML.slice(0, 220)) })))).toEqual([]);
      await page.screenshot({ path: `test-results/request-${theme}-${width}.png`, fullPage: true });
    });
  }
}

test("Enter on an address field validates the details step", async ({ page }) => {
  await requestDraft(page);
  await page.getByLabel("Street address (required)").press("Enter");
  await expect(page.getByRole("region", { name: "Please check your answers" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Enter the service street address." })).toBeVisible();
  await expect(page.getByLabel("First name (required)")).toHaveCount(0);
});

for (const step of ["services", "contact"]) {
  for (const theme of ["light", "dark"]) {
    test(`request ${step} ${theme}: mobile axe and reflow`, async ({ page }) => {
      await requestDraft(page, step, theme, 320);
      await expect(page.getByRole("status")).toContainText(step === "services" ? "Step 1" : "Step 3");
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.locator("main, main form, main section").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, children: Array.from(el.querySelectorAll("* ")).filter(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).slice(0, 8).map(child => child.outerHTML.slice(0, 220)) })))).toEqual([]);
      await page.screenshot({ path: `test-results/request-${step}-${theme}-320.png`, fullPage: true });
    });
  }
}

// TRACE-095: submission through submit_service_requests. Synthetic session and scripted
// RPC responses only; the database contract itself is proven by SQL suite 063.
const requestId = "00000000-0000-4000-8000-000000000050";
function futureDate(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const completeDraft = {
  step: "contact", selectedIds: ["lawn-mowing"], frequencies: { "lawn-mowing": "one-time" },
  streetAddress: "123 Synthetic Test Lane", city: "Cape Coral", stateCode: "FL", zipCode: "33904",
  preferredDate: futureDate(2), preferredEndDate: futureDate(4),
  firstName: "Test", lastName: "Homeowner", email: "homeowner@example.invalid", phone: "2395550100",
};
const submitted = (reused = false) => ({ status: "submitted", coverage: "covered", reused,
  outcomes: [{ selection_index: 0, service_id: "lawn-mowing", outcome: "eligible_quote", pricing_mode: "quote", total: null }],
  requests: [{ selection_index: 0, request_id: requestId, service_id: "lawn-mowing", pricing_mode: "custom_quote", quote_only: true, total_amount: null, package_id: null, package_tier_id: null }] });
const refused = (outcome: string) => ({ status: "refused", coverage: "covered", reused: false, requests: [],
  outcomes: [{ selection_index: 0, service_id: "lawn-mowing", outcome }] });

async function submissionDraft(page: Page, { signedIn = true, draft = {} as Record<string, unknown>, width = 390, theme = "light" } = {}) {
  if (signedIn) await syntheticSession(page.context(), "homeowner");
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:3103") {
      if (url.pathname === "/api/request-coverage") return route.fulfill({ json: { status: "covered", area: null, checkedZip: "33904" } });
      return url.pathname.startsWith("/api/") ? route.abort() : route.continue();
    }
    // Only authentication reaches the fixture; catalog reads fall back to static references.
    return url.origin === "http://127.0.0.1:55831" && url.pathname.startsWith("/auth/v1/") ? route.continue() : route.abort();
  });
  await page.route("**/rest/v1/rpc/start_request_matching", route => route.fulfill({ json: null }));
  await page.addInitScript(({ draft, theme }) => {
    localStorage.setItem("theme", theme);
    // Seed once so a navigation (such as the sign-in round trip) keeps the stored draft.
    if (!sessionStorage.getItem("nextRequestFlowState")) sessionStorage.setItem("nextRequestFlowState", JSON.stringify(draft));
  }, { draft: { ...completeDraft, ...draft }, theme });
  await page.goto("/request");
  if (draft.step === "details") await expect(page.getByLabel("Street address (required)")).toBeVisible();
  else await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeVisible();
}
const storedKey = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("nextRequestFlowState") ?? "{}").submissionKey as string | undefined);

test("verification failure stays recoverable and the retry reuses the submission key", async ({ page }) => {
  await submissionDraft(page);
  const calls: { p_submission_key: string; p_payload: { selections: Record<string, unknown>[]; location: Record<string, string> } }[] = [];
  await page.route("**/rest/v1/rpc/submit_service_requests", route => {
    calls.push(route.request().postDataJSON());
    return calls.length === 1 ? route.abort("failed") : route.fulfill({ json: submitted() });
  });
  await page.getByRole("button", { name: "Submit Request" }).click();
  const summary = page.getByRole("region", { name: "Please check your answers" });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("We couldn’t verify availability and pricing right now, so your request wasn’t confirmed.");
  await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeVisible();
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.getByRole("heading", { name: "Request Submitted!" })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[1].p_submission_key).toBe(calls[0].p_submission_key);
  expect(calls[1].p_payload).toEqual(calls[0].p_payload);
  expect(calls[0].p_payload.location).toEqual({ address: "123 Synthetic Test Lane", city: "Cape Coral", state: "FL", zip_code: "33904" });
  expect(calls[0].p_payload.selections[0]).toMatchObject({ service_id: "lawn-mowing", frequency: "one-time", expected: { pricing_mode: "quote" } });
  expect(Object.keys(calls[0].p_payload.selections[0])).not.toContain("total_amount");
});

for (const theme of ["light", "dark"]) {
  test(`unavailable service ${theme}: honest refusal, explicit interest, axe and reflow`, async ({ page }) => {
    await submissionDraft(page, { width: 320, theme });
    await page.route("**/rest/v1/rpc/submit_service_requests", route => route.fulfill({ json: refused("unavailable") }));
    let interest: Record<string, string> | null = null;
    await page.route("**/api/contact-submissions", route => { interest = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
    await page.getByRole("button", { name: "Submit Request" }).click();
    const summary = page.getByRole("region", { name: "Please check your answers" });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link")).toHaveText(["Lawn Care: Not available yet in your area."]);
    await summary.getByRole("link").click();
    await expect(page.locator("#submission-lawn-mowing")).toBeFocused();
    await expect(page.getByRole("heading", { name: "Some services can’t be requested yet" })).toBeVisible();
    expect(interest).toBeNull();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.locator("main, main form, main section").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).length)).toBe(0);
    await page.screenshot({ path: `test-results/request-unavailable-${theme}-320.png`, fullPage: true });
    await page.getByRole("button", { name: "Notify me when available" }).click();
    await expect(page.getByRole("button", { name: "Interest saved" })).toBeDisabled();
    expect(interest!.subject).toBe("Service interest — 33904");
    expect(interest!.message).toContain("No service_request was created.");
    await page.getByRole("button", { name: "Remove from this request" }).click();
    await expect(page.getByRole("heading", { name: "Some services can’t be requested yet" })).toHaveCount(0);
  });
}

test("an unavailable selected provider falls back only after explicit consent", async ({ page }) => {
  const provider = "00000000-0000-4000-8000-000000000002";
  await submissionDraft(page, { draft: { preferredProviders: { "lawn-mowing": provider }, preferredProviderNames: { "lawn-mowing": "Synthetic Provider" } } });
  const selections: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rpc/submit_service_requests", route => {
    selections.push(route.request().postDataJSON().p_payload.selections[0]);
    return route.fulfill({ json: selections.length === 1 ? refused("preferred_provider_unavailable") : submitted() });
  });
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.getByRole("region", { name: "Please check your answers" })).toContainText("the provider you selected isn’t available");
  expect(selections[0].preferred_contractor_id).toBe(provider);
  await page.getByRole("button", { name: "Match me with another provider" }).click();
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.getByRole("heading", { name: "Request Submitted!" })).toBeVisible();
  expect(selections[1]).not.toHaveProperty("preferred_contractor_id");
});

test("sign-in continuation submits the saved draft once with its original key", async ({ page }) => {
  await submissionDraft(page, { signedIn: false });
  await page.getByRole("button", { name: "Sign In to Submit" }).click();
  await expect(page).toHaveURL(/\/login\?redirect=\/request$/);
  const key = await storedKey(page);
  expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  await syntheticSession(page.context(), "homeowner");
  const keys: string[] = [];
  await page.route("**/rest/v1/rpc/submit_service_requests", route => { keys.push(route.request().postDataJSON().p_submission_key); return route.fulfill({ json: submitted() }); });
  await page.goto("/request");
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.getByRole("heading", { name: "Request Submitted!" })).toBeVisible();
  expect(keys).toEqual([key]);
});

test("a photo failure after save is retried without a duplicate request", async ({ page }) => {
  await submissionDraft(page, { draft: { step: "details" } });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082", "hex");
  await page.locator("#requestPhotos").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Continue to Review" }).click();
  await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
  const keys: string[] = [];
  let uploads = 0, photoRows = 0, photoChecks = 0;
  await page.route("**/rest/v1/rpc/submit_service_requests", route => { keys.push(route.request().postDataJSON().p_submission_key); return route.fulfill({ json: submitted(keys.length > 1) }); });
  await page.route("**/storage/v1/object/job-photos**", route => {
    if (route.request().method() === "DELETE") return route.fulfill({ json: [] });
    uploads += 1;
    return uploads === 1
      ? route.fulfill({ status: 500, json: { statusCode: "500", error: "Synthetic", message: "Synthetic storage failure" } })
      : route.fulfill({ json: { Key: "job-photos/synthetic", Id: "00000000-0000-4000-8000-000000000060" } });
  });
  await page.route("**/rest/v1/job_photos**", route => {
    if (route.request().method() === "HEAD") { photoChecks += 1; return route.fulfill({ status: 200, headers: { "content-range": "*/0" }, body: "" }); }
    photoRows += 1;
    return route.fulfill({ status: 201, body: "" });
  });
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.getByRole("region", { name: "Please check your answers" })).toContainText("Your request was saved, but its photos couldn’t be attached. Submit again to retry the photos — your request won’t be duplicated.");
  expect(photoRows).toBe(0);
  await page.getByRole("button", { name: "Submit Request" }).click();
  await expect(page.getByRole("heading", { name: "Request Submitted!" })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect([uploads, photoChecks, photoRows]).toEqual([2, 1, 1]);
});
