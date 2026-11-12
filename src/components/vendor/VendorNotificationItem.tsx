import type { Ref } from "react";
import { Bell, Briefcase, CalendarClock, CircleCheck, DollarSign, FileText, LifeBuoy, Loader2, RefreshCcw, Users, XCircle } from "lucide-react";
import type { AppNotification } from "@/hooks/useNotifications";
import type { VendorNoticeCategory, VendorNoticePresentation } from "@/lib/vendorNotificationPresentation";
import { cn } from "@/lib/utils";

// Phase 7.2B / TRACE-153. Renders only the controlled presentation and the row's own timestamp and
// read state. The stored title, body and severity are never shown (DEC-2026-065 item 2).

const icons: Record<VendorNoticeCategory, typeof Bell> = {
  offer: Briefcase,
  quote: FileText,
  terms: FileText,
  appointment: CalendarClock,
  service: RefreshCcw,
  completion: CircleCheck,
  cancellation: XCircle,
  replacement: Users,
  pricing: DollarSign,
  support: LifeBuoy,
  general: Bell,
};

const recordedAt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatRecordedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${recordedAt.format(date)} ET` : "Date unavailable";
}

export function VendorNotificationItem({ notification, presentation, destinationLabel, busy, onOpen, ref }: {
  notification: AppNotification;
  presentation: VendorNoticePresentation;
  destinationLabel: string;
  busy: boolean;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const unread = !notification.read_at;
  const Icon = icons[presentation.category];
  const titleId = `notice-${notification.id}-title`;
  const detailId = `notice-${notification.id}-detail`;

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
          <span className={cn("text-sm leading-5 break-words", unread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
            {presentation.title}
          </span>
          {unread && (
            <span className="rounded-full border border-accent-border bg-background px-2 py-0.5 text-xs font-semibold text-commitment">
              Unread
            </span>
          )}
        </span>
        <span id={detailId} className="block">
          <span className="mt-1 block text-sm leading-5 break-words text-slate">{presentation.description}</span>
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
