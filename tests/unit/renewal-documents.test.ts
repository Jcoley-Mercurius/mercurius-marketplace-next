import { describe, expect, it } from "vitest";

import {
  formatFileSize,
  isRenewalDocumentKind,
  renewalDocumentPath,
} from "../../src/lib/renewalDocuments";

// TRACE-073. The database pattern the stored path must match (see migration
// 20260915001000): renewals/<provider>/<item>/<uuid>-<safe name>.<ext>.
const databasePattern = (contractor: string, kind: string) =>
  new RegExp(
    `^renewals/${contractor}/${kind}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_-]{1,72}\\.(pdf|jpg|png|webp|heic|heif)$`,
  );
const contractor = "00000000-0000-4000-8000-000000000073";
const object = "11111111-1111-4111-8111-111111111111";

describe("renewal document paths", () => {
  it("builds the path the database accepts for the authorized provider and item", () => {
    const path = renewalDocumentPath(contractor, "insurance", object, "Certificate of Insurance (2027).PDF", "application/pdf");
    expect(path).toBe(`renewals/${contractor}/insurance/${object}-Certificate-of-Insurance-2027.pdf`);
    expect(path).toMatch(databasePattern(contractor, "insurance"));
  });

  it("names the extension from the verified type, not the uploaded name", () => {
    const path = renewalDocumentPath(contractor, "license", object, "license.pdf.exe", "image/jpeg");
    expect(path.endsWith("-license-pdf.jpg")).toBe(true);
    expect(path).toMatch(databasePattern(contractor, "license"));
  });

  it("keeps long and non-Latin names inside the database pattern", () => {
    const long = renewalDocumentPath(contractor, "license", object, `${"a".repeat(200)}.png`, "image/png");
    expect(long).toMatch(databasePattern(contractor, "license"));
    const fallback = renewalDocumentPath(contractor, "license", object, "証明書.heic", "image/heic");
    expect(fallback).toBe(`renewals/${contractor}/license/${object}-credential.heic`);
  });

  it("refuses identifiers that could escape the provider folder", () => {
    expect(() => renewalDocumentPath("../other", "license", object, "a.pdf", "application/pdf")).toThrow();
    expect(() => renewalDocumentPath(contractor, "license", "x/../y", "a.pdf", "application/pdf")).toThrow();
  });
});

describe("renewal document helpers", () => {
  it("accepts only license and insurance", () => {
    expect(isRenewalDocumentKind("license")).toBe(true);
    expect(isRenewalDocumentKind("insurance")).toBe(true);
    expect(isRenewalDocumentKind("identity")).toBe(false);
    expect(isRenewalDocumentKind(undefined)).toBe(false);
  });

  it("formats file sizes for review", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(200)).toBe("1 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
