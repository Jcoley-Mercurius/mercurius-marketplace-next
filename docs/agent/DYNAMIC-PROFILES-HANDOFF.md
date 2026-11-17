# Dynamic profiles — local review gallery (checkpoint)

This file is the checkpoint for one slice only. It does not replace `HANDOFF.md`, and it does
not change any authority, roadmap phase or release gate.

## Slice

- **Name:** Dynamic profiles — local review gallery.
- **Assigned by:** Josh, 2026-11-16, with Codex as architect and reviewer.
- **Branch / worktree:** `fable/dynamic-profiles` in `../mercurius-dynamic-profiles`.
- **Base:** `origin/main` `e25e7f849a4c18f44e9a71e5bd5fb94ffaed631b` (#169 merged). Clean at start.
- **Traceability:** no existing TRACE entry covers the profile redesign (the latest is TRACE-155,
  Phase 7). No TRACE number was taken, because the Phase 7 branch may claim the next one, and
  `TRACEABILITY.md` was not edited. Codex or the owner assigns the entry when this slice is
  reviewed. Until then this file is the record.
- **Authority for the work:** the owner's task instruction of 2026-11-16 and the owner approval
  records dated 2026-11-05 in the design references (below). Those records are not yet entered
  in `governance/OWNER-APPROVALS.md` or the decision log; that entry is an open item for the
  owner, and nothing here claims it.

| Reference | Status as stated in the reference |
|---|---|
| Provider card redesign (6 pages) | Visual direction approved, 2026-11-05 |
| Profile interior redesign (7 pages) | Visual direction approved, 2026-11-05 |
| Complete profile and dynamic concept (7 pages) | Approved for further exploration, 2026-11-05 |
| Presentation next opportunities | **Not supplied to this session.** Out of this slice. |
| Implementation and test plan, 2026-11-05 | Proposed sequencing; this slice is its P1 |

Visual fidelity is **provisional**. The components follow the references' type scale, spacing,
2:1 cover and composition using repository tokens, but no side-by-side comparison against the
PDFs has been signed off, and the handoff folder itself was not present in the workspace (the
PDFs were read from the task attachment).

## What was built

Nothing on a live route changed. `/providers` and `/providers/[id]` are untouched.

- `src/lib/providerProfile/model.ts` — pure view model over rows shaped like today's public
  reads. Reuses `isPubliclyEligibleFixedPackage`, `isPubliclyEligibleQuotePackage`,
  `publiclyEligibleFixedFrequencies`, `tierPricingFrequency`, `formatCents`, `addonPriceLabel`,
  `walkthroughLabel`, `publicServiceAreas`, `summaryLine`, `displayedProviderBadges` and
  `EARLY_ACCESS_CTA`. It adds no eligibility, price or coverage rule.
- `src/components/provider-profile/` — `ProviderDirectoryCard`, `ProviderCover` (logo sized by
  its own proportions, photo cover, initials fallback), `ProviderProfileView`,
  `ProfileOfferPanels`, `ProfileMediaGallery`, `ProfileServiceArea` (uses the existing
  `ServiceAreaMap` unchanged) and `useServiceParam`.
- `src/app/mds/profiles/` and `src/components/mds/profiles/` — the gallery, behind the same
  `MDS_CATALOG_ENABLED=1` gate and `noindex` as `/mds`. All content is in
  `profileFixtures.ts`: five fictional providers, inline SVG illustrations, no file under
  `/public`.
- `/mds` gains one link to the gallery.

Scenarios: fixed-price (Brightbin Can Care), quote-only with four services (Harborline
Remodeling & Repair), mixed fixed and quoted (Palmetto Exterior Care), sparse (Northside
Handyman), long names with failed reads (Caloosa Riverbend …).

Behavior, each covered by a browser test:

- All services is the default and needs no answer.
- `?service=<id>` opens that service. A withdrawn, unoffered or unknown id shows a notice and
  All services; it is never selected.
- The choice is the URL. Changes use `history.pushState` (Next 16.4.3 documents that it syncs
  with `useSearchParams`), so Back and Forward restore it.
- Any change of service view discards package, cadence and extras.
- Identity, the review summary and the review list are identical in every view.
- Fixed prices, recurring prices ("billed per visit") and quotes use different wording. A
  deposit is shown apart from the quote headline.
- A listed ZIP says only that it is listed. Outside the provider's list, outside the
  Marketplace allowlist, unlisted and unreadable are separate results.
- Focus stays on the service selector; choosing from a list returns focus to it. Changes are
  announced through one polite live region.

## Run it

Local lane, isolated from the default one (3103 / 55831), which another session may be using:

```bash
cd ../mercurius-dynamic-profiles
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  MDS_CATALOG_ENABLED=1 MERCURIUS_BUILD_WORKERS=2 npm run build
npx playwright test --config playwright.profile-gallery.config.ts   # port 3123, no fixture server
```

To look at it:

```bash
MDS_CATALOG_ENABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3123
# http://127.0.0.1:3123/mds/profiles
```

The worktree has no `.env.local`, and none was copied. The Supabase URL is the repository's
synthetic test value; the gallery makes no backend request.

## Decisions for the owner

1. **Service selector form.** Built as visible choices (a radio group of chips) at every
   width. The approved mobile interior shows a dropdown. Choose one, or chips with a dropdown
   above some number of services.
2. **History per choice.** Every service change is a history entry, including arrow-key
   movement through the chips. Alternative: replace the entry and keep Back for leaving the page.
3. **Selections on return.** Package, cadence and extras reset whenever the service changes,
   including on Back. Alternative: remember them per service for the visit.
4. **Card lead offer.** With no service context a card shows the provider's first published
   offer by sort order. The reference says "the provider's chosen lead service"; no such field
   exists.
5. **Reviews wording.** With more than one service the list says reviews cover the whole
   business. Confirm the sentence.
6. **Sentence-case actions.** "Continue to request" and "Request a quote" follow MDS §9; the
   live profile uses title case.

## Gaps before any production route uses this

- **Server price preview.** The extras subtotal here is presentation arithmetic over published
  prices. TRACE-112 makes one server calculation the authority for preview and submission; a
  live profile must use it or drop the subtotal.
- **Service-linked media.** `contractor_gallery` has an image and a caption only. The
  `service_id` on media is a proposed field: schema, vendor editing, publication rights and
  backfill are all undecided.
- **Service questions.** No published-answer source exists. The fixtures carry a proposed
  shape with a provider or Marketplace source label.
- **"Quote after measuring".** The reference uses it; the data only supports "Quote after
  walkthrough". Not shown.
- **Provider accent colour and lead service.** No data source. The cover uses one Marketplace
  rule.
- **Video.** Poster, player, captions and fallback are not in this slice.
- **Prepaid bundles.** DEC-2026-048 is approved but not implemented, so only per-visit billing
  is labelled.
- **Access states.** The component takes `public` or `invited`. Waiting, revoked and
  unavailable cells all map to `public` today; wiring to `useTrialAccess` belongs to the
  integration slice.
- **Directory.** Search and category return, list position, and omission by category are
  demonstrated only as a service-context select in the gallery.
- **`ServiceAreaMap` legend** reads "Serves / Not served". It was left unchanged because the
  live profile uses it; the new section adds the sentence that listing is not booking.
- **Visual baselines.** No golden screenshots were added; the baseline environment and the
  owner's review of first images come first (plan P0/H). The existing win32 catalog baselines
  predate the new `/mds` link and were not regenerated.
- **Next.js advisory.** See the build note under Results.

## Not done

No push, merge, deploy, migration, hosted query or production change. No Phase 7 file, the
shared `HANDOFF.md`, `TRACEABILITY.md` or any gate was edited. No homeowner validation, real
phone, or screen-reader pass was performed.

## Next

Codex review of this slice. Then the owner reviews the gallery at desktop and phone widths and
answers the decisions above. The integration slice (P2 in the plan) starts only after both.

## Results

Run on 2026-11-16 in this worktree, Node 24.17.0, npm 11.13.0, WSL2. Final state of the branch.

| Check | Command | Result |
|---|---|---|
| Secret scan | `npm run scan:secrets` | Passed |
| Lint | `npm run lint` | No findings |
| Types | `npm run typecheck` | No errors |
| Unit | `npm run test:unit` | 68 files, 1005 of 1005 passed (32 new in `provider-profile-model.test.ts`) |
| Build | `npm run build` with the synthetic values above | Exit 0 at the final state (see note) |
| Gallery browser spec, isolated lane | `npx playwright test --config playwright.profile-gallery.config.ts` (port 3123) | 69 of 69 passed |
| Standard lane | `npx playwright test mds.spec.ts profile-gallery.spec.ts --grep-invert @visual` (3103 / 55831, both free at the time) | 88 of 88 passed: the existing catalog spec's 19 and the gallery's 69 |

The gallery spec covers axe (WCAG 2.0/2.1/2.2 A and AA) and reflow for the index and nine
profile views at 320, 390, 768, 1024 and 1440 px; 200% zoom; service switching by keyboard;
stale-selection clearing; explicit, withdrawn, unoffered and unknown service links; Back and
Forward; focus return; ZIP results; sparse and failed-read states; the next step by access
state; and the directory cards.

**Found and fixed during verification:** muted text on tinted surfaces measured 4.34–4.44:1
(now the `slate` token); a long extras label overflowed at 320 px (now wraps); the existing map
rendered oversized in a wide column (now width-limited; the component itself is unchanged).

**Build note.** Of four builds, two stopped with exit 1 after compiling, on a notice from the
Next.js CLI that 16.4.3 "is affected by a known security vulnerability" and recommending an
upgrade; the other two, including the last, exited 0 on the same code. Nothing was upgraded:
a dependency change is outside this slice and affects every branch. It needs an owner and
Codex decision, and CI may hit the same stop.

**Not run:** the full browser suite (`npm run test:a11y`), `npm run test:visual`, database
tests (no schema or data contract changed), and CI. The gate that returns 404 without
`MDS_CATALOG_ENABLED=1` was not exercised in a browser; it is the same check `/mds` uses.

**Manual checks not performed:** real phone, screen reader, a text-size setting other than
page zoom, forced colors, and a side-by-side comparison with the reference PDFs.

**Review images.** The spec writes them to `test-results/profile-gallery/` on every run (47
images: 320, 390 and 1440 px, full page, plus phone viewport shots). They are not committed:
15 curated images came to 4.5 MB against a 10.6 MB repository. A copy of the last run is in
`../mercurius-dynamic-profiles-review/`, outside git. In full-page phone images the fixed
action bar is laid out at the end of the page for the capture only; the `-viewport` images
show it pinned.
