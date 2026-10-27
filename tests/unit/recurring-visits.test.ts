import { describe, expect, it } from "vitest";
import {
  blockMessage, cadenceLabel, historyLine, isRecurringPlan, paymentLabel, recordedAttempt, seriesErrorMessage, termsLine, visitState,
  type BlockCode, type SeriesHistoryEntry, type SeriesReadback, type SeriesVisit,
} from "@/lib/recurringVisits";

// TRACE-123: a recurring plan's visits are separate services; their state, payment and every
// attempt to add one come from the recurring_series readback.

const visit = (overrides: Partial<SeriesVisit>): SeriesVisit => ({
  id: "v1", visit_key: "k1", starts_at: "2030-11-05T14:00:00Z", local_start: "2030-11-05T09:00:00", status: "matched",
  matching_status: "offered", offer: "pending", plan_provider: true, provider_completed_at: null, homeowner_confirmed_at: null,
  payment: "none", ...overrides,
});
const entry = (overrides: Partial<SeriesHistoryEntry>): SeriesHistoryEntry => ({
  id: "g1", at: "2030-10-20T15:00:00Z", outcome: "created", code: null, starts_at: "2030-11-05T14:00:00Z", local_start: "2030-11-05T09:00:00",
  occurrence_id: "v1", actor: "operations", reason: "Synthetic", operation_key: null, ...overrides,
});
const series = (history: SeriesHistoryEntry[]): SeriesReadback => ({
  series_id: "s1", timezone: "America/New_York", frequency: "weekly", status: "scheduled", has_provider: true, terms: null, visits: [], history,
  plan_state: "active", anchor: null,
});

describe("plans and visits", () => {
  it("treats only the recurring request itself as the plan", () => {
    expect(isRecurringPlan({ frequency: "weekly", recurrence_parent_id: null })).toBe(true);
    expect(isRecurringPlan({ frequency: "every-two-months" })).toBe(true);
    expect(isRecurringPlan({ frequency: "weekly", recurrence_parent_id: "s1" })).toBe(false);
    expect(isRecurringPlan({ frequency: "one-time" })).toBe(false);
    expect(isRecurringPlan({ frequency: null })).toBe(false);
  });

  it("labels every offered cadence, with bi-monthly as every two weeks", () => {
    expect(["weekly", "bi-monthly", "monthly", "every-two-months", "quarterly"].map(cadenceLabel))
      .toEqual(["Weekly", "Every two weeks", "Monthly", "Every two months", "Quarterly"]);
  });

  it("describes the accepted terms, including add-ons, without inventing a price for quotes", () => {
    const terms = { provider: "Synthetic provider", package: "Lawn", price_level: "Weekly", pricing_mode: "fixed", frequency: "weekly",
      visit_price: 40, visit_total: 45, has_addons: true, accepted_at: "2030-10-01T12:00:00Z" };
    expect(termsLine(terms)).toBe("Weekly · $45.00 a visit, including add-ons · Synthetic provider");
    expect(termsLine({ ...terms, has_addons: false, visit_total: 40 })).toBe("Weekly · $40.00 a visit · Synthetic provider");
    expect(termsLine({ ...terms, pricing_mode: "custom_quote", visit_total: null })).toBe("Weekly · Quoted · Synthetic provider");
  });

  it("reads each visit's own acceptance and work", () => {
    expect(visitState(visit({}))).toBe("Waiting for the provider to accept this visit");
    expect(visitState(visit({ status: "scheduled", matching_status: "matched", offer: "accepted" }))).toBe("Provider accepted this visit");
    expect(visitState(visit({ status: "in_progress" }))).toBe("In progress");
    expect(visitState(visit({ status: "vendor_completed", provider_completed_at: "2030-11-05T16:00:00Z" })))
      .toBe("Completed by the provider · waiting for the homeowner to confirm");
    expect(visitState(visit({ status: "completed", provider_completed_at: "x", homeowner_confirmed_at: "y" }))).toBe("Completed and confirmed by the homeowner");
    expect(visitState(visit({ matching_status: "awaiting_consent", offer: "expired" }))).toBe("Provider didn’t accept · Mercurius is reviewing");
    expect(visitState(visit({ status: "cancelled" }))).toBe("Cancelled");
  });

  it("shows payment only when the readback includes it", () => {
    expect(paymentLabel("none")).toBe("Not invoiced");
    expect(paymentLabel("awaiting_payment")).toBe("Payment requested");
    expect(paymentLabel("paid")).toBe("Paid");
    expect(paymentLabel(null)).toBeNull();
  });
});

describe("attempts and outcomes", () => {
  it("explains every blocked reason and says nothing was substituted where it matters", () => {
    const codes: BlockCode[] = ["series_not_active", "terms_missing", "quote_terms", "promotion_decision", "homeowner_not_admitted", "terms_changed", "provider_ineligible", "visit_date_taken"];
    for (const code of codes) expect(blockMessage(code)).not.toBe("No visit was added.");
    expect(blockMessage("terms_changed")).toContain("no other price or provider was used");
    expect(blockMessage("provider_ineligible")).toContain("no other provider was offered it");
  });

  it("writes history lines in Eastern Time", () => {
    expect(historyLine(entry({}))).toBe("Visit added: Tue, Nov 5, 2030, 9:00 AM EST");
    expect(historyLine(entry({ outcome: "existing" }))).toBe("Already added: Tue, Nov 5, 2030, 9:00 AM EST; nothing new was created");
    expect(historyLine(entry({ outcome: "blocked", code: "terms_changed" }))).toBe("Not added: Tue, Nov 5, 2030, 9:00 AM EST");
  });

  it("confirms a lost response only from the caller's own key", () => {
    const readback = series([entry({ operation_key: "mine", outcome: "blocked", code: "provider_ineligible" }), entry({ id: "g2", operation_key: null })]);
    expect(recordedAttempt(readback, "mine")).toMatchObject({ outcome: "blocked", code: "provider_ineligible" });
    expect(recordedAttempt(readback, "other")).toBeNull();
    expect(recordedAttempt(null, "mine")).toBeNull();
  });

  it("maps refusals to plain messages and never claims an unconfirmed save", () => {
    expect(seriesErrorMessage({ message: "Choose a future visit time" })).toBe("Choose a time in the future.");
    expect(seriesErrorMessage({ message: "The visit time does not match the Eastern Time entered" })).toContain("Eastern Time");
    expect(seriesErrorMessage({ message: "Operation key reused with different intent" })).toContain("conflicts");
    expect(seriesErrorMessage({ code: "42501", message: "Admin access required" })).toBe("You don’t have permission to do this.");
    expect(seriesErrorMessage(new Error("Failed to fetch"))).toContain("couldn’t confirm");
  });
});
