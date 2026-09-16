// TRACE-073 renewal documents: shared naming and wording. The database decides who may
// submit, verifies the stored object and records every decision; this module only
// builds the storage path the server issues and words the states.

import { safeVendorDocumentName } from "./vendorApplicationDocuments";

export const RENEWAL_DOCUMENT_KINDS = ["license", "insurance"] as const;
export type RenewalDocumentKind = (typeof RENEWAL_DOCUMENT_KINDS)[number];
export type RenewalDocumentState = "submitted" | "accepted" | "declined";

export function isRenewalDocumentKind(value: unknown): value is RenewalDocumentKind {
  return typeof value === "string" && RENEWAL_DOCUMENT_KINDS.includes(value as RenewalDocumentKind);
}

export const renewalDocumentKindLabel: Record<RenewalDocumentKind, string> = {
  license: "License",
  insurance: "Insurance",
};

export const renewalDocumentStateLabel: Record<RenewalDocumentState, string> = {
  submitted: "Awaiting review",
  accepted: "Accepted",
  declined: "Declined",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The private object path for a renewal upload. The database accepts a submission only
 * at this shape, under the provider and item it was authorized for.
 */
export function renewalDocumentPath(
  contractorId: string,
  kind: RenewalDocumentKind,
  objectId: string,
  fileName: string,
  mimeType: string,
) {
  const contractor = contractorId.toLowerCase();
  const object = objectId.toLowerCase();
  if (!UUID.test(contractor) || !UUID.test(object)) throw new Error("Invalid renewal document identifiers.");
  return `renewals/${contractor}/${kind}/${object}-${safeVendorDocumentName(fileName, mimeType)}`;
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
