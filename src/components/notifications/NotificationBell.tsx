import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationBell({
  unreadCount,
  loading,
  unavailable = false,
  className,
}: {
  unreadCount: number;
  loading: boolean;
  unavailable?: boolean;
  className?: string;
}) {
  const label = unavailable
    ? "Notifications unavailable"
    : unreadCount > 0
      ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
      : "Notifications";

  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Bell className="h-5 w-5" />
      )}
      {!loading && unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground shadow-sm">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
