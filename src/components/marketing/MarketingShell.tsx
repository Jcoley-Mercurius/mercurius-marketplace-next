import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

export function MarketingHero({ eyebrow, title, description, children }: { eyebrow: string; title: ReactNode; description: string; children?: ReactNode }) {
  return (
    <section className="bg-hero py-16 md:py-24">
      <div className="container-wide text-center">
        <span className="mb-6 inline-flex rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark">{eyebrow}</span>
        <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-tight sm:text-5xl md:text-6xl">{title}</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">{description}</p>
        {children && <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>}
      </div>
    </section>
  );
}

export function MarketingCta({ title, description, primaryLabel = "Request a Service", primaryHref = "/request", secondaryLabel, secondaryHref }: { title: string; description: string; primaryLabel?: string; primaryHref?: string; secondaryLabel?: string; secondaryHref?: string }) {
  return (
    <section className="bg-cta-section py-16 text-primary-foreground md:py-20">
      <div className="container-narrow text-center">
        <span className="mb-5 inline-flex rounded-full border border-accent/30 bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent">Get started today</span>
        <h2 className="text-3xl font-bold text-primary-foreground md:text-4xl">{title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/70">{description}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={primaryHref} className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-7 text-accent-foreground hover:bg-accent-hover")}>{primaryLabel}<ArrowRight className="ml-1 h-4 w-4" /></Link>
          {secondaryLabel && secondaryHref && <Link href={secondaryHref} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11 border-primary-foreground/30 bg-primary-foreground/10 px-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground")}>{secondaryLabel}</Link>}
        </div>
      </div>
    </section>
  );
}
