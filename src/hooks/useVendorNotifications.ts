"use client";

// Phase 7.2B / TRACE-153: the vendor notification readback. The behavior lives in useOwnNotifications,
// shared with the admin page (Phase 7.5E); the vendor page's realtime channel name is unchanged.

import { OWN_NOTIFICATION_PAGE_SIZE, useOwnNotifications } from "@/hooks/useOwnNotifications";

export const VENDOR_NOTIFICATION_PAGE_SIZE = OWN_NOTIFICATION_PAGE_SIZE;

export function useVendorNotifications(enabled: boolean) {
  return useOwnNotifications(enabled, "vendor-notifications");
}
