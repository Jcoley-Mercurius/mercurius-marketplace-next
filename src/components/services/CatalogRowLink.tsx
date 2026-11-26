"use client";

import type { ComponentProps } from "react";
import { revealServiceRow, serviceRowHref } from "@/lib/servicesPage/rowAnchor";

/**
 * TRACE-161: a link to a service's row in "All home services". It is an ordinary `#service-<id>`
 * anchor, so it works before scripts load and opens normally in a new tab; a plain click or Enter
 * hands the jump to the catalog, which clears a hiding filter, scrolls the row clear of the sticky
 * header and focuses it.
 */
export function CatalogRowLink({ serviceId, onClick, ...props }: Omit<ComponentProps<"a">, "href"> & { serviceId: string }) {
  return (
    <a
      {...props}
      href={serviceRowHref(serviceId)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        revealServiceRow(serviceId);
      }}
    />
  );
}
