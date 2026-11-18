import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProviderCover } from "@/components/provider-profile/ProviderCover";
import { cn } from "@/lib/utils";
import {
  cardUnpricedLine,
  mediaForService,
  type CardOffer,
  type CardUnpricedReason,
  type ProfileMedia,
  type ProfileProvider,
} from "@/lib/providerProfile/model";

/**
 * Consumer provider card (approved visual direction, 2026-11-05). The cover carries the
 * provider's identity; the body always answers service, business, location and price in the
 * same place. `card` is the offer chosen for the directory's service context.
 *
 * TRACE-156: a listed provider with no offer to lead with keeps its card, identity and layout.
 * `card` is then null and the price slot says why — a provider is never dropped, and no offer is
 * invented, to satisfy the composition.
 */
export function ProviderDirectoryCard({
  provider, card, media, href, headingLevel = "h3", unpriced = "no_offer", listedServices = [], anchorId, onOpen,
}: {
  provider: Pick<ProfileProvider, "id" | "name" | "logo_url" | "location">;
  card: CardOffer | null;
  media: readonly ProfileMedia[];
  href: string;
  headingLevel?: "h2" | "h3" | "h4";
  /** Which unpriced case this is, when `card` is null. */
  unpriced?: CardUnpricedReason;
  /** Catalog names of the services the provider lists, shown only on an unpriced card. */
  listedServices?: readonly string[];
  /** Kept for the directory's existing in-page provider targeting. */
  anchorId?: string;
  /** Called as the profile link is followed (the directory records its return position). */
  onOpen?: () => void;
}) {
  const Heading = headingLevel;
  // Only a photo linked to this service leads the card; general media stays on the profile.
  const linked = mediaForService(media, card?.service.id ?? null);
  const photo = linked.general ? null : linked.items[0] ?? null;
  const offerLine = card?.line ?? null;
  const line = offerLine ?? cardUnpricedLine(unpriced);
  const services = listedServices.slice(0, 3).join(" · ");

  return <article
    id={anchorId}
    data-provider-card={provider.id}
    className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border-strong", anchorId && "scroll-mt-28")}
  >
    <ProviderCover name={provider.name} logoUrl={provider.logo_url} photo={photo} className="border-b border-border" />
    <div className="flex flex-1 flex-col p-4 sm:p-6">
      <Heading className="text-[1.375rem] font-semibold leading-7 text-foreground [overflow-wrap:anywhere] sm:text-2xl sm:leading-[1.875rem]">{card ? card.offer.name : provider.name}</Heading>
      {card && <p className="mt-2 text-base font-medium leading-[1.375rem] text-foreground [overflow-wrap:anywhere]">{provider.name}</p>}
      {provider.location && <p className="mt-1 text-sm leading-5 text-muted-foreground">Based in {provider.location}</p>}
      {!card && services && <p className="mt-2 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">Listed for {services}{listedServices.length > 3 ? ` and ${listedServices.length - 3} more` : ""}</p>}

      <p className="mt-4 [overflow-wrap:anywhere]" data-card-price={offerLine ? offerLine.kind : "unpriced"} data-card-unpriced={offerLine ? undefined : unpriced}>
        {offerLine?.kind === "fixed"
          ? <><span className="text-xl font-semibold leading-[1.625rem] text-foreground">{line.amount}</span>{line.detail && <span className="text-base text-muted-foreground"> · {line.detail}</span>}</>
          : <><span className="text-[1.0625rem] font-semibold leading-6 text-foreground">{line.amount}</span>{line.detail && <span className="block text-sm leading-5 text-muted-foreground">{line.detail}</span>}</>}
      </p>

      <div className="mt-auto pt-4">
        <Link href={href} onClick={onOpen} data-provider-profile-link className="flex min-h-11 items-center justify-between gap-3 border-t border-border pt-3 text-base font-semibold leading-[1.375rem] text-sage-dark">
          <span>View profile<span className="sr-only">: {provider.name}{card ? `, ${card.offer.name}` : ""}</span></span>
          <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-foreground" />
        </Link>
      </div>
    </div>
  </article>;
}
