// SVG rendering wrappers preserve the original PNG bytes; no raster editing.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";

const original = readFileSync("public/mercurius-logo.png");
const image = `data:image/png;base64,${original.toString("base64")}`;
const font = readFileSync("node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2").toString("base64");
const sourceHash = createHash("sha256").update(original).digest("hex");
const directory = "public/brand";
mkdirSync(directory, { recursive: true });
copyFileSync("node_modules/geist/LICENSE.txt", `${directory}/Geist-LICENSE.txt`);

for (const [theme, ink] of [["dark-ink", "#10141b"], ["light-ink", "#ffffff"]]) {
  const mask = `<defs><mask id="hermes" maskUnits="userSpaceOnUse" x="0" y="0" width="2000" height="2000" style="mask-type:alpha"><image href="${image}" width="2000" height="2000"/></mask></defs>`;
  const symbol = `<rect width="2000" height="2000" fill="${ink}" mask="url(#hermes)"/>`;
  writeFileSync(`${directory}/mercurius-symbol-${theme}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000"><title>Mercurius Hermes symbol</title><metadata>Source PNG SHA-256: ${sourceHash}. Original geometry, monochrome SVG rendering.</metadata>${mask}${symbol}</svg>\n`);
  writeFileSync(`${directory}/mercurius-lockup-${theme}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200"><title>Mercurius</title><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:600}</style>${mask}<g transform="scale(.1)">${symbol}</g><text x="190" y="116" fill="${ink}" font-family="Geist,Arial,sans-serif" font-weight="600" font-size="60">Mercurius</text></svg>\n`);
}

// Code-native simplified symbol proposal. Review before replacing the primary mark.
const small = `<g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 25c-2 4-4 6-7 8l5 3-1 5 5 3 8-2 2 9M24 44l-3 8M19 54h22M22 25c-2-8 1-15 8-16 7-1 12 4 15 11M20 24c9-4 18-4 28 0M39 15l8-8 12-2-7 9-10 5M46 14l8-5M37 27c5-2 7 2 4 6l-3 3M29 28h3M39 36l2 8"/></g>`;
for (const [theme, ink] of [["dark-ink", "#10141b"], ["light-ink", "#ffffff"]]) {
  writeFileSync(`${directory}/mercurius-small-draft-${theme}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" style="color:${ink}"><title>Mercurius small Hermes mark — review draft</title>${small}</svg>\n`);
}
process.stdout.write(`Brand SVG wrappers generated from unchanged PNG ${sourceHash}. Small mark remains a review draft.\n`);
