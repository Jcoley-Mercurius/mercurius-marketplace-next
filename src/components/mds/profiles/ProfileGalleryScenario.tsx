"use client";

import { useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ProviderProfileView, type NextStepContext } from "@/components/provider-profile/ProviderProfileView";
import { useServiceParam } from "@/components/provider-profile/useServiceParam";
import { Select } from "@/components/ui/select";
import { profileScenario } from "@/components/mds/profiles/profileFixtures";
import type { ProfileViewer } from "@/lib/providerProfile/model";

/** One synthetic provider rendered through the shared profile composition. */
export function ProfileGalleryScenario({ slug }: { slug: string }) {
  const scenario = profileScenario(slug);
  const [service, setService] = useServiceParam();
  const [viewer, setViewer] = useState<ProfileViewer>("public");
  const [notice, setNotice] = useState("");
  if (!scenario) return null;

  const nextStep = (context: NextStepContext) => setNotice(
    `Gallery only: nothing was sent. A live profile would continue ${viewer === "invited" ? "to the request step" : "to early access"} with ${context.serviceId ? `service “${context.serviceId}”` : "no service selected"}${context.offerId ? `, offer “${context.offerId}”` : ""}.`,
  );
  const retry = (what: string) => setNotice(`Gallery only: the ${what} read fails on purpose in this scenario.`);

  return <>
    <Header />
    <main id="main-content" tabIndex={-1}>
      <div data-gallery-controls className="border-b border-border bg-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">MDS review gallery · {scenario.title}</p>
            <p className="text-sm text-muted-foreground">Synthetic provider and offers. Dynamic service focus is an exploration for owner review.</p>
            <Link href="/mds/profiles" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to the profile gallery</Link>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-foreground md:w-64">
            Preview as
            <Select value={viewer} onChange={(event) => { setViewer(event.target.value as ProfileViewer); setNotice(""); }}>
              <option value="public">Public visitor (not admitted)</option>
              <option value="invited">Invited homeowner</option>
            </Select>
          </label>
        </div>
        <p role="status" data-gallery-notice className="mx-auto max-w-6xl px-4 pb-3 text-sm text-foreground empty:hidden sm:px-8">{notice}</p>
      </div>

      <ProviderProfileView
        data={scenario.data}
        requestedServiceId={service}
        onServiceChange={setService}
        viewer={viewer}
        directoryHref="/mds/profiles"
        onNextStep={nextStep}
        onRetryReviews={() => retry("review")}
        onRetryCoverage={() => retry("coverage")}
      />
    </main>
  </>;
}
