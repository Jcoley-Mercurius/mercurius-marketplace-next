"use client";
/* eslint-disable @next/next/no-img-element -- Provider logos and gallery URLs are user-managed assets. */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { logoShape, providerInitials, type LogoShape, type ProfileMedia } from "@/lib/providerProfile/model";

/**
 * A provider logo sized by its own proportions: a wide wordmark gets width, a tall emblem gets
 * height. A missing or failed logo becomes initials on a neutral field.
 */
export function ProviderLogo({ name, logoUrl, size = "cover", className }: {
  name: string;
  logoUrl: string | null;
  /** cover: fills a card or profile cover. header: the profile identity row. plate: a small plate over a photo. */
  size?: "cover" | "header" | "plate";
  className?: string;
}) {
  const [shape, setShape] = useState<LogoShape>("square");
  const [failed, setFailed] = useState(false);

  if (!logoUrl || failed) {
    return <span
      data-logo="initials"
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-accent-soft font-semibold text-sage-dark",
        size === "cover" ? "size-24 text-3xl" : size === "header" ? "size-16 text-xl" : "size-12 text-base",
        className,
      )}
    >{providerInitials(name)}</span>;
  }

  const box = {
    cover: { wide: "max-h-[46%] max-w-[78%]", square: "max-h-[70%] max-w-[46%]", tall: "max-h-[82%] max-w-[36%]" },
    header: { wide: "max-h-16 max-w-52 sm:max-h-20 sm:max-w-64", square: "max-h-20 max-w-20", tall: "max-h-24 max-w-20" },
    plate: { wide: "max-h-9 max-w-28", square: "max-h-11 max-w-11", tall: "max-h-12 max-w-10" },
  }[size][shape];

  const measure = (image: HTMLImageElement) => setShape(logoShape(image.naturalWidth, image.naturalHeight));

  return <img
    src={logoUrl}
    alt={`${name} logo`}
    data-logo={shape}
    // An image that settled before hydration never fires onLoad or onError.
    ref={(image) => { if (image?.complete) { if (image.naturalWidth > 0) measure(image); else setFailed(true); } }}
    onLoad={(event) => measure(event.currentTarget)}
    onError={() => setFailed(true)}
    className={cn("h-auto w-auto shrink-0 object-contain", box, className)}
  />;
}

/**
 * The 2:1 card cover and the profile's lead image. A usable photo leads, with the logo on a
 * solid plate; otherwise the logo carries the cover. A photo that fails to load is dropped.
 */
export function ProviderCover({ name, logoUrl, photo, ratio = "card", className }: {
  name: string;
  logoUrl: string | null;
  photo?: ProfileMedia | null;
  ratio?: "card" | "lead";
  className?: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const usablePhoto = photo && failedPhoto !== photo.id ? photo : null;

  return <div
    data-cover={usablePhoto ? "photo" : "logo"}
    className={cn(
      "relative flex w-full items-center justify-center overflow-hidden bg-card",
      ratio === "card" ? "aspect-[2/1]" : "aspect-[16/9]",
      className,
    )}
  >
    {usablePhoto ? <>
      <img
        src={usablePhoto.image_url}
        alt={usablePhoto.caption || `${name} work example`}
        ref={(image) => { if (image?.complete && image.naturalWidth === 0) setFailedPhoto(usablePhoto.id); }}
        onError={() => setFailedPhoto(usablePhoto.id)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="absolute bottom-3 left-3 flex items-center justify-center rounded-lg bg-card p-1.5 ring-1 ring-border">
        <ProviderLogo name={name} logoUrl={logoUrl} size="plate" />
      </span>
    </> : <>
      {/* One quiet Marketplace rule; a provider accent colour has no data source yet. */}
      <span aria-hidden="true" className="absolute right-5 top-5 h-0.5 w-9 rounded bg-accent" />
      <span aria-hidden="true" className="absolute bottom-5 left-5 h-0.5 w-9 rounded bg-accent" />
      <ProviderLogo name={name} logoUrl={logoUrl} size="cover" />
    </>}
  </div>;
}
