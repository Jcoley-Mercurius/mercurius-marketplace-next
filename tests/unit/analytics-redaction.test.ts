import { describe, expect, it } from "vitest";
import { redactAnalyticsEvent, redactAnalyticsUrl } from "@/lib/analyticsRedaction";
import { invitationSetPasswordPath } from "@/lib/invitationOpenLink";

const site = "https://www.mercuriusmarketplace.com";
const invitation = "0b9d6a3e-5f1c-4c7e-9a2d-3e8f6b1c2d4a";

describe("TRACE-139 analytics URL redaction", () => {
  it("drops the invitation open key", () => {
    expect(redactAnalyticsUrl(`${site}/invitation/open?invitation=${invitation}&kind=existing_provider&key=SECRETKEY123`))
      .toBe(`${site}/invitation/open`);
  });

  it("drops the minted set-password token hash", () => {
    const path = invitationSetPasswordPath({ attempt: invitation, source: "application", key: "k" }, "TOKENHASH");
    const redacted = redactAnalyticsUrl(`${site}${path}`)!;
    expect(redacted).toBe(`${site}/set-password`);
    expect(redacted).not.toContain("TOKENHASH");
  });

  it("drops Auth codes, errors and fragment session tokens", () => {
    expect(redactAnalyticsUrl(`${site}/set-password?code=abc&error_description=Expired#access_token=AT&refresh_token=RT&type=recovery`))
      .toBe(`${site}/set-password`);
    expect(redactAnalyticsUrl(`${site}/vendor/profile#password`)).toBe(`${site}/vendor/profile`);
  });

  it("drops portal and login parameters", () => {
    expect(redactAnalyticsUrl(`${site}/login?redirect=%2Fadmin%2Fvendors%3Fq%3Dx`)).toBe(`${site}/login`);
    expect(redactAnalyticsUrl(`${site}/dashboard?tab=jobs&job=${invitation}&paid=1`)).toBe(`${site}/dashboard`);
  });

  it("keeps campaign tags only", () => {
    expect(redactAnalyticsUrl(`${site}/early-access?utm_source=flyer&service=lawn&utm_campaign=fall&utm_source_id=x`))
      .toBe(`${site}/early-access?utm_source=flyer&utm_campaign=fall`);
  });

  it("drops an event whose URL cannot be parsed", () => {
    expect(redactAnalyticsEvent({ type: "pageview", url: "not a url" })).toBeNull();
    expect(redactAnalyticsEvent({ type: "event", url: `${site}/set-password?token_hash=T` }))
      .toEqual({ type: "event", url: `${site}/set-password` });
  });
});
