// Phase 7.2B / TRACE-153: the keyset cursor for newest-first notification paging.
//
// Order is (created_at desc, id desc). The next page holds rows strictly after the cursor row in that
// order: an older timestamp, or the same timestamp with a smaller id. Rows sharing a timestamp are
// therefore neither skipped nor repeated at a page boundary. Values are double-quoted so the ":",
// "+", "." and "," in a timestamp stay literal inside PostgREST's or() logic tree.

export type NotificationCursor = { created_at: string; id: string };

export function notificationKeysetFilter(cursor: NotificationCursor) {
  const at = quote(cursor.created_at);
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${quote(cursor.id)})`;
}

function quote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
