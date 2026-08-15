"use client";

import { RevealItem, ScrollReveal } from "@/components/home/ScrollReveal";

const experienceStatements = [
  {
    id: "simple-booking",
    statement:
      "Choose a service without calling, texting, or negotiating. See a clear price when available, then receive updates and completion photos in one place.",
  },
  {
    id: "reliable-coordination",
    statement:
      "Keep service coordination, pricing, and photo updates together—without chasing a provider across calls and texts.",
  },
  {
    id: "managed-follow-up",
    statement:
      "When a job needs follow-up, have Mercurius coordinate the next steps instead of managing the issue alone.",
  },
];

export function TestimonialsSection() {
  return (
    <section className="section relative overflow-hidden bg-noise band-cream band-divider">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 top-10 hidden h-[34rem] w-[34rem] bg-accent opacity-[0.055] [mask-image:url('/mercurius-logo.png')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url('/mercurius-logo.png')] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain] md:block xl:-right-8 xl:h-[40rem] xl:w-[40rem]"
      />
      <div className="container-wide relative z-10">
        <div className="mb-12 max-w-2xl">
          <span className="eyebrow mb-5 text-coral-dark before:!bg-coral">
            Why Homeowners Switch
          </span>
          <h2 className="headline-support mb-4 text-foreground">
            No More Chasing Contractors
          </h2>
          <p className="text-lg text-muted-foreground">
            Common frustrations homeowners want to leave behind—and the calmer,
            managed experience Mercurius is designed to provide.
          </p>
        </div>

        <ScrollReveal staggerChildren={0.15}>
          <div className="grid gap-8 md:grid-cols-3">
            {experienceStatements.map((experience, index) => (
              <RevealItem key={experience.id} className="h-full">
                <div
                  className={`h-full rounded-2xl border border-border/30 bg-card transition-shadow duration-300 ${
                    index === 0
                      ? "card-priority border-accent-border p-9 pt-10"
                      : "elev-1 hover:elev-2 p-8"
                  }`}
                >
                  <p className="text-lg text-foreground">
                    {experience.statement}
                  </p>
                </div>
              </RevealItem>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
