"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Calendar, Camera, CreditCard, Shield } from "lucide-react";
import { MagneticCard } from "@/components/homeowners/MagneticCard";

const benefits = [
  { icon: Shield, title: "Application-Reviewed Providers", description: "Provider applications include license, insurance, and background-check documentation for Mercurius to review before a provider joins the network.", color: "150 35% 45%" },
  { icon: Calendar, title: "Request and Coordinate Online", description: "Submit a service request online. Mercurius coordinates provider fit, availability, pricing, and scheduling from there.", color: "210 80% 55%" },
  { icon: CreditCard, title: "Transparent Pricing", description: "No hidden fees. Fixed packages show the price before you book; custom jobs are quoted for your approval.", color: "15 65% 55%" },
  { icon: Camera, title: "Completion Photos", description: "Keep completion photos and service details together in your homeowner dashboard.", color: "150 35% 45%" },
];

export function BenefitsStrip() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section className="overflow-hidden bg-background py-14 md:py-20">
      <div className="container-wide"><motion.div ref={ref} initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5 }} className="mx-auto mb-10 max-w-2xl text-center"><h2 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">Why Homeowners Love Us</h2><p className="text-lg text-muted-foreground">We built home services the way they should be. You first.</p></motion.div></div>
      <div className="relative"><div className="flex snap-x snap-mandatory gap-6 overflow-x-auto px-6 pb-4 md:px-12 lg:container-wide lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-4 lg:pb-0">{benefits.map((benefit, index) => <motion.div key={benefit.title} initial={{ opacity: 0, x: 40 }} animate={inView ? { opacity: 1, x: 0 } : {}} transition={{ delay: 0.15 + index * 0.12, duration: 0.6, ease: "easeOut" }} className="w-[280px] shrink-0 snap-start lg:w-auto"><MagneticCard glowColor={benefit.color} className="h-full rounded-2xl border border-border/30 bg-card shadow-sm"><div className="flex h-full flex-col rounded-2xl border-l-4 p-6" style={{ borderLeftColor: `hsl(${benefit.color})` }}><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: `hsl(${benefit.color} / 0.1)` }}><benefit.icon className="h-6 w-6" style={{ color: `hsl(${benefit.color})` }} /></div><h3 className="mb-2 text-lg font-semibold text-foreground">{benefit.title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{benefit.description}</p></div></MagneticCard></motion.div>)}</div></div>
    </section>
  );
}
