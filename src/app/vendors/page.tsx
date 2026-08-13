"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  Calendar,
  CheckCircle2,
  DollarSign,
  GraduationCap,
  Headphones,
  MapPin,
  Megaphone,
  PackageCheck,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const benefits = [
  { icon: Calendar, title: "Consistent Job Flow", description: "Get a steady stream of jobs dispatched directly to you. No more chasing leads or slow seasons." },
  { icon: DollarSign, title: "Reliable, Fast Payouts", description: "Complete jobs, get paid. Simple weekly payouts with transparent tracking." },
  { icon: Users, title: "We Handle Customers", description: "Focus on your craft. We manage all customer communication, scheduling, and support." },
  { icon: TrendingUp, title: "Grow Your Business", description: "Expand your service area and capacity with our support and operational tools." },
];

const heroBenefits = [
  {
    icon: Calendar,
    title: "Steady Work Pipeline",
    description: "Platform-matched job opportunities, so you can spend less time constantly chasing leads.",
  },
  {
    icon: PackageCheck,
    title: "Package Pricing Tools",
    description: "Publish clear fixed rates or quote-required services and control the work you accept.",
  },
  {
    icon: Users,
    title: "Less Admin Overhead",
    description: "Keep scheduling, job updates, and homeowner communication coordinated in the platform.",
  },
  {
    icon: MapPin,
    title: "Southwest Florida Focus",
    description: "Built for local service businesses serving Cape Coral, Fort Myers, and nearby communities.",
  },
];

const aiTools = [
  { icon: BrainCircuit, title: "Smart Job Matching", description: "We match requests using your services, location, availability, and profile signals to surface work that fits your business." },
  { icon: Bot, title: "Built-In Business Tools", description: "Keep assigned jobs, schedules, status updates, and completion details organized in one vendor portal." },
  { icon: BarChart3, title: "Clear Job Visibility", description: "See assigned work, job status, earnings, and completion history together without piecing updates across different tools." },
  { icon: Target, title: "Practical Profile Guidance", description: "Get clear prompts to finish your profile, publish pricing, and respond to requests so Mercurius can send better-fit work." },
  { icon: Megaphone, title: "A Managed Local Channel", description: "Reach Southwest Florida homeowners through a coordinated marketplace without managing every lead on your own." },
  { icon: Zap, title: "Tools That Grow With the Network", description: "Expect practical workflow improvements as the network grows, with deeper AI assistance added only where it is useful and trustworthy." },
];

const supportFeatures = [
  { icon: Headphones, title: "Direct Platform Support", description: "Get hands-on help from the Mercurius team while our local network is small, from onboarding questions to active-job coordination." },
  { icon: GraduationCap, title: "Onboarding & Guidance", description: "Get practical guidance for presenting your services, publishing clear package prices, and completing work through managed workflows." },
  { icon: BarChart3, title: "Job Visibility & Documentation", description: "Use the vendor portal to follow assigned work, share updates, and keep job records and completion documentation together." },
];

const requirements = [
  "Valid business license or contractor registration",
  "Proof of insurance (liability coverage required)",
  "Clean background check",
  "Professional equipment and transportation",
  "Commitment to quality and reliability",
  "Smartphone for our vendor app",
];

const supportExamples = [
  { label: "Onboarding Checklist", text: "Complete your profile, confirm your service area, and add at least one live package or quote option." },
  { label: "Package Pricing Tip", text: "Publish clear scope and cadence details so homeowners understand what your package includes before requesting it." },
  { label: "Job Documentation", text: "Add status updates and completion photos to keep the homeowner and Mercurius aligned throughout the job." },
];

export default function VendorsPage() {
  const ctaRef = useRef<HTMLElement>(null);
  const [ctaGlow, setCtaGlow] = useState({ x: 50, y: 50 });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="bg-hero py-12 md:py-16 lg:py-20">
          <div className="container-wide">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <span className="mb-6 inline-block rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark">For Service Providers</span>
                <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">Grow Your Business <span className="text-gradient">With Us</span></h1>
                <p className="mb-8 text-xl text-muted-foreground">Join a managed platform built for Southwest Florida service businesses. Mercurius helps source and coordinate work, gives you clear package-pricing tools, and reduces the lead chasing and admin between jobs.</p>

                <div className="mb-8 rounded-2xl border border-border/30 bg-card p-5 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">The vendor outcome</p>
                  <p className="mb-3 text-sm leading-6 text-foreground">Spend less time chasing leads and coordinating messages—and more time delivering quality work on jobs that fit your business.</p>
                  <p className="text-xs font-medium text-muted-foreground">Local service professional</p>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row">
                  <VendorLink href="/vendors/apply">Apply to Join <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" /></VendorLink>
                  <VendorLink href="/how-it-works" outline>See How It Works</VendorLink>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">{heroBenefits.map((benefit) => <div key={benefit.title} className="rounded-2xl border border-border/30 bg-card p-5 shadow-sm sm:p-6"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-sage-light"><benefit.icon aria-hidden="true" className="h-5 w-5 text-sage-dark" /></div><p className="mb-2 font-semibold text-foreground">{benefit.title}</p><p className="text-sm leading-6 text-muted-foreground">{benefit.description}</p></div>)}</div>
            </div>
          </div>
        </section>

        <section className="section-sm bg-background">
          <div className="container-wide">
            <div className="mx-auto mb-10 max-w-2xl text-center"><h2 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">Why Work With Mercurius?</h2><p className="text-lg text-muted-foreground">We&apos;re not a marketplace. We&apos;re a managed platform that sets you up for success.</p></div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">{benefits.map((benefit) => <div key={benefit.title} className="card-feature"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sage-light"><benefit.icon aria-hidden="true" className="h-6 w-6 text-sage" /></div><h3 className="mb-2 text-lg font-semibold text-foreground">{benefit.title}</h3><p className="text-sm text-muted-foreground">{benefit.description}</p></div>)}</div>
          </div>
        </section>

        <section className="section-sm relative overflow-hidden bg-primary">
          <div className="pointer-events-none absolute left-1/4 top-0 h-96 w-96 rounded-full bg-accent/10 blur-[120px]" /><div className="pointer-events-none absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-sage/8 blur-[100px]" />
          <div className="container-wide relative">
            <div className="mx-auto mb-4 max-w-2xl text-center"><span className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent/20 px-4 py-2 text-sm font-semibold text-accent"><Zap aria-hidden="true" className="h-4 w-4" />Managed Marketplace Tools</span><h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl">Smart Tools for Local Pros</h2><p className="text-lg text-primary-foreground/70">Practical matching and portal guidance help you present your business clearly, stay organized, and focus on work that fits.</p></div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{aiTools.map((tool, index) => <motion.div key={tool.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4, delay: index * 0.08 }} className="group relative rounded-2xl border border-primary-foreground/10 p-6 shadow-sm backdrop-blur-sm transition-all duration-300 hover:border-accent/30 hover:shadow-lg" style={{ background: "linear-gradient(135deg, hsl(40 20% 98% / 0.06) 0%, hsl(40 20% 98% / 0.02) 100%)" }}><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 transition-colors group-hover:bg-accent/25"><tool.icon aria-hidden="true" className="h-5 w-5 text-accent" /></div><h3 className="mb-2 font-semibold text-primary-foreground">{tool.title}</h3><p className="text-sm leading-relaxed text-primary-foreground/60">{tool.description}</p></motion.div>)}</div>
          </div>
        </section>

        <section className="section-sm bg-muted">
          <div className="container-wide"><div className="grid items-center gap-12 lg:grid-cols-2">
            <div><span className="mb-5 inline-flex items-center gap-2 rounded-full bg-sage-light px-4 py-2 text-sm font-semibold text-sage-dark"><Headphones aria-hidden="true" className="h-4 w-4" />Managed Vendor Support</span><h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">We Don&apos;t Just Send You Jobs. We Help You Succeed.</h2><p className="mb-8 text-lg text-muted-foreground">Mercurius combines hands-on local support with clear pricing and job-management tools, helping you reduce admin while delivering a professional homeowner experience.</p><div className="space-y-6">{supportFeatures.map((feature) => <div key={feature.title} className="flex gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10"><feature.icon aria-hidden="true" className="h-5 w-5 text-accent" /></div><div><p className="mb-1 font-semibold text-foreground">{feature.title}</p><p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p></div></div>)}</div></div>
            <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="relative"><div className="rounded-2xl border border-border/30 bg-card p-8 shadow-sm"><div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15"><Headphones aria-hidden="true" className="h-5 w-5 text-accent" /></div><div><p className="text-sm font-semibold text-foreground">Platform Guidance</p><p className="text-xs text-muted-foreground">Examples from the vendor workflow</p></div></div><div className="space-y-4">{supportExamples.map((item) => <div key={item.label} className="rounded-xl bg-muted p-4"><p className="mb-1 text-xs font-medium text-muted-foreground">{item.label}</p><p className="text-sm leading-relaxed text-foreground">{item.text}</p></div>)}</div></div></motion.div>
          </div></div>
        </section>

        <section className="section-sm bg-background">
          <div className="container-wide"><div className="grid items-center gap-12 lg:grid-cols-2">
            <div><h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">What We Look For</h2><p className="mb-8 text-lg text-muted-foreground">We partner with professionals who share our commitment to quality and reliability.</p><ul className="space-y-4">{requirements.map((requirement) => <li key={requirement} className="flex items-start gap-3"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><span className="text-foreground">{requirement}</span></li>)}</ul></div>
            <div className="rounded-2xl border border-border/30 bg-card p-8"><h3 className="mb-4 text-xl font-semibold text-foreground">Ready to Apply?</h3><p className="mb-6 text-muted-foreground">Our application takes about 10 minutes. We review all applications within 3 business days.</p><Link href="/vendors/apply" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full bg-accent px-8 text-accent-foreground hover:bg-accent/90")}>Start Application <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" /></Link><p className="mt-4 text-center text-sm text-muted-foreground">Questions?{" "}<Link href="/contact" className="text-accent hover:underline">Contact us</Link></p></div>
          </div></div>
        </section>

        <section ref={ctaRef} onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setCtaGlow({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }); }} className="bg-cta-section section-sm relative overflow-hidden text-primary-foreground">
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(600px circle at ${ctaGlow.x}% ${ctaGlow.y}%, hsl(150 35% 45% / 0.18) 0%, transparent 60%)` }} />
          <div className="container-wide relative text-center"><span className="mb-4 inline-block rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90">Get started today</span><h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl">Join Our Network Today</h2><p className="mx-auto mb-8 max-w-xl text-lg text-primary-foreground/80">Take the first step toward consistent work, powerful tools, and a growing business.</p><div className="flex flex-col justify-center gap-4 sm:flex-row"><VendorLink href="/vendors/apply">Apply Now <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5" /></VendorLink><VendorLink href="/how-it-works" darkOutline>See How It Works</VendorLink></div></div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function VendorLink({ href, children, outline = false, darkOutline = false }: { href: string; children: React.ReactNode; outline?: boolean; darkOutline?: boolean }) {
  return <Link href={href} className={cn(buttonVariants({ size: "lg", variant: outline || darkOutline ? "outline" : "default" }), "h-11 px-8", !outline && !darkOutline && "bg-accent text-accent-foreground hover:bg-accent/90", outline && "border-border bg-card text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground hover:shadow-md", darkOutline && "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground transition-all duration-200 hover:bg-primary-foreground/20 hover:text-primary-foreground")}>{children}</Link>;
}
