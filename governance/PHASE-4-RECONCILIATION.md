# Phase 4 lifecycle reconciliation

**Current status (2026-09-26):** Phase 4 remains **not owner-accepted**. DEC-2026-017
separated its acceptance from Phase 5 closure. The owner requested review before
Phase 6 implementation (DEC-2026-018). The [Codex review](PHASE-4-CODE-REVIEW.md),
TRACE-096, requires fixes for completion evidence and lock ordering (P4-R1/P4-R2).
Repair implemented as TRACE-097 ([report](PHASE-4-COMPLETION-INTEGRITY.md)); next: Codex re-review, then owner acceptance/disposition.
Earlier review/combined-acceptance/PR instructions below are historical.

Status: implementation ready for final verification and owner review; acceptance is not claimed.
Authority: MPS → MDS → MTS; CFG-006–010; DEC-2026-005–010.
No merge, deployment, production change or scheduler activation is authorized.

## Starting evidence

On 2026-09-03 PR #3 was OPEN, unmerged, at
`91379e9ba657624fecf4c6ea7e2db39c8cfd572e`. GitHub CI run 33811454238
completed successfully; Vercel status was success and CodeRabbit pending.
Remote `main` remained `b9e34445743b3c1163f11dda0d3db321fbf1ef5b`.
The clean Phase 4 branch `codex/lifecycle-reconciliation` started at PR #3's
head. A later check verified PR #3 merged at 22:24:42 UTC as
`db3f4061f65f84ccd8bbb08e9c71301167bd6250`, with a tree identical to `91379e9`.
The draft therefore targets merged `main`; Phase 3 content is preserved.

## Resolved contracts and implementation

| Contract | Recovered inconsistency | Forward implementation / evidence |
|---|---|---|
| Authority and transitions | SECURITY DEFINER identity, metadata overrides, silent duplicate success | Explicit caller/ownership checks, required admin reasons, protected writes and authoritative event fields; SQL 002/003/008/011 |
| Matching | Duplicate assignment trigger, expiry races, fixed supply excluded quote providers, silent fallback | Shared per-request locks; one four-hour offer; all eligible fixed/quote providers participate; unchanged balanced-v1 weights and stable tie breaks; selected provider first; explicit homeowner fallback consent; reason-bearing overrides retain before state; SQL 004/006/012 |
| Scheduling | Ambiguous prerequisites | DEC-007: vendor acceptance immediately sets Scheduled, including quote work. Appointment time is independent and stored as an instant; parties see Eastern Time. No new payment prerequisite. |
| Quote lifecycle | Mutable amount, no lineage/expiry; decline cancelled service | Immutable revision terms, supersession, expected-revision concurrency guard, 24-hour approval window, current-quote ID decision guard; decline/expiry require follow-up without cancelling accepted work; SQL 005/007 |
| Completion | Unapproved auto-confirm and inconsistent timers | At least one photo, versioned category overrides; homeowner alone confirms; 72 hours after notice flags admin review, never confirms; SQL 002/003/011 |
| Cancellation and exceptions | Deleted requests; no policy/reason history | Retained rows, idempotent operation keys, CFG-006 assessment, reason-bearing waivers, provider cancellation/admin-confirmed no-show rematch, participant notices, owned exception tickets; SQL 010 |
| Recurrence | Risk of overwriting one job | Separate visit IDs and unique occurrence keys; independent acceptance/evidence; cancellation affects one visit; SQL 010 |
| Disputes | Unbounded filing and disconnected resolution | Owner filing before vendor completion +48h; linked tickets, versioned resolutions and appeals; one appeal per resolution; hold flag restored on appeal; no invented appeal deadline; SQL 008 |
| Reviews | Rating-gated private/public split and destructive deletion | Same eligibility/moderation for every rating; originals and edits retained; moderation reason and appeal; legacy private feedback remains private; SQL 009 |
| Support | Unowned operational follow-up | Project-owner queue, priority, next action, creation age and response deadline; eight support hours M–F 09:00–17:00 Eastern, same-day appointment priority during those hours; SQL 011 |
| Worker | Separate writes and ignored errors allowed duplicate/partial effects | Atomic batch, run IDs, business-effect markers, lock order, bounded scans, notices/events/run commit together; concurrent authenticated/retry/failure/pg_net tests |
| Scheduler | Provider choice mistaken for activation | Default-disabled handler; inactive installer outside migrations, duplicate guard and local inactive-install test; no recurring execution or production configuration |

Quote revision terms are lifecycle evidence, not the full commercial snapshot.
Checkout, price breakdown, deposits, refund execution, ledger, ACH eligibility and
money reconciliation remain Phase 5. Operations records policy assessments with
`money_action=none`; no recorded assessment claims an actual fee or refund.

## Stored-state interpretation and recovery (phase4-v1)

Historical status values remain intact. Generic transitions cannot create new
`quoted` or `pending_review` rows; dedicated quote and completion RPCs own new work.

| Stored state / qualifier | Meaning and next actor / recovery |
|---|---|
| pending + awaiting_match/offered | Matching; eligible provider receives/responds to exclusive offer |
| pending or matched + awaiting_consent | Homeowner chooses whether to allow another provider; admin can explain, cannot impersonate consent |
| pending + sourcing/exhausted | Not available yet in your area; operations reviews supply or owner cancels; no sourcing promise |
| pending or matched + quote_pending | Declined quote requires admin follow-up; send a revised quote and resume an eligible offer explicitly |
| matched + offered | Offered provider accepts/declines before four-hour expiry; worker advances expired offer |
| matched + matched | Legacy accepted match; admin corrects to Scheduled with reason |
| quoted | Legacy quote state; no retroactive expiry inferred; admin sends a versioned quote or reconciles accepted provider state |
| scheduled | Vendor accepted; admin records/changes appointment with reason, assigned vendor starts work |
| in_progress | Assigned vendor completes with required evidence or records exception; operations handles rework |
| pending_review | Legacy completion holding state; admin reconciles to in_progress or evidence-backed vendor_completed with reason |
| vendor_completed | Homeowner confirms or files within 48h of completion; 72h after notice creates admin review, never consent |
| homeowner_confirmed | Confirmation recorded; completion trigger advances; operations investigates legacy trigger failures |
| completed | Service completed; confirmed relationship may review; filing window remains tied to vendor completion |
| review_requested | Completed service with prior solicitation; homeowner may review; no new solicitation timer |
| reviewed | Review submitted; homeowner may revise or appeal moderation; admin may close service |
| disputed | Admin handles linked ticket; resolve with reason, or record rework; generic status cannot clear an open dispute |
| resolved | Resolution retained; homeowner can appeal; admin chooses documented completion/closure follow-up |
| cancelled | Retained terminal history; no expiry/retry revival; money resolution belongs to Phase 5 |
| closed | Terminal history; ticket support remains available; no automatic reopening |

Quote state (`submitted/accepted/declined/expired/superseded`) is independent of
service status. Legacy quote summaries use `legacy_review`; do not invent a notice
time. Dispute appeal state and review moderation state also remain independent.
`draft` is client-side. No global request-expiry duration was approved; offer and
quote expiry do not silently expire or cancel the whole request.

## Approved remaining boundaries

- DEC-010 leaves email, reminders, quiet hours and solicitation/backstop timing inactive until configured. Phase 7 owns channel/fallback/delivery evidence. Current in-app lifecycle notices are transactional.
- Category defaults are one photo; only an approved, reason-bearing category rule raises the minimum. No category requirements were invented.
- Support uses CFG-010's weekday calendar; no holiday calendar was supplied. Existing tickets without a new response deadline retain their original creation time and require queue reconciliation; no historical SLA success is claimed.
- Provider activation/compliance and payout onboarding evidence remain Phase 5. Candidate eligibility uses the existing active/marketing, catalog, offering-review and exact ZIP records; it does not certify real vendor documents.
- A separate review-management integration is future work (DEC-009).
- Production cadence, target Vault/JWT provisioning, external-scheduler duplicate check, monitoring/retention and activation approval remain release gates. Local installer testing commits only an inactive synthetic job and removes it afterward.
- Human screen-reader, true browser zoom, owner brand review and Linux/macOS visual baselines remain separate Phase 3 follow-ups. Phase 3 is owner-accepted; these checks are not claimed performed.

See PHASE-4-VALIDATION.md for evidence and the explicit owner acceptance gate.
