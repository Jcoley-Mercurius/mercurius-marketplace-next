"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Camera,
  Clock,
  CreditCard,
  FileCheck,
  Gavel,
  Handshake,
  Megaphone,
  MessageCircle,
  PackageCheck,
  PhoneCall,
  Scale,
  Shield,
  ShieldCheck,
  Tag,
  TrendingDown,
  TrendingUp,
  Upload,
  UserCheck,
  Wrench,
} from "lucide-react";

const negotiatedPillars = [
  {
    icon: TrendingDown,
    title: "Volume Pricing",
    desc: "We bring vendors steady, recurring work — so they offer rates they'd never give a one-off caller.",
    stat: "Up to 20% less",
  },
  {
    icon: ShieldCheck,
    title: "Vetted Network Only",
    desc: "No bottom-feeder contractors. Our pricing reflects skilled, insured, reliable pros.",
    stat: "Top 15%",
  },
  {
    icon: Tag,
    title: "Active Promotions",
    desc: "Top-rated vendors offer exclusive deals to Mercurius homeowners — refreshed monthly.",
    stat: "Always-on",
  },
];

const warrantyBullets = [
  { icon: Wrench, label: "Vendors Held to Our Workmanship Standards" },
  { icon: PackageCheck, label: "Scope and Price Agreed Before Work Starts" },
  { icon: Clock, label: "Job Records and Photos Stored on the Platform" },
  { icon: PhoneCall, label: "Raise an Issue Directly Through Mercurius" },
  { icon: Gavel, label: "Mercurius Mediates and Holds Vendors Accountable" },
  { icon: UserCheck, label: "Resolution Tracked Until the Issue Is Fixed" },
];

const homeownerPoints = [
  { icon: CreditCard, label: "Clear, Upfront Pricing on Fixed Packages" },
  { icon: ShieldCheck, label: "We Follow Up Until the Job Is Right" },
  { icon: Camera, label: "Photo Proof of Completed Work" },
  { icon: MessageCircle, label: "All Communication Through the Platform" },
  { icon: Scale, label: "Mercurius Mediates Disputes for You" },
  { icon: FileCheck, label: "Vendor Accountability Built Into Every Job" },
];

const vendorPoints = [
  { icon: Shield, label: "Protection From False or Unfair Claims" },
  { icon: Upload, label: "Upload Job Photos as Documentation" },
  { icon: BarChart3, label: "Performance Insights and Rankings" },
  { icon: TrendingUp, label: "More Jobs Through Reliability" },
  { icon: Megaphone, label: "Marketing and Growth Tools" },
  { icon: AlertTriangle, label: "Escalation and Dispute Support" },
];

export function TrustPositioningSection() {
  return (
    <section className="section relative overflow-hidden bg-noise band-mint band-divider">
      <div className="container-wide relative">
        <motion.div
          className="mx-auto mb-16 max-w-5xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          <div className="mb-10 text-center">
            <span className="eyebrow eyebrow-center mb-5 text-coral-dark before:!bg-coral after:!bg-coral">
              <Handshake className="h-3.5 w-3.5" />
              We Did the Haggling for You
            </span>
            <h2 className="headline-primary mb-3 text-foreground">
              The Best Rates, Pre-Negotiated
            </h2>
            <p className="mx-auto max-w-2xl text-base text-muted-foreground md:text-lg">
              No calling around. No haggling tax. We&apos;ve already negotiated
              industry-best rates with our vetted vendors.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {negotiatedPillars.map((pillar, index) => (
              <div
                key={pillar.title}
                className="elev-1 hover:elev-2 relative flex items-start gap-4 overflow-hidden rounded-2xl border border-border/40 bg-card p-6 pl-7 transition-shadow duration-300"
              >
                <span
                  className={`absolute bottom-0 left-0 top-0 w-1.5 ${
                    index === 1 ? "bg-coral" : "bg-accent"
                  }`}
                />
                <pillar.icon
                  className={`mt-0.5 h-6 w-6 flex-shrink-0 ${
                    index === 1 ? "text-coral" : "text-sage-dark"
                  }`}
                />
                <div>
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <h4 className="font-display text-base font-bold text-foreground">
                      {pillar.title}
                    </h4>
                    <span className="text-xs font-bold uppercase tracking-wider text-accent">
                      {pillar.stat}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {pillar.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="mb-10 max-w-3xl lg:pr-20">
          <span className="eyebrow mb-5">Built for Both Sides</span>
          <h2 className="headline-support mb-4 text-foreground">
            Mercurius Protects Homeowners and Vendors.
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Every job is documented with photo proof, managed by our team, and
            mediated by us if anything goes wrong.
          </p>
        </div>

        <motion.div
          className="elev-2 mb-8 overflow-hidden rounded-3xl border border-accent/20 bg-accent/5 p-8 md:p-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          <div className="grid items-start gap-8 md:grid-cols-2">
            <div className="text-center md:text-left">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 md:mx-0">
                <ShieldCheck className="h-7 w-7 text-accent" />
              </div>
              <h3 className="mb-3 text-2xl font-bold text-foreground md:text-3xl">
                Every Job Is Documented and Accountable.
              </h3>
              <p className="mb-6 text-base text-muted-foreground md:text-lg">
                Scope, price, and completion photos for every job live on the
                platform. If something goes wrong, we step in and hold the
                provider accountable. No runaround, no &quot;he said, she
                said.&quot;
              </p>
              <ul className="space-y-3 text-left">
                {warrantyBullets.map((point) => (
                  <li key={point.label} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                      <point.icon className="h-4 w-4 text-accent" />
                    </div>
                    <span className="text-sm text-foreground">{point.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-center">
              <Image
                src="/warranty-illustration.webp"
                alt="Documented service record with completion photos and verified job seal"
                width={1024}
                height={1536}
                className="elev-3 h-auto w-full max-w-sm rounded-2xl"
              />
            </div>
          </div>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
          <ProtectionCard
            title="For Homeowners"
            points={homeownerPoints}
            quote="We don't just connect you with a provider. We make sure the job gets done right, and you have proof."
          />
          <ProtectionCard
            title="For Vendors"
            points={vendorPoints}
            quote="We help you grow your business while protecting your reputation with real documentation."
            delay={0.1}
          />
        </div>
      </div>
    </section>
  );
}

type ProtectionCardProps = {
  title: string;
  points: typeof homeownerPoints;
  quote: string;
  delay?: number;
};

function ProtectionCard({
  title,
  points,
  quote,
  delay = 0,
}: ProtectionCardProps) {
  return (
    <motion.div
      className="elev-1 rounded-2xl border border-border/30 bg-card p-8 md:p-10"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay }}
    >
      <h3 className="mb-6 text-xl font-semibold text-foreground">{title}</h3>
      <ul className="mb-8 space-y-4">
        {points.map((point) => (
          <li key={point.label} className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sage-light">
              <point.icon className="h-4 w-4 text-sage-dark" />
            </div>
            <span className="text-foreground">{point.label}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border pt-6 text-sm font-semibold text-sage-dark">
        &quot;{quote}&quot;
      </p>
    </motion.div>
  );
}
