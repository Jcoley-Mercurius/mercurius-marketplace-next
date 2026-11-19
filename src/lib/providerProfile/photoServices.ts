// TRACE-156: saved photo-to-service associations. A provider photo is stored once in
// contractor_gallery and linked to services through contractor_gallery_services. A photo with no
// link is a General business photo. Links come only from what a vendor or operator saved; nothing
// here reads a caption, an image or a business name to work one out.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** The gallery columns every reader selects, with the photo's saved service links. */
export const GALLERY_PHOTO_COLUMNS = "id, image_url, caption, sort_order, contractor_gallery_services(service_id)";

export const GENERAL_BUSINESS_LABEL = "General business";

export type GalleryPhoto = {
  id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
  service_ids: string[];
};

export type PhotoServiceOption = {
  service_id: string;
  service_name: string;
  /** False for a service the provider no longer offers that a saved photo still names. */
  is_applicable: boolean;
};

type GalleryPhotoRow = Omit<GalleryPhoto, "service_ids"> & { contractor_gallery_services?: unknown };

function linkedServiceIds(links: unknown): string[] | null {
  if (!Array.isArray(links)) return null;
  const ids = links.map((link) => (link as { service_id?: unknown } | null)?.service_id);
  return ids.every((id): id is string => typeof id === "string" && id.length > 0) ? [...new Set(ids)] : null;
}

/**
 * Attach each photo's saved links. Returns null when any row's links are unreadable: treating an
 * unreadable photo as General business would show it under services it was never linked to.
 */
export function galleryPhotosFromRows(rows: readonly GalleryPhotoRow[]): GalleryPhoto[] | null {
  const photos: GalleryPhoto[] = [];
  for (const { contractor_gallery_services: links, ...photo } of rows) {
    const service_ids = linkedServiceIds(links);
    if (!service_ids) return null;
    photos.push({ ...photo, service_ids });
  }
  return photos;
}

/** The services a photo can be assigned to: the applicable ones, plus any it already names. */
export function assignableOptions(options: readonly PhotoServiceOption[], linked: readonly string[] = []) {
  return options.filter((option) => option.is_applicable || linked.includes(option.service_id));
}

/** What a photo is saved as, in words. An unnamed link is counted rather than guessed at. */
export function photoServiceLabel(serviceIds: readonly string[], options: readonly PhotoServiceOption[]) {
  if (serviceIds.length === 0) return GENERAL_BUSINESS_LABEL;
  const names = serviceIds.flatMap((id) => options.find((option) => option.service_id === id)?.service_name ?? []);
  if (names.length < serviceIds.length) return `${serviceIds.length} ${serviceIds.length === 1 ? "service" : "services"}`;
  return [...names].sort((left, right) => left.localeCompare(right)).join(", ");
}

export async function fetchPhotoServiceOptions(client: Client, contractorId: string): Promise<PhotoServiceOption[]> {
  const { data, error } = await client.rpc("contractor_photo_service_options", { p_contractor_id: contractorId });
  if (error) throw error;
  return data ?? [];
}

/**
 * A photo just added to the gallery, with the services chosen for it. The photo is already saved
 * as General business, so a failed link leaves it there and reports that rather than losing it.
 */
export async function assignNewPhoto(client: Client, row: GalleryPhotoRow, serviceIds: readonly string[]) {
  const photo = galleryPhotosFromRows([row])?.[0];
  if (!photo) throw new Error("The saved photo could not be read back.");
  if (serviceIds.length === 0) return { photo, assigned: true };
  try {
    return { photo: { ...photo, service_ids: await savePhotoServices(client, photo.id, serviceIds) }, assigned: true };
  } catch (reason) {
    console.warn("New photo services could not be saved", reason);
    return { photo, assigned: false };
  }
}

/** Replace a photo's links. The server decides who may do this and which services are valid. */
export async function savePhotoServices(client: Client, photoId: string, serviceIds: readonly string[]): Promise<string[]> {
  const { data, error } = await client.rpc("set_contractor_gallery_photo_services", {
    p_gallery_id: photoId,
    p_service_ids: [...serviceIds],
  });
  if (error) throw error;
  return data ?? [];
}
