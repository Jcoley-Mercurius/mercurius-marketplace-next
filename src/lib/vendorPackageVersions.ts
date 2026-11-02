import type { createClient } from "@/lib/supabase/client";

// TRACE-134 (6.11A, migration 20261104001000): a vendor saves an offering in one keyed,
// stale-guarded call. A live or in-use version is never rewritten: the change becomes the next
// revision of its lineage and publishing it pauses the live one. Publishing and pausing go through
// vendor_set_package_active, which keeps one live revision per lineage.

type Supabase = ReturnType<typeof createClient>;

export type PackageVersionContent = {
  service_id?: string;
  template_id?: string | null;
  package: {
    name: string;
    description?: string | null;
    pricing_mode: "fixed" | "deposit_quote" | "custom_quote";
    default_frequency: string;
    deposit_amount?: number | null;
  };
  questions?: {
    question_key: string;
    question_label: string;
    input_type?: string;
    unit?: string | null;
    options?: unknown;
    is_required?: boolean;
    sort_order?: number;
  }[];
  tiers?: {
    template_tier_id?: string | null;
    name: string;
    price: number;
    frequency: string;
    rule_question_key?: string | null;
    rule_min?: number | null;
    rule_max?: number | null;
    includes?: string[];
    sort_order?: number;
  }[];
  addons?: {
    template_addon_id?: string | null;
    name?: string | null;
    description?: string | null;
    price: number;
    is_offered?: boolean;
    sort_order?: number;
  }[];
};

export type PackageSaveResult = {
  package_id: string;
  lineage_id: string;
  revision_number: number;
  new_version: boolean;
  replaced_package_id: string | null;
  is_active: boolean;
  needs_review: boolean;
  updated_at: string;
  package_revision: string;
  reused: boolean;
};

export type PackageRevision = { revision: string; inUse: boolean; isHead: boolean };

const STALE = "40001";
const FUNCTION_NOT_FOUND = "PGRST202";

export class PackageVersionError extends Error {
  readonly stale: boolean;
  constructor(message: string, stale: boolean) {
    super(message);
    this.name = "PackageVersionError";
    this.stale = stale;
  }
}

function versionError(error: { code?: string; message?: string }) {
  const stale = error.code === STALE;
  return new PackageVersionError(
    stale ? "This price changed since you opened it. Reload to see the current version, then save again." : error.message || "The price could not be saved.",
    stale,
  );
}

export function newPackageSaveKey() {
  return crypto.randomUUID();
}

/**
 * The key for a save attempt: a retry of the same content after an unknown outcome reuses the
 * earlier key, so the server returns the first result instead of creating a second revision.
 */
export function packageSaveKey(payload: string, pending: { payload: string; key: string } | null) {
  return pending && pending.payload === payload ? pending.key : newPackageSaveKey();
}

export async function savePackageVersion(supabase: Supabase, args: {
  packageId: string | null;
  expectedRevision: string | null;
  content: PackageVersionContent;
  publish: boolean;
  saveKey: string;
}) {
  const { data, error } = await supabase.rpc("vendor_save_package", {
    p_package: args.packageId,
    p_expected_revision: args.expectedRevision,
    p_content: args.content,
    p_publish: args.publish,
    p_save_key: args.saveKey,
  });
  if (error) throw versionError(error);
  return data as PackageSaveResult;
}

export async function setPackageActive(supabase: Supabase, packageId: string, active: boolean, expectedUpdatedAt: string) {
  const { data, error } = await supabase.rpc("vendor_set_package_active", {
    p_package: packageId,
    p_active: active,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw versionError(error);
  return data as { package_id: string; is_active: boolean; needs_review?: boolean; updated_at: string; changed: boolean };
}

export async function loadPackageRevisions(supabase: Supabase, packageIds: string[]) {
  if (!packageIds.length) return new Map<string, PackageRevision>();
  const { data, error } = await supabase.rpc("vendor_package_revisions", { p_packages: packageIds });
  // Before 20261104001000 is applied the readback does not exist; every listed version is newest.
  if (error) {
    if (error.code === FUNCTION_NOT_FOUND) return new Map<string, PackageRevision>();
    throw error;
  }
  return parsePackageRevisions(data);
}

/** package id → its version hash, whether requests use it and whether it is the newest revision. */
export function parsePackageRevisions(data: unknown) {
  return new Map((Array.isArray(data) ? data : []).flatMap((entry) => {
    const row = entry as { package_id?: unknown; package_revision?: unknown; in_use?: unknown; is_head?: unknown } | null;
    return typeof row?.package_id === "string" && typeof row.package_revision === "string"
      ? [[row.package_id, { revision: row.package_revision, inUse: row.in_use === true, isHead: row.is_head !== false }] as const]
      : [];
  }));
}
