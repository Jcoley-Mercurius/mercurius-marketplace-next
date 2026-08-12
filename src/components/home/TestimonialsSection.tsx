"use client";

import { RevealItem, ScrollReveal } from "@/components/home/ScrollReveal";

const testimonials = [
  {
    id: "simple-booking",
    quote:
      "Choose a service without calling, texting, or negotiating. See a clear price when available, then receive updates and completion photos in one place.",
    label: "Homeowner",
  },
  {
    id: "reliable-coordination",
    quote:
      "Keep service coordination, pricing, and photo updates together—without chasing a provider across calls and texts.",
    label: "Homeowner",
  },
  {
    id: "managed-follow-up",
    quote:
      "When a job needs follow-up, have Mercurius coordinate the next steps instead of managing the issue alone.",
    label: "Property Manager",
  },
];

export function TestimonialsSection() {
  return (
    <section className="section relative overflow-hidden bg-noise band-cream band-divider">
      <div className="container-wide relative">
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
            {testimonials.map((testimonial, index) => (
              <RevealItem key={testimonial.id} className="h-full">
                <div
                  className={`relative h-full overflow-hidden rounded-2xl border border-border/30 bg-card transition-shadow duration-300 ${
                    index === 0
                      ? "card-priority border-accent-border p-9 pt-10"
                      : "elev-1 hover:elev-2 p-8"
                  }`}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-12 top-1/2 h-44 w-44 -translate-y-1/2 bg-accent opacity-[0.06] [mask-image:url('/mercurius-logo.png')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url('/mercurius-logo.png')] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain] sm:h-48 sm:w-48"
                  />
                  <p className="relative z-10 mb-6 text-lg text-foreground">
                    <span className="font-serif text-2xl text-coral">
                      &quot;
                    </span>
                    {testimonial.quote}
                    <span className="font-serif text-2xl text-coral">
                      &quot;
                    </span>
                  </p>
                  <p className="relative z-10 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {testimonial.label}
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
