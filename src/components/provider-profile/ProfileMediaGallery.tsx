"use client";
/* eslint-disable @next/next/no-img-element -- Gallery URLs are user-managed assets. */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProviderCover } from "@/components/provider-profile/ProviderCover";
import { Button } from "@/components/ui/button";
import type { ProfileMedia } from "@/lib/providerProfile/model";

/**
 * One image at a time with explicit previous and next controls. Images that fail to load are
 * dropped; with nothing left to show, the provider's logo carries the cover.
 */
export function ProfileMediaGallery({ providerName, logoUrl, items, general, serviceName, unavailable = false }: {
  providerName: string;
  logoUrl: string | null;
  items: readonly ProfileMedia[];
  /** The items are general business media, not linked to the selected service. */
  general: boolean;
  serviceName: string | null;
  /** The gallery read failed: the logo carries the cover and says photos couldn't be loaded. */
  unavailable?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<readonly string[]>([]);
  const usable = items.filter((item) => !failed.includes(item.id));
  const drop = (id: string) => setFailed((current) => current.includes(id) ? current : [...current, id]);

  if (usable.length === 0) {
    return <figure data-profile-media="logo" className="overflow-hidden rounded-xl ring-1 ring-border">
      <ProviderCover name={providerName} logoUrl={logoUrl} ratio="lead" />
      {(items.length > 0 || unavailable) && <figcaption data-media-unavailable className="border-t border-border bg-card px-4 py-2 text-sm text-muted-foreground">Photos for this provider could not be loaded.</figcaption>}
    </figure>;
  }

  const current = usable[Math.min(index, usable.length - 1)];
  const position = usable.indexOf(current);
  const step = (delta: number) => setIndex((position + delta + usable.length) % usable.length);

  return <figure data-profile-media="photo" className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
    <div className="relative aspect-[16/9] w-full bg-secondary">
      <img
        key={current.id}
        src={current.image_url}
        alt={current.caption || `${providerName} work example`}
        ref={(image) => { if (image?.complete && image.naturalWidth === 0) drop(current.id); }}
        onError={() => drop(current.id)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
    <figcaption className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {/* Photos carry no service link today (TRACE-156), so a service view says what they are. */}
        {general && serviceName && <p data-media-general className="text-xs font-semibold uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">General business photo · not specific to {serviceName.toLowerCase()}</p>}
        {current.caption && <p className="text-sm text-foreground [overflow-wrap:anywhere]">{current.caption}</p>}
      </div>
      {usable.length > 1 && <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="Previous photo" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>
        <p className="min-w-12 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">{position + 1} of {usable.length}</p>
        <Button type="button" variant="outline" size="icon" aria-label="Next photo" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>
      </div>}
    </figcaption>
  </figure>;
}
