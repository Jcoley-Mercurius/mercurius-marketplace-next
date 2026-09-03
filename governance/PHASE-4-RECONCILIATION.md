# Phase 4 lifecycle reconciliation

Status: IN PROGRESS. Authority: MPS → MDS → MTS; CFG-006–009;
DEC-2026-003–007. No production or Cron activation is authorized.

## Starting evidence

On 2026-09-03 PR #3 was OPEN, unmerged, at
`91379e9ba657624fecf4c6ea7e2db39c8cfd572e`. GitHub CI run 33811454238
completed successfully; Vercel status was success and CodeRabbit pending.
Remote `main` remained `b9e34445743b3c1163f11dda0d3db321fbf1ef5b`.
The clean Phase 4 branch `codex/lifecycle-reconciliation` started at PR #3's
head. A later check verified PR #3 merged at 22:24:42 UTC as
`db3f4061f65f84ccd8bbb08e9c71301167bd6250`, with a tree identical to `91379e9`.
The draft therefore targets merged `main`; Phase 3 content is preserved.

## Requirements and recovered conflicts

| Contract | Recovered evidence / required correction | Gate |
|---|---|---|
| Request/job vocabulary, MPS §5 | 15 stored request states combine request, match, quote and review concerns. Preserve historical values; explicit projection precedes renaming or backfill. | Every stored state mapped; role/transition matrix tested. |
| Actor authority, MPS §4/6.4 | `transition_job_status` infers internal authority from SECURITY DEFINER `current_user`; metadata can override audit actor/from/to; duplicate transitions silently succeed. | Explicit caller identity, ownership, reason and negative-role tests. |
| Completion, DEC-004/006 | Worker silently confirms after 72h. SQL advertises a conflicting four-hour confirmation deadline. | 72h after notice escalates to admin review; no homeowner confirmation or money effects. |
| Worker atomicity, MTS §§4/13 | Separate REST state/event/notification writes ignore errors and allow duplicate notifications after zero-row updates. | Transactional claim, audit and notification; retries and simultaneous execution tested. |
| Match expiry, MPS §6.2 / CFG-009 | Expiry updates requests after scanning without the accept path's lock or checking affected rows. A concurrent accepted/cancelled job can be reset. | Shared per-request lock; recheck expiry and state; no resurrection. |
| Matching semantics | `matching.md` sourcing, automatic selected-provider fallback and parallel mode conflict with later MPS/CFG. | Unavailable copy, consent before fallback, exclusive offers; preserve ranking weights. |
| Quote lifecycle, MPS §6.3 | Decline cancels a request; mutable quote amount has no revision lineage or expiry. | Decline is separate from cancellation; expiry/revision/scheduling rules require a complete contract. |
| Scheduling | Vendor acceptance immediately schedules fixed and quote work without service-mode conditions. | Resolved by DEC-007: vendor acceptance immediately schedules; do not add other prerequisites. |
| Cancellation, CFG-006/007 | Generic cancellation does not capture reason, policy time, waiver or provider-rematch outcome. | Boundary tests and auditable intent; actual refund/payout effects stay Phase 5. |
| Reviews, MPS §6.7 | Worker requests reviews from paid completed jobs; review RPC mixes rating-dependent visibility and lifecycle. | Relationship eligibility, no duplicate review, separate moderation contract. |
| Audit | Rejection INSERT followed by RAISE rolls back that INSERT. Existing generic events mislabel ordinary transitions as admin flags. | Do not claim durable rejection audit from rolled-back SQL; structured worker failures and transactional successful events. |
| Scheduler, DEC-003 | Provider selected, no schedule exists; missing-JWT tests do not prove authenticated integration. | Inactive configuration, credential boundaries, HTTP outcome, concurrency and failure evidence. |

## Stored-state interpretation (compatibility version 1)

| Stored state | Product meaning / next actor |
|---|---|
| pending + awaiting_match/offered | Submitted / matching; provider offer workflow |
| pending + sourcing/exhausted | Unavailable; operations review, no sourcing promise |
| matched + offered | Matching; offered provider may respond before four-hour expiry |
| matched + matched | Provider confirmed; acceptance immediately schedules under DEC-007 |
| quoted | Quote awaiting homeowner decision; not confirmed service |
| scheduled | Appointment scheduled; assigned provider starts work |
| in_progress | Assigned provider performing work |
| pending_review | Legacy completion pending; operator reconciliation, not presumed confirmation |
| vendor_completed | Completion pending; homeowner confirms or disputes; unanswered notice escalates at 72h |
| homeowner_confirmed | Homeowner confirmation recorded; completion processing |
| completed | Completed service; review eligibility separately checked |
| review_requested | Completed service with review requested |
| reviewed | Completed service with review submitted |
| disputed | Dispute open; operator resolution, funds held by Phase 5 contract |
| resolved | Resolution recorded; outcome-specific follow-up |
| cancelled | Cancelled; never revived by expiry or retry |
| closed | Closed; no automatic transition |

No destructive status migration is justified by this mapping. `draft` remains
client draft state. Request `expired`, quote expiry, recurring occurrences and
full domain separation require subsequent bounded schema slices and acceptance.

## Decisions still requiring a material specification

- Quote validity duration and extension/revision handling. Scheduling is resolved by DEC-007: vendor acceptance immediately schedules.
- Category-specific completion evidence beyond the inherited photo minimum.
- Dispute filing window, appeal and resolution outcomes; recurring cancellation scope.
- Notification channel/fallback and quiet hours: inherited 08:00–20:00 local,
  four-hour reminder delay, one-hour review delay, and two-day vendor backstops
  are characterization, not newly approved policy.

The newly approved 72-hour admin escalation does not approve those other timers.
Unresolved workflows remain explicit acceptance gates, not invented defaults.
Payment snapshot, checkout, refund, ledger and ACH work stay in Phase 5.

## Preserved Phase 3 follow-ups

Owner acceptance closes Phase 3, but human screen-reader testing, true browser
zoom, owner brand/minimum-size/clear-space review, and Linux/macOS visual baselines
remain separate follow-ups. No manual check is represented as performed here.
Preserve shared controls, accessibility repairs, mobile layouts and dark mode.

## Implemented checkpoint

See PHASE-4-VALIDATION.md for current changes and bounded evidence. Additional
characterization found a legacy assignment trigger overwriting canonical offer
rows with package-less duplicates and a 24-hour notice. Its forward removal is
covered by actual eligibility/acceptance tests. Pending cancellation previously
deleted the request; it now preserves an audited cancelled row. Quote decline
now records an operator follow-up without cancellation. Remaining requirements
are explicit draft gates; this checkpoint does not close all of Phase 4.
