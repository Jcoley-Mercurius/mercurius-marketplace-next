import { describe, expect, it } from "vitest";

import { applicationRetentionStorageStep, isApplicationDocumentPath } from "../../src/lib/applicationRetention";
import { RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET, retentionStorageStep } from "../../src/lib/renewalRetention";

// TRACE-084. The application retention route acts only on the application form's own
// upload paths inside the named application's folder (migration 20260923002000 applies
// the same rule), and only between the documents bucket and quarantine.
const applicationId = "00000000-0000-4000-8000-000000000084";
const path = `${applicationId}/license/11111111-1111-4111-8111-111111111111-state-license.pdf`;
const prepared = (action: string, from: string, to: string | null, storagePath = path, application = applicationId) => ({
  application_id: application,
  action,
  replay: false,
  storage_path: storagePath,
  from_bucket: from,
  to_bucket: to,
});

describe("application document paths", () => {
  it("accepts the form's upload layout for each kind and file type", () => {
    expect(isApplicationDocumentPath(applicationId, path)).toBe(true);
    expect(isApplicationDocumentPath(applicationId, `${applicationId}/insurance/11111111-1111-4111-8111-111111111111-coi.png`)).toBe(true);
    expect(isApplicationDocumentPath(applicationId, `${applicationId}/other/11111111-1111-4111-8111-111111111111-credential.heic`)).toBe(true);
  });

  it("refuses another application's folder, renewal paths and other layouts", () => {
    expect(isApplicationDocumentPath("00000000-0000-4000-8000-000000000085", path)).toBe(false);
    expect(isApplicationDocumentPath(applicationId, `renewals/${applicationId}/license/11111111-1111-4111-8111-111111111111-renewed.pdf`)).toBe(false);
    expect(isApplicationDocumentPath(applicationId, `${applicationId}/bank/11111111-1111-4111-8111-111111111111-form.pdf`)).toBe(false);
    expect(isApplicationDocumentPath(applicationId, `${applicationId}/license/../other/11111111-1111-4111-8111-111111111111-x.pdf`)).toBe(false);
    expect(isApplicationDocumentPath(applicationId, `${applicationId}/license/11111111-1111-4111-8111-111111111111-x.exe`)).toBe(false);
    expect(isApplicationDocumentPath(applicationId, `synthetic/${path}`)).toBe(false);
  });
});

describe("application retention storage step", () => {
  it("moves to quarantine, back, and removes from quarantine only", () => {
    expect(applicationRetentionStorageStep("quarantine", applicationId, prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET)))
      .toEqual({ kind: "move", path, from: "vendor-documents", to: "vendor-documents-quarantine" });
    expect(applicationRetentionStorageStep("restore", applicationId, prepared("restored", RENEWAL_QUARANTINE_BUCKET, RENEWAL_DOCUMENT_BUCKET)))
      .toEqual({ kind: "move", path, from: "vendor-documents-quarantine", to: "vendor-documents" });
    expect(applicationRetentionStorageStep("delete", applicationId, prepared("deleted", RENEWAL_QUARANTINE_BUCKET, null)))
      .toEqual({ kind: "remove", path, bucket: "vendor-documents-quarantine" });
  });

  it("refuses a prepared step for another application, path, action or bucket", () => {
    const other = "00000000-0000-4000-8000-000000000085";
    expect(() => applicationRetentionStorageStep("quarantine", applicationId,
      prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET, path, other))).toThrow("another application");
    expect(() => applicationRetentionStorageStep("quarantine", applicationId,
      prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET, path.replace(applicationId, other)))).toThrow("unexpected path");
    expect(() => applicationRetentionStorageStep("delete", applicationId,
      prepared("quarantined", RENEWAL_DOCUMENT_BUCKET, RENEWAL_QUARANTINE_BUCKET))).toThrow();
    expect(() => applicationRetentionStorageStep("delete", applicationId,
      prepared("deleted", RENEWAL_DOCUMENT_BUCKET, null))).toThrow();
  });

  it("keeps the renewal route to renewal paths after the shared refactor", () => {
    expect(() => retentionStorageStep("quarantine", {
      document_id: "22222222-2222-4222-8222-222222222222", action: "quarantined", storage_path: path,
      from_bucket: RENEWAL_DOCUMENT_BUCKET, to_bucket: RENEWAL_QUARANTINE_BUCKET,
    })).toThrow("unexpected path");
  });
});
