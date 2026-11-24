import { test, expect, type Page, type Request, type Route, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// Phase 7.5E / TRACE-159 (OD-5, owner approval 2026-11-24) synthetic browser evidence for the admin
// notification readback. `notifications` is served from an in-memory store that behaves like the
// database for an admin: reads are NOT limited to the admin's rows ("Admins can view all
// notifications"), so only the client's own user_id filter keeps other accounts' rows off the page;
// updates touch only the admin's own rows (the own-row UPDATE policy). The database contract itself is
// SQL 130.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const ADMIN = "00000000-0000-4000-8000-000000000003";
const OTHER_ADMIN = "00000000-0000-4000-8000-000000000098";
const HOMEOWNER = "00000000-0000-4000-8000-000000000001";
const REQUEST = "00000000-0000-4000-8000-000000000010";
const cors = { "access-control-allow-origin": "http://127.0.0.1:3103", "access-control-expose-headers": "content-range", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, HEAD, PATCH, OPTIONS" };

type Row = {
  id: string; user_id: string; type: string; severity: string; title: string; body: string | null;
  link: string | null; related_request_id: string | null; read_at: string | null; created_at: string;
};

const rowId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const at = (slot: number, micros = 0) => {
  const base = Date.UTC(2026, 10, 10, 15, 0, 0) - slot * 60_000;
  return new Date(base).toISOString().replace(/\.\d{3}Z$/, `.${String(micros).padStart(6, "0")}+00:00`);
};
const row = (n: number, extra: Partial<Row> = {}): Row => ({
  id: rowId(n), user_id: ADMIN, type: "job_status", severity: "info", title: "Quote proposal ready for review",
  body: "The assigned provider proposed an itemized quote.", link: "/admin/requests",
  related_request_id: REQUEST, read_at: "2026-11-10T16:00:00.000000+00:00", created_at: at(n), ...extra,
});
const unread = { read_at: null };

class Store {
  rows: Row[];
  requests: Array<{ method: string; url: URL; body: unknown }> = [];
  failGets: number[] = [];
  failPatches = 0;
  hold: Promise<void> | null = null;
  gets = 0;
  constructor(rows: Row[]) { this.rows = rows; }
  sorted(rows: Row[]) {
    return [...rows].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  }
  // Like the admin SELECT policy: every account's rows, unless the request filters by user_id.
  filter(url: URL, rows = this.rows) {
    const p = url.searchParams;
    const user = p.get("user_id");
    if (user) rows = rows.filter((r) => `eq.${r.user_id}` === user);
    const id = p.get("id");
    if (id?.startsWith("eq.")) rows = rows.filter((r) => r.id === id.slice(3));
    if (id?.startsWith("in.(")) {
      const ids = id.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, ""));
      rows = rows.filter((r) => ids.includes(r.id));
    }
    if (p.get("read_at") === "is.null") rows = rows.filter((r) => r.read_at === null);
    const or = p.get("or");
    if (or) {
      const m = /^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\."([^"]+)"\)\)$/.exec(or);
      if (!m) throw new Error(`unexpected or filter ${or}`);
      rows = rows.filter((r) => r.created_at < m[1] || (r.created_at === m[2] && r.id < m[3]));
    }
    return this.sorted(rows);
  }
  async handle(route: Route, request: Request) {
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const body = method === "PATCH" ? request.postDataJSON() : null;
    this.requests.push({ method, url, body });
    if (method === "HEAD") {
      return route.fulfill({ status: 200, headers: { ...cors, "content-range": `*/${this.filter(url).length}` } });
    }
    if (method === "GET") {
      this.gets += 1;
      if (this.hold) await this.hold;
      // 500, not 503: postgrest-js retries GET and HEAD on 503/520, which would hide the failure.
      if (this.failGets.includes(this.gets)) return route.fulfill({ status: 500, headers: cors, json: { message: "Synthetic outage" } });
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      return route.fulfill({ status: 200, headers: cors, json: this.filter(url).slice(0, limit) });
    }
    if (method === "PATCH") {
      if (this.failPatches > 0) {
        this.failPatches -= 1;
        return route.fulfill({ status: 500, headers: cors, json: { message: "Synthetic outage" } });
      }
      // Like the own-row UPDATE policy: an admin can change only their own rows.
      const targets = this.filter(url, this.rows.filter((r) => r.user_id === ADMIN));
      for (const target of targets) target.read_at = (body as { read_at: string }).read_at;
      return route.fulfill({ status: 200, headers: cors, json: targets.map((r) => ({ id: r.id, read_at: r.read_at })) });
    }
    return route.fulfill({ status: 405, headers: cors, json: {} });
  }
  patches() { return this.requests.filter((r) => r.method === "PATCH"); }
  idsOf(url: URL) { return url.searchParams.get("id")!.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, "")); }
}

type Socket = { ws: WebSocketRoute | null; topic: string | null };
async function realtime(page: Page, mode: "live" | "unavailable"): Promise<Socket> {
  const socket: Socket = { ws: null, topic: null };
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (mode === "unavailable") { void ws.close({ code: 1011, reason: "Synthetic outage" }); return; }
    socket.ws = ws;
    ws.onMessage((message) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(message));
      if (event === "phx_join") {
        socket.topic = topic;
        const changes = (payload?.config?.postgres_changes ?? []).map((c: Record<string, unknown>, i: number) => ({ ...c, id: i + 1 }));
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: changes } }]));
      } else if (event === "heartbeat") {
        ws.send(JSON.stringify([null, ref, "phoenix", "phx_reply", { status: "ok", response: {} }]));
      } else if (ref) {
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      }
    });
  });
  return socket;
}
function push(socket: Socket, type: "INSERT" | "UPDATE", record: Row) {
  socket.ws!.send(JSON.stringify([null, null, socket.topic, "postgres_changes", {
    data: { type, schema: "public", table: "notifications", commit_timestamp: record.created_at, columns: [], record, old_record: type === "UPDATE" ? { id: record.id } : undefined, errors: null }, ids: [1],
  }]));
}

const allowLocal = (page: Page) => page.route("**/*", (route) => {
  const origin = new URL(route.request().url()).origin;
  return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
});

async function openPage(page: Page, store: Store, { width = 1440, theme = "light", live = "live" as "live" | "unavailable" } = {}) {
  await allowLocal(page);
  await page.route("**/rest/v1/notifications**", (route, request) => store.handle(route, request));
  const socket = await realtime(page, live);
  await syntheticSession(page.context(), "admin");
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/notifications");
  return socket;
}

const main = (page: Page) => page.locator("#main-content");
const list = (page: Page) => page.getByRole("list", { name: "Notices" });
const rows = (page: Page) => list(page).locator(":scope > li > button");
const rowFor = (page: Page, n: number) => page.locator(`[data-notification-id="${rowId(n)}"]`);
const summary = (page: Page) => main(page).locator("header").getByRole("status");
const displayedIds = (page: Page) => rows(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-notification-id")));

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

// 30 admin rows from the live producers (and historical shapes); 4 unread among the 25 shown, 2 unread
// among the 5 older. Other accounts' rows are served to any unfiltered read, as for a real admin.
function seeded() {
  return new Store([
    row(1, { ...unread, type: "support", title: "Support request MS-000123", body: "Gate access question", link: "/admin/tickets", related_request_id: null }),
    row(2, { ...unread, type: "dispute", severity: "warning", title: "Service dispute needs review", body: "The crew skipped the back yard.", link: "/admin/disputes" }),
    row(3, { ...unread, title: "Service update", body: "reschedule request: homeowner travelling", link: "/notifications" }),
    row(4, { title: "<img src=x onerror=alert(1)>", body: "<b>Legacy markup</b>", link: "https://evil.example/phish", related_request_id: null }),
    row(5, { type: "vendor_application", severity: "warning", title: "New vendor application", body: "Synthetic Lawn Co applied (Lawn). Review and send a login invite.", link: "/admin/applications", related_request_id: null }),
    row(6, { type: "legacy_admin_kind", title: "   ", body: null, link: null, related_request_id: null }),
    row(7, { type: "job_confirmation", severity: "warning", title: "Unconfirmed completion needs review", body: "The homeowner has not responded within 72 hours.", link: "/admin/requests" }),
    row(8, { ...unread, title: "Replacement declined", body: "The homeowner declined the proposed replacement.", link: "/notifications", related_request_id: null }),
    ...Array.from({ length: 22 }, (_, i) => row(9 + i, i >= 20 ? unread : {})),
    // Never addressed to this operator. An unfiltered read would return them.
    row(100, { user_id: OTHER_ADMIN, ...unread, type: "support", title: "FOREIGN other admin copy", link: "/admin/tickets" }),
    row(101, { user_id: HOMEOWNER, ...unread, title: "FOREIGN homeowner row", link: "/dashboard" }),
  ]);
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`admin notifications ${theme} ${width}px: own notices only, stored text as text, in-app notice, exact count, nav and accessibility`, async ({ page }) => {
    test.slow(); // several axe passes
    const store = seeded();
    await openPage(page, store, { width, theme });
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(rows(page)).toHaveCount(25);
    await expect(summary(page)).toHaveText("6 unread notices · 4 shown, 2 in older notices");

    // The in-app-only statement.
    const note = main(page).getByRole("region", { name: "In-app notices only" });
    await expect(note).toContainText("Nothing here is emailed, texted or pushed to anyone.");
    await expect(note).toContainText("does not show that anyone was alerted or acted on it");
    await expect(note).toContainText("Each admin account has its own copy.");
    await expect(note.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/admin");

    // Stored text as recorded, with destinations from the validated mapping.
    await expect(rowFor(page, 1)).toContainText("Support request MS-000123");
    await expect(rowFor(page, 1)).toContainText("Gate access question");
    await expect(rowFor(page, 1)).toContainText("Opens Support Tickets");
    await expect(rowFor(page, 2)).toContainText("Opens Disputes");
    await expect(rowFor(page, 3)).toContainText("Opens the service request record");
    await expect(rowFor(page, 5)).toContainText("Opens Applications");
    await expect(rowFor(page, 7)).toContainText("Opens the service request record");
    await expect(rowFor(page, 8)).toContainText("Opens Overview");
    // Historical shapes: markup shown as text, an external link dropped, a blank title replaced.
    await expect(rowFor(page, 4)).toContainText("<img src=x onerror=alert(1)>");
    await expect(rowFor(page, 4)).toContainText("<b>Legacy markup</b>");
    await expect(rowFor(page, 4)).toContainText("Opens Overview");
    await expect(rowFor(page, 6)).toContainText("Notice recorded");
    await expect(rowFor(page, 6)).toContainText("Opens Overview");
    expect(await main(page).locator("img[src='x'], b").count()).toBe(0);
    expect(await main(page).locator('a[href^="http"], a[href^="//"]').count()).toBe(0);
    // Severity is not shown as a priority.
    await expect(main(page)).not.toContainText(/\b(warning|critical)\b/i);
    // Unread is stated in text.
    await expect(rowFor(page, 1)).toContainText("Unread");
    await expect(rowFor(page, 4)).not.toContainText("Unread");
    await expect(rowFor(page, 1)).toContainText(/Recorded Nov 10, 2026, \d{1,2}:\d{2} (AM|PM) ET/);

    // Operator isolation: the store would serve other accounts' rows; none reaches the page, and
    // every read, count and cursor request names the signed-in admin.
    await expect(main(page)).not.toContainText("FOREIGN");
    const reads = store.requests.filter((r) => r.method !== "OPTIONS");
    expect(reads.length).toBeGreaterThan(1);
    for (const r of reads) expect(r.url.searchParams.get("user_id")).toBe(`eq.${ADMIN}`);

    // Navigation: Overview, then Notifications, outside the task groups.
    if (width < 1024) await page.getByRole("button", { name: "Open admin menu" }).click();
    const nav = (width < 1024 ? page.getByRole("dialog") : page).getByRole("navigation", { name: "admin navigation" });
    const labels = await nav.getByRole("link").allTextContents();
    expect(labels.slice(0, 2)).toEqual(["Overview", "Notifications"]);
    await expect(nav.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/admin/notifications");
    await expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current", "page");
    if (width < 1024) await page.keyboard.press("Escape");

    await accessible(page);
    for (const n of [4, 1]) {
      await rowFor(page, n).hover();
      await accessible(page);
    }
  });
}

test("pagination: more notices than a page, equal timestamps, no duplicates, every notice reachable", async ({ page }) => {
  // 61 rows in groups of four sharing a timestamp, so page boundaries (25, 50) fall inside groups,
  // plus another admin's rows interleaved at the same timestamps.
  const store = new Store([
    ...Array.from({ length: 61 }, (_, i) => row(i + 1, { created_at: at(Math.floor(i / 4), 123456) })),
    ...Array.from({ length: 20 }, (_, i) => row(200 + i, { user_id: OTHER_ADMIN, title: "FOREIGN", created_at: at(i, 123456) })),
  ]);
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);
  const expected = store.sorted(store.rows.filter((r) => r.user_id === ADMIN)).map((r) => r.id);

  await page.getByRole("button", { name: "Load older" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).nth(25)).toBeFocused();
  await expect(page.getByText("Loaded 25 older notices.")).toBeAttached();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rows(page)).toHaveCount(61);
  await expect(page.getByText("You’ve reached your oldest notice.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load older" })).toHaveCount(0);

  const shown = await displayedIds(page);
  expect(new Set(shown).size).toBe(61);
  expect(shown).toEqual(expected);
  await expect(main(page)).not.toContainText("FOREIGN");
  const cursors = store.requests.filter((r) => r.method === "GET" && r.url.searchParams.has("or")).map((r) => r.url.searchParams.get("or"));
  expect(cursors).toEqual([
    `(created_at.lt."${at(6, 123456)}",and(created_at.eq."${at(6, 123456)}",id.lt."${expected[24]}"))`,
    `(created_at.lt."${at(12, 123456)}",and(created_at.eq."${at(12, 123456)}",id.lt."${expected[49]}"))`,
  ]);
});

test("mark visible as read changes only the operator's loaded, displayed unread notices", async ({ page }) => {
  const store = seeded();
  await openPage(page, store);
  await expect(summary(page)).toHaveText("6 unread notices · 4 shown, 2 in older notices");
  await expect(page.getByText("“Mark visible as read” changes only the unread notices shown below.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Mark visible as read" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 visible notices marked as read." })).toBeFocused();
  const [patch] = store.patches();
  expect(new Set(store.idsOf(patch.url))).toEqual(new Set([rowId(1), rowId(2), rowId(3), rowId(8)]));
  expect(patch.url.searchParams.get("read_at")).toBe("is.null");
  expect(patch.url.searchParams.get("user_id")).toBe(`eq.${ADMIN}`);
  expect(Object.keys(patch.body as object)).toEqual(["read_at"]);

  await expect(summary(page)).toHaveText("2 unread notices · 0 shown, 2 in older notices");
  await expect(list(page)).not.toContainText("Unread");
  await expect(page.getByRole("button", { name: "Mark visible as read" })).toBeDisabled();
  // The other admin's copy and the homeowner's row are untouched; unseen admin rows stay unread.
  expect(store.rows.filter((r) => r.user_id === ADMIN && !r.read_at).map((r) => r.id)).toEqual([rowId(29), rowId(30)]);
  expect(store.rows.find((r) => r.id === rowId(100))!.read_at).toBeNull();
  expect(store.rows.find((r) => r.id === rowId(101))!.read_at).toBeNull();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rowFor(page, 29)).toContainText("Unread");
  await expect(rowFor(page, 30)).toContainText("Unread");
});

test("opening a notice marks it read once, by keyboard, and goes to its validated admin destination", async ({ page }) => {
  const store = seeded();
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);

  await page.getByRole("button", { name: "Mark visible as read" }).focus();
  await page.keyboard.press("Tab");
  await expect(rowFor(page, 1)).toBeFocused();
  expect(await rowFor(page, 1).evaluate((n) => getComputedStyle(n).boxShadow)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/tickets$/);
  expect(store.patches()).toHaveLength(1);
  expect(store.idsOf(store.patches()[0].url)).toEqual([rowId(1)]);
  expect(store.patches()[0].url.searchParams.get("user_id")).toBe(`eq.${ADMIN}`);
  expect(store.patches()[0].url.searchParams.get("read_at")).toBe("is.null");

  // "/notifications" on a request-related row opens the request record, not the homeowner page.
  await page.goto("/admin/notifications");
  await expect(rowFor(page, 1)).not.toContainText("Unread");
  await expect(summary(page)).toHaveText("5 unread notices · 3 shown, 2 in older notices");
  await rowFor(page, 3).click();
  await expect(page).toHaveURL(new RegExp(`/admin/requests\\?request=${REQUEST}$`));
  expect(store.patches()).toHaveLength(2);

  // An already read notice opens with no write.
  await page.goto("/admin/notifications");
  await rowFor(page, 7).click();
  await expect(page).toHaveURL(new RegExp(`/admin/requests\\?request=${REQUEST}$`));
  expect(store.patches()).toHaveLength(2);
});

test("unsafe, legacy and non-admin links go to a safe admin surface", async ({ page }) => {
  const links = ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "/admin/../vendor", "/vendor/jobs", "/dashboard", "/admin/notifications", "/admin/tickets?ticket=1#x"];
  const store = new Store(links.map((link, i) => row(i + 1, { link, related_request_id: i % 2 ? REQUEST : null })));
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(links.length);
  for (let i = 0; i < links.length; i += 1) {
    const expected = links[i].startsWith("/admin/tickets") ? "Opens Support Tickets" : i % 2 ? "Opens the service request record" : "Opens Overview";
    await expect(rowFor(page, i + 1), links[i]).toContainText(expected);
  }
  await rowFor(page, 1).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/notifications");
  await rowFor(page, 9).click();
  await expect(page).toHaveURL(/\/admin\/tickets$/);
});

test("failed updates are reported truthfully and recover", async ({ page }) => {
  const store = seeded();
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);

  store.failPatches = 1;
  await rowFor(page, 2).click();
  const alert = page.getByRole("alert").filter({ hasText: "This notice wasn’t marked as read" });
  await expect(alert).toBeFocused();
  await expect(alert.getByRole("link", { name: "Go to Disputes" })).toHaveAttribute("href", "/admin/disputes");
  await expect(page).toHaveURL(/\/admin\/notifications$/);
  await expect(rowFor(page, 2)).toContainText("Unread");
  await expect(summary(page)).toHaveText("6 unread notices · 4 shown, 2 in older notices");
  expect(store.rows.find((r) => r.id === rowId(2))!.read_at).toBeNull();

  store.failPatches = 1;
  await page.getByRole("button", { name: "Mark visible as read" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Notices weren’t all marked as read" })).toBeFocused();
  await expect(summary(page)).toHaveText("6 unread notices · 4 shown, 2 in older notices");
  await expect(rowFor(page, 1)).toContainText("Unread");

  await page.getByRole("button", { name: "Mark visible as read" }).click();
  await expect(summary(page)).toHaveText("2 unread notices · 0 shown, 2 in older notices");
  await rowFor(page, 2).click();
  await expect(page).toHaveURL(/\/admin\/disputes$/);
});

test("loading, error with retry and older-page failure", async ({ page }) => {
  test.slow(); // several axe passes
  let release!: () => void;
  const store = seeded();
  store.hold = new Promise((resolve) => { release = resolve; });
  await openPage(page, store, { width: 320 });
  await expect(page.getByRole("status").filter({ hasText: "Loading notices" })).toBeVisible();
  release();
  store.hold = null;
  await expect(rows(page)).toHaveCount(25);

  store.failGets = [store.gets + 1];
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Older notices couldn’t be loaded" })).toBeVisible();
  await expect(rows(page)).toHaveCount(25);
  await page.getByRole("button", { name: "Try loading older notices again" }).click();
  await expect(rows(page)).toHaveCount(30);
  await accessible(page);

  store.failGets = [store.gets + 1];
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Notices couldn’t be loaded" })).toBeVisible();
  await expect(main(page).getByRole("region", { name: "In-app notices only" })).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(rows(page)).toHaveCount(25);
});

test("empty state: other admins' notices do not count, and nothing is promised", async ({ page }) => {
  await openPage(page, new Store([row(1, { user_id: OTHER_ADMIN, ...unread, title: "FOREIGN" })]), { width: 320 });
  await expect(page.getByRole("heading", { name: "No notices for your account" })).toBeVisible();
  await expect(page.getByText("Any addressed to you will be listed here.", { exact: false })).toBeVisible();
  await expect(summary(page)).toHaveText("No unread notices");
  await expect(page.getByRole("button", { name: "Mark visible as read" })).toHaveCount(0);
  await expect(main(page)).not.toContainText("FOREIGN");
  await accessible(page);
});

test("live updates: own new notice appears, another account's is ignored; unavailable live updates say so and refresh works", async ({ page }) => {
  test.slow(); // several axe passes
  const store = seeded();
  const socket = await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);
  await expect.poll(() => socket.topic).not.toBeNull();
  expect(socket.topic).toBe(`realtime:admin-notifications:${ADMIN}`);
  await expect(page.getByText("Live updates are unavailable")).toHaveCount(0);

  // A row for another admin, even if the server let it through, is not shown.
  push(socket, "INSERT", row(300, { user_id: OTHER_ADMIN, ...unread, title: "FOREIGN live row", created_at: at(-2) }));
  const fresh = row(0, { ...unread, type: "support", title: "Reply on MS-000124", body: "Synthetic subject", link: "/admin/tickets", created_at: at(-1) });
  store.rows.push(fresh);
  push(socket, "INSERT", fresh);
  await expect(rows(page).first()).toContainText("Reply on MS-000124");
  await expect(rows(page).first()).toContainText("Unread");
  await expect(summary(page)).toHaveText("7 unread notices · 5 shown, 2 in older notices");
  await expect(main(page)).not.toContainText("FOREIGN");
  await expect(rows(page)).toHaveCount(26);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const offline = seeded();
  await openPage(page, offline, { live: "unavailable" });
  await expect(page.getByRole("status").filter({ hasText: "Live updates are unavailable. Refresh to check for new notices." })).toBeVisible();
  const before = offline.gets;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => offline.gets).toBeGreaterThan(before);
  await expect(rows(page)).toHaveCount(25);
  await accessible(page);
});

test("route access: anonymous, vendor and homeowner sessions cannot open the admin page and read no admin notices", async ({ page }) => {
  await allowLocal(page);
  const reads: URL[] = [];
  await page.route("**/rest/v1/notifications**", (route) => {
    if (route.request().method() !== "OPTIONS") reads.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, headers: { ...cors, "content-range": "*/0" }, json: [] });
  });

  // The proxy sends an anonymous visitor to sign in, keeping the path.
  await page.goto("/admin/notifications");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin%2Fnotifications$/);
  expect(reads).toHaveLength(0);

  // A vendor and a homeowner are sent away before the admin layout renders.
  for (const role of ["vendor", "homeowner"] as const) {
    await page.context().clearCookies();
    await syntheticSession(page.context(), role);
    await page.goto("/admin/notifications");
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole("navigation", { name: "admin navigation" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "In-app notices only" })).toHaveCount(0);
    if (role === "vendor") expect(reads).toHaveLength(0);
  }
  // The only reads are the homeowner's own header bell, never an admin's rows.
  for (const url of reads) expect(url.searchParams.get("user_id")).toBe(`eq.${HOMEOWNER}`);
});
