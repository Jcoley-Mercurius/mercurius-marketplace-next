import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileGalleryScenario } from "@/components/mds/profiles/ProfileGalleryScenario";
import { profileScenario } from "@/components/mds/profiles/profileFixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Provider profile scenario | Mercurius", robots: { index: false, follow: false } };

export default async function ProfileScenarioPage({ params }: { params: Promise<{ scenario: string }> }) {
  if (process.env.MDS_CATALOG_ENABLED !== "1") notFound();
  const { scenario } = await params;
  if (!profileScenario(scenario)) notFound();
  // useSearchParams reads the service choice; the boundary keeps that read client-side safe.
  return <Suspense fallback={null}><ProfileGalleryScenario slug={scenario} /></Suspense>;
}
