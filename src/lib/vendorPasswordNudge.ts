import type { User } from "@supabase/supabase-js";

/** Set after an invited account chooses a password through a Mercurius flow. */
export const PASSWORD_SET_BY_USER_KEY = "password_set_by_user";

/** A nudge dismissal intentionally lasts for this browser session only. */
export const PASSWORD_NUDGE_DISMISS_KEY = "mercurius_pwd_nudge_dismissed";

export function shouldShowVendorPasswordNudge(
  user: User | null | undefined,
): boolean {
  if (!user || !user.invited_at) return false;
  if (user.user_metadata?.[PASSWORD_SET_BY_USER_KEY] === true) return false;

  try {
    return sessionStorage.getItem(PASSWORD_NUDGE_DISMISS_KEY) !== "1";
  } catch {
    return true;
  }
}

export function dismissVendorPasswordNudgeForSession() {
  try {
    sessionStorage.setItem(PASSWORD_NUDGE_DISMISS_KEY, "1");
  } catch {
    // Storage can be unavailable in private browsing; the nudge remains harmless.
  }
}

export function clearVendorPasswordNudgeDismissal() {
  try {
    sessionStorage.removeItem(PASSWORD_NUDGE_DISMISS_KEY);
  } catch {
    // Persisted auth metadata remains authoritative when storage is unavailable.
  }
}
