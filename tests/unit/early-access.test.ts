import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BOUNDARY_MESSAGE,
  EarlyAccessValidationError,
  manageEarlyAccess,
  parseEarlyAccessSubmission,
  submitEarlyAccess,
  unsubscribeMarketing,
} from "../../src/lib/earlyAccess";
import { MIN_FILL_MS, INTAKE_REFUSAL_MESSAGE } from "../../src/lib/intakeProtection";

// TRACE-102. Synthetic addresses only.
const guard = { trap: "", elapsedMs: MIN_FILL_MS };
const valid = {
  kind: "early_access",
  email: " Someone@Example.TEST ",
  zip_code: "33901",
  service_ids: ["lawn-mowing", "lawn-mowing", "carpet-cleaning"],
  still_exploring: false,
  marketing_opt_in: false,
  intake: guard,
};
const token = "a".repeat(64);

type Rpc = (name: string, params: Record<string, unknown>) => { data: unknown; error: unknown };
function fakeClient(handler: Rpc) {
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => handler(name, params));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}
function database(overrides: Partial<Record<string, unknown>> = {}) {
  return fakeClient((name) => {
    if (name in overrides) return { data: overrides[name], error: null };
    if (name === "r0_zip_in_lee") return { data: true, error: null };
    if (name === "intake_record_submission") return { data: "accepted", error: null };
    if (name === "r0_submit_interest") return { data: { outcome: "saved" }, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
}

describe("parseEarlyAccessSubmission", () => {
  it("normalizes email and deduplicates and sorts services", () => {
    expect(parseEarlyAccessSubmission(valid)).toEqual({
      kind: "early_access",
      email: "someone@example.test",
      firstName: null,
      zipCode: "33901",
      serviceIds: ["carpet-cleaning", "lawn-mowing"],
      stillExploring: false,
      marketingOptIn: false,
    });
  });

  it("accepts still exploring with no services and trims an optional first name", () => {
    const parsed = parseEarlyAccessSubmission({
      ...valid,
      service_ids: [],
      still_exploring: true,
      first_name: "  Pat ",
    });
    expect(parsed.stillExploring).toBe(true);
    expect(parsed.firstName).toBe("Pat");
  });

  it.each(["phone", "address", "street", "photos", "payment_method", "sms_consent"])(
    "refuses the uncollected field %s",
    (field) => {
      expect(() => parseEarlyAccessSubmission({ ...valid, [field]: "x" })).toThrow(
        EarlyAccessValidationError,
      );
    },
  );

  it("requires services xor still exploring", () => {
    expect(() => parseEarlyAccessSubmission({ ...valid, still_exploring: true })).toThrow(
      "Choose services of interest or still exploring.",
    );
    expect(() => parseEarlyAccessSubmission({ ...valid, service_ids: [] })).toThrow(
      "Choose services of interest or still exploring.",
    );
  });

  it("requires an explicit marketing choice and never infers consent", () => {
    const withoutChoice: Record<string, unknown> = { ...valid };
    delete withoutChoice.marketing_opt_in;
    expect(() => parseEarlyAccessSubmission(withoutChoice)).toThrow("The marketing choice is missing.");
    expect(() => parseEarlyAccessSubmission({ ...valid, marketing_opt_in: "true" })).toThrow(
      "The marketing choice is missing.",
    );
  });

  it("validates kind, email, ZIP, first name and service identifiers", () => {
    expect(() => parseEarlyAccessSubmission({ ...valid, kind: "vendor" })).toThrow(EarlyAccessValidationError);
    expect(() => parseEarlyAccessSubmission({ ...valid, email: "not-an-email" })).toThrow(EarlyAccessValidationError);
    expect(() => parseEarlyAccessSubmission({ ...valid, zip_code: "33901-1234" })).toThrow(EarlyAccessValidationError);
    expect(() => parseEarlyAccessSubmission({ ...valid, first_name: "x".repeat(101) })).toThrow(EarlyAccessValidationError);
    expect(() => parseEarlyAccessSubmission({ ...valid, service_ids: ["Lawn Mowing"] })).toThrow(EarlyAccessValidationError);
    expect(() =>
      parseEarlyAccessSubmission({ ...valid, service_ids: Array.from({ length: 31 }, (_, i) => `s${i}`) }),
    ).toThrow(EarlyAccessValidationError);
    expect(() => parseEarlyAccessSubmission([valid])).toThrow(EarlyAccessValidationError);
  });
});

describe("submitEarlyAccess", () => {
  it("saves through the rate limit and the database command", async () => {
    const { client, rpc } = database();
    const result = await submitEarlyAccess(client, valid, "192.0.2.1");
    expect(result).toEqual({ status: 201, body: { outcome: "saved", kind: "early_access" } });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "r0_zip_in_lee",
      "intake_record_submission",
      "r0_submit_interest",
    ]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_form: "early_access" });
    expect(rpc.mock.calls[2][1]).toEqual({
      p_kind: "early_access",
      p_email: "someone@example.test",
      p_first_name: null,
      p_zip: "33901",
      p_service_ids: ["carpet-cleaning", "lawn-mowing"],
      p_still_exploring: false,
      p_marketing: false,
    });
  });

  it("refuses the honeypot and a too-fast form without touching the database", async () => {
    const { client, rpc } = database();
    for (const intake of [{ trap: "bot", elapsedMs: 60_000 }, { trap: "", elapsedMs: 10 }]) {
      const result = await submitEarlyAccess(client, { ...valid, intake }, null);
      expect(result).toEqual({ status: 429, body: { error: INTAKE_REFUSAL_MESSAGE } });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the Lee boundary honestly before spending a limit slot", async () => {
    const { client, rpc } = database({ r0_zip_in_lee: false });
    const result = await submitEarlyAccess(client, { ...valid, zip_code: "10001" }, null);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ outcome: "boundary", error: BOUNDARY_MESSAGE.early_access });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["r0_zip_in_lee"]);
  });

  it("sends a Lee ZIP on the expansion path back to early access", async () => {
    const { client } = database();
    const result = await submitEarlyAccess(client, { ...valid, kind: "expansion" }, null);
    expect(result.body).toMatchObject({ outcome: "boundary", error: BOUNDARY_MESSAGE.expansion });
  });

  it("returns the same refusal for either limit", async () => {
    for (const limit of ["email_limit", "ip_limit"]) {
      const { client, rpc } = database({ intake_record_submission: limit });
      const result = await submitEarlyAccess(client, valid, "192.0.2.1");
      expect(result).toEqual({ status: 429, body: { error: INTAKE_REFUSAL_MESSAGE } });
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain("r0_submit_interest");
    }
  });

  it("maps database validation to a generic 400 and rethrows other errors", async () => {
    const invalid = fakeClient((name) =>
      name === "r0_submit_interest"
        ? { data: null, error: { code: "22023", message: "Choose services from the current catalog." } }
        : { data: name === "r0_zip_in_lee" ? true : "accepted", error: null },
    );
    expect(await submitEarlyAccess(invalid.client, valid, null)).toEqual({
      status: 400,
      body: { error: "Check the form and try again." },
    });
    const broken = fakeClient((name) =>
      name === "r0_submit_interest"
        ? { data: null, error: { code: "XX000", message: "down" } }
        : { data: name === "r0_zip_in_lee" ? true : "accepted", error: null },
    );
    await expect(submitEarlyAccess(broken.client, valid, null)).rejects.toMatchObject({ code: "XX000" });
  });
});

describe("manageEarlyAccess", () => {
  it("gives one generic answer for a malformed, unknown or withdrawn link", async () => {
    const { client, rpc } = fakeClient(() => ({ data: { outcome: "invalid" }, error: null }));
    const invalid = { status: 404, body: { error: "This link is invalid or has expired." } };
    expect(await manageEarlyAccess(client, { token: "short", action: "read" })).toEqual(invalid);
    expect(await manageEarlyAccess(client, { token, action: "delete" })).toEqual(invalid);
    expect(rpc).not.toHaveBeenCalled();
    expect(await manageEarlyAccess(client, { token, action: "read" })).toEqual(invalid);
  });

  it("updates with validated content only", async () => {
    const { client, rpc } = fakeClient(() => ({ data: { outcome: "updated", interest: { zip_code: "33908" } }, error: null }));
    const result = await manageEarlyAccess(client, {
      token,
      action: "update",
      zip_code: "33908",
      service_ids: [],
      still_exploring: true,
    });
    expect(result).toEqual({ status: 200, body: { outcome: "updated", interest: { zip_code: "33908" } } });
    expect(rpc).toHaveBeenCalledWith("r0_manage_interest", {
      p_token: token,
      p_action: "update",
      p_first_name: null,
      p_zip: "33908",
      p_service_ids: [],
      p_still_exploring: true,
    });
    expect(await manageEarlyAccess(client, { token, action: "update", zip_code: "33908", phone: "x" })).toMatchObject({ status: 400 });
  });

  it("reports a held withdrawal as withdrawn", async () => {
    const { client } = fakeClient(() => ({ data: { outcome: "withdrawn_held" }, error: null }));
    expect(await manageEarlyAccess(client, { token, action: "withdraw" })).toEqual({
      status: 200,
      body: { outcome: "withdrawn" },
    });
  });
});

describe("unsubscribeMarketing", () => {
  it("unsubscribes a valid token and refuses anything else without a lookup", async () => {
    const { client, rpc } = fakeClient(() => ({ data: { outcome: "unsubscribed" }, error: null }));
    expect(await unsubscribeMarketing(client, token)).toEqual({ status: 200, body: { outcome: "unsubscribed" } });
    expect(await unsubscribeMarketing(client, null)).toMatchObject({ status: 404 });
    expect(await unsubscribeMarketing(client, "zz")).toMatchObject({ status: 404 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
