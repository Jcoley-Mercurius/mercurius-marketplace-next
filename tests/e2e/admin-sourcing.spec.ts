// Phase 7.5G-2 (TRACE-159): synthetic browser evidence for the read-only sourcing list. The reader is
// served per test from synthetic values; any other origin is aborted, so nothing leaves the machine.
// Covers: the approved name and description (OD-4a), items in server order with kind and related-event
// labels and both markers, empty, error and access-denied states, no control other than Refresh and
// no per-row link (SG-9), and that opening and refreshing send no Supabase data request other than
// the reader and the shell's has_role check (no expire_stale_matches, no matcher, no table read).
// The database contract is SQL 134.
import { test, expect, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const T = "2026-11-27T15:00:00+00:00";
const id = (n: number) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;
const ITEMS = [
  { request_id: id(3), kind: "exhausted", related_event_at: "2026-11-20T14:00:00+00:00", related_event: "request_created", plan_visit: false, offer_terms_block: true },
  { request_id: id(1), kind: "awaiting_consent", related_event_at: "2026-11-21T14:00:00+00:00", related_event: "request_created", plan_visit: false, offer_terms_block: false },
  { request_id: id(2), kind: "exhausted", related_event_at: "2026-11-26T14:00:00+00:00", related_event: "provider_operation", plan_visit: true, offer_terms_block: false },
  { request_id: id(4), kind: "legacy_sourcing", related_event_at: "2026-11-27T13:30:00+00:00", related_event: "offer_closed", plan_visit: false, offer_terms_block: false },
];
const DESCRIPTION = "Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state.";

type Answer = { status?: number; json: unknown };

async function open(page: Page, answers: Answer[], options: { width?: number; role?: "admin" | "homeowner" } = {}) {
  const calls: string[] = [];
  const data: string[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:55831" && url.pathname.startsWith("/rest/v1/")) data.push(`${request.method()} ${url.pathname}`);
  });
  await page.route("**/rest/v1/rpc/admin_sourcing_queue", (route) => {
    const answer = answers[Math.min(calls.length, answers.length - 1)];
    calls.push(route.request().method());
    return route.fulfill({ status: answer.status ?? 200, json: answer.json });
  });
  await syntheticSession(page.context(), options.role ?? "admin");
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await page.goto("/admin/sourcing");
  return { calls, data };
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

const rows = async (page: Page, width: number) => {
  if (width >= 1280) {
    const body = page.getByRole("table", { name: "Sourcing requests" }).getByRole("rowgroup").nth(1).getByRole("row");
    return Promise.all(Array.from({ length: await body.count() }, async (_, i) => [
      (await body.nth(i).getByRole("rowheader").innerText()).trim(),
      ...(await body.nth(i).getByRole("cell").allInnerTexts()).map((text) => text.trim().replace(/\s*\n\s*/g, " | ")),
    ]));
  }
  const items = page.getByRole("list", { name: "Sourcing requests" }).getByRole("listitem").filter({ has: page.getByRole("heading") });
  return Promise.all(Array.from({ length: await items.count() }, async (_, i) =>
    (await items.nth(i).locator(":scope > dl > div > dd").allInnerTexts()).map((text) => text.trim().replace(/\s*\n\s*/g, " | "))));
};
const EXPECTED = [
  [id(3), "No provider accepted", "Request created · Nov 20, 2026, 9:00 AM Eastern", "Also in Offers at other terms"],
  [id(1), "Awaiting fallback consent", "Request created · Nov 21, 2026, 9:00 AM Eastern", "—"],
  [id(2), "No provider accepted", "Provider cancel or no-show recorded · Nov 26, 2026, 9:00 AM Eastern", "Plan visit: plan's provider only"],
  [id(4), "Legacy sourcing", "Offer last closed · Nov 27, 2026, 8:30 AM Eastern", "—"],
];

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

for (const width of [1440, 320]) {
  test(`lists the reader's items in server order with their labels (${width}px)`, async ({ page }) => {
    await open(page, [{ json: { checked_at: T, items: ITEMS } }], { width });
    await expect(page.getByRole("heading", { level: 1, name: "Sourcing" })).toBeVisible();
    await expect(page.getByText(DESCRIPTION, { exact: true })).toBeVisible();
    await expect(page.getByText("Checked Nov 27, 2026, 10:00 AM Eastern.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "4 requests" })).toBeVisible();
    await expect.poll(() => rows(page, width)).toEqual(EXPECTED);
    await expect(page.getByText(/\bsince\b|waiting since|longest|at least|lower bound|overdue|\bdue\b/i)).toHaveCount(0);
    await accessible(page);
  });
}

test("opening and refreshing call only the reader; nothing settles, matches or reads tables", async ({ page }) => {
  const { calls, data } = await open(page, [{ json: { checked_at: T, items: ITEMS } }, { json: { checked_at: T, items: ITEMS.slice(1) } }]);
  await expect(page.getByRole("heading", { level: 2, name: "4 requests" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "3 requests" })).toBeVisible();
  expect(calls).toEqual(["POST", "POST"]);
  // Characterized first: the admin shell sends one has_role check; the page adds only the reader.
  expect([...new Set(data)].sort()).toEqual(["POST /rest/v1/rpc/admin_sourcing_queue", "POST /rest/v1/rpc/has_role"]);
  expect(data.filter((entry) => entry.endsWith("/admin_sourcing_queue"))).toHaveLength(2);
});

test("has no control other than Refresh and no per-row link", async ({ page }) => {
  await open(page, [{ json: { checked_at: T, items: ITEMS } }]);
  await expect(page.getByRole("heading", { level: 2, name: "4 requests" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("button")).toHaveText(["Refresh"]);
  await expect(main.getByRole("link")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("combobox")).toHaveCount(0);
});

test("empty queue", async ({ page }) => {
  await open(page, [{ json: { checked_at: T, items: [] } }]);
  await expect(page.getByRole("heading", { level: 2, name: "No requests in this queue." })).toBeVisible();
  await accessible(page);
});

test("a failed read shows an error with the code, and Refresh can recover", async ({ page }) => {
  const { calls } = await open(page, [{ status: 500, json: { code: "57014", message: "canceling statement due to statement timeout" } }, { json: { checked_at: T, items: ITEMS } }]);
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("The sourcing queue couldn’t be loaded");
  await expect(alert).toContainText("canceling statement due to statement timeout (57014)");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "4 requests" })).toBeVisible();
  expect(calls).toHaveLength(2);
});

test("an answer the client can't read is an error, not a shorter list", async ({ page }) => {
  await open(page, [{ json: { checked_at: T, items: [...ITEMS, { ...ITEMS[0], request_id: id(9), kind: "sourced" }] } }]);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("The sourcing queue's answer couldn’t be read.");
  await expect(page.getByRole("table", { name: "Sourcing requests" })).toHaveCount(0);
});

test("a refusal (42501) shows the access state and disables Refresh", async ({ page }) => {
  await open(page, [{ status: 403, json: { code: "42501", message: "Admin access required" } }]);
  await expect(page.getByRole("heading", { level: 2, name: "Admin access required" })).toBeVisible();
  await expect(page.getByText("This account can’t read the sourcing queue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  await accessible(page);
});

test("a homeowner is refused by the admin shell and the reader is never called", async ({ page }) => {
  const { calls } = await open(page, [{ json: { checked_at: T, items: ITEMS } }], { role: "homeowner" });
  await expect(page).not.toHaveURL(/\/admin\/sourcing/);
  expect(calls).toEqual([]);
});
