# Phase 5 — Closure readiness

**Status:** CLOSED by the owner, 2026-09-26 (DEC-2026-017), after the [Codex review](PHASE-5-CODE-REVIEW.md)
and its fixes (TRACE-093, TRACE-094; PR #52 at `417e642`). Phase 6 is authorized. Phase 4 is **not**
accepted: DEC-2026-017 separated it from this closure, and its review questions below remain open.
The gates carried forward below keep their phases; nothing here authorizes external activation.

_Prepared for review 2026-09-25; the report below is kept as reviewed._

## Closure basis (DEC-2026-015 item 1)

Phase 5 is assessed against its roadmap gate — *concurrent checkout, duplicate webhook,
partial/full refund, dispute, chargeback, payout, and invite tests pass in non-production
environments* — followed by Codex review. As with Phase 3 (DEC-2026-005), gates that need
production, external accounts or people move to named later phases (below) instead of holding
Phase 5 open.

## Roadmap gate evidence

All evidence is synthetic and non-production. CI runs every suite and concurrency script below
on each pull request and on `main`; the latest `main` run (36138739942, after PR #48) passed its
backend, lifecycle and application jobs. This branch adds suites 058 and 059.

| Gate item | Database suites (examples of assertions) | Concurrency scripts |
|---|---|---|
| Concurrent checkout | 023 source checkout; 020 "Duplicate checkout safely reuses the attempt" | `phase5-concurrency.mjs`: concurrent publication keeps one invoice; concurrent checkout keeps one attempt |
| Duplicate webhook | 020 "Same event ID cannot change payload", "Refund event replay safe", "Failed event did not alter captured money" | `phase5-concurrency.mjs`: concurrent processing of one event processes once, two journals |
| Partial and full refund | 020, 025, 026, 044: "Partial refund allocated to service and tax", "Full refund leaves no provider payable", "Full refund reverses full platform fee" | `phase5-concurrency.mjs` (one of two over-allocating refunds wins); `phase5-provider-refund-`, `-finance-refund-`, `-failed-refund-concurrency.mjs` |
| Dispute | 024, 045–047: "Dispute stays held after 48h", "The kernel agrees a disputed payout is not payable", "A dispute blocks submission in the readback" | `phase5-payout-concurrency.mjs`: an appeal racing a batch blocks it or blocks submission |
| Chargeback | 020, 042, 044, 049, 050: "Chargeback holds unpaid funds", "Chargeback is distinct from customer refund", "Lost chargeback remains held until reviewed" | `phase5-late-reversal-concurrency.mjs` |
| Payout | 024, 045–048: weekly batches, 48-hour eligibility, statements, bank outcomes, replacement, recovery | `phase5-payout-`, `-finance-ach-`, `-ach-replacement-`, `-payout-recovery-`, `-bank-statement-concurrency.mjs` |
| Invite | 031, 033, 034, 037, 038: "Expired invitation cannot be accepted", "Revoked invitation cannot be accepted", "Another account cannot accept the invitation" | `phase5-invitation-`, `-invitation-binding-`, `-invitation-refusal-`, `-account-link-concurrency.mjs` |

## Beta money boundaries (DEC-2026-015 items 3 and 4)

Suite 059 pins what the private-beta configuration relies on:

- **Promotions — none at beta.** An enabled promotion in its window makes the commercial source
  refuse ("Promotion allocation integration required") instead of charging either price, and a
  request that recorded a promotion stays refused after the promotion ends. Disabled, ended and
  future promotions do not apply. A discounted snapshot needs promotion terms.
- **Tax — carried to the beta gate.** Every snapshot needs non-empty, non-null tax evidence, and
  every snapshot is published by two separately authenticated finance operators. No finance
  authority exists on a clean database. So nothing can be charged until operators are
  provisioned and a reviewed tax rule is cited. This is a review control, not a per-category
  tax table; the owner confirms taxability by category before private beta.

## Open review for Codex

Implementation is merged through PR #48; TRACE-091 and this slice are on branches. Review
questions still open:

| Slices | Questions | Report |
|---|---|---|
| Original independent checkpoint (TRACE-050–061) | command authority, allocation, concurrency, evidence, privileges, disabled integrations; DEC-2026-011 chargeback treatment | PHASE-5-HANDOFF.md "Acceptance gates" |
| TRACE-084 application retention | C1–C8 | PHASE-5-APPLICATION-RETENTION.md |
| TRACE-085 admin write paths | A1–A5 | PHASE-5-APPLICATION-ADMIN-WRITES.md |
| TRACE-086 applicant insert | B1–B4 | PHASE-5-APPLICATION-INSERT.md |
| TRACE-087 contact insert | D1–D4 | PHASE-5-CONTACT-INSERT.md |
| TRACE-088 intake abuse | E1–E6 | PHASE-5-INTAKE-ABUSE.md |
| TRACE-089 per-IP limit | F1–F5 | PHASE-5-INTAKE-IP-LIMIT.md |
| TRACE-090 never-attached uploads | G1–G6 | PHASE-5-UNATTACHED-UPLOADS.md |
| TRACE-091 never-submitted renewal uploads | H1–H6 | PHASE-5-RENEWAL-UNATTACHED-UPLOADS.md |

Other merged slices (TRACE-062–083) record their review items in their reports and in
TRACEABILITY.md; all Phase 5 rows remain IN PROGRESS until review.

## Phase 4 review (DEC-2026-016)

Phase 4 (TRACE-010, 012–016; PR #5, merged at `735df91`) was never owner-accepted. Codex
reviews it in this pass, as it stands on `main`, and the owner then accepts Phases 4 and 5
together. Sources: PHASE-4-RECONCILIATION.md (contracts and the stored-state recovery map),
PHASE-4-VALIDATION.md (evidence and gates), PHASE-4-HANDOFF.md and DEC-2026-005–010.

**CI gate:** met by standing CI. Suites 001–012 (188 assertions), Edge checks and handler
tests, the authenticated worker and pg_net transport with Cron inactive, and the browser suite
pass on `main` run 36138739942.

**Review questions** (the Phase 4 review gate):

- P4-1: authority checks — explicit caller and ownership checks, required admin reasons, and no
  generic transition that bypasses the quote, completion or dispute workflows.
- P4-2: locking — per-request locks for matching and offer expiry; the atomic worker's run IDs
  and business-effect markers; the quote revision concurrency guard.
- P4-3: history preservation — retained cancellations, quote revisions, dispute resolutions and
  appeals, review originals and edits.
- P4-4: legacy recovery — the stored-state map leaves no record in an unmapped state (the
  roadmap Phase 4 gate), and legacy states need an operator with a reason rather than
  fabricated consent or deadlines.
- P4-5: independent state — quote, dispute-appeal and review-moderation states stay separate
  from service status.
- P4-6: Phase 5 changes to Phase 4 contracts — TRACE-060 recreates the matching candidate
  function (`private.find_eligible_packages_core`) with current vendor eligibility and rechecks
  it at acceptance; TRACE-059 binds each recurring visit to its own commercial identity.
- P4-7: Phase 3 preservation, and that the worker stays default-disabled with no schedule
  installed by migrations.

## Gates carried forward

Each gate keeps its existing wording in PHASE-5-HANDOFF.md "Gates before integrated
activation"; this table names where it is now owned.

| Gate | Owner of the next step | Carried to |
|---|---|---|
| Phase 4 owner acceptance (Phase 5 depends on its lifecycle) | Codex review above, then owner | Accepted with Phase 5 (DEC-2026-016) |
| Hide the vendor promotion editor and public promotion display while promotions are refused | Implementation | Phase 6 (vendor packages; "remove premature" features) |
| Recurring visit generation and charge timing (operating configuration) | Owner decision, then implementation | Phase 6 (quotes and scheduling) |
| Scheduler, email and notification activation; finance operator runbooks | Owner authorization | Phase 7 |
| Hosted migration rollout (HOSTED-MIGRATION-ROLLOUT.md, proposed); hosted upload-URL and Storage move checks; malware scanning ADR (MTS §15) | Owner authorization | Phase 8 |
| Authorized Stripe test delivery and readback; bank forms and a real statement reconciliation | Owner authorization and accounts | Phase 8 |
| Taxability by service category confirmed with an accountant (DEC-2026-015 item 4) | Owner | Phase 9 gate |
| Two finance operators provisioned | Owner | Phase 9 gate |
| Real licensing and insurance requirements by category and jurisdiction; existing provider evidence cutover | Owner and operations | Phase 9 gate |
| Legacy sessions, subscriptions, invoices and refunds reconciled for cutover | Owner authorization for data access | Phase 9 gate |
| Manual screen-reader, zoom, cross-platform and brand acceptance (from Phase 3) | Human tester | Phase 9 gate |
| Production migration, configuration, deployment, payment, refund, payout, email and scheduler activation | Owner | Phase 10 |

## What closes Phase 5

1. TRACE-091 (merged, PR #49) and this slice pass CI; this slice reaches `main` with the review fixes.
2. The [Codex review](PHASE-5-CODE-REVIEW.md) found P1 and P2; TRACE-093 and TRACE-094
   ([fixes report](PHASE-5-REVIEW-FIXES.md)) answer them and await re-review.
3. Codex reviews the Phase 4 and Phase 5 questions above and the gate evidence; findings are
   fixed or recorded.
4. The owner records one decision accepting Phase 4 and closing Phase 5, and authorizes Phase 6.
