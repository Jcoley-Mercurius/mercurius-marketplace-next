// TRACE-161: stable in-page anchors for the /services catalog rows. A featured card links to its
// service's row as `#service-<catalog id>`, so the link works as a plain anchor in the initial HTML;
// with scripts, the catalog also clears a category filter that hides the row and moves focus to it.

const ANCHOR_PREFIX = "service-";
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The element id of a service's catalog row, from its catalog id. */
export const serviceRowAnchor = (serviceId: string) => `${ANCHOR_PREFIX}${serviceId}`;

/** The in-page link to a service's catalog row. */
export const serviceRowHref = (serviceId: string) => `#${serviceRowAnchor(serviceId)}`;

/** The catalog id named by a `#service-<id>` URL fragment, or null for any other fragment. */
export function serviceIdFromHash(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment.startsWith(ANCHOR_PREFIX)) return null;
  const id = fragment.slice(ANCHOR_PREFIX.length);
  return ID.test(id) ? id : null;
}

/** Window event the catalog listens for; its detail is the catalog id to reveal. */
export const REVEAL_SERVICE_ROW_EVENT = "mercurius:reveal-service-row";

/**
 * Records the row's fragment in the address bar (a new history entry, as a plain anchor would) and
 * asks the catalog to reveal it. Dispatched even when the fragment is unchanged, because a filter
 * may have hidden the row since the last jump.
 */
export function revealServiceRow(serviceId: string) {
  const href = serviceRowHref(serviceId);
  if (window.location.hash !== href) window.history.pushState(null, "", href);
  window.dispatchEvent(new CustomEvent<string>(REVEAL_SERVICE_ROW_EVENT, { detail: serviceId }));
}
