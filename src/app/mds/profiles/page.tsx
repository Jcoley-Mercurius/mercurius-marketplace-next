import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileGallery } from "@/components/mds/profiles/ProfileGallery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Provider profile gallery | Mercurius", robots: { index: false, follow: false } };

// Same gate as /mds: a local review surface, never a public route.
export default function ProfileGalleryPage() {
  if (process.env.MDS_CATALOG_ENABLED !== "1") notFound();
  return <ProfileGallery />;
}
