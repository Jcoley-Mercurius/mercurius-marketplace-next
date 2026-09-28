import type { SupabaseClient } from "@supabase/supabase-js";

export const REQUEST_PHOTO_BUCKET = "job-photos";
export const MAX_REQUEST_PHOTOS = 6;
export const MAX_REQUEST_PHOTO_BYTES = 8 * 1024 * 1024;
export const REQUEST_PHOTO_CAPTION = "Homeowner request intake photo";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type RequestPhotoDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

export function validateRequestPhoto(file: File) {
  if (!allowedTypes.has(file.type)) {
    throw new Error(`${file.name}: choose a JPG, PNG, or WebP image.`);
  }
  if (file.size <= 0) {
    throw new Error(`${file.name}: this image is empty.`);
  }
  if (file.size > MAX_REQUEST_PHOTO_BYTES) {
    throw new Error(`${file.name}: images must be 8 MB or smaller.`);
  }
}

export function createRequestPhotoDraft(file: File): RequestPhotoDraft {
  validateRequestPhoto(file);
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

export type PhotoSelection = { accepted: File[]; rejected: string[]; overLimit: number };

/** Applies type, size and count limits before anything is previewed or uploaded. */
export function selectRequestPhotos(files: File[], alreadySelected: number): PhotoSelection {
  const remaining = Math.max(0, MAX_REQUEST_PHOTOS - alreadySelected);
  const accepted: File[] = [];
  const rejected: string[] = [];
  let overLimit = 0;
  for (const file of files) {
    try {
      validateRequestPhoto(file);
    } catch (reason) {
      rejected.push(reason instanceof Error ? reason.message : `${file.name}: choose a valid image.`);
      continue;
    }
    if (accepted.length < remaining) accepted.push(file);
    else overLimit += 1;
  }
  return { accepted, rejected, overLimit };
}

/**
 * One stable object per selected photo, shared by every request in the plan. A stable path lets
 * a retry recognize an upload or association that succeeded even when its response was lost.
 */
export function requestPhotoPath(userId: string, requestIds: string[], photo: RequestPhotoDraft) {
  return `${userId}/${requestIds[0]}/intake-${photo.id}.${extensions[photo.file.type] ?? "img"}`;
}

export type RequestPhotoErrorKind = "check" | "upload" | "association" | "uncertain";

export class RequestPhotoError extends Error {
  constructor(readonly kind: RequestPhotoErrorKind, message: string) {
    super(message);
  }
}

type StorageErrorLike = { message?: string; statusCode?: string | number; error?: string } | null;

function alreadyUploaded(error: StorageErrorLike) {
  const status = String(error?.statusCode ?? "");
  return status === "409" || /already exists|duplicate/i.test(`${error?.error ?? ""} ${error?.message ?? ""}`);
}

async function existingLinks(supabase: SupabaseClient, userId: string, requestIds: string[], paths: string[]) {
  const result = await supabase.from("job_photos")
    .select("service_request_id, photo_url")
    .in("service_request_id", requestIds)
    .in("photo_url", paths)
    .eq("uploaded_by", userId);
  if (result.error) return null;
  return new Set((result.data ?? []).map((row: { service_request_id: string; photo_url: string }) => `${row.service_request_id}|${row.photo_url}`));
}

async function removeUnlinked(supabase: SupabaseClient, paths: string[], links: Set<string>) {
  const unlinked = paths.filter((path) => ![...links].some((link) => link.endsWith(`|${path}`)));
  if (unlinked.length === 0) return [];
  const cleanup = await supabase.storage.from(REQUEST_PHOTO_BUCKET).remove(unlinked);
  if (cleanup.error) console.error("Unable to remove unattached request photo uploads", { count: unlinked.length });
  return cleanup.error ? [] : unlinked;
}

export type PhotoAttachResult = { linked: number; uploaded: number; alreadyLinked: number };

/**
 * Links every selected photo to every request in the plan exactly once. Safe to repeat: the
 * current links are read first, only missing uploads and links are written, and after an
 * unconfirmed write the links are read again before anything is cleaned up. Objects are removed
 * only when no request references them.
 */
export async function attachRequestPhotos({
  supabase,
  userId,
  requestIds,
  photos,
  onProgress,
}: {
  supabase: SupabaseClient;
  userId: string;
  requestIds: string[];
  photos: RequestPhotoDraft[];
  onProgress?: (completed: number, total: number) => void;
}): Promise<PhotoAttachResult> {
  if (photos.length === 0) return { linked: 0, uploaded: 0, alreadyLinked: 0 };
  if (requestIds.length === 0) throw new RequestPhotoError("check", "The request was not created, so photos could not be attached.");

  const paths = photos.map((photo) => requestPhotoPath(userId, requestIds, photo));
  const wanted = requestIds.flatMap((requestId) => paths.map((path) => ({ requestId, path })));
  const before = await existingLinks(supabase, userId, requestIds, paths);
  if (!before) throw new RequestPhotoError("check", "We couldn’t check which photos are already attached.");
  if (wanted.every(({ requestId, path }) => before.has(`${requestId}|${path}`))) {
    onProgress?.(photos.length, photos.length);
    return { linked: wanted.length, uploaded: 0, alreadyLinked: wanted.length };
  }

  const uploadedNow: string[] = [];
  for (const [index, photo] of photos.entries()) {
    const path = paths[index];
    if (![...before].some((link) => link.endsWith(`|${path}`))) {
      validateRequestPhoto(photo.file);
      const result = await supabase.storage.from(REQUEST_PHOTO_BUCKET).upload(path, photo.file, {
        cacheControl: "3600",
        contentType: photo.file.type,
        upsert: false,
      });
      if (result.error && !alreadyUploaded(result.error as StorageErrorLike)) {
        await removeUnlinked(supabase, uploadedNow, before);
        throw new RequestPhotoError("upload", `${photo.file.name} didn’t upload.`);
      }
      if (!result.error) uploadedNow.push(path);
    }
    onProgress?.(index + 1, photos.length);
  }

  const missing = wanted.filter(({ requestId, path }) => !before.has(`${requestId}|${path}`));
  const association = await supabase.from("job_photos").insert(missing.map(({ requestId, path }) => ({
    service_request_id: requestId,
    uploaded_by: userId,
    uploader_role: "homeowner",
    photo_url: path,
    photo_type: "evidence",
    caption: REQUEST_PHOTO_CAPTION,
  })));
  if (!association.error) {
    return { linked: wanted.length, uploaded: uploadedNow.length, alreadyLinked: wanted.length - missing.length };
  }

  // The insert may have committed even though its response failed: read before cleaning up.
  const after = await existingLinks(supabase, userId, requestIds, paths);
  if (!after) throw new RequestPhotoError("uncertain", "We couldn’t confirm whether your photos were attached.");
  if (wanted.every(({ requestId, path }) => after.has(`${requestId}|${path}`))) {
    return { linked: wanted.length, uploaded: uploadedNow.length, alreadyLinked: wanted.length - missing.length };
  }
  await removeUnlinked(supabase, paths, after);
  throw new RequestPhotoError("association", "Your photos uploaded but couldn’t be linked to your request.");
}

/**
 * Removes intake objects in this plan's folder that no request references (“continue without
 * photos”, or after a reload lost the selected files). Lists the owner's own folder, so it also
 * finds uploads from earlier attempts whose response was lost.
 */
export async function discardUnattachedRequestPhotos({ supabase, userId, requestIds }: {
  supabase: SupabaseClient; userId: string; requestIds: string[];
}) {
  if (requestIds.length === 0) return [];
  const folder = `${userId}/${requestIds[0]}`;
  const listing = await supabase.storage.from(REQUEST_PHOTO_BUCKET).list(folder, { limit: 100 });
  if (listing.error) throw new RequestPhotoError("check", "We couldn’t check which photos were uploaded.");
  const paths = (listing.data ?? []).filter((item) => item.name.startsWith("intake-")).map((item) => `${folder}/${item.name}`);
  if (paths.length === 0) return [];
  const links = await existingLinks(supabase, userId, requestIds, paths);
  if (!links) throw new RequestPhotoError("check", "We couldn’t check which photos are attached.");
  return removeUnlinked(supabase, paths, links);
}
