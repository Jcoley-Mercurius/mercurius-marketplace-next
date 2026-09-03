# Mercurius identity review kit

Authority: approved MDS §3.1. Status: **review pending**, not a new approved identity.

`/mds/brand` is gated by the same local catalog opt-in and noindex behavior as
`/mds`. It shows both backgrounds, the full symbol, Geist lockup, and a simplified
Hermes head proposal at 32/40/64px. Downloadable files are in `public/brand/`.

- Full symbols use the original PNG's alpha as an SVG mask. Its bytes and
  geometry are preserved, with uniform dark or white ink. These self-contained
  SVGs contain raster art; they are not vector tracings. They are review/export
  assets and are not substituted for Next's optimized navigation images.
- Lockups embed the existing Geist Semibold font. Its OFL license accompanies
  the exports. The wordmark is editable text, not a new font or traced lettering.
- The small mark is a code-native simplified profile/winged-helmet proposal.
  It intentionally omits the coin, hand and robe. It is not active in navigation.
- One eighth of symbol width is the proposed external clear space. Proposed
  minimum display sizes are 80px full symbol, 256px lockup and 32px small symbol.
  Owner review must confirm recognition and legibility at these sizes.

Regenerate deterministically with `node scripts/generate-brand-assets.mjs` after
installing locked dependencies. Source SHA-256 is recorded in each full symbol.
Do not overwrite the original PNG or promote the simplified mark without review.

An attempted generated white variant baked in a checkerboard and was rejected.
No generated raster variant was added to the repository or public navigation.

Remaining acceptance: approve/revise the simplified mark, clear space and minimum
sizes, and inspect exported assets in their intended downstream applications.
