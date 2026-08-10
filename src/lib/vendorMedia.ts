import { createClient } from "@/lib/supabase/client";

export const VENDOR_MEDIA_BUCKET = "vendor-media";

export type VendorMediaKind = "logo" | "gallery";

export type UploadedVendorMedia = {
  path: string;
  signedUrl: string;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES: Record<VendorMediaKind, number> = {
  logo: 5 * 1024 * 1024,
  gallery: 10 * 1024 * 1024,
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateVendorMediaFile(file: File, kind: VendorMediaKind) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }

  if (file.size <= 0) {
    throw new Error("That image is empty. Choose a different file.");
  }

  if (file.size > MAX_BYTES[kind]) {
    const limitMb = MAX_BYTES[kind] / (1024 * 1024);
    throw new Error(`${kind === "logo" ? "Logos" : "Gallery images"} must be ${limitMb} MB or smaller.`);
  }
}

export async function uploadVendorMedia(
  contractorId: string,
  file: File,
  kind: VendorMediaKind,
): Promise<UploadedVendorMedia> {
  validateVendorMediaFile(file, kind);

  const extension = EXTENSION_BY_TYPE[file.type];
  const path = `${contractorId}/${kind}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const supabase = createClient();
  const upload = await supabase.storage.from(VENDOR_MEDIA_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: "3600",
  });

  if (upload.error) throw upload.error;

  const signed = await supabase.storage
    .from(VENDOR_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) {
    await supabase.storage.from(VENDOR_MEDIA_BUCKET).remove([path]);
    throw signed.error ?? new Error("The image was uploaded, but its secure display link could not be created.");
  }

  return { path, signedUrl: signed.data.signedUrl };
}

export async function removeUploadedVendorMedia(path: string) {
  const result = await createClient().storage.from(VENDOR_MEDIA_BUCKET).remove([path]);
  if (result.error) throw result.error;
}

export function vendorMediaPathFromUrl(url: string, contractorId: string) {
  try {
    const parsed = new URL(url);
    const markers = [
      `/storage/v1/object/sign/${VENDOR_MEDIA_BUCKET}/`,
      `/storage/v1/object/public/${VENDOR_MEDIA_BUCKET}/`,
    ];
    const marker = markers.find((candidate) => parsed.pathname.includes(candidate));
    if (!marker) return null;

    const path = decodeURIComponent(parsed.pathname.split(marker)[1] ?? "");
    return path.startsWith(`${contractorId}/`) ? path : null;
  } catch {
    return null;
  }
}
