"use client";

import Image from "next/image";
import { motion } from "framer-motion";

const steps = [
  { number: "01", title: "Choose the services you need", description: "Browse from 40+ home services across lawn care, cleaning, repairs, HVAC and more." },
  { number: "02", title: "Select trusted local providers", description: "Provider applications include license, insurance, and background-check documentation for review before joining the network." },
  { number: "03", title: "Schedule services and confirm pricing", description: "Set your preferred schedule and confirm upfront pricing on fixed packages before you book." },
  { number: "04", title: "Manage everything from your dashboard", description: "Track jobs, view photos, message providers, and manage payments in one place." },
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.2 } },
};

const headerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function HowItWorksSteps() {
  return (
    <section className="section relative overflow-hidden bg-noise band-gray band-divider">
      <motion.div
        className="container-wide relative"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
      >
        <motion.div className="mb-14 max-w-3xl md:mb-20 lg:pr-24" variants={headerVariants}>
          <span className="eyebrow mb-5">How It Works</span>
          <h2 className="headline-primary mb-4 text-foreground">How Mercurius Works</h2>
          <p className="max-w-xl text-lg text-muted-foreground">
            From choosing services to managing your home. Four simple steps.
          </p>
        </motion.div>

        <div className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <motion.div key={step.number} className="relative" variants={cardVariants}>
              <div className="relative h-full border-t-2 border-foreground/10 pt-5">
                <div className="mb-4 flex items-baseline gap-3">
                  <span className={`font-display text-2xl font-extrabold leading-none ${index % 2 === 1 ? "text-coral" : "text-accent"}`}>
                    {step.number}
                  </span>
                  <span className={`h-0.5 w-10 rounded-full ${index % 2 === 1 ? "bg-coral/40" : "bg-accent/40"}`} />
                </div>
                <h3 className="mb-3 font-display text-xl font-bold leading-snug tracking-tight text-foreground">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div variants={cardVariants} className="elev-3 relative mt-16 overflow-hidden rounded-3xl border border-border/40 lg:-mr-12 lg:mt-24">
          <Image
            src="/how-it-works-pro.jpg"
            alt="Vetted Mercurius service professional at a Cape Coral home"
            width={1600}
            height={912}
            className="h-[260px] w-full object-cover md:h-[340px] lg:object-[center_12%]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/70 via-primary/25 to-transparent" />
          <div className="bg-motif-lines pointer-events-none absolute inset-0 opacity-40" />
          <div className="absolute inset-0 flex items-center">
            <div className="max-w-md px-8 md:px-12">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground/80">Vetted, Insured, Managed</p>
              <p className="font-display text-xl font-bold leading-snug text-primary-foreground md:text-2xl">
                Browse active provider profiles, compare available package pricing, and request coordination through Mercurius.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
