"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Calendar, CheckCircle2, MessageSquare } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const notifications = [
  { icon: CheckCircle2, title: "Lawn care completed", sub: "Today at 10:30 AM • Photos uploaded", accent: "text-accent" },
  { icon: Calendar, title: "Pool service scheduled", sub: "Tomorrow at 9:00 AM", accent: "text-info" },
  { icon: MessageSquare, title: "Support replied", sub: '"Your handyman visit has been rescheduled…"', accent: "text-coral" },
];

const containerVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.15 } } };
const itemVariants = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" as const } } };
const cardVariants = { hidden: { opacity: 0, x: 40, scale: 0.95 }, visible: (index: number) => ({ opacity: 1, x: 0, scale: 1, transition: { delay: 0.3 + index * 0.18, duration: 0.7, ease: "easeOut" as const } }) };

export function HomeownersHeroSection() {
  return (
    <section className="bg-hero overflow-hidden py-14 md:py-20 lg:py-24">
      <div className="container-wide">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <motion.div variants={containerVariants} initial="hidden" animate="visible">
            <motion.span variants={itemVariants} className="mb-6 inline-block rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark">For Homeowners</motion.span>
            <motion.h1 variants={itemVariants} className="mb-6 text-4xl font-bold leading-tight text-foreground sm:text-5xl md:text-6xl">Your Home, <span className="text-gradient">Perfectly Maintained</span></motion.h1>
            <motion.p variants={itemVariants} className="mb-8 max-w-lg text-xl text-muted-foreground">Stop managing multiple contractors, chasing schedules, and worrying about quality. We handle everything so you can simply enjoy your home.</motion.p>
            <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row">
              <Link href="/#bundle-builder" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-8 text-accent-foreground hover:bg-accent/90")}>Build My Home Plan <ArrowRight className="ml-2 h-5 w-5" /></Link>
              <Link href="/services" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11 border-border bg-card px-8 text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground hover:shadow-md")}>Browse Services</Link>
            </motion.div>
          </motion.div>

          <div className="space-y-5">
            {notifications.map((card, index) => (
              <motion.div key={card.title} custom={index} variants={cardVariants} initial="hidden" animate="visible" whileHover={{ y: -4, scale: 1.02 }} className="relative rounded-2xl border border-white/40 bg-card/70 p-6 shadow-lg backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-white/20" style={{ background: "linear-gradient(135deg, hsl(40 25% 99% / 0.75) 0%, hsl(40 30% 96% / 0.6) 100%)" }}>
                <div className="relative z-10 flex items-start gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/80"><card.icon className={`h-5 w-5 ${card.accent}`} /></div><div><p className="font-display text-base font-semibold text-foreground">{card.title}</p><p className="mt-0.5 text-sm text-muted-foreground">{card.sub}</p></div></div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
