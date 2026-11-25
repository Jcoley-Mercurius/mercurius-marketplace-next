import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EARLY_ACCESS_CTA, EARLY_ACCESS_PATH } from "@/lib/earlyAccessExperience";
import { ALL_SERVICES_ANCHOR } from "@/lib/servicesPage/catalog";
import { SERVICES_HERO_IMAGE as hero } from "@/lib/servicesPage/imagery";
import { cn } from "@/lib/utils";

// TRACE-161: split hero. Below 1024 px the introduction and both actions come first and a short
// 2:1 banner follows, leaving room for the featured services; from 1024 px the photo fills the
// right half. The photo's box is reserved either way, so loading never shifts the layout.
export function ServicesHero() {
  return (
    <section aria-labelledby="services-hero-title" className="relative overflow-hidden border-b border-border bg-cream">
      <div className="container-wide">
        <div className="relative z-10 pb-6 pt-8 sm:pb-8 sm:pt-12 lg:w-1/2 lg:py-20 lg:pr-10 xl:py-24">
          <h1 id="services-hero-title" className="text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl xl:text-[3.5rem]">
            Explore home services in Lee County
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground sm:mt-5 sm:text-xl">
            Browse local services and see package pricing where available. Booking opens by invitation.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row">
            <Link href={EARLY_ACCESS_PATH} className={cn(buttonVariants({ variant: "commitment", size: "lg" }), "h-12 px-7 text-base")}>
              {EARLY_ACCESS_CTA}<ArrowRight aria-hidden="true" />
            </Link>
            <a
              href={`#${ALL_SERVICES_ANCHOR}`}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12 border-2 border-commitment px-7 text-base text-commitment hover:text-commitment")}
            >
              Browse all services<ArrowDown aria-hidden="true" />
            </a>
          </div>
        </div>
        <div
          data-services-hero-photo
          className="relative mb-6 aspect-[2/1] overflow-hidden rounded-2xl bg-secondary sm:mb-8 lg:absolute lg:inset-y-0 lg:right-0 lg:mb-0 lg:aspect-auto lg:w-1/2 lg:rounded-none lg:[mask-image:linear-gradient(to_right,transparent,black_22%)]"
        >
          <picture>
            <source media="(min-width: 1024px)" type="image/webp" srcSet={hero.panel.srcSet} sizes="50vw" width={hero.panel.width} height={hero.panel.height} />
            <img
              src={hero.banner.src}
              srcSet={hero.banner.srcSet}
              sizes="(min-width: 640px) calc(100vw - 3rem), calc(100vw - 2rem)"
              width={hero.banner.width}
              height={hero.banner.height}
              alt={hero.alt}
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-[50%_60%]"
            />
          </picture>
        </div>
      </div>
    </section>
  );
}
