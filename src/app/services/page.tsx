import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { BookingOpensCta } from "@/components/services/BookingOpensCta";
import { FeaturedServices } from "@/components/services/FeaturedServices";
import { ServiceIcon } from "@/components/services/ServiceIcon";
import { ServicesCatalog } from "@/components/services/ServicesCatalog";
import { ServicesHero } from "@/components/services/ServicesHero";
import { fallbackPublicCatalog, featuredServices } from "@/lib/servicesPage/catalog";
import { readPublicCatalog } from "@/lib/servicesPage/publicCatalogServer";

export const metadata: Metadata = {
  title: "Home services in Lee County | Mercurius Marketplace",
  description: "Browse local home services in Lee County, Florida, and see package pricing where available. Booking opens by invitation.",
};

// TRACE-161: rendered per request so the catalog in the initial HTML is the current one and no
// build reads the database.
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const catalog = await readPublicCatalog();
  // Icons for every service the page can show: the server read and the browser read's fallback.
  const icons = Object.fromEntries(
    [...fallbackPublicCatalog().services, ...(catalog?.services ?? [])].map((service) => [service.id, <ServiceIcon key={service.id} name={service.icon} />]),
  );

  return (
    <MarketingShell>
      <ServicesHero />
      <FeaturedServices services={featuredServices(catalog)} />
      <ServicesCatalog initial={catalog} icons={icons} />
      <BookingOpensCta />
    </MarketingShell>
  );
}
