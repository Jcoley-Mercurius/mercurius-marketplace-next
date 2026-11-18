// TRACE-156 (P2B): the public reads behind one provider's profile at /providers/[id].
//
// Each read is the one the inherited storefront made (same RPCs, tables, columns and filters);
// what changes is how a failure is reported. The listing read decides whether there is a
// profile at all. Every supporting read reports its own outcome, so one unreadable section is
// shown as unreadable instead of as empty — and never as a lower price:
//
// - offers: P2A's paged, count-checked reader (`fetchPublicProviderOffers`). A failed or
//   incomplete package, level or extra read is `offersStatus: "unavailable"`; no amount is
//   shown and nothing says the provider publishes no offers. (The inherited page priced fixed
//   packages without their required extras when the extras read failed.)
// - qualifying questions: unreadable questions are passed on as unknown, never as "none", so
//   the request step asks the server for them (`question_details`).
// - reviews, gallery, service ZIPs and coverage: each null/unavailable on failure.
//
// No write, no new grant and no service-role access: the browser client reads only what RLS
// already exposes to anyone.

import { fetchCompletedJobCounts } from "@/lib/completedJobs";
import { homeSizeGuideText } from "@/lib/homeSizeGuide";
import type { PublicReviews } from "@/lib/reviews/serviceReview";
import { createClient } from "@/lib/supabase/client";
import { publicServiceAreas } from "@/lib/vendorServiceAreas";
import {
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  type PackageQualifyingQuestion,
} from "@/lib/vendorPricing";
import { fetchPublicProviderOffers, readAllRows } from "@/lib/providerProfile/publicOffers";
import type { ProfileData, ProfileMedia, ProfilePackage, ProfileSizeGuide } from "@/lib/providerProfile/model";

const QUESTION_COLUMNS = "id, package_id, question_key, question_label, input_type, unit, options, is_required, sort_order";

/** The r0_public_providers row (TRACE-104), as the profile reads it. */
export type PublicProviderRow = {
  id: string;
  name: string;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  badges: string[] | null;
  services: string[] | null;
  years_experience: number | null;
  our_promise: string | null;
  verified_specialty: string | null;
  video_url: string | null;
  tagline: string | null;
};

export type PublicProfile = {
  data: ProfileData;
  /**
   * Qualifying questions by package id, for the request handoff. null: they could not be read,
   * so the handoff leaves them to the request step's server preview rather than claiming none.
   */
  questions: ReadonlyMap<string, PackageQualifyingQuestion[]> | null;
};

export type PublicProfileResult =
  | { status: "ready"; profile: PublicProfile }
  /** Not in the public listing: unlisted, withdrawn or never existed. */
  | { status: "missing" }
  /** The listing itself could not be read. No substitute profile is shown. */
  | { status: "error"; message: string };

type Client = ReturnType<typeof createClient>;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function isPublicReviews(value: unknown): value is PublicReviews {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { summary, reviews } = value as Record<string, unknown>;
  return Boolean(summary) && typeof summary === "object" && typeof (summary as Record<string, unknown>).count === "number"
    && Array.isArray(reviews);
}

/** Only packages the existing public-eligibility rules allow ask questions in the request. */
function eligible(item: ProfilePackage) {
  return item.pricing_mode === "fixed" ? isPubliclyEligibleFixedPackage(item) : isPubliclyEligibleQuotePackage(item);
}

export async function fetchPublicProviderProfile(providerId: string, client?: Client): Promise<PublicProfileResult> {
  const supabase = client ?? createClient();

  const listing = await supabase.rpc("r0_public_providers", { p_contractor: providerId }).maybeSingle();
  if (listing.error) {
    console.error("Unable to load public provider profile", listing.error);
    return { status: "error", message: "We couldn't confirm this provider's current public information." };
  }
  const row = listing.data as PublicProviderRow | null;
  if (!row || row.id !== providerId) return { status: "missing" };

  const [offers, catalog, reviews, gallery, zips, coverage, completed] = await Promise.all([
    fetchPublicProviderOffers([providerId], supabase),
    supabase.from("services_catalog").select("id, name").eq("is_active", true),
    supabase.rpc("public_provider_reviews", { _contractor_id: providerId }),
    readAllRows<ProfileMedia>("Public provider gallery", (from, to, withCount) => supabase
      .from("contractor_gallery")
      .select("id, image_url, caption, sort_order", withCount ? { count: "exact" } : undefined)
      .eq("contractor_id", providerId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)),
    readAllRows<{ zip_code: string }>("Public provider service ZIPs", (from, to, withCount) => supabase
      .from("contractor_service_zips")
      .select("zip_code", withCount ? { count: "exact" } : undefined)
      .eq("contractor_id", providerId)
      .order("zip_code", { ascending: true })
      .range(from, to)),
    readAllRows<{ zip_code: string; city: string }>("Public coverage areas", (from, to, withCount) => supabase
      .from("coverage_areas")
      .select("zip_code, city", withCount ? { count: "exact" } : undefined)
      .eq("is_active", true)
      .order("zip_code", { ascending: true })
      .range(from, to)),
    fetchCompletedJobCounts([providerId])
      .then((counts) => counts.get(providerId) ?? null)
      .catch((reason) => {
        console.warn("Public completed-job count is unavailable", reason);
        return null;
      }),
  ]);

  const packages = offers.status === "ready" ? offers.packages.get(providerId) ?? [] : [];
  const eligibleIds = packages.filter(eligible).map((item) => item.id);
  let questions: Map<string, PackageQualifyingQuestion[]> | null = new Map();
  if (eligibleIds.length) {
    const rows = await readAllRows<PackageQualifyingQuestion & { package_id: string }>("Public package questions", (from, to, withCount) => supabase
      .from("package_qualifying_questions")
      .select(QUESTION_COLUMNS, withCount ? { count: "exact" } : undefined)
      .in("package_id", eligibleIds)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to));
    if (rows) for (const question of rows) questions.set(question.package_id, [...(questions.get(question.package_id) ?? []), question]);
    else questions = null;
  }

  // TRACE-122: the bedroom size guide follows each fixed offer's price-level conditions.
  const sizeGuides: Record<string, ProfileSizeGuide> = {};
  if (questions) {
    for (const item of packages) {
      if (item.pricing_mode !== "fixed" || !eligible(item)) continue;
      const guide = homeSizeGuideText([{ questions: questions.get(item.id) ?? [], tiers: item.tiers }]);
      if (guide) sizeGuides[item.id] = guide;
    }
  }

  if (catalog.error) console.warn("Public service names are unavailable", catalog.error);
  if (reviews.error) console.warn("Public provider reviews are unavailable", reviews.error);
  const reviewData = !reviews.error && isPublicReviews(reviews.data) ? reviews.data : null;

  const data: ProfileData = {
    provider: {
      id: row.id,
      name: row.name,
      logo_url: text(row.logo_url),
      bio: text(row.bio),
      location: text(row.location),
      badges: row.badges,
      tagline: text(row.tagline),
    },
    packages,
    offersStatus: offers.status,
    serviceNames: Object.fromEntries((catalog.error ? [] : catalog.data ?? []).map((service) => [service.id, service.name])),
    media: gallery ?? [],
    mediaStatus: gallery ? "ready" : "unavailable",
    reviews: reviewData,
    serviceArea: zips && coverage
      ? { areas: publicServiceAreas(zips.map((zip) => zip.zip_code), coverage), hasListedZips: zips.length > 0 }
      : null,
    marketplaceZips: coverage ? coverage.map((area) => area.zip_code) : null,
    // No published service-question source exists; none is invented (TRACE-156 P2B).
    questions: [],
    listedServiceIds: (row.services ?? []).filter((id) => typeof id === "string"),
    business: {
      yearsExperience: typeof row.years_experience === "number" ? row.years_experience : null,
      ourPromise: text(row.our_promise),
      verifiedSpecialty: text(row.verified_specialty),
      videoUrl: text(row.video_url),
      completedJobs: completed,
    },
    sizeGuides,
  };

  return { status: "ready", profile: { data, questions } };
}
