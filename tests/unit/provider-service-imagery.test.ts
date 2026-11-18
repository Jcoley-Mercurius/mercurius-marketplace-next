// TRACE-156 P2C: illustrative service photos are explicitly mapped, reviewed static files with a
// complete provenance record. Selecting an asset is not owner approval.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ILLUSTRATIVE_PHOTO_LABEL,
  SERVICE_IMAGE_WIDTHS,
  mappedServiceImageIds,
  serviceIllustration,
  serviceImageFor,
} from "@/lib/providerProfile/serviceImagery";

type Asset = {
  serviceId: string; altText: string; sourcePage: string; sourceLibrary: string; creator: string;
  license: string; licenseUrl: string; licenseVerifiedOn: string; sourceImageUrl: string; sourceSha256: string;
  focalPoint: { x: number; y: number }; placement: string; approvalStatus: string; reviewNotes: string;
  approvedBy?: string; approvedOn?: string;
};

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, "docs/imagery/service-imagery-manifest.json"), "utf8")) as { assets: Asset[]; approvalStatuses: string[] };
const seed = readFileSync(path.join(root, "supabase/seed.sql"), "utf8");
const file = (serviceId: string, crop: string, width: number) => path.join(root, "public/images/services", `${serviceId}-${crop}-${width}.webp`);

/** Width and height from a WebP file's own header. */
function webpSize(bytes: Buffer) {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  throw new Error(`Unexpected WebP chunk ${chunk}`);
}

describe("illustrative service photo mapping", () => {
  it("maps only exact catalog service ids", () => {
    for (const id of mappedServiceImageIds()) expect(seed, id).toContain(`('${id}', `);
    expect(serviceImageFor("gutter-cleaning")?.serviceId).toBe("gutter-cleaning");
    for (const id of ["gutter", "Gutter-Cleaning", "window-cleaning", "__proto__", "constructor", "toString", ""]) {
      expect(serviceImageFor(id), id).toBeNull();
    }
  });

  it("appears only for a selected service with no service-specific provider media", () => {
    expect(serviceIllustration("gutter-cleaning", true)?.serviceId).toBe("gutter-cleaning");
    expect(serviceIllustration(null, true)).toBeNull();
    expect(serviceIllustration("gutter-cleaning", false)).toBeNull();
    expect(serviceIllustration("window-cleaning", true)).toBeNull();
  });

  it("uses the agreed label and same-origin paths", () => {
    expect(ILLUSTRATIVE_PHOTO_LABEL).toBe("Illustrative service photo");
    for (const id of mappedServiceImageIds()) {
      const image = serviceImageFor(id)!;
      for (const value of [image.wide.src, image.wide.srcSet, image.compact.srcSet]) {
        expect(value).toContain(`/images/services/${id}-`);
        expect(value).not.toMatch(/https?:/);
      }
    }
  });
});

describe("illustrative service photo files", () => {
  it("has every crop at its exact size and within the size budget", () => {
    for (const id of mappedServiceImageIds()) {
      for (const [crop, widths, ratio] of [["wide", SERVICE_IMAGE_WIDTHS.wide, 16 / 9], ["compact", SERVICE_IMAGE_WIDTHS.compact, 4 / 3]] as const) {
        for (const width of widths) {
          const target = file(id, crop, width);
          expect(existsSync(target), target).toBe(true);
          expect(webpSize(readFileSync(target))).toEqual({ width, height: Math.round(width / ratio) });
          expect(statSync(target).size, target).toBeLessThanOrEqual(150 * 1024);
        }
      }
    }
  });
});

describe("illustrative service photo provenance", () => {
  it("records one complete entry for each mapped photo and no others", () => {
    expect(manifest.assets.map((asset) => asset.serviceId).sort()).toEqual(mappedServiceImageIds().sort());
    for (const asset of manifest.assets) {
      expect(asset.sourcePage, asset.serviceId).toMatch(/^https:\/\/(stocksnap\.io\/photo|wordpress\.org\/photos\/photo)\//);
      expect(asset.sourceImageUrl, asset.serviceId).toMatch(/^https:\/\//);
      expect(asset.creator.trim(), asset.serviceId).not.toBe("");
      expect(asset.license, asset.serviceId).toBe("CC0 1.0 Universal");
      expect(asset.licenseUrl, asset.serviceId).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
      expect(asset.licenseVerifiedOn, asset.serviceId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(asset.sourceSha256, asset.serviceId).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.placement.trim(), asset.serviceId).not.toBe("");
      expect(asset.altText, asset.serviceId).toBe(serviceImageFor(asset.serviceId)!.alt);
      expect(asset.altText, asset.serviceId).toMatch(/^Illustrative photo of /);
    }
  });

  it("never treats selection as approval", () => {
    for (const asset of manifest.assets) {
      expect(manifest.approvalStatuses, asset.serviceId).toContain(asset.approvalStatus);
      if (asset.approvalStatus === "approved_by_owner") {
        expect(asset.approvedBy, asset.serviceId).toBeTruthy();
        expect(asset.approvedOn, asset.serviceId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      } else {
        expect(asset.approvedBy, asset.serviceId).toBeUndefined();
      }
    }
  });
});
