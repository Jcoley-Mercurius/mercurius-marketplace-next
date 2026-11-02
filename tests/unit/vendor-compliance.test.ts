import { describe, expect, it } from "vitest";

import {
  complianceAttentionOrder,
  complianceEffects,
  complianceItemDetail,
  complianceItemLabel,
  complianceNextAction,
  formatEasternDate,
  type ComplianceItem,
  type ComplianceStatus,
} from "@/lib/vendorCompliance";

// TRACE-135 (Phase 6.12A): wording and next actions for a provider's own checklist.

function item(overrides: Partial<ComplianceItem> = {}): ComplianceItem {
  return {
    kind: "license", state: "current", exception: false, follow_up_due: null, expires_at: "2027-06-01T04:00:00Z",
    recorded_at: "2026-10-01T15:00:00Z", awaiting_review: 0, last_submitted_at: null, declined: null, ...overrides,
  };
}

function status(overrides: Partial<ComplianceStatus> = {}): ComplianceStatus {
  return {
    evaluated_at: "2026-11-02T15:00:00Z", today: "2026-11-02", notice_days: 30, provider_found: true,
    onboarding_status: "active", checklist_current: true, matching_allowed: true, payout_onboarding_current: true,
    accepting_uploads: true, open_limit: 3, items: [], ...overrides,
  };
}

describe("formatEasternDate", () => {
  it("shows a follow-up date as that calendar date in any viewer timezone", () => {
    expect(formatEasternDate("2026-11-14")).toBe("Nov 14, 2026");
  });

  it("converts a timestamp to the Eastern calendar date", () => {
    // 03:30 UTC on Nov 15 is still Nov 14 in New York (EST).
    expect(formatEasternDate("2026-11-15T03:30:00Z")).toBe("Nov 14, 2026");
    // An exception for Nov 14 expires at midnight Eastern starting Nov 15.
    expect(formatEasternDate("2026-11-15T05:00:00Z")).toBe("Nov 15, 2026");
    // Across the daylight-saving change (EDT on Oct 31).
    expect(formatEasternDate("2026-11-01T03:59:00Z")).toBe("Oct 31, 2026");
  });

  it("returns nothing for missing or invalid values", () => {
    expect(formatEasternDate(null)).toBe("");
    expect(formatEasternDate("not a date")).toBe("");
  });
});

describe("complianceItemDetail", () => {
  it("never words an exception as a verified document", () => {
    const text = complianceItemDetail(item({ state: "exception", exception: true, follow_up_due: "2026-11-14", recorded_at: null }));
    expect(text).toContain("temporary exception");
    expect(text).toContain("not a verified license");
    expect(text).toContain("ends after Nov 14, 2026");
    const insurance = complianceItemDetail(item({ kind: "insurance", state: "exception", exception: true, follow_up_due: "2026-11-14" }));
    expect(insurance).toContain("not a verified insurance certificate");
  });

  it("says a lapsed exception left no verified document", () => {
    expect(complianceItemDetail(item({ state: "expired", exception: true, follow_up_due: "2026-10-30" })))
      .toBe("The temporary exception ended after Oct 30, 2026. No verified document is on file.");
  });

  it("words documents by their Eastern expiry", () => {
    expect(complianceItemDetail(item({ state: "expiring", expires_at: "2026-11-20T05:00:00Z" }))).toBe("Expires Nov 20, 2026.");
    expect(complianceItemDetail(item({ state: "expired", expires_at: "2026-10-20T04:00:00Z" }))).toBe("Expired Oct 20, 2026.");
    expect(complianceItemDetail(item({ kind: "identity", expires_at: null }))).toBe("Recorded by Mercurius.");
    expect(complianceItemDetail(item({ state: "missing", expires_at: null, recorded_at: null }))).toBe("Not recorded for your current application.");
  });
});

describe("complianceNextAction", () => {
  const open = { accepting_uploads: true, open_limit: 3 };

  it("asks for nothing when an item is current", () => {
    expect(complianceNextAction(item(), open).kind).toBe("none");
  });

  it("waits while an uploaded document is under review, and says an upload is not verification", () => {
    const action = complianceNextAction(item({ state: "expired", awaiting_review: 1 }), open);
    expect(action.kind).toBe("wait");
    expect(action.text).toContain("Uploading is not verification");
  });

  it("asks for the document before an exception's follow-up date ends", () => {
    expect(complianceNextAction(item({ state: "exception", exception: true, follow_up_due: "2026-11-14" }), open))
      .toEqual({ kind: "upload", text: "Upload your license or business tax receipt before the end of Nov 14, 2026." });
  });

  it("asks for a renewal for an expiring document and a current one when expired or missing", () => {
    expect(complianceNextAction(item({ kind: "insurance", state: "expiring" }), open).text).toBe("Upload your renewed insurance before it expires.");
    expect(complianceNextAction(item({ kind: "insurance", state: "missing" }), open).text).toBe("Upload your current insurance for review.");
  });

  it("sends the provider to Mercurius when uploads are closed or the item is recorded by Mercurius", () => {
    expect(complianceNextAction(item({ state: "expired" }), { accepting_uploads: false, open_limit: 3 }).kind).toBe("contact");
    expect(complianceNextAction(item({ kind: "agreement", state: "missing" }), open).kind).toBe("contact");
  });

  it("never asks for bank details for payout onboarding", () => {
    const action = complianceNextAction(item({ kind: "bank_authorization", state: "expired" }), open);
    expect(action.kind).toBe("contact");
    expect(action.text).toContain("Do not send bank details");
  });
});

describe("complianceEffects", () => {
  it("states the matching effect without claiming live offerings or coverage", () => {
    expect(complianceEffects(status()).matching).toBe("Your checklist allows new job requests. Live offerings and coverage are also required.");
    expect(complianceEffects(status({ matching_allowed: false })).matching)
      .toBe("While a required item is missing or expired, Mercurius cannot send you new job requests.");
    expect(complianceEffects(status({ matching_allowed: false, onboarding_status: "suspended" })).matching)
      .toBe("Your onboarding status is suspended, so Mercurius cannot send you new job requests.");
  });

  it("names the payout hold's real cause", () => {
    expect(complianceEffects(status()).payout).toBeNull();
    expect(complianceEffects(status({ payout_onboarding_current: false })).payout).toBe("Payouts are held until your payout onboarding is current.");
    expect(complianceEffects(status({ payout_onboarding_current: false, onboarding_status: "suspended" })).payout)
      .toBe("Payouts are held while your onboarding status is suspended.");
  });

  it("claims nothing for a provider without an onboarding record", () => {
    const effects = complianceEffects(status({ onboarding_status: null, matching_allowed: false }));
    expect(effects.matching).toContain("has not moved your account");
    expect(effects.payout).toBeNull();
  });
});

describe("ordering and labels", () => {
  it("puts expired and missing items first", () => {
    const ordered = complianceAttentionOrder([
      item({ kind: "identity" }), item({ kind: "insurance", state: "expiring" }), item({ kind: "agreement", state: "missing" }),
      item({ kind: "license", state: "exception" }), item({ kind: "bank_authorization", state: "expired" }),
    ]);
    expect(ordered.map(entry => entry.kind)).toEqual(["bank_authorization", "agreement", "license", "insurance", "identity"]);
  });

  it("uses the renewal document names for license and insurance", () => {
    expect(complianceItemLabel("license")).toBe("License or business tax receipt");
    expect(complianceItemLabel("bank_authorization")).toBe("Payout onboarding");
  });
});
