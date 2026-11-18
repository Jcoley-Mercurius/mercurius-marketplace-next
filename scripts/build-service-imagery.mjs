// Generates the static illustrative service photos for provider profiles (TRACE-156 P2C) from
// reviewed source files. It reads docs/imagery/service-imagery-manifest.json, refuses a source
// whose SHA-256 differs from the recorded one, and never enlarges a source.
//
//   node scripts/build-service-imagery.mjs <directory holding <serviceId>.img source files>
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const CROPS = [
  { name: "wide", ratio: 16 / 9, widths: [480, 720, 960] },
  { name: "compact", ratio: 4 / 3, widths: [320, 480, 640] },
];

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error("Pass the directory that holds the reviewed source files.");
const outputDir = path.resolve("public/images/services");
await mkdir(outputDir, { recursive: true });
const { assets } = JSON.parse(await readFile("docs/imagery/service-imagery-manifest.json", "utf8"));

for (const asset of assets) {
  const source = await readFile(path.join(sourceDir, `${asset.serviceId}.img`));
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== asset.sourceSha256) throw new Error(`${asset.serviceId}: the source file does not match the manifest.`);
  const { width, height } = await sharp(source).metadata();
  for (const crop of CROPS) {
    const cropWidth = Math.min(width, Math.round(height * crop.ratio));
    const cropHeight = Math.round(cropWidth / crop.ratio);
    const left = Math.max(0, Math.min(width - cropWidth, Math.round(width * asset.focalPoint.x - cropWidth / 2)));
    const top = Math.max(0, Math.min(height - cropHeight, Math.round(height * asset.focalPoint.y - cropHeight / 2)));
    for (const outputWidth of crop.widths) {
      if (outputWidth > cropWidth) throw new Error(`${asset.serviceId}: ${crop.name} ${outputWidth} would enlarge the source.`);
      await sharp(source)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .resize(outputWidth, Math.round(outputWidth / crop.ratio))
        .webp({ quality: 74, effort: 6 })
        .toFile(path.join(outputDir, `${asset.serviceId}-${crop.name}-${outputWidth}.webp`));
    }
  }
}
