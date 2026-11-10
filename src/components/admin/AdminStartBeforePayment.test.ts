import { describe, expect, it } from "vitest";
import { canOfferOneTimeStartException } from "./AdminStartBeforePayment";

// CS-5 one-time extension: operations are offered the recorded payment exception only on an accepted,
// scheduled one-time job. The server still decides whether the payment state allows it.
describe("start before payment (one-time jobs)", () => {
  const job = { status: "scheduled", matching_status: "matched", frequency: "one-time", recurrence_parent_id: null };

  it("is offered on an accepted, scheduled one-time job", () => {
    expect(canOfferOneTimeStartException(job)).toBe(true);
    expect(canOfferOneTimeStartException({ ...job, frequency: null })).toBe(true);
  });

  it("is not offered on recurring visits, plans, or jobs not waiting to start", () => {
    expect(canOfferOneTimeStartException({ ...job, recurrence_parent_id: "00000000-0000-4000-8000-000000000001" })).toBe(false);
    expect(canOfferOneTimeStartException({ ...job, frequency: "weekly" })).toBe(false);
    expect(canOfferOneTimeStartException({ ...job, status: "in_progress" })).toBe(false);
    expect(canOfferOneTimeStartException({ ...job, matching_status: "offered" })).toBe(false);
  });
});
