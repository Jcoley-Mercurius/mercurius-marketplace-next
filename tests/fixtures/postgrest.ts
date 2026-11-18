import type { Route } from "@playwright/test";

/**
 * Answers a PostgREST table read the way the server does for the public profile's count-checked
 * reads (TRACE-156): the `offset`/`limit` window the client asked for, and the exact total in
 * `content-range`. A response without that count is, correctly, read as incomplete.
 */
export function fulfillRows(route: Route, rows: readonly unknown[]) {
  const query = new URL(route.request().url()).searchParams;
  const start = Number(query.get("offset") ?? 0);
  const limit = Number(query.get("limit") ?? rows.length);
  const body = rows.slice(start, start + limit);
  return route.fulfill({
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-range": `${start}-${start + Math.max(body.length - 1, 0)}/${rows.length}`,
      "access-control-expose-headers": "content-range",
    },
    body: JSON.stringify(body),
  });
}
