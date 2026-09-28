# Phase 6.2 Claude implementation brief — TRACE-098

Date: 2026-09-27. Planning checkpoint: `0e4793b`, branch `codex/phase6-cleanup`.
Status: **PLANNED; implementation starts after the D3 repair is re-reviewed** in
[the 6.1 decision review](PHASE-6-DECISION-REVIEW.md). Base the implementation branch
on current merged main containing the reviewed submission and ZIP follow-up; record
the actual base commit. Suggested branch: `codex/phase6-intake`.

Outcome: a homeowner can choose services, enter property/project details, review
current terms, continue through authentication, submit once, recover after save,
and understand the result. Unsupported service/ZIP demand becomes explicit interest
with no booking. Codex defines/reviews; Claude implements this bounded slice.

## Governing requirements and boundary

Read the six AGENTS.md authorities, navigation/handoff and CLAUDE.md, then relevant
installed Next.js documentation. Use the approved MDS patterns and relevant frontend
skills. Authorities: MPS §§4/6.1/6.2/6.5; MDS §§3–5/8–10; MTS §§4–7/11/13;
CFG-001–003/009/010; DEC-2026-015/020/021; roadmap Phase 6 area 1.
Do not confuse roadmap slice 6.2 (intake) with MPS §6.2 (matching).

Keep submission, eligibility, ownership and commercial authority in the reviewed
database/checkout contracts. No new role model, price, fee, deposit rule, recurring
generation, cancellation policy, automatic dispatch, notification delivery or launch
claim is authorized. 6.3 owns matching/offer workflow changes; 6.4 quote/commercial
acceptance; 6.5 appointment confirmation; 6.6 recurring operation; 6.10 support;
6.11 vendor promotion editor; 6.13 remaining public navigation. Limit authentication
changes to request continuation. Do not rebuild the dashboard, provider directory,
public catalog or account/property management as collateral work.

## Characterize before replacing

Inspect and preserve legitimate entry and retry behavior in:

- `src/app/request/page.tsx`, including session draft, `homePlanSelection`,
  `preferredProviderSelection`, Services/Your Home/Review, refusal/interest, photos,
  matching/checkout continuation and SuccessState.
- `src/lib/requestSubmission.ts`, `requestCoverage.ts`, `requestPhotos.ts`,
  `serviceData.ts`, `vendorPricing.ts`, `src/hooks/useServiceCatalog.ts`, and the
  coverage/contact API handlers. Inspect plan/provider entry producers only as needed
  to keep imported selections compatible.
- Existing auth return/redirect handling, MDS form/error/state/money/stepper primitives,
  `tests/e2e/request.spec.ts`, relevant request/photo/redirect unit tests, SQL 063/064
  and `scripts/phase6-request-submission.mjs`.

Record baseline versus intended behavior. Current leads: Something Else is refused
late; generic confirmation names a preferred provider or says “Matching in progress”
without proving assignment/dispatch; matching errors are only logged; photo replay
checks any attachment on the first request; draft data also imports promotion fields.
Determine exact behavior before choosing a fix. Extract focused intake components and
pure state helpers incrementally; avoid a repository-wide architectural refactor.

## Implementation contract

1. **Coverage and service choice.** Keep every catalog service visible. Once location
   and configuration can be checked, distinguish eligible fixed, eligible quote,
   unavailable and verification error. Unavailable copy is exactly “Not available yet
   in your area.” Explain that Something Else records interest; it is not an
   admin-sourcing quote request. Known unavailable selections must not look bookable.
   An explicit interest action sends only demand/contact through the existing controlled
   route. Offer removal/correction of the plan. Final submission still revalidates all
   selections atomically; never silently submit the eligible subset. Use a narrow read
   contract if existing readbacks cannot support early eligibility; never create
   provisional active requests from the browser to obtain a preview.

2. **Property and project details.** Preserve address, exact ZIP, service frequency,
   provider/package/tier selection, required qualifying answers, project notes, access,
   pets, parking and preferred windows. Keep optional fields optional and show bounds
   and field-linked validation. A preferred date/window is a preference, not a booked
   appointment. Use Eastern time where relevant. Do not introduce saved properties or
   require a new profile workflow. Draft restoration must tolerate missing/invalid or
   stale data and storage failure, without showing false success.

3. **Provider consent and current terms.** Explain selected provider as a preference
   until actual acceptance/assignment exists. On ineligibility, offer explicit fallback
   consent or removal/correction; clear incompatible offering/tier/answers and refresh
   terms when consent changes. Preserve explicit quote/deposit offering identity;
   unbound quote requests remain custom_quote. Re-show changed mode/amount before
   another submit, with no automatic acceptance or invented client price. Catalog or
   pricing lookup failures remain recoverable errors, never quote fallback.

4. **Review and promotions.** Show a per-service fixed amount or quote-required state,
   selected configuration and preference, location, dates and editable details. Explain
   the all-or-nothing plan and the next action. Distinguish an intake price from a
   later authorized commercial snapshot, deposit and payment. Hide promotion badges,
   discounts, strike-through prices and promotional actions on the touched intake and
   its review/confirmation surfaces, including imported draft display. DEC-2026-015
   prohibits beta promotions; do not strip immutable historical money records, silently
   substitute a base price, or bypass the checkout prohibition. If a live promotion
   reaches intake pricing, record the dependency and fail safely rather than advertise
   or book unsupported terms.

5. **Authentication and retry.** Preserve non-file draft, selection and submission key
   through sign-in/signup and safe same-origin return. Tell users before departure
   that selected files require reattachment. Do not auto-submit on authentication.
   Double-click, network loss, remount and same-payload retry must reuse the accepted
   result. After save, lock/preserve the accepted payload and request IDs for recovery;
   an edit starts an explicitly new draft, never an automatic duplicate. A key conflict
   requires checking the saved request before knowingly starting another. Prove actor
   isolation when changing accounts in the same browser. Do not persist credentials,
   file contents or sensitive values in logs.

6. **Photos and failure after save.** Keep optional 6-photo, 8 MB per-photo JPG/PNG/WebP
   constraints unless an authority changes them. Accessible select/drop, previews,
   remove, errors, progress and retry must work by keyboard. No upload for interest or
   refused submission. Preserve saved requests if upload/association fails; retry must
   reconcile all intended request associations without missing or duplicate photos,
   including uncertain responses after an association committed. Verify ownership and
   cleanup of uploaded-but-unattached objects locally. Intake photos are not provider
   completion evidence. Narrow additive repair is allowed if needed; do not redesign
   retention or buckets.

7. **Honest confirmation and continuation.** Drive per-service summaries from returned
   request identities and authoritative state, with fixed/quote mode, real provider
   state, amount/payment status and next action. A preferred provider is not assigned.
   A fixed request awaiting operations is not “Matching in progress”; quote matching
   failure is not success at dispatch. Read back where submission alone cannot prove
   current matching/exhaustion, using existing contracts; stop at the 6.3 boundary if
   a new lifecycle command is required. Keep request saved, interest recorded,
   verification failure, photos pending and payment/review pending distinct. Checkout
   continuation uses the existing command and commercial review. Do not claim no
   payment was collected solely from a timeout after save; use known payment state or
   direct the user to check it. No fulfillment date, active sourcing, provider
   confirmation or notification promise without evidence.

8. **MDS and accessibility.** Use comfortable density, semantic tokens, Geist and
   approved FormField/WorkflowStepper/MoneySummary/Status/state patterns. Keep one
   meaningful heading and stable main/skip target; sentence case and verb-led actions.
   Announce step, error, progress and result changes; focus the relevant heading or
   error summary and link errors to fields. Provide 44px targets, visible focus,
   non-color cues, light/dark contrast, reduced motion, 320px reflow and 200% zoom.
   Never depend on toast-only errors or drag/drop-only photos.

## Acceptance evidence Claude must return

| ID | Required behavior and evidence |
|---|---|
| I1 | Covered split ZIPs 33917/33921/33936/34134 and excluded 33955/34110/34119 use the authoritative lookup; test covered with/without eligible supply, uncovered/waitlist and lookup failure. Exact 47-ZIP regression remains passing. City wording cannot change eligibility. |
| I2 | Catalog visibility; early unavailable/Something Else interest; eligible fixed/quote; stale/ineligible package/provider, missing required answers and changed price. Mixed-plan refusal creates zero requests/offers/checkout; correction then explicit resubmit creates one per selection. |
| I3 | Plan/provider entry, back/forward editing, draft restoration, malformed/stale/storage-unavailable drafts; sign-in/signup return keeps payload/key; anonymous cannot submit; homeowner and dual-role identities work; other role identities and cross-account request/photo access are denied. |
| I4 | Same-key double/concurrent submit, lost response, remount and retry; saved-payload edits/key conflicts; account switch. No duplicate request or charge, no stale actor's result. Use real local RPC evidence in addition to browser stubs. |
| I5 | Photo select/drop/remove/type/size/count, sign-in reattachment notice; upload/association/response failure and replay across every request in a plan. All intended photos linked once; no interest/refusal uploads; request remains saved; orphan cleanup shown. |
| I6 | Per-service fixed/quote/deposit preference summary; fixed awaiting operations, quote offer started/failed/exhausted, unassigned/selected provider, multi-service result, interest-only, photos pending, commercial review, checkout error/unknown outcome. Confirmation claims match database/payment evidence. Promotions absent on touched surfaces; prohibition remains enforced. |
| I7 | Browser journey and axe in light/dark at 320, 375/390, 768, 1024 and 1440px; keyboard focus/Enter/back/error/retry and photo controls; visual baselines; reduced motion; 200% zoom. Record actual human screen-reader checks separately with tester/device/browser/results. Axe is not screen-reader evidence. |

Run applicable `npm run check`, targeted unit/browser suites, database/RLS regressions
and the real local submission/concurrency script. For new SQL, include clean reset,
upgrade/replay, role-negative and relevant race evidence. Build browser fixtures with
explicit local/synthetic configuration; do not reuse a hosted-inlined build. Check
final-head CI and report exact commands/results, fixture cleanup and failing checks.
Do not claim checkout integration from scripted responses alone: exercise the existing
Edge Function locally when possible, or retain the named open integration gate.

Human/visual checks without evidence remain open and prevent claiming complete slice
acceptance. Phase 7 communication delivery, Phase 8 hosted ZIP reconciliation and
deployment, and carried release gates remain in their named phases. Never send real
messages, deploy, mutate hosted data or activate scheduling/money in this slice.

Return a reviewable diff, TRACE-098 updates, a validation report mapped to I1–I7,
concise handoff (base/scope/evidence/gates/next action), any migrations with upgrade
order and forward recovery, and unresolved authority conflicts. Codex review does
not close Phase 6; the owner decides phase acceptance on its integrated gate.
