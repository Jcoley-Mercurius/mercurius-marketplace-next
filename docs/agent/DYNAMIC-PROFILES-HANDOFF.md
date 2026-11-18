# Dynamic profiles — local review gallery (checkpoint)

This file is the checkpoint for one slice only. It does not replace `HANDOFF.md`, and it does
not change any authority, roadmap phase or release gate.

## Current status — P2B merged; P2C imagery in draft (2026-11-18 ET)

The owner merged P2B (PR #175) as `55e9667` at 18:35:51 UTC, and Vercel reported the production deployment complete at 18:36:42 UTC. No owner visual acceptance or manual check is recorded for it. P2C is draft PR #176 on `claude/trace156-p2c-profile-imagery` in `../mercurius-profile-p2c`, built on P2B head `9c4bd96` and targeting `main`. No photo is owner-approved, and P2C is not accepted, merged or released. See [P2C](#p2c--illustrative-service-imagery-trace-156-2026-11-18-et) at the end of this file. The status notes below are the earlier record and are kept as written.

## Earlier status — P2B awaiting CI, review and owner visual acceptance (2026-11-18 ET)

P2B remains a draft on PR #175. It is not accepted, merged or released. The CI diagnosis and the two commits it produced are in [P2B CI closeout](#p2b-ci-closeout-2026-11-18-et) at the end of this file. The result of CI on the final head is reported on the PR, because recording it here would change that head. The owner's visual acceptance and the manual checks listed there are still open. The status note below is the earlier record and is kept as written.

## Earlier status — P2B in implementation (2026-11-17 ET)

P2A is merged to `main` as `ba7db9c` (PR #174, final head `f67bb3f`); Codex's retrospective closeout review [5948874109](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/174#pullrequestreview-5948874109) found no new blocker. P2B — the real `/providers/[id]` route on the approved interior — is on `claude/trace156-p2b-profile-route` in `../mercurius-profile-p2b`, as a draft PR for Codex review. See [the P2B section](#p2b--the-real-provider-profile-uses-the-approved-interior-trace-156-2026-11-17-et) at the end. Not accepted, merged or released. The status notes below are the earlier record and are kept as written.

## Earlier status — 2026-11-17

PR #171 is merged as `a44a062`. Codex's retrospective review of final head `b4eb800` is recorded as [review #5941302731](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/171#pullrequestreview-5941302731): both earlier P2 findings resolved; no new blocking code findings in that scope. Exact-head CI 44007255413 passed backend/lifecycle/application (1,021 unit, 793 non-visual browser tests); independent focused model checks passed 78 assertions.

**Subsequent owner approval:** Josh approved the initial gallery layout/design and requested implementation with reasonable refinement alongside Phase 7. The approval is transcribed in `governance/OWNER-APPROVALS.md` on documentation PR #173, with proposed TRACE-156. It is not a claim that unperformed manual/reference/screen-reader/real-phone checks passed or that a live-route candidate has been accepted.

**Next executable slice:** P2A real directory cards, then P2B dynamic profile interior. Read [the integration handoff](../../governance/DYNAMIC-PROFILES-INTEGRATION.md). Work in a separate worktree/branch from current main (inspected `3327c83`, including the security patch), preserve Phase 7 files/processes, and return a draft implementation PR for review. Do not merge/deploy or add a database/media schema. The prior live-route/design approval holds below are historical; initial-layout approval is now recorded. PR #173 remains a documentation proposal until merged.

## Slice

- **Name:** Dynamic profiles — local review gallery.
- **Assigned by:** Josh, 2026-11-16, with Codex as architect and reviewer.
- **Branch / worktree:** `fable/dynamic-profiles` in `../mercurius-dynamic-profiles`.
- **Base:** `origin/main` `e25e7f849a4c18f44e9a71e5bd5fb94ffaed631b` (#169 merged). Clean at start.
- **Traceability:** no existing TRACE entry covers the profile redesign (the latest is TRACE-155,
  Phase 7). No TRACE number was taken, because the Phase 7 branch may claim the next one, and
  `TRACEABILITY.md` was not edited. Codex or the owner assigns the entry when this slice is
  reviewed. Until then this file is the record.
- **Authority for the work:** the owner's task instructions of 2026-11-16 and the three owner
  approval records dated 2026-11-05 in the design references (next section).

## Approval records (reconciled 2026-11-16)

Each design reference ends with its own approval record. They are restated here as written, so
this file, the code comments and the gallery's own text say the same thing.

| Reference | Owner instruction, 2026-11-05 | What the record approves | What it does not |
|---|---|---|---|
| Provider card redesign (6 pages) | "I want to lock that in on the design." | The consumer card **visual direction**: cover by logo, photo or video poster; one layout for service, business name, location, offer and profile link. | Profile interiors ("the next proposed design stage"). Truthful public content is still required. |
| Profile interior redesign (7 pages) | "I love it. That's approved as well." | The interior **visual direction**: business identity, work gallery, service and package selection, coordinated pricing summary, information hierarchy and the mobile composition. The mobile page shows the service as a dropdown. | Remaining sections, service area and dynamic behavior, which it sends to a separate supplement. Imagery, video and editorial examples are references only. |
| Complete profile and dynamic concept (7 pages) | "Let's lock that in to explore the concept of dynamic profile." | **Further exploration** of an optional service choice that focuses the provider's work, offer and pricing, with a return to All services. | Any production behavior. The reference states that "specific interaction and content decisions are proposed". |
| Presentation next opportunities | none | Nothing. **Not supplied to this session**, on either date. Out of this slice. | |
| Implementation and test plan, 2026-11-05 | none | Nothing. Proposed sequencing; this slice is its P1. | |

What follows from the records:

- **No record accepts what was built.** They approve reference designs. The plan's P1 review
  ("Josh reviews desktop and mobile appearance") is not recorded as done, and nothing in this
  file, the code or PR #171 claims it. Visual fidelity stays **provisional**: the components
  follow the references' type scale, spacing, 2:1 cover and composition using repository
  tokens, with no signed-off side-by-side comparison.
- **The prototype directions of 2026-11-16** (dropdown on mobile and chips on desktop, replace
  history, keep the ZIP, the reviews sentence) arrived with the revision instruction. They are
  recorded below as build directions for the prototype. They are not visual acceptance, and
  they do not turn the exploration into an approved production interaction.
- **One divergence from an approved record is corrected.** The first build used chips at every
  width, although the approved interior's mobile composition shows a dropdown. Phones and
  tablets now use the dropdown.
- **Still not entered in the repository's governance.** The three records exist only in the
  design references. `governance/OWNER-APPROVALS.md` and the decision log have no entry for
  them, and no TRACE entry covers the redesign. This revision adds none: assigning them is the
  owner's and Codex's step.
- The handoff folder itself is not in the workspace. The PDFs and the plan were read from the
  task attachments (the first session's and this revision's).

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
  All services; it is never selected. An id is looked up only as an own catalog name, so
  `__proto__`, `constructor`, `toString` and the like get the same notice as any unknown id.
- **One selection, two controls.** Below 1024 px the choice is a native dropdown; from 1024 px
  it is a radio group of chips. Both read and write the same value, so resizing swaps the
  control and keeps the choice and everything chosen within it.
- **The choice is the URL, and a change replaces the history entry.** `history.replaceState`
  (Next 16.4.3 documents that it syncs with `useSearchParams`) rewrites only the service
  parameter. Other query parameters keep their spelling and order, the hash is kept, and
  Next's router state stays in the entry. Back leaves the profile in one step; Forward and a
  reload return to the last service chosen.
- Any change of service view discards package, cadence and extras.
- **Optional-extra quantities are zero or within the published minimum and maximum**, the rule
  the request step's server calculation applies (`addon_quantity` in
  `20261018001000_pricing_catalog_calculation.sql`). The first step lands on the minimum, a
  step below the minimum removes the extra, and the control stops at the maximum. A stored
  value below the minimum is dropped and one above the maximum is lowered to it, so a preview
  never prices more of an extra than was chosen.
- Identity, the review summary and the review list are identical in every view. A profile with
  more than one service and at least one review adds "Reviews shown are for the business
  overall."
- Fixed prices, recurring prices ("billed per visit") and quotes use different wording. A
  deposit is shown apart from the quote headline.
- A listed ZIP says only that it is listed. Outside the provider's list, outside the
  Marketplace allowlist, unlisted and unreadable are separate results.
- **The ZIP stays through service changes.** Both the typed value and the last checked ZIP are
  kept, and the result is worked out again for the service now shown.
- Focus stays on the service selector; choosing from a list returns focus to whichever control
  is on screen. Changes are announced through one polite live region.
- **Gate.** Without `MDS_CATALOG_ENABLED=1` both gallery routes return 404 and none of the
  gallery's content.

## Run it

Local lane, isolated from the default one (3103 / 55831), which another session may be using:

```bash
cd ../mercurius-dynamic-profiles
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  MDS_CATALOG_ENABLED=1 MERCURIUS_BUILD_WORKERS=2 npm run build
npx playwright test --config playwright.profile-gallery.config.ts   # port 3123, no fixture server
```

The lane fails closed if its port is taken. `PROFILE_GALLERY_PORT=<port>` moves it. The spec's
gate check starts a second server from the same build on a free port, without
`MDS_CATALOG_ENABLED`, and stops it afterwards.

To look at it:

```bash
MDS_CATALOG_ENABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3123
# http://127.0.0.1:3123/mds/profiles
```

The worktree has no `.env.local`, and none was copied. The Supabase URL is the repository's
synthetic test value; the gallery makes no backend request.

## Decisions for the owner

Directed on 2026-11-16 and built in this revision. Each still needs the owner's look at the
gallery before it is treated as the production interaction:

1. **Service selector form.** Dropdown on phones and tablets, chips on desktop, one shared
   selection. The switch is at 1024 px, where the page already changes from the bottom action
   bar to the side panel; say if it should be elsewhere.
2. **History.** A service change replaces the entry. Back leaves the profile.
3. **Reviews wording.** "Reviews shown are for the business overall." It appears on profiles
   with more than one service and at least one review; say if it should appear on every profile.
4. **ZIP across services.** The ZIP stays and its result follows the service shown.

Still open:

5. **Selections on return.** Package, cadence and extras reset whenever the service changes.
   Alternative: remember them per service for the visit. (Only the ZIP is kept.)
6. **Card lead offer.** With no service context a card shows the provider's first published
   offer by sort order. The reference says "the provider's chosen lead service"; no such field
   exists.
7. **Sentence-case actions.** "Continue to request" and "Request a quote" follow MDS §9; the
   live profile uses title case.
8. **A stored quantity below a minimum.** It is dropped rather than raised to the minimum. The
   controls cannot produce one; it matters only if selections are ever restored from a link or
   storage.

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

## Historical implementation checkpoint — before the #171 merge

No merge, deploy, migration, hosted query or production change. No Phase 7 file, the
shared `HANDOFF.md`, `TRACEABILITY.md`, `OWNER-APPROVALS.md` or any gate was edited. No live
route imports anything in this slice, and no dependency changed.

On the owner's instruction (2026-11-16) the branch was pushed and draft PR #171 opened against
`main` for Codex review, and the revision below was pushed to the same PR. `main` is at
`44751a9` (#170, documentation only): no file overlap, clean merge, branch not rebased so the
pushed commits are the ones tested. No homeowner validation, real phone, or screen-reader pass
was performed. PR #171 stays a draft.

## Next

The retrospective code re-review and initial-layout/design approval are recorded. Begin the bounded P2A real-directory-card implementation using the integration handoff as read-only authority input from PR #173 if needed. Keep reset-on-service-change, deterministic contextual card lead, sentence case and removal of invalid below-minimum extras. Reconcile the documentation proposal before an implementation release; it need not block isolated P2A development. P2B follows P2A review.

The detailed build directions and open-item statements below are the historical implementation record; the dated current-status note and review above describe subsequent actions.

## Revision of 2026-11-16 (Codex review of `4622a80`)

Code and tests are commit `99e77aa`; this file's update is the commit after it.

| Item | Change | Where |
|---|---|---|
| Codex 1: unavailable service-name lookup | The id from the link was read straight from the catalog object, so `?service=__proto__` broke the page and `constructor` or `toString` produced a notice with no name. It is now read only as an own, non-empty string entry (`catalogServiceName`), and anything else gets "The linked service is not currently offered by …". `serviceDisplayName` uses the same lookup. | `model.ts`, `ProviderProfileView.tsx` |
| Codex 2: optional-extra quantities | A published minimum was ignored: an extra with a minimum of two could be set to one, and the preview priced it. Quantities now go through one rule (`addonQuantityBounds`, `normalizeAddonQuantity`, `stepAddonQuantity`) in the controls, the stored selection and the preview. Extras with a minimum above one show their limits and use "Increase / Decrease … quantity" controls. | `model.ts`, `ProfileOfferPanels.tsx` |
| Direction: selector | Dropdown below 1024 px, chips from 1024 px, one value. | `ProviderProfileView.tsx` |
| Direction: history | `replaceState`, with only the service parameter rewritten (`serviceSelectionUrl`). | `useServiceParam.ts`, `model.ts` |
| Direction: ZIP | The section is no longer reset per view; the result is derived from the checked ZIP. | `ProfileServiceArea.tsx`, `ProviderProfileView.tsx` |
| Direction: reviews sentence | "Reviews shown are for the business overall." | `ProviderProfileView.tsx` |
| Gate-off check | A second server without `MDS_CATALOG_ENABLED`: `/mds/profiles`, two scenario routes and `/mds` return 404 with none of the gallery's text, by request and in a browser; the same routes return 200 with the gate on. | `profile-gallery.spec.ts` |
| Fixture | Palmetto's gutter clean-out gains "Extra downspout flush" (minimum 2, maximum 6). | `profileFixtures.ts` |
| Approval records | Restated from the references; the gallery's text and the component comment now say the same. | this file, `ProfileGallery.tsx`, `ProfileGalleryScenario.tsx`, `ProviderProfileView.tsx` |

Before the fix, against the reviewed build (`4622a80`, still running on port 3123 at the
time): `?service=__proto__` rendered no notice at all, and `?service=constructor` and
`?service=toString` rendered " is not currently offered by Brightbin Can Care." with the name
missing.

Two notes for the reviewer:

- **Why the history state argument is `null`.** Next's patched `replaceState` treats state
  carrying its own marker as its own call and skips the `useSearchParams` sync. Given `null`
  it copies its router state into the entry itself. Handing back `window.history.state` would
  therefore stop the page updating. The browser test checks the marker is still in the entry
  after four changes, that the entry count is unchanged, and that Back, Forward and reload work.
- **Console errors in the inherited-name test.** `/_vercel/insights/script.js` (Vercel Web
  Analytics) is a 404 on every local page. That one request is answered in the test so any
  other console or page error fails it.

## Results

Run on 2026-11-16 in this worktree at `99e77aa` (the revision's code and tests), Node 24.17.0,
npm 11.13.0, WSL2. These replace the results recorded for `0e4c4d3`.

| Check | Command | Result |
|---|---|---|
| Secret scan | `npm run scan:secrets` | Passed |
| Lint | `npm run lint` | No findings |
| Types | `npm run typecheck` | No errors |
| Unit | `npm run test:unit` | 68 files, 1021 of 1021 passed (48 in `provider-profile-model.test.ts`, 16 of them new) |
| Build | `npm run build` with the synthetic values above | Exit 0 on the second attempt (see note) |
| Gallery browser spec, isolated lane | `PROFILE_GALLERY_PORT=3133 npx playwright test --config playwright.profile-gallery.config.ts` | 82 of 82 passed on the rerun (see note) |
| Standard lane | `npx playwright test mds.spec.ts profile-gallery.spec.ts --grep-invert @visual` (3103 / 55831, both free at the time) | 101 of 101 passed: the existing catalog spec's 19 and the gallery's 82 |

The gallery spec covers axe (WCAG 2.0/2.1/2.2 A and AA) and reflow for the index and nine
profile views at 320, 390, 768, 1024 and 1440 px, with the selector form checked at each
width; 200% zoom; service switching by keyboard, by dropdown and across a resize;
stale-selection clearing; a minimum-quantity extra from first selection to removal and to its
maximum; explicit, withdrawn, unoffered and unknown service links, and five inherited-name
ids; history replacement, Back, Forward and reload; unrelated parameters, the hash and scroll
position; focus return; ZIP results and the ZIP kept across services; the reviews sentence;
sparse and failed-read states; the next step by access state; the directory cards; and the
gate with the catalog disabled.

**Isolated-lane note.** Port 3123 was held by the review server the first session left
running, so the lane ran on 3133. The first full run at `99e77aa` started straight after the
build with the machine's load average near 6: 76 passed and 6 timed out at 30 s in steps this
revision did not change (reading a cover's size, the axe scan) on index and fixed-price view
tests. With the load back under 1 the whole lane was rerun and all 82 passed in 2.6 minutes.
An earlier run on the same code, before two test-only corrections, had 76 pass and 6 fail for
those corrections' reasons (a link locator, and the analytics 404 described above).

**Build note.** Four builds were run during this revision. Two stopped with exit 1 after
compiling and generating every page, on the Next.js CLI notice that 16.4.3 "is affected by a
known security vulnerability" and recommending an upgrade; each retry exited 0 on the same
code. That makes four stops in eight builds across both sessions. Nothing was upgraded: a
dependency change is outside this slice and affects every branch. It needs an owner and
Codex decision, and CI may hit the same stop.

**Not run:** the full browser suite (`npm run test:a11y`), `npm run test:visual`, and database
tests (no schema or data contract changed). CI on the PR is the full run; its result for this
revision is not recorded here.

**Manual checks not performed:** real phone, screen reader, a text-size setting other than
page zoom, forced colors, and a side-by-side comparison with the reference PDFs.

**Seen in the images, for the owner's look.** On a 320 px phone the closed dropdown clips a
very long service name, as a native control does; the full name is in the "Selected service"
line directly below it and in the open list.

**Review images.** The spec writes them to `test-results/profile-gallery/` on every run (47
images: 320, 390 and 1440 px, full page, plus phone viewport shots). They are not committed.
The first session's copy is in `../mercurius-dynamic-profiles-review/`; this revision's is in
`../mercurius-dynamic-profiles-review-r2/`. Both are outside git. In full-page phone images
the fixed action bar is laid out at the end of the page for the capture only; the `-viewport`
images show it pinned.

**The review server on port 3123** was started from the reviewed build and was not stopped or
restarted. The build directory has since been replaced, so restart it before looking at the
gallery (the command is under "Run it").

# P2A — the real provider directory uses the approved card (TRACE-156), 2026-11-17 ET

This section is the checkpoint for the integration slice. The gallery sections above stay as
written; nothing in them was re-tested here.

## Slice

- **Name:** TRACE-156 / P2A — integrate the approved provider cards into `/providers`.
- **Branch / worktree:** `claude/trace156-p2a-provider-cards` in `../mercurius-profile-integration`.
- **Base:** `origin/main` `3327c83a36c1fee6a7e33d9689293b537a627c14` (#172, the Next.js 16.4.6
  security patch). Clean at start. The Phase 7 worktrees, branches, ports and processes were
  not touched.
- **Authority:** the owner's approval of the initial gallery layout/design, recorded once in
  [OWNER-APPROVALS](../../governance/OWNER-APPROVALS.md#initial-profile-gallery-layout-and-design--2026-11-17),
  and Codex's scope in [DYNAMIC-PROFILES-INTEGRATION](../../governance/DYNAMIC-PROFILES-INTEGRATION.md)
  (*corrected 2026-11-17:* PR #173 was already merged to `main` as `d0c767d` at 17:42Z. This
  branch's base `3327c83` predates that merge and was not rebased, but CI's `pull_request`
  merge ref includes #173, and the PR merges cleanly).
  The approval authorizes the presentation work and reasonable refinement. It is not Phase 7
  acceptance, a release, or a claim that any manual, screen-reader, real-phone or production
  check has passed.
- **Traceability:** TRACE-156 is used as the slice name Codex assigned in the handoff.
  *Corrected 2026-11-17:* the TRACE-156 row already exists on `main` (added by #173). It records
  P2A as authorized but "live integration not yet implemented or accepted". This branch does not
  edit `TRACEABILITY.md`; Codex or the owner updates that row's evidence and status at acceptance.

## What it does

- `/providers` renders every listed provider through the approved `ProviderDirectoryCard`
  instead of the former identity-and-badges card. Category discovery, counts, the chip rail,
  `#cat-<id>` anchors, `#provider-<id>` targeting, the provider URL, the search field and the
  loading, failed, empty and no-match states all stay where they were.
- A new reader, `src/lib/providerProfile/publicOffers.ts`, supplies the real offers: one
  `vendor_packages` read for all the listed provider ids, then one `package_tiers` and one
  `package_addons` read for the packages that came back, batched 100 identifiers at a time.
  Columns, filters (`is_active`, `needs_review`, own offered add-ons) and ordering follow the
  public provider storefront, so the directory and the profile publish the same offers. There is
  no per-card request, no `select("*")`, no new grant, migration or schema change, and no write.
- Eligibility, price meaning, cadence and the price line stay with the existing helpers
  (`vendorPricing`, `pricingContent`) through the shared profile model. A row that arrives but is
  withdrawn or under review still cannot price a card.
- In a category group the lead offer must belong to a service in that category
  (`cardOfferFor`, context `category`); it never shows another category's price. With no
  narrower context the provider's first published offer leads. Free-text search is not treated
  as a service context.
- Packages, levels and extras are ordered by the provider's sort order with an id tie-break, so
  equal sort values no longer depend on the order rows arrive in.
- Missing and failed offers are different facts, and neither states an amount:
  `No published price yet` for a provider that publishes nothing in that context, and
  `Pricing unavailable right now` when a read failed. Both keep the card, its cover, identity
  and layout, and the unpriced card names the provider's listed catalog services instead. A
  failed level or add-on read is never priced from the rows that did arrive, because a missing
  required extra would advertise a lower starting price than the provider published.
- The search text is carried in the address (`?q=`), replacing the history entry, so opening a
  provider and coming back returns the same result list. It is read with the native History API
  rather than `useSearchParams`, which would need its own boundary on this prerendered page
  (`node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md`, "Shallow routing
  on the client").
- No service photo leads a directory card: `contractor_gallery` has no service link, so the
  cover is the real business logo or its initials fallback, and the directory reads no gallery.

## Run it

Local lane, isolated from the default one (3103 / 55831) and from the gallery lane (3123),
either of which another session may be using:

```bash
cd ../mercurius-profile-integration
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55841 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  MERCURIUS_BUILD_WORKERS=2 npm run build
npx playwright test --config playwright.provider-directory.config.ts   # port 3133, no fixture server
```

The lane fails closed if its port is taken; `PROVIDER_DIRECTORY_PORT=<port>` moves it. The spec
stubs every public read itself and aborts every request outside the app's origin, so it needs no
database and reaches no network. It writes its review images to
`test-results/provider-directory-cards/` on every run.

The same spec also runs in the repository's default lane (`npm run test:a11y`), so CI covers it.

To look at the route itself on this build:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55841 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3133
# http://127.0.0.1:3133/providers
```

With that synthetic Supabase value nothing answers, so the route shows its honest
"temporarily unavailable" state. The card rendering itself is reviewed through the spec's
images, which are produced from synthetic readbacks shaped like the current public responses.
The worktree has no `.env.local`, and none was copied; no production credential was used.

## Gaps and findings for Codex

1. **Category membership comes from the public listing's own services array** — corrected after
   Codex's review, which found the earlier wording wrong. That array is *not* the provider's
   declared services: `r0_public_providers`
   (`supabase/migrations/20261105001000_phase6_vendor_listing.sql`, the 2026-11-05 redefinition)
   derives it from active catalog services that have a live, review-cleared, unarchived eligible
   offering — a fixed price with valid exact levels, a Custom Quote, or a quote with a deposit.
   SQL 105 asserts that a declared service without such an offering is left out. A provider whose
   declared services have no live offering is still listable (`r0_provider_listable` only needs
   content and an active declared service) and simply comes back with an empty array. Grouping is
   unchanged, and no membership or count policy is proposed.
2. **The provider's description no longer appears on a directory card.** The approved
   composition answers offer, business, location and price; `bio` was on the former card. It is
   still on the profile. Flagged as a content change the approval implies but does not state.
3. **Return restoration is partial, as the handoff allows.** The directory restores its search
   from `?q=` on Back and the browser restores scroll position. The profile side (returning to a
   remembered list position, and a directory return control) is P2B; no claim is made for it here.
4. **No service query parameter is added to the card link.** The detail route does not consume
   one, so the link stays `/providers/<id>`.
5. **A deposit is not shown on a card.** A `deposit_quote` offer reads "Quote after walkthrough",
   with the deposit kept on the profile under current policy.

## Not done

No merge, deploy, migration, hosted query, secret, email or production change of any kind. No
Phase 7 file, no `TRACEABILITY.md`, `OWNER-APPROVALS.md`, governance authority or gate was
edited, and no dependency changed. P2B (the dynamic profile interior) is not started: the
provider detail route is untouched. Database tests were not run, because no data contract
changed. No real phone, screen reader, forced-colors, non-zoom text-size or side-by-side
reference comparison was performed, and no visual baseline was updated.

## Results

Run on 2026-11-17 in this worktree, Node 24.17.0, npm 11.13.0, WSL2. The code and tests are the
commit recorded in the PR; this section is the commit that carries it.

| Check | Command | Result |
|---|---|---|
| Secret scan | `npm run scan:secrets` | Passed |
| Lint | `npm run lint` | No findings |
| Types | `npm run typecheck` | No errors |
| Unit | `npx vitest run` | 69 files, 1033 of 1033 passed (15 new in `provider-directory-cards.test.ts`) |
| Build | `npm run build` with the synthetic public values | Exit 0 |
| Directory browser lane, isolated | `npx playwright test --config playwright.provider-directory.config.ts` (port 3133) | 15 of 15 passed |
| Default lane, directory-adjacent specs | `npx playwright test provider-directory-cards.spec.ts vendor-listing.spec.ts provider-badges.spec.ts provider-service-area.spec.ts profile-gallery.spec.ts --grep-invert @visual` (3103 / 55831, both free at the time) | 115 of 115 passed |

The new browser spec covers, from synthetic readbacks: the approved card and its 2:1 cover at
320, 390, 768, 1024 and 1440 px, with axe (WCAG 2.0/2.1/2.2 A and AA) and reflow at each width;
a fixed one-time price that includes its required extra and its scope; a recurring offer's
starting price; a custom quote with a published estimate; a deposit quote whose deposit is not a
job price; an under-review package and a withdrawn one, neither of which prices a card; a
provider with no package; an unlisted provider's package, which gets no card; a very long
business name; a logo that fails to load, falling back to initials; a failed package, level and
add-on read, each leaving every provider listed, unpriced and amount-free; a category lead that
cannot cross into another category; category counts, the chip rail, `#cat-` anchors and
`#provider-` targeting; provider, city and catalog-service search, `?q=`, Back from a profile,
and clearing; and each card link's accessible name, focus and 44 px target.

**Pre-existing contrast, found.** With providers rendered, axe reported two colour-contrast
failures on `/providers`: the category chip's provider count (`text-xs opacity-60`, 4.06:1) and
the closing invitation paragraph. This candidate excluded them by name and reported them instead
of repairing them. **Superseded by the revision below**, which repairs both and removes the
exclusions; pre-existing status is not an approved accessibility exception.

**Not run:** the full browser suite (`npm run test:a11y`), `npm run test:visual`, and database
tests (no data contract changed). CI on the PR is the full run; its result for this candidate is
not recorded here.

**Local note.** This shell had `NODE_ENV=production` set, which makes `npm ci` skip dev
dependencies and makes two `application-notification-tracing` unit assertions fail on the
logger's reported environment (`local` instead of `test`). Both are environmental: with
`NODE_ENV` unset the whole suite passes. Nothing in that logger was touched.

**Review images.** The spec writes them to `test-results/provider-directory-cards/` on every
run: the directory at 320, 390 and 1440 px full page, and the failed-offer-read state at
1440 px. They are not committed.

## Revision of 2026-11-17 (Codex P2A review of `e7cf134`)

Codex requested changes on PR #174 (review `5943079065`). Both P2 findings are repaired here and
the six dispositions are applied. The slice, base, authority and boundaries above are unchanged.

### 1. A capped response is no longer taken as the whole set

Codex reproduced the defect independently: batching 100 identifiers bounds the query string, not
the returned rows. PostgREST caps a response (1,000 rows by default) and that cap is a
*successful* response, so one short answer was accepted as complete. With 100 providers, each
priced $100 with eleven required $1 extras, the 1,100 add-on rows met the ceiling and the last
provider's card read $100 where the provider published $111.

`fetchPublicProviderOffers` now reads every table through one paging helper:

- each request takes an explicit window (`range`) over a stable server-side order — `sort_order`,
  then `id`, so windows neither overlap nor skip;
- the window advances by the rows that actually arrived, whatever the server's own ceiling;
- the set ends only when the server reports nothing past it;
- the total is checked against the exact count the server reported for the first window
  (`count: "exact"`, requested once per read);
- a failed later page, a missing count, a count that disagrees with the rows received, or a read
  that will not finish within a bounded number of requests all return `unavailable`. The partial
  rows are never used, and no hosted row limit is raised.

Regression coverage in `tests/unit/provider-directory-cards.test.ts` reproduces the reviewer's
scenario against the real reader and model: it first asserts that one capped response alone
yields `$100`, then that the reader yields `$111`; that the add-on windows advance `0, 500,
1000, 1100`; that the ceiling cuts through a package's required extras rather than between
packages; that 150 providers page inside *both* identifier batches, not only the first; that a
failed later page is `unavailable`; and that rows falling short of the reported count are
`unavailable` rather than priced.

### 2. The directory's contrast is repaired and nothing is excused

Both failures are fixed with existing approved semantics, not a global palette change:

- the category chip's count drops `opacity-60` and takes `text-slate` — it is essential
  information, not a dimmed copy of the label;
- the closing invitation paragraph takes `text-slate` on the tinted band, where the muted
  foreground is specified against the plain background.

`PRE_EXISTING` and the selector-based filtering are gone. The spec now asserts the whole rendered
page clean at 320, 390, 768, 1024 and 1440 px, asserts the cards clean separately, and measures
the repaired text's actual painted contrast — compositing every translucent band it sits on — at
rest, on hover and on focus, requiring 4.5:1 at every width. The hovered and focused states are
also re-run through axe while the state is held. Measured ratios are printed by the run and are
recorded below.

### 3. Dispositions applied

1. **Category source corrected.** Grouping still uses the public RPC's services array, and the
   description of that array is fixed throughout (Gaps item 1, the comment in
   `src/app/providers/page.tsx` and the spec's header): it is derived from active catalog
   services with a live, review-cleared, unarchived eligible offering, not from declared
   services. The normal browser fixtures now match that contract — every listed service has an
   eligible offering, and the provider that publishes nothing comes back with an empty array and
   lands in the catch-all group, which is also where its under-review and withdrawn packages are
   proved unable to price a card. Responses that disagree with the contract are kept, relabelled
   as explicitly defensive scenarios.
2. **Card description:** accepted as written; the bio stays on the profile.
3. **Contrast:** repaired locally as above; no global token approval sought or needed.
4. **Return restoration:** the spec no longer implies a full round trip. It states that the
   directory-side state returns from the address and that profile-side return control and
   list-position restoration are P2B.
5. **Card links:** unchanged at `/providers/<id>`.
6. **NODE_ENV:** every install and check in this revision ran with `NODE_ENV` unset. The logger
   and its assertions are untouched.

### Revision results

Run on 2026-11-17 in this worktree, Node 24.17.0, npm 11.13.0, WSL2. Every install and check in
this revision ran with **`NODE_ENV` unset** (`env -u NODE_ENV …`); the earlier candidate's two
environmental unit failures do not recur, and no logger or assertion was changed.

| Check | Command | Result |
|---|---|---|
| Secret scan | `npm run scan:secrets` | Passed |
| Lint | `npm run lint` | No findings |
| Types | `npm run typecheck` | No errors |
| Unit | `npx vitest run` | 69 files, 1037 of 1037 passed (19 in `provider-directory-cards.test.ts`, 4 of them the response-ceiling regressions) |
| Build | `npm run build` with the synthetic public values | Exit 0 |
| Directory browser lane, isolated | `npx playwright test --config playwright.provider-directory.config.ts` (port 3133) | 21 of 21 passed |
| Default lane, directory-adjacent specs | `npx playwright test provider-directory-cards.spec.ts vendor-listing.spec.ts provider-badges.spec.ts provider-service-area.spec.ts --grep-invert @visual` (3103 / 55831) | 39 of 39 passed |

**Measured contrast (the evidence for finding 2).** The spec paints each element's real
composited colours on a canvas, so the oklab tints are measured as rendered, and prints every
ratio. At all five widths: chip label 14.28 at rest and 5.84 hovered and focused; chip count
6.88 at rest and 6.15 hovered and focused; invitation paragraph 6.53 in every state. All exceed
the 4.5:1 requirement, and the whole page — not an allowlisted subset — is asserted clean by axe
at rest and while each state is held.

**Two test-harness defects were found and fixed while verifying this** (both in the new spec,
not in the application): the stub answered `range()` from a `Range` header, but PostgREST sends
`offset`/`limit` query parameters, so windows never advanced; and the first contrast helper
parsed colour strings itself, which produced nonsense for the `oklab()` values Tailwind emits
for tinted backgrounds. While the first defect was present the reader behaved exactly as
designed — it refused to price anything it could not prove complete.

**Not run:** the full browser suite (`npm run test:a11y`), `npm run test:visual`, and database
tests (no data contract changed). CI on the PR is the full run.

**Lane budgets.** Two budget problems were found and fixed, neither a test failure:

- A first default-lane run of this revision timed out in six tests while the machine was loaded —
  including the untouched `provider-service-area` spec, which is why the cause is read as load
  against that lane's 30 s per-test budget rather than the change. The new spec was split per
  width, so each test fits well inside it; the rerun above passes 39 of 39.
- CI run 44154503451 on `313f667` then **cancelled** the `application` job at its 20-minute
  `timeout-minutes` cap, during the browser step. Lint, the secret scan, types, unit, the
  production audit and the build all succeeded first, and `lifecycle` passed (the earlier
  infrastructure failure did not recur). The same job takes about 14 m 50 s on `main`, so the
  new spec's roughly thirty axe scans consumed the headroom. The scans are now twelve, with no
  loss of what they prove: the whole page is scanned at every width at rest (which also covers
  the cards, since nothing is excluded any more), the held hover and focus states are scanned at
  the narrowest and widest widths, the contrast is still *measured* in every state at all five
  widths, and one of the three identical failed-read pages carries the scan. The isolated lane
  went from 1 m 06 s to 53 s for the same 21 tests. No workflow file or timeout was changed.

## Candidate `535d722` — Codex re-review and exact-head CI (2026-11-17)

Codex re-reviewed `535d722` and closed both P2 findings (the response ceiling and the
directory's contrast). Nothing was reimplemented after that review. This section adds only
evidence, and it is a documentation-only commit on top of the candidate.

**Exact-head CI: run 44168091887, `pull_request` on `535d722`, all required jobs passed.**

| Job | Result | Duration |
|---|---|---|
| `backend` | Passed | 9 m 33 s |
| `lifecycle` | Passed | 3 m 31 s |
| `application` | Passed | 16 m 20 s (cap 20 m) |
| Supabase Preview | Skipped (no migration) | — |

Inside `application`, lint, the secret scan, types, the production audit and the build all
passed. Unit tests ran 69 files and passed 1037 of 1037. The browser step (`npm run test:a11y`)
passed 814 tests in 14.0 m, with no flaky, retried or skipped tests, and all 21 tests in
`provider-directory-cards.spec.ts` ran. The run that `313f667` cancelled at the cap now fits,
with about 3 m 40 s of headroom. No workflow file or timeout was changed.

The closeout gates first listed here are superseded by the section below. That list wrongly said
#173 was not on `main` and that the TRACE-156 row still had to be entered.

## Documentation head `11e8d54` failed CI: an order-dependent unit-test mock (2026-11-17)

CI run 44173445715 on `11e8d54` (a documentation-only commit on top of `535d722`) failed in job
134366945834, in `application` → Unit tests. One test failed, 1036 passed:
`tests/unit/application-notification-tracing.test.ts:621`, "logs an intake guard refusal with
its enumerated reason", which expected 429 and received 201. `backend` and `lifecycle` passed. P2A
does not touch that file or the route, so the same file on `main` carries the same defect.

**Cause: a race between two module mocks, found in the test file and in vitest 4.1.11.** The
journey `beforeEach` calls `vi.resetModules()` and queues
`vi.doMock("@/lib/intakeProtection", … intakeGuardRefusal: () => null)`. The failing test then
queued a second `doMock` of the same id with `() => "trap"` before its first import. Vitest
resolves queued mocks only at the next import, and `resolveMocks()` resolves each run of
consecutive "mock" entries **concurrently** (`Promise.all`). Each entry registers once its own
async `resolveId` returns, and the last registration replaces the earlier one. When the
`beforeEach` factory registers last, the guard passes, the route saves the application and
answers 201. The route itself behaves correctly in both orders; only the test's set-up was
order-dependent.

**Reproduced locally on the unchanged file:** 2 of 15 full-file runs failed with the identical
`expected 201 to be 429`. The filtered runs (0 of 25) never failed.

**Repair (test only, assertion unchanged):** the `beforeEach` intake mock now returns a per-test
`intakeRefusal` value (default `null`), and this test sets it to `"trap"` instead of registering a
competing mock. This is the same pattern the file already uses for `storageError` and
`insertError`. The test still asserts 429, no insert, exactly one `application_submission.refused`
line with `intake_trap`, and no sensitive data. No production code changed. After the repair, 0 of
40 full-file runs failed. The other unit files that use `vi.doMock` (`invitation-open-link`,
`vendor-readiness`, `owner-email-ledger`) were checked: each flushes its queued mock with an
import before the same module is mocked again, so none carries this race.

**Phase 7 coordination.** The file belongs to TRACE-151 (Phase 7.1, merged on `main` in
`438714c`). No Phase 7 branch, worktree or open PR modifies it, so the change does not overlap
Phase 7 work. It is kept to one test-set-up hunk so that Codex can carry it independently of P2A
if preferred.

**Checks after the repair** (Node 24.17.0, `NODE_ENV` unset): secret scan passed; lint, no
findings; types, no errors; unit, 69 files, 1037 of 1037. The application, browser specs and build
are unchanged from `535d722`, so the browser lane was not rerun locally. CI on the new head is the
full run.

**`main` state confirmed:** `origin/main` is `d0c767d` (the #173 merge). #173 carries the owner
approval record, `DYNAMIC-PROFILES-INTEGRATION.md`, `DYNAMIC-PROFILES-REVIEW.md` and the
TRACE-156 row.

**Closeout gates still open:**

- Green exact-head CI on the head that carries this repair.
- Codex's review of the test repair (a TRACE-151 test file), the PR's approval, and its move out
  of draft.
- Codex or the owner updates the existing TRACE-156 row with P2A's evidence and status at
  acceptance.
- No manual, real-phone, screen-reader, forced-colors or text-size check has been performed, and
  none is claimed. The owner decides whether any of them is required before release.
- The owner merges the PR, which is the release approval (DEC-2026-037). There is no migration,
  so nothing is pushed to the hosted database first.

P2B (the dynamic profile interior) has not started. No Phase 7 product code or Phase 7 branch was
touched. The only Phase 7 file changed is the test set-up described above.

## CI on `2bb0ca8`: a timeout across the whole suite, then a gallery-spec race (2026-11-17)

The closeout gates in the section above are superseded by the list at the end of this one.

**Attempt 1 of run 44186485645 hit the job's time limit.** `backend` and `lifecycle` passed. In
`application`, the unit tests passed 69 of 69 files, including the repaired TRACE-151 test. The
job was then cancelled at its 20-minute `timeout-minutes` during the browser step, after 792 of
814 tests had passed and none had failed or retried. Every spec ran about 25–30% slower than on
`535d722`. For example, `request.spec` took 174 s against 144 s, and the directory spec 27.5 s
against 20.8 s. That pattern points to a slower runner, not to a test.

**The time limit was already a problem on `main`.** The `application` job on `main`'s last
three pushes was also cancelled at 20 minutes, during the single-worker browser step:

| Run | Commit | Browser tests passed |
|---|---|---|
| 44139983494 | `d0c767d` (#173) | 793 of 793, still cancelled |
| 44117454907 | `3327c83` (#172) | 734 of 793 |
| 44095862042 | `a44a062` (#171) | 750 of 793 |

P2A adds about 21–28 s. **Decision for Codex or the owner, shared with Phase 7:** raise the
`application` timeout, or shard the browser step or give it more workers. No workflow file was
changed here.

**Attempt 2 (a re-run for exact-head evidence) finished within the limit and found one failure.**
The browser step passed 813 of 814 tests in 13.2 m, and the unit tests passed 1037 of 1037. The
failure was `profile-gallery.spec.ts:91`, "profile mixed quoted service 1024px", with
`locator('[data-profile]')` resolving to two elements, a strict-mode violation. That spec is the
P1 gallery from #171, and P2A does not touch its route or its spec.

**Cause, read from the CI trace (`accessibility-evidence` artifact).** The final DOM snapshot
holds the live `main#main-content > div[data-profile]`, and also a second copy inside
`body > div#S:0[hidden] > main#main-content`. That second copy is React's streamed Suspense
segment, which had not yet been revealed and removed. The hidden copy is outside the
accessibility tree and nobody can see it, but a bare CSS locator counts it. Playwright reports a
strict-mode violation immediately instead of retrying, so the assertion failed on that moment.
This was not reproduced locally; the evidence is the CI trace.

**Repair (test only, in the spec's `open()` helper):** after the heading is visible, `open()`
now asserts that no `div[hidden][id^="S:"]` segment remains before anything else is checked.
This is stricter than before: a segment that never resolved would now fail the test instead of
being masked. No assertion was loosened, and no application code changed.

**Checks after the repair** (Node 24.17.0, `NODE_ENV` unset; build with the synthetic public
values, exit 0):

- Lint: no findings. Types: no errors.
- Isolated gallery lane (`playwright.profile-gallery.config.ts`, port 3143): 82 of 82 passed.
- The 45 profile-view tests repeated 4 times (`--repeat-each=4`): 180 of 180 passed, none flaky.

**Closeout gates still open:**

- Green exact-head CI on the head that carries both test repairs. Because of the time-limit
  problem above, a run can still be cancelled through runner speed alone.
- A decision on the `application` job's CI budget.
- Codex's review of the two test-only repairs (`application-notification-tracing.test.ts` from
  TRACE-151 and `profile-gallery.spec.ts` from #171), the PR's approval, and its move out of
  draft.
- Codex or the owner updates the existing TRACE-156 row with P2A's evidence and status at
  acceptance.
- No manual, real-phone, screen-reader, forced-colors or text-size check has been performed, and
  none is claimed. The owner decides whether any of them is required.
- The owner's merge, which is the release (DEC-2026-037). There is no migration to push first.

# P2B — the real provider profile uses the approved interior (TRACE-156), 2026-11-17 ET

This section is the checkpoint for the P2B slice. The sections above stay as written; nothing in
them was re-tested here.

## Slice

- **Name:** TRACE-156 / P2B — integrate the approved dynamic profile interior into `/providers/[id]`.
- **Branch / worktree:** `claude/trace156-p2b-profile-route` in `../mercurius-profile-p2b`.
- **Base:** `origin/main` `ba7db9c` (P2A, #174). Clean at start. The main checkout (`a44a062`),
  the P2A worktree and every Phase 7 worktree, branch, port and process were left untouched.
- **Authority:** the owner's initial layout/design approval and Codex's P2B constraints in
  [DYNAMIC-PROFILES-INTEGRATION](../../governance/DYNAMIC-PROFILES-INTEGRATION.md), with the source
  constraints of Codex's retrospective review
  [5948874109](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/174#pullrequestreview-5948874109).
- **Traceability:** the existing TRACE-156 row is updated to record P2A merged and P2B in
  implementation; its earlier text is kept.

## What it does

- **Reads (`src/lib/providerProfile/publicProfile.ts`).** The same public reads the inherited
  storefront made: `r0_public_providers` (decides whether a profile exists), P2A's paged,
  count-checked offer reader for packages/levels/extras, `package_qualifying_questions`,
  `public_provider_reviews`, `contractor_gallery`, `contractor_service_zips`, `coverage_areas`,
  `services_catalog` and `get_completed_job_counts`. No new grant, write, schema or service-role
  access. Legacy promotions stay closed (no promotion or clock read).
- **Failure is reported per section.** An incomplete or failed package, level or extra read is
  `offersStatus: "unavailable"`: no amount anywhere, "Prices unavailable right now … This doesn't
  mean they have none", the listing's services named, and a retry. A linked service then reads
  "can't be shown right now", never "not offered". *This fixes an inherited defect:* the old
  storefront priced fixed packages without their required extras when the extras read failed.
  Reviews, photos and coverage each have their own unavailable state.
- **Supported business information kept:** tagline, bio, credentials, experience, completed jobs
  through Mercurius, verified specialty, the provider's promise and video (the inherited
  YouTube/Vimeo/direct player). Photos are labelled "General business photo · not specific to
  {service}" in a service view, because `contractor_gallery` has no service link. No service FAQ
  is shown: no published source exists.
- **Extras are information.** Live profiles pass `interactiveExtras={false}`: optional extras are
  listed as "Optional extras · chosen in the request step … Not included in the price shown";
  there are no quantity controls and no local subtotal. Required extras stay in the price.
  "Quote after walkthrough" and the separate deposit wording are unchanged. The gallery keeps its
  interactive extras.
- **Service links.** `?service=` opens that service; withdrawn, unknown, inherited-name
  (`__proto__`) and malformed ids show the "not currently offered" notice and All services. A
  change replaces the history entry (Back leaves the profile in one step), resets package and
  cadence, and keeps the typed and checked ZIP. The bedroom size guide (TRACE-122) appears beside
  the offer whose levels depend on bedrooms.
- **Provider changes.** The route is keyed by provider id, so a move to another provider starts
  from nothing (package, ZIP, media failures, reviews). Every load takes a ticket; only the
  newest may change the page, so a slow retry, refresh or realtime-triggered read cannot
  overwrite a newer one or reach the next provider.
- **Refresh and withdrawal.** The inherited 60-second refresh and realtime subscription stay. A
  withdrawn offer becomes the "not currently offered" notice with an announcement; a provider
  leaving the listing becomes "Provider not found"; a refresh that cannot read the listing keeps
  the page, hides every price and offers a retry (it no longer replaces the page, and the ZIP).
- **Access.** `useTrialAccess` drives the action: loading ("Checking booking access", busy,
  inert), error (retry the admission read), signed out / not a homeowner (early access with the
  chosen service), waiting ("See my early-access status" → `/dashboard`), revoked/unavailable
  ("Go to my dashboard"), invited (request). An error is never read as access.
- **Request continuation** uses the existing entry (`homePlanSelection`,
  `preferredProviderSelection`, `/request?provider=…&service=…`): provider, service, package,
  cadence and pricing mode are bound. **A level is bound only when the cadence publishes exactly
  one level without an answer rule**; otherwise no `tierId` is sent and the request's server
  calculation resolves it from answers. The inherited page sent the cheapest of several
  non-rule levels; that is no longer presented as the homeowner's level. Qualifying questions
  travel with the package; if they could not be read they are left out (not sent as none) and
  the request falls back to the server preview's `question_details`, whose `answers_required`
  outcome still enforces them (`src/app/request/page.tsx:655`). Promotions are never handed over.
  In All services an invited homeowner is asked to choose a service first (focus moves to the
  chooser), so the request stays bound to one of this provider's services.
- **Directory return.** Category cards link to `/providers/<id>?service=<lead>&q=<search>&category=<id>`
  (validated slugs and bounded search text). The profile's "Providers" link is built from those
  validated values — never from an address — as `/providers?q=…&category=…&provider=<id>`. Opening
  a card also records `provider`/`category` in the directory's own entry, so the browser's Back
  restores the same way: the directory scrolls the card into view, focuses its link, then removes
  the marker and keeps `?q=`.
- **Rule bounds.** P2A's tier reader now also selects `rule_min`/`rule_max`, so the shared shape
  carries each level's whole published rule (Codex review constraint).

## Decisions and findings for Codex

1. **"Managed by Mercurius" banner removed.** The inherited storefront said the provider "is
   monitored and performance-tracked as part of the Mercurius network". The approved
   composition has no such panel and the claim's operational basis is not established here
   (MPS §8: describe only checks performed). Flagged as a content change; restore if wanted.
2. **Early access from All services sends no service.** The inherited page preselected the
   provider's first listed service; nothing was chosen, so none is sent now.
3. **Non-rule multi-level packages bind no level** (see above). The server's own candidate
   choice is unchanged; only the profile's claim about the homeowner's level is removed.
4. **Website** is still not shown (the inherited page did not show it either).
5. **Test-only access to `window.next.router`** (exposed by Next.js for debugging) is used in
   one spec to make a genuine client-side provider-to-provider navigation.
6. **Shared CI budget.** The new spec adds about 50 s to the default browser lane, which `main`
   already overruns at the `application` job's 20-minute cap (run 44206655843 on `ba7db9c` was
   cancelled there). Not changed here; it remains the shared follow-up Codex named.

## Run it

```bash
cd ../mercurius-profile-p2b
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55851 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key \
  MDS_CATALOG_ENABLED=1 MERCURIUS_BUILD_WORKERS=2 npm run build
npx playwright test --config playwright.provider-profile.config.ts   # port 3153, no fixture server
```

The lane fails closed if its port is taken (`PROVIDER_PROFILE_PORT=<port>` moves it). The spec
serves every public read itself from the gallery's synthetic providers and aborts everything
outside the app's origin. Review images go to `test-results/provider-profile-route/`, including
`compare-<provider>-<width>-gallery.png` / `-live.png` pairs. The worktree has no `.env.local`.
Without a stub, a live `next start` on that build shows the honest "Provider profile
unavailable" state, because nothing answers on the synthetic Supabase URL.

## Results

Run on 2026-11-17 ET in this worktree, Node 24.17.0, npm 11.13.0, WSL2, `NODE_ENV` unset.

| Check | Command | Result |
|---|---|---|
| Secret scan | `npm run scan:secrets` | Passed |
| Lint | `npm run lint` | No findings |
| Types | `npm run typecheck` | No errors |
| Unit | `npx vitest run` | 70 files, 1052 of 1052 passed (15 new in `provider-profile-route.test.ts`) |
| Build | `npm run build` with synthetic public values (both 55851 and 55831 lanes) | Exit 0 |
| Profile lane, isolated | `npx playwright test --config playwright.provider-profile.config.ts` (3153) | 32 of 32 passed |
| Default lane, affected specs | `provider-profile-route`, `provider-directory-cards`, `provider-service-area`, `provider-badges`, `vendor-listing`, `pricing-approval`, `profile-gallery` with `--grep-invert @visual` (3103 / 55831) | 165 of 165 passed |
| Default lane, request consumers | `request.spec.ts`, `early-access.spec.ts` | 138 of 138 passed |

The new browser spec covers, from synthetic readbacks: the composition at 320, 390, 768, 1024
and 1440 px with whole-page axe (WCAG 2.0/2.1/2.2 A/AA), reflow and one 44 px action; business
facts, promise and video; the general-media label; no FAQ; required extras in the price and
optional extras as information only; deposit apart from the quote; the size guide; direct,
withdrawn, unknown, `__proto__` and malformed service links; unlisted and malformed provider ids
(the malformed one is not read); history replacement, Back/Forward, cadence reset and ZIP
retention; dropdown/chip keyboard choice; failed and capped extras, failed levels and recovery;
failed reviews/photos/coverage; refresh withdrawal, refresh failure and listing withdrawal; a
failed first read; provider-to-provider reset with a late response in flight; directory search,
category and position return through the profile link and the browser's Back, and a crafted
return address; every admission state; and the request handoff (binding, no cheapest
answer-based level, questions, unreadable questions).

**Existing specs updated, meaning kept:** the detail-route specs (`provider-service-area`,
`provider-badges`, `vendor-listing`, `pricing-approval`) now answer reads with an exact count
(`tests/fixtures/postgrest.ts`), find the provider heading at level 1 (the profile adds "About
…"), and assert the same facts against the approved composition (map and community list, ZIP
counts, credentials list without Top Rated, required extra in `$99`, "From $100 / set by your
answers", the estimate, the size guide, no private notes). One P2A directory test now finds the
profile heading at level 1.

**Found while verifying:** a business-facts `<dl>` nested `dt`/`dd` too deep (axe
`definition-list`), now a list; and a first default-lane run had one gallery test
(`long names and failed reads 390px`) time out at 30 s while a build ran beside it; it passed in
2.1 s on the rerun and is treated as load, not a defect.

**Not run / not claimed:** the full `npm run test:a11y` suite, `npm run test:visual`, database
tests (no data contract changed), real phones, screen readers, forced colours, 200 % browser zoom
beyond the 320 px reflow, and owner visual acceptance. The comparison images are review material,
not baselines. No merge, deploy, migration, hosted query, gate change or Phase 7 edit.

## P2B CI closeout (2026-11-18 ET)

This section supersedes finding 6 above ("Shared CI budget … Not changed here") and adds to the
"Not run / not claimed" list. The earlier text stays as the record of 2026-11-17.

**What the runs showed.** PR run 44215697628 passed on `b33a63b`. Push run 44215656433 on the same
commit never passed in eight attempts, for three separate reasons:

| Attempt | `application` result | Browser tests | Cause |
|---|---|---|---|
| 1 | Cancelled at start | None | The PR run on the same branch replaced it (shared concurrency group) |
| 2 | Cancelled at 20 m | Not reached | Job time limit |
| 3, 6, 7 | Cancelled at 20 m | 735, 817 and 762 of 846, none failed | Job time limit on a slower runner |
| 4 | Failed | 845 of 846 | `mds.spec.ts:50`: axe scanned the mobile menu during its fade |
| 5 | Cancelled at 20 m | 758 of 846, 2 failed | Job time limit, plus the two failures below |
| 8 | Failed | 845 of 846 | `invitation-operations.spec.ts:185`: "Response has been disposed" |

**Repairs, each its own commit. No test, assertion, worker setting or security check was removed.**

1. `11f459f` raises only the `application` job's `timeout-minutes` from 20 to 30, as Codex directed.
2. `3be88cc` removes two test races. No application code changes.
   - `mds.spec.ts`: the scan now waits for finite animations to end. The evidence is attempt 4's
     artifact, which reports the menu title at 1.15:1 mid-fade. **This failure was not reproduced
     locally.** A throttled local comparison failed once on the old test by timing out, which is
     not the same failure, so it is not offered as proof.
   - `invitation-operations.spec.ts` and `invitation-binding.spec.ts`: a refresh still in flight
     when the test ends no longer fails it. Both use the `unrouteAll` cleanup that three other
     specs already use. The evidence is attempt 8's trace.

**Still undiagnosed.** Attempt 5 also failed `invitation-binding.spec.ts:225` and
`request.spec.ts:837`. That job was cancelled before Playwright printed its failure details, and
no artifact was kept, so neither cause is known. The first has the same shape as attempt 8's
failure and is covered by the same cleanup, but that is an inference. The second passed 30 of 30
repeated local runs and was left unchanged. Nine other specs use the same fetch-and-patch handlers
without the cleanup; they have not failed and were not changed.

**Local checks on `3be88cc`** (Node 24.17.0, WSL2, `NODE_ENV` unset): secret scan passed; lint, no
findings; types, no errors; unit, 70 files and 1052 of 1052; build exit 0; isolated profile lane,
32 of 32; `mds`, `invitation-operations` and `invitation-binding` specs, 50 of 50. The full
`npm run test:a11y` suite was not run locally. CI is that run.

**Open before acceptance:** green CI on the final head; Codex's review of these two commits; the
owner's review of the comparison images; and the manual checks that have not been performed: real
phones, a screen reader, forced colours, 200% browser zoom beyond the 320 px reflow check, and a
side-by-side comparison with the reference PDFs. The comparison images are review material, not
baselines, and no visual baseline was changed.

# P2C — illustrative service imagery (TRACE-156), 2026-11-18 ET

## Slice

- **Branch / worktree:** `claude/trace156-p2c-profile-imagery` in `../mercurius-profile-p2c`.
- **Base:** P2B head `9c4bd96`, which is on `main` through merge commit `55e9667`. The P2C PR first
  targeted the P2B branch and was retargeted to `main` after the owner merged P2B.
- **Authority:** the owner's media direction of 2026-11-18, MDS §3.2 and Codex review 5950264094.
- **Not in scope:** service-tagged vendor uploads, schema changes, stock video, autoplay, directory
  cards, production writes, deployment, booking or payment activation, and Phase 7.

## What it does

- A selected service with an explicit photo mapping shows one panel below the provider's own media,
  labelled "Illustrative service photo". It says the photo doesn't show the provider's team, work
  or results.
- `contractor_gallery` stays general business media with its existing label. Nothing is inferred
  from captions. If a service-linked provider photo ever exists, it replaces the illustrative photo.
- All services, unmapped services and directory cards show no illustrative photo.
- The stock photo never becomes the cover, including on sparse profiles and failed provider photos.
- If the photo fails to load, the whole panel is removed. Provider video is unchanged.

## Assets and provenance

`docs/imagery/service-imagery-manifest.json` records each photo's source page, creator, licence,
verification date, source hash, placement, alt text, review notes and approval status. All 11 are
CC0 from StockSnap or the WordPress Photo Directory, and all are `pending_owner_review`.

`public/images/services/` holds 66 WebP crops, 2.0 MB in total: 16:9 for phones and 4:3 from 640 px.
`scripts/build-service-imagery.mjs` regenerates them from reviewed sources and refuses a source whose
hash differs from the manifest.

**Source change.** Unsplash was evaluated first, but its site challenges automated clients, so it was
not used and no asset comes from it. Openverse's public API supplied the candidates, and each source
page was then checked directly.

**Gaps.** No suitable CC0 photo was found for pressure washing, window cleaning or tree trimming, so
those services show none. Four sources are only 960 px wide, which is enough for the panel's size.

## Decisions for the owner

1. Approve or reject each photo.
2. Interior Painting shows a worker from behind, the only person in the set. Keep it or remove it.
3. Keep the three unmapped services without a photo, or source more.

## Results

Run in this worktree on 2026-11-18, Node 24.17.0, WSL2, `NODE_ENV` unset.

| Check | Result |
|---|---|
| Secret scan, lint, types | Passed, no findings |
| Unit (`npx vitest run`) | 71 files, 1058 of 1058 passed |
| Build | Exit 0 |
| Isolated profile lane (`playwright.provider-profile.config.ts`, port 3163) | 45 of 45 passed |

**Found and fixed during verification.** The panel and the media gallery shared one React key, so
switching services left the previous photo on screen. The switching test caught it.

**Inconclusive.** A local default-lane run of the affected specs passed 57 tests, failed 3 and did
not reach 137. A rerun of `pricing-approval.spec.ts` alone failed different tests, each waiting for an
admin page heading, while the machine's load average reached 23 with about 5 GB of memory. P2C does
not touch those pages. This run is not offered as evidence, and CI is the full browser run.

**Not performed:** real phones, screen readers, forced colours, 200% browser zoom and the owner's
visual review. No visual baseline was added or changed.
