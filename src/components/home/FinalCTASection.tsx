"use client";

import { useCallback, useRef, useState } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EARLY_ACCESS_CTA, EARLY_ACCESS_PATH } from "@/lib/earlyAccessExperience";

export function FinalCTASection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [glow, setGlow] = useState({ x: 50, y: 50 });

  const handleMouseMove = useCallback((event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setGlow({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  }, []);

  return (
    <section
      ref={sectionRef}
      onMouseMove={handleMouseMove}
      className="section bg-cta-section relative overflow-hidden text-primary-foreground"
    >
      <div
        className="pointer-events-none absolute h-[500px] w-[500px] rounded-full opacity-60 blur-[120px] transition-[left,top,opacity] duration-500"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 35%, transparent) 0%, transparent 70%)",
          left: `${glow.x}%`,
          top: `${glow.y}%`,
          transform: "translate(-50%, -50%)",
        }}
      />

      <div className="container-wide relative">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-primary-foreground/10 bg-primary-foreground/5 p-8 backdrop-blur-sm md:p-10">
            <span className="mb-4 inline-block rounded-full bg-accent/20 px-3 py-1 text-xs font-medium text-accent-on-dark ring-1 ring-accent/30">
              For Homeowners
            </span>
            <h2 className="mb-3 text-2xl font-bold leading-tight !text-primary-foreground md:text-3xl">
              Predictable, Accountable, Stress-Free Home Services.
            </h2>
            <p className="mb-6 text-primary-foreground/70">
              Clear pricing. Managed jobs. Photo proof. One platform between you
              and your provider.
            </p>
            <Link
              href={EARLY_ACCESS_PATH}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 w-full gap-2 rounded-md bg-accent px-8 text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent-hover active:bg-accent-active sm:w-auto",
              )}
            >
              {EARLY_ACCESS_CTA} <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </div>

          <div className="rounded-3xl border border-primary-foreground/10 bg-primary-foreground/5 p-8 backdrop-blur-sm md:p-10">
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-coral/20 px-3 py-1 text-xs font-medium text-coral ring-1 ring-coral/30">
              <Briefcase className="h-3 w-3" />
              For Providers
            </span>
            <h2 className="mb-3 text-2xl font-bold leading-tight !text-primary-foreground md:text-3xl">
              Grow Your Business With Mercurius.
            </h2>
            <p className="mb-6 text-primary-foreground/70">
              Matched local opportunities, package pricing tools, and less admin
              between you and the next job.
            </p>
            <Link
              href="/vendors/apply"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 w-full gap-2 rounded-md bg-coral px-8 text-coral-foreground shadow-lg shadow-coral/20 hover:bg-coral-hover active:bg-coral-dark sm:w-auto",
              )}
            >
              Apply as Provider <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
