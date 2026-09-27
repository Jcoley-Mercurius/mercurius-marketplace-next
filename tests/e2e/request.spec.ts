import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-095/098: homeowner intake. Synthetic session and scripted Supabase responses only; the
// database contracts are proven by SQL 063–066 and scripts/phase6-request-submission.mjs.
const app = "http://127.0.0.1:3103";
const supabase = "http://127.0.0.1:55831";
const homeownerId = "00000000-0000-4000-8000-000000000001";
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const widths = [320, 375, 390, 768, 1024, 1440];

function futureDate(days: number) {
  // Eastern calendar, as the intake and the command use.
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const completeDraft = {
  step: "contact", selectedIds: ["lawn-mowing"], frequencies: { "lawn-mowing": "one-time" },
  streetAddress: "123 Synthetic Test Lane", city: "Cape Coral", stateCode: "FL", zipCode: "33904",
  preferredDate: futureDate(2), preferredEndDate: futureDate(4),
  firstName: "Test", lastName: "Homeowner", email: "homeowner@example.invalid", phone: "2395550100",
};

type Selection = { service_id: string; frequency: string; preferred_contractor_id?: string; package_id?: string; answers?: Record<string, string>; expected?: { pricing_mode: string; total?: number } };
type Outcome = Record<string, unknown>;
const fixed = (service_id: string, total = 100, extra: Outcome = {}) => ({ service_id, outcome: "eligible_fixed", pricing_mode: "fixed", offering_mode: "fixed", total, from_total: null, depends_on_answers: false, promotion: false, package_id: "00000000-0000-4000-8000-0000000000f1", tier_id: "00000000-0000-4000-8000-0000000000f2", question_details: [], scope: { package_name: "Synthetic package", package_description: "Synthetic scope", tier_name: "Synthetic tier", tier_includes: ["Synthetic edge"] }, ...extra });
const quote = (service_id: string, offering_mode = "custom_quote") => ({ service_id, outcome: "eligible_quote", pricing_mode: "quote", offering_mode, total: null, promotion: false, package_id: null, tier_id: null, question_details: [] });
const unavailable = (service_id: string, reason = "no_eligible_provider") => ({ service_id, outcome: "unavailable", reason });
const requestIdFor = (index: number) => `00000000-0000-4000-8000-0000000005${index}0`;

type Scenario = {
  signedIn?: boolean;
  role?: "homeowner" | "vendor" | "admin";
  draft?: Record<string, unknown>;
  width?: number;
  theme?: string;
  coverage?: "covered" | "uncovered" | "waitlist" | "error";
  /** Coverage that changes during a test; defaults to `coverage`. */
  coverageNow?: () => Scenario["coverage"];
  outcomes?: (selection: Selection, stage: string) => Outcome;
  submit?: (call: { key: string; payload: { selections: Selection[] } }, count: number) => { json?: unknown; status?: number; abort?: boolean };
  readback?: (ids: string[]) => Outcome[];
  matching?: (id: string) => { ok: boolean };
  checkout?: () => { status: number; json: unknown };
  previewFails?: () => boolean;
  readbackFails?: () => boolean;
};

class Recorder {
  previews: { stage: string; selections: Selection[] }[] = [];
  submits: { key: string; payload: { selections: Selection[] } }[] = [];
  matching: string[] = [];
  readbacks = 0;
  interest: Record<string, string>[] = [];
  uploads: string[] = [];
  photoRows: { service_request_id: string; photo_url: string }[] = [];
  removed: string[] = [];
  checkouts = 0;
}

function submittedFor(selections: Selection[], reused = false) {
  return {
    status: "submitted", coverage: "covered", reused,
    outcomes: selections.map((selection, index) => ({ selection_index: index, service_id: selection.service_id, outcome: selection.expected?.pricing_mode === "fixed" ? "eligible_fixed" : "eligible_quote", pricing_mode: selection.expected?.pricing_mode ?? "quote", total: selection.expected?.total ?? null })),
    requests: selections.map((selection, index) => ({
      selection_index: index, request_id: requestIdFor(index), service_id: selection.service_id,
      pricing_mode: selection.expected?.pricing_mode === "fixed" ? "fixed" : "custom_quote", quote_only: selection.expected?.pricing_mode !== "fixed",
      total_amount: selection.expected?.total ?? null, package_id: selection.expected?.pricing_mode === "fixed" ? "00000000-0000-4000-8000-0000000000f1" : null,
      package_tier_id: selection.expected?.pricing_mode === "fixed" ? "00000000-0000-4000-8000-0000000000f2" : null,
    })),
  };
}

async function intake(page: Page, scenario: Scenario = {}) {
  const record = new Recorder();
  const { signedIn = true, role = "homeowner", width = 390, theme = "light" } = scenario;
  const currentCoverage = () => scenario.coverageNow?.() ?? scenario.coverage ?? "covered";
  if (signedIn) await syntheticSession(page.context(), role);
  await page.setViewportSize({ width, height: 900 });
  const saved = new Map<string, Outcome>();
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === app) {
      if (url.pathname === "/api/request-coverage") {
        const coverage = currentCoverage();
        return coverage === "error"
          ? route.fulfill({ status: 503, json: { error: "Synthetic coverage outage." } })
          : route.fulfill({ json: { status: coverage, area: coverage === "covered" ? { id: "a", zip_code: "33904", city: "Cape Coral", state: "FL", is_active: true, has_waitlist: false } : null, checkedZip: "33904" } });
      }
      if (url.pathname === "/api/contact-submissions") { record.interest.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      return url.pathname.startsWith("/api/") ? route.abort() : route.continue();
    }
    if (url.origin !== supabase) return route.abort();
    if (url.pathname.startsWith("/auth/v1/")) return route.continue();
    const path = url.pathname;
    // Catalog: an empty live catalog, so the static references show without live supply.
    if (/\/rest\/v1\/(service_categories|services_catalog|vendor_packages|package_tiers|package_promotions|package_qualifying_questions)$/.test(path)) return route.fulfill({ json: [] });
    if (path === "/rest/v1/rpc/pricing_server_now") return route.fulfill({ json: new Date().toISOString() });
    if (path === "/rest/v1/rpc/preview_service_request_selections") {
      const payload = request.postDataJSON().p_payload as { stage: string; selections: Selection[] };
      record.previews.push({ stage: payload.stage, selections: payload.selections });
      if (scenario.previewFails?.()) return route.fulfill({ status: 500, json: { message: "Synthetic outage" } });
      const coverage = currentCoverage();
      if (coverage !== "covered") return route.fulfill({ json: { stage: payload.stage, coverage, outcomes: [] } });
      const outcomes = payload.selections.map((selection, index) => ({ selection_index: index, ...(scenario.outcomes?.(selection, payload.stage) ?? fixed(selection.service_id)) }));
      return route.fulfill({ json: { stage: payload.stage, coverage: "covered", outcomes } });
    }
    if (path === "/rest/v1/rpc/submit_service_requests") {
      const body = request.postDataJSON() as { p_submission_key: string; p_payload: { selections: Selection[] } };
      const call = { key: body.p_submission_key, payload: body.p_payload };
      record.submits.push(call);
      const scripted = scenario.submit?.(call, record.submits.length);
      if (scripted?.abort) return route.abort("failed");
      if (scripted?.status) return route.fulfill({ status: scripted.status, json: scripted.json });
      const result = (scripted?.json ?? submittedFor(call.payload.selections, saved.has(call.key))) as { requests?: { request_id: string; pricing_mode: string }[] };
      result.requests?.forEach((item) => saved.set(item.request_id, { id: item.request_id, status: "pending", matching_status: "awaiting_match", pricing_mode: item.pricing_mode, total_amount: null, contractor_id: null, payment_status: "pending" }));
      return route.fulfill({ json: result });
    }
    if (path === "/rest/v1/rpc/start_request_matching") {
      const id = request.postDataJSON()._request_id as string;
      record.matching.push(id);
      const ok = scenario.matching?.(id).ok ?? true;
      if (ok && saved.has(id)) saved.set(id, { ...saved.get(id)!, status: "matched", matching_status: "offered" });
      return ok ? route.fulfill({ json: "00000000-0000-4000-8000-0000000000aa" }) : route.fulfill({ status: 500, json: { code: "XX000", message: "Synthetic matching failure" } });
    }
    if (path === "/rest/v1/service_requests") {
      record.readbacks += 1;
      if (scenario.readbackFails?.()) return route.fulfill({ status: 500, json: { message: "Synthetic" } });
      const ids = (url.searchParams.get("id") ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((id) => id.replace(/"/g, ""));
      const rows = scenario.readback?.(ids) ?? ids.flatMap((id) => saved.has(id) ? [saved.get(id)!] : []);
      return route.fulfill({ json: rows });
    }
    if (path.startsWith("/storage/v1/object/list/job-photos")) return route.fulfill({ json: [] });
    if (path.startsWith("/storage/v1/object/job-photos")) {
      if (request.method() === "DELETE") { record.removed.push(...(request.postDataJSON()?.prefixes ?? [])); return route.fulfill({ json: [] }); }
      record.uploads.push(path);
      return route.fulfill({ json: { Key: path, Id: "00000000-0000-4000-8000-000000000060" } });
    }
    if (path === "/rest/v1/job_photos") {
      if (request.method() === "GET") {
        const ids = (url.searchParams.get("service_request_id") ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((id) => id.replace(/"/g, ""));
        return route.fulfill({ json: record.photoRows.filter((row) => ids.includes(row.service_request_id)) });
      }
      const rows = request.postDataJSON() as { service_request_id: string; photo_url: string }[];
      record.photoRows.push(...rows);
      return route.fulfill({ status: 201, body: "" });
    }
    if (path === "/functions/v1/checkout-request") {
      record.checkouts += 1;
      const scripted = scenario.checkout?.() ?? { status: 409, json: { error: "synthetic_unavailable", message: "Synthetic checkout is unavailable." } };
      return route.fulfill(scripted);
    }
    return route.abort();
  });
  await page.addInitScript(({ draft, theme }) => {
    localStorage.setItem("theme", theme);
    // Seed once so a navigation (such as the sign-in round trip) keeps the stored draft.
    if (draft && !sessionStorage.getItem("synthetic-seeded")) {
      sessionStorage.setItem("nextRequestFlowState", JSON.stringify(draft));
      sessionStorage.setItem("synthetic-seeded", "1");
    }
  }, { draft: scenario.draft === undefined ? completeDraft : scenario.draft ? { ...completeDraft, ...scenario.draft } : null, theme });
  await page.goto("/request");
  return record;
}

const summary = (page: Page) => page.getByRole("region", { name: "Please check your answers" });
const submitButton = (page: Page) => page.getByRole("button", { name: /^(Request service|Sign in to request service|Check and finish submitting)$/ });
const storedDraft = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("nextRequestFlowState") ?? "{}"));

async function expectAccessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.locator("main, main form, main section").evaluateAll((elements) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.outerHTML.slice(0, 160)))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe("steps, errors and focus", () => {
  test("errors persist, link to fields, and step changes move focus", async ({ page }) => {
    await intake(page, { draft: { step: "details", streetAddress: "", zipCode: "" } });
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(summary(page)).toBeFocused();
    await expect(summary(page).getByRole("link")).toHaveCount(2);
    await summary(page).getByRole("link", { name: "Enter the service street address." }).click();
    const street = page.getByLabel("Street address (required)", { exact: true });
    await expect(street).toBeFocused();
    await expect(street).toHaveAttribute("aria-invalid", "true");
    await expect(street).toHaveAccessibleDescription("Enter the service street address.");
    await street.fill("123 Synthetic Test Lane");
    await page.getByLabel("ZIP code (required)").fill("33904");
    await expect(page.getByText("This ZIP code is in our service area")).toBeVisible();
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Request progress" }).getByRole("status")).toHaveText("Step 3 of 3: Review");
    await page.getByLabel("Email (required)", { exact: true }).fill("invalid-email");
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await expect(summary(page).getByRole("link")).toHaveText(["Enter a valid email address."]);
    await expect(page.getByRole("navigation", { name: "Request progress" }).getByRole("status")).toHaveText("Step 3 of 3: Review (needs attention)");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator("#request-step")).toBeFocused();
    await expect(street).toHaveValue("123 Synthetic Test Lane");
  });

  test("Enter on an address field validates only the details step", async ({ page }) => {
    await intake(page, { draft: { step: "details", streetAddress: "" } });
    await page.getByLabel("Street address (required)").press("Enter");
    await expect(summary(page)).toBeFocused();
    await expect(page.getByRole("link", { name: "Enter the service street address." })).toBeVisible();
    await expect(page.getByLabel("First name (required)")).toHaveCount(0);
  });

  test("keyboard reaches the photo picker and the error summary", async ({ page }) => {
    await intake(page, { draft: { step: "details" } });
    const picker = page.locator("#requestPhotos");
    await page.keyboard.press("Shift");
    await picker.focus();
    await expect(picker).toBeFocused();
    await expect(page.locator("label[for=requestPhotos]")).toHaveCSS("outline-style", "solid");
    await page.getByLabel("Street address (required)").fill("");
    await page.getByLabel("Street address (required)").press("Enter");
    await page.keyboard.press("Tab");
    await expect(summary(page).getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Street address (required)")).toBeFocused();
  });
});

test.describe("coverage and early availability (I1, I2)", () => {
  test("covered ZIP shows per-service fixed, quote, unavailable and Something Else before submission", async ({ page }) => {
    const record = await intake(page, {
      draft: { step: "details", selectedIds: ["lawn-mowing", "house-cleaning", "pool-service", "general-home-service"], frequencies: { "lawn-mowing": "one-time", "house-cleaning": "monthly", "pool-service": "weekly", "general-home-service": "one-time" }, otherServiceDetails: "Synthetic gutter guard" },
      outcomes: (selection) => selection.service_id === "lawn-mowing" ? fixed("lawn-mowing", 100)
        : selection.service_id === "house-cleaning" ? quote("house-cleaning", "deposit_quote")
        : selection.service_id === "general-home-service" ? unavailable("general-home-service", "service_not_offered")
        : unavailable("pool-service"),
    });
    const list = page.getByRole("region", { name: "Availability at this address" });
    await expect(list.locator("#availability-lawn-mowing")).toContainText("$100.00");
    await expect(list.locator("#availability-house-cleaning")).toContainText("Quote required");
    await expect(list.locator("#availability-house-cleaning")).toContainText("any deposit, is set only when you accept it");
    await expect(list.locator("#availability-pool-service")).toContainText("Not available yet in your area.");
    await expect(list.locator("#availability-general-home-service")).toContainText("it won’t create a request or a quote");
    expect(record.previews[0].stage).toBe("availability");
    expect(record.previews[0].selections.map((selection) => selection.service_id)).toEqual(["lawn-mowing", "house-cleaning", "pool-service", "general-home-service"]);
    expect(record.submits).toHaveLength(0);
    await list.getByRole("button", { name: "Remove Pool Service" }).click();
    await expect(list.locator("#availability-pool-service")).toHaveCount(0);
  });

  test("mixed plan: nothing submits until unavailable services are removed, then one request per selection", async ({ page }) => {
    const record = await intake(page, {
      draft: { selectedIds: ["lawn-mowing", "pool-service"], frequencies: { "lawn-mowing": "one-time", "pool-service": "weekly" } },
      outcomes: (selection) => selection.service_id === "pool-service" ? unavailable("pool-service") : fixed("lawn-mowing"),
    });
    await expect(page.getByRole("region", { name: "Availability at this address" }).locator("#availability-pool-service")).toContainText("Not available yet in your area.");
    await expect(submitButton(page)).toBeDisabled();
    await expect(page.getByText("Resolve each service above to submit.")).toBeVisible();
    await page.getByRole("button", { name: "Notify me when available" }).click();
    await expect(page.getByRole("button", { name: "Interest saved" })).toBeDisabled();
    expect(record.interest[0].message).toContain("No service_request was created.");
    expect(record.submits).toHaveLength(0);
    await page.getByRole("button", { name: "Remove Pool Service" }).click();
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeFocused();
    expect(record.submits).toHaveLength(1);
    expect(record.submits[0].payload.selections.map((selection) => selection.service_id)).toEqual(["lawn-mowing"]);
    expect(record.submits[0].payload.selections[0].expected).toEqual({ pricing_mode: "fixed", total: 100 });
  });

  test("every service unavailable: interest only, no submission", async ({ page }) => {
    const record = await intake(page, { outcomes: () => unavailable("lawn-mowing") });
    await page.getByRole("button", { name: "Notify me when available" }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Interest recorded" })).toBeFocused();
    await expect(page.getByText("No service request, provider assignment, photo upload, booking or payment.")).toBeVisible();
    expect(record.submits).toHaveLength(0);
  });

  for (const coverage of ["uncovered", "waitlist"] as const) {
    test(`${coverage} ZIP records interest only`, async ({ page }) => {
      const record = await intake(page, { coverage });
      await page.getByRole("button", { name: coverage === "waitlist" ? "Join the service-area list" : "Notify me when coverage expands" }).click();
      await expect(page.getByRole("heading", { name: coverage === "waitlist" ? "You’re on the service-area list" : "Coverage interest received" })).toBeFocused();
      expect(record.submits).toHaveLength(0);
      expect(record.uploads).toHaveLength(0);
      expect(record.interest).toHaveLength(1);
    });
  }

  test("coverage lookup failure is an error with retry, never interest or a quote", async ({ page }) => {
    const record = await intake(page, { coverage: "error" });
    await expect(page.getByText("We couldn’t check coverage")).toBeVisible();
    await page.getByRole("button", { name: "Check coverage again", exact: true }).first().click();
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await expect(summary(page)).toContainText("We couldn’t verify coverage for this ZIP code, so nothing was sent.");
    expect(record.interest).toHaveLength(0);
    expect(record.submits).toHaveLength(0);
    expect(record.previews).toHaveLength(0);
  });

  test("an availability lookup failure blocks submission and can be retried", async ({ page }) => {
    let fail = true;
    const record = await intake(page, { previewFails: () => fail });
    await expect(page.getByText("Couldn’t check availability")).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();
    fail = false;
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.locator("#availability-lawn-mowing")).toContainText("$100.00");
    await expect(submitButton(page)).toBeEnabled();
    expect(record.submits).toHaveLength(0);
  });
});

test.describe("provider consent, answers and current terms (I2, I6)", () => {
  test("an ineligible preferred provider falls back only after explicit consent", async ({ page }) => {
    const provider = "00000000-0000-4000-8000-000000000002";
    const record = await intake(page, {
      draft: { preferredProviders: { "lawn-mowing": provider }, preferredProviderNames: { "lawn-mowing": "Synthetic Provider" }, packageSelections: { "lawn-mowing": { packageId: "00000000-0000-4000-8000-0000000000e1", pricingMode: "fixed" } } },
      outcomes: (selection) => selection.preferred_contractor_id ? { service_id: selection.service_id, outcome: "preferred_provider_unavailable" } : fixed(selection.service_id, 120),
    });
    const row = page.locator("#availability-lawn-mowing");
    await expect(row).toContainText("Your preferred provider isn’t available here");
    await expect(row).toContainText("Preferred provider: Synthetic Provider");
    await expect(submitButton(page)).toBeDisabled();
    await row.getByRole("button", { name: "Use any eligible provider" }).click();
    await expect(row).toContainText("$120.00");
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    const sent = record.submits[0].payload.selections[0];
    expect(sent).not.toHaveProperty("preferred_contractor_id");
    expect(sent).not.toHaveProperty("package_id");
    expect(sent.expected).toEqual({ pricing_mode: "fixed", total: 120 });
  });

  test("answer-priced services ask the address's questions and show the answered price", async ({ page }) => {
    const question = { question_key: "sqft", question_label: "Hedge length", input_type: "number", unit: "feet", options: null, is_required: true, sort_order: 0 };
    const record = await intake(page, {
      draft: { step: "details", selectedIds: ["shrub-hedge-trimming"], frequencies: { "shrub-hedge-trimming": "one-time" } },
      outcomes: (selection, stage) => stage === "availability"
        ? fixed(selection.service_id, 0, { total: null, from_total: 80, depends_on_answers: true, question_details: [question] })
        : selection.answers?.sqft ? fixed(selection.service_id, Number(selection.answers.sqft) > 1000 ? 120 : 80, { question_details: [question] })
        : { service_id: selection.service_id, outcome: "answers_required", questions: ["sqft"], question_details: [question] },
    });
    await expect(page.locator("#availability-shrub-hedge-trimming")).toContainText("From $80.00");
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(summary(page).getByRole("link")).toHaveText(["Shrub & Hedge Trimming: answer “Hedge length”."]);
    await page.getByLabel("Hedge length (required)").fill("3000");
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
    await expect(page.locator("#availability-shrub-hedge-trimming")).toContainText("$120.00");
    expect(record.previews.at(-1)).toMatchObject({ stage: "final", selections: [{ answers: { sqft: "3000" } }] });
  });

  test("a price change at submission is re-shown and needs an explicit resubmit", async ({ page }) => {
    let price = 100;
    const record = await intake(page, {
      outcomes: (selection) => fixed(selection.service_id, price),
      submit: (_call, count) => count === 1
        ? { json: { status: "refused", coverage: "covered", reused: false, requests: [], outcomes: [{ selection_index: 0, service_id: "lawn-mowing", outcome: "price_changed", pricing_mode: "fixed", total: 130 }] } }
        : {},
    });
    await expect(page.locator("#availability-lawn-mowing")).toContainText("$100.00");
    price = 130;
    await submitButton(page).click();
    await expect(summary(page)).toContainText("the current price for this address is $130.00. Review it, then submit again. Nothing was submitted.");
    await expect(page.locator("#availability-lawn-mowing")).toContainText("$130.00");
    expect(record.submits).toHaveLength(1);
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits[1].payload.selections[0].expected).toEqual({ pricing_mode: "fixed", total: 130 });
  });

  test("a promoted price fails safe: never shown, never submitted", async ({ page }) => {
    const record = await intake(page, { outcomes: (selection) => fixed(selection.service_id, 50, { promotion: true }) });
    const row = page.locator("#availability-lawn-mowing");
    await expect(row).toContainText("Online pricing unavailable");
    await expect(row).not.toContainText("$50");
    await expect(page.locator("main")).not.toContainText(/promo|was \$|% off/i);
    await expect(submitButton(page)).toBeDisabled();
    expect(record.submits).toHaveLength(0);
  });
});

test.describe("authentication and retry (I3, I4)", () => {
  test("anonymous visitors can't submit; sign-in continuation keeps the draft and key and never auto-submits", async ({ page }) => {
    const record = await intake(page, { signedIn: false });
    await page.getByRole("button", { name: "Sign in to request service" }).click();
    await expect(page).toHaveURL(/\/login\?redirect=\/request$/);
    await expect(page.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/register?redirect=%2Frequest");
    const key = (await storedDraft(page)).submissionKey as string;
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(record.submits).toHaveLength(0);
    await syntheticSession(page.context(), "homeowner");
    await page.goto("/request");
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeVisible();
    await expect(page.getByLabel("Street address (required)")).toHaveCount(0);
    expect(record.submits).toHaveLength(0);
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits.map((call) => call.key)).toEqual([key]);
    expect((await storedDraft(page)).ownerId).toBe(homeownerId);
  });

  test("sign-up keeps the request continuation", async ({ page }) => {
    await intake(page, { signedIn: false, draft: null });
    await page.goto("/register?redirect=/request");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?redirect=%2Frequest");
    await page.goto("/register?redirect=https://evil.example");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("double submission sends one request", async ({ page }) => {
    const record = await intake(page, { submit: () => ({}) });
    await page.route("**/rest/v1/rpc/submit_service_requests", async (route) => { await new Promise((resolve) => setTimeout(resolve, 400)); return route.fallback(); });
    await expect(submitButton(page)).toBeEnabled();
    await submitButton(page).dblclick();
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits).toHaveLength(1);
  });

  test("a lost response is resolved by resending the exact payload and key; remount shows the saved result", async ({ page }) => {
    const record = await intake(page, { submit: (_call, count) => count === 1 ? { abort: true } : {} });
    await submitButton(page).click();
    await expect(summary(page)).toContainText("We couldn’t confirm whether your request was saved.");
    await expect(page.getByRole("button", { name: "Check and finish submitting" })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check and finish submitting" })).toBeEnabled();
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits).toHaveLength(2);
    expect(record.submits[1].key).toBe(record.submits[0].key);
    expect(record.submits[1].payload).toEqual(record.submits[0].payload);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits).toHaveLength(2);
    await page.getByRole("button", { name: "Start a new request" }).click();
    await expect(page.getByRole("heading", { name: "What does your home need?" })).toBeVisible();
    expect((await storedDraft(page)).submissionKey).not.toBe(record.submits[0].key);
  });

  // P6-R3: the unknown attempt is resolved with its persisted key and payload before any
  // fresh coverage, preview or form validation, and never turns into coverage interest.
  test("a lost response is resolved even when coverage can no longer be checked", async ({ page }) => {
    let coverage: Scenario["coverage"] = "covered";
    const record = await intake(page, { coverageNow: () => coverage, submit: (_call, count) => count === 1 ? { abort: true } : {} });
    await submitButton(page).click();
    await expect(summary(page)).toContainText("We couldn’t confirm whether your request was saved.");
    coverage = "error";
    await page.reload();
    await expect(page.getByRole("button", { name: "Check and finish submitting" })).toBeEnabled();
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits).toHaveLength(2);
    expect(record.submits[1].key).toBe(record.submits[0].key);
    expect(record.submits[1].payload).toEqual(record.submits[0].payload);
    expect(record.interest).toHaveLength(0);
    await expect(page.locator("main")).not.toContainText(/nothing was sent/i);
  });

  test("a lost response is resolved with the original payload after the ZIP becomes uncovered and fields are edited", async ({ page }) => {
    let coverage: Scenario["coverage"] = "covered";
    const record = await intake(page, { coverageNow: () => coverage, submit: (_call, count) => count === 1 ? { abort: true } : {} });
    await submitButton(page).click();
    await expect(summary(page)).toContainText("We couldn’t confirm whether your request was saved.");
    coverage = "uncovered";
    await page.evaluate(() => {
      const draft = JSON.parse(sessionStorage.getItem("nextRequestFlowState") ?? "{}");
      sessionStorage.setItem("nextRequestFlowState", JSON.stringify({ ...draft, zipCode: "33999", streetAddress: "9 Edited Synthetic Way", firstName: "", email: "" }));
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Check and finish submitting" })).toBeEnabled();
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits).toHaveLength(2);
    expect(record.submits[1].key).toBe(record.submits[0].key);
    expect(record.submits[1].payload).toEqual(record.submits[0].payload);
    expect(JSON.stringify(record.submits[1].payload)).not.toContain("33999");
    expect(record.interest).toHaveLength(0);
  });

  test("a key conflict requires checking before an explicit new submission", async ({ page }) => {
    let savedKey = "";
    // The first key already belongs to a request saved with different details.
    const record = await intake(page, { submit: (call, count) => (count === 1 && (savedKey = call.key)) || call.key === savedKey ? { status: 400, json: { code: "22023", message: "Submission key reused with a different request" } } : {} });
    await submitButton(page).click();
    await expect(summary(page)).toContainText("already saved with different details");
    await expect(page.getByRole("link", { name: "View your requests" })).toHaveAttribute("href", "/dashboard");
    // Retrying normally keeps the key and is refused again; nothing new is created silently.
    await submitButton(page).click();
    await expect(summary(page)).toContainText("already saved with different details");
    expect(record.submits).toHaveLength(2);
    expect(record.submits[1].key).toBe(record.submits[0].key);
    await page.getByRole("button", { name: "Submit as a new request" }).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    expect(record.submits[2].key).not.toBe(record.submits[0].key);
  });

  test("another account in the same tab never sees or reuses the draft or saved result", async ({ page }) => {
    const record = await intake(page);
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
    await page.context().clearCookies();
    await syntheticSession(page.context(), "admin");
    await page.goto("/request");
    await expect(page.getByText("A request started by another account was cleared from this browser.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What does your home need?" })).toBeVisible();
    const draft = await storedDraft(page);
    expect(draft.saved).toBeNull();
    expect(draft.streetAddress).toBe("");
    expect(draft.submissionKey).not.toBe(record.submits[0].key);
  });

  test("a signed-out visitor can't see a signed-in account's draft", async ({ page }) => {
    await intake(page, { draft: { ownerId: homeownerId }, signedIn: false });
    await expect(page.getByRole("heading", { name: "Sign in to continue this request" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("123 Synthetic Test Lane");
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("heading", { name: "What does your home need?" })).toBeVisible();
  });

  test("an identity without the homeowner role is refused without losing the draft", async ({ page }) => {
    const record = await intake(page, { role: "vendor", submit: () => ({ status: 403, json: { code: "42501", message: "Homeowner authorization required" } }) });
    await submitButton(page).click();
    await expect(summary(page)).toContainText("This account can’t request homeowner services.");
    expect(record.submits).toHaveLength(1);
    expect((await storedDraft(page)).streetAddress).toBe("123 Synthetic Test Lane");
  });

  test("malformed, stale and unavailable storage never fail silently", async ({ page }) => {
    await page.addInitScript(() => { if (!sessionStorage.getItem("malformed-seeded")) { sessionStorage.setItem("nextRequestFlowState", "{not json"); sessionStorage.setItem("malformed-seeded", "1"); } });
    await intake(page, { draft: null });
    await expect(page.getByText("We couldn’t restore your earlier request details, so this is a fresh start.")).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem("nextRequestFlowState", JSON.stringify({ step: "details", selectedIds: ["lawn-mowing"], preferredDate: "2020-01-01", preferredEndDate: "2020-01-02" })));
    await page.reload();
    await expect(page.getByText("Your earlier preferred dates have passed, so we suggested new ones.")).toBeVisible();
    await expect(page.getByLabel("Window starts (required)")).not.toHaveValue("2020-01-01");
  });

  test("storage failure is announced", async ({ page }) => {
    await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("quota"); }; });
    await intake(page, { draft: null });
    await expect(page.getByText("This browser isn’t saving your progress").first()).toBeVisible();
  });
});

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082", "hex");

test.describe("photos (I5)", () => {
  test("select, validate and remove photos with inline errors", async ({ page }) => {
    await intake(page, { draft: { step: "details" } });
    await page.locator("#requestPhotos").setInputFiles([
      { name: "synthetic.png", mimeType: "image/png", buffer: png },
      { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") },
      { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(8 * 1024 * 1024 + 1) },
    ]);
    await expect(page.getByRole("alert").filter({ hasText: "notes.pdf" })).toContainText("notes.pdf: choose a JPG, PNG, or WebP image.");
    await expect(page.getByText("huge.png: images must be 8 MB or smaller.")).toBeVisible();
    await expect(page.getByText("1 of 6 photos selected.")).toBeVisible();
    await page.locator("#requestPhotos").setInputFiles(Array.from({ length: 6 }, (_, index) => ({ name: `p${index}.png`, mimeType: "image/png", buffer: png })));
    await expect(page.getByText("You can attach up to 6 photos, so 1 wasn’t added.")).toBeVisible();
    await expect(page.getByText("6 of 6 photos selected.")).toBeVisible();
    await expect(page.locator("#requestPhotos")).toBeDisabled();
    await page.getByRole("button", { name: "Remove photo 1, synthetic.png" }).click();
    await expect(page.getByText("5 of 6 photos selected.")).toBeVisible();
  });

  test("signed-out visitors are told before leaving that photos must be chosen again", async ({ page }) => {
    await intake(page, { signedIn: false, draft: { step: "details" } });
    await page.locator("#requestPhotos").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("You’ll need to choose these photos again after signing in.")).toBeVisible();
  });

  test("photos link once to every request in the plan after an upload failure, and never upload for interest", async ({ page }) => {
    const record = await intake(page, {
      draft: { step: "details", selectedIds: ["lawn-mowing", "house-cleaning"], frequencies: { "lawn-mowing": "one-time", "house-cleaning": "monthly" } },
      outcomes: (selection) => selection.service_id === "house-cleaning" ? quote("house-cleaning") : fixed("lawn-mowing"),
    });
    await page.locator("#requestPhotos").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
    let failUpload = true;
    await page.route("**/storage/v1/object/job-photos/**", (route) => route.request().method() === "POST" && failUpload
      ? route.fulfill({ status: 500, json: { statusCode: "500", error: "Synthetic", message: "Synthetic storage failure" } })
      : route.fallback());
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your 2 requests are saved" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Photos not attached yet" })).toBeVisible();
    await expect(page.getByText("synthetic.png didn’t upload. Your request is saved either way.")).toBeVisible();
    expect(record.submits).toHaveLength(1);
    expect(record.photoRows).toHaveLength(0);
    failUpload = false;
    await page.getByRole("button", { name: "Try attaching photos again" }).click();
    await expect(page.getByRole("heading", { name: "Photos not attached yet" })).toHaveCount(0);
    expect(record.submits).toHaveLength(1);
    expect(record.photoRows.map((row) => row.service_request_id).sort()).toEqual([requestIdFor(0), requestIdFor(1)].sort());
    expect(new Set(record.photoRows.map((row) => row.photo_url)).size).toBe(1);
    expect(record.photoRows[0].photo_url).toMatch(new RegExp(`^${homeownerId}/${requestIdFor(0)}/intake-`));
  });

  test("after a reload, pending photos can be chosen again or discarded", async ({ page }) => {
    const record = await intake(page, { draft: { step: "details" } });
    await page.locator("#requestPhotos").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Continue to review" }).click();
    await page.route("**/storage/v1/object/job-photos/**", (route) => route.request().method() === "POST" ? route.fulfill({ status: 500, json: { statusCode: "500", message: "Synthetic" } }) : route.fallback());
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Photos not attached yet" })).toBeVisible();
    await page.reload();
    await expect(page.getByText("This page was reloaded, so the photos you chose are no longer selected.")).toBeVisible();
    await page.getByRole("button", { name: "Continue without photos" }).click();
    await expect(page.getByRole("heading", { name: "Photos not attached yet" })).toHaveCount(0);
    expect(record.submits).toHaveLength(1);
    expect(record.photoRows).toHaveLength(0);
  });
});

test.describe("honest confirmation (I6)", () => {
  test("fixed request awaiting operations: no matching claim, no provider, payment state named", async ({ page }) => {
    const record = await intake(page, { draft: { preferredProviders: { "lawn-mowing": "00000000-0000-4000-8000-000000000002" }, preferredProviderNames: { "lawn-mowing": "Synthetic Provider" } } });
    await submitButton(page).click();
    const card = page.getByRole("list", { name: "Saved requests" }).getByRole("listitem");
    await expect(card).toContainText("Submitted");
    await expect(card).toContainText("Received. Mercurius confirms a provider for fixed-price requests; none is assigned yet.");
    await expect(card).toContainText("Preferred provider: Synthetic Provider. This is a preference, not an assignment.");
    await expect(page.locator("main")).not.toContainText(/Matching in progress|Request Submitted!/);
    // The scripted checkout function is unavailable: the error is named, not “no payment”.
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic checkout is unavailable." })).toContainText("Your request is still saved.");
    await expect(card).toContainText("Payment didn’t start from this page. Check this request in your dashboard before paying.");
    await expect(page.locator("main")).not.toContainText(/no payment was collected/i);
    expect(record.matching).toHaveLength(0);
    expect(record.checkouts).toBe(1);
  });

  test("quote offered, quote matching failure with retry, and exhausted supply", async ({ page }) => {
    const state: Record<string, string> = {};
    const record = await intake(page, {
      draft: { selectedIds: ["house-cleaning", "pool-service", "handyman"], frequencies: { "house-cleaning": "monthly", "pool-service": "weekly", handyman: "one-time" } },
      outcomes: (selection) => quote(selection.service_id),
      matching: (id) => ({ ok: id !== requestIdFor(1) || state.retried === "yes" }),
      readback: (ids) => ids.map((id, index) => ({ id, status: index === 0 ? "matched" : "pending", pricing_mode: "custom_quote", total_amount: null, contractor_id: null, payment_status: "pending",
        matching_status: index === 0 ? "offered" : index === 2 ? "exhausted" : state.retried === "yes" ? "offered" : "awaiting_match" })),
    });
    await submitButton(page).click();
    const cards = page.getByRole("list", { name: "Saved requests" }).getByRole("listitem");
    await expect(cards.nth(0)).toContainText("Offered to an eligible provider for a quote. No provider has accepted yet.");
    await expect(cards.nth(1)).toContainText("Saved, but we couldn’t start finding a provider.");
    await expect(cards.nth(2)).toContainText("Not available yet in your area");
    await expect(cards.nth(2)).toContainText("nothing is scheduled");
    await expect(cards.nth(0)).toContainText("Quote required. No amount is set yet and nothing has been charged.");
    state.retried = "yes";
    await cards.nth(1).getByRole("button", { name: "Try finding a provider again" }).click();
    await expect(cards.nth(1)).toContainText("Offered to an eligible provider for a quote.");
    expect(record.matching.filter((id) => id === requestIdFor(1))).toHaveLength(2);
  });

  test("multi-service plan with a fixed price is saved without payment and says why", async ({ page }) => {
    const record = await intake(page, {
      draft: { selectedIds: ["lawn-mowing", "house-cleaning"], frequencies: { "lawn-mowing": "one-time", "house-cleaning": "monthly" } },
      outcomes: (selection) => selection.service_id === "house-cleaning" ? quote("house-cleaning") : fixed("lawn-mowing"),
    });
    await expect(page.getByText("Quote services are priced only when you accept a quote")).toBeVisible();
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your 2 requests are saved" })).toBeVisible();
    await expect(page.getByText("Online payment isn’t available for a plan with more than one service, so payment wasn’t requested.")).toBeVisible();
    expect(record.checkouts).toBe(0);
    expect(record.matching).toEqual([requestIdFor(1)]);
  });

  // P6-R2: a reload after later activity shows the database's current state, gates checkout
  // and matching, and never repeats submission-time payment claims.
  test("a reload shows the current lifecycle and payment instead of the initial acceptance", async ({ page }) => {
    let current: Outcome = {};
    const record = await intake(page, {
      readback: (ids) => ids.map((id) => ({ id, status: "pending", matching_status: "awaiting_match", pricing_mode: "fixed", total_amount: 100, contractor_id: null, payment_status: "pending", quote_status: null, quote_amount: null, ...current })),
    });
    await submitButton(page).click();
    const card = page.getByRole("list", { name: "Saved requests" }).getByRole("listitem");
    await expect(page.getByRole("button", { name: "Continue to secure checkout" })).toBeVisible();
    const checkouts = record.checkouts;
    const assigned = { matching_status: "matched", contractor_id: "00000000-0000-4000-8000-000000000002" };
    for (const [state, label, summaryText, paymentText] of [
      [{ ...assigned, status: "scheduled", payment_status: "captured" }, "Scheduled", "A time is scheduled.", "Payment confirmed."],
      [{ ...assigned, status: "in_progress", payment_status: "captured" }, "In progress", "Work is in progress.", "Payment confirmed."],
      [{ ...assigned, status: "homeowner_confirmed", payment_status: "released" }, "Completed", "This request is complete.", "Payment confirmed."],
      [{ ...assigned, status: "cancelled", payment_status: "refunded" }, "Cancelled", "This request was cancelled.", "Payment refunded."],
      [{ ...assigned, status: "scheduled", payment_status: "pending" }, "Scheduled", "A time is scheduled.", "Submitted at $100.00 fixed price. See your dashboard for the current price and payment status."],
    ] as const) {
      current = state;
      await page.reload();
      await expect(card).toContainText(summaryText);
      await expect(card).toContainText(label);
      await expect(card).toContainText(paymentText);
      await expect(card).not.toContainText("A provider accepted this request.");
      await expect(page.getByRole("button", { name: "Continue to secure checkout" })).toHaveCount(0);
    }
    expect(record.checkouts).toBe(checkouts);
    expect(record.matching).toHaveLength(0);
  });

  test("a reload after an accepted quote shows it and doesn't claim nothing was charged", async ({ page }) => {
    let current: Outcome = {};
    const record = await intake(page, {
      outcomes: (selection) => quote(selection.service_id),
      readback: (ids) => ids.map((id) => ({ id, status: "pending", matching_status: "awaiting_match", pricing_mode: "custom_quote", total_amount: null, contractor_id: null, payment_status: "pending", quote_status: null, quote_amount: null, ...current })),
    });
    await submitButton(page).click();
    const card = page.getByRole("list", { name: "Saved requests" }).getByRole("listitem");
    await expect(card).toContainText("nothing has been charged");
    expect(record.matching).toHaveLength(1);
    current = { status: "matched", matching_status: "matched", contractor_id: "00000000-0000-4000-8000-000000000002", quote_status: "accepted", quote_amount: 240 };
    await page.reload();
    await expect(card).toContainText("You accepted a quote. Nothing is scheduled until a time is confirmed with you.");
    await expect(card).toContainText("Accepted quote: $240.00.");
    await expect(card).not.toContainText(/nothing has been charged|no amount is set/i);
    await expect(card.getByRole("button", { name: "Try finding a provider again" })).toHaveCount(0);
    expect(record.matching).toHaveLength(1);
    expect(record.checkouts).toBe(0);
  });

  test("a status read-back failure is reported with a retry", async ({ page }) => {
    let fail = true;
    await intake(page, { readbackFails: () => fail });
    await submitButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t load the latest status." })).toBeVisible();
    await expect(page.getByText("Saved. We couldn’t load its current status")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t load the latest status." })).toHaveCount(0);
  });
});

test.describe("accessibility matrix (I7)", () => {
  for (const theme of ["light", "dark"]) {
    for (const width of widths) {
      for (const step of ["services", "details", "contact"] as const) {
        test(`${step} ${theme} ${width}px: axe and reflow`, async ({ page }) => {
          await intake(page, { draft: { step }, width, theme });
          await expect(page.locator("#request-step")).toBeVisible();
          if (step !== "services") await expect(page.locator("#availability-lawn-mowing")).toContainText("$100.00");
          await expectAccessible(page);
        });
      }
    }
    test(`confirmation ${theme}: axe and reflow at 320px`, async ({ page }) => {
      await intake(page, { width: 320, theme });
      await submitButton(page).click();
      await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
      await expectAccessible(page);
    });
    test(`refusal ${theme}: errors focus and pass axe at 320px`, async ({ page }) => {
      await intake(page, { width: 320, theme, submit: () => ({ json: { status: "refused", coverage: "covered", reused: false, requests: [], outcomes: [{ selection_index: 0, service_id: "lawn-mowing", outcome: "unavailable" }] } }) });
      await submitButton(page).click();
      await expect(summary(page)).toBeFocused();
      await summary(page).getByRole("link").first().click();
      await expect(page.locator("#availability-lawn-mowing")).toBeFocused();
      await expectAccessible(page);
    });
  }

  test("200% zoom (1280px window) keeps the review usable without horizontal scrolling", async ({ page }) => {
    // A 1280px window at 200% zoom lays out at 640 CSS pixels.
    await intake(page, { width: 640 });
    await expect(page.locator("#availability-lawn-mowing")).toContainText("$100.00");
    await expectAccessible(page);
    await submitButton(page).click();
    await expect(page.getByRole("heading", { name: "Your request is saved" })).toBeVisible();
  });

  test("reduced motion: step changes don't animate scrolling", async ({ page }) => {
    // playwright.config's use.reducedMotion is not applied in this setup (matchMedia reports
    // false), so emulate the preference explicitly for this check.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await intake(page, { draft: { step: "details" } });
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { scrollCalls: string[] }).scrollCalls = seen;
      const original = window.scrollTo.bind(window);
      window.scrollTo = ((options: ScrollToOptions) => { seen.push(String(options?.behavior)); original(options); }) as typeof window.scrollTo;
    });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What does your home need?" })).toBeFocused();
    const calls = await page.evaluate(() => (window as unknown as { scrollCalls: string[] }).scrollCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).not.toContain("smooth");
  });
});

test.describe("visual baselines @visual", () => {
  for (const theme of ["light", "dark"]) {
    test(`review ${theme} 390px @visual`, async ({ page }) => {
      await intake(page, { theme, draft: { preferredDate: "2099-01-05", preferredEndDate: "2099-01-08" } });
      await expect(page.locator("#availability-lawn-mowing")).toContainText("$100.00");
      await expect(page.locator("main")).toHaveScreenshot(`request-review-${theme}-390.png`, { maxDiffPixelRatio: 0.01 });
    });
    test(`confirmation ${theme} 390px @visual`, async ({ page }) => {
      await intake(page, { theme, draft: { preferredDate: "2099-01-05", preferredEndDate: "2099-01-08" } });
      await submitButton(page).click();
      await expect(page.getByText("Synthetic checkout is unavailable.")).toBeVisible();
      await expect(page.locator("main")).toHaveScreenshot(`request-confirmation-${theme}-390.png`, { maxDiffPixelRatio: 0.01 });
    });
  }
});
