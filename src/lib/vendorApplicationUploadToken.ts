import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type VendorDocumentUploadGrant = {
  applicationId: string;
  paths: string[];
  expiresAt: number;
};

function uploadSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return secret;
}

export function signVendorDocumentUploadGrant(
  grant: VendorDocumentUploadGrant,
) {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  const signature = createHmac("sha256", uploadSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyVendorDocumentUploadGrant(
  token: string,
): VendorDocumentUploadGrant | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = createHmac("sha256", uploadSecret())
    .update(payload)
    .digest();

  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }

  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    return null;
  }

  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<VendorDocumentUploadGrant>;
    if (
      typeof value.applicationId !== "string" ||
      !Array.isArray(value.paths) ||
      !value.paths.every((path) => typeof path === "string") ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now()
    ) {
      return null;
    }
    return value as VendorDocumentUploadGrant;
  } catch {
    return null;
  }
}
