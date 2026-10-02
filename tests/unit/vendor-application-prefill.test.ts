// TRACE-105: the admin vendor profile takes empty fields from the linked application.
import { describe, expect, it } from "vitest";
import { applicationPrefill, type PrefillApplication } from "@/lib/vendorApplicationPrefill";

const application: PrefillApplication = {
  business_description: "  Family-run lawn care since 2010. ",
  website: "https://example.test",
  years_experience: 14,
  email: "owner@example.test",
  phone: "239-555-0100",
  services: ["lawn-mowing", "Other: Gutter polishing", "Mowing"],
  service_areas: "Cape Coral, Pine Island",
};

const blank = { bio: null, website: null, years_experience: null, email: null, phone: null, services: [], zipCodes: [] };
const catalog = [{ id: "lawn-mowing", name: "Lawn Mowing" }, { id: "hedge", name: "Hedge Trimming" }];
const areas = [
  { zip_code: "33904", city: "Cape Coral" },
  { zip_code: "33922", city: "Bokeelia" },
  { zip_code: "33956", city: "Saint James City" },
  { zip_code: "33901", city: "Fort Myers" },
];

describe("vendor application prefill", () => {
  it("fills an empty profile from the application", () => {
    const fill = applicationPrefill(application, blank, catalog, areas);
    expect(fill.profile).toEqual({
      bio: "Family-run lawn care since 2010.",
      website: "https://example.test",
      years_experience: 14,
      email: "owner@example.test",
      phone: "239-555-0100",
      services: ["lawn-mowing"],
    });
    expect(fill.zipCodes).toEqual(["33904", "33922", "33956"]);
    expect(fill.unmatchedServices).toEqual(["Gutter polishing", "Mowing"]);
  });

  it("never overwrites values already on the profile", () => {
    const fill = applicationPrefill(
      application,
      { ...blank, bio: "Edited by operations", email: "ops@example.test", services: ["hedge"], zipCodes: ["33901"] },
      catalog,
      areas,
    );
    expect(fill.profile).not.toHaveProperty("bio");
    expect(fill.profile).not.toHaveProperty("email");
    expect(fill.profile).not.toHaveProperty("services");
    expect(fill.profile.website).toBe("https://example.test");
    expect(fill.zipCodes).toEqual([]);
  });

  it("offers nothing for blank application answers", () => {
    const fill = applicationPrefill(
      { business_description: " ", website: null, years_experience: null, email: "", phone: null, services: null, service_areas: null },
      blank,
      catalog,
      areas,
    );
    expect(fill).toEqual({ profile: {}, zipCodes: [], unmatchedServices: [] });
  });
});
