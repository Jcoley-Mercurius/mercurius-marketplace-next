import { describe, expect, it } from "vitest";
import { Constants } from "./supabase/database.types";
import { adminTransitionTargets, canonicalRequestState, cancellationPolicy, reschedulingPolicy } from "./lifecycle";

describe("lifecycle compatibility and policy contract", () => {
  it("maps every stored state without manufacturing an unknown success state", () => {
    for (const status of Constants.public.Enums.request_status) expect(canonicalRequestState(status)).toBeTruthy();
    expect(canonicalRequestState("pending", "sourcing")).toBe("unavailable");
    expect(canonicalRequestState("pending", "exhausted")).toBe("unavailable");
    expect(canonicalRequestState("matched", "offered")).toBe("matching");
    expect(canonicalRequestState("matched", "matched")).toBe("provider_confirmed");
    expect(canonicalRequestState("vendor_completed")).toBe("completion_pending");
  });
  it("never offers admin impersonation or resurrection actions", () => {
    for (const status of Constants.public.Enums.request_status) expect(adminTransitionTargets(status)).not.toContain("homeowner_confirmed");
    expect(adminTransitionTargets("cancelled")).toEqual([]);
    expect(adminTransitionTargets("closed")).toEqual([]);
    expect(adminTransitionTargets("unknown")).toEqual([]);
  });
  const appointment = "2026-11-02T17:00:00Z";
  const at = (hours: number) => new Date(Date.parse(appointment) - hours * 3_600_000).toISOString();
  it.each([[72,100],[71.999,50],[24,50],[23.999,0],[0,0]])("cancellation at %s hours has %s percent policy outcome", (hours, percent) => {
    expect(cancellationPolicy(appointment,at(hours)).refundPercent).toBe(percent);
  });
  it.each([[48,0,false],[47.999,25,false],[24,25,false],[23.999,null,true]])("rescheduling at %s hours",(hours,fee,review) => {
    expect(reschedulingPolicy(appointment,at(hours as number))).toMatchObject({fee,requiresOperations:review});
  });
  it("accepted emergencies waive penalties without guaranteeing short-notice rescheduling", () => {
    expect(cancellationPolicy(appointment,at(1),true).refundPercent).toBe(100);
    expect(reschedulingPolicy(appointment,at(1),true)).toMatchObject({fee:0,requiresOperations:true});
  });
  it("uses elapsed time across Eastern DST rather than calendar day arithmetic", () => {
    expect(cancellationPolicy("2026-11-02T12:00:00-05:00","2026-10-30T13:00:00-04:00").refundPercent).toBe(100);
  });
  it("fails on missing or invalid appointment data", () => {
    expect(() => cancellationPolicy("",at(1))).toThrow();
    expect(() => reschedulingPolicy(appointment,"invalid")).toThrow();
  });
});
