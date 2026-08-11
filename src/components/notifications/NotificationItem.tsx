import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
} from "lucide-react";
import type { AppNotification } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const severityIcon: Record<string, typeof Bell> = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const severityTone: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  warning:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  success: "bg-sage-light text-sage-dark",
  info: "bg-accent-soft text-accent",
};

export function NotificationItem({
  notification,
  onSelect,
}: {
  notification: AppNotification;
  onSelect: (notification: AppNotification) => void;
}) {
  const Icon = severityIcon[notification.severity] ?? Bell;
  const unread = !notification.read_at;

  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      className={cn(
        "flex w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring sm:px-5",
        unread && "bg-accent-subtle/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          severityTone[notification.severity] ?? severityTone.info,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span
            className={cn(
              "text-sm leading-5",
              unread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/80",
            )}
          >
            {notification.title}
          </span>
          {unread && (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
          )}
        </span>
        {notification.body && (
          <span className="mt-1 block text-sm leading-5 text-muted-foreground">
            {notification.body}
          </span>
        )}
        <span
          suppressHydrationWarning
          className="mt-2 block text-xs text-muted-foreground/80"
        >
          {formatRelativeTime(notification.created_at)}
        </span>
      </span>
    </button>
  );
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const intervals: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, secondsPerUnit] of intervals) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
  return "just now";
}
