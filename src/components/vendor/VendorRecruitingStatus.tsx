import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, ExternalLink, Info, MapPin, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listingSteps, type MyProviderListing } from "@/lib/recruitingReadiness";
import { cn } from "@/lib/utils";

// TRACE-104 (R0.4): during public recruiting, homeowner booking is closed except for
// homeowners Mercurius invites. Vendors prepare without any promise of work.
export function VendorRecruitingNotice({ className }: { className?: string }) {
  return (
    <aside
      aria-labelledby="vendor-recruiting-notice"
      className={cn("mb-6 flex gap-3 rounded-xl border border-info/30 bg-info/5 p-4 text-sm", className)}
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
      <div>
        <p id="vendor-recruiting-notice" className="font-medium text-foreground">
          Homeowner booking has not opened to the public yet
        </p>
        <p className="mt-1 leading-6 text-muted-foreground">
          Mercurius is recruiting providers now and will open booking by invitation. Until then, offers are rare and may not arrive at all.
          Use this time to get your profile, services and prices ready.
        </p>
      </div>
    </aside>
  );
}

export function VendorListingStatus({ listing, unavailable }: { listing: MyProviderListing | null; unavailable: boolean }) {
  if (unavailable) {
    return (
      <Card className="mb-8">
        <CardContent className="py-5 text-sm text-muted-foreground" role="status">
          Your public listing status could not be checked right now. Refresh the page to try again.
        </CardContent>
      </Card>
    );
  }
  if (!listing?.linked) return null;
  const steps = listingSteps(listing);

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Store className="h-5 w-5 text-accent" />Public listing</CardTitle>
            <CardDescription className="mt-1">
              Homeowners see your profile only after Mercurius approval and once it has real content.
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn("w-fit", listing.listed && "border-status-success bg-status-success-bg text-status-success")}>
            {listing.listed ? "Listed publicly" : "Not listed yet"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {listing.held && (
          <p role="status" className="rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm text-status-warning">
            Mercurius is reviewing this listing. Contact us if you have questions.
          </p>
        )}
        <ul className="space-y-2" aria-label="Listing requirements">
          {steps.map((step) => (
            <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {step.done
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className={cn(step.done ? "text-foreground" : "text-muted-foreground")}>
                {step.label}<span className="sr-only">{step.done ? " — complete" : " — not complete"}</span>
              </span>
              {!step.done && step.href && (
                <Link href={step.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Update<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4 text-accent" aria-hidden="true" />Service area</p>
          <p className="mt-1 leading-6 text-muted-foreground">
            {listing.service_zips.length
              ? `ZIP codes on file: ${listing.service_zips.join(", ")}.`
              : "No service ZIP codes are on file yet."}{" "}
            Mercurius sets your service area during review. <Link href="/contact" className="font-medium text-accent hover:underline">Ask for a change</Link>.
          </p>
        </div>
        {listing.listed && (
          <Link href={`/providers/${listing.contractor_id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 w-full sm:w-auto")}>
            <ExternalLink />View public profile
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
