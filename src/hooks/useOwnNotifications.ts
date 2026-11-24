"use client";

// The own-account notification readback: the vendor page (Phase 7.2B / TRACE-153) and the admin page
// (Phase 7.5E / TRACE-159). Homeowners keep useNotifications. The behavior, including the own-account
// filters and the binding of every request to the account it was made for, lives in
// OwnNotificationsController; this hook binds it to the signed-in account.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import {
  type OwnNotificationsChannel,
  OwnNotificationsController,
  initialOwnNotificationsState,
} from "@/lib/ownNotificationsController";

export { OWN_NOTIFICATION_PAGE_SIZE } from "@/lib/ownNotificationsController";
export type { MarkOutcome, OwnNotificationsStatus } from "@/lib/ownNotificationsController";

// `channel` names the realtime channel prefix; the subscription itself is always filtered to the
// signed-in account.
export function useOwnNotifications(enabled: boolean, channel: OwnNotificationsChannel) {
  const { user } = useAuth();
  const owner = enabled && user?.id ? user.id : null;
  const [controller] = useState(() => new OwnNotificationsController(createClient(), channel));

  // A new account, sign-out, disabling or unmounting resets the state and discards in-flight work.
  useEffect(() => {
    controller.setOwner(owner);
    return () => controller.setOwner(null);
  }, [controller, owner]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // Until the effect above has switched the controller, its state still belongs to the previous
  // account: never render it under this one.
  const blank = useMemo(() => initialOwnNotificationsState(owner), [owner]);
  const state = snapshot.owner === owner ? snapshot : blank;
  const visibleUnread = state.items.reduce((count, row) => count + (row.read_at ? 0 : 1), 0);

  return {
    ...state,
    visibleUnread,
    refresh: controller.load,
    refreshCount: controller.refreshCount,
    loadOlder: controller.loadOlder,
    markRead: controller.markRead,
    markVisibleRead: controller.markVisibleRead,
  };
}
