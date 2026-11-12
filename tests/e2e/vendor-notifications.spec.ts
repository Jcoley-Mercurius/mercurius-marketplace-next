import { test, expect, type Page, type Request, type Route, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// Phase 7.2B / TRACE-153 (DEC-2026-065) synthetic browser evidence for the vendor notification
// readback. `notifications` is served from an in-memory store that applies the client's own filters
// (user_id, id, read_at, the keyset or(), order, limit) and, like RLS, only ever touches the signed-in
// vendor's rows. The database contract itself (RLS, keyset, exact count, guarded marking) is SQL 119.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VENDOR = "00000000-0000-4000-8000-000000000004";
const HOMEOWNER = "00000000-0000-4000-8000-000000000001";
const REQUEST = "00000000-0000-4000-8000-000000000010";
const cors = { "access-control-allow-origin": "http://127.0.0.1:3103", "access-control-expose-headers": "content-range", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, HEAD, PATCH, OPTIONS" };

type Row = {
  id: string; user_id: string; type: string; severity: string; title: string; body: string | null;
  link: string | null; related_request_id: string | null; read_at: string | null; created_at: string;
};

const rowId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
// PostgREST-style timestamps with microseconds; a larger `slot` is older.
const at = (slot: number, micros = 0) => {
  const base = Date.UTC(2026, 10, 10, 15, 0, 0) - slot * 60_000;
  return new Date(base).toISOString().replace(/\.\d{3}Z$/, `.${String(micros).padStart(6, "0")}+00:00`);
};
const row = (n: number, extra: Partial<Row> = {}): Row => ({
  id: rowId(n), user_id: VENDOR, type: "job_status", severity: "info", title: "Job completed",
  body: "This job is now complete. Payout eligibility is handled separately.", link: "/vendor/jobs",
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
  filter(url: URL) {
    const p = url.searchParams;
    // Like RLS: never more than the signed-in vendor's own rows.
    let rows = this.rows.filter((r) => r.user_id === VENDOR);
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
      const targets = this.filter(url);
      for (const target of targets) target.read_at = (body as { read_at: string }).read_at;
      return route.fulfill({ status: 200, headers: cors, json: targets.map((r) => ({ id: r.id, read_at: r.read_at })) });
    }
    return route.fulfill({ status: 405, headers: cors, json: {} });
  }
  patches() { return this.requests.filter((r) => r.method === "PATCH"); }
  idsOf(url: URL) { return url.searchParams.get("id")!.slice(4, -1).split(",").map((v) => v.replace(/^"|"$/g, "")); }
}

// A realtime server that accepts the channel join (so the page is "live"), or refuses it.
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

async function openPage(page: Page, store: Store, { width = 1440, theme = "light", live = "live" as "live" | "unavailable" } = {}) {
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  await page.route("**/rest/v1/notifications**", (route, request) => store.handle(route, request));
  const socket = await realtime(page, live);
  await syntheticSession(page.context(), "vendor");
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/vendor/notifications");
  return socket;
}

const main = (page: Page) => page.locator("#main-content");
const list = (page: Page) => page.getByRole("list", { name: "Notices" });
const rows = (page: Page) => list(page).locator(":scope > li > button");
const rowFor = (page: Page, n: number) => page.locator(`[data-notification-id="${rowId(n)}"]`);
const summary = (page: Page) => page.locator("header").getByRole("status");
const displayedIds = (page: Page) => rows(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-notification-id")));

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

// 30 rows: the newest are recorded producer events carrying injected private text; 4 unread among
// the 25 shown, 2 unread among the 5 older ones.
const SECRETS = ["SECRET-REASON", "gate code 4471", "239-555-0100", "<img", "onerror", "MS-000123", "jane.doe@example.invalid", "respond within"];
function seeded() {
  return new Store([
    row(1, { ...unread, title: "Service update", body: "reschedule request: SECRET-REASON homeowner gate code 4471", link: "/notifications" }),
    row(2, { ...unread, title: "Homeowner declined your terms", body: "The homeowner declined these terms. SECRET-REASON" }),
    row(3, { ...unread, type: "job_offer", severity: "warning", title: "New job offer — respond within four hours", body: "Accept or decline this exclusive offer before its four-hour deadline." }),
    row(4, { title: "Service update SECRET-REASON call 239-555-0100", body: "<img src=x onerror=alert(1)>" }),
    row(5, { type: "support", title: "Mercurius replied on MS-000123", body: "jane.doe@example.invalid", link: "/support", related_request_id: null }),
    row(6, { type: "legacy_vendor_note", title: "Legacy raw title SECRET-REASON", body: "Legacy body", link: "https://evil.example/phish", related_request_id: null }),
    row(7, { type: "pricing", title: "A price is waiting for your approval", body: "Synthetic: SECRET-REASON", link: "/vendor/packages#price-approvals", related_request_id: null }),
    row(8, { ...unread, title: "Appointment changed", body: "Nov 12, 2026 9:00 AM EST (Eastern Time). Operator: SECRET-REASON", link: "/notifications" }),
    ...Array.from({ length: 22 }, (_, i) => row(9 + i, i >= 20 ? unread : {})),
    // Other accounts' rows are never served to the vendor (RLS is mirrored by the store).
    row(100, { user_id: HOMEOWNER, ...unread, title: "FOREIGN homeowner row" }),
    row(101, { user_id: "00000000-0000-4000-8000-000000000099", ...unread, title: "FOREIGN vendor row" }),
  ]);
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor notifications ${theme} ${width}px: controlled wording, exact unread count, nav and accessibility`, async ({ page }) => {
    test.slow(); // several axe passes
    const store = seeded();
    await openPage(page, store, { width, theme });
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(rows(page)).toHaveCount(25);
    await expect(summary(page)).toHaveText("6 unread notices · 4 shown, 2 in older notices");

    // Controlled copy for recognized events; generic copy for an altered title and an unknown type.
    await expect(rowFor(page, 1)).toContainText("Service update recorded");
    await expect(rowFor(page, 1)).toContainText("Opens Jobs & Requests");
    await expect(rowFor(page, 2)).toContainText("Homeowner declined your terms");
    await expect(rowFor(page, 3)).toContainText("Job offer recorded");
    await expect(rowFor(page, 3)).toContainText("see whether this one is still open");
    await expect(rowFor(page, 4)).toContainText("Job update recorded");
    await expect(rowFor(page, 5)).toContainText("Support reply");
    await expect(rowFor(page, 5)).toContainText("Opens Support");
    await expect(rowFor(page, 6)).toContainText("Account update recorded");
    await expect(rowFor(page, 6)).toContainText("Opens Overview");
    await expect(rowFor(page, 7)).toContainText("Price sent for your approval");
    await expect(rowFor(page, 8)).toContainText("Appointment update recorded");
    // Unread is stated in text, not only by color or weight.
    await expect(rowFor(page, 1)).toContainText("Unread");
    await expect(rowFor(page, 4)).not.toContainText("Unread");
    await expect(rowFor(page, 1)).toContainText(/Recorded Nov 10, 2026, \d{1,2}:\d{2} (AM|PM) ET/);

    // Nothing stored reaches the page: not the titles, bodies, reasons, ticket numbers or links.
    for (const secret of SECRETS) await expect(main(page)).not.toContainText(secret);
    await expect(main(page)).not.toContainText(/FOREIGN|Legacy raw title|Legacy body|Synthetic:/);
    expect(await main(page).locator('a[href^="http"], a[href^="//"]').count()).toBe(0);
    expect(await page.locator("img[src='x']").count()).toBe(0);

    // Every read and count asks for the signed-in vendor's rows only.
    const reads = store.requests.filter((r) => r.method !== "OPTIONS");
    expect(reads.length).toBeGreaterThan(1);
    for (const r of reads) expect(r.url.searchParams.get("user_id")).toBe(`eq.${VENDOR}`);

    if (width === 1440) {
      const nav = page.getByRole("navigation", { name: "vendor navigation" });
      const labels = await nav.getByRole("link").allTextContents();
      const jobs = labels.indexOf("Jobs & Requests");
      expect(labels.slice(jobs, jobs + 3)).toEqual(["Jobs & Requests", "Notifications", "Messages"]);
      await expect(nav.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/vendor/notifications");
    } else {
      await page.getByRole("button", { name: "Open vendor menu" }).click();
      const nav = page.getByRole("dialog").getByRole("navigation", { name: "vendor navigation" });
      await expect(nav.getByRole("link", { name: "Notifications" })).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    }
    await accessible(page);
    // Hover keeps text contrast on read and unread rows.
    for (const n of [4, 1]) {
      await rowFor(page, n).hover();
      await accessible(page);
    }
  });
}

test("pagination: more notices than a page, equal timestamps, no duplicates, every notice reachable", async ({ page }) => {
  // 61 rows in groups of four sharing a timestamp, so page boundaries (25, 50) fall inside groups.
  const store = new Store(Array.from({ length: 61 }, (_, i) => row(i + 1, { created_at: at(Math.floor(i / 4), 123456) })));
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);
  const expected = store.sorted(store.rows).map((r) => r.id);

  // Keyboard: Load older moves focus to the first newly loaded notice.
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
  // The cursors were the last row of each page, quoted, with microseconds intact.
  const cursors = store.requests.filter((r) => r.method === "GET" && r.url.searchParams.has("or")).map((r) => r.url.searchParams.get("or"));
  expect(cursors).toEqual([
    `(created_at.lt."${at(6, 123456)}",and(created_at.eq."${at(6, 123456)}",id.lt."${expected[24]}"))`,
    `(created_at.lt."${at(12, 123456)}",and(created_at.eq."${at(12, 123456)}",id.lt."${expected[49]}"))`,
  ]);
});

test("mark visible as read changes only the loaded, displayed unread notices", async ({ page }) => {
  const store = seeded();
  await openPage(page, store);
  await expect(summary(page)).toHaveText("6 unread notices · 4 shown, 2 in older notices");
  await expect(page.getByText("“Mark visible as read” changes only the unread notices shown below.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Mark visible as read" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 visible notices marked as read." })).toBeFocused();
  const [patch] = store.patches();
  expect(new Set(store.idsOf(patch.url))).toEqual(new Set([rowId(1), rowId(2), rowId(3), rowId(8)]));
  expect(patch.url.searchParams.get("read_at")).toBe("is.null");
  expect(patch.url.searchParams.get("user_id")).toBe(`eq.${VENDOR}`);
  expect(Object.keys(patch.body as object)).toEqual(["read_at"]);

  await expect(summary(page)).toHaveText("2 unread notices · 0 shown, 2 in older notices");
  await expect(list(page)).not.toContainText("Unread");
  await expect(page.getByRole("button", { name: "Mark visible as read" })).toBeDisabled();
  // Unseen rows are unchanged in the store and still unread once loaded.
  expect(store.rows.filter((r) => r.user_id === VENDOR && !r.read_at).map((r) => r.id)).toEqual([rowId(29), rowId(30)]);
  expect(store.rows.find((r) => r.id === rowId(100))!.read_at).toBeNull();
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(rowFor(page, 29)).toContainText("Unread");
  await expect(rowFor(page, 30)).toContainText("Unread");
  await expect(page.getByRole("button", { name: "Mark visible as read" })).toBeEnabled();
});

test("opening a notice marks it read once, by keyboard, and goes to its validated destination", async ({ page }) => {
  const store = seeded();
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);

  // Keyboard: Tab reaches the first notice with a visible focus ring.
  await page.getByRole("button", { name: "Mark visible as read" }).focus();
  await page.keyboard.press("Tab");
  await expect(rowFor(page, 1)).toBeFocused();
  expect(await rowFor(page, 1).evaluate((n) => getComputedStyle(n).boxShadow)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/vendor\/jobs$/);
  expect(store.patches()).toHaveLength(1);
  expect(store.idsOf(store.patches()[0].url)).toEqual([rowId(1)]);
  expect(store.patches()[0].url.searchParams.get("read_at")).toBe("is.null");

  await page.goto("/vendor/notifications");
  await expect(rowFor(page, 1)).not.toContainText("Unread");
  await expect(summary(page)).toHaveText("5 unread notices · 3 shown, 2 in older notices");

  // An already read notice opens with no write (idempotent), at its kept anchor.
  await rowFor(page, 7).click();
  await expect(page).toHaveURL(/\/vendor\/packages#price-approvals$/);
  expect(store.patches()).toHaveLength(1);
});

test("unsafe and legacy links go to a safe vendor surface", async ({ page }) => {
  const links = ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "/vendor/../admin", "/admin/requests", "/vendor/requests", "/dashboard"];
  const store = new Store(links.map((link, i) => row(i + 1, { link, related_request_id: i % 2 ? REQUEST : null })));
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(links.length);
  for (let i = 0; i < links.length; i += 1) {
    const expected = links[i] === "/vendor/requests" || i % 2 ? "Opens Jobs & Requests" : "Opens Overview";
    await expect(rowFor(page, i + 1), links[i]).toContainText(expected);
  }
  await rowFor(page, 1).click();
  await expect(page).toHaveURL(/\/vendor$/);
  await page.goto("/vendor/notifications");
  await rowFor(page, 4).click();
  await expect(page).toHaveURL(/\/vendor\/jobs$/);
});

test("failed updates are reported truthfully and recover", async ({ page }) => {
  const store = seeded();
  await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);

  store.failPatches = 1;
  await rowFor(page, 2).click();
  const alert = page.getByRole("alert").filter({ hasText: "This notice wasn’t marked as read" });
  await expect(alert).toBeFocused();
  await expect(alert.getByRole("link", { name: "Go to Jobs & Requests" })).toHaveAttribute("href", "/vendor/jobs");
  await expect(page).toHaveURL(/\/vendor\/notifications$/);
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
  await expect(page).toHaveURL(/\/vendor\/jobs$/);
});

test("loading, empty, error with retry and older-page failure", async ({ page }) => {
  test.slow(); // several axe passes
  let release!: () => void;
  const store = seeded();
  store.hold = new Promise((resolve) => { release = resolve; });
  await openPage(page, store, { width: 320 });
  await expect(page.getByRole("status").filter({ hasText: "Loading notices" })).toBeVisible();
  release();
  store.hold = null;
  await expect(rows(page)).toHaveCount(25);

  // Older page fails, the shown notices stay, and retry works.
  store.failGets = [store.gets + 1];
  await page.getByRole("button", { name: "Load older" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Older notices couldn’t be loaded" })).toBeVisible();
  await expect(rows(page)).toHaveCount(25);
  await page.getByRole("button", { name: "Try loading older notices again" }).click();
  await expect(rows(page)).toHaveCount(30);
  await accessible(page);

  // First load fails, then Try again recovers.
  store.failGets = [store.gets + 1];
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Notices couldn’t be loaded" })).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(rows(page)).toHaveCount(25);
});

test("empty state promises nothing", async ({ page }) => {
  await openPage(page, new Store([]), { width: 320 });
  await expect(page.getByRole("heading", { name: "No notices yet" })).toBeVisible();
  await expect(page.getByText("When Mercurius records an update for your account", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark visible as read" })).toHaveCount(0);
  await accessible(page);
});

test("live updates: a new notice appears with controlled wording; unavailable live updates say so and refresh works", async ({ page }) => {
  test.slow(); // several axe passes
  const store = seeded();
  const socket = await openPage(page, store);
  await expect(rows(page)).toHaveCount(25);
  await expect.poll(() => socket.topic).not.toBeNull();
  await expect(page.getByText("Live updates are unavailable")).toHaveCount(0);

  const fresh = row(0, { ...unread, title: "Homeowner accepted your terms", body: "SECRET-REASON", created_at: at(-1) });
  store.rows.push(fresh);
  socket.ws!.send(JSON.stringify([null, null, socket.topic, "postgres_changes", {
    data: { type: "INSERT", schema: "public", table: "notifications", commit_timestamp: fresh.created_at, columns: [], record: fresh, errors: null }, ids: [1],
  }]));
  await expect(rows(page).first()).toContainText("Homeowner accepted your terms");
  await expect(rows(page).first()).toContainText("Unread");
  await expect(summary(page)).toHaveText("7 unread notices · 5 shown, 2 in older notices");
  await expect(main(page)).not.toContainText("SECRET-REASON");

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

test("role guard: anonymous and homeowner sessions cannot open the vendor page; homeowner notifications are unchanged", async ({ page }) => {
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  let vendorReads = 0;
  await page.route("**/rest/v1/notifications**", (route) => {
    if (route.request().method() !== "OPTIONS") vendorReads += 1;
    return route.continue();
  });

  await page.goto("/vendor/notifications");
  await expect(page).toHaveURL(/\/login\/vendor/);
  await expect(page.getByRole("heading", { name: "Vendor sign in" })).toBeVisible();
  expect(vendorReads).toBe(0);

  // A homeowner is sent to the homeowner portal before the vendor layout renders.
  await syntheticSession(page.context(), "homeowner");
  await page.goto("/vendor/notifications");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("navigation", { name: "homeowner navigation" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Notices" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "vendor navigation" })).toHaveCount(0);

  await page.goto("/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.getByText("Homeowner updates")).toBeVisible();
  await expect(page.getByText("No notifications yet")).toBeVisible();

  await page.context().clearCookies();
  await syntheticSession(page.context(), "vendor");
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/vendor$/);
});
