// Codex review of TRACE-098 at 634837a. Synthetic readbacks only.
// These acceptance assertions intentionally fail on the reviewed implementation.
// Run with the explicit config shown in PHASE-6-INTAKE-REVIEW.md.
import { it, expect } from "vitest";
import { describeConfirmation } from "../../src/lib/requestConfirmation";

for (const [stored, expected] of [
  ["cancelled", "cancelled"], ["scheduled", "scheduled"],
  ["in_progress", "in_progress"], ["homeowner_confirmed", "completed"],
] as const) {
  it(`saved intake must show current ${stored} state`, () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const result = describeConfirmation({
      requests: [{ selection_index: 0, request_id: id, service_id: "lawn-mowing",
        pricing_mode: "fixed", quote_only: false, total_amount: 100,
        package_id: null, package_tier_id: null }],
      serviceNames: { "lawn-mowing": "Synthetic lawn service" }, preferredProviderNames: {},
      readback: [{ id, status: stored, matching_status: "matched", pricing_mode: "fixed",
        total_amount: 100, contractor_id: "00000000-0000-4000-8000-000000000002",
        payment_status: "captured" }],
      matching: {}, checkout: { kind: "pending" }, formatMoney: String,
    });
    expect(result[0].status).toBe(expected);
  });
}
