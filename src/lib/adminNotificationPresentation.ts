// Phase 7.5E / TRACE-159: how the admin page shows an in-app notice addressed to the signed-in
// operator.
//
// Unlike the vendor page (DEC-2026-065 item 2, controlled wording), the operator sees the stored title
// and body as recorded: the row is addressed to them, the same text is already readable to every admin
// under RLS, and the queues show the underlying reasons anyway. It is shown as text only (React
// escapes it; nothing is parsed as HTML or turned into a link), trimmed, with runs of whitespace
// collapsed, and bounded so a historical or hand-inserted row cannot flood the list. A blank title
// falls back to fixed wording. Severity is not shown: it is the producer's label, not an approved
// priority or SLA. The row's own link is never shown; the destination comes from
// notificationDestination(row, "admin").

export type AdminNoticeCategory = "support" | "dispute" | "application" | "completion" | "service" | "general";

export type AdminNoticePresentation = {
  category: AdminNoticeCategory;
  title: string;
  body: string | null;
};

export const ADMIN_NOTICE_TITLE_LIMIT = 200;
export const ADMIN_NOTICE_BODY_LIMIT = 600;
export const ADMIN_NOTICE_FALLBACK_TITLE = "Notice recorded";

// Types the 14 admin producers write (record §2). Anything else is "general".
const CATEGORIES: ReadonlyMap<string, AdminNoticeCategory> = new Map([
  ["support", "support"],
  ["dispute", "dispute"],
  ["vendor_application", "application"],
  ["job_confirmation", "completion"],
  ["job_status", "service"],
]);

function clean(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  // Control characters become spaces; whitespace runs collapse.
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("").trimEnd()}…` : text;
}

export function presentAdminNotification(row: { type: unknown; title: unknown; body: unknown }): AdminNoticePresentation {
  const category = typeof row.type === "string" ? CATEGORIES.get(row.type) ?? "general" : "general";
  return {
    category,
    title: clean(row.title, ADMIN_NOTICE_TITLE_LIMIT) ?? ADMIN_NOTICE_FALLBACK_TITLE,
    body: clean(row.body, ADMIN_NOTICE_BODY_LIMIT),
  };
}
