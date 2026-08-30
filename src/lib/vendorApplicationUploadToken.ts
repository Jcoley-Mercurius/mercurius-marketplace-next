import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getVendorUploadSigningEnvironment } from "@/lib/env/server";

export type VendorDocumentUploadGrant = {
  applicationId: string;
  paths: string[];
  expiresAt: number;
};

export function signVendorDocumentUploadGrant(
  grant: VendorDocumentUploadGrant,
) {
  const { secret, version } = getVendorUploadSigningEnvironment();
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${version}.${payload}.${signature}`;
}

export function verifyVendorDocumentUploadGrant(
  token: string,
): VendorDocumentUploadGrant | null {
  const [version, payload, suppliedSignature, extra] = token.split(".");
  if (!version || !payload || !suppliedSignature || extra) return null;

  const environment = getVendorUploadSigningEnvironment();
  if (version !== environment.version) return null;

  const expectedSignature = createHmac("sha256", environment.secret)
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
