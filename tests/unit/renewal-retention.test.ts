import { describe, expect, it } from "vitest";

import {
  RENEWAL_DOCUMENT_BUCKET,
  RENEWAL_QUARANTINE_BUCKET,
  daysUntil,
  isRetentionAction,
  retentionRecordAction,
  retentionStorageStep,
} from "../../src/lib/renewalRetention";

// TRACE-074. The route takes exactly one storage call per prepared step and only between
// the documents bucket and quarantine (migration 20260915002000 names the same buckets).
const path = "renewals/00000000-0000-4000-8000-000000000074/license/11111111-1111-4111-8111-111111111111-renewed-license.pdf";
const prepared = (action: string, from: string, to: string | null, storagePath = path) => ({
  document_id: "22222222-2222-4222-8222-222222222222",
  action,
  replay: false,
  storage_path: storagePath,
  from_bucket: from,
  to_bucket: to,
});

describe("retention storage step", () => {
  it("moves a quarantined file from documents to quarantine", () => {
    expect(retentionStorageStep("quarantine", prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET)))
      .toEqual({ kind: "move", path, from: "vendor-documents", to: "vendor-documents-quarantine" });
  });

  it("moves a restored file back and removes a deleted file from quarantine only", () => {
    expect(retentionStorageStep("restore", prepared("restored", RENEWAL_QUARANTINE_BUCKET, RENEWAL_DOCUMENT_BUCKET)))
      .toEqual({ kind: "move", path, from: "vendor-documents-quarantine", to: "vendor-documents" });
    expect(retentionStorageStep("delete", prepared("deleted", RENEWAL_QUARANTINE_BUCKET, null)))
      .toEqual({ kind: "remove", path, bucket: "vendor-documents-quarantine" });
  });

  it("refuses a prepared step for a different action", () => {
    expect(() => retentionStorageStep("delete", prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET))).toThrow();
    expect(() => retentionStorageStep("restore", prepared("deleted", RENEWAL_QUARANTINE_BUCKET, null))).toThrow();
  });

  it("never deletes from document storage or moves outside the two buckets", () => {
    expect(() => retentionStorageStep("delete", prepared("deleted", RENEWAL_DOCUMENT_BUCKET, null))).toThrow();
    expect(() => retentionStorageStep("quarantine", prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, "vendor-logos"))).toThrow();
    expect(() => retentionStorageStep("restore", prepared("restored", "job-photos", RENEWAL_DOCUMENT_BUCKET))).toThrow();
  });

  it("acts only on renewal document paths", () => {
    for (const other of ["application-id/license/file.pdf", `${path}/../x.pdf`, "renewals/x/license/y.pdf", ""]) {
      expect(() => retentionStorageStep("quarantine", prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET, other))).toThrow();
    }
  });
});

describe("retention helpers", () => {
  it("maps route actions to recorded actions", () => {
    expect(retentionRecordAction).toEqual({ quarantine: "quarantined", restore: "restored", delete: "deleted" });
    expect(isRetentionAction("delete")).toBe(true);
    expect(isRetentionAction("deleted")).toBe(false);
  });

  it("counts whole days until deletion opens, never below zero", () => {
    const now = "2026-09-15T12:00:00.000Z";
    expect(daysUntil("2026-09-29T12:00:00.000Z", now)).toBe(14);
    expect(daysUntil("2026-09-15T12:00:01.000Z", now)).toBe(1);
    expect(daysUntil("2026-09-15T12:00:00.000Z", now)).toBe(0);
    expect(daysUntil("2026-09-01T00:00:00.000Z", now)).toBe(0);
    expect(daysUntil(null, now)).toBeNull();
  });
});
