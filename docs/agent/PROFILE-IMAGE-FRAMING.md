# TRACE-156 — profile photo framing, 2026-11-24 ET

Base: `7f66d9a` on main. Branch: `codex/trace156-profile-image-framing`.

Josh asked Codex to inspect and fix the public profile pictures, which did not fill their
frames. Live inspection confirmed that a portrait work photo was contained in the wide lead
frame, leaving large blank sides. No live photo, caption or service assignment was changed.

## Bounded presentation change

- Keep the approved public 16:9 lead frame. Center-crop work-photo previews to fill it with
  `object-cover`, preserving proportions. This replaces the earlier whole-photo preview choice
  in [the cleanup record](PROFILE-MEDIA-CLEANUP.md); some edges will be outside the preview.
- Add **View full photo** using the existing accessible Dialog. The original URL is shown
  uncropped with `object-contain` in a viewport-bounded area. Nothing is resized or rewritten in
  storage. Provider name, service/general-business context, caption and before/after role are
  retained in the viewer.
- Keep logos contained so business names and marks stay intact. Administrative work-photo
  previews retain their complete-image fit for editing. Service filtering, deduplication,
  illustrative-photo separation, pairing and load-failure fallback keep their existing contract.
- Reuse semantic colors, Button and Dialog; keep 44px public controls, keyboard dismissal and
  focus restoration. This is a local TRACE-156 presentation correction under MDS §§3.2, 4.2
  and 8, MPS truthful public evidence, and the owner's current task instruction.

## Verification

Local install, secret scan, full lint, production build and all 1,317 unit tests passed.
Final typecheck and GitHub browser results are pending. Browser regressions cover portrait,
square and panoramic photos at 320/768/1440px, filled previews, the original uncropped image,
context labels, Escape/close/focus restoration, axe and reflow. Existing route scenarios cover
service filtering, failed media and explicit pairs. The focused gallery workflow now includes
this public route spec and saves synthetic review screenshots.

Local Chromium is unavailable: the download endpoint returned 403 and the installed browser
failed before page creation with a workspace socket restriction. Browser passes and visual
acceptance are not claimed until GitHub evidence is reviewed. No real customer data is used.

No migration, hosted write, merge, deployment or Phase 7 acceptance is part of this checkpoint.
Release rollback is the previous application deployment; there is no data change to reverse.
