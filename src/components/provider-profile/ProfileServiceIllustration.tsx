"use client";

import { useState } from "react";
import { ILLUSTRATIVE_PHOTO_LABEL, type ServiceImage } from "@/lib/providerProfile/serviceImagery";

/**
 * A labelled stock photo that supports the service description. It sits apart from the provider's
 * own media and says what it is. If the image cannot load, the whole panel goes with it, so the
 * label never stands alone.
 */
export function ProfileServiceIllustration({ image, providerName }: {
  image: ServiceImage;
  providerName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return <figure
    data-service-illustration={image.serviceId}
    className="overflow-hidden rounded-xl border border-dashed border-border-strong bg-card sm:flex sm:items-stretch"
  >
    <picture className="block shrink-0 bg-secondary sm:w-56 lg:w-64">
      <source media="(min-width: 640px)" type="image/webp" srcSet={image.compact.srcSet} sizes="(min-width: 1024px) 16rem, 14rem" width={image.compact.width} height={image.compact.height} />
      <img
        src={image.wide.src}
        srcSet={image.wide.srcSet}
        sizes="calc(100vw - 2rem)"
        width={image.wide.width}
        height={image.wide.height}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        // An image that settled before hydration never fires onError.
        ref={(element) => { if (element?.complete && element.naturalWidth === 0 && element.currentSrc) setFailed(true); }}
        onError={() => setFailed(true)}
        className="aspect-[16/9] h-auto w-full object-cover sm:aspect-[4/3] sm:h-full"
      />
    </picture>
    <figcaption className="min-w-0 px-4 py-3 sm:self-center">
      <p data-illustration-label className="text-sm font-semibold text-foreground">{ILLUSTRATIVE_PHOTO_LABEL}</p>
      <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        A general example of this kind of service. It doesn&apos;t show {providerName}&apos;s team, work or results.
      </p>
    </figcaption>
  </figure>;
}
