"use client";

// Phase 7.5E / TRACE-159 (OD-5, owner approval 2026-11-24): the in-app notices addressed to the
// signed-in operator's own account. The admin layout's has_role('admin') guard runs first, so the page
// never mounts, and reads nothing, for anyone else. RLS lets an admin read every account's rows, so
// every read, count, write and realtime subscription in useOwnNotifications names user_id = the
// signed-in operator. Stored text is shown as text (adminNotificationPresentation); links are validated
// admin routes (notificationDestination). This is an in-app list only: it sends nothing, and a notice
// listed or read here is not evidence that anyone was alerted. A notice confers no permission.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { AdminNotificationItem } from "@/components/admin/AdminNotificationItem";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import type { AppNotification } from "@/hooks/useNotifications";
import { useOwnNotifications } from "@/hooks/useOwnNotifications";
import { presentAdminNotification } from "@/lib/adminNotificationPresentation";
import { adminDestinationLabel, notificationDestination } from "@/lib/notificationDestination";

type Feedback =
  | { tone: "status"; text: string }
  | { tone: "error"; title: string; text: string; href?: string; label?: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function AdminNotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const {
    items, status, hasMore, loadingMore, moreFailed, unreadCount, countFailed, visibleUnread,
    realtimeUnavailable, busyIds, bulkBusy, refresh, loadOlder, markRead, markVisibleRead,
  } = useOwnNotifications(Boolean(user), "admin-notifications");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const feedbackRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    rowRefs.current.get(id)?.focus();
  }, [items]);

  async function open(notification: AppNotification) {
    const destination = notificationDestination(notification, "admin");
    const result = await markRead(notification.id);
    if (!result.ok) {
      setFeedback({
        tone: "error",
        title: "This notice wasn’t marked as read",
        text: "Nothing else changed. Try opening it again, or go straight to the page.",
        href: destination,
        label: `Go to ${adminDestinationLabel(destination)}`,
      });
      return;
    }
    router.push(destination);
  }

  async function markVisible() {
    const shown = visibleUnread;
    const result = await markVisibleRead();
    setFeedback(result.ok
      ? { tone: "status", text: `${plural(shown, "visible notice")} marked as read. Notices you haven’t loaded are unchanged.` }
      : {
        tone: "error",
        title: "Notices weren’t all marked as read",
        text: "The list now shows what was saved. Notices you haven’t loaded are unchanged. Try again.",
      });
  }

  async function older() {
    const result = await loadOlder();
    if (result === null) return;
    setAnnouncement(result.added > 0 ? `Loaded ${plural(result.added, "older notice")}.` : "No older notices.");
    focusNext.current = result.firstId;
  }

  const hidden = unreadCount === null ? 0 : Math.max(unreadCount - visibleUnread, 0);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        eyebrow="Operations"
        title="Notifications"
        description="In-app notices addressed to your admin account, newest first. Each notice opens the admin page with the current details."
        actions={status === "ready" && items.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => void markVisible()}
            disabled={bulkBusy || visibleUnread === 0}
            aria-describedby="admin-mark-visible-scope"
          >
            {bulkBusy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Mark visible as read
          </Button>
        ) : undefined}
        metadata={<UnreadSummary status={status} unread={unreadCount} failed={countFailed} visibleUnread={visibleUnread} hidden={hidden} />}
      />

      <section aria-labelledby="in-app-only-heading" className="rounded-lg border border-status-info bg-status-info-bg p-4 text-sm text-status-info">
        <h2 id="in-app-only-heading" className="flex items-center gap-2 font-semibold"><Info aria-hidden="true" className="h-4 w-4 shrink-0" />In-app notices only</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>These are records Mercurius saved for your account inside the app. Nothing here is emailed, texted or pushed to anyone.</li>
          <li>A notice listed here, or marked read, does not show that anyone was alerted or acted on it.</li>
          <li>Each admin account has its own copy. Marking yours read changes no one else’s.</li>
          <li>Open work is tracked in the queues on the <Link href="/admin" className="font-semibold underline underline-offset-2">Overview</Link>. Many queue items have no notice.</li>
        </ul>
      </section>

      {realtimeUnavailable && (
        <div role="status" className="flex flex-col gap-3 rounded-lg border border-status-warning bg-status-warning-bg p-4 text-sm text-status-warning sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Live updates are unavailable. Refresh to check for new notices.</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh</Button>
        </div>
      )}

      {feedback && (
        <div
          ref={feedbackRef}
          tabIndex={-1}
          role={feedback.tone === "error" ? "alert" : "status"}
          className={feedback.tone === "error"
            ? "rounded-lg border border-status-danger bg-status-danger-bg p-4 text-sm text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            : "rounded-lg border border-status-success bg-status-success-bg p-4 text-sm text-status-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"}
        >
          {feedback.tone === "error" ? (
            <>
              <p className="font-semibold">{feedback.title}</p>
              <p className="mt-1">{feedback.text}</p>
              {feedback.href && <Link href={feedback.href} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>{feedback.label}</Link>}
            </>
          ) : <p>{feedback.text}</p>}
        </div>
      )}

      {status === "loading" ? (
        <PageState kind="loading" title="Loading notices" />
      ) : status === "error" ? (
        <PageState
          kind="error"
          title="Notices couldn’t be loaded"
          description="Nothing was changed. Check your connection and try again."
          action={<Button onClick={() => void refresh()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Try again</Button>}
        />
      ) : items.length === 0 ? (
        <PageState
          kind="empty"
          title="No notices for your account"
          description="Some workflows record an in-app notice for admin accounts, such as a new support request, a dispute or a quote proposal to review. Any addressed to you will be listed here."
        />
      ) : (
        <section aria-labelledby="admin-notices-heading" className="space-y-4">
          <h2 id="admin-notices-heading" className="sr-only">Notices</h2>
          <p id="admin-mark-visible-scope" className="text-sm text-muted-foreground">
            “Mark visible as read” changes only the unread notices shown below. Older notices you haven’t loaded stay unread.
          </p>
          <ul aria-label="Notices" className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
            {items.map((notification) => {
              const destination = notificationDestination(notification, "admin");
              return (
                <li key={notification.id}>
                  <AdminNotificationItem
                    ref={(node) => {
                      if (node) rowRefs.current.set(notification.id, node);
                      else rowRefs.current.delete(notification.id);
                    }}
                    notification={notification}
                    presentation={presentAdminNotification(notification)}
                    destinationLabel={adminDestinationLabel(destination)}
                    busy={busyIds.has(notification.id)}
                    onOpen={() => void open(notification)}
                  />
                </li>
              );
            })}
          </ul>

          {moreFailed && (
            <div role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-4 text-sm text-status-danger">
              <p className="font-semibold">Older notices couldn’t be loaded</p>
              <p className="mt-1">The notices above are unchanged. Try again.</p>
            </div>
          )}
          {hasMore ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void older()} disabled={loadingMore}>
                {loadingMore && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                {loadingMore ? "Loading older notices…" : moreFailed ? "Try loading older notices again" : "Load older"}
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">You’ve reached your oldest notice.</p>
          )}
        </section>
      )}
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}

function UnreadSummary({ status, unread, failed, visibleUnread, hidden }: {
  status: string; unread: number | null; failed: boolean; visibleUnread: number; hidden: number;
}) {
  if (status !== "ready") return null;
  if (unread === null) {
    return <p className="text-sm text-muted-foreground">{failed ? "The unread count couldn’t be loaded. Refresh to try again." : "Counting unread notices…"}</p>;
  }
  return (
    <p role="status" className="text-sm font-medium text-foreground">
      {unread === 0 ? "No unread notices" : `${plural(unread, "unread notice")}`}
      {hidden > 0 && <span className="font-normal text-muted-foreground">{` · ${visibleUnread} shown, ${hidden} in older notices`}</span>}
      {failed && <span className="font-normal text-muted-foreground"> · this count may be out of date</span>}
    </p>
  );
}
