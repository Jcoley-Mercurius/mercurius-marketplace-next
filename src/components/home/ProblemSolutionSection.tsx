"use client";

import { motion } from "framer-motion";
import {
  Camera,
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
  { label: "Clear Price", pct: 100 },
  { label: "Managed Job", pct: 100 },
  { label: "Photo Proof", pct: 90 },
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
              className="rounded-[2rem] border p-7 backdrop-blur-xl md:p-9"
              style={{
                background:
                  "linear-gradient(135deg, hsl(150 25% 97% / 0.75) 0%, hsl(150 20% 93% / 0.55) 100%)",
                borderColor:
                  "color-mix(in srgb, var(--color-accent) 20%, transparent)",
                boxShadow:
                  "0 24px 60px -20px color-mix(in srgb, var(--color-accent) 25%, transparent), inset 0 1px 0 hsl(0 0% 100% / 0.6)",
              }}
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
                {guarantees.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border p-3 backdrop-blur-sm"
                    style={{
                      background: "hsl(0 0% 100% / 0.55)",
                      borderColor:
                        "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                      boxShadow:
                        "inset 0 1px 0 hsl(0 0% 100% / 0.6)",
                    }}
                  >
                    <div className="mb-2 flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-accent" />
                      <span className="text-xs font-medium text-foreground">
                        {item.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Standard
                    </div>
                    <div className="mt-1.5 h-1 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent/40"
                        style={{ width: `${item.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          className="mx-auto grid max-w-2xl grid-cols-3 gap-4"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5 }}
        >
          {[
            { value: "100%", label: "Jobs managed end to end" },
            { value: "Upfront", label: "Pricing before you book" },
            { value: "Every", label: "Job photo-verified" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-xl font-extrabold text-accent md:text-2xl lg:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-xs text-muted-foreground md:text-sm">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
