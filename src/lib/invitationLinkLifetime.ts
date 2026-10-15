// DEC-2026-029: provider invitations default to 7 days. The Supabase Auth email link lasts
// 24 hours, the most hosted Auth allows (otp_expiry is capped at 86400 s), up from 3 hours.
// A Mercurius-owned link valid for the whole invitation is the follow-up that matches them.
// Mirrors supabase/config.toml [auth.email] otp_expiry = 86400 and
// private.provider_invitation_link_lifetime() (migration 20261013001000).
export const INVITATION_DEFAULT_EXPIRY_DAYS = 7;
export const AUTH_INVITATION_LINK_HOURS = 24;

const DAY_MS = 86_400_000;

/** The default invitation expiry as a datetime-local value: 7 days from now, to the minute. */
export function defaultInvitationExpiryLocal(now: Date = new Date()): string {
  const expiry = new Date(now.getTime() + INVITATION_DEFAULT_EXPIRY_DAYS * DAY_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}T${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`;
}
