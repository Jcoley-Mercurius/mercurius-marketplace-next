export const VENDOR_DOCUMENT_BUCKET = "vendor-documents";
export const MAX_VENDOR_DOCUMENT_SIZE = 10 * 1024 * 1024;
export const MAX_VENDOR_DOCUMENT_COUNT = 12;

export const VENDOR_DOCUMENT_KINDS = [
  "license",
  "insurance",
  "other",
] as const;

export type VendorDocumentKind = (typeof VENDOR_DOCUMENT_KINDS)[number];

export const VENDOR_DOCUMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

export const VENDOR_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const mimeTypeSet = new Set<string>(VENDOR_DOCUMENT_MIME_TYPES);

export type VendorDocumentDescriptor = {
  clientId: string;
  kind: VendorDocumentKind;
  name: string;
  size: number;
  type: string;
};

export function isVendorDocumentKind(
  value: unknown,
): value is VendorDocumentKind {
  return (
    typeof value === "string" &&
    VENDOR_DOCUMENT_KINDS.includes(value as VendorDocumentKind)
  );
}

export function validateVendorDocument(
  file: Pick<File, "name" | "size" | "type">,
): string | null {
  if (!mimeTypeSet.has(file.type.toLowerCase())) {
    return "Use a PDF, JPG, PNG, WebP, HEIC, or HEIF file.";
  }
  if (file.size <= 0) {
    return "This file is empty.";
  }
  if (file.size > MAX_VENDOR_DOCUMENT_SIZE) {
    return "Documents must be 10 MB or smaller.";
  }
  return null;
}

export function isAllowedVendorDocumentMimeType(value: unknown) {
  return typeof value === "string" && mimeTypeSet.has(value.toLowerCase());
}

export function safeVendorDocumentName(name: string, mimeType: string) {
  const extensionByMime: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const baseName =
    name
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "credential";
  const extension = extensionByMime[mimeType.toLowerCase()] ?? "bin";
  return `${baseName}.${extension}`;
}

export function vendorDocumentDisplayName(path: string) {
  const storedName = path.split("/").pop() || path;
  return storedName.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i,
    "",
  );
}

export function vendorDocumentKindFromPath(
  path: string,
): VendorDocumentKind | null {
  const segments = path.split("/");
  const candidate = segments.length >= 3 ? segments[segments.length - 2] : null;
  return isVendorDocumentKind(candidate) ? candidate : null;
}
