import type { GalleryPhoto } from "./photoServices";
import { readAllRows } from "./publicOffers";
import { createClient } from "@/lib/supabase/client";

export type GalleryPair = { id: string; contractor_id: string; before_id: string; after_id: string; title: string };
export type PairDetails = { pair_id: string; pair_role: "before" | "after"; project_title: string; companion_id: string };

export const orderedPhotos = <T extends { id: string; sort_order: number }>(photos: readonly T[]): T[] =>
  [...photos].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));

export function withGalleryPairs<T extends { id: string }>(photos: readonly T[], pairs: readonly GalleryPair[]): Array<T & Partial<PairDetails>> {
  return photos.map((photo) => {
    const pair = pairs.find((p) => p.before_id === photo.id || p.after_id === photo.id);
    return pair ? { ...photo, pair_id: pair.id, pair_role: pair.before_id === photo.id ? "before" : "after", project_title: pair.title,
      companion_id: pair.before_id === photo.id ? pair.after_id : pair.before_id } : photo;
  });
}

export const filterGallery = (photos: readonly GalleryPhoto[], filter: string) => orderedPhotos(photos).filter((p) =>
  filter === "all" || (filter === "general" ? p.service_ids.length === 0 : p.service_ids.includes(filter)));

export async function fetchGalleryPairs(contractorId: string, client = createClient()) {
  return readAllRows<GalleryPair>("Before and after projects", (from, to, count) => client.from("contractor_gallery_pairs")
    .select("id, contractor_id, before_id, after_id, title", count ? { count: "exact" } : undefined)
    .eq("contractor_id", contractorId).order("id").range(from, to));
}
