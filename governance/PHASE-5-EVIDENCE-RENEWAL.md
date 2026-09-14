# Phase 5 — Compliance expiry queue and renewal notices (TRACE-072)

**Status:** IMPLEMENTED on branch `codex/phase5-evidence-renewal`, based on `main`
`d307ba0` (PR #26 merged). Not committed or pushed. Awaiting Codex code review. Merging
is not phase acceptance or production activation.

**Authorization (2026-09-13):** owner chose provider license and insurance renewal as the
next Phase 5 slice and decided its two open semantics before implementation (below).

## Gap

MPS §9 names a "Compliance expiry" queue: provider evidence nearing or at expiry, with the
outcome "renew, restrict, or suspend eligibility". Expiry already existed in the data:
license and insurance require an expiry (TRACE-069), `vendor_evidence_current` stops
counting lapsed evidence, and the checklist panel labels a lapsed item `Expired`. Nothing
showed evidence that was *about to* lapse, nothing listed lapses across providers, and a
provider was not told. An operator found a lapse only by opening each provider.

## Owner decisions (2026-09-13)

1. **Notice window: 30 days.** Evidence is "expiring" when its expiry is within 30 days,
   inclusive of the edge, and "lapsed" once the expiry has passed.
2. **Lapse flags only.** A lapse does not suspend a provider and changes no onboarding
   status or revision.
3. **Renewed documents arriving outside the application are the next slice.** This slice
   records renewal through the existing TRACE-069 checklist command against documents
   already in the reviewed application.

## Characterized before change

- **What a lapse already does, unchanged here.** `vendor_is_eligible` requires current
  evidence. Its consumers are the matching candidate gate and offer acceptance
  (`private.vendor_matching_eligible`, TRACE-060), weekly ACH preparation
  (`Vendor onboarding hold`, TRACE-052) and replacement payee reconciliation (TRACE-058).
  So a lapsed, still-active provider already receives no new offers **and has payout
  preparation held**. MPS §8 requires eligibility to follow expired requirements, so this
  slice does not change it; the owner decision is honoured as "status unchanged". The
  payout consequence is surfaced to the owner (Open items) and stated on every surface.
- **Renewal paths.** `vendor_record_checklist_evidence` supersedes the current item and
  requires a future expiry; license and insurance must reference a document in the
  reviewed application snapshot. `vendor_decide_onboarding('renew')` requires a current
  checklist and keeps the status. A changed application (for example, a new uploaded
  certificate) creates a new version, and `vendor_begin_review` then returns an active
  provider to `review` — which is why renewed uploads need their own slice.
- **Strict matching.** Scoped bindings (TRACE-061/062) reference a specific evidence row.
  Renewed evidence supersedes it, so once cutover is enforced the renewed document must be
  bound again in Provider compliance before scoped matching resumes.
- Documents reach Mercurius only through the application upload grant; the vendor portal
  has no compliance upload.

## Contract

Migration `20260913001000_vendor_evidence_renewal.sql`. Read-only: no table, write
command, trigger or scheduler.

1. `private.vendor_renewal_notice()` returns the 30-day interval, the single definition.
2. `private.vendor_renewal_items(contractor, at)` selects the latest (unsuperseded)
   evidence on the reviewed application version with an expiry at or before
   `at + 30 days`, for `active` and `suspended` providers only. Every item with an expiry
   is included, not only license and insurance, because any lapsed item makes the
   checklist incomplete. Review and rejected providers are left to onboarding.
3. `public.vendor_evidence_renewal_queue()` — operator-only. Returns evaluation time,
   notice days, cutover enforcement and entries (provider, status, revision, eligibility,
   scoped currency, item, evidence ID, requirement version, review time, expiry, state),
   soonest expiry first. Evidence references are omitted.
4. `public.vendor_own_evidence_renewal()` — requires the `vendor` role; returns only the
   caller's linked provider's items as `{kind, expires_at, state}`. No reference,
   requirement version, reviewer or other provider. A vendor account without a provider
   gets an empty list.
5. `vendor_onboarding_checklist` is replaced with an identical readback plus
   `renewal_notice_days` and a per-item `renewal_due` (current, on the reviewed version,
   expiry inside the window). Existing fields and states are unchanged; grants carry over.

## Interface

- **Admin → Compliance Expiry** (`/admin/compliance/renewals`): totals for lapsed and
  expiring, evaluation time, All/Lapsed/Expiring filter, and a `ResponsiveDataList` of
  provider (linked to the vendor detail page, which hosts the activation checklist),
  evidence, expiry state with relative days and date, provider status with
  "Matching and payout on hold" when not eligible, and the next action. With strict
  matching on, license and insurance rows add the scoped rebinding step. Empty, error
  (with retry) and loading states use `PageState`. The page performs no action.
- **Sidebar:** new "Compliance Expiry" entry. The active-link rule now prefers the most
  specific matching entry, so the nested route does not also mark Provider Compliance.
- **Activation checklist:** a current item inside the window shows a "Renewal due" badge
  and explains the consequence of a lapse.
- **Vendor portal:** a notice above every vendor page lists the provider's expiring or
  lapsed items with relative days and date, states that new job requests stop and payouts
  wait while evidence is lapsed, and links to Contact. It renders nothing when there is
  nothing to renew or when the readback fails.
- Status colours use the existing status tokens; day wording lives in
  `src/lib/evidenceRenewal.ts` (unit tested).

## Decisions taken during implementation

1. **All expiring checklist items, not only license and insurance**, since any lapse
   removes eligibility. Today only license and insurance require an expiry.
2. **Active and suspended providers only** in the queue and vendor notice. The checklist
   `renewal_due` flag also applies under review, where it is informational.
3. **Separate route** rather than a section of the 900-line compliance workbench,
   following the MPS §9 named-queue model.
4. **Vendor notice fails silent.** It is advisory; the operator queue is authoritative.
5. **No new write command,** so no new concurrency script. Renewal continues to use the
   TRACE-069 command and its race coverage.
6. **No notification or email.** Reminder delivery belongs to the notification contract
   (MPS §10) and stays inactive.

## Open items

- **Owner question — payouts on lapse.** "Flags only" is implemented as no status change,
  but the existing eligibility gate also holds weekly ACH preparation for a lapsed
  provider (TRACE-052). Confirm that is intended, or define a narrower payout rule.
- **Next slice — renewal documents.** A private renewal-document channel bound to the
  provider, not the application, so a renewed certificate does not trigger re-review.
- Codex code review; hosted PostgREST round-trip; CI on the final head.
- No automated reminder email or scheduler (MPS §10 notification contract).
- Public trust wording (MPS §6.7 badges) is marketing copy, not per-provider badges; no
  per-provider badge exists to change.
- Standing items: document sufficiency by category/jurisdiction; the TRACE-065 dark-theme
  contrast defect in the Applications table.
