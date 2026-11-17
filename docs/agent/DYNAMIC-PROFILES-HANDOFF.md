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

## Not done

No merge, deploy, migration, hosted query or production change. No Phase 7 file, the
shared `HANDOFF.md`, `TRACEABILITY.md`, `OWNER-APPROVALS.md` or any gate was edited. No live
route imports anything in this slice, and no dependency changed.

On the owner's instruction (2026-11-16) the branch was pushed and draft PR #171 opened against
`main` for Codex review, and the revision below was pushed to the same PR. `main` is at
`44751a9` (#170, documentation only): no file overlap, clean merge, branch not rebased so the
pushed commits are the ones tested. No homeowner validation, real phone, or screen-reader pass
was performed. PR #171 stays a draft.

## Next

Codex re-review of the revision on PR #171. Then the owner reviews the gallery at desktop and
phone widths and answers the decisions above. The integration slice (P2 in the plan) starts
only after both.

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
