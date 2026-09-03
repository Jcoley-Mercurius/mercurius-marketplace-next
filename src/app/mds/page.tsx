import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComponentCatalog } from "@/components/mds/ComponentCatalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MDS component catalog | Mercurius", robots: { index: false, follow: false } };

export default function MdsPage() {
  if (process.env.MDS_CATALOG_ENABLED !== "1") notFound();
  return <ComponentCatalog />;
}
