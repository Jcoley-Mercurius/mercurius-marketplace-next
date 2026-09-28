/**
 * TRACE-098: the only destination carried through sign-up is the request intake, so a
 * homeowner who creates an account returns to their saved draft. Anything else is dropped.
 */
export function requestContinuationPath(requestedDestination: string | null | undefined): "/request" | null {
  return requestedDestination === "/request" ? "/request" : null;
}
