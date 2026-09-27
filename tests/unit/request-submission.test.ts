import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_IN_AREA,
  isSubmissionKey,
  isSubmissionKeyConflict,
  newSubmissionKey,
  parseSubmissionResult,
  refusalMessage,
  submissionValidationMessage,
  type SelectionResult,
} from "../../src/lib/requestSubmission";

const money = (value: number) => `$${value.toFixed(2)}`;
const outcome = (value: Partial<SelectionResult>): SelectionResult => ({ selection_index: 0, service_id: "lawn-mowing", outcome: "unavailable", ...value });
const request = { selection_index: 0, request_id: "00000000-0000-4000-8000-000000000001", service_id: "lawn-mowing", pricing_mode: "fixed", quote_only: false, total_amount: 100, package_id: null, package_tier_id: null };

describe("request submission keys", () => {
  it("creates keys the database accepts", () => {
    const key = newSubmissionKey();
    expect(isSubmissionKey(key)).toBe(true);
    expect(newSubmissionKey()).not.toBe(key);
  });
  it.each([undefined, null, "", "short", "has spaces in it here", "x".repeat(129), 42])("rejects %j", (value) => {
    expect(isSubmissionKey(value)).toBe(false);
  });
});

describe("submission responses", () => {
  it("accepts a submitted plan and normalizes reuse", () => {
    const result = parseSubmissionResult({ status: "submitted", coverage: "covered", outcomes: [outcome({ outcome: "eligible_fixed" })], requests: [request] });
    expect(result.reused).toBe(false);
    expect(result.requests[0].request_id).toBe(request.request_id);
  });
  it("accepts a refusal with no requests", () => {
    expect(parseSubmissionResult({ status: "refused", coverage: "uncovered", outcomes: [], requests: [], reused: false }).status).toBe("refused");
  });
  it.each([
    null,
    {},
    { status: "ok", coverage: "covered", outcomes: [], requests: [] },
    { status: "submitted", coverage: "covered", outcomes: [], requests: [] },
    { status: "refused", coverage: "somewhere", outcomes: [], requests: [] },
    { status: "refused", coverage: "covered", outcomes: [{ service_id: "x", outcome: "maybe" }], requests: [] },
    { status: "submitted", coverage: "covered", outcomes: [], requests: [{ service_id: "x" }] },
  ])("treats %j as a verification error", (value) => {
    expect(() => parseSubmissionResult(value)).toThrow("unexpected response");
  });
});

describe("submission errors", () => {
  it("recognizes a key reused with different details", () => {
    expect(isSubmissionKeyConflict({ code: "22023", message: "Submission key reused with a different request" })).toBe(true);
    expect(isSubmissionKeyConflict({ code: "22023", message: "Enter a valid five-digit ZIP code" })).toBe(false);
    expect(isSubmissionKeyConflict({ code: "42501", message: "Submission key reused" })).toBe(false);
  });
  it("shows only homeowner-facing validation messages", () => {
    expect(submissionValidationMessage({ code: "22023", message: "Enter a valid five-digit ZIP code" })).toBe("Enter a valid five-digit ZIP code");
    expect(submissionValidationMessage({ code: "42501", message: "permission denied" })).toBeNull();
    expect(submissionValidationMessage(new Error("network"))).toBeNull();
  });
});

describe("refusal copy", () => {
  it("uses the approved unavailable wording", () => {
    expect(refusalMessage(outcome({}), "Lawn Care", money)).toBe(`Lawn Care: ${UNAVAILABLE_IN_AREA}`);
    expect(UNAVAILABLE_IN_AREA).toBe("Not available yet in your area.");
  });
  it("explains nothing for eligible selections", () => {
    expect(refusalMessage(outcome({ outcome: "eligible_fixed" }), "Lawn Care", money)).toBeNull();
    expect(refusalMessage(outcome({ outcome: "eligible_quote" }), "Lawn Care", money)).toBeNull();
  });
  it("shows the server's current price or quote requirement", () => {
    expect(refusalMessage(outcome({ outcome: "price_changed", pricing_mode: "fixed", total: 100 }), "Lawn Care", money))
      .toBe("Lawn Care: the current price for this address is $100.00. Review it, then submit again.");
    expect(refusalMessage(outcome({ outcome: "price_changed", pricing_mode: "quote", total: null }), "Lawn Care", money))
      .toBe("Lawn Care: this service needs a quote at this address. Review it, then submit again.");
  });
  it.each(["invalid_provider", "preferred_provider_unavailable", "invalid_package", "package_unavailable", "answers_required"] as const)
    ("explains %s without implying a booking", (value) => {
      const message = refusalMessage(outcome({ outcome: value }), "Lawn Care", money)!;
      expect(message.startsWith("Lawn Care: ")).toBe(true);
      expect(message).not.toMatch(/booked|assigned|scheduled|sourcing/i);
    });
});
