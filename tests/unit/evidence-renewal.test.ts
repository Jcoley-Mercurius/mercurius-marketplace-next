import { describe, expect, it } from "vitest";
import { kindLabel, renewalDays, renewalTiming } from "../../src/lib/evidenceRenewal";

// TRACE-072: wording only. Which evidence is expiring or lapsed is the server's decision.
describe("evidence renewal timing", () => {
  const evaluated = "2026-09-13T12:00:00.000Z";
  const at = (hours: number) => new Date(Date.parse(evaluated) + hours * 3_600_000).toISOString();

  it.each([
    [1, "Expires in 1 day"],
    [24, "Expires in 1 day"],
    [25, "Expires in 2 days"],
    [30 * 24, "Expires in 30 days"],
  ])("expiring evidence %i hours out reads %s", (hours, text) => {
    expect(renewalTiming("expiring", at(hours), evaluated)).toBe(text);
  });

  it.each([
    [0, "Lapsed today"],
    [-23, "Lapsed today"],
    [-24, "Lapsed 1 day ago"],
    [-72, "Lapsed 3 days ago"],
  ])("lapsed evidence %i hours ago reads %s", (hours, text) => {
    expect(renewalTiming("lapsed", at(hours), evaluated)).toBe(text);
  });

  it("never reports zero days left for expiring evidence", () => {
    expect(renewalDays("expiring", at(0.01), evaluated)).toBe(1);
  });

  it("falls back to the state for an unreadable date", () => {
    expect(renewalTiming("expiring", "not a date", evaluated)).toBe("Expiring");
    expect(renewalTiming("lapsed", "not a date", evaluated)).toBe("Lapsed");
  });

  it("labels known items and passes unknown ones through", () => {
    expect(kindLabel("insurance")).toBe("Insurance");
    expect(kindLabel("future_item")).toBe("future_item");
  });
});
