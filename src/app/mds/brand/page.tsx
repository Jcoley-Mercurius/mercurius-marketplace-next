import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Brand asset review | Mercurius", robots: { index: false, follow: false } };

export default function BrandReview() {
  if (process.env.MDS_CATALOG_ENABLED !== "1") notFound();
  return <>
    <Header />
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-8">
      <PageHeader eyebrow="MDS · Brand review" title="Mercurius identity assets" description="The full symbol preserves the original Hermes artwork. The simplified small mark is a review draft and is not used in public navigation." />
      <Link href="/mds" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to component foundation</Link>
      <div className="grid gap-6 md:grid-cols-2">
        {(["dark-ink", "light-ink"] as const).map(ink => <section key={ink} aria-label={ink === "dark-ink" ? "Dark ink on light" : "Light ink on dark"} className={`min-w-0 space-y-6 rounded-xl border p-4 sm:p-6 ${ink === "dark-ink" ? "bg-brand-paper text-brand-ink" : "bg-brand-ink text-brand-paper"}`}>
          <h2 className="text-xl font-semibold text-inherit">{ink === "dark-ink" ? "Dark ink on light" : "Light ink on dark"}</h2>
          <figure className="space-y-2">
            <Image src={`/brand/mercurius-symbol-${ink}.svg`} alt="Mercurius Hermes symbol" width={200} height={200} unoptimized loading="eager" />
            <figcaption className="text-sm">Primary symbol · original geometry, single color</figcaption>
            <a href={`/brand/mercurius-symbol-${ink}.svg`} download className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Download symbol SVG</a>
          </figure>
          <figure className="space-y-2">
            <Image src={`/brand/mercurius-lockup-${ink}.svg`} alt="Mercurius symbol and wordmark" width={640} height={200} className="h-auto w-full" unoptimized loading="eager" />
            <figcaption className="text-sm">Symbol plus Geist wordmark</figcaption>
            <a href={`/brand/mercurius-lockup-${ink}.svg`} download className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Download lockup SVG</a>
          </figure>
          <figure className="space-y-2">
            <div className="flex flex-wrap items-end gap-6">
              {[32, 40, 64].map(size => <div key={size} className="space-y-2"><Image src={`/brand/mercurius-small-draft-${ink}.svg`} alt={`Small Hermes draft at ${size} pixels`} width={size} height={size} unoptimized loading="eager" /><p className="text-xs">{size}px</p></div>)}
            </div>
            <figcaption className="text-sm">Simplified symbol · owner review required</figcaption>
            <a href={`/brand/mercurius-small-draft-${ink}.svg`} download className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Download small-mark draft</a>
          </figure>
        </section>)}
      </div>
      <section className="space-y-3 rounded-xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Usage and acceptance</h2>
        <p className="text-sm text-muted-foreground">Reserve clear space equal to one eighth of the symbol width on every side. Proposed minimums: 80px for the full symbol, 256px for the lockup, and 32px for the simplified draft. Brand review must confirm these before the small mark replaces existing navigation artwork.</p>
        <p className="text-sm text-muted-foreground">SVG exports embed the unchanged source PNG as an alpha mask; they are rendering wrappers, not vector tracings. Lockups embed licensed Geist. The original optimized artwork remains in the application while the asset kit is reviewed.</p>
      </section>
    </main>
  </>;
}
