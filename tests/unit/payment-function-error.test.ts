import { describe, expect, it } from "vitest";
import { paymentFunctionError } from "../../src/lib/payments";

// Supabase's FunctionsHttpError carries the fetch Response as its context.
const httpError = (context: unknown) => Object.assign(new Error("Edge Function returned a non-2xx status code"), { context });

describe("paymentFunctionError", () => {
  it("reads the structured code and message from an Edge Function Response", async () => {
    const response = Response.json({ error: "MONEY_NOT_ACTIVATED", message: "Refund execution is awaiting verification." }, { status: 503 });
    expect(await paymentFunctionError(httpError(response))).toEqual({
      code: "MONEY_NOT_ACTIVATED",
      message: "Refund execution is awaiting verification.",
    });
  });

  it("leaves the Response readable for the caller", async () => {
    const response = Response.json({ error: "REFUND_NOT_SENT" }, { status: 409 });
    await paymentFunctionError(httpError(response));
    expect(response.bodyUsed).toBe(false);
    expect(await response.json()).toEqual({ error: "REFUND_NOT_SENT" });
  });

  it("uses the code as the message when the Response has no message", async () => {
    expect(await paymentFunctionError(httpError(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }))))
      .toEqual({ code: "UNAUTHORIZED", message: "UNAUTHORIZED" });
  });

  it("falls back to the client error when the Response is not JSON", async () => {
    expect(await paymentFunctionError(httpError(new Response("Bad gateway", { status: 502 }))))
      .toEqual({ message: "Edge Function returned a non-2xx status code" });
  });

  it("still reads a plain string or object body", async () => {
    expect(await paymentFunctionError(httpError({ body: JSON.stringify({ error: "CHECKOUT_EXPIRED", message: "Start again." }) })))
      .toEqual({ code: "CHECKOUT_EXPIRED", message: "Start again." });
    expect(await paymentFunctionError(httpError({ body: { error: "CHECKOUT_EXPIRED" } })))
      .toEqual({ code: "CHECKOUT_EXPIRED", message: "CHECKOUT_EXPIRED" });
  });

  it("describes an error that is not an Error", async () => {
    expect(await paymentFunctionError("offline")).toEqual({ message: "The secure payment service could not be reached." });
  });
});
