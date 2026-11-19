# TRACE-156 — gallery management, 2026-11-19 ET

Base: `main` `1327a58`. Branch: `codex/trace156-gallery-management`.

## Owner direction

Josh requested the missing gallery editing capability after the operator reported only captions
and removal. Codex found #178 merged into `codex/trace156-profile-gallery-cleanup`, after #177
had already merged to main. Comparing main with `f1c3515` confirms the missing feature.
Josh then authorized all three recommended increments: “Can you do that now for me handle 1-3?”
This authorizes the bounded implementation here. It does not establish production activation
or claim unperformed manual acceptance.

## Implementation

1. Recovery: merge `f1c3515` into a fresh branch from main; recovery commit `2e1baac` keeps the
   original service-assignment history. Existing photos retain their original service meaning.
2. One `GalleryManager` for admin and vendor portals: saved-label filters/counts, selections
   retained across filters, bulk add/replace/explicit General business clearing (100 photos per
   command), explicit caption Save/Cancel (500 characters), saving/error/success feedback.
3. Earlier/later buttons save one complete deterministic gallery order, with an expected-order
   conflict check (up to 1,000 photos). Uploads append after the current maximum order. Explicit
   before/after projects pair two existing photos of the same provider, with a project title
   (120 characters). A photo belongs to at most one pair across both roles. Unpairing keeps both
   images. Deleting an image removes its pair metadata and keeps the companion image.

The public profile retains one carousel, with explicit Before/After + project-title labels and
a button to view the companion when it is also in the current service-filtered media. It never
borrows a companion from an unrelated service. Pair-read failure drops the project metadata,
not the underlying photos or the service-association failure handling. Illustrative stock stays
separate and is never assigned as provider proof.

Bulk assignments are a single database transaction and reuse #178's service applicability and
authorization rules. Caption saves use the prior saved caption to reject stale overwrites.
Ordering checks the complete prior ordered ID set. Pair creation checks ownership and same-
provider membership; composite foreign keys and a serialized guard protect integrity. Public
pair reads match existing public gallery access. Clients have no direct pair-table write grants.
All new commands derive authority from the stored provider and `auth.uid()`.

No service assignments, captions, pairs or ordering are inferred or backfilled. Provider service
offerings, pricing, Phase 7, booking and payment semantics are outside this slice.

## Database and release

- #178's migration `20261125001000` is recovered byte-for-byte. Production migration history
  was independently read on 2026-11-19 and confirms it is already the hosted head.
- New forward migration: `20261126001000_trace156_gallery_management.sql`. It adds the pair
  table and five commands. Existing gallery rows and policies are preserved.
- The PR preview branch was verified as isolated (`with_data=false`), healthy and migrated.
  Its generated new-table/RPC declarations were consumed, including composite return metadata.
  Caption argument/return nullability is explicitly retained because SQL accepts/returns NULL
  while the generator reports plain text for function signatures. No unrelated type blocks change.
- Before any merge: verify hosted history, dry-run the new migration, apply it with owner
  authorization, then merge the reviewed application to main. Main auto-deploys. A previous
  application can still run with this additive schema; database recovery is a forward fix.

## Validation

- Unit: 73 files / 1,086 tests passed locally.
- Lint, TypeScript, secret scan and synthetic production build passed locally.
- SQL 123: 42 assertions passed using PostgreSQL/WASM against a minimal synthetic prerequisite
  schema and the exact #178 and new migration files. Covers ownership, role-negative cases,
  invalid service rollback, stale captions/orders, cross-provider pairs, reuse across roles,
  unpair preservation and delete-cascade semantics. This is not full Supabase replay/RLS proof.
- CI run `44575311801`, runtime head `5d3f3f8`: backend and lifecycle passed. Full clean SQL
  replay passed twice (114 files / 7,923 assertions); all four new real-session concurrency
  proofs passed. Application lint, types, units and build passed. Browser: 897 passed, six failed. Five pairing
  tests lacked the CORS-exposed Content-Range header in the synthetic pair fixture, so the reader
  correctly treated it as unavailable. That fixture is fixed, including its offset/limit handling and terminal empty page after a
  saved project is reloaded. Focused run `44582772936` passed 25/27 editor tests (all mobile
  dialog axe/focus/reflow cases passed) and caught the pagination omission in the remaining two;
  the corrected fixture is under re-verification. The sixth was the existing request
  confirmation axe scan racing its automatic synthetic checkout refusal; the test now waits for
  the refusal and enabled checkout control before scanning. No axe rule is excluded, retried or
  weakened, and no request/checkout product code changes. `scripts/gallery-management-concurrency.mjs` is pinned to the disposable CI container
  and covers competing captions, stale reorders, cross-role pair races and atomic bulk races.
- Browser cases cover both editors, bulk add/replace/clear/cancel/failure, retained draft on
  failure/conflict, refresh persistence, order, pair/unpair, public paired navigation and 320/
  768/1440px dialog axe, reflow and focus. Local Chromium is blocked before startup by denied
  socket creation. No local browser pass, screenshot comparison or visual acceptance is claimed.
- Real phones, screen readers, forced colours, 200% browser zoom and owner visual acceptance
  remain open. No production provider content was read or changed in this task.

## Finishing review

Long captions and project titles wrap within photo cards. The final review follow-up contains
these wrapping classes, preview-generated contract declarations, fixture/timing repairs, a
focused gallery verification workflow and evidence documentation;
no database or command behavior changes. The focused workflow exercises all photo-manager
cases plus both request-confirmation scans and retains synthetic review screenshots even on
success. Its own CI and full final-head CI remain release checks.

## Next action

Inspect the draft PR's exact-head CI and rendered evidence, resolve any findings, complete the
hosted migration/release preflight and obtain owner acceptance of the concrete candidate.
