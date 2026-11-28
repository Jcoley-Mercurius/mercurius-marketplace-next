# Phase 7.5G-2 — sourcing queue: plan (TRACE-159)

**Status:** **PLAN, revision 1, for Codex review.** Documentation only. It approves no policy, sets no threshold or deadline, implements nothing and activates nothing. The OD-4a wording in §11.1 is **the owner's to decide; it is a proposal, not approved**.
**Date:** 2026-11-27 (America/New_York).
**Base:** `main` `1e97f95` (#217 merged, 7.5G-1 on `main`). Branch `claude/phase7-5g2-sourcing-plan`, from that commit.
**Authority read:** [7.5G plan](PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md) §4.1, §6 (S-1..S-5), §7.1 (OD-4a/4b, OD-6); [operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1) Q-01, §4, §6.2, §6.3, §7.1 SD-1, §7.2 HQ-1/HQ-2, §9, §10 step 6; MPS §6.2, §9 ([PROPOSED-MPS:294](../mps/PROPOSED-MPS.md)); CFG-002, CFG-009, CFG-010; AC-1 L-4; DEC-2026-049 item 8, DEC-2026-063 (`offer_terms` gate off); the [7.5G-1 record](PHASE-7-APPLICATIONS-REVIEW-QUEUE-7-5G-1.md) as the pattern for a summary-only queue slice.

## What this plan does not do

- No application, database, test, CI or configuration change. No hosted query, migration push, merge, deployment, scan, purge, email, scheduler, automation, booking, matching or payment change.
- No customer copy change. CFG-009 and CFG-002 stand: customer copy never claims or implies active sourcing, an assigned provider or a fulfillment date.
- No deadline, `aged` or due time (OD-6), no "sourced" outcome (OD-4b), no eligible-pool record (OD-3, C-3). The live matcher is not touched.
- It does not depend on #216, which is a ledger-only reconciliation of 7.5G-1.

## 1. State verified before work (2026-11-27 ET; `git` and `gh` only)

| Item | Observation |
|---|---|
| `main` | `1e97f95`. 7.5G-1 is on `main` (#217); its release checks are not done ([7.5G-1 record](PHASE-7-APPLICATIONS-REVIEW-QUEUE-7-5G-1.md) §8.6) |
| Numbering | Newest migration `20261205001000`, newest SQL test `133`. Next free: `20261206001000`, `134` (provisional) |
| Matcher | The live body is `private.offer_next_for_request_internal` in [20261117001000:645](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L645); `20261118001000` only calls it |
| Offer-terms reader | Live body in [20261118001000](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql) (`blocked_inactive`, `rematch_failed`, `unanswered`, `not_acceptable`) |
| Hosted | Not queried. The `offer_terms` gate is recorded as off (DEC-2026-063 scope), not observed. The number of legacy `sourcing` rows is unknown |

## 2. How a request is left without a provider today

Characterized from the migrations. Every path sets `status = 'pending'`, `contractor_id = null` and `needs_admin_review = true`.

| ID | Producer | Resulting state | Stored record of the moment |
|---|---|---|---|
| P-1 | Matcher: no candidate (gate on, or the request is not one-time) | `exhausted` | **None** (AC-1 L-4) |
| P-2 | Matcher: no candidate, gate off, one-time request | `exhausted`, plus one `private.offer_terms_blocks` row (candidates may be `[]`) | `offer_terms_blocks.created_at`, same statement |
| P-3 | Matcher: E5 replacement window closed (`private.replacement_search_closed`) | `exhausted` | None in the matcher. The provider's leaving is a `job_operations` row (`provider_cancel` / `no_show`) |
| P-4 | Matcher: next candidate needs fallback consent (`private.fallback_permitted` false) | `awaiting_consent` | None |
| P-5 | `record_job_operation` provider cancel or confirmed no-show on a **plan visit** (DEC-2026-049 item 8: not re-offered) ([20261101001000:262](../supabase/migrations/20261101001000_phase6_exceptions.sql#L262)) | `exhausted`, without running the matcher | `job_operations.created_at` |
| P-6 | Superseded Phase 1 matcher, zero candidates ([20260815120000:624](../supabase/migrations/20260815120000_phase1_matching_engine.sql#L624)) | `sourcing` | None. **No live function produces it**; legacy rows may exist |

**Exits.** Only offer creation (`create_job_offer_internal`) clears `needs_admin_review`, moving the request to `matched`/`offered`. It is reached through the matcher after a decline or expiry, the operator's `create_job_offer`, `consent_to_provider_fallback`, and `admin_retry_offer_terms_matching`. `release_job_match` returns the request to `awaiting_match` and reruns the matcher. Cancellation moves `status` to `cancelled` and **leaves `needs_admin_review = true`**.

**`needs_admin_review` is not a sourcing signal.** Fifteen migration files set it to true, for disputes, quote declines, appointments, exceptions, bound terms and matching. `/admin/quality` lists all of them as "Flagged Jobs". It cannot define this queue alone.

## 3. Entry and exclusion rules (proposal)

**Entry (E-1).** `service_requests.status = 'pending'` **and** `matching_status in ('exhausted', 'awaiting_consent', 'sourcing')`.

`needs_admin_review` is not required (SG-1). Every live producer sets it, so requiring it changes no current result. It would matter only for rows written another way (legacy or manual), and those should still be visible. SQL 134 asserts the invariant for every producer.

| ID | Excluded | Why |
|---|---|---|
| X-1 | Any `status` other than `pending` (cancelled, completed, and so on), even with `exhausted` and the flag still true | Cancellation leaves both. These requests no longer need a provider |
| X-2 | `awaiting_match` | No search has finished. This includes `rematch_failed` requests (pending, `awaiting_match`), which offers at other terms already lists |
| X-3 | `offered` with a pending offer, **including one past `expires_at`** (S-4) | It is a T-1 offer, not sourcing. See §7 |
| X-4 | `matched`, `awaiting_terms`, `awaiting_homeowner`, `quote_pending` | A provider or the quote path holds the request |

## 4. Kinds and legacy rows

Each item has a `kind`:

| `kind` | From | Operator meaning (not customer copy) |
|---|---|---|
| `exhausted` | P-1, P-2, P-3, P-5 | Matching ended with no provider who accepted |
| `awaiting_consent` | P-4 | A candidate exists, but the homeowner has not consented to a fallback provider |
| `legacy_sourcing` | P-6 | Set by the superseded matcher (zero candidates at the time). Listed under its own kind. It is never relabeled `exhausted` or merged into a count of current exhaustion |

- **Legacy rows (S-1).** They are shown, so the count is honest about what is stored. Their `since` follows §5. The number on hosted is unknown. If the owner wants it before implementation, one read-only count is enough: `select status, count(*) from public.service_requests where matching_status = 'sourcing' group by status` (counts only; not run, needs authorization).
- **`awaiting_consent` (SG-8).** MPS §9's entry is "No eligible provider or exhausted offers". A consent wait has an eligible provider, so it does not fit that sentence exactly. It is included under its own kind because no other queue lists it and it ends in the same operator action. Codex decides.
- **Plan visits (SG-6).** P-5 requests are plan visits, which only the plan's provider may take. Proposed: no extra field. A later page can join `recurrence_parent_id`. The alternative is a `plan_visit` boolean on the item.

## 5. `since`: honest timestamp labels (S-2)

No exhaustion event exists, and `updated_at` moves on any later write (AC-1 L-4). The reader therefore reports a derived lower bound and names its basis. It never reports a time labeled "exhausted at".

```
since = greatest(
  latest job_operations.created_at where job_id = request and kind in ('provider_cancel', 'no_show'),
  latest closing time over job_match_attempts for the request with outcome in ('declined', 'expired', 'withdrawn'),
    where an attempt's closing time is greatest(declined_at, withdrawn_at, responded_at)   -- greatest ignores nulls
)
otherwise service_requests.created_at
```

| `since_basis` | Source | Admin label (proposal) | How exact |
|---|---|---|---|
| `provider_left` | `job_operations` provider cancel / no-show (P-3, P-5) | "Provider left" | The recorded time of the operation. Matching ended at or after it |
| `last_offer_closed` | Latest declined, expired or withdrawn attempt | "Last offer closed" | Equal to the exhaustion time when the matcher ran in the closing transaction (`vendor_decline_job`, matcher-side expiry). Otherwise a lower bound |
| `request_received` | `service_requests.created_at`, when nothing above exists | "Request received" | Not the time matching ended. Copy must not present it as such |

- `accepted` attempts are not counted. Their `responded_at` is the acceptance time, which is not a closing time.
- Not used: `updated_at` (moves), `assigned_at`, `match_expires_at` (cleared), `last_match_expired_at` (set only by `expire_stale_matches`, not by the matcher's own expiry), `offer_terms_blocks.created_at` (only P-2; it is used for the cross-reference in §6, not for `since`).
- Copy rule: the admin page and overview show "since (derived)" with the basis label. They never say "waiting since", "exhausted at" or anything implying a measured exhaustion time. No `aged`, no due time (OD-6).
- Order: `since`, then `request_id`.

## 6. Overlap with offers at other terms (S-3, SD-1)

While the gate is off, P-2 writes a block for **every** one-time exhaustion outside E5, even with no gate-skipped candidates. `admin_offer_terms_queue` lists each such request as `blocked_inactive` (pending, `exhausted`, latest block not followed by a retry). So with the gate off, most one-time exhausted requests would be in both queues.

| Option | Effect |
|---|---|
| (a) Exclude `blocked_inactive` requests from sourcing | Sourcing undercounts. A block with `candidates = []` is a plain no-supply exhaustion |
| **(b) List in both; the sourcing item carries `offer_terms_block: true`** (recommended) | Each summary row still equals its own reader. The cross-reference tells the operator that retrying after gate activation is the other route. Rows must not be summed into a "requests needing action" total. The overview shows no total today |
| (c) Split by `candidates` (non-empty: offer terms only; empty: sourcing only) | Needs a change to `admin_offer_terms_queue`, which is out of scope. Without that change the overlap stays |

`offer_terms_block` is true exactly when `admin_offer_terms_queue` would list the request as `blocked_inactive`: same latest-block and no-later-retry condition, read from the same tables. SQL 134 asserts the two readers agree both ways.

## 7. Expired offers (S-4)

Excluded (X-3). Facts:

- A pending offer past `expires_at` is settled only when something calls the matcher or `expire_stale_matches`. Today that is `/admin/requests`, the homeowner dashboard and the vendor jobs page on load (each a write through RPC), or a lifecycle batch, whose scheduler is inactive.
- The sourcing reader is `STABLE` and must not write: HQ-2 runs it inside a `READ ONLY` transaction. It cannot settle the offer.
- So a request whose last offer has lapsed but is unsettled appears only after a settling read. The count is **as stored**. The overview description must say this (SG-4), so it is not read as real time.
- A separate "offers past their deadline" count belongs to T-1 / Q-01's offer side, not to this slice.

## 8. Reader, summary and client (proposal)

1. **One additive, function-only migration** (`20261206001000`, provisional):
   - `public.admin_sourcing_queue()`: `STABLE`, `SECURITY DEFINER`, `search_path = ''`, guarded by `private.require_admin()` (admin, `42501`). Execute revoked from `public`, `anon`, `service_role`, granted to `authenticated`. Returns `{checked_at, items: [{request_id, kind, since, since_basis, offer_terms_block}]}`. No customer, address, ZIP, service, provider or candidate field.
   - `public.admin_operations_summary()` restated from `20261205001000` with one change: `('sourcing', 'items', null)` appended after `applications`, inside the same per-queue error isolation. Finance stays last.
2. **Client:** `SUMMARY_QUEUES.sourcing` with the OD-4a label. No `agedLabel`. `href` `/admin/requests` (SG-7). No page change in this slice: `/admin/requests` badges and `/admin/quality` keep their own, different definitions, and no parity with them is claimed.
3. **Mixed versions:** `main`'s client drops a queue it does not know ([admin/page.tsx:55](../src/app/admin/page.tsx#L55)), as 7.5G-1 showed. The previous deployment works on the new summary, so `vercel promote` is a valid rollback.

## 9. Permissions

| Check | Expected |
|---|---|
| Admin (owner) | Reads the queue. The summary row is `ready` |
| Authenticated non-admin (homeowner, vendor) | `42501` from the reader; the summary refuses as today |
| `anon`, `service_role` | No execute on the reader |
| Writes | None. Measured with the transaction's `pg_stat_xact_all_tables` around two calls, as SQL 127 S7 does |
| Exposure | Ids, kinds, times and one boolean only. The `offer_terms_blocks.candidates` content is not returned |

## 10. Tests and acceptance (planned)

**SQL 134 (new).** Fixtures reached through the real commands where one exists:

| Fixture | Through | Expected |
|---|---|---|
| No eligible provider, gate on | Matcher | `exhausted`, `request_received` |
| Gate off, one-time, no candidates (`[]`) and with gate-skipped candidates | Matcher | `exhausted`, `offer_terms_block` true, in `admin_offer_terms_queue` too |
| Same, after `admin_retry_offer_terms_matching` re-exhausts | Retry | `offer_terms_block` false once the retry is later than the block |
| Declined, then exhausted | `vendor_decline_job` → matcher | `last_offer_closed` = the decline time |
| Expired in the matcher | Matcher after `expires_at` | `last_offer_closed` = the processing time |
| E5 replacement closed after a provider cancel | `record_job_operation` → matcher | `provider_left` |
| Plan visit, provider cancel | `record_job_operation` | `provider_left` |
| Fallback consent needed | Matcher | `awaiting_consent`; after `consent_to_provider_fallback` it leaves the queue |
| Legacy `sourcing` | Written as the owner in replica mode (no live producer; 7.5C method) | `legacy_sourcing` |
| Cancelled after exhaustion (flag still true) | Cancellation | Excluded |
| `awaiting_match`, `rematch_failed` | Matcher / decline failure | Excluded |
| Offer past expiry, unsettled | Direct `expires_at` in the past | Excluded; included after `expire_stale_matches` exhausts it |
| Tie on `since` | Two requests | Ordered by `request_id` |

Assertions: the exact set, kind, `since` and `since_basis` per fixture; order; `offer_terms_block` agreement with the offer-terms reader both ways; the invariant that every live producer sets `needs_admin_review`; `42501` for a non-admin; no `anon` or `service_role` execute; no writes; summary count parity and error isolation. SQL 127 S1 and SQL 129 R15 change **on purpose** (queue list, summary md5). The browser fixture is regenerated with `scripts/derive-operations-summary-fixture.mjs` and checked with `--check`.

**Mutations, each caught by a named test:** drop `status = 'pending'`; drop `awaiting_consent`; drop `legacy_sourcing`; include `awaiting_match`; include an offer past expiry; take `since` from `updated_at`; count `accepted` as a closing time; drop `provider_left`; invert `offer_terms_block`; grant `anon` execute; drop the summary row.

**Also:** unit key coverage for `SUMMARY_QUEUES`; browser overview row (label, count, "—" for aged, link); old-client compatibility; clean replay; full SQL suite; fingerprints unchanged except the two functions; money fingerprint unchanged; typecheck, lint, secret scan, production build with CI's synthetic environment.

## 11. Decisions

### 11.1 Owner

| ID | Decision | Needed before | Proposal (not approved) |
|---|---|---|---|
| **OD-4a** | Operator-facing name and description of the queue | Implementation | **Proposal only:** name "Sourcing" (MPS §9's name), on admin pages only. Description "No provider has accepted; no deadline is set. Counts are as stored." No customer copy changes. **Not approved**; the owner may choose other wording |
| OD-4b | A "sourced" outcome | Any liquidity measure | Unchanged: option (a), none in beta |
| OD-6 | A sourcing deadline | Any `aged` or due time | Unchanged: none until the pilot baseline |
| — | Optional read-only legacy `sourcing` count (§4) | Implementation, if wanted | Counts only |

### 11.2 Codex (technical)

| ID | Question | Proposal |
|---|---|---|
| SG-1 | Require `needs_admin_review` at entry? | No. Matching state is the signal; the flag is shared and the invariant is tested (§3) |
| SG-2 | `since` and its bases | §5: `provider_left`, `last_offer_closed`, `request_received`; never `updated_at` |
| SG-3 | Overlap with offers at other terms | Option (b), with the `offer_terms_block` cross-reference (§6) |
| SG-4 | Expired offers | Excluded; "as stored" in the description (§7) |
| SG-5 | Legacy `sourcing` | Its own kind, never merged (§4) |
| SG-6 | Plan visits | No extra field (§4) |
| SG-7 | Summary position and link | After `applications`, before finance; link `/admin/requests` |
| SG-8 | `awaiting_consent` in this queue | Included under its own kind (§4) |

## 12. Rollout and rollback

Codex review of this plan, then OD-4a, then implementation. Then a dry run listing only the new migration and the push, both before merge and owner-authorized (DEC-2026-037). Then merge (deploy), a READY readback, and HQ-1/HQ-2 extended to the `sourcing` row: one `REPEATABLE READ READ ONLY` transaction, as in the [7.5G-1 record](PHASE-7-APPLICATIONS-REVIEW-QUEUE-7-5G-1.md) §8.6 step 5 with one more `readers` line. Rollback: `vercel promote` of the previous deployment; the database rolls forward with a migration restoring the `20261205001000` summary body. No data is written.

## 13. Validation of this plan

- Documentation only: this file, a pointer in the [7.5G plan](PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md) §6, and a handoff entry. TRACEABILITY is left to #216, which edits the TRACE-159 row.
- `git diff --check`, relative-link existence and `npm run scan:secrets`: results in the PR body.
- No hosted read or write.
