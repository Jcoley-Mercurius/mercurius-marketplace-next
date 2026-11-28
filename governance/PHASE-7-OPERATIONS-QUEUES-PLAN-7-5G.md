# Phase 7.5G — next operations-queue slice: scope recommendation (TRACE-159)

**Status:** **PLAN, revision 2: Codex technical review recorded** (§9, relayed in conversation; not a GitHub review and not release authorization). Owner decisions are listed. Documentation only. It approves no policy, sets no threshold, implements nothing and activates nothing. "7.5G" is provisional.
**Date:** 2026-11-27 (America/New_York).
**Base:** `main` `2039d25` (#212 merge), fetched before work. Branch `claude/phase7-5g-scope-plan`, from that commit.
**Authority read:** [roadmap](../roadmap/MERCURIUS-REBUILD-ROADMAP.md) Phase 6 item 7 and Phase 7 ("Create owned operational queues with age, priority, SLA, alert, and next action"; the gate); MPS §5.2, §6.2, §8, §9, §11 (approved baseline per [OWNER-APPROVALS](OWNER-APPROVALS.md); values the MPS leaves open, such as metric thresholds and operational SLAs, stay open); CFG-002, CFG-009, CFG-010, CFG-015; [operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1, revision 7) §3, §5, §6.2, §6.3, §9, §10; [analytics coverage contract](PHASE-7-ANALYTICS-COVERAGE-CONTRACT.md) (AC-1) L-1, L-4, L-5, D-1, D-4, D-6; [TRACE-136 brief](PHASE-6-ADMIN-OPERATIONS-BRIEF.md) A8 and §12.4; [DECISION-LOG](DECISION-LOG.md) DEC-2026-032, -068, -069; [HANDOFF](../docs/agent/HANDOFF.md).
**Phase 7 brief:** none exists on `main`. The 7.1 and NM-1 records say the same. As they did, this plan uses the roadmap's Phase 7 section and the owner's instruction for this slice as its brief.

## What this slice does not do

- **Independent of #213 (7.5F-2).** #213 is not incorporated, reviewed, relied on or duplicated here. Its review, CI and release are **not** complete (§1). Nothing below needs the SLA observation page. This PR leaves TRACEABILITY's TRACE-159 row and DEC-2026-069 alone, because #213 edits both lines.
- **No application, database, test, CI or configuration change.** No hosted query, migration push, merge, deployment, scan, purge, email activation, scheduler, automation, booking or payment change.
- **Carried unchanged:** OD-3..OD-7 (with OD-5 limited by DEC-2026-068), AC-1 D-1 and D-4..D-6, SD-1, SD-2, HQ-1..HQ-6, every 7.3D gate. Not Phase 7 acceptance.

## 1. State verified before work (dated, GitHub reads only)

| Item | Observation (2026-11-27 ET) |
|---|---|
| `main` | `2039d25`, #212 merged at 16:01:03 UTC (record of `20261204001000` on hosted, documentation only). Before it: #211 `5cfe5b0` (F208-1 repair), #208 `89973fa` (7.5F-1), #207 (7.5F plan), #203/#202 (7.5E), #201 (7.5D), #199 (7.5C) |
| #213 (7.5F-2 page) | **Open**, not a draft, no review decision. Head `57a1e7a` (updated 16:01:33 UTC, after #212 merged). Checks when read: `analytics-privacy` **failure** (run 46030022960), one `backend` cancelled and one in progress (run 46030022826); earlier `lifecycle`/`application` runs cancelled. Not rerun or investigated here (the owner handles CI reruns) |
| Migrations | Newest on `main`: `20261204001000`. #213 adds none. Next free version: `20261205001000` |
| SQL tests | Newest: `132_sla_replay_pair_read.sql`. Next free: `133` |
| Hosted | Not queried |

## 2. What remains after 7.5F-2

The OQ-1 §10 sequence, with status on `main`:

| Step | Slice | Status (2026-11-27 ET) |
|---|---|---|
| 1–4 | 7.5B summary truth, 7.5C staged failures, 7.5D first reply, 7.5E admin notices | Merged (#197, #199, #201, #202 + #203) |
| 5 | 7.5F breach observations | Database merged (#208, repair #211, hosted record #212). Page: #213, open |
| **6** | **7.5G server sourcing and applications queues (no thresholds)** | **Not started.** OQ-1 lists OD-4 "for sourcing wording" |
| 7 | Eligible-pool record | Not started. OD-3 open |
| 8 | Scheduler activation (HQ-3, HQ-4) | Not started. DEC-2026-003 sequence, owner approval of cadence |

Other Phase 7 roadmap lines (error/uptime reporting, MTS §15 item 6; email activation, the 7.3D gates; runbooks) each wait on an owner or provider decision and are not candidates for the smallest slice.

Step 6 holds two queues of very different size. This plan splits it in two: **7.5G-1 applications awaiting review** (recommended, §5) and **7.5G-2 sourcing** (planned, §6).

## 3. Candidates compared

| Candidate | Governing requirement | Decision needed first | Paths touched | Size |
|---|---|---|---|---|
| **C-1 Applications awaiting review: server reader and overview row** | Roadmap Phase 6 item 7, Phase 7 queues; MPS §8 (operator activation with recorded evidence); TRACE-136 A8 names "applications awaiting review" in the summary; OQ-1 Q-12 G-1 | **None on policy.** Codex: R-1..R-5 (§7.2) | Admin read path only | One function-only migration; one client map entry |
| C-2 Sourcing: server reader and overview row | MPS §9 Sourcing queue; CFG-009; CFG-002; OQ-1 Q-01 G-1 | OD-4a wording (owner); S-1..S-5 (Codex) | Admin read path; reads matching state | Function-only migration, with harder definitions (§6) |
| C-3 Eligible-pool record | MPS §5.2, §6.2, §11 | OD-3 (four definitions); matching version undefined | **Live matcher** (`offer_next_for_request_internal`) | Changes the booking path |
| C-4 Operator reporting surface | MPS §11 "Proposed dashboards"; AC-1 D-6 | D-6, D-1, OD-6; OD-5 for alerts | New surfaces | Unbounded until D-6 |

C-1 is the smallest. It reads stored rows only, its entry time is an immutable column, it changes no matching, booking, payment or messaging path, and it restates a classification that is already reviewed and merged (TRACE-105, TRACE-108). C-2 is the next step once its definitions are settled.

## 4. Approved requirements versus unresolved decisions

### 4.1 Sourcing

| | Statement | Source |
|---|---|---|
| **Approved** | A Sourcing queue exists for operators. Entry: "No eligible provider or exhausted offers". Owner outcome: "Find supply or close transparently by deadline" | MPS §9 ([PROPOSED-MPS:294](../mps/PROPOSED-MPS.md)) |
| **Approved** | Exhaustion shows the customer "Not available yet in your area." Copy must never claim or imply active sourcing, an assigned provider or a fulfillment date | CFG-009, CFG-002, MPS §6.2 |
| **Approved** | An admin override needs a reason and keeps the pre-override result. Implemented as `create_job_offer` and `release_job_match` | MPS §6.2; OQ-1 Q-01 |
| **Approved** | Accountable role: the project owner until a delegate is recorded | CFG-010 (OQ-1 X-1) |
| Implemented | No server queue. `/admin/requests` badges `matched` past `match_expires_at` in the client ([requests/page.tsx:532](../src/app/admin/requests/page.tsx#L532)). `/admin/quality` lists `needs_admin_review` requests ([quality/page.tsx:24](../src/app/admin/quality/page.tsx#L24)). The live matcher sets `exhausted` (no candidate, or the E5 replacement window closed) or `awaiting_consent` (fallback not permitted), each with `needs_admin_review` ([20261117001000:681, :712, :739](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L681)). No live function sets `sourcing`. Only the superseded Phase 1 matcher did | OQ-1 §6.3 |
| Implemented | Exhaustion writes no event: there is only `needs_admin_review` plus `updated_at`, which any later write moves | AC-1 L-4 |
| **Unresolved: owner** | **OD-4a (new split of OD-4):** the operator-facing name and description of the queue. OQ-1 §10 ties 7.5G to "OD-4 for sourcing wording" | §7.1 |
| **Unresolved: owner** | **OD-4b (the rest of OD-4):** whether any "sourced" outcome is measured (OQ-1 §6.3 options a–c) | OQ-1 §9 |
| **Unresolved: owner** | A sourcing deadline ("close … by deadline"). None is set; MPS §2 sets targets only after a pilot baseline | OD-6 |
| Unresolved: elsewhere | A homeowner exhaustion message (N-REQ-04) is absent and is not in this scope | NM-1 |
| **Unresolved: Codex** | S-1..S-5: entry kinds, the `since` source, overlap with offers at other terms, legacy `sourcing` rows, open offers past expiry | §6 |

### 4.2 Eligible-provider counts

| | Statement | Source |
|---|---|---|
| **Approved** | The match state includes `eligible_pool_created`. Liquidity measures include "eligible pool count". Ranking factors are "logged with a version". "Matching version" is a required dimension | MPS §5.2, §6.2, §11 |
| Implemented | **None.** The live matcher computes no count (OQ-1 §6.2 corrected AC-1 L-1). What is stored: offered candidates (`job_match_attempts`) and, only for a one-time exhaustion while the offer-terms gate is off, the candidates skipped for that reason (`private.offer_terms_blocks.candidates`, [20261117001000:725](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L725)). No matching version exists | OQ-1 §6.2 |
| **Unresolved: owner** | **OD-3:** when a pool is "created" (first run, or every run); count before or after excluding earlier attempts; whether gate-blocked candidates count; whether a version is stored | OQ-1 §6.2, §9 |
| **Unresolved: owner** | AC-1 D-4 (pool persistence) and D-1 (measure from operational records, not PostHog) | AC-1 §9 |
| Unresolved: technical | What a "matching version" is. Nothing defines one today | — |
| Constraint | Any pool record is written inside the live matcher, on the booking path. That is why it is not a small slice | — |

### 4.3 Operator reporting

| | Statement | Source |
|---|---|---|
| **Approved** | Seven proposed dashboards, among them "Supply/liquidity by service and ZIP" and "Fulfillment reliability and exception aging". Their metric thresholds stay open | MPS §11; OWNER-APPROVALS |
| **Approved** | The overview's counts each equal their queue, with no number of their own | TRACE-136 A8; 7.5B |
| **Approved** | In-app readback of the operator's own notices only | DEC-2026-068 (OD-5, limited) |
| **Approved** | Breach observations for T-3, T-4, T-5, T-8 and T-10, by manual scan, with 90-day logical retention. First-reply lateness is deferred | DEC-2026-069 (P-4 deferred) |
| Implemented | `/admin` overview (`admin_operations_summary`, nine rows); `/admin/notifications`; `/admin/pricing-analytics` | 7.5B, 7.5E |
| Pending, not on `main` | The SLA observation page. #213 is open and not part of this plan | §1 |
| **Unresolved: owner** | AC-1 D-6 (a validated operator measurement surface), OD-5 beyond in-app (external channel, named recipient, HQ-6), OD-6 (thresholds where none exist), P-4 lateness reporting, MTS §15 item 6 (error/uptime provider) | AC-1 §9; OQ-1 §9 |

7.5G-1 adds one overview row for a queue that already exists, under the TRACE-136 A8 rule. It is not a new reporting surface and does not depend on D-6.

## 5. Recommended slice — 7.5G-1 applications awaiting review in the overview

**Why.** TRACE-136 A8 listed "applications awaiting review" among the summary's queues. It was left out only because no server reader existed (§12.4 item 4: "they aren't summarized rather than being computed differently from their pages"). Today the count is computed only in the browser: [`applicationQueueState`](../src/lib/applicationQueueState.ts#L22) over each application's `status` and one `vendor_onboarding_intake_status` call per row ([applications/page.tsx:203](../src/app/admin/applications/page.tsx#L203)). The overview cannot show this queue, and SQL cannot test the count.

**Authority, stated exactly.** MPS §9's named queues do **not** include applications. The authority is the roadmap (Phase 6 item 7, Phase 7 queues), MPS §8 (activation approved by an authorized operator with recorded evidence), TRACE-136 A8, and the merged classification in TRACE-105 and TRACE-108 (DEC-2026-032). Codex is asked to confirm this reading (R-1).

### 5.1 Scope (exact)

1. **One additive, function-only migration** (`20261205001000`, provisional):
   - New `public.admin_application_review_queue()`: `STABLE`, `SECURITY DEFINER`, `search_path = ''`, guarded by `public.vendor_require_operator()` (admin, `42501`; [20260905002000:83](../supabase/migrations/20260905002000_vendor_evidence.sql#L83)). Execute revoked from `public`, `anon` and `service_role`, granted to `authenticated`. It returns `{checked_at, items}`, one item per application whose state under `applicationQueueState` is `awaiting_review`:
     - `status` is not `abandoned` or `rejected`;
     - no `vendor_onboarding` row for the application's `contractor_id` has `status = 'rejected'`;
     - no `vendor_onboarding_review_starts` row exists for the application;
     - `status` is not `approved` (legacy approved stays outside, as on the page).
     
     Items are `{application_id, since}`, with `since = vendor_applications.created_at`, oldest first. No name, email or document field (R-4). No `aged` and no `due_at`, because no threshold is approved (OQ-1 §4).
   - `public.admin_operations_summary()` restated from [20261130001000](../supabase/migrations/20261130001000_phase7_operations_summary_truth.sql#L24) with one change: `('applications', 'items', null)` appended after `offer_terms`, inside the same per-queue `exception when others` → `error` handling. Finance stays last. Grants, order of the existing rows and every other function stay unchanged.
2. **Client:** [`SUMMARY_QUEUES`](../src/lib/adminOperations.ts#L48) gains `applications: { label: "Applications awaiting review", href: "/admin/applications" }`, with no `agedLabel`. The applications page is unchanged (R-2).
3. **Tests:**
   - SQL 133 (new): one fixture application per state the page knows (awaiting; review started via `vendor_start_onboarding_review` and via the R0 existing-provider start; active; suspended; onboarding rejected; application rejected; abandoned; legacy approved; null `contractor_id`). It asserts exactly the awaiting rows, `since`, order, `42501` for a non-admin, no `anon` execute, no writes, summary count parity, and error isolation (a failing reader turns only `applications` to `error`).
   - SQL 127 S1 (queue list and order) changes **on purpose** to include `applications`; the browser fixture is regenerated with `scripts/derive-operations-summary-fixture.mjs` and checked with `--check`. SQL 108 and 128 are expected unchanged; any change is reported.
   - Unit: a cross-layer parity test. The SQL 133 fixture rows, passed through `applicationQueueState`, give the same set the server returns (in a new test file, to stay clear of #213's edit to `adminOperations.test.ts`). The existing key-coverage test covers the new map entry in both directions.
   - Browser: `admin-operations.spec.ts` shows the "Applications awaiting review" row with its count, "—" for aged, and the link to `/admin/applications`.

### 5.2 Acceptance criteria

1. The server set equals the page's `awaiting_review` set for every fixture state (SQL 133 and the parity test).
2. Each of these mutations fails a named test: drop the review-start exclusion; drop the onboarding-rejected exclusion; include legacy approved; include abandoned; drop the summary row; use the wrong list key; grant execute to `anon`.
3. `admin_operations_summary` still writes nothing, stays admin-only, and keeps finance `restricted`/`error` (SQL 108 Q1–Q5 unchanged).
4. The money fingerprint is unchanged. Every function and relation fingerprint is unchanged except the two functions named in §5.1.
5. Clean replay of all migrations; full SQL suite; unit, typecheck, lint, secret scan and production build (synthetic environment) pass.
6. Mixed versions are safe: the current client filters unknown queues ([admin/page.tsx:55](../src/app/admin/page.tsx#L55)). Shown by running `main`'s client spec against the new function.

### 5.3 Dependencies, rollout and rollback

- **Depends on:** 7.5B (merged). **Not on** #213: #213 adds no migration and does not touch the summary or `SUMMARY_QUEUES`. If #213 merges first, the only overlap is shared ledgers (HANDOFF, TRACEABILITY), resolved by keeping both entries.
- **Rollout:** Codex review, then the owner authorizes a dry run listing only `20261205001000` and the push, both before merge (DEC-2026-037). Then merge (deploy), a READY readback, and HQ-1/HQ-2 extended to the `applications` row under the owner's authorization.
- **Rollback:** `vercel promote` of the previous deployment, which is compatible as AC 6 shows. The database rolls forward with a migration restoring the 20261130001000 body. No data is written.

### 5.4 Out of scope

Changing the applications page or its per-row reads; thresholds, aging or a due time; ownership or assignment fields; notices or email; sourcing (7.5G-2); pool records; dashboards; scheduler.

## 6. Next slice — 7.5G-2 sourcing queue (planned, not recommended first)

A read-only `admin_sourcing_queue()` plus an overview row, with no deadline and no `aged`. Before it can be built:

| ID | Question | Proposal (for Codex) |
|---|---|---|
| S-1 | Entry kinds | `exhausted` and `awaiting_consent` with `needs_admin_review`, `status = 'pending'`; legacy `sourcing` rows listed under their own kind |
| S-2 | `since` | No exhaustion event exists and `updated_at` moves (L-4). Use the latest terminal `job_match_attempts` time, or the request's submission when no offer was made, and label it "since (derived)". Or add an append-only exhaustion record, which touches the matcher and so belongs with C-3 |
| S-3 | Overlap with offers at other terms | SD-1: a gate-blocked one-time exhaustion is already `blocked_inactive` in `admin_offer_terms_queue`. Either exclude it here or list it in both with a cross-reference, so each queue's count stays equal to its own page |
| S-4 | Open offers past expiry | Leave them out. They settle when read (`expire_stale_matches`) and are T-1 offers, not sourcing |
| S-5 | Customer copy | None changes. [serviceRequestStatus.ts:76](../src/lib/serviceRequestStatus.ts#L76) already gives "Not available yet in your area" |

The owner decides OD-4a (§7.1). Pool counts (C-3) stay out of 7.5G-2.

*Dated note (2026-11-27 ET):* the detailed 7.5G-2 plan is [PHASE-7-SOURCING-QUEUE-PLAN-7-5G-2](PHASE-7-SOURCING-QUEUE-PLAN-7-5G-2.md). It answers S-1..S-5 as proposals for Codex (SG-1..SG-8). It keeps OD-4a as an owner proposal, not approved. The table above is kept as written.

*Dated note (2026-11-27 ET, revision 2):* Codex ruled on SG-1..SG-8 in conversation. The 7.5G-2 plan now reports a named related-event time instead of a "since" bound, returns `plan_visit`, and links the summary row (after applications, before finance) to a read-only `/admin/sourcing` list. OD-4a's recommended description is now "Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state." It is still not approved. The OD-4a row in §7.1 below is kept as written.

*Dated note (2026-11-27 ET, OD-4a):* the owner approved OD-4a as recommended: admin-only name "Sourcing", description "Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state." ([DEC-2026-070](DECISION-LOG.md); 7.5G-2 plan §11.4). It does not decide OD-4b, eligible-provider definitions or a sourcing deadline (OD-6). Codex accepted SG-9. The §7.1 row below is kept as written.

## 7. Decisions

### 7.1 Owner

| ID | Decision | Needed before | Recommendation (proposal only) |
|---|---|---|---|
| — | 7.5G-1 | — | **No policy decision.** Needs only the hosted push authorization and the release (merge), as every function-only slice has |
| OD-4a | Operator-facing name and description of the sourcing queue | 7.5G-2 | "Sourcing" (MPS §9's name), on admin pages only, described as "No provider has accepted; no deadline is set". No customer copy changes |
| OD-4b | "Sourced" outcome | Any liquidity measure of it | Unchanged: option (a), none in beta |
| OD-3 | Eligible-pool definition | C-3 | Unchanged (OQ-1 §9) |
| OD-6 | Sourcing deadline and other thresholds | Aging those queues | Unchanged: none until the pilot baseline |
| D-6 | Operator measurement surface | C-4 | Unchanged: a later slice |

### 7.2 Codex (technical)

**Ruled 2026-11-27 ET (revision 2):** Codex's technical review was relayed by the owner in conversation. It is not a GitHub review object and not owner release authorization. The rulings are in §9 and govern where they differ from the proposals below, which are kept as written.

| ID | Question | Proposal |
|---|---|---|
| R-1 | Is the authority for 7.5G-1 adequate, given that MPS §9 does not name the queue? | Yes: roadmap, MPS §8, TRACE-136 A8, TRACE-105/108 |
| R-2 | Summary only, with a parity test, or also move the page onto the server reader? | Summary only. The page needs per-row states beyond `awaiting_review`; moving it is a separate slice |
| R-3 | `since` = application `created_at`, or the latest version's time? | `created_at`, the moment the application entered the queue. A later version is written by the intake trigger whenever a stored intake field changes ([20260905002000:69](../supabase/migrations/20260905002000_vendor_evidence.sql#L69)). That is a change to the record, not a new submission, so it should not reset the age. Codex should confirm that no path writes a version that ought to count as a new submission |
| R-4 | Item shape | `{application_id, since}` only. The summary needs a count, and a later page can join what it needs |
| R-5 | Position in the summary | After `offer_terms`, before finance (the 7.5B precedent) |

## 8. Validation of this slice

- Documentation only: this file, a dated 7.5G note in the [operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) §10 (revision 8) and the handoff entry.
- `git diff --check`, relative-link existence and `npm run scan:secrets`: results in the PR body.
- No code, test, migration, workflow or configuration change. No hosted read or write.

## 9. Codex review (revision 2, 2026-11-27 ET)

Relayed by the owner in conversation, as Codex's technical review. It is not a GitHub review, not owner release authorization and not plan acceptance by merge. It authorizes no hosted query, push, merge or deployment.

### 9.1 Rulings

| ID | Ruling (as relayed) | Effect on §5 |
|---|---|---|
| R-1 | **Authority: accepted.** "The approved Phase 6 admin brief explicitly includes applications awaiting review in the overview. This fills an existing omission." | None |
| R-2 | **Summary-only scope: accepted.** "Add the server reader and overview row. Leave the applications page unchanged." | None |
| R-3 | **Timestamp: accepted with wording clarification.** "Use `vendor_applications.created_at`, described as application received, not the beginning of a new review episode. Intake revisions do not reset it." | Records and copy call `since` "application received". SQL 133 includes an application with several intake revisions and asserts that `since` stays `created_at` |
| R-4 | **Response shape: accepted.** "Return `{application_id, since}` only, within the planned `{checked_at, items}` response." | None |
| R-5 | **Summary placement: accepted.** "Place applications after offers at other terms and before finance." | None |

### 9.2 Required clarifications

| ID | Clarification (as relayed) | Effect on §5 |
|---|---|---|
| C-1 | **Actual cross-layer parity:** "compare real SQL results with the real `applicationQueueState`, using the same persisted fixtures. Two handwritten expected lists do not establish parity." | The parity test takes the database's own output for the SQL 133 fixtures: each application's `status`, the `vendor_onboarding_intake_status` readback the page uses, and `admin_application_review_queue()`. It passes them through the imported `applicationQueueState` and compares the sets. A handwritten list may still be used for SQL assertions, but never as the parity evidence |
| C-2 | **Parity limits:** "equality applies to successfully loaded data representing the same database state. The existing browser page makes separate requests and can temporarily show 'Checking' or 'Status unavailable.'" | Parity is claimed only for fully loaded readbacks from one database state. The record states that the page's `checking` and `unavailable` states fall outside the claim, and that the page and the overview are separate reads, so they can differ for a moment |
| C-3 | **Deterministic ordering and fixtures:** "order by `created_at`, then application ID. Include multiple intake revisions and linked onboarding without a review-start row in the fixtures." | Order is `created_at, id`. The fixtures include a tie on `created_at`, an application with several intake revisions, and a linked `vendor_onboarding` row with no review-start row |

### 9.3 Revision history

| Revision | Date (ET) | Base | Change |
|---|---|---|---|
| 1 | 2026-11-27 | `main` `2039d25` | First plan |
| 2 | 2026-11-27 | `main` `2039d25` (unchanged) | Codex's review recorded (§9); a note in §7.2. No scope, criterion or owner decision changed except as §9 states |
