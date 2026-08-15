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
  Star,
  UserCheck,
  Wrench,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { RevealItem, ScrollReveal } from "@/components/home/ScrollReveal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = [
  {
    number: "01",
    title: "Tell Us What You Need",
    description: "Pick from our curated service catalog — or build a custom plan. No phone calls, no awkward negotiations.",
    details: ["Lawn care, pool cleaning, handyman & more", "Recurring plans for monthly savings", "Clear, upfront pricing before you commit"],
    icon: Search,
    accent: "sage" as const,
  },
  {
    number: "02",
    title: "We Match & Manage",
    description: "Our team hand-picks a vetted, insured local pro and handles all scheduling, communication, and quality checks.",
    details: ["Background-checked, insured professionals", "Platform-managed scheduling & updates", "No more phone tag with contractors"],
    icon: UserCheck,
    accent: "coral" as const,
  },
  {
    number: "03",
    title: "Verified & Followed Up",
    description: "Every job includes photo proof and a review by our team. If it's not right, we work with the provider to make it right.",
    details: ["Photo proof of completed work", "Our team reviews every completed job", "One-tap rebooking & rescheduling"],
    icon: FileCheck,
    accent: "sage" as const,
  },
];

const benefits = [
  { icon: Shield, title: "Vetted Professionals", description: "Every provider is background-checked, insured, and trained to our standards." },
  { icon: Calendar, title: "Easy Scheduling", description: "Book once, and we handle all coordination. No more chasing contractors." },
  { icon: MessageSquare, title: "Single Point of Contact", description: "One platform for all your home services. One inbox. One relationship." },
  { icon: Award, title: "Quality Follow-Up", description: "Not satisfied? We'll send someone back to fix it at no extra charge." },
  { icon: Clock, title: "Time Saved", description: "Homeowners save an average of 5 hours per month on maintenance tasks." },
  { icon: CheckCircle2, title: "Transparent Pricing", description: "Fixed packages show the full price upfront. Custom work is quoted for your approval before we start." },
];

const trustStats = [
  { value: "700+", label: "Homeowners served" },
  { value: "4.9★", label: "Average rating" },
  { value: "100%", label: "Jobs reviewed by our team" },
  { value: "24hr", label: "Response time" },
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
      <main className="flex-1">
        <section className="bg-hero relative overflow-hidden">
          <div className="bg-pattern absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute right-1/4 top-0 h-[400px] w-[500px] rounded-full bg-accent/8 blur-3xl" />
          <div className="container-wide relative py-16 md:py-20 lg:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark shadow-sm ring-1 ring-sage/20"><Wrench className="mr-2 h-4 w-4" />How It Works</span>
              <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">Three Steps to a <span className="hero-gradient-text">Stress-Free Home</span></h1>
              <p className="mx-auto mb-8 max-w-2xl text-xl leading-relaxed text-muted-foreground">Upfront pricing on fixed packages. No arguing with contractors. No wondering if the job got done. Here&apos;s how Mercurius handles the hard parts.</p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row"><ActionLink href="/#bundle-builder">Get Started <ArrowRight className="ml-2 h-5 w-5" /></ActionLink><ActionLink href="/services" outline>Browse Services</ActionLink></div>
              <div className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-4 md:grid-cols-4">{trustStats.map((stat) => <div key={stat.label} className="text-center"><p className="text-2xl font-bold text-foreground">{stat.value}</p><p className="mt-1 text-xs text-muted-foreground">{stat.label}</p></div>)}</div>
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
                          {index === 0 && <FloatingBadge className="-bottom-3 -right-3"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Instant quote</FloatingBadge>}
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
            <div className="mx-auto mb-10 max-w-2xl text-center"><span className="mb-4 inline-block rounded-full bg-coral-light px-4 py-2 text-sm font-medium text-coral-dark">Why Mercurius</span><h2 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">Built Different, On Purpose</h2><p className="text-lg text-muted-foreground">We&apos;re not another marketplace. We&apos;re a managed platform that puts accountability first.</p></div>
            <ScrollReveal staggerChildren={0.1}><div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{benefits.map((benefit) => <RevealItem key={benefit.title}><div className="card-feature h-full"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sage-light"><benefit.icon className="h-6 w-6 text-sage" /></div><h3 className="mb-2 text-lg font-semibold text-foreground">{benefit.title}</h3><p className="text-sm text-muted-foreground">{benefit.description}</p></div></RevealItem>)}</div></ScrollReveal>
          </div>
        </section>

        <section className="bg-background py-12"><div className="container-wide"><div className="flex flex-col items-center gap-8 rounded-2xl border border-border/30 bg-card p-8 md:flex-row md:p-10"><div className="flex items-center gap-1">{[1, 2, 3, 4, 5].map((item) => <Star key={item} className="h-5 w-5 fill-warning text-warning" />)}</div><blockquote className="flex-1 text-center text-lg text-foreground md:text-left"><span className="font-serif text-2xl text-coral">&quot;</span>I didn&apos;t have to call, text, or negotiate with anyone. I picked a service, got a clear price, and the job was done. Photos after. That&apos;s it.<span className="font-serif text-2xl text-coral">&quot;</span></blockquote><div className="shrink-0 text-center md:text-right"><p className="font-semibold text-foreground">Sarah M.</p><p className="text-sm text-muted-foreground">Homeowner</p></div></div></div></section>

        <section ref={ctaRef} onMouseMove={handleCtaMouseMove} className="bg-cta-section section relative overflow-hidden text-primary-foreground">
          <div className="pointer-events-none absolute h-[500px] w-[500px] rounded-full opacity-60 blur-[120px] transition-opacity duration-500" style={{ background: "radial-gradient(circle, hsl(150 35% 45% / 0.35) 0%, transparent 70%)", left: `${ctaGlow.x}%`, top: `${ctaGlow.y}%`, transform: "translate(-50%, -50%)" }} />
          <div className="container-wide relative text-center"><div className="mx-auto max-w-2xl"><span className="mb-6 inline-block rounded-full bg-accent/20 px-4 py-1.5 text-sm font-medium text-accent-on-dark ring-1 ring-accent/30">Get started today</span><h2 className="mb-4 text-3xl font-bold leading-tight text-primary-foreground md:text-4xl">Ready to Make Home Services Predictable?</h2><p className="mx-auto mb-8 max-w-xl text-lg text-primary-foreground/70">Clear pricing. Managed jobs. Photo proof. One platform between you and your service provider.</p><div className="flex flex-col justify-center gap-4 sm:flex-row"><ActionLink href="/#bundle-builder" shadow>Build My Plan <ArrowRight className="ml-2 h-5 w-5" /></ActionLink><ActionLink href="/services" dark>Browse Services</ActionLink></div></div></div>
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
