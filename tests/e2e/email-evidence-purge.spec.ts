// TRACE-155 (Phase 7.3D-2): synthetic browser evidence for the operator purge control on the Email
// evidence page: the confirmation, one call per confirmation, no duplicate call while pending, no
// automatic repetition, the returned result and backlog, the refreshed counts, a refusal, an
// unknown outcome, a failed refresh that never undoes a reported deletion, and responsive and
// accessible rendering. The readback and the purge are served per test (synthetic values only);
// every request to any other origin is aborted, so nothing leaves the machine. The database
// contract is SQL 121 and is unchanged.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, json: value });

const retention = (extra: Record<string, unknown> = {}) => ({
  retained: 0, retained_linked: 0, retained_unlinked: 0, expired: 0, oldest_expired_expires_at: null, latest_expires_at: null,
  purge_duty: false, last_purge: null, ...extra,
});
const readback = (extra: Record<string, unknown>) => ({
  checked_at: "2026-11-21T15:00:00+00:00", armed: false, armed_at: null, retry_horizon_seconds: 100800, history: [], intervals: [], retention: retention(extra),
});
const BEFORE = readback({ retained: 1240, retained_linked: 200, retained_unlinked: 1040, expired: 1037, purge_duty: true,
  oldest_expired_expires_at: "2026-10-01T12:00:00+00:00", latest_expires_at: "2027-02-18T17:00:00+00:00" });
const AFTER = { ...readback({ retained: 240, retained_linked: 200, retained_unlinked: 40, expired: 37, purge_duty: true,
  oldest_expired_expires_at: "2026-10-20T12:00:00+00:00", latest_expires_at: "2027-02-18T17:00:00+00:00",
  last_purge: { ran_at: "2026-11-21T15:01:00+00:00", deleted: 1000, remaining_expired: 37, remaining_over_cap: false } }), checked_at: "2026-11-21T15:01:01+00:00" };
const RESULT = { checked_at: "2026-11-21T15:01:00+00:00", limit: 1000, deleted: 1000, remaining_expired: 37, remaining_over_cap: false,
  oldest_remaining_expires_at: "2026-10-20T12:00:00+00:00" };

type Served = { reads: number; calls: unknown[] };

/** Serves the readback (state after the purge once a purge has been answered) and records every purge call. */
async function open(page: Page, purge: (route: Route, served: Served) => Promise<void> | void,
  options: { theme?: string; width?: number; readback?: (served: Served) => unknown; failReadAfterPurge?: boolean } = {}) {
  const served: Served = { reads: 0, calls: [] };
  await page.route("**/rpc/email_evidence_arming_readback", (route) => {
    served.reads += 1;
    if (options.failReadAfterPurge && served.calls.length > 0) {
      return json(route, { code: "", message: "Synthetic readback outage" }, 503);
    }
    return json(route, options.readback ? options.readback(served) : served.calls.length > 0 ? AFTER : BEFORE);
  });
  await page.route("**/rpc/email_provider_events_purge", (route) => {
    served.calls.push(route.request().postDataJSON());
    return purge(route, served);
  });
  await syntheticSession(page.context(), "admin");
  await page.addInitScript((value) => localStorage.setItem("theme", value), options.theme ?? "light");
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await page.goto("/admin/email-evidence");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Email evidence");
  return served;
}

const count = (page: Page, term: string) => page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");

async function startPurge(page: Page) {
  await page.getByRole("button", { name: "Purge expired reports" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

test("the confirmation says the deletion is permanent and expired-only; cancelling calls nothing", async ({ page }) => {
  const served = await open(page, (route) => json(route, RESULT));
  await expect(page.getByText("The purge deletes expired reports only, up to 1,000 each time it is confirmed. Nothing runs it automatically.")).toBeVisible();
  const dialog = await startPurge(page);
  await expect(dialog.getByRole("heading")).toHaveText("Permanently delete expired provider reports?");
  await expect(dialog).toContainText("Up to 1,000 expired Resend delivery reports");
  await expect(dialog).toContainText("whose retention has expired, oldest first, in this one run");
  await expect(dialog).toContainText("Deletion is permanent and cannot be undone.");
  await expect(dialog).toContainText("Reports that have not expired, email records and the coverage window history are not changed.");
  // Focus starts on Cancel, the safe choice.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(served.calls).toEqual([]);
  expect(served.reads).toBe(1);
});

test("one confirmation makes one call of 1,000; the result and backlog are shown; the counts are refreshed; nothing repeats", async ({ page }) => {
  const served = await open(page, (route) => json(route, RESULT));
  await expect(count(page, "Expired, awaiting purge")).toHaveText("1037");
  const dialog = await startPurge(page);
  await dialog.getByRole("button", { name: "Delete expired reports" }).click();
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId("purge-result");
  await expect(result).toContainText("1,000 expired reports deleted · Nov 21, 2026");
  await expect(result).toContainText("37 expired reports remain, the oldest expired Oct 20, 2026");
  await expect(result).toContainText("Run it again to delete up to 1,000 more.");
  await expect(result).not.toContainText("Refreshing");
  await expect(result).not.toContainText("not refreshed");
  // The existing retention readback was read again and shows the new counts and the run.
  await expect(count(page, "Expired, awaiting purge")).toHaveText("37");
  await expect(count(page, "Stored reports")).toHaveText("240");
  await expect(page.getByText(/^Last purge Nov 21, 2026/)).toContainText("1000 deleted, 37 expired left.");
  await expect(page.getByTestId("refresh-error")).toHaveCount(0);
  expect(served.calls).toEqual([{ p_limit: 1000 }]);
  expect(served.reads).toBe(2);
  // A backlog remains, and still nothing runs again by itself.
  await page.waitForTimeout(1500);
  expect(served.calls).toHaveLength(1);
  expect(served.reads).toBe(2);
});

test("each further run needs its own confirmation: two confirmations, exactly two calls", async ({ page }) => {
  const served = await open(page, (route, s) => json(route, s.calls.length === 1 ? RESULT
    : { ...RESULT, checked_at: "2026-11-21T15:02:00+00:00", deleted: 37, remaining_expired: 0, oldest_remaining_expires_at: null }));
  await (await startPurge(page)).getByRole("button", { name: "Delete expired reports" }).click();
  await expect(page.getByTestId("purge-result")).toContainText("1,000 expired reports deleted");
  expect(served.calls).toHaveLength(1);
  await (await startPurge(page)).getByRole("button", { name: "Delete expired reports" }).click();
  await expect(page.getByTestId("purge-result")).toContainText("37 expired reports deleted");
  await expect(page.getByTestId("purge-result")).toContainText("No expired reports remain.");
  expect(served.calls).toEqual([{ p_limit: 1000 }, { p_limit: 1000 }]);
});

test("while the call is pending, repeated clicks, Enter and Escape start no second call and cannot close the dialog", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const served = await open(page, async (route) => { await held; await json(route, RESULT); });
  const dialog = await startPurge(page);
  const confirm = dialog.getByRole("button", { name: "Delete expired reports" });
  await confirm.click({ clickCount: 3 });
  const pending = dialog.getByRole("button", { name: "Confirming…" });
  await expect(pending).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Confirming action…");
  await pending.click({ force: true });
  await pending.dispatchEvent("click");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(served.calls).toHaveLength(1);
  release();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("purge-result")).toContainText("1,000 expired reports deleted");
  expect(served.calls).toEqual([{ p_limit: 1000 }]);
});

test("a backlog over the cap says only 'more than 10,000'", async ({ page }) => {
  await open(page, (route) => json(route, { ...RESULT, remaining_expired: 10000, remaining_over_cap: true, oldest_remaining_expires_at: "2026-09-01T12:00:00+00:00" }));
  await (await startPurge(page)).getByRole("button", { name: "Delete expired reports" }).click();
  await expect(page.getByTestId("purge-result")).toContainText("More than 10,000 expired reports remain, the oldest expired Sep 1, 2026");
  await expect(page.getByTestId("purge-result")).toContainText("Each run deletes up to 1,000; run it again to delete more.");
});

test("a database refusal is shown in the dialog as nothing deleted; the counts are read again; no result is claimed", async ({ page }) => {
  const served = await open(page, (route) => json(route, { code: "42501", message: "Operator access required", details: null, hint: null }, 403),
    { readback: () => BEFORE });
  const dialog = await startPurge(page);
  await dialog.getByRole("button", { name: "Delete expired reports" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The purge was refused: Operator access required. Nothing was deleted.");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(page.getByTestId("purge-result")).toHaveText("");
  await expect(count(page, "Expired, awaiting purge")).toHaveText("1037");
  expect(served.calls).toHaveLength(1);
  expect(served.reads).toBe(2);
  await accessible(page);
});

test("a lost answer is shown as unknown, never as nothing deleted; it is not retried", async ({ page }) => {
  const served = await open(page, (route) => route.abort("failed"), { readback: () => BEFORE });
  const dialog = await startPurge(page);
  await dialog.getByRole("button", { name: "Delete expired reports" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("The purge's result is unknown:");
  await expect(alert).toContainText("Reports may have been deleted. Refresh the counts before running it again.");
  await expect(alert).not.toContainText("Nothing was deleted");
  await page.waitForTimeout(1000);
  expect(served.calls).toHaveLength(1);
  await expect(page.getByTestId("purge-result")).toHaveText("");
});

test("an unreadable answer is unknown, not a success", async ({ page }) => {
  await open(page, (route) => json(route, { deleted: "lots" }));
  const dialog = await startPurge(page);
  await dialog.getByRole("button", { name: "Delete expired reports" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The purge's answer could not be read. Reports may have been deleted. Refresh the counts before running it again.");
  await expect(page.getByTestId("purge-result")).toHaveText("");
});

test("a failed refresh after a purge keeps the reported deletion and says only that the counts are stale", async ({ page }) => {
  const served = await open(page, (route) => json(route, RESULT), { failReadAfterPurge: true });
  const dialog = await startPurge(page);
  await dialog.getByRole("button", { name: "Delete expired reports" }).click();
  // The command succeeded, so the dialog closes as done; the refresh failure is reported apart.
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId("purge-result");
  await expect(result).toContainText("1,000 expired reports deleted");
  await expect(result).toContainText("37 expired reports remain");
  await expect(result).toContainText("The counts above were not refreshed after this purge. The deletion stands; use Refresh to read the current counts.");
  await expect(page.getByTestId("refresh-error")).toContainText("The page could not be refreshed: Synthetic readback outage. The figures below are from Nov 21, 2026");
  await expect(page.getByText("Delete expired reports: Up to 1,000 expired Resend delivery reports. Done.")).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/nothing was deleted|rolled back|not deleted/i);
  // The page is still there with the last figures, not replaced by a load error.
  await expect(count(page, "Expired, awaiting purge")).toHaveText("1037");
  expect(served.calls).toHaveLength(1);
  expect(served.reads).toBe(2);
  await accessible(page);
});

for (const [theme, width] of [["light", 320], ["dark", 320], ["dark", 1440]] as const) {
  test(`responsive and accessible (${theme}, ${width} px): the dialog and the result fit and pass axe`, async ({ page }) => {
    // Two full axe scans (dialog open, then the result) in one test.
    test.slow();
    await open(page, (route) => json(route, RESULT), { theme, width });
    const dialog = await startPurge(page);
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    for (const name of ["Cancel", "Delete expired reports"]) {
      const button = await dialog.getByRole("button", { name }).boundingBox();
      expect(button && button.height >= 24).toBe(true);
    }
    await accessible(page);
    await dialog.getByRole("button", { name: "Delete expired reports" }).click();
    await expect(page.getByTestId("purge-result")).toContainText("1,000 expired reports deleted");
    await accessible(page);
  });
}
