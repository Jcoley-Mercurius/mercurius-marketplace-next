"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

export type AppNotification = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  related_request_id: string | null;
  read_at: string | null;
  created_at: string;
};

export function useNotifications(
  limit = 30,
  enabled = true,
  subscriptionKey = "default",
) {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [realtimeError, setRealtimeError] = useState("");

  const load = useCallback(async () => {
    if (!user || !enabled) {
      setNotifications([]);
      setLoading(false);
      setLoaded(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("notifications")
      .select(
        "id, type, severity, title, body, link, related_request_id, read_at, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (queryError) {
      setNotifications([]);
      setError(queryError.message);
    } else {
      setNotifications((data ?? []) as AppNotification[]);
    }
    setLoading(false);
    setLoaded(true);
  }, [enabled, limit, supabase, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!user || !enabled) return;

    const channel = supabase
      .channel(`homeowner-notifications:${user.id}:${subscriptionKey}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications((current) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as AppNotification;
              if (current.some((item) => item.id === row.id)) return current;
              return [row, ...current].slice(0, limit);
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as AppNotification;
              return current.map((item) =>
                item.id === row.id ? { ...item, ...row } : item,
              );
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as { id?: string };
              return current.filter((item) => item.id !== row.id);
            }
            return current;
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeError("");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setRealtimeError(
            "Live notification updates are temporarily unavailable. Refresh to check for new updates.",
          );
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, limit, subscriptionKey, supabase, user]);

  const markRead = useCallback(
    async (id: string): Promise<Error | null> => {
      if (!user || !enabled) return new Error("Sign in to update notifications.");

      const now = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === id ? { ...item, read_at: item.read_at ?? now } : item,
        ),
      );

      const { error: updateError } = await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("id", id)
        .eq("user_id", user.id)
        .is("read_at", null);

      if (!updateError) return null;
      await load();
      return new Error(updateError.message);
    },
    [enabled, load, supabase, user],
  );

  const markAllRead = useCallback(async (): Promise<Error | null> => {
    if (!user || !enabled) return new Error("Sign in to update notifications.");

    const now = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => ({
        ...item,
        read_at: item.read_at ?? now,
      })),
    );

    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (!updateError) return null;
    await load();
    return new Error(updateError.message);
  }, [enabled, load, supabase, user]);

  const unreadCount = notifications.reduce(
    (count, notification) => count + (notification.read_at ? 0 : 1),
    0,
  );

  return {
    notifications,
    unreadCount,
    loading: loading || (enabled && Boolean(user) && !loaded),
    error,
    realtimeError,
    markRead,
    markAllRead,
    refresh: load,
  };
}
