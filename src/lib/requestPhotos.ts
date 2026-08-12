import type { SupabaseClient } from "@supabase/supabase-js";

export const REQUEST_PHOTO_BUCKET = "job-photos";
export const MAX_REQUEST_PHOTOS = 6;
export const MAX_REQUEST_PHOTO_BYTES = 8 * 1024 * 1024;

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
}) {
  if (photos.length === 0) return [];
  if (requestIds.length === 0) throw new Error("The request was not created, so photos could not be attached.");

  const uploadedPaths: string[] = [];
  try {
    for (const [index, photo] of photos.entries()) {
      validateRequestPhoto(photo.file);
      const extension = extensions[photo.file.type];
      const path = `${userId}/${requestIds[0]}/intake-${crypto.randomUUID()}.${extension}`;
      const result = await supabase.storage.from(REQUEST_PHOTO_BUCKET).upload(path, photo.file, {
        cacheControl: "3600",
        contentType: photo.file.type,
        upsert: false,
      });
      if (result.error) throw result.error;
      uploadedPaths.push(path);
      onProgress?.(index + 1, photos.length);
    }

    const rows = requestIds.flatMap((requestId) =>
      uploadedPaths.map((path) => ({
        service_request_id: requestId,
        uploaded_by: userId,
        uploader_role: "homeowner",
        photo_url: path,
        photo_type: "evidence",
        caption: "Homeowner request intake photo",
      })),
    );
    const association = await supabase.from("job_photos").insert(rows);
    if (association.error) throw association.error;
    return uploadedPaths;
  } catch (reason) {
    if (uploadedPaths.length > 0) {
      const cleanup = await supabase.storage.from(REQUEST_PHOTO_BUCKET).remove(uploadedPaths);
      if (cleanup.error) console.error("Unable to remove incomplete request photo uploads", cleanup.error);
    }
    throw reason;
  }
}
