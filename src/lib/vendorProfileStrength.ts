export type VendorProfileStrengthInput = {
  name: string;
  location: string | null;
  services: string[] | null;
  email: string | null;
  phone: string | null;
  years_experience: number | null;
  verified_specialty: string | null;
  logo_url: string | null;
  bio: string | null;
  special_offer: string | null;
  our_promise: string | null;
};

export type VendorProfileStrengthBreakdown = {
  score: number;
  essentials: number;
  trust: number;
  visual: number;
  differentiation: number;
};

export function calculateVendorProfileStrength(
  profile: VendorProfileStrengthInput,
  galleryCount: number,
): VendorProfileStrengthBreakdown {
  const galleryPhotos = Math.min(Math.max(galleryCount, 0), 3);
  const essentials = (profile.name.trim() ? 8 : 0)
    + (profile.location?.trim() ? 8 : 0)
    + ((profile.services?.length ?? 0) > 0 ? 10 : 0)
    + (profile.email?.trim() ? 7 : 0)
    + (profile.phone?.trim() ? 7 : 0);
  const trust = ((profile.years_experience ?? 0) > 0 ? 10 : 0)
    + (profile.verified_specialty?.trim() ? 10 : 0);
  const visual = (profile.logo_url ? 8 : 0) + galleryPhotos * 4;
  const differentiation = vendorBioPoints(profile.bio)
    + (profile.special_offer?.trim() ? 5 : 0)
    + (profile.our_promise?.trim() ? 5 : 0);

  return {
    score: essentials + trust + visual + differentiation,
    essentials,
    trust,
    visual,
    differentiation,
  };
}

export function vendorBioPoints(value: string | null) {
  const length = value?.trim().length ?? 0;
  if (length >= 80) return 10;
  return length > 0 ? 5 : 0;
}
