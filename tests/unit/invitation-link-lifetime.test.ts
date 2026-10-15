import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AUTH_INVITATION_LINK_HOURS,
  INVITATION_DEFAULT_EXPIRY_DAYS,
  defaultInvitationExpiryLocal,
} from "../../src/lib/invitationLinkLifetime";

// TRACE-071 / DEC-2026-029: invitations default to 7 days; the Auth email link lasts 24 hours.
describe("invitation link lifetime", () => {
  it("keeps the Auth link at the hosted 24-hour maximum, matching supabase/config.toml", () => {
    expect(AUTH_INVITATION_LINK_HOURS).toBe(24);
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toMatch(new RegExp(`^otp_expiry = ${AUTH_INVITATION_LINK_HOURS * 3_600}$`, "m"));
    // Hosted Auth refuses an email OTP/link expiry above 86400 seconds.
    expect(AUTH_INVITATION_LINK_HOURS * 3_600).toBeLessThanOrEqual(86_400);
  });

  it("defaults the invitation expiry to 7 days from now, as a local datetime", () => {
    expect(INVITATION_DEFAULT_EXPIRY_DAYS).toBe(7);
    expect(defaultInvitationExpiryLocal(new Date(2026, 9, 13, 14, 24, 37))).toBe("2026-10-20T14:24");
    expect(defaultInvitationExpiryLocal(new Date(2026, 11, 28, 9, 5))).toBe("2027-01-04T09:05");
  });
});
