/* eslint-disable @next/next/no-img-element -- Reviewed, pre-generated WebP crops with their own srcset (scripts/build-services-page-imagery.mjs), as for provider-profile service photos. */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { FeaturedService } from "@/lib/servicesPage/catalog";

// TRACE-161: four equal photo cards. Each whole card is one link; the photo's alt text is empty
// because the service name below it names the link. One caption covers the group.
export function FeaturedServices({ services }: { services: FeaturedService[] }) {
  if (services.length === 0) return null;
  return (
    <section aria-labelledby="featured-services-title" className="pb-4 pt-10 md:pt-14">
      <div className="container-wide">
        <h2 id="featured-services-title" className="text-2xl font-bold tracking-tight sm:text-3xl">Featured services</h2>
        <ul className="mt-5 grid grid-cols-1 gap-x-4 gap-y-5 min-[360px]:grid-cols-2 sm:mt-6 lg:grid-cols-4 lg:gap-x-5">
          {services.map((service) => (
            <li key={service.id}>
              <Link
                href={service.href}
                data-featured-service={service.id}
                className="group block rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              >
                <span className="block aspect-[3/2] overflow-hidden rounded-2xl border border-border bg-secondary shadow-sm">
                  <img
                    src={service.photo.src}
                    srcSet={service.photo.srcSet}
                    sizes="(min-width: 1280px) 296px, (min-width: 1024px) calc((100vw - 7.75rem) / 4), (min-width: 360px) calc((100vw - 3rem) / 2), calc(100vw - 2rem)"
                    width={service.photo.width}
                    height={service.photo.height}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                </span>
                <span className="mt-3 flex items-center justify-between gap-2 px-1">
                  <span className="text-base font-semibold text-foreground group-hover:underline group-hover:underline-offset-4 sm:text-lg">{service.name}</span>
                  <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-commitment transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </span>
                <span className="sr-only">, join early access for this service</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 px-1 text-sm italic text-muted-foreground">Representative photos</p>
      </div>
    </section>
  );
}
