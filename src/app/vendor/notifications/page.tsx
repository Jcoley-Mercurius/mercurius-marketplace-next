"use client";

// Phase 7.2B / TRACE-153 (DEC-2026-065): vendors read the in-app notices addressed to their own
// account. The vendor layout's role guard runs first; the page reads only the caller's rows.
// Wording is controlled (vendorNotificationPresentation); links are validated vendor routes
// (notificationDestination). A notice confers no permission: each destination checks access itself.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { VendorNotificationItem } from "@/components/vendor/VendorNotificationItem";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import type { AppNotification } from "@/hooks/useNotifications";
import { useVendorNotifications } from "@/hooks/useVendorNotifications";
import { notificationDestination, vendorDestinationLabel } from "@/lib/notificationDestination";
import { presentVendorNotification } from "@/lib/vendorNotificationPresentation";
import { useAuth } from "@/components/providers/AuthProvider";

type Feedback =
  | { tone: "status"; text: string }
  | { tone: "error"; title: string; text: string; href?: string; label?: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function VendorNotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const {
    items, status, hasMore, loadingMore, moreFailed, unreadCount, countFailed, visibleUnread,
    realtimeUnavailable, busyIds, bulkBusy, refresh, loadOlder, markRead, markVisibleRead,
  } = useVendorNotifications(Boolean(user));
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
    const destination = notificationDestination(notification, "vendor");
    const result = await markRead(notification.id);
    if (!result.ok) {
      setFeedback({
        tone: "error",
        title: "This notice wasn’t marked as read",
        text: "Nothing else changed. Try opening it again, or go straight to the page.",
        href: destination,
        label: `Go to ${vendorDestinationLabel(destination)}`,
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
    // Keyboard users continue from the first newly loaded notice once it renders.
    focusNext.current = result.firstId;
  }

  const hidden = unreadCount === null ? 0 : Math.max(unreadCount - visibleUnread, 0);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        eyebrow="Vendor updates"
        title="Notifications"
        description="Updates recorded for your account, newest first. Each notice opens the page with the current details."
        actions={status === "ready" && items.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => void markVisible()}
            disabled={bulkBusy || visibleUnread === 0}
            aria-describedby="mark-visible-scope"
          >
            {bulkBusy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Mark visible as read
          </Button>
        ) : undefined}
        metadata={<UnreadSummary status={status} unread={unreadCount} failed={countFailed} visibleUnread={visibleUnread} hidden={hidden} />}
      />

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
          title="No notices yet"
          description="When Mercurius records an update for your account, such as a job offer, a homeowner’s answer or a price for your review, it appears here."
        />
      ) : (
        <section aria-labelledby="vendor-notices-heading" className="space-y-4">
          <h2 id="vendor-notices-heading" className="sr-only">Notices</h2>
          <p id="mark-visible-scope" className="text-sm text-muted-foreground">
            “Mark visible as read” changes only the unread notices shown below. Older notices you haven’t loaded stay unread.
          </p>
          <ul aria-label="Notices" className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
            {items.map((notification) => {
              const destination = notificationDestination(notification, "vendor");
              return (
                <li key={notification.id}>
                  <VendorNotificationItem
                    ref={(node) => {
                      if (node) rowRefs.current.set(notification.id, node);
                      else rowRefs.current.delete(notification.id);
                    }}
                    notification={notification}
                    presentation={presentVendorNotification(notification)}
                    destinationLabel={vendorDestinationLabel(destination)}
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
