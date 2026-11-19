import { describe, expect, it } from "vitest";
import { filterGallery, orderedPhotos, withGalleryPairs } from "@/lib/providerProfile/galleryManagement";

const photos = [
  { id: "b", image_url: "/b.jpg", caption: "After", sort_order: 5, service_ids: ["lawn"] },
  { id: "a", image_url: "/a.jpg", caption: "Before", sort_order: 5, service_ids: [] },
  { id: "c", image_url: "/c.jpg", caption: null, sort_order: 0, service_ids: ["pool"] },
];
const pairs = [{ id: "p", contractor_id: "vendor", before_id: "a", after_id: "b", title: "Cleanup" }];

describe("shared gallery management", () => {
  it("uses a stable ID tie-break without rewriting the supplied gallery", () => {
    expect(orderedPhotos(photos).map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(photos.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
  it("filters saved labels only, with explicit general and empty states", () => {
    expect(filterGallery(photos, "general").map((p) => p.id)).toEqual(["a"]);
    expect(filterGallery(photos, "lawn").map((p) => p.id)).toEqual(["b"]);
    expect(filterGallery(photos, "unknown")).toEqual([]);
    expect(filterGallery(photos, "all")).toHaveLength(3);
  });
  it("pairs only explicit records without changing services or duplicating photos", () => {
    const result = withGalleryPairs(photos, pairs);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ pair_role: "after", project_title: "Cleanup", companion_id: "a", service_ids: ["lawn"] });
    expect(result[1]).toMatchObject({ pair_role: "before", companion_id: "b", service_ids: [] });
    expect(result[2]).not.toHaveProperty("pair_role");
    expect(photos[0]).not.toHaveProperty("pair_id");
  });
  it("retains an explicit role when the companion is filtered out, without borrowing it", () => {
    const result = withGalleryPairs(filterGallery(photos, "lawn"), pairs);
    expect(result.map((p) => p.id)).toEqual(["b"]);
    expect(result[0].pair_role).toBe("after");
  });
});
