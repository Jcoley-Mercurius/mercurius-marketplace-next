const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const requestId = value.trim();
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

export function contactHrefForRequest(value: unknown): string {
  const requestId = normalizeRequestId(value);
  return requestId
    ? `/contact?request=${encodeURIComponent(requestId)}`
    : "/contact";
}

export function appendRequestContext(
  message: string,
  value: unknown,
): string {
  const requestId = normalizeRequestId(value);
  return requestId ? `${message}\n\nRequest ID: ${requestId}` : message;
}
