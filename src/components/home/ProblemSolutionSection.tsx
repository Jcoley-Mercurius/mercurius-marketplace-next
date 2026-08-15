"use client";

import { motion } from "framer-motion";
import {
  Camera,
  Check,
  CreditCard,
  DollarSign,
  EyeOff,
  MessageSquareOff,
  ShieldCheck,
  ShieldOff,
  UserX,
} from "lucide-react";

const painPoints = [
  { icon: DollarSign, label: "No clear upfront pricing" },
  { icon: MessageSquareOff, label: "Awkward back-and-forth negotiation" },
  { icon: ShieldOff, label: "No accountability when work falls short" },
  { icon: EyeOff, label: "No proof the work was done right" },
  { icon: UserX, label: "Hard to push back when things go wrong" },
];

const solutionBullets = [
  {
    icon: CreditCard,
    title: "Transparent pricing",
    detail:
      "fixed packages show the price before you commit; custom jobs get a quote you approve first.",
  },
  {
    icon: ShieldCheck,
    title: "Real accountability",
    detail: "we manage the provider and follow up until the job is right.",
  },
  {
    icon: Camera,
    title: "Photo proof",
    detail:
      "timestamped photos in your dashboard, even when you're not home.",
  },
];

const guarantees = [
  "Clear Price",
  "Managed Job",
  "Photo Proof",
];

export function ProblemSolutionSection() {
  return (
    <section className="section relative overflow-hidden bg-noise band-white band-divider">
      <div className="container-wide relative">
        <motion.div
          className="mb-14 max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          <span className="eyebrow mb-5">Why Mercurius</span>
          <h2 className="headline-primary mb-4 text-foreground">
            The Problem Isn&apos;t Finding a Vendor. It&apos;s Everything After
            That.
          </h2>
          <p className="max-w-xl text-base text-muted-foreground md:text-lg">
            Hiring home services is frustrating, unclear, and awkward.
            Mercurius fixes the process, not just the search.
          </p>
        </motion.div>

        <div className="relative mb-16 grid gap-10 lg:grid-cols-2 lg:gap-0">
          <div className="absolute bottom-0 left-1/2 top-0 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent lg:block" />

          <motion.div
            className="relative lg:pr-14"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
          >
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-destructive/60">
              Without Mercurius
            </span>
            <h3 className="mb-3 mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-foreground md:text-3xl">
              You&apos;re on Your Own With Every Provider
            </h3>
            <p className="mb-9 max-w-lg text-sm text-muted-foreground">
              You call, you negotiate, you hope the price is fair. If something
              goes wrong, it&apos;s your word against theirs. No proof, no
              follow-up, no backup.
            </p>

            <div className="relative">
              <ol className="space-y-5">
                {painPoints.map((item, index) => (
                  <li
                    key={item.label}
                    className="relative flex items-center gap-4 before:absolute before:-left-4 before:top-1/2 before:h-px before:w-3 before:bg-destructive/25 before:content-['']"
                    style={{
                      marginLeft: `${index * 14}px`,
                      opacity: 1 - index * 0.08,
                    }}
                  >
                    <span className="relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 border-destructive/25 bg-background">
                      <item.icon className="h-3.5 w-3.5 text-destructive/70" />
                    </span>
                    <span className="text-sm font-medium text-muted-foreground line-through decoration-destructive/30 decoration-1">
                      {item.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </motion.div>

          <motion.div
            className="relative lg:-mt-10 lg:pl-14"
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <div
              className="theme-sage-panel rounded-[2rem] border p-7 backdrop-blur-xl md:p-9"
            >
              <span className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-accent">
                With Mercurius
              </span>
              <h3 className="mb-3 mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-foreground md:text-3xl">
                Mercurius Handles the Hard Parts for You
              </h3>
              <p className="mb-8 max-w-lg text-sm text-muted-foreground">
                Fixed-package pricing is clear before you book, and custom work
                is quoted for your approval. Communication goes through the
                platform. And if you&apos;re not home, you still get photo proof.
              </p>

              <div className="relative mb-8">
                <div className="absolute bottom-2 left-[13px] top-2 w-0.5 rounded-full bg-accent/40" />
                <ol className="space-y-6">
                  {solutionBullets.map((item) => (
                    <li
                      key={item.title}
                      className="relative flex items-start gap-4"
                    >
                      <span className="relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent shadow-sm">
                        <item.icon className="h-3.5 w-3.5 text-accent-foreground" />
                      </span>
                      <span className="pt-0.5 text-sm text-foreground">
                        <span className="font-display font-bold">
                          {item.title}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}— {item.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {guarantees.map((label) => (
                  <div
                    key={label}
                    className="theme-glass-subtle flex items-center justify-center gap-2 rounded-full border px-3 py-2.5 backdrop-blur-sm"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="text-xs font-medium text-foreground">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          className="mx-auto max-w-2xl text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5 }}
        >
          <p className="font-display text-base font-semibold text-foreground md:text-lg">
            Managed end to end · Priced before booking · Photo-documented
          </p>
        </motion.div>
      </div>
    </section>
  );
}
