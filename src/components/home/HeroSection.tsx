"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Lock,
  Shield,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-hero bg-noise">
      <div className="bg-pattern absolute inset-0 opacity-20" />
      <div className="bg-motif-lines pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute left-1/4 top-0 h-[400px] w-[600px] rounded-full bg-accent/8 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />

      <div className="container-wide relative">
        <div className="grid items-center gap-12 py-12 md:py-16 lg:grid-cols-2 lg:py-20">
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex items-center gap-2.5 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-sage-dark"
            >
              <span className="h-px w-8 flex-shrink-0 bg-sage" />
              <Shield className="h-3.5 w-3.5 flex-shrink-0" />
              Managed home services for Cape Coral &amp; Fort Myers
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
              className="text-5xl font-bold leading-[1.08] tracking-tight text-foreground md:text-6xl lg:text-7xl"
            >
              Home Services,
              <br />
              <span className="hero-gradient-text">
                Without the Awkward Parts.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.45 }}
              className="max-w-lg text-lg leading-relaxed text-muted-foreground md:text-xl"
            >
              No haggling. No chasing. Upfront pricing on fixed packages.
              Mercurius is the managed home services platform for Cape Coral
              &amp; Fort Myers — our team picks the vetted pro, manages the job,
              and follows up until it&apos;s right.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"
            >
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-coral" />
                Upfront, Transparent Pricing
              </span>
              <span className="flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-sage" />
                Hands-On Job Management
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-sage" />
                Photo Proof of Completed Work
              </span>
              <span className="flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-coral" />
                Platform-Managed Communication
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.75 }}
              className="flex flex-col gap-4 sm:flex-row"
            >
              <Link
                href="#bundle-builder"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "btn-hero-primary h-11 gap-2 rounded-md bg-accent px-8 text-base shadow-md shadow-accent/25 transition-all duration-300 hover:shadow-lg hover:shadow-accent/30",
                )}
              >
                Build My Home Plan <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
              <Link
                href="/services"
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "h-11 gap-2 rounded-md border-border bg-card px-8 text-base text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground hover:shadow-md",
                )}
              >
                Browse Services
              </Link>
            </motion.div>

          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="relative lg:h-[560px] lg:rotate-[1.5deg]"
          >
            <div className="pointer-events-none absolute -inset-3 rounded-[2rem] border border-accent-border lg:-rotate-[2.5deg]" />
            <Image
              src="/hero-home-duotone.jpg"
              alt="Stylized duotone illustration of a managed Southwest Florida home"
              width={1200}
              height={1408}
              priority
              className="h-full w-full rounded-[1.75rem] object-cover shadow-xl shadow-slate/10"
            />

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="theme-glass absolute -bottom-6 -left-6 rounded-2xl border p-4 backdrop-blur-xl"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sage-light">
                  <CheckCircle2 className="h-6 w-6 text-sage" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Completion update</p>
                  <p className="text-sm text-muted-foreground">
                    Photo proof received
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.85 }}
              className="theme-glass absolute -right-4 -top-4 rounded-2xl border px-4 py-3 backdrop-blur-xl"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sage-light">
                  <Shield className="h-4 w-4 text-sage" />
                </div>
                <span className="text-sm font-semibold text-foreground">Mercurius managed</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Protected service coordination
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
