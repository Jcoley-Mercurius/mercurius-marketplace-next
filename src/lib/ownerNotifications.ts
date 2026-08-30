import "server-only";

import { getOwnerNotificationEnvironment } from "@/lib/env/server";

const DEFAULT_OWNER_EMAIL = "j.coley@mercuriusmarketplace.com";

type OwnerNotification = {
  subject: string;
  text: string;
  replyTo?: string | null;
};

type NotificationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendOwnerNotification(
  notification: OwnerNotification,
): Promise<NotificationResult> {
  let environment: ReturnType<typeof getOwnerNotificationEnvironment>;
  try {
    environment = getOwnerNotificationEnvironment();
  } catch (error) {
    return {
      ok: false,
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
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: notification.subject,
        text: notification.text,
        ...(notification.replyTo ? { reply_to: notification.replyTo } : {}),
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      return {
        ok: false,
        error: `Resend returned ${response.status}${detail ? `: ${detail}` : "."}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown email delivery error.",
    };
  }
}

