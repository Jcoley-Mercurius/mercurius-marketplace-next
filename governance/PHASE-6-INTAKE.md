# Phase 6 slice 6.2 — Homeowner intake (TRACE-098)

Date: 2026-09-27. Branch `codex/phase6-intake`, **stacked on `c2b9b81`** (`codex/phase6-role-repair`,
PR #59, the P6-R1 repair), not on merged main. The brief gates 6.2 on the P6-R1 re-review and
merge; neither had happened. The owner asked for 6.2 to start anyway, so the branch stacks on the
repair, as TRACE-097 did on PR #54. **The P6-R1 re-review gate is still open.** PR #59 still
targets the merged #58 branch rather than main.

Brief: [PHASE-6-INTAKE-BRIEF.md](PHASE-6-INTAKE-BRIEF.md). Authorities: MPS §§4/6.1/6.2/6.5,
MDS §§3–5/8–10, MTS §§4–7/11/13, CFG-001–003/009/010, DEC-2026-015/020/021.
Local synthetic data only. No external activation, hosted migration, deployment, message,
charge or scheduler change.

## Baseline versus intended behavior

Characterized on `c2b9b81` by reading `src/app/request/page.tsx` (2,342 lines), the catalog hook,
the submission/photo/coverage modules, the plan-builder and provider-page entry producers,
login/register, and the live database functions.

| # | Baseline on `c2b9b81` | Now |
|---|---|---|
| B1 | The catalog priced each service with the lowest fixed tier **anywhere in the network**, and toggling a service bound that network-default package into the submission. At a ZIP that provider doesn't serve, the command refused the plan (`package_unavailable` or `price_changed`), even when another local provider was eligible. | A read-only preview (below) returns the local outcome and amount for the homeowner's ZIP. Only an offering the homeowner chose explicitly (provider page, or a plan-builder choice with a named provider) is bound. `expected` is what the local preview showed. |
| B2 | Unavailable services and Something Else were discovered only by submitting (late refusal). Something Else's help text promised to “source a suitable pro”. | Once the ZIP is covered, every selection shows fixed, quote, unavailable or verification error. Something Else is labelled interest-only from the Services step on. |
| B3 | Confirmation said “Request Submitted!”, named the preferred provider as the provider, or showed “Matching in progress” for any plan. | Each service's confirmation comes from the returned request IDs plus a status read-back, with a text status and a named next action. |
| B4 | `start_request_matching` errors were only logged. | A failure shows “we couldn't start finding a provider” with a retry that uses the same command. Exhausted and offered states are read back. |
| B5 | A photo retry after save checked for any attachment on the **first** request only. A failed association deleted the uploaded objects, even when the insert had committed but its response was lost. | Each photo has a stable path. A retry reads the existing links for all requests and writes only the missing uploads and links. Cleanup runs only after a read-back shows the object unlinked. |
| B6 | The builder/provider draft restored promotion ids, labels and strike-through base prices. Imported promotion prices were displayed as “promo (was …)”. | Promotion fields are never restored or passed to intake cards. A promoted catalog rate is hidden, and a promoted preview outcome blocks the service (fail safe). |
| B7 | A coverage **lookup failure** could be submitted as a “Service-area notification request” and confirmed as “Coverage interest received”. | A failed check is an error: retry and a Contact link only. Nothing is sent (D6). |
| B8 | “Create one” on login and the register redirect dropped `redirect=/request`. | Only `/request` is carried through sign-up (`src/lib/auth/continuation.ts`). |
| B9 | A key conflict silently generated a new key, so the next click created a second request. | A conflict shows the saved-request link and an explicit “Submit as a new request”. A plain retry keeps the key and is refused again. |
| B10 | A lost response looked like any other error. Editing and resubmitting could hit a conflict or create a request with the old details. | The exact in-flight payload is persisted. “Check and finish submitting” resends it with the same key, and the command replays the stored result. |
| B11 | Photo limit, type and interest errors were toast-only. | They appear inline in a live region, next to the control. |
| B12 | The date minimum and past-date check used the browser's local date; the command uses America/New_York. | Eastern dates everywhere, labelled “(ET)”. |
| B13 | Another account signing in on the same tab saw, and could submit, the previous account's draft. | The draft is bound to its owner. Another account's draft or saved result is discarded; a signed-out visitor sees a sign-in prompt, not the details. |
| B14 | Storage failures were silent. Malformed drafts were dropped without a word; stale dates were restored. | Each field is parsed individually. Malformed drafts, stale windows and storage failures are announced. |
| B15 | A checkout failure after save said “no payment was collected”. | “Payment didn't start from this page. Check this request in your dashboard before paying.” Paid state comes from `payment_status`. |
| B16 | Catalog lookup failures fell back to static services shown as “Matching required”. | The intake shows a recoverable error with retry. Public pages keep their fallback. |

Kept: `submit_service_requests` (6.1 + P6-R1) is unchanged and remains the authority. Kept as
before: the existing checkout command and commercial review; the single fixed-request checkout
continuation; D4 (fixed requests wait for operator offers; quote requests start
`start_request_matching`); and the photo limits (6 photos, 8 MB, JPG/PNG/WebP).

## Migration `20260928000000_trace098_intake_preview.sql`

Additive. It changes no data, grants or existing behavior.

1. `private.find_eligible_packages_with_answers(…, _answers jsonb)` holds the unchanged
   eligibility body, with one difference: answers to evaluate price-level rules against, where
   `NULL` leaves the rules unevaluated (availability preview only).
   `private.find_eligible_packages_without_onboarding` (five arguments, same signature) now
   delegates with `'{}'`, so matching, submission and `find_public_eligible_providers` see
   exactly what they saw before. SQL 066 and the full suite prove it.
2. `public.preview_service_request_selections(p_payload jsonb)`: `STABLE`, security definer,
   `search_path=''`, EXECUTE for `anon` and `authenticated`. It mirrors the command's input
   checks, exact coverage, catalog/provider/offering validity, onboarding eligibility, required
   answers, candidate choice and offering mode, and returns per selection: outcome, pricing and
   offering mode, exact `total` (or `from_total` plus `depends_on_answers`), a `promotion` flag,
   the package/tier that would be chosen, its public questions and scope. It writes nothing and
   returns no provider identity, name or score.
3. Private helpers `intake_package_questions` and `intake_offering_scope`, with no grants.

Upgrade order: apply after `20260927020000`. Forward recovery: if the preview misbehaves,
`revoke execute … from anon, authenticated` disables it; the intake then shows “Couldn't check
availability” and submission stays blocked, fail-closed. The wrapper change can be reverted
forward by redefining the five-argument function with its previous body (captured in this
migration's diff).

## Implementation

- `src/lib/requestPreview.ts`: preview parsing (a malformed or partial response is an error), a
  per-service availability state, whether the plan can be submitted, and a signature so stale
  answers are dropped.
- `src/lib/requestDraft.ts`: tolerant per-field draft restoration, promotion stripping, owner
  binding (`adopt` / `keep` / `hold` / `discard`), the locked saved submission, the in-flight
  payload, storage wrappers and Eastern dates.
- `src/lib/requestPhotos.ts`: selection limits, stable paths, reconciling attach, and discard of
  unlinked objects by listing the plan folder.
- `src/lib/requestConfirmation.ts`: per-service confirmation derived from request identities and
  read-back.
- `src/components/request/ServiceAvailabilityList.tsx`, `RequestConfirmation.tsx` and
  `src/components/ui/workflow-stepper.tsx` (MDS WorkflowStepper, with text states and a live
  step).
- `src/app/request/page.tsx`: orchestration, reworked Services / Your home / Review steps, the
  locked confirmation and recovery view, and interest-only completions. The commitment action is
  “Request service” (MDS §9).
- `PlanningServiceCard` gains an optional `localStatus`. The plan-summary helper text moved from
  muted to foreground, which fixes axe contrast (4.34:1) in the ≥1024px sidebar.
  `useServiceCatalog` exposes `error` and `retry` without changing public pages.
- `src/lib/auth/continuation.ts`, `login` and `register`: request continuation only.

## Acceptance evidence (I1–I7)

Commands were run on 2026-09-27 against the local synthetic stack `vugqqyemuptlvcieihww`.
Browser runs used a build with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831` and the synthetic
anonymous value (the CI configuration), never a hosted-inlined build.

| ID | Evidence | Result |
|---|---|---|
| I1 | SQL 066: 33917/33921/33936/34134 covered, 33955/34110/34119 excluded, city wording can't cover, ZIP+4, covered with and without supply, supply in an excluded ZIP not bookable. SQL 064 exact 47-ZIP regression. Browser: uncovered/waitlist interest only; lookup failure is an error with retry and no interest | 066 68/68; 064 16/16; browser pass |
| I2 | SQL 066 parity: preview = command for fixed, explicit tier, unbound/deposit quote, answer level, eligible/ineligible provider, missing answers, promotion, mixed-plan refusal, suspended supply. Browser: early fixed/quote/unavailable/Something Else; mixed plan blocked until removal, then one selection sent; all-unavailable interest only; consent clears provider, offering and answers; changed price re-shown and explicitly resubmitted; answer-priced “From” then exact. Script: preview-to-submit at the shown price | pass |
| I3 | Browser: anonymous gets “Sign in to request service” and zero RPC calls; sign-in keeps draft and key, with no auto-submit; sign-up links carry only `/request`; another account's draft or saved result is discarded; a signed-out visitor sees none of it; a role-less identity (42501) is refused and the draft kept; malformed, stale and unwritable storage are announced. SQL 065, script: vendor-only refused, homeowner+vendor succeeds, cross-account read denied | pass |
| I4 | Browser: double click plus programmatic resubmit sends one RPC; aborted response, then reload, then “Check and finish submitting” resends an identical payload and key; reload after save shows the saved result with no RPC; key conflict needs explicit “Submit as a new request” with a new key. Script (real RPC): 8 concurrent same-key calls produce one row; racing different payloads produce one row; replay returns the saved request | pass |
| I5 | Unit: stable paths; plan-wide links; no-op retry; partial completion; lost upload response; committed-but-lost association treated as success; definitive failure cleans only unlinked objects; uncertain association keeps objects; discard removes earlier-attempt orphans only. Browser: type/size/count errors inline, disabled at 6, remove by keyboard, reattach notice before sign-in, upload failure then retry links one object to both requests, reload then “Continue without photos”, no uploads for interest. Script (real Storage/RLS): duplicate upload recognized, one object linked to both requests, reconciliation read, owner folder listing, other homeowner can't list, delete, upload into the folder or read links | pass |
| I6 | Unit and browser: fixed request awaiting operations (no “matching” claim); quote offered; matching failure with working retry; exhausted shows “Not available yet in your area”; preferred provider is a preference; multi-service saved without payment and says why; read-back failure reported with retry; checkout error named without claiming non-payment; promotion never shown and never submitted. SQL 066: promotion flagged. SQL 059 (checkout refusal) unchanged | pass |
| I7 | Browser: axe (WCAG 2.2 AA tags) plus reflow for Services, Your home and Review in light and dark at 320/375/390/768/1024/1440px (36), confirmation and refusal in both themes, 200% zoom (640 CSS px), keyboard (error summary links, photo picker focus-visible, Enter validation, Back focus), reduced motion. Visual baselines: review and confirmation, light and dark, 390px | see totals below |

Totals:

- SQL (clean `db reset`, `npx supabase test db`): **3,244 assertions / 57 files PASS**. SQL 066:
  68/68. SQL 001 updated to allow the new anonymous RPC.
- Script: `PHASE6_DB_CONTAINER=supabase_db_vugqqyemuptlvcieihww PHASE6_SUPABASE_WORKDIR=. node
  scripts/phase6-request-submission.mjs`: **32/32**, 9 new. Fixtures removed in `finally`.
- Unit: 274 tests / 18 files (`tests/unit/request-intake.test.ts`: 43).
- Browser: see [Validation run](#validation-run).
- Types: regeneration adds only `preview_service_request_selections`.

### Human and manual checks — NOT DONE

No screen reader (VoiceOver, NVDA or TalkBack), real-device zoom or human visual review was
performed. Axe is not screen-reader evidence. These remain open and prevent claiming complete
slice acceptance.

## Decisions for Codex review

- **D1:** The branch is stacked on the unreviewed P6-R1 repair at the owner's instruction.
- **D2 — new anonymous RPC surface.** `preview_service_request_selections` exposes local
  availability, the amount the command would store, offering ids and public questions/scope for
  any ZIP. The same inventory is already public (catalog tables, `find_public_eligible_providers`),
  but this is the first anonymous call that evaluates answers. It has no rate limit beyond
  PostgREST's.
- **D3 — duplicated evaluation.** The preview re-implements the command's per-selection logic
  instead of refactoring the reviewed 6.1 body. SQL 066 parity checks pin agreement. A shared
  private evaluator would remove the duplication but changes the reviewed command.
- **D4 — eligibility read path.** The delegating wrapper touches the matching read path (6.3's
  area) without changing behavior.
- **D5 — offering binding.** Catalog-default (network-cheapest) packages are no longer bound. The
  server picks the lowest eligible local offering, as it already did without one. This changes
  which offering unbound fixed selections get: the local one rather than a refusal.
- **D6 — promotion dependency (DEC-2026-015).** The intake fails safe, but
  `submit_service_requests` still **accepts** a promoted fixed selection when called directly,
  storing `promotion_id`; checkout then refuses it (SQL 059). Should the command refuse promoted
  supply, or should promotions be disabled in data? That's an owner/Codex decision; the command
  was not changed.
- **D7 — photo uniqueness.** Reconciliation is client-side; there is no unique index on
  `(service_request_id, photo_url)`. Two tabs attaching different files remain possible.
  Abandoned intake uploads stay in the owner's folder until “Continue without photos”, because
  there is no scheduled retention for intake orphans. A retention rule would be a separate
  decision (TRACE-090 covers vendor uploads only).
- **D8 — signed-out hold.** A signed-in account's draft is held, not discarded, when the session
  ends, so an expired session loses nothing. The visitor must sign in as that account or start
  over.
- **D9 — test infrastructure.** `playwright.config.ts`'s `use.reducedMotion: "reduce"` does not
  take effect here (`matchMedia` reports `false`). Other suites that assume it are not getting
  reduced motion. The intake test emulates it explicitly; fixing the config is outside this
  slice.

## Open gates

P6-R1 re-review and merge; Codex review of this slice; PR and final-head CI; human
screen-reader, zoom and visual checks; checkout Edge function not served locally (checkout
continuation is exercised only with scripted responses, so the integration gate stays open);
adding the script to CI; hosted migration and ZIP reconciliation (Phase 8); Phase 7 notification
delivery. 6.3 owns offer, fallback and exclusivity changes; matching is only read back here.

## Validation run

All runs on 2026-09-27, final head of this branch, local synthetic stack, synthetic browser build.

| Command | Result |
|---|---|
| `npm run db:reset && npx supabase test db` | 3,244 assertions / 57 files PASS |
| `node scripts/phase6-request-submission.mjs` (main local stack env as above) | 32/32; fixtures removed |
| `npm run scan:secrets`, `npm run lint`, `npm run typecheck` | pass (lint 0 errors) |
| `npm run test:unit` | 274 / 18 files |
| Synthetic build (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831`, synthetic anon value) | pass |
| `npx playwright test tests/e2e/request.spec.ts --grep-invert @visual` | 73/74 on the final build; the failure was the waitlist interest test, which then passed 10/10 (`--repeat-each=5`, both coverage cases). It ran concurrently with a full lint, so contention is the likely cause. The previous build's run passed that test. |
| `npx playwright test --grep-invert @visual` (whole suite) | 310/310 |
| Request visual baselines (4 new: review/confirmation × light/dark, 390px) | created with `--update-snapshots` as `-linux` files, then 4/4 on re-run. Linux-only; the Windows workstation would need its own baselines, and CI doesn't run `@visual`. |
| Existing brand/MDS visual baselines | Not verifiable here: only `-win32` baselines are committed and CI runs the non-visual suite. A Linux `--grep @visual` run wrote missing Linux baselines (reported as 6 failures); those files were deleted, not committed. This slice doesn't touch those pages. |

Not done: CI on the final head (no PR opened); human assistive-technology and visual review;
checkout Edge function served locally.
