# Dynamic profiles — approved layout and integration handoff

Date: 2026-11-17 ET. Traceability: TRACE-156, proposed in PR #173.
Source baseline inspected: main `3327c83a36c1fee6a7e33d9689293b537a627c14`.
Status: owner-approved initial layout/design; P2A implementation authorized; source changes and release still require review.

**Status update — 2026-11-17 ET (recorded on the P2B branch).** P2A merged to `main` as `ba7db9c` (PR #174, final head `f67bb3f`). Codex's retrospective closeout review ([5948874109](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/174#pullrequestreview-5948874109)) found no new blocker and confirmed P2B as the next bounded slice. P2B is in implementation on `claude/trace156-p2b-profile-route` as a draft PR; it is not accepted, merged or released. The original status line above and the P2A section below are kept as the historical record of what was authorized.

**Status update — 2026-11-18 ET (recorded on the P2C branch).** P2C, labelled illustrative service imagery, is in draft on `claude/trace156-p2c-profile-imagery`. It depends on P2B (PR #175), which is not merged. No photo is owner-approved. See the [task checkpoint](../docs/agent/DYNAMIC-PROFILES-HANDOFF.md#p2c--illustrative-service-imagery-trace-156-2026-11-18-et).

## Owner direction and approval scope

Josh identified the local gallery at `http://127.0.0.1:3123/mds/profiles` and stated:

> I approve the initial layout and design ( We want implementation to make our design cards etc). So Please review and make any updates you see fit. Also can we go ahead and make the profile changes before finishing phase 7 or do them along side each other?

This accepts the initial gallery layout/design as the implementation baseline and authorizes reasonable implementation refinement. It does not establish that every manual, keyboard, screen-reader, real-phone, price, access or production acceptance check has passed. The commit served by the owner's local server was not independently identified; preserve the merged gallery composition and capture the implementation candidate's commit and rendering for verification. The approval is recorded once in [OWNER-APPROVALS](OWNER-APPROVALS.md#initial-profile-gallery-layout-and-design--2026-11-17).

The existing prototype directions remain the working defaults: dropdown below 1024px and chips above; replace service-only history entries; the business-wide review sentence; retain ZIP input across services. Keep reset-on-service-change, the temporary first eligible published offer in a deterministic contextual order, sentence case, and removal of below-minimum restored extras. These are the bounded implementation directions under the owner's delegation; no per-service persistence, lead-service setting or new pricing policy is introduced.

## Parallel work and release order

The owner permits profile work alongside Phase 7. This is a bounded sequencing exception to the inherited roadmap order, not Phase 7 acceptance.

- Phase 7 retains its own worktree/branch, handoff, database/email work and gates.
- Profile P2A has its own worktree/branch and application PR. P2B follows review of P2A; do not combine both as one unbounded change.
- Both may develop and run isolated checks concurrently. Choose unoccupied dev/browser/fixture ports; use synthetic data and private local config. Do not stop another session's process, reset its database, share its build directory, or overwrite its environment.
- An accepted presentation PR can be released before Phase 7 finishes. Sequence merges/deploy verification one at a time, reconcile the candidate with current main, and use the existing release authorization. A merge to main deploys automatically under DEC-2026-037.
- No booking, payment, invitation, notification, scheduler or other dormant gate is activated by this work.

## What current source establishes

| Surface | Observed behavior at the inspected baseline | Implication |
|---|---|---|
| `src/app/providers/page.tsx` | Loads active categories, active catalog services and `r0_public_providers`; groups by category and searches names/services/cities. It does not read packages, tiers or add-ons. Existing cards show identity and service badges, with no offer price. | A new priced card needs legitimate public-offer inputs. Do not import fictional data or manufacture a price from a provider's declared service. |
| `src/app/providers/[id]/page.tsx` | Uses provider-scoped public RPCs, eligible package/tier/add-on reads, coverage, public reviews, request handoff, refresh/subscriptions, video and supported business metadata. Legacy promotions are explicitly closed. | Preserve these contracts and content when integrating the shared interior. Do not replace the page with a fixture-shaped client-only shortcut. |
| `src/lib/requestPreview.ts` | Models authoritative request preview and price outcomes, with configuration signatures and explicit failures. | Exact configured totals require the existing server lane. P2B initially omits the gallery's selectable extras/subtotal rather than introducing another calculator. |
| `src/hooks/useTrialAccess.ts` | Distinguishes loading, signed-out, error and ready admission states. | The gallery's public/invited switch is not a production admission reader. |
| Profile gallery | Shared card/interior and model are merged from #171; two prior P2 findings were repaired and reviewed. Proposed service-linked media/questions are fixture-only inputs. | Reuse the approved composition; add real-data adapters and honest fallbacks. |
| Current main | Includes the dependency security patch after the #171 merge; Phase 7 handoff still carries email-evidence work. | Start the implementation from fresh main rather than the original gallery branch. No unrelated Phase 7 review is performed by this handoff. |

## P2A — integrate the real directory cards (implement now)

**Outcome:** the actual `/providers` directory uses the approved card composition for listed providers, with truthful published-offer information and useful sparse/error variants. Existing category discovery, search and navigation continue to work.

### Source boundary

1. Reuse `r0_public_providers` as the provider-list authority. A separately readable contractor record never widens this list.
2. Add an appropriate shared public-offer reader/adapter using existing fields and caller-safe contracts. Batch by the listed provider IDs; do not create one request chain per card. Scope package/tier/add-on reads and select only necessary public columns; no `select("*")`, internal notes, service-role browser code, new grants or schema changes.
3. Follow the storefront's existing public eligibility, price-kind, cadence, required-add-on and publication rules. Include only offered, applicable custom add-ons. Keep legacy promotions closed.
4. Order package/tier data deterministically using existing sort fields with an ID tie-break where needed.
5. Treat an unavailable supporting read separately from “this provider has no published offer.” Never turn a tier/add-on read failure into a cheaper amount or silently relabel an unknown offering as a quote.

### Card selection and fallback

- In a category group, the lead offer must belong to a service in that category. Do not display another category's lead offer simply because it sorts first.
- Where an existing explicit service context is present, use only that service's eligible offer. A free-text city/business search is not an instruction to infer a new service intent.
- With no narrower context, use the first eligible published offer in deterministic order. Name its service/package, scope, amount qualifier and cadence/billing basis.
- Show published listing prices only; a card is not a coverage check, live availability promise, configured total or guaranteed booking.
- Missing/failed offers need an explicit unpriced card variant or composition with the same identity/layout and a truthful description. Do not fabricate a dummy offer object or drop an otherwise listed provider merely to satisfy a component prop.
- The current gallery card expects a non-null `CardOffer`. Extend it or compose a shared fallback deliberately; preserve the gallery's existing supported scenarios.
- Use the real business logo or initials fallback. No new service-photo association exists, so do not infer one from captions or borrow another service's image.
- Keep the existing provider URL and current request/access behavior. P2A does not modify the detail route or claim that it already consumes a new service query parameter.
- Preserve existing category anchors and provider targeting. Carry search and category context in a safe directory URL/return contract as needed, without creating arbitrary return URLs. Verify Back and directory return preserve the search/category and useful position. It is acceptable to complete profile-side return restoration in P2B; do not claim it passed in P2A.

### Expected implementation areas

`src/app/providers/page.tsx`, shared card/fallback components in `src/components/provider-profile/`, a small public-offer adapter using existing helpers, and relevant synthetic directory/model/browser fixtures/tests. Exact files follow source inspection; this is not authority to edit Phase 7 or unrelated public pages. Use the task-specific profile checkpoint; keep the shared Phase 7 handoff intact.

### Acceptance and evidence

- Real directory routes render the approved card layout using synthetic readbacks shaped like current public responses.
- Eligible fixed, recurring and quote offerings remain distinct, with their published scope and billing basis. No quote deposit becomes a job price.
- No-offer, quote-only, withdrawn/under-review, unlisted provider, long name, missing/broken logo, and offer/tier/add-on read failures have truthful outcomes. A failure never advertises a lower price.
- Category-specific leads cannot cross categories. Identical sort values remain deterministic. Existing provider/service/city search and listed-provider count remain meaningful.
- No N+1 offer-reading pattern, no new production-side write and no fixture import in production components.
- Check 320/390/768/1024/1440px, 200% text/reflow as applicable, keyboard/focus, accessible links and contrast. Compare rendered directory cards with the approved gallery/reference composition; review initial images before accepting visual baselines.
- Preserve existing directory and provider-service-area tests and the gated gallery suite. Run repository-required lint, types, secrets, unit, synthetic build, browser/accessibility and relevant visual checks. Database tests are unnecessary unless a data contract is changed; any newly required schema change is outside P2A.
- Report exact candidate commit, changed files, checks actually run, comparison images, remaining manual checks and current CI. Do not convert reported evidence from #171 into new checks on this candidate.

## P2B — integrate the dynamic profile interior (next bounded slice)

*In implementation since 2026-11-17 ET (draft PR, not accepted). The implemented plan, the decisions made within these constraints and the evidence are in the [task checkpoint](../docs/agent/DYNAMIC-PROFILES-HANDOFF.md#p2b--the-real-provider-profile-uses-the-approved-interior-trace-156-2026-11-17-et). The constraints below are unchanged.*

Prepare the detailed P2B plan after P2A review, using these constraints:

- Connect `ProviderProfileView` to current provider-scoped public readers. Keep exact public listing, package eligibility, review and coverage authorities.
- Preserve supported existing business information (including promise, experience, completed-job facts and existing video where present) through appropriate slots/sections; do not silently erase content because the fixture composition lacks a field.
- Treat existing gallery images as general business media and label them accordingly in a service-focused view. Omit service FAQs without a published source. No new media/FAQ schema is required for the first route integration.
- Reuse real trial-access states and current early-access/request routing. Preserve request selection binding to provider, package, service and cadence, including qualifying-question/tier semantics and invalidation on change. Keep loading/error/waiting/revoked states honest.
- Initially display published extras as information and select/configure them in the existing request flow. Omit the gallery's local interactive extras/subtotal from live profiles. Adding an authoritative in-profile preview can be a later scoped capability.
- Keep “Quote after walkthrough” unless the existing contract is deliberately expanded. Show deposits separately under current policy.
- Implement service deep links, history replacement, retained ZIP, unsupported-service fallback, focus/announcements and business-wide reviews on the real route.
- Complete directory search/category/list-position return and provider-to-provider state reset. Do not leak another provider's chosen package, ZIP result, media failure state or review data.
- Verify background refresh, withdrawn offers, failed supporting reads, direct links, real route entry, access-to-request continuation and rollback. Compare representative real-data shapes using synthetic identities; do not copy production customer records into fixtures/screenshots.

P2B may begin before Phase 7 closes once P2A and its prerequisites are reviewed. A deployment still needs candidate acceptance and the ordinary release procedure.

## Start prompt for Claude

Read AGENTS.md and CLAUDE.md and the required authorities. Fetch current main and preserve unrelated work. Create a separate worktree/branch for “TRACE-156 / P2A public provider cards”; do not switch the Phase 7 session's checkout.

Read this brief from PR #173's branch as a read-only planning input if it is not yet on main:
`git show origin/codex/dynamic-profile-review-record:governance/DYNAMIC-PROFILES-INTEGRATION.md`.
Do not merge or cherry-pick that branch simply to read the instructions.

Implement P2A now. State a short plan and continue into code and verification without another planning-only approval. Use the approved gallery composition, real public-reader contracts and synthetic local checks. Read the installed Next.js documentation before framework code. Do not expand into P2B, schemas, production actions or Phase 7 changes.

Use an unoccupied local dev/test lane and prove it targets synthetic services; account for build-time public environment values. Do not copy production credentials or stop shared processes. If a required backend contract is missing, implement the truthful unpriced fallback and report the gap; do not invent the contract.

Update the task-specific checkpoint, commit the bounded changes, and open a draft implementation PR for Codex review. Do not merge or deploy. Return the candidate SHA, local review URL/start command, exact checks, screenshots and unresolved issues.
