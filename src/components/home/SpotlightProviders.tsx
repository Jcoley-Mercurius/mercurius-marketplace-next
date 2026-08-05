"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Award,
  BadgeCheck,
  MapPin,
  Play,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type SpotlightProvider = {
  id: string;
  name: string;
  initials: string;
  rating: number;
  jobsCompleted: number;
  services: string[];
  location: string;
  headline: string;
  bio: string;
  yearsExperience: number;
  badges: string[];
};

const providers: SpotlightProvider[] = [
  {
    id: "gulf-coast-lawn-care",
    name: "Gulf Coast Lawn Care",
    initials: "GC",
    rating: 4.9,
    jobsCompleted: 347,
    services: ["Lawn Mowing", "Edging", "Hedge Trimming", "Yard Cleanup"],
    location: "Cape Coral, FL",
    headline: "Reliable weekly care, made for Southwest Florida lawns.",
    bio: "A locally owned crew known for consistent scheduling, clean edges, and careful property maintenance.",
    yearsExperience: 12,
    badges: ["Top Rated", "Insured", "Fast Response"],
  },
  {
    id: "blue-palm-pool-service",
    name: "Blue Palm Pool Service",
    initials: "BP",
    rating: 4.8,
    jobsCompleted: 281,
    services: ["Pool Cleaning", "Chemical Balance", "Filter Care", "Equipment Checks"],
    location: "Fort Myers, FL",
    headline: "Clear water, dependable visits, zero guesswork.",
    bio: "Residential pool specialists providing documented weekly service and proactive equipment monitoring.",
    yearsExperience: 9,
    badges: ["Verified Pro", "Pool Specialist", "Photo Updates"],
  },
  {
    id: "suncoast-home-care",
    name: "Suncoast Home Care",
    initials: "SH",
    rating: 5,
    jobsCompleted: 196,
    services: ["House Cleaning", "Deep Cleaning", "Move-In Care", "Snowbird Checks", "Windows"],
    location: "Cape Coral & Fort Myers",
    headline: "Thoughtful home care from a team you can trust.",
    bio: "A detail-focused cleaning and home-watch team serving busy homeowners and seasonal residents.",
    yearsExperience: 7,
    badges: ["Homeowner Favorite", "Background Checked", "Insured"],
  },
];

export function SpotlightProviders() {
  return (
    <section className="section relative overflow-hidden band-slate band-divider">
      <div className="pointer-events-none absolute left-0 top-0 h-80 w-80 rounded-full bg-coral/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-96 rounded-full bg-sage/5 blur-3xl" />

      <div className="container-wide relative">
        <div className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-coral/15">
              <Award className="h-5 w-5 text-coral" />
            </div>
            <div>
              <h2 className="text-2xl font-bold leading-tight text-foreground">
                Spotlight Providers
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Handpicked partners delivering exceptional service
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Link href="/vendors">
              View all <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {providers.map((provider, index) => (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.45,
                delay: index * 0.1,
                ease: [0.25, 0.4, 0.25, 1],
              }}
            >
              <Link
                href={`/vendor-profile/${provider.id}`}
                className="group block h-full"
              >
                <div className="relative h-full overflow-hidden rounded-2xl border border-coral/20 bg-card shadow-sm transition-all duration-300 hover:border-coral/35 hover:shadow-lg">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-coral/60 via-coral to-coral/60" />

                  <div className="p-5 sm:p-6 md:p-8">
                    <div className="mb-5 flex items-start gap-4 sm:gap-5">
                      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-br from-sage-light to-card p-1.5 shadow-sm sm:h-16 sm:w-16">
                        <span className="text-lg font-bold text-sage-dark sm:text-xl">
                          {provider.initials}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground transition-colors group-hover:text-accent sm:text-lg">
                            {provider.name}
                          </h3>
                          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-coral/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-coral ring-1 ring-coral/25">
                            <Award className="h-3 w-3" />
                            Spotlight
                          </span>
                        </div>

                        <p className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          {provider.location}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                          <div className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-coral text-coral" />
                            <span className="font-semibold text-foreground">
                              {provider.rating.toFixed(1)}
                            </span>
                          </div>
                          <span className="whitespace-nowrap text-muted-foreground">
                            {provider.jobsCompleted} jobs completed
                          </span>
                          <span className="whitespace-nowrap text-muted-foreground">
                            {provider.yearsExperience}+ yrs experience
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="mb-4 text-sm leading-relaxed text-foreground/80">
                      &quot;{provider.headline}&quot;
                    </p>
                    <p className="mb-5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {provider.bio}
                    </p>

                    <div className="flex items-end gap-4">
                      <div className="group/video relative flex h-20 w-28 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-muted transition-colors hover:bg-muted/80">
                        <div className="absolute inset-0 bg-gradient-to-br from-foreground/5 to-foreground/10" />
                        <div className="relative flex flex-col items-center gap-1">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground/10">
                            <Play className="ml-0.5 h-3.5 w-3.5 text-foreground/60" />
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground">
                            Watch intro
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {provider.badges.slice(0, 3).map((badge) => (
                            <span
                              key={badge}
                              className="inline-flex items-center gap-1 rounded-md bg-sage-light px-2 py-0.5 text-[11px] font-medium text-sage-dark"
                            >
                              <BadgeCheck className="h-3 w-3" />
                              {badge}
                            </span>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {provider.services.slice(0, 4).map((service) => (
                            <span
                              key={service}
                              className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                            >
                              {service}
                            </span>
                          ))}
                          {provider.services.length > 4 && (
                            <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                              +{provider.services.length - 4}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{
              duration: 0.45,
              delay: providers.length * 0.1,
              ease: [0.25, 0.4, 0.25, 1],
            }}
          >
            <div className="group relative h-full overflow-hidden rounded-2xl border border-coral/20 shadow-sm">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(135deg, color-mix(in srgb, var(--color-coral) 8%, transparent) 0%, var(--color-coral-light) 50%, color-mix(in srgb, var(--color-coral) 6%, transparent) 100%)",
                }}
              />
              <div className="absolute right-8 top-6 h-24 w-24 animate-pulse rounded-full bg-coral/10 blur-2xl" />
              <div
                className="absolute bottom-10 left-6 h-20 w-20 animate-pulse rounded-full bg-coral/8 blur-2xl"
                style={{ animationDelay: "1s" }}
              />

              <div className="relative flex h-full flex-col justify-between p-6 md:p-8">
                <div>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-coral/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-coral ring-1 ring-coral/20">
                    <Award className="h-3.5 w-3.5" />
                    What Makes Them Spotlight
                  </div>
                  <h3 className="mb-3 text-xl font-bold leading-snug text-foreground">
                    Not Just Good. <br />
                    <span className="text-coral">Proven.</span>
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                    Spotlight providers earn their place through verified track
                    records, consistently high ratings, and real results for
                    homeowners like you.
                  </p>

                  <div className="space-y-3">
                    {[
                      { icon: BadgeCheck, text: "Background checked and insured" },
                      { icon: Star, text: "Top 10% in customer satisfaction" },
                      { icon: Award, text: "Performance monitored in real time" },
                    ].map((item) => (
                      <div key={item.text} className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-coral/10">
                          <item.icon className="h-3.5 w-3.5 text-coral" />
                        </div>
                        <span className="text-sm font-medium text-foreground/80">
                          {item.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="border-coral/30 text-foreground hover:border-coral/50 hover:bg-coral/10"
                  >
                    <Link href="/vendors">
                      Explore all providers
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
