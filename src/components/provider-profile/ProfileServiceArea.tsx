"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, MapPin, RefreshCw } from "lucide-react";
import { ServiceAreaMap } from "@/components/provider-profile/ServiceAreaMap";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { checkZip, type ProfileServiceArea as ServiceArea, type ZipCheck } from "@/lib/providerProfile/model";
import { cn } from "@/lib/utils";

/**
 * Service area: the ZIP question first, then the provider's listed ZIPs on the existing map.
 * A listed ZIP is where the provider works; it never states that a service can be booked.
 */
export function ProfileServiceArea({ providerName, serviceName, serviceArea, marketplaceZips, directoryHref, onRetry }: {
  providerName: string;
  /** The service the check concerns, or null in the All services view. */
  serviceName: string | null;
  serviceArea: ServiceArea | null;
  marketplaceZips: readonly string[] | null;
  directoryHref: string;
  onRetry?: () => void;
}) {
  // The ZIP a visitor typed, and the one they last checked, belong to the visit rather than to
  // one service view: both survive a change of service. The result is worked out from the
  // checked ZIP on every render, so it always describes the service and coverage now shown.
  const [zip, setZip] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const result: ZipCheck | null = checked === null ? null : checkZip(checked, serviceArea, marketplaceZips);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(zip);
    if (checkZip(zip, serviceArea, marketplaceZips).status === "invalid") event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
  }

  const areas = serviceArea?.areas ?? [];
  const count = areas.reduce((total, area) => total + area.zips.length, 0);
  const subject = serviceName ? serviceName.toLowerCase() : `${providerName}'s services`;

  return <section id="profile-area" aria-labelledby="profile-area-heading" className="scroll-mt-24 border-t border-border pt-8">
    <h2 id="profile-area-heading" className="text-2xl font-semibold text-foreground">Service area</h2>
    <p className="mt-1 text-base text-muted-foreground [overflow-wrap:anywhere]">Check the listed area for {subject}.</p>

    <div className="mt-5 grid gap-8 lg:grid-cols-2">
      <div className="min-w-0">
        <form noValidate onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 sm:w-44">
            <FormField label="ZIP code" error={result?.status === "invalid" ? "Enter a 5-digit ZIP code." : undefined}>
              {(control) => <Input
                {...control}
                name="zip"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={5}
                value={zip}
                onChange={(event) => setZip(event.target.value)}
              />}
            </FormField>
          </div>
          <Button type="submit" variant="commitment" className="sm:mt-7">Check ZIP</Button>
        </form>

        <div role="status" aria-live="polite" className="mt-4">
          {!result && <p className="text-sm text-muted-foreground">Enter your ZIP to check the listed area.</p>}
          {result && result.status !== "invalid" && <ZipResult result={result} serviceName={serviceName} directoryHref={directoryHref} onRetry={onRetry} />}
        </div>

        <p className="mt-4 text-sm leading-5 text-muted-foreground">
          A listed ZIP shows where this provider works. Whether a service can be booked at your address is confirmed in the request step.
        </p>
      </div>

      <div className="min-w-0">
        {!serviceArea && <AreaMessage title="Service area unavailable" copy="The listed ZIP codes could not be read. Nothing is assumed about this provider's area." onRetry={onRetry} />}
        {serviceArea && areas.length === 0 && <AreaMessage
          title={serviceArea.hasListedZips ? "No service ZIP codes in current coverage" : "Service area not listed yet"}
          copy={serviceArea.hasListedZips
            ? "This provider's listed ZIP codes are outside Mercurius's current service area."
            : "This provider has not listed its service ZIP codes."}
        />}
        {serviceArea && areas.length > 0 && <div className="space-y-3">
          {/* The existing map, kept near the width its labels were drawn for. */}
          <div className="max-w-sm"><ServiceAreaMap areas={areas} /></div>
          <p className="text-sm text-foreground">{count} listed ZIP code{count === 1 ? "" : "s"} in Lee County, FL</p>
          <ul className="space-y-2">
            {areas.map((area) => <li key={area.city} className="flex gap-2">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sage-dark" />
              <p className="min-w-0 text-sm"><span className="font-medium text-foreground">{area.city}</span><span className="break-words text-muted-foreground"> · {area.zips.join(", ")}</span></p>
            </li>)}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">ZIP codes without a drawn boundary appear in the list only.</p>
        </div>}
      </div>
    </div>
  </section>;
}

function ZipResult({ result, serviceName, directoryHref, onRetry }: {
  result: Exclude<ZipCheck, { status: "invalid" }>;
  serviceName: string | null;
  directoryHref: string;
  onRetry?: () => void;
}) {
  const service = serviceName ? serviceName.toLowerCase() : "a service";
  const content = {
    listed: {
      tone: "positive" as const,
      title: `${result.zip} is in the listed area`,
      copy: `Eligibility for ${service} at your address is confirmed in the request step.`,
    },
    outside_provider: {
      tone: "neutral" as const,
      title: `${result.zip} is outside this provider's listed area`,
      copy: "Other providers may list this ZIP.",
    },
    outside_marketplace: {
      tone: "neutral" as const,
      title: `${result.zip} is outside the current Mercurius service area`,
      copy: "Not available yet in your area.",
    },
    unknown: {
      tone: "neutral" as const,
      title: result.status === "unknown" && result.reason === "unlisted" ? `We can't tell whether ${result.zip} is covered` : `We couldn't check ${result.zip}`,
      copy: result.status === "unknown" && result.reason === "unlisted"
        ? "This provider has not listed its service ZIP codes."
        : "The listed area is unavailable right now. Nothing is assumed about this ZIP.",
    },
  }[result.status];

  return <div data-zip-result={result.status} className={cn("rounded-xl p-4", content.tone === "positive" ? "bg-accent-soft" : "bg-secondary")}>
    <p className={cn("text-lg font-semibold [overflow-wrap:anywhere]", content.tone === "positive" ? "text-sage-dark" : "text-foreground")}>{content.title}</p>
    <p className="mt-1 text-sm text-foreground">{content.copy}</p>
    {result.status === "outside_provider" && <Link href={directoryHref} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sage-dark underline underline-offset-4">Browse other providers<ArrowRight aria-hidden="true" className="size-4" /></Link>}
    {result.status === "unknown" && result.reason === "unreadable" && onRetry && <Button type="button" variant="outline" className="mt-3" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</Button>}
  </div>;
}

function AreaMessage({ title, copy, onRetry }: { title: string; copy: string; onRetry?: () => void }) {
  return <div className="rounded-xl bg-secondary p-5">
    <MapPin aria-hidden="true" className="size-6 text-slate" />
    <p className="mt-2 text-base font-semibold text-foreground">{title}</p>
    <p className="mt-1 text-sm text-slate">{copy}</p>
    {onRetry && <Button type="button" variant="outline" className="mt-3" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</Button>}
  </div>;
}
