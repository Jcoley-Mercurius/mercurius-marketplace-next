import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, Compass, Wallet } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { EarlyAccessForm } from "@/components/early-access/EarlyAccessForm";
import { earlyAccessServicesFromQuery } from "@/lib/earlyAccessExperience";

export const metadata: Metadata = {
  title: "Join early access | Mercurius Marketplace",
  description: "Lee County homeowners can join Mercurius early access. Booking opens by invitation in stages as approved providers become available.",
};

const facts = [
  { icon: Compass, title: "Explore now", body: "Browse real services and approved local providers." },
  { icon: CalendarClock, title: "Booking by invitation", body: "We invite homeowners in stages as services are ready in their area." },
  { icon: Wallet, title: "No payment to join", body: "Joining doesn’t book a service or ask for payment details." },
];

// TRACE-103 (R0.3): approved public early-access composition (HOMEOWNER-EARLY-ACCESS-EXPERIENCE §1).
export default async function EarlyAccessPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { service } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1 bg-cream">
        {/* One DOM order for every width: promise, form, then facts. On large screens the facts
            sit under the promise in the left column while the form spans the right. */}
        <div className="container-wide grid gap-8 py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:py-16">
          <section aria-labelledby="early-access-heading" className="min-w-0 lg:col-start-1 lg:row-start-1 lg:pt-6">
            <p className="inline-block rounded-full border border-accent-border bg-accent-soft px-3 py-1 text-sm font-medium text-commitment">Lee County early access</p>
            <h1 id="early-access-heading" className="mt-4 text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              A better way to care for your home is on its way.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-8 text-muted-foreground">
              Explore local services and providers now. We’re inviting homeowners to book in stages as approved providers become available.
            </p>
          </section>
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <EarlyAccessForm preselected={earlyAccessServicesFromQuery(service)} />
          </div>
          <section aria-label="About early access" className="min-w-0 lg:col-start-1 lg:row-start-2">
            <ul className="max-w-xl space-y-4">
              {facts.map((fact) => <Fact key={fact.title} {...fact} />)}
            </ul>
            <Link href="/services" className="mt-4 inline-flex min-h-11 items-center gap-2 font-medium text-commitment underline underline-offset-4">
              Browse services <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Fact({ icon: Icon, title, body }: (typeof facts)[number]) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-commitment"><Icon aria-hidden="true" className="size-5" /></span>
      <span><span className="block font-semibold text-foreground">{title}</span><span className="block text-sm text-muted-foreground">{body}</span></span>
    </li>
  );
}
