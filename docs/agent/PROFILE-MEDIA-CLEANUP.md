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

## Service-linked provider work: status when this patch was written

Implemented afterwards. See [Saved photo-to-service associations](#saved-photo-to-service-associations-2026-11-18-et).

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

## Saved photo-to-service associations, 2026-11-18 ET

Branch `claude/trace156-photo-service-links` in `../mercurius-profile-photo-services`, built on
the PR #177 head `db163c3`, whose deduplication and whole-image fitting are kept. The draft PR
targets that branch, so its diff shows this slice only. Not merged, deployed or applied to hosted.

### What changed

- **One stored photo, many services.** Additive migration
  `20261125001000_trace156_gallery_photo_services.sql` adds `contractor_gallery_services`. A photo
  with no link is General business, so every existing upload keeps that meaning. Nothing is
  backfilled, tagged, copied or deleted.
- **Server-side rules.** Clients can only read links. `set_contractor_gallery_photo_services` is
  the one client write path and takes a photo id and service ids only. It decides access from
  `auth.uid()` and the stored row: the provider's owner, or the admin role. A composite foreign key
  ties each link to the photo's own provider. A trigger accepts only an active catalog service
  that the provider lists or backs with an active package.
- **Vendor and operator editing.** `/vendor/profile` and `/admin/vendors/[id]` share
  `PhotoServiceAssignment.tsx`: choose services before adding photos, or use Edit services on a
  saved photo.
- **Public reader.** A selected service shows its own photos, which suppress the stock example.
  With none, it shows labelled General business photos and the existing illustrative-photo rules.
  A photo linked only to other services is never borrowed. All services shows every photo once,
  in saved order, in one carousel. Unreadable links show the photo failure state.

### Decisions for Codex review

1. **Applicable service** means an active catalog service the provider lists, or one with an
   active package. A paused package alone does not qualify.
2. **A withdrawn service keeps its links.** Rewriting them would turn the photo General business
   and show it under unrelated services. The editor labels the link "(no longer offered)" and lets
   it be removed. It cannot be added back while the service stays withdrawn.
3. **Catalog deletion is restricted** while a photo links to that service, for the same reason.
4. **A new upload is two writes:** the existing gallery insert, then the link save. If the link
   save fails, the photo stays General business and the person is told. No new insert path was added.
5. **Realtime is unchanged.** Neither gallery table is in the realtime publication, so public
   profiles pick up changes through their existing periodic refresh or a reload.

### Verification

| Check | Result |
|---|---|
| New SQL contract (`122_contractor_gallery_services.sql`) | 72 of 72 |
| Full SQL suite on a clean migration replay | 113 files, 7,881 tests passed |
| Unit suite | 72 files, 1,082 tests passed |
| Profile browser lane (`provider-profile-route.spec.ts`) | 61 of 61 |
| Profile gallery browser lane (`profile-gallery.spec.ts`) | 82 of 82 |
| Photo editors and neighbouring vendor/admin specs | 48 of 48 |
| Real local stack: sign-in, storage, PostgREST, RLS, vendor, operator and public pages | 27 of 27 |
| Deliberate breakages | 13 of 13 caught (7 database, 6 application) |
| Secret scan, lint, types, production build | Passed |

The real-stack run covered saving and reloading, multi-service links, refused edits by another
vendor and a signed-out visitor, refused owner and role fields, unrelated-service exclusion, All
services and 15 rounds of concurrent saves. Provider eligibility was stubbed on the isolated local
database so a synthetic provider could be listed. That stub is not in the migration.

Browser specs also cover duplicates, service and provider switching, refresh, broken images, axe
and reflow at 320, 768 and 1440 px.

### Comparison images

Synthetic data on an isolated local stack. These are review material, not visual baselines.

- [Selected service, desktop](evidence/trace156-photo-services/compare-service-with-photos-desktop.png)
- [Selected service, phone](evidence/trace156-photo-services/compare-service-with-photos-phone.png)
- [All services](evidence/trace156-photo-services/compare-all-services-desktop.png)
- [Service with no matching photo](evidence/trace156-photo-services/compare-no-matching-photo-desktop.png)
- [Vendor management and editor](evidence/trace156-photo-services/manage-vendor-and-editor.png)

### Open before release

- Codex review, and CI on the final head. The full default browser suite was not run locally.
- PR #177 merges first. This PR then retargets `main`.
- **Release order:** with the owner's authorization, dry-run and push the migration to hosted
  before merging. The new readers select the link table, so deploying first would show the public
  photo failure state and stop the vendor and operator pages from loading.
- Manual checks not performed: real phones, screen readers, forced colours and 200% browser zoom.
- Owner visual acceptance of the comparison images.

No hosted migration, merge, deployment or Phase 7 change is included.
