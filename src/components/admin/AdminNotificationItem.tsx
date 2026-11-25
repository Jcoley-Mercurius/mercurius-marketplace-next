import type { Ref } from "react";
import { Bell, CircleCheck, FileText, Gavel, LifeBuoy, Loader2, RefreshCcw } from "lucide-react";
import type { AppNotification } from "@/hooks/useNotifications";
import type { AdminNoticeCategory, AdminNoticePresentation } from "@/lib/adminNotificationPresentation";
import { formatRecordedAt } from "@/components/vendor/VendorNotificationItem";
import { cn } from "@/lib/utils";

// Phase 7.5E / TRACE-159. One in-app notice addressed to the signed-in operator: the stored title and
// body as text (adminNotificationPresentation), "Unread" as text, the Eastern recording time and where
// it opens. Same structure and contrast choices as the 7.2B vendor row.

const icons: Record<AdminNoticeCategory, typeof Bell> = {
  support: LifeBuoy,
  dispute: Gavel,
  application: FileText,
  completion: CircleCheck,
  service: RefreshCcw,
  general: Bell,
};

export function AdminNotificationItem({ notification, presentation, destinationLabel, busy, onOpen, ref }: {
  notification: AppNotification;
  presentation: AdminNoticePresentation;
  destinationLabel: string;
  busy: boolean;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const unread = !notification.read_at;
  const Icon = icons[presentation.category];
  const titleId = `admin-notice-${notification.id}-title`;
  const detailId = `admin-notice-${notification.id}-detail`;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => { if (!busy) onOpen(); }}
      aria-disabled={busy || undefined}
      aria-labelledby={titleId}
      aria-describedby={detailId}
      data-notification-id={notification.id}
      className={cn(
        "flex min-h-11 w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring aria-disabled:cursor-wait sm:px-5",
        unread && "bg-accent-subtle/60",
      )}
    >
      <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-commitment">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span id={titleId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("min-w-0 text-sm leading-5 break-words", unread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
            {presentation.title}
          </span>
          {unread && (
            <span className="rounded-full border border-accent-border bg-background px-2 py-0.5 text-xs font-semibold text-commitment">
              Unread
            </span>
          )}
        </span>
        <span id={detailId} className="block">
          {presentation.body && <span className="mt-1 block text-sm leading-5 break-words text-slate">{presentation.body}</span>}
          <span className="mt-2 block text-xs text-slate">
            Recorded <time dateTime={notification.created_at}>{formatRecordedAt(notification.created_at)}</time>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">. </span>
            Opens {destinationLabel}
          </span>
        </span>
      </span>
    </button>
  );
}
