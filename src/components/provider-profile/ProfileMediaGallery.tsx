"use client";
/* eslint-disable @next/next/no-img-element -- Gallery URLs are user-managed assets. */

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ProviderCover } from "@/components/provider-profile/ProviderCover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  const companion = current.companion_id ? usable.find((item) => item.id === current.companion_id) : null;
  const step = (delta: number) => setIndex((position + delta + usable.length) % usable.length);
  const title = general || !serviceName ? "Business photos" : `${serviceName} photos`;
  const generalLabel = general && serviceName ? `General business photo · not specific to ${serviceName.toLowerCase()}` : null;
  const projectLabel = current.pair_id ? `${current.pair_role === "before" ? "Before" : "After"} · ${current.project_title}` : null;

  return <figure data-profile-media="photo" className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
    <div className="relative aspect-[16/9] w-full bg-secondary">
      <img
        key={current.id}
        src={current.image_url}
        alt={current.caption || `${providerName} work example`}
        ref={(image) => { if (image?.complete && image.naturalWidth === 0) drop(current.id); }}
        onError={() => drop(current.id)}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
    </div>
    <figcaption className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {/* No photo is saved for this service, so the view says what these photos are (TRACE-156). */}
        {generalLabel && <p data-media-general className="text-xs font-semibold uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">{generalLabel}</p>}
        {projectLabel && <p data-project-role className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{projectLabel}</p>}
        {companion && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setIndex(usable.indexOf(companion))}>View paired {current.pair_role === "before" ? "after" : "before"} photo</Button>}
        {current.caption && <p className="text-sm text-foreground [overflow-wrap:anywhere]">{current.caption}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:max-w-48 sm:justify-end">
        <Dialog>
          <DialogTrigger render={<Button type="button" variant="outline" className="min-h-11" />}>View full photo</DialogTrigger>
          <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Full photo</DialogTitle>
              <DialogDescription className="[overflow-wrap:anywhere]">{providerName} · {title}</DialogDescription>
            </DialogHeader>
            <DialogClose render={<Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2" />} aria-label="Close full photo"><X aria-hidden="true" /></DialogClose>
            <img
              key={current.id}
              src={current.image_url}
              alt={current.caption || `${providerName} work example`}
              onError={() => drop(current.id)}
              decoding="async"
              className="h-[60dvh] w-full object-contain"
            />
            {generalLabel && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{generalLabel}</p>}
            {projectLabel && <p className="text-sm font-medium [overflow-wrap:anywhere]">{projectLabel}</p>}
            {current.caption && <p className="text-sm [overflow-wrap:anywhere]">{current.caption}</p>}
          </DialogContent>
        </Dialog>
        {usable.length > 1 && <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="Previous photo" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></Button>
          <p className="min-w-12 text-center text-sm tabular-nums text-muted-foreground" aria-live="polite">{position + 1} of {usable.length}</p>
          <Button type="button" variant="outline" size="icon" aria-label="Next photo" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></Button>
        </div>}
      </div>
    </figcaption>
  </figure>;
}
