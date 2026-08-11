import "server-only";

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
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const to = process.env.OWNER_NOTIFICATION_EMAIL?.trim() || DEFAULT_OWNER_EMAIL;

  if (!apiKey || !from) {
    return {
      ok: false,
      error: "RESEND_API_KEY and RESEND_FROM_EMAIL must be configured.",
    };
  }

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

