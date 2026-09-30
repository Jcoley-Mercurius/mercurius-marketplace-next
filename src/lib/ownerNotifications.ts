import "server-only";

import { getOwnerNotificationEnvironment } from "@/lib/env/server";

// Owner-confirmed fallback recipient (TRACE-104). OWNER_NOTIFICATION_EMAIL overrides it.
const DEFAULT_OWNER_EMAIL = "jcoley@mercuriusmarketplace.com";
const RESEND_TIMEOUT_MS = 10_000;

type OwnerNotification = {
  subject: string;
  text: string;
  replyTo?: string | null;
  // Resend replays the first result for a repeated key instead of sending again.
  idempotencyKey?: string;
};

// `definite` is true when Resend answered with a refusal, or nothing was attempted. A
// timeout or network error is not definite: the email may still have been accepted.
export type NotificationResult =
  | { ok: true; id: string | null }
  | { ok: false; definite: boolean; error: string };

export async function sendOwnerNotification(
  notification: OwnerNotification,
): Promise<NotificationResult> {
  let environment: ReturnType<typeof getOwnerNotificationEnvironment>;
  try {
    environment = getOwnerNotificationEnvironment();
  } catch (error) {
    return {
      ok: false,
      definite: true,
      error:
        error instanceof Error
          ? error.message
          : "Owner notifications are not configured.",
    };
  }
  const { apiKey, from } = environment;
  const to = environment.to || DEFAULT_OWNER_EMAIL;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(notification.idempotencyKey
          ? { "Idempotency-Key": notification.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: notification.subject,
        text: notification.text,
        ...(notification.replyTo ? { reply_to: notification.replyTo } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return {
        ok: false,
        // A server error, or a 409 for a concurrent request with the same idempotency key,
        // may follow an accepted email; any other 4xx refusal sent nothing.
        definite: response.status < 500 && response.status !== 409,
        error: `Resend returned ${response.status}${detail ? `: ${detail}` : "."}`,
      };
    }

    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { ok: true, id: typeof body?.id === "string" ? body.id : null };
  } catch (error) {
    return {
      ok: false,
      definite: false,
      error: error instanceof Error ? error.message : "Unknown email delivery error.",
    };
  }
}
