// TRACE-105: starting onboarding review creates the contractor with its name only, so the
// admin vendor profile offers the linked application's answers for any field still empty.
// Nothing is saved until the operator publishes. Applicant credentials are not turned into
// badges: a self-reported credential is not a verified trust claim (MDS R0 recruiting rule).
import { readApplicationServices } from "@/lib/vendorApplicationServices";
import { serviceAreaCommunities } from "@/lib/vendorServiceAreas";

export type PrefillApplication = {
  business_description: string | null;
  website: string | null;
  years_experience: number | null;
  email: string | null;
  phone: string | null;
  services: string[] | null;
  service_areas: string | null;
};

export type PrefillProfile = {
  bio: string | null;
  website: string | null;
  years_experience: number | null;
  email: string | null;
  phone: string | null;
  services: string[];
};

export type ApplicationPrefill = {
  profile: Partial<PrefillProfile>;
  zipCodes: string[];
  /** "Other" descriptions and legacy names with no catalog service. */
  unmatchedServices: string[];
};

const key = (value: string) => value.trim().toLowerCase();
const empty = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);

/** Application values for the profile fields and coverage that are still empty. */
export function applicationPrefill(
  application: PrefillApplication,
  current: PrefillProfile & { zipCodes: string[] },
  catalog: { id: string; name: string }[],
  areas: { zip_code: string; city: string }[],
): ApplicationPrefill {
  const { catalogIds: serviceIds, unmatched: unmatchedServices } = readApplicationServices(application.services, catalog);

  const cities = new Set(
    (application.service_areas ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .flatMap((label) => serviceAreaCommunities(label).map(key)),
  );
  const zipCodes = areas.filter((area) => cities.has(key(area.city))).map((area) => area.zip_code);

  const candidate: PrefillProfile = {
    bio: application.business_description?.trim() || null,
    website: application.website?.trim() || null,
    years_experience: application.years_experience ?? null,
    email: application.email?.trim() || null,
    phone: application.phone?.trim() || null,
    services: serviceIds,
  };
  const profile: Partial<PrefillProfile> = {};
  for (const field of Object.keys(candidate) as (keyof PrefillProfile)[]) {
    if (empty(current[field]) && !empty(candidate[field])) {
      (profile as Record<string, unknown>)[field] = candidate[field];
    }
  }
  return {
    profile,
    zipCodes: current.zipCodes.length ? [] : zipCodes,
    unmatchedServices,
  };
}
