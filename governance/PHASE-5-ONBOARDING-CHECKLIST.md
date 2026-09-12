# Phase 5 — Activation checklist and onboarding decisions (TRACE-069)

**Status:** IMPLEMENTED on branch `codex/phase5-onboarding-decisions`, stacked on
`codex/phase5-activation-role` (TRACE-068, PR #21, unmerged) at `51a9fcc`. Awaiting Codex
code review. Merging is not phase acceptance or production activation.

**Authorization (2026-09-12):** the owner directed this slice after TRACE-068. The
license/insurance recording rule below was put to the owner and answered before
implementation; the remaining decisions were taken during implementation and are
recorded for review.

## Gap

The MPS §8 activation checklist and onboarding decisions existed only as database
commands. No interface called `vendor_decide_onboarding` (activate, suspend, renew,
reject), and none recorded seven of the nine checklist items. The compliance workbench
(TRACE-062) records license and insurance only by binding a document to a service/ZIP
requirement, which requires active packages; vendors create packages only after
activation. A real applicant therefore could not be taken from review to active, and the
TRACE-068 role grant was unreachable, without SQL.

## Characterized before change

- `vendor_record_evidence` (TRACE-053) was granted to `authenticated`. It enforces the
  operator check, freshness, expiry and the stale-supersede guard, but accepts any
  reference for any kind — including license and insurance — with no document rule,
  reason or idempotency key. No application code called it; TRACE-062's
  `vendor_record_requirement_document` calls it as the function owner.
- `vendor_decide_onboarding` already requires an expected revision, a reason (enforced
  by the event table) and an idempotency key, and replays exactly.
- Activation requires generic evidence currency (`vendor_evidence_current`), not scoped
  category compliance. Strict matching after cutover finalization requires both.
- The candidate pool also filters on packages and coverage, so activation alone does not
  place a provider in matching.
- `vendor_begin_review` returns a rejected or suspended provider to `review` when the
  application gains a revision.

## Contract

1. `public.vendor_onboarding_checklist(contractor)` is an operator-only, read-only
   readback: onboarding status and revision, application currency, the reviewed
   application's documents, each of the nine items in MPS §8 order with its current
   evidence and state (`missing`, `current`, `expired`, `superseded_version`), overall
   checklist currency, eligibility, scoped compliance, cutover enforcement, the reviewed
   account and role, onboarding history, and the last role decision. It writes nothing.
2. `public.vendor_record_checklist_evidence(contractor, kind, requirement, reference,
   accepted, expires, supersedes, key)` records one item through the kernel. It requires
   a known item, a requirement version, a reference, a review time and a key; refuses a
   rejected provider and a superseded or closed application; and replays only an exact
   request. Absent `expires`/`supersedes` may be omitted by name.
3. **License and insurance** must reference a document in the reviewed application
   snapshot and carry an expiry (owner decision). No default expiry exists anywhere.
4. Every request is an immutable, private `vendor_checklist_evidence_requests` row.
   Recording evidence changes no onboarding status or revision, grants no role and lists
   nothing.
5. The raw `vendor_record_evidence` loses its client grant, so the document rule cannot
   be bypassed. Both reviewed commands still reach it as the function owner.
6. Decisions use the existing `vendor_decide_onboarding` unchanged.

## Operator interface

`VendorOnboardingChecklist` is mounted as "Activation checklist" in the Applications
dialog (after the account and invitation panels) and on the vendor detail page.

- Items show state, requirement version, reference, review time and expiry.
- One form records or replaces an item. License and insurance offer only the
  application's documents and require an expiry; payout evidence warns never to enter
  account or routing numbers. Review time and expiry have no default.
- Decisions offered by status: review → activate, reject; active → suspend, record
  renewal; suspended → reactivate, record renewal; rejected → none. Activation and
  renewal are disabled until the checklist is current, with the reason shown.
- Every action is a ConfirmAction. Decisions require a reason. The activation
  confirmation states the TRACE-068 role outcome from the readback (grant to the named
  reviewed account, inherited link, or no account) and that matching also needs
  packages and coverage.
- Success is reported only when the readback confirms it: a new evidence ID with the
  entered version and reference, or revision + 1 with the expected status. Retries of
  the same entry replay one key.

## Decisions taken during implementation

1. **Revoke client access to the raw evidence kernel** rather than leave a second path
   that ignores the document rule. No application code used it; one CI fixture script
   (TRACE-068) now writes its evidence as the database owner.
2. **No reason for evidence recording.** The evidence itself (version, reference, time,
   reviewer) is the record; decisions keep their required reason.
3. **Rejected providers take no evidence**, until a new application revision reopens
   review. Suspended and active providers can record evidence, for renewal.
4. **No expected-revision argument for evidence.** Evidence does not advance the
   onboarding revision; the kernel's supersede guard is the concurrency control, proven
   under race.
5. **Separate "Activation checklist" panel** rather than extending the compliance
   workbench, following the TRACE-066/067 placement. Where operators should work this in
   practice remains an operations decision.

## Found and fixed during the slice

The panel omits an absent expiry or supersession, but the first draft of the command gave
those arguments no default. PostgREST resolves functions by named arguments, so a real
request would not have matched; the mocked browser cases could not show it. The optional
trailing arguments now default to null (as TRACE-062's document command does), and suite
036 asserts a named call that omits them.

## Open items

- **Document sufficiency is unverified.** The panel records that an operator reviewed a
  document; what makes a license or insurance document sufficient by category and
  jurisdiction remains a Phase 5 gate. Document-recorded evidence is reported as not
  scoped until the compliance workbench binds it.
- **Evidence references are free text** for seven items. The panel warns against bank
  details, but nothing prevents personal data in a reference; a structured reference
  scheme needs an owner decision.
- No hosted PostgREST round-trip was run; resolution is proven by a named SQL call and
  the regenerated API types.
- Stacked on unmerged TRACE-068 (PR #21); rebase onto main after it merges.
- Rejection-after-activation role policy (TRACE-068) and invitation-path account binding
  remain open.
- The TRACE-065 dark-theme contrast defect in the Applications queue table is unchanged.
