# Phase 6.8: canonical verified reviews, private feedback and review history

**Status:** IMPLEMENTED FOR REVIEW, 2026-10-29 (America/New_York), on branch `claude/phase6-8-reviews` from `main` `ef1cc33` (the PR #115 merge). **Not released.** No hosted migration is pushed and nothing is merged. The open owner questions are DEC-2026-052 (PROPOSED, §5). Nothing that depends on them is built.
**Trace:** TRACE-130. **Builds on:** the accepted Phase 4 review contract (TRACE-015, `20260904003000`; DEC-2026-009/010; accepted with Phase 4 under DEC-2026-019), the 6.6 visit identities (TRACE-123) and the 6.7 confirmation (TRACE-128).

**Base verification.** `origin/main` is `ef1cc33`: PR #114 (6.7, TRACE-128) merged as `afb7c83` with CI green, and PR #115 (TRACE-129) merged as `ef1cc33`. The `main` CI run for `ef1cc33` (40989215953) was in progress when this slice began and finished green (26 m 35 s). The checkpoint reconciliation (6.7 merged with open acceptance items; DEC-2026-050 PROPOSED; 6.6c finance sign-off missing; TRACE-126/127 open) is recorded in HANDOFF and PHASE-6-SCOPE. It is documentation only and approves no policy.

## 1. Outcome

There is one canonical review record: `public.reviews`. The homeowner of a completed, confirmed service reviews it once. A recurring visit is its own service, and the plan is never reviewed. Every star rating is published alike, and only the four approved criteria hide a review. Public profiles, the homeowner's provider card and operations read one server-computed count and average from the same public rows. Corrections, moderation decisions and appeals keep the original content, the actor and the reason, and the author sees them without operator identities. Private feedback stays private on every path.

## 2. Governing requirements

| Source | Requirement for this slice |
|---|---|
| MPS §1 rule 1 | Show only reviews supported by real operational data |
| MPS §4 | Moderate public content: the homeowner owns their submission, the provider owns its profile, an authorized moderator decides. Enforced server-side and at the database boundary |
| MPS §5.6 | `not_eligible → requested → submitted → published \| held_for_moderation \| rejected \| appealed`. Each transition has an actor, an audit event and wording |
| MPS §6.7 | Only an eligible completed relationship creates a verified review. One canonical model separates private feedback from public review. Moderation follows published criteria, keeps the original and supports appeal/correction. Ineligible, duplicate, edited, moderated and appealed scenarios are tested |
| DEC-2026-009 | Every star rating uses the same moderation rules. Previously private feedback is never retroactively published. No appeal deadline |
| DEC-2026-010 | Moderation only for spam, personal information, threats/abuse or content unrelated to the service — never for a low rating alone. Separate jobs for recurring visits |
| Phase 4 (DEC-2026-019, TRACE-015) | One review per completed, homeowner-confirmed service, published on submission; author correction with reason and history; reason-bearing moderation; appeal through a support ticket |
| MPS checklist G5, G6, I3 | **Open.** Review eligibility timing, edit behavior, provider response and appeal details, and the role of `quality_feedback` are not approved (§5) |
| DEC-2026-037 | Hosted migration pushed before merge with owner authorization; the merge is the release |

## 3. Characterization (before this slice, local stack at `20261030001000`)

| Concern | Path | Behavior found |
|---|---|---|
| Canonical record | `public.reviews` (unique per `service_request_id`) | Rating 1–5, comment, `visibility` (`internal_only` / `eligible_for_google`), `moderation_state` (`published`, `held_for_moderation`, `rejected`, `appealed`). Phase 4 moved legacy `internal_only` rows to `held_for_moderation` |
| Second table | `public.quality_feedback` | Punctuality, communication and workmanship scores, a recommend flag and internal notes. **No writer anywhere in the app, API or Edge functions.** Admins read it on `/admin/reviews` |
| Submission | `submit_job_review` | Advisory lock and `FOR UPDATE`. Homeowner only. Requires `homeowner_confirmed_at`, a provider and status `completed`/`review_requested`. Unique constraint. Publishes at once and moves the job to `reviewed`. **R1:** a retry after a lost response fails as a duplicate. No comment limit |
| Plan vs visit | Guard trigger `guard_recurring_series_work` | A new plan never reaches `completed`, so it can't be reviewed. A legacy plan already `completed` fails only at the `reviewed` transition, with a generic error (**R2**). A visit is its own row and binds its own provider |
| Direct writes | Table grants | `reviews` has no client insert/update/delete. **R3:** `quality_feedback` keeps full client grants with an insert policy that lets a homeowner write a report for their own completed job **naming any provider**, and admins can rewrite or delete reports with no history |
| Public read | Anon column grant (no `customer_id`) + RLS | Anonymous visitors see only public rows. **R4:** every signed-in user reads every public row with **all columns, including the author's `customer_id`** |
| Participant read | RLS "Participants can view own reviews" | **R5:** the provider reads its held, rejected and legacy private reviews directly |
| Aggregates | Provider page and homeowner provider card average the rows the viewer can read | **R6:** a signed-in author, provider or admin sees a different count and average from the public (their own hidden reviews are included). `/admin/reviews` "Total Reviews"/"Average Rating" mix every state. **R7:** `contractors.rating` is a separate, hand-edited number (hosted: all 29 providers hold 4.5) shown on admin vendor surfaces; it is not on public pages |
| Correction | `revise_job_review` | Author with a reason; history keeps the prior row. **R8:** no stale guard, no-op corrections recorded, no edit marker |
| Moderation | `moderate_job_review` | Admin with a reason, any-to-any state. **R9:** the criterion is free text, so a low rating alone could be the recorded reason; no stale guard; a free-text reason is sent to the author |
| Appeal | `appeal_job_review` | Author from held/rejected; opens a `review_appeal` support ticket. **R10:** a double click opens two tickets; legacy private feedback could be "appealed" |
| History | `review_history` | **R11:** authors read operator user ids directly; rows could be updated or deleted by the service role |
| Other | `award_review_points` trigger | 50 loyalty points for a comment of 40+ characters (Credits are gated separately; unchanged, see DEC-2026-052 item 9) |

**Hosted (read-only aggregates, 2026-10-29):** 0 reviews, 0 `quality_feedback`, 0 history rows, 0 review-appeal tickets; 29 providers carry `contractors.rating` = 4.5. No live record is affected by this slice.

## 4. Source of truth

`public.reviews` is canonical for both public reviews and legacy private feedback (`internal_only`). `quality_feedback` holds no rows on hosted and has no writer. It is kept read-only for operations, not merged or deleted, and its future role is DEC-2026-052 item 3.

## 5. Decision checkpoint (DEC-2026-052, PROPOSED)

Recommendations are in the decision log. Current behavior is kept where an answer is missing; nothing below is approved by this slice.

1. **Review window:** none after confirmation (current). Recommend no deadline in beta.
2. **Edits:** unlimited corrections with a reason; state unchanged; a public correction moves the average at once and shows "Edited" (current plus the marker). Recommend keep.
3. **`quality_feedback`:** recommend DEPRECATED as a write path, rows read-only under CFG-011 retention.
4. **Provider visibility/response:** implemented as the restrictive default (providers see only their public reviews). Recommend no provider reply in beta.
5. **Review after an issue:** paused while `disputed`/`resolved`, eligible again when the job returns to `completed` (current). Recommend keep.
6. **`contractors.rating`:** recommend replacing the admin display with the verified summary and leaving the column untouched.
7. **Appeals:** one per moderation decision (implemented, mirroring dispute appeals per resolution version); no deadline (DEC-2026-009).
8. **What the author sees:** the criterion and the operator's reason, never the operator's identity (implemented; the reason was already sent before).
9. **Loyalty points for reviews:** unchanged; needs an owner/legal decision before Credits activate.

## 6. Implementation

Migration `20261031001000_phase6_reviews.sql` (additive):

- **Columns:** `reviews.revision`, `edited_at`, `moderation_version`, `moderation_criterion` (check: the four criteria), `moderated_at`; `review_history.seq` (identity), `from_state`, `to_state`, `criterion`, `revision`, `moderation_version`, `ticket_id`. Existing rows are backfilled from their history. History is append-only (trigger).
- **Eligibility:** `private.review_eligibility` (`eligible`, `submitted`, `plan`, `cancelled`, `no_provider`, `issue_open`, `closed`, `not_confirmed`), used by submission and the readback.
- **Commands:** `submit_job_review` (same signature; replay of the identical review; plan, issue and closed refusals named; 2,000-character limit). `revise_job_review(…, _expected_revision)` (stale `40001`, no-op refused). `moderate_job_review(…, _criterion, _expected_version)` (criterion required to hide; allowed transitions only; stale `40001`; private feedback never moderated; in-app notice with the criterion). `appeal_job_review` returns the ticket id; one appeal per decision; retry returns the same ticket; private feedback refused.
- **Reads:** `public_review_summaries(uuid[])` and `public_provider_reviews(uuid, limit)` (anon and signed-in; public rows only; no author identity; "edited" flag). `service_review(job)` (author: eligibility, review, history without operator ids; provider: the public review only; admin). `admin_reviews()` (every state, counts that match the public aggregate, full history with actor names, appeal tickets).
- **Grants:** the public SELECT policy is anon-only; signed-in users read their own rows directly, providers only their own public rows. `review_history` has no client read. `quality_feedback` loses client insert/update/delete and its write policies; admin read stays.

UI:

- `ServiceReviewPanel` (homeowner job dialog): server eligibility; native radio rating with arrow keys and 44 px targets; character count; validation and server refusals in a focused alert that keeps the input; success status; public/hidden state with the criterion; correction with reason and stale recovery; appeal with reason; history. Replaces the old inline form and the review part of `JobFollowUp`.
- Provider profile and the homeowner provider card read the server summary; "Edited" shown on corrected public reviews.
- `/admin/reviews` rebuilt on `admin_reviews`: state filter, server counts and public average, decision dialog with a required criterion, appeal uphold/deny, history. Legacy quality reports read-only. `/admin/quality` relabels legacy private feedback honestly.

## 7. Compatibility, deployment and rollback

- **Order (DEC-2026-037), with owner authorization:** `supabase db push --linked --dry-run` (expect only `20261031001000`), push, read back (columns present; `review_history` append-only trigger; `public_review_summaries`/`public_provider_reviews` executable by anon; `service_review`/`admin_reviews`/commands not executable by anon; `quality_feedback` no client writes; 0 reviews), then merge.
- **Old client on the new schema** (between push and deploy): submission, correction (new argument defaults) and appeal keep working. The old provider page and provider card show fewer rows to signed-in viewers (hosted has 0 reviews). The old admin "Hold" button is refused until the deploy because a criterion is now required (admin only, 0 reviews). The old admin page's direct reads still work.
- **Rollback:** promote the previous deployment. Keep the database forward; restoring the old commands would reopen R1–R11. If the RLS change itself must be reverted, a forward migration recreates the two dropped SELECT policies. Do not drop history columns once rows exist.
- **Money:** no money function, payout or fingerprinted object changed.

## 8. Gates (open)

1. Codex review of this diff.
2. Owner answers DEC-2026-052 (items 1–9); dependent behavior follows in its own change.
3. PR CI green (`main` CI on `ef1cc33` is green).
4. Hosted push (dry run first) with owner authorization, then merge.
5. Carried, unchanged: DEC-2026-050 (unpaid start) PROPOSED; 6.6c two-person finance sign-off not recorded; TRACE-126 and TRACE-127 open.
6. Not in scope: notification delivery and review requests (Phase 7; `review_requested` is set only by the inactive worker), support-ticket handling of appeals (6.10), provider reply, Cron, payments, pricing, cancellation/refund economics.

## 9. Evidence (2026-10-29, synthetic data only, local stack)

See the PR description for exact commands and results; summary:

- SQL 100 (new) 116/116: grants; eligibility for each state including plan, visit, dispute, closed and cancelled; ownership (other homeowner, provider, unrelated provider, missing job, anon); direct-write bypasses (reviews insert/update/delete, `quality_feedback` insert against any provider and operator rewrite, history insert/read); submission, trim, replay, duplicate, comment limit, rating bounds; visit binding and nothing on the plan; public summary/list/anon read agree; signed-in and provider leak checks; legacy private feedback never counts or shows; correction (author only, reason, stale, no-op, history, average moves, "edited"); moderation (roles, criterion required, unknown criterion, reason, duplicate, stale, invalid transition, private never moderated, rating unchanged, aggregate/anon/provider exclusion, author readback without operator id, in-app notice); appeal (author only, private refused, public refused, retry returns the ticket, appealed stays out of the aggregate, uphold returns it, a new decision gets a new appeal, history order); operations counts match the public aggregate; append-only history.
- SQL 009 12/12 with the moderation call naming its criterion.
- `scripts/review-concurrency.mjs` 6 scenarios, 3 consecutive passes.
- Unit `service-review` 7/7. Browser `reviews` and the updated `homeowner` keyboard review test (see PR).
