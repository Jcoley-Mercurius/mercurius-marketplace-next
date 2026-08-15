"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { BenefitsStrip } from "@/components/homeowners/BenefitsStrip";
import { HomeownersHeroSection } from "@/components/homeowners/HeroSection";
import { TestimonialSpotlight } from "@/components/homeowners/TestimonialSpotlight";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = [
  { step: "1", title: "Pick Your Services", desc: "Use our Plan Builder to choose lawn care, cleaning, repairs, or more." },
  { step: "2", title: "We Coordinate a Match", desc: "Mercurius helps source a vetted local provider, confirms service fit and pricing, and coordinates scheduling based on availability." },
  { step: "3", title: "Follow the Work", desc: "Track job status, service details, and completion photos in your homeowner dashboard." },
];

export default function HomeownersPage() {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HomeownersHeroSection />
        <BenefitsStrip />
        <TestimonialSpotlight />

        <section className="section-sm bg-background">
          <div className="container-wide">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <h2 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">Getting Started is Easy</h2>
            </div>
            <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3">
              {steps.map((item, index) => (
                <motion.div key={item.step} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.15, duration: 0.5 }} className="text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent"><span className="font-sans text-2xl font-bold text-accent-foreground">{item.step}</span></div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{item.title}</h3>
                  <p className="text-muted-foreground">{item.desc}</p>
                </motion.div>
              ))}
            </div>
            <div className="mt-10 text-center">
              <Link href="/#bundle-builder" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-8 text-accent-foreground hover:bg-accent-hover")}>Get Started <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </div>
          </div>
        </section>

        <section
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMousePos({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
          }}
          className="bg-cta-section section-sm relative overflow-hidden text-primary-foreground"
        >
          <div className="pointer-events-none absolute inset-0 transition-opacity duration-300" style={{ background: `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, hsl(150 35% 45% / 0.18) 0%, transparent 60%)` }} />
          <div className="container-wide relative text-center">
            <span className="mb-4 inline-block rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90">Get started today</span>
            <h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl">Ready to Simplify Your Home Maintenance?</h2>
            <p className="mx-auto mb-8 max-w-xl text-lg text-primary-foreground/80">Built for homeowners across Fort Myers &amp; Cape Coral who want less service coordination and more of their weekends back.</p>
            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <Link href="/#bundle-builder" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-8 text-accent-foreground hover:bg-accent-hover")}>Build My Home Plan <ArrowRight className="ml-2 h-5 w-5" /></Link>
              <Link href="/services" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11 border-primary-foreground/30 bg-primary-foreground/10 px-8 text-primary-foreground transition-all duration-200 hover:bg-primary-foreground/20 hover:text-primary-foreground")}>Browse Services</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
