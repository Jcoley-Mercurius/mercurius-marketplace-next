"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Bell, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { useAuth } from "@/components/providers/AuthProvider";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { defaultPathForRoles, fetchRoles } from "@/lib/auth/roles";
import {
  type AppNotification,
  useNotifications,
} from "@/hooks/useNotifications";

type AccessState = "checking" | "allowed" | "denied" | "error";

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [accessError, setAccessError] = useState("");

  const checkAccess = useCallback(async () => {
    if (!user) return;
    setAccessState("checking");
    setAccessError("");

    try {
      const roles = await fetchRoles(user.id);
      if (!roles.includes("homeowner")) {
        setAccessState("denied");
        router.replace(defaultPathForRoles(roles));
        return;
      }
      setAccessState("allowed");
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "Your account access could not be verified.",
      );
      setAccessState("error");
    }
  }, [router, user]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => {
      if (!user) {
        router.replace("/login?redirect=%2Fnotifications");
        return;
      }
      void checkAccess();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, checkAccess, router, user]);

  const {
    notifications,
    unreadCount,
    loading,
    error,
    realtimeError,
    markRead,
    markAllRead,
    refresh,
  } = useNotifications(100, accessState === "allowed", "page");

  async function handleSelect(notification: AppNotification) {
    const updateError = await markRead(notification.id);
    if (updateError) {
      toast.error("Notification could not be marked as read", {
        description: updateError.message,
      });
    }
    router.push(notificationDestination(notification));
  }

  async function handleMarkAllRead() {
    const updateError = await markAllRead();
    if (updateError) {
      toast.error("Notifications could not be updated", {
        description: updateError.message,
      });
      return;
    }
    toast.success("All notifications marked as read");
  }

  if (authLoading || !user || accessState === "checking" || accessState === "denied") {
    return <FullPageLoading />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="py-10 md:py-14">
        <div className="container-wide max-w-4xl">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
                Homeowner updates
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                Notifications
              </h1>
              <p className="mt-2 text-muted-foreground">
                {unreadCount > 0
                  ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                  : "Service and booking updates will appear here."}
              </p>
            </div>
            {accessState === "allowed" && unreadCount > 0 && (
              <Button variant="outline" onClick={() => void handleMarkAllRead()}>
                Mark all as read
              </Button>
            )}
          </div>

          {accessState === "error" ? (
            <StateCard
              icon={AlertTriangle}
              title="We couldn’t verify your homeowner account"
              description={accessError}
              actionLabel="Try again"
              onAction={() => void checkAccess()}
            />
          ) : error ? (
            <StateCard
              icon={AlertTriangle}
              title="Notifications could not be loaded"
              description={error}
              actionLabel="Try again"
              onAction={() => void refresh()}
            />
          ) : (
            <>
              {realtimeError && (
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{realtimeError}</p>
                </div>
              )}

              <Card className="mt-6 overflow-hidden">
                <CardContent className="p-0">
                  {loading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      <span className="sr-only">Loading notifications</span>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="px-6 py-16 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                        <Bell className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="mt-4 font-medium">No notifications yet</p>
                      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                        We’ll let you know here when a request, quote, schedule, or
                        active service needs your attention.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {notifications.map((notification) => (
                        <NotificationItem
                          key={notification.id}
                          notification={notification}
                          onSelect={(item) => void handleSelect(item)}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function notificationDestination(notification: AppNotification) {
  const safeLink = safeLocalLink(notification.link);
  if (
    notification.related_request_id &&
    (!safeLink || safeLink === "/dashboard" || safeLink.startsWith("/dashboard?"))
  ) {
    return `/dashboard?job=${encodeURIComponent(notification.related_request_id)}`;
  }
  return safeLink ?? "/dashboard";
}

function safeLocalLink(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  try {
    const url = new URL(value, "https://mercurius.local");
    if (url.origin !== "https://mercurius.local") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        Loading notifications...
      </div>
    </div>
  );
}

function StateCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card className="mt-6 border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20">
      <CardContent className="flex flex-col items-center px-6 py-12 text-center">
        <Icon className="h-8 w-8 text-red-700 dark:text-red-300" />
        <h2 className="mt-4 text-lg font-semibold text-red-950 dark:text-red-100">
          {title}
        </h2>
        <p className="mt-2 max-w-lg text-sm text-red-900/80 dark:text-red-200/80">
          {description}
        </p>
        <Button className="mt-5" onClick={onAction}>
          <RefreshCw className="h-4 w-4" />
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
