# TRACE-156 — profile media cleanup, 2026-11-18 ET

Base: `f449b3f` (merged P2C, PR #176). Branch:
`codex/trace156-profile-gallery-cleanup`.

Josh requested service-matched galleries, fewer duplicates and images that fit. This patch
addresses the rendering defects without changing the approved distinction between provider
photos and illustrative stock photos.

## Changes prepared for review

- Each service/media context keeps one slide per exact image URL and row ID, in the existing
  deterministic order. Blank URLs are omitted. Filtering by service happens before deduplication
  so an explicitly linked photo wins over its general-business copy. Different URL variants are
  preserved; this is not perceptual duplicate detection or deletion of stored uploads.
- Provider photos fit completely inside the existing 16:9 frame (`object-contain`), preserving
  portrait, square and panoramic content. Empty space uses the existing secondary surface.
- The carousel is titled Business photos, or the service name when explicitly linked.
- The illustrative panel reserves its own 16:9/4:3 frame. Its height no longer follows a tall
  caption. It stays below provider media, labelled as an example, and never becomes provider
  proof or the logo fallback.
- Browser regressions cover duplicate uploads, portrait/panorama fitting, long provider names,
  and repeated pool/gutter switching with one carousel and one correctly mapped example.
  The existing image-readiness helper now actually asserts the polling result.

## Verification

- Secret scan, full lint, typecheck and synthetic production build: passed.
- Unit: 71 files, 1,059 tests passed, including the media-context regression.
- Browser attempt: blocked before page creation. Playwright's browser download was truncated;
  the installed Chromium then failed to launch because this workspace disallows its socket
  operation. No browser assertion, screenshot comparison or visual acceptance is claimed.
- CI and desktop/phone rendering remain review gates. Database tests are not applicable to
  this patch: no schema, grant or data contract changes.

Run the normal isolated profile lane with the synthetic values from
`playwright.provider-profile.config.ts`, including `gallery cleanup`, `long provider name`,
`pool and gutter`, existing photo failure/switching and responsive/axe cases.

## Remaining dependency: service-linked provider work

The illustrative mapping already has an exact `pool-service` entry. The provider gallery read
still selects only `id, image_url, caption, sort_order`; the table has no saved service link.
The existing view model supports `service_id` only as a proposed/fixture field. Captions, image
appearance and business names must not be used to guess an association.

The next bounded implementation should add a reviewed nullable service association and let
vendors/operators assign existing and new photos to General business or an applicable catalog
service. Preserve existing uploads as General business; do not bulk-tag or delete production
records. Keep owner/admin authorization and provider scope enforced, carry the published
association through the public reader, and reuse the existing single carousel/filtering.
Matching provider photos should suppress the illustrative example as the model already intends.
Verify unrelated-service exclusion, All services behavior, duplicates, failure and refresh.
Prepare migrations and tests for review; hosted application still needs explicit authorization.

No merge, deployment, hosted write or Phase 7 change is included here.
