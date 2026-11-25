// Generates the static /services hero and featured-service photos (TRACE-161) from reviewed source
// files, following the provider-profile pipeline (scripts/build-service-imagery.mjs): it reads
// docs/imagery/services-page-imagery-manifest.json, refuses a source whose SHA-256 differs from the
// recorded one, and never enlarges a source.
//
//   node scripts/build-services-page-imagery.mjs <directory holding <key>.img source files>
//
// Output names must stay in step with src/lib/servicesPage/imagery.ts.
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const CROPS_BY_ROLE = {
  hero: [
    { name: "panel", ratio: 3 / 2, widths: [720, 1080, 1440], quality: 66 },
    { name: "banner", ratio: 2 / 1, widths: [640, 960, 1280], quality: 66 },
  ],
  featured: [{ name: "card", ratio: 3 / 2, widths: [320, 480, 640], quality: 74 }],
};

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error("Pass the directory that holds the reviewed source files.");
const outputDir = path.resolve("public/images/services-page");
await mkdir(outputDir, { recursive: true });
const { assets } = JSON.parse(await readFile("docs/imagery/services-page-imagery-manifest.json", "utf8"));

for (const asset of assets) {
  const crops = CROPS_BY_ROLE[asset.role];
  if (!crops) throw new Error(`${asset.key}: unknown role ${asset.role}.`);
  const zoom = asset.zoom ?? 1;
  if (!(zoom >= 1)) throw new Error(`${asset.key}: zoom must be at least 1.`);
  const source = await readFile(path.join(sourceDir, `${asset.key}.img`));
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== asset.sourceSha256) throw new Error(`${asset.key}: the source file does not match the manifest.`);
  const { width, height } = await sharp(source).metadata();
  for (const crop of crops) {
    const cropWidth = Math.round(Math.min(width, height * crop.ratio) / zoom);
    const cropHeight = Math.round(cropWidth / crop.ratio);
    const left = Math.max(0, Math.min(width - cropWidth, Math.round(width * asset.focalPoint.x - cropWidth / 2)));
    const top = Math.max(0, Math.min(height - cropHeight, Math.round(height * asset.focalPoint.y - cropHeight / 2)));
    for (const outputWidth of crop.widths) {
      if (outputWidth > cropWidth) throw new Error(`${asset.key}: ${crop.name} ${outputWidth} would enlarge the source.`);
      await sharp(source)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .resize(outputWidth, Math.round(outputWidth / crop.ratio))
        .webp({ quality: crop.quality, effort: 6 })
        .toFile(path.join(outputDir, `${asset.key}-${crop.name}-${outputWidth}.webp`));
    }
  }
}
