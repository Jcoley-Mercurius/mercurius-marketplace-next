import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  XCircle,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { buttonVariants } from "@/components/ui/button";

const LAST_UPDATED = "August 5, 2026";

export default function ReschedulePolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main-content" tabIndex={-1}>
        <section className="bg-hero relative overflow-hidden py-16 md:py-20 lg:py-24">
          <div className="bg-pattern absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-sage/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -top-20 h-96 w-96 rounded-full bg-coral/10 blur-3xl" />
          <div className="container-wide relative">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark shadow-sm ring-1 ring-sage/20">
                <Calendar className="mr-2 h-4 w-4" /> Appointment Policy
              </span>
              <h1 className="mb-5 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
                Reschedule &amp; <span className="hero-gradient-text">Cancellation</span>
              </h1>
              <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground">
                We understand plans change. Here&apos;s everything you need to know about modifying your service appointments.
              </p>
              <p className="mt-6 text-sm font-medium text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            </div>
          </div>
        </section>

        <section className="section bg-background">
          <div className="container-narrow">
            <div className="grid gap-8">
              <div className="rounded-3xl border border-border/40 bg-card p-8 shadow-sm">
                <div className="mb-6 flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sage-light">
                    <Calendar className="h-6 w-6 text-sage" />
                  </div>
                  <div>
                    <h2 className="mb-2 text-xl font-semibold text-foreground">Rescheduling Policy</h2>
                    <p className="text-muted-foreground">
                      Need to change your appointment? No problem, just give us enough notice.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <PolicyRow icon={CheckCircle2} tone="positive" title="48+ Hours Before">
                    Free rescheduling. Change your appointment at no cost.
                  </PolicyRow>
                  <PolicyRow icon={Clock} tone="neutral" title="24-48 Hours Before">
                    $25 rescheduling fee applies. We&apos;ve already coordinated with your service provider.
                  </PolicyRow>
                  <PolicyRow icon={AlertTriangle} tone="warning" title="Less Than 24 Hours">
                    Same-day changes may not be possible. Contact us immediately and we&apos;ll do our best.
                  </PolicyRow>
                </div>
              </div>

              <div className="rounded-3xl border border-border/40 bg-card p-8 shadow-sm">
                <div className="mb-6 flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <XCircle className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <h2 className="mb-2 text-xl font-semibold text-foreground">Cancellation Policy</h2>
                    <p className="text-muted-foreground">
                      We reserve vendor time for you. Cancellations affect their livelihood.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <PolicyRow icon={CheckCircle2} tone="positive" title="72+ Hours Before">
                    Full refund. No questions asked.
                  </PolicyRow>
                  <PolicyRow icon={DollarSign} tone="neutral" title="24-72 Hours Before">
                    50% refund. We compensate the vendor for their reserved time.
                  </PolicyRow>
                  <PolicyRow icon={AlertTriangle} tone="warning" title="Less Than 24 Hours">
                    No refund. The vendor has committed their time and resources.
                  </PolicyRow>
                </div>
              </div>

              <div className="rounded-3xl border border-border/40 bg-card p-8 shadow-sm">
                <h2 className="mb-6 text-xl font-semibold text-foreground">How to Reschedule or Cancel</h2>
                <div className="grid gap-6 sm:grid-cols-3">
                  <PolicyStep number="1" title="Log In">Access your account dashboard</PolicyStep>
                  <PolicyStep number="2" title="Find Your Appointment">Go to upcoming services</PolicyStep>
                  <PolicyStep number="3" title="Make Changes">Reschedule or cancel instantly</PolicyStep>
                </div>
              </div>
            </div>

            <div className="mt-12 text-center">
              <p className="mb-4 text-muted-foreground">
                Questions about a specific situation? We&apos;re here to help.
              </p>
              <Link href="/contact" className={buttonVariants({ variant: "outline" })}>
                Contact Support
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function PolicyRow({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof Calendar;
  tone: "positive" | "neutral" | "warning";
  title: string;
  children: React.ReactNode;
}) {
  const rowClass = tone === "positive" ? "bg-sage-light/50" : tone === "warning" ? "bg-destructive/10" : "bg-muted";
  const iconClass = tone === "positive" ? "text-sage" : tone === "warning" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className={`flex items-start gap-3 rounded-xl p-4 ${rowClass}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} />
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function PolicyStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-xl font-bold text-accent-foreground">
        {number}
      </div>
      <h3 className="mb-2 font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
