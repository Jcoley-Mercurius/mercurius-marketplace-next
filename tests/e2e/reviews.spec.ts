// TRACE-130 (Phase 6.8): the homeowner's review of one completed service — submission, success,
// not-eligible, error/recovery and permission states, correction with a stale refusal, appeal —
// and the operations decision flow with a required criterion. Synthetic fixture only; outcomes come
// from stubbed read-backs, and the real commands are proven by SQL 100 and scripts/review-concurrency.mjs.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

type Row = Record<string, unknown>;
const reviewJob = "00000000-0000-4000-8000-000000000014";
const reviewId = "00000000-0000-4000-8000-000000000140";
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
const at = "2026-11-03T15:00:00Z";

const ownReview = (overrides: Row = {}): Row => ({ id: reviewId, rating: 4, comment: "Synthetic review text", created_at: at, edited_at: null,
  revision: 0, state: "published", public: true, criterion: null, criterion_label: null, moderation_version: 0, can_edit: true, can_appeal: false, ...overrides });
const readback = (review: Row | null, history: Row[] = [], eligibility = review ? "submitted" : "eligible"): Row =>
  ({ role: "homeowner", job_id: reviewJob, eligibility, requested: true, review, history });

async function setup(page: Page, role: "admin" | "homeowner", { theme = "light", width = 1440 } = {}) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 1000 });
  await syntheticSession(page.context(), role);
}

async function openReview(page: Page) {
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Review Service details" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Review Service" });
  return { dialog, panel: dialog.getByRole("region", { name: /How did the service go\?|Your review/ }) };
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`homeowner ${theme} ${width}px: submit a review, see it saved and public`, async ({ page }) => {
    await setup(page, "homeowner", { theme, width });
    let saved: Row | null = null;
    await page.route("**/rest/v1/rpc/service_review", route => route.fulfill({ json: readback(saved) }));
    await page.route("**/rest/v1/rpc/submit_job_review", route => {
      saved = ownReview({ rating: 2, comment: "Late but tidy" });
      return route.fulfill({ json: [{ review_id: reviewId, visibility: "eligible_for_google" }] });
    });
    const { panel } = await openReview(page);
    await expect(panel).toContainText("never for a low rating alone");
    // Submitting without a rating names the problem and takes focus; nothing is sent.
    await panel.getByRole("button", { name: "Submit review" }).click();
    await expect(panel.getByRole("alert")).toBeFocused();
    await expect(panel.getByRole("alert")).toHaveText("Choose a star rating before you submit.");
    await panel.getByRole("radio", { name: /^2 stars/ }).check();
    await panel.getByLabel("Review (optional)").fill("  Late but tidy  ");
    await expect(panel).toContainText("14 of 2,000 characters");
    expect(await axe(page)).toEqual([]);
    const sent = page.waitForRequest(request => request.url().includes("/rpc/submit_job_review"));
    await panel.getByRole("button", { name: "Submit review" }).click();
    expect((await sent).postDataJSON()).toEqual({ _job_id: reviewJob, _rating: 2, _comment: "Late but tidy" });
    const done = page.getByRole("dialog", { name: "Synthetic Review Service" }).getByRole("region", { name: "Your review" });
    await expect(done.getByRole("status")).toHaveText("Thanks — your review is saved.");
    await expect(done.getByRole("img", { name: "2 out of 5 stars" })).toBeVisible();
    await expect(done).toContainText("Your review is public on the provider's profile.");
    expect(await done.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `test-results/reviews-homeowner-${theme}-${width}.png`, fullPage: true });
  });
}

test("homeowner: a server refusal keeps the choice and offers recovery", async ({ page }) => {
  await setup(page, "homeowner", { width: 320 });
  await page.route("**/rest/v1/rpc/service_review", route => route.fulfill({ json: readback(null) }));
  await page.route("**/rest/v1/rpc/submit_job_review", route => route.fulfill({ status: 400,
    json: { code: "22023", message: "This service has an open issue report; you can review it once the issue is resolved" } }));
  const { panel } = await openReview(page);
  await panel.getByRole("radio", { name: /^5 stars/ }).check();
  await panel.getByRole("button", { name: "Submit review" }).click();
  await expect(panel.getByRole("alert")).toBeFocused();
  await expect(panel.getByRole("alert")).toContainText("open issue report");
  await expect(panel.getByRole("radio", { name: /^5 stars/ })).toBeChecked();
  await expect(panel.getByRole("button", { name: "Submit review" })).toBeEnabled();
});

test("homeowner: load failure and permission refusal show an alert with Try again", async ({ page }) => {
  await setup(page, "homeowner", { width: 320 });
  let calls = 0;
  await page.route("**/rest/v1/rpc/service_review", route => (calls += 1) === 1
    ? route.fulfill({ status: 403, json: { code: "42501", message: "Only participants can see this review" } })
    : route.fulfill({ json: readback(null, [], "not_confirmed") }));
  const { dialog } = await openReview(page);
  const panel = dialog.getByRole("region", { name: "How did the service go?" });
  await expect(panel.getByRole("alert")).toHaveText("You don't have permission to change this review.");
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel).toContainText("You can review this service after you confirm the work is done.");
  await expect(panel.getByRole("button", { name: "Submit review" })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test("homeowner: a rejected review shows the criterion; appeal and a stale correction recover", async ({ page }) => {
  await setup(page, "homeowner", { width: 1440 });
  let review = ownReview({ state: "rejected", public: false, criterion: "personal_information", criterion_label: "Personal information",
    moderation_version: 1, can_appeal: true });
  let history: Row[] = [{ action: "rejected", at, from_state: "published", to_state: "rejected", criterion: "personal_information",
    criterion_label: "Personal information", reason: "Phone number in the text", by: "mercurius", previous: null }];
  await page.route("**/rest/v1/rpc/service_review", route => route.fulfill({ json: readback(review, history) }));
  await page.route("**/rest/v1/rpc/appeal_job_review", route => {
    review = { ...review, state: "appealed", can_appeal: false };
    history = [...history, { action: "appealed", at, from_state: "rejected", to_state: "appealed", criterion: "personal_information",
      criterion_label: "Personal information", reason: "Removed the number", by: "you", previous: null }];
    return route.fulfill({ json: "00000000-0000-4000-8000-000000000141" });
  });
  await page.route("**/rest/v1/rpc/revise_job_review", route => route.fulfill({ status: 409,
    json: { code: "40001", message: "This review changed since you opened it. Refresh to see the current version." } }));
  const { dialog } = await openReview(page);
  const panel = dialog.getByRole("region", { name: "Your review" });
  await expect(panel).toContainText("Your review isn't public (personal information). You can correct it or appeal the decision.");
  await panel.getByText("Review history (1)").click();
  await expect(panel.getByRole("list", { name: "Review history" })).toContainText("Mercurius");
  await expect(panel.getByRole("list", { name: "Review history" })).not.toContainText("operator");

  await panel.getByRole("button", { name: "Appeal decision" }).click();
  const appeal = page.getByRole("alertdialog", { name: "Appeal this moderation decision?" });
  await expect(appeal.getByRole("button", { name: "Submit appeal" })).toBeDisabled();
  await appeal.getByLabel(/Why should Mercurius reconsider\?/).fill("Removed the number");
  await appeal.getByRole("button", { name: "Submit appeal" }).click();
  await expect(panel.getByRole("status")).toHaveText("Appeal submitted. Mercurius will review it.");
  await expect(panel).toContainText("Mercurius is reviewing your appeal.");
  await expect(panel.getByRole("button", { name: "Appeal decision" })).toHaveCount(0);

  await panel.getByRole("button", { name: "Correct review" }).click();
  await panel.getByRole("radio", { name: /^5 stars/ }).check();
  const sent = page.waitForRequest(request => request.url().includes("/rpc/revise_job_review"));
  await panel.getByRole("button", { name: "Save correction" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Save this correction?" });
  await confirm.getByLabel(/Reason for the correction/).fill("Provider came back");
  await confirm.getByRole("button", { name: "Save correction" }).click();
  expect((await sent).postDataJSON()).toMatchObject({ _review_id: reviewId, _rating: 5, _expected_revision: 0, _reason: "Provider came back" });
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(confirm.getByRole("alert")).toContainText("changed since you opened it");
  expect(await axe(page)).toEqual([]);
});

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`admin ${theme} ${width}px: decisions name a criterion and keep history`, async ({ page }) => {
    await setup(page, "admin", { theme, width });
    const item = { ...ownReview({ state: "appealed", public: false, criterion: "spam", criterion_label: "Spam", moderation_version: 1 }),
      job_id: reviewJob, service_type: "Synthetic Review Service", visit: true, contractor_id: "c", contractor_name: "Synthetic Vendor",
      author_name: "Synthetic Homeowner", moderated_at: at, history: [
        { action: "rejected", at, from_state: "published", to_state: "rejected", criterion: "spam", criterion_label: "Spam", reason: "Link", actor_name: "Synthetic Operator", previous: { rating: 4, comment: "x" } },
        { action: "appealed", at, from_state: "rejected", to_state: "appealed", criterion: "spam", criterion_label: "Spam", reason: "It is my page", actor_name: "Synthetic Homeowner", ticket_id: "00000000-0000-4000-8000-000000000141", previous: { rating: 4, comment: "x" } }] };
    await page.route("**/rest/v1/rpc/admin_reviews", route => route.fulfill({ json: { checked_at: at, items: [item],
      counts: { public: 3, held_for_moderation: 0, rejected: 1, appealed: 1, private: 1, public_average: 3.67, quality_feedback: 0 } } }));
    await page.route("**/rest/v1/rpc/moderate_job_review", route => route.fulfill({ status: 409,
      json: { code: "40001", message: "Another moderation decision was recorded. Refresh to see it." } }));
    await page.goto("/admin/reviews");
    await expect(page.getByRole("heading", { level: 1, name: "Reviews & Feedback" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "3.7" })).toBeVisible();
    await page.getByLabel("Review state").selectOption("decision");
    await page.getByRole("button", { name: "Open review of Synthetic Review Service by Synthetic Homeowner" }).click();
    const dialog = page.getByRole("dialog", { name: /Synthetic Review Service/ });
    await expect(dialog.getByRole("list", { name: "Review history" }).getByRole("listitem")).toHaveText([/Review not published.*Synthetic Operator.*Spam/, /Appeal submitted.*Synthetic Homeowner/]);
    await expect(dialog.getByRole("button", { name: "Uphold appeal and publish" })).toBeEnabled();
    await dialog.getByLabel(/Criterion/).selectOption("");
    await expect(dialog.getByRole("button", { name: "Deny appeal" })).toBeDisabled();
    await dialog.getByLabel(/Criterion/).selectOption("spam");
    await dialog.getByRole("button", { name: "Deny appeal" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Deny appeal?" });
    await confirm.getByLabel(/Reason the author will read/).fill("Promotional link");
    const sent = page.waitForRequest(request => request.url().includes("/rpc/moderate_job_review"));
    await confirm.getByRole("button", { name: "Save decision" }).click();
    expect((await sent).postDataJSON()).toEqual({ _review_id: reviewId, _state: "rejected", _reason: "Promotional link", _criterion: "spam", _expected_version: 1 });
    await expect(confirm.getByRole("alert")).toBeFocused();
    expect(await axe(page)).toEqual([]);
    expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/reviews-admin-${theme}-${width}.png`, fullPage: true });
  });
}
