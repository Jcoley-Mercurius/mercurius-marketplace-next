"use client";

import { Star } from "lucide-react";
import { RevealItem, ScrollReveal } from "@/components/home/ScrollReveal";
import { formatPublicReviewerName } from "@/lib/reviews/publicIdentity";

const testimonials = [
  {
    quote:
      "I didn't have to call, text, or negotiate with anyone. I picked a service, got a clear price, and the job was done. I got photos after. That's it.",
    author: "Sarah M.",
    role: "Homeowner",
    rating: 5,
  },
  {
    quote:
      "My lawn guy used to ghost me for weeks. Now everything goes through Mercurius. Clear pricing, photo updates, and I never have to chase anyone down.",
    author: "Michael R.",
    role: "Homeowner",
    rating: 5,
  },
  {
    quote:
      "The follow-up alone sold me. When a gutter cleaning went wrong, I didn't have to argue with the contractor. Mercurius handled it.",
    author: "Jennifer L.",
    role: "Property Manager",
    rating: 5,
  },
];

export function TestimonialsSection() {
  return (
    <section className="section relative overflow-hidden bg-noise band-cream band-divider">
      <div className="container-wide relative">
        <div className="mb-12 max-w-2xl">
          <span className="eyebrow mb-5 text-coral-dark before:!bg-coral">
            Customer Reviews
          </span>
          <h2 className="headline-support mb-4 text-foreground">
            No More Chasing Contractors
          </h2>
          <p className="text-lg text-muted-foreground">
            Real homeowners on how Mercurius removed the friction from hiring
            local services.
          </p>
        </div>

        <ScrollReveal staggerChildren={0.15}>
          <div className="grid gap-8 md:grid-cols-3">
            {testimonials.map((testimonial, index) => (
              <RevealItem key={testimonial.author} className="h-full">
                <div
                  className={`h-full rounded-2xl border border-border/30 bg-card transition-shadow duration-300 ${
                    index === 0
                      ? "card-priority border-accent-border p-9 pt-10"
                      : "elev-1 hover:elev-2 p-8"
                  }`}
                >
                  <div className="mb-4 flex gap-1">
                    {Array.from({ length: testimonial.rating }, (_, star) => (
                      <Star
                        key={star}
                        className="h-5 w-5 fill-warning text-warning"
                      />
                    ))}
                  </div>
                  <p className="mb-6 text-lg text-foreground">
                    <span className="font-serif text-2xl text-coral">
                      &quot;
                    </span>
                    {testimonial.quote}
                    <span className="font-serif text-2xl text-coral">
                      &quot;
                    </span>
                  </p>
                  <div>
                    <p className="font-semibold text-foreground">
                      {formatPublicReviewerName(testimonial.author)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {testimonial.role}
                    </p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
