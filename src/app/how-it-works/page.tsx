"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  FileCheck,
  MessageSquare,
  Search,
  Shield,
  UserCheck,
  Wrench,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { RevealItem, ScrollReveal } from "@/components/home/ScrollReveal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EARLY_ACCESS_CTA, EARLY_ACCESS_PATH } from "@/lib/earlyAccessExperience";

const steps = [
  {
    number: "01",
    title: "Tell Us What You Need",
    description: "Pick from our curated service catalog — or build a custom plan. No phone calls, no awkward negotiations.",
    details: ["Lawn care, pool cleaning, handyman & more", "Recurring service plans when available", "Clear, upfront pricing before you commit"],
    icon: Search,
    accent: "sage" as const,
  },
  {
    number: "02",
    title: "We Match & Manage",
    description: "Our team helps source a vetted local pro and coordinates service fit, scheduling, communication, and job follow-up.",
    details: ["License, insurance & background-check documents reviewed", "Platform-managed scheduling & updates", "No more phone tag with contractors"],
    icon: UserCheck,
    accent: "coral" as const,
  },
  {
    number: "03",
    title: "Verified & Followed Up",
    description: "Completed jobs are photo-documented and reviewed through the platform. If something isn't right, raise it through Mercurius and we'll work with the provider on resolution.",
    details: ["Completion photos stored with the job", "Completed work reviewed through the platform", "Rebooking & rescheduling through the platform"],
    icon: FileCheck,
    accent: "sage" as const,
  },
];

const benefits = [
  { icon: Shield, title: "Application-Reviewed Providers", description: "Provider applications include license, insurance, and background-check documentation for Mercurius to review before a provider joins the network." },
  { icon: Calendar, title: "Easy Scheduling", description: "Submit a request, and Mercurius coordinates provider fit, availability, scheduling, and updates from there." },
  { icon: MessageSquare, title: "Single Point of Contact", description: "One platform for all your home services. One inbox. One relationship." },
  { icon: Award, title: "Quality Follow-Up", description: "Not satisfied? Raise it through Mercurius and we'll work with the provider on resolution." },
  { icon: Clock, title: "Time Saved", description: "Spend less time coordinating providers, schedules, and service updates across separate channels." },
  { icon: CheckCircle2, title: "Transparent Pricing", description: "Fixed packages show the full price upfront. Custom work is quoted for your approval before we start." },
];

export default function HowItWorksPage() {
  const ctaRef = useRef<HTMLElement>(null);
  const [ctaGlow, setCtaGlow] = useState({ x: 50, y: 50 });
  const handleCtaMouseMove = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCtaGlow({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <section className="bg-hero relative overflow-hidden">
          <div className="bg-pattern absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute right-1/4 top-0 h-[400px] w-[500px] rounded-full bg-accent/8 blur-3xl" />
          <div className="container-wide relative py-16 md:py-20 lg:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark shadow-sm ring-1 ring-sage/20"><Wrench className="mr-2 h-4 w-4" />How It Works</span>
              <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">Three Steps to a <span className="hero-gradient-text">Stress-Free Home</span></h1>
              <p className="mx-auto mb-8 max-w-2xl text-xl leading-relaxed text-muted-foreground">Upfront pricing on fixed packages. No arguing with contractors. No wondering if the job got done. Here&apos;s how Mercurius handles the hard parts.</p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row"><ActionLink href={EARLY_ACCESS_PATH}>{EARLY_ACCESS_CTA} <ArrowRight className="ml-2 h-5 w-5" /></ActionLink><ActionLink href="/services" outline>Browse Services</ActionLink></div>
            </div>
          </div>
        </section>

        <section className="section-sm bg-background">
          <div className="container-wide">
            <ScrollReveal staggerChildren={0.2}>
              <div className="space-y-12 lg:space-y-16">
                {steps.map((step, index) => (
                  <RevealItem key={step.number}>
                    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
                      <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                        <div className="mb-4 flex items-center gap-3"><div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", step.accent === "coral" ? "bg-coral-light" : "bg-sage-light")}><span className={cn("text-sm font-bold", step.accent === "coral" ? "text-coral-dark" : "text-sage-dark")}>{step.number}</span></div><div className={cn("h-px flex-1", step.accent === "coral" ? "bg-coral/20" : "bg-sage/20")} /></div>
                        <h2 className="mb-4 text-3xl font-bold text-foreground">{step.title}</h2>
                        <p className="mb-6 text-lg leading-relaxed text-muted-foreground">{step.description}</p>
                        <ul className="space-y-3">{step.details.map((detail) => <li key={detail} className="flex items-start gap-3"><CheckCircle2 className={cn("mt-0.5 h-5 w-5 shrink-0", step.accent === "coral" ? "text-coral" : "text-accent")} /><span className="text-foreground">{detail}</span></li>)}</ul>
                      </div>

                      <div className={index % 2 === 1 ? "lg:order-1" : ""}>
                        <div className={cn("relative flex aspect-[4/3] flex-col items-center justify-center rounded-3xl border border-border/30 p-8 md:p-12", step.accent === "coral" ? "bg-coral-light/50" : "bg-sage-light/50")}>
                          <div className={cn("mb-6 flex h-20 w-20 items-center justify-center rounded-2xl", step.accent === "coral" ? "bg-coral/10" : "bg-accent/10")}><step.icon className={cn("h-10 w-10", step.accent === "coral" ? "text-coral" : "text-accent")} /></div>
                          <p className="text-6xl font-bold text-foreground/5">{step.number}</p>
                          {index === 0 && <FloatingBadge className="-bottom-3 -right-3"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Upfront package pricing</FloatingBadge>}
                          {index === 1 && <FloatingBadge className="-right-3 -top-3"><Shield className="h-4 w-4 text-sage" />Vetted &amp; insured</FloatingBadge>}
                          {index === 2 && <FloatingBadge className="-bottom-3 -left-3"><Camera className="h-4 w-4 text-coral" />Photo verified</FloatingBadge>}
                        </div>
                      </div>
                    </div>
                  </RevealItem>
                ))}
              </div>
            </ScrollReveal>
          </div>
        </section>

        <section className="section-sm bg-muted">
          <div className="container-wide">
            <div className="mx-auto mb-10 max-w-2xl text-center"><span className="mb-4 inline-block rounded-full bg-coral-light px-4 py-2 text-sm font-medium text-coral-dark">Why Mercurius</span><h2 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">Built Different, On Purpose</h2><p className="text-lg text-muted-foreground">Mercurius is a managed marketplace built around coordination, documentation, and accountability.</p></div>
            <ScrollReveal staggerChildren={0.1}><div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{benefits.map((benefit) => <RevealItem key={benefit.title}><div className="card-feature h-full"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sage-light"><benefit.icon className="h-6 w-6 text-sage" /></div><h3 className="mb-2 text-lg font-semibold text-foreground">{benefit.title}</h3><p className="text-sm text-muted-foreground">{benefit.description}</p></div></RevealItem>)}</div></ScrollReveal>
          </div>
        </section>

        <section ref={ctaRef} onMouseMove={handleCtaMouseMove} className="bg-cta-section section relative overflow-hidden text-primary-foreground">
          <div className="pointer-events-none absolute h-[500px] w-[500px] rounded-full opacity-60 blur-[120px] transition-opacity duration-500" style={{ background: "radial-gradient(circle, hsl(150 35% 45% / 0.35) 0%, transparent 70%)", left: `${ctaGlow.x}%`, top: `${ctaGlow.y}%`, transform: "translate(-50%, -50%)" }} />
          <div className="container-wide relative text-center"><div className="mx-auto max-w-2xl"><span className="mb-6 inline-block rounded-full bg-accent/20 px-4 py-1.5 text-sm font-medium text-accent-on-dark ring-1 ring-accent/30">Opening by invitation</span><h2 className="mb-4 text-3xl font-bold leading-tight text-primary-foreground md:text-4xl">Ready to Make Home Services Predictable?</h2><p className="mx-auto mb-8 max-w-xl text-lg text-primary-foreground/70">Clear pricing. Managed jobs. Photo proof. One platform between you and your service provider.</p><div className="flex flex-col justify-center gap-4 sm:flex-row"><ActionLink href={EARLY_ACCESS_PATH} shadow>{EARLY_ACCESS_CTA} <ArrowRight className="ml-2 h-5 w-5" /></ActionLink><ActionLink href="/services" dark>Browse Services</ActionLink></div></div></div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function FloatingBadge({ children, className }: { children: ReactNode; className: string }) {
  return <div className={cn("absolute rounded-xl border border-border/50 bg-card px-4 py-2.5 shadow-lg", className)}><div className="flex items-center gap-2 text-sm font-medium text-foreground">{children}</div></div>;
}

function ActionLink({ href, children, outline = false, dark = false, shadow = false }: { href: string; children: ReactNode; outline?: boolean; dark?: boolean; shadow?: boolean }) {
  return <Link href={href} className={cn(buttonVariants({ size: "lg", variant: outline ? "outline" : "default" }), "h-11 px-8 text-base", !outline && !dark && "btn-hero-primary", outline && "border-border bg-card text-foreground transition-all duration-200 hover:bg-primary hover:text-primary-foreground", dark && "border border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground transition-all duration-200 hover:bg-primary-foreground/20", shadow && "shadow-lg shadow-accent/25")}>{children}</Link>;
}
