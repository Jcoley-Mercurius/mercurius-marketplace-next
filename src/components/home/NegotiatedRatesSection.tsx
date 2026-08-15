"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Phone, X, CheckCircle2, TrendingDown, Tag, Handshake, ShieldCheck, Sparkles, Award, DollarSign, Gift, Rocket } from "lucide-react";

/**
 * Live Package Rates Section
 * Presents current package pricing from active vendors so homeowners can
 * review available rates without calling around.
 */
const NegotiatedRatesSection = () => {
  return (
    <section className="section bg-background relative overflow-hidden">
      {/* Subtle background accent */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-sage/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-coral/5 rounded-full blur-3xl pointer-events-none" />

      <div className="container-wide relative">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-coral-light text-coral-dark text-sm font-medium mb-5"
          >
            <Handshake className="h-4 w-4" />
            Live Coverage, Clearly Priced
          </motion.span>

          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-foreground mb-5"
          >
            Real Vendor Rates, <span className="text-gradient">When Available</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-muted-foreground"
          >
            When vetted vendors actively cover a service, we show their real package pricing. When they don&apos;t,
            we say so clearly and let you ask us to source the right local pro.
          </motion.p>
        </div>

        {/* Comparison: Old Way vs Mercurius Way */}
        <div className="grid md:grid-cols-2 gap-6 mb-16 max-w-5xl mx-auto">
          {/* Old Way */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="bg-card rounded-2xl p-6 md:p-8 border border-border/40 relative"
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="h-11 w-11 rounded-xl bg-destructive/10 flex items-center justify-center">
                <Phone className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">The Old Way</p>
                <h3 className="text-lg font-semibold text-foreground">Calling Around</h3>
              </div>
            </div>

            <ul className="space-y-3">
              {[
                "Call 4-6 contractors for quotes",
                "Wait days for callbacks (if any)",
                "Compare apples-to-oranges pricing",
                "Get up-charged for being new",
                "No leverage, no recourse if it goes wrong",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <X className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Mercurius Way */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-gradient-to-br from-sage-light to-card rounded-2xl p-6 md:p-8 border-2 border-accent/30 relative shadow-sm"
          >
            <div className="absolute -top-3 right-4 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-semibold">
              The Mercurius Way
            </div>

            <div className="flex items-center gap-3 mb-5">
              <div className="h-11 w-11 rounded-xl bg-accent flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-sage-dark">Done For You</p>
                <h3 className="text-lg font-semibold text-foreground">Live Package Rates</h3>
              </div>
            </div>

            <ul className="space-y-3">
              {[
                "Live prices come from active vendor packages",
                "Quote-based work is labeled before you request it",
                "No catalog estimate presented as current coverage",
                "Uncovered services stay requestable",
                "If quality falls short, we work with the provider to make it right",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>

        {/* How live package rates work — three pillars */}
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h3 className="text-2xl md:text-3xl font-bold text-foreground mb-3">How Launch Pricing Works</h3>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Coverage is growing service by service. We prioritize current vendor data, clear quote expectations,
              and an honest sourcing path when a provider is not yet active.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: TrendingDown,
                title: "Live Package Pricing",
                desc: "Fixed prices shown here come from active vendor packages, not a generic market estimate.",
                stat: "Live data",
                statLabel: "when a package is active",
              },
              {
                icon: ShieldCheck,
                title: "Vetted Network Only",
                desc: "Coverage only counts when an active provider is connected to the service on our platform.",
                stat: "Vetted",
                statLabel: "active provider coverage",
              },
              {
                icon: Tag,
                title: "Request Any Service",
                desc: "If coverage is not live yet, submit your need and our team can source a qualified local pro.",
                stat: "Still open",
                statLabel: "interest and sourcing requests",
              },
            ].map((pillar, idx) => (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="bg-card rounded-2xl p-6 border border-border/40 hover:border-accent/30 hover:shadow-md transition-all duration-300"
              >
                <div className="h-12 w-12 rounded-xl bg-sage-light flex items-center justify-center mb-5">
                  <pillar.icon className="h-6 w-6 text-sage-dark" />
                </div>
                <h4 className="text-lg font-semibold text-foreground mb-2">{pillar.title}</h4>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{pillar.desc}</p>
                <div className="pt-4 border-t border-border/40">
                  <p className="text-2xl font-bold text-accent">{pillar.stat}</p>
                  <p className="text-xs text-muted-foreground">{pillar.statLabel}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Smart Picks Legend — 4 handpicked vendors per service */}
        <div className="max-w-5xl mx-auto mt-20">
          <div className="text-center mb-10">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-sage-light text-sage-dark text-sm font-medium mb-4"
            >
              <Sparkles className="h-4 w-4" />
              Our Picks For You
            </motion.span>
            <h3 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
              Compare what matters when options are available
            </h3>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              As coverage grows, these labels explain why a provider stands out. They appear only when live provider
              data supports the distinction.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                icon: Award,
                label: "Top Rated",
                tagline: "Strong platform record",
                desc: "An editorial label for an active provider with a strong live platform record.",
                gradient: "from-[hsl(40,60%,94%)] to-[hsl(35,50%,88%)]",
                border: "border-[hsl(38,45%,78%)]",
                iconBg: "bg-[hsl(40,55%,92%)]",
                iconColor: "text-[hsl(36,60%,40%)]",
              },
              {
                icon: DollarSign,
                label: "Smart Choice",
                tagline: "Current package value",
                desc: "An editorial label for an active provider whose current package pricing offers practical value.",
                gradient: "from-[hsl(140,25%,93%)] to-[hsl(145,20%,87%)]",
                border: "border-[hsl(142,22%,76%)]",
                iconBg: "bg-[hsl(140,22%,91%)]",
                iconColor: "text-[hsl(142,30%,38%)]",
              },
              {
                icon: Gift,
                label: "Extra Perks",
                tagline: "Clearly listed extras",
                desc: "An editorial label for an active provider whose current package includes clearly listed extras.",
                gradient: "from-[hsl(15,50%,94%)] to-[hsl(12,45%,88%)]",
                border: "border-[hsl(14,40%,78%)]",
                iconBg: "bg-[hsl(15,45%,92%)]",
                iconColor: "text-[hsl(14,55%,42%)]",
              },
              {
                icon: Rocket,
                label: "Rising Star",
                tagline: "Building a platform record",
                desc: "An editorial label for a newer active provider building a live platform record.",
                gradient: "from-[hsl(215,15%,92%)] to-[hsl(220,12%,85%)]",
                border: "border-[hsl(218,12%,75%)]",
                iconBg: "bg-[hsl(215,12%,90%)]",
                iconColor: "text-[hsl(218,20%,40%)]",
              },
            ].map((pick, idx) => (
              <motion.div
                key={pick.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.08 }}
                className={`relative rounded-2xl border-2 ${pick.border} p-5 overflow-hidden bg-card hover:shadow-md transition-all`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${pick.gradient} opacity-50 pointer-events-none`} />
                <div className="relative z-10">
                  <div className={`h-11 w-11 rounded-xl ${pick.iconBg} flex items-center justify-center mb-4`}>
                    <pick.icon className={`h-5 w-5 ${pick.iconColor}`} />
                  </div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{pick.tagline}</p>
                  <h4 className="text-lg font-semibold text-foreground mb-2">{pick.label}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{pick.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            The Mercurius team assigns these editorial labels to active providers based on their live platform record;
            they are not automatically generated rankings.
          </p>
        </div>

        {/* Bottom CTA strip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-14 bg-cta-section rounded-3xl p-8 md:p-10 text-center relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative">
            <Sparkles className="h-7 w-7 text-accent mx-auto mb-4" />
            <h3 className="text-2xl md:text-3xl font-bold text-primary-foreground mb-3">
              Check coverage or tell us what you need.
            </h3>
            <p className="text-primary-foreground/70 mb-6 max-w-xl mx-auto">
              Continue with a live-priced service, request a quote, or ask us to source a vetted provider.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/request" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-8 text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent-hover active:bg-accent-active")}>Start a Request <ArrowRight className="ml-2 h-5 w-5" /></Link>
              <Link href="/providers" className={cn(buttonVariants({ size: "lg" }), "h-11 border border-primary-foreground/30 bg-primary-foreground/10 px-8 text-primary-foreground hover:bg-primary-foreground/20")}>Browse Providers</Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default NegotiatedRatesSection;
