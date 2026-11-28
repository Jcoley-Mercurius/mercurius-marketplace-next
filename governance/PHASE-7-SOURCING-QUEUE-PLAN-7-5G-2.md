# Phase 7.5G-2 — sourcing queue: plan (TRACE-159)

**Status:** **PLAN, revision 2, after Codex review; OD-4a approved and SG-9 accepted (§11.4).** Documentation only. It sets no threshold or deadline, implements nothing and activates nothing. The owner approved OD-4a's wording on 2026-11-27 ET ([DEC-2026-070](DECISION-LOG.md)); that approval does not decide OD-4b, an eligible-provider definition or a sourcing deadline. Codex found revision 2 technically clear at `ed209ae` and accepted SG-9. Implementation is a separate PR (§11.4). *(Before 2026-11-27 ET §11.4: "PLAN, revision 2, after Codex review. … The OD-4a wording in §11.1 is a recommendation to the owner, not approved.")*
**Date:** 2026-11-27 (America/New_York).
**Base:** `main` `6614691` (#218 merged at its head `c9e1b25`, which is revision 1 of this plan). Branch `claude/phase7-5g2-sourcing-plan-r2`, from that commit.
**Revision 2:** applies the Codex rulings SG-1..SG-8 (§11.2), relayed in conversation (not a GitHub review). Revision 1 is `c9e1b25`; the corrections Codex asked for were not in it.
**Authority read:** [7.5G plan](PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md) §4.1, §6 (S-1..S-5), §7.1 (OD-4a/4b, OD-6); [operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1) Q-01, §4, §6.2, §6.3, §7.1 SD-1, §7.2 HQ-1/HQ-2, §9, §10 step 6; MPS §6.2, §9 ([PROPOSED-MPS:294](../mps/PROPOSED-MPS.md)); CFG-002, CFG-009, CFG-010; AC-1 L-4; DEC-2026-049 item 8, DEC-2026-063 (`offer_terms` gate off); the [7.5G-1 record](PHASE-7-APPLICATIONS-REVIEW-QUEUE-7-5G-1.md) as the pattern for a queue slice.

## What this plan does not do

- No application, database, test, CI or configuration change. No hosted query, migration push, merge, deployment, scan, purge, email, scheduler, automation, booking, matching or payment change.
- No customer copy change. CFG-009 and CFG-002 stand: customer copy never claims or implies active sourcing, an assigned provider or a fulfillment date.
- No deadline, `aged` or due time (OD-6), no "sourced" outcome (OD-4b), no eligible-pool record (OD-3, C-3). The live matcher is not touched.
- No new operator authority. In particular, nothing lets an operator offer a plan visit to a provider other than the plan's (SG-6).
- It does not depend on #216, which is a ledger-only reconciliation of 7.5G-1, and it leaves #216's handoff and evidence entries as they are.

## 1. State verified before work (2026-11-27 ET; `git` and `gh` only)

| Item | Observation |
|---|---|
| `main` | `6614691`: #218 merged at `c9e1b25` (revision 1, documentation only). 7.5G-1 is on `main` (#217); its release checks are not done ([7.5G-1 record](PHASE-7-APPLICATIONS-REVIEW-QUEUE-7-5G-1.md) §8.6) |
| #216 | Open, documentation only (7.5G-1 record, TRACE-159 row, handoff). Not touched here |
| Numbering | Newest migration `20261205001000`, newest SQL test `133`. Next free: `20261206001000`, `134` (provisional) |
| Matcher | The live body is `private.offer_next_for_request_internal` in [20261117001000:645](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L645); `20261118001000` only calls it. Plan visits are offered only to the plan's provider ([20261117001000:700](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L700)) |
| Provider withdrawal | The live `record_job_operation` is in [20261102001000:258](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql#L258) |
| Offer-terms reader | Live body in [20261118001000](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql) (`blocked_inactive`, `rematch_failed`, `unanswered`, `not_acceptable`) |
| `/admin/requests` | Calls `expire_stale_matches` on load ([requests/page.tsx:233](../src/app/admin/requests/page.tsx#L233)), a write. The admin shell itself calls only `has_role` ([layout.tsx:31](../src/app/admin/layout.tsx#L31)) |
| Hosted | Not queried. The `offer_terms` gate is recorded as off (DEC-2026-063 scope), not observed. The number of legacy `sourcing` rows is unknown |

## 2. How a request is left without a provider today

Characterized from the migrations. Every path sets `status = 'pending'`, `contractor_id = null` and `needs_admin_review = true`.

| ID | Producer | Resulting state | Related stored record |
|---|---|---|---|
| P-1 | Matcher: no candidate (gate on, or the request is not one-time; for a plan visit, the plan's provider is not eligible) | `exhausted` | **None** for the moment itself (AC-1 L-4) |
| P-2 | Matcher: no candidate, gate off, one-time request | `exhausted`, plus one `private.offer_terms_blocks` row (candidates may be `[]`) | `offer_terms_blocks.created_at` |
| P-3 | Matcher: E5 replacement window closed (`private.replacement_search_closed`) | `exhausted` | Earlier `job_operations` row (`provider_cancel` / `no_show`) and closed attempts |
| P-4 | Matcher: next candidate needs fallback consent (`private.fallback_permitted` false) | `awaiting_consent` | None |
| P-5 | `record_job_operation` provider cancel, or confirmed no-show by an admin, on a **plan visit** (DEC-2026-049 item 8) **or** inside the 24-hour search deadline (E5), without running the matcher | `exhausted` | `job_operations.created_at`; the pending attempt gets `withdrawn_at` in the same transaction |
| P-6 | Superseded Phase 1 matcher, zero candidates ([20260815120000:624](../supabase/migrations/20260815120000_phase1_matching_engine.sql#L624)) | `sourcing` | None. **No live function produces it**; legacy rows may exist |

Revision 1 described P-5 as plan visits only. The live body also sends a withdrawal inside the search deadline straight to `exhausted` ([20261102001000:334](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql#L334)).

**Exits.** Only offer creation (`create_job_offer_internal`) clears `needs_admin_review`, moving the request to `matched`/`offered`. It is reached through the matcher after a decline or expiry, the operator's `create_job_offer`, `consent_to_provider_fallback`, and `admin_retry_offer_terms_matching`. `release_job_match` returns the request to `awaiting_match` and reruns the matcher. Cancellation moves `status` to `cancelled` and **leaves `needs_admin_review = true`**.

**`needs_admin_review` is not a sourcing signal.** Fifteen migration files set it to true, for disputes, quote declines, appointments, exceptions, bound terms and matching. `/admin/quality` lists all of them as "Flagged Jobs". It cannot define this queue alone.

## 3. Entry and exclusion rules

**Entry (E-1).** `service_requests.status = 'pending'` **and** `matching_status in ('exhausted', 'awaiting_consent', 'sourcing')`.

`needs_admin_review` is not required (SG-1, accepted). Every live producer sets it, so requiring it would change no current result. It would matter only for rows written another way (legacy or manual), and those should still be visible. SQL 134 asserts the invariant for every live producer.

| ID | Excluded | Why |
|---|---|---|
| X-1 | Any `status` other than `pending` (cancelled, completed, and so on), even with `exhausted` and the flag still true | Cancellation leaves both. These requests no longer need a provider |
| X-2 | `awaiting_match` | No search has finished. This includes `rematch_failed` requests (pending, `awaiting_match`), which offers at other terms already lists |
| X-3 | `offered` with a pending offer, **including one past `expires_at` that nothing has settled** (SG-4) | It is still an offer. See §7 |
| X-4 | `matched`, `awaiting_terms`, `awaiting_homeowner`, `quote_pending` | A provider or the quote path holds the request |

## 4. Kinds, plan visits and legacy rows

Each item has a `kind`:

| `kind` | From | Operator meaning (not customer copy) | Admin label (proposal) |
|---|---|---|---|
| `exhausted` | P-1, P-2, P-3, P-5 | Matching ended with no provider who accepted | "No provider accepted" |
| `awaiting_consent` | P-4 | A candidate exists; the homeowner has not consented to a fallback provider | "Awaiting fallback consent" |
| `legacy_sourcing` | P-6 | Set by the superseded matcher. Its own kind | "Legacy sourcing" |

- **`awaiting_consent` (SG-8, accepted).** A distinct consent-wait kind, **not exhausted supply**. A candidate exists, so the label, the description and any copy must not say or imply that no provider is available. It is never counted as, merged with or relabeled `exhausted`.
- **Legacy rows (SG-5, accepted).** `legacy_sourcing` stays a distinct kind. It is never relabeled `exhausted` or merged into a count of current exhaustion. The rows are shown so the queue is honest about what is stored. The number on hosted is unknown. If the owner wants it before implementation, one read-only count is enough: `select status, count(*) from public.service_requests where matching_status = 'sourcing' group by status` (counts only; not run, needs authorization).
- **Plan visits (SG-6, revised).** Each item carries `plan_visit`, true exactly when `service_requests.recurrence_parent_id is not null`, the test the live matcher and `record_job_operation` use. It applies to every kind: a plan visit can be `exhausted` through the matcher (P-1, plan provider not eligible) or through P-5. The admin label is "Plan visit: plan's provider only". It is information only. **No reassignment authority is added:** no new command, no change to `create_job_offer` or matcher eligibility, and no control on the page.

## 5. Related-event time (SG-2, revised)

No time the request entered this queue is stored (AC-1 L-4), and `updated_at` moves on any later write. The reader therefore does not report one. It reports the time of the **latest related stored event** and names which event it is. That time is not a sourcing-entry time, an exhaustion time or a bound on either, and nothing may present it as one.

Fields: `related_event_at` and `related_event` (revision 1's `since` and `since_basis` are dropped, because "since" reads as an entry time).

| `related_event` | Stored timestamp, exactly | Admin label (proposal) |
|---|---|---|
| `provider_operation` | Latest `job_operations.created_at` for the request with `kind in ('provider_cancel', 'no_show')`. It records when the operation was recorded. A `no_show` row may be a report that did not remove the provider (only an admin's confirmation does) | "Provider cancel or no-show recorded" |
| `offer_closed` | Latest closing time over the request's `job_match_attempts` with `outcome in ('declined', 'expired', 'withdrawn')`. An attempt's closing time is `greatest(declined_at, withdrawn_at, responded_at)` (`greatest` ignores nulls). For `expired`, this is when something processed the expiry (`responded_at`), not the offer's `expires_at`. A withdrawal by `record_job_operation` sets only `withdrawn_at` | "Offer last closed" |
| `request_created` | `service_requests.created_at` | "Request created" |

**Choice and ties.**

1. Take the latest of the `provider_operation` and `offer_closed` times that exist.
2. If both exist and are equal, `related_event` is `provider_operation`. They are equal in P-5, because the operation row and the attempt's `withdrawn_at` take the same transaction `now()`.
3. If neither exists, `related_event` is `request_created`.
4. Item order: `related_event_at` ascending, then `request_id` ascending (PostgreSQL `uuid` order). The client keeps the server's order and does not re-sort.

- `accepted` attempts are not closing events: their `responded_at` is the acceptance time. An accepted attempt later withdrawn counts through its `withdrawn` outcome.
- Not used: `updated_at` (moves), `assigned_at`, `match_expires_at` (cleared), `last_match_expired_at` (set only by `expire_stale_matches`), `offer_terms_blocks.created_at` (only P-2; used for the cross-reference in §6).
- **Copy rule.** The page shows "Latest related event" with the label and the time. It never says "since", "waiting since", "entered sourcing", "exhausted at", "at least" or "lower bound", and shows no duration or age. No `aged`, no due time (OD-6). The order is described as "by latest related event", never as "longest waiting first".

## 6. Overlap with offers at other terms (SG-3, accepted)

While the gate is off, P-2 writes a block for **every** one-time exhaustion outside E5, even with no gate-skipped candidates. `admin_offer_terms_queue` lists each such request as `blocked_inactive` (pending, `exhausted`, latest block not followed by a retry). So with the gate off, most one-time exhausted requests are in both queues.

**Ruling: overlap is allowed.** The request is listed in both. The sourcing item carries `offer_terms_block`, true exactly when `admin_offer_terms_queue` would list the request as `blocked_inactive`: the same latest-block and no-later-retry condition, read from the same tables. SQL 134 asserts that the two readers agree both ways.

**The queues are never summed as unique requests.** Each overview row equals its own reader. No total of requests, or of open work across queues, is computed or shown on the overview, on the sourcing page or anywhere else in this slice. The same request can also appear in other lists: a P-5 withdrawal opens a support ticket, which the support queue counts as a ticket. The sourcing page says, per item, "Also in Offers at other terms" when `offer_terms_block` is true.

## 7. Expired offers (SG-4, accepted)

Excluded (X-3).

- A pending offer past `expires_at` is settled only when something calls the matcher or `expire_stale_matches`. Today that is `/admin/requests`, the homeowner dashboard and the vendor jobs page on load (each a write through RPC), or a lifecycle batch, whose scheduler is inactive.
- **Neither the reader nor the sourcing page settles anything.** The reader is `STABLE` and HQ-2 runs it inside a `READ ONLY` transaction. The page calls no RPC except the reader (§8.3).
- A request whose last offer has lapsed but is unsettled appears only after something else settles it. The count reflects **stored matching state**, and the description says so (§11.1).
- A separate "offers past their deadline" count belongs to T-1 / Q-01's offer side, not to this slice.

## 8. Reader, summary, list page and client (proposal)

### 8.1 Migration

One additive, function-only migration (`20261206001000`, provisional):

- `public.admin_sourcing_queue()`: `STABLE`, `SECURITY DEFINER`, `search_path = ''`, guarded by `private.require_admin()` (admin, `42501`). Execute revoked from `public`, `anon`, `service_role`, granted to `authenticated`.
- `public.admin_operations_summary()` restated from `20261205001000` with one change: `('sourcing', 'items', null)` appended **after `applications`**, inside the same per-queue error isolation. Finance exceptions stay last (SG-7).

### 8.2 Response shape

```
{
  "checked_at": timestamptz,
  "items": [
    {
      "request_id":       uuid,
      "kind":             "exhausted" | "awaiting_consent" | "legacy_sourcing",
      "related_event_at": timestamptz,
      "related_event":    "provider_operation" | "offer_closed" | "request_created",
      "plan_visit":       boolean,
      "offer_terms_block": boolean
    }
  ]
}
```

Ordered as §5 item 4. No customer, address, ZIP, service, price, provider or candidate field. `offer_terms_blocks.candidates` is not returned.

### 8.3 Sourcing list page (SG-7, revised)

A minimal, read-only page at `/admin/sourcing`. The overview's `sourcing` row links here, not to `/admin/requests`: that page's badges are defined differently and it writes on load.

- **Reads:** one `admin_sourcing_queue` call on open and one per press of a Refresh control. No other RPC or table read. In particular, no `expire_stale_matches`, no matcher, no `find_eligible_packages`. The admin shell's existing `has_role` check is unchanged.
- **No business writes** on open or refresh: no insert, update or delete in any table (§9, §10).
- **Shows:** the OD-4a name and description; `checked_at`; per item the request id, the kind label (§4), "Latest related event" with its label and time (§5), the plan-visit label when `plan_visit`, and "Also in Offers at other terms" when `offer_terms_block`. Empty state: "No requests in this queue." Error state for a failed read, with a `42501` message for a non-admin.
- **Has no controls** other than Refresh: no offer, assign, consent, settle, retry or cancel action, and no per-row link (SG-9).
- No sidebar entry in this slice; the page is reached from the overview row (SG-9).
- Client: a parser `parseSourcingQueue` in `src/lib/` that rejects unknown `kind` or `related_event` values and malformed items, and a hook that holds the read. The page and the summary use the same reader, so the page's item count equals the overview count for the same database state.

### 8.4 Overview

`SUMMARY_QUEUES.sourcing` with the OD-4a name as `label`, `href: "/admin/sourcing"`, no `agedLabel` (the aged column shows "—"). No total row.

### 8.5 Mixed versions

`main`'s client drops a queue it does not know ([admin/page.tsx:55](../src/app/admin/page.tsx#L55)), as 7.5G-1 showed. The previous deployment works on the new summary and has no `/admin/sourcing`, so `vercel promote` is a valid rollback.

## 9. Permissions and writes

| Check | Expected |
|---|---|
| Admin (owner) | Reads the queue and the page. The summary row is `ready` |
| Authenticated non-admin (homeowner, vendor) | `42501` from the reader; the summary refuses as today; the page shows its error state |
| `anon`, `service_role` | No execute on the reader |
| Reader writes | None. Measured with the transaction's `pg_stat_xact_all_tables` around two calls, as SQL 127 S7 does |
| Page writes | None. The browser test records every Supabase `rest/v1` request on open and on refresh: only `rpc/admin_sourcing_queue` and the shell's existing `rpc/has_role` (characterized first) are allowed |
| Exposure | Ids, kinds, times and two booleans only |

## 10. Tests and acceptance (planned)

**SQL 134 (new).** Fixtures reached through the real commands where one exists:

| Fixture | Through | Expected |
|---|---|---|
| No eligible provider, gate on | Matcher | `exhausted`, `request_created` |
| Gate off, one-time, no candidates (`[]`) and with gate-skipped candidates | Matcher | `exhausted`, `offer_terms_block` true, also in `admin_offer_terms_queue` |
| Same, after `admin_retry_offer_terms_matching` re-exhausts | Retry | `offer_terms_block` false once the retry is later than the block |
| Declined, then exhausted | `vendor_decline_job` → matcher | `offer_closed` = the attempt's `declined_at` |
| Expired in the matcher | Matcher after `expires_at` | `offer_closed` = the attempt's `responded_at` (processing time), not `expires_at` |
| E5 replacement closed after a provider cancel | `record_job_operation` → matcher | `offer_closed` or `provider_operation`, whichever stored time is later, per §5 |
| Provider cancel inside the search deadline | `record_job_operation` | `exhausted`, `provider_operation` (tie with `withdrawn_at` resolved to it) |
| Plan visit, provider cancel | `record_job_operation` | `exhausted`, `provider_operation`, `plan_visit` true |
| Plan visit, plan provider not eligible | Matcher | `exhausted`, `plan_visit` true |
| One-time request | Any | `plan_visit` false |
| Fallback consent needed | Matcher | `awaiting_consent`; after `consent_to_provider_fallback` it leaves the queue |
| Legacy `sourcing` | Written as the owner in replica mode (no live producer; 7.5C method) | `legacy_sourcing` |
| Cancelled after exhaustion (flag still true) | Cancellation | Excluded |
| `awaiting_match`, `rematch_failed` | Matcher / decline failure | Excluded |
| Offer past expiry, unsettled | Direct `expires_at` in the past | Excluded, and still excluded after two reader calls; included only after `expire_stale_matches` exhausts it |
| Equal `related_event_at` | Two requests | Ordered by `request_id` |

Assertions: the exact item set; `kind`, `related_event_at`, `related_event` and `plan_visit` per fixture; the tie rule; order; `offer_terms_block` agreement with the offer-terms reader both ways; no `kind` other than the three; the invariant that every live producer sets `needs_admin_review`; `42501` for a non-admin; no `anon` or `service_role` execute; no writes; summary position (after `applications`, finance last), count parity and error isolation. SQL 127 S1 and SQL 129 R15 change **on purpose** (queue list, summary md5). The browser fixture is regenerated with `scripts/derive-operations-summary-fixture.mjs` and checked with `--check`.

**Mutations, each caught by a named test:** drop `status = 'pending'`; drop `awaiting_consent`; relabel `awaiting_consent` as `exhausted`; drop `legacy_sourcing`; merge `legacy_sourcing` into `exhausted`; include `awaiting_match`; include an offer past expiry; settle expired offers in the reader; take the time from `updated_at`; take an expiry's time from `expires_at`; count `accepted` as a closing event; drop `provider_operation`; reverse the tie rule; invert `plan_visit`; invert `offer_terms_block`; grant `anon` execute; drop the summary row; move it after finance.

**Client and browser:**

- Unit: `SUMMARY_QUEUES` key coverage; `parseSourcingQueue` accepts the shape and rejects unknown `kind`, unknown `related_event` and malformed items; label mapping for every kind and event, with no "since", "waiting", "at least" or "no provider" wording on `awaiting_consent`.
- Browser, overview: the `sourcing` row after Applications and before Finance, with label, count, "—" for aged, and link to `/admin/sourcing`; no total row.
- Browser, page: items in server order with labels, plan-visit and cross-reference markers; empty, error and non-admin states; no controls other than Refresh; every Supabase request on open and on refresh is `rpc/admin_sourcing_queue` or `rpc/has_role`. A mutation that makes the page call `expire_stale_matches` fails it.
- Old-client compatibility; clean replay; full SQL suite; fingerprints unchanged except the two functions; money fingerprint unchanged; typecheck, lint, secret scan, production build with CI's synthetic environment.

## 11. Decisions

### 11.1 Owner

| ID | Decision | Needed before | Recommendation (not approved) |
|---|---|---|---|
| **OD-4a** | Operator-facing name and description of the queue. **Approved 2026-11-27 ET as recommended (§11.4, DEC-2026-070)**; the recommendation column is kept as written | Implementation | **Name:** "Sourcing". **Description:** "Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state." Admin pages only (overview label, page heading and description). No customer copy changes. **Not approved**; the owner may choose other wording |
| OD-4b | A "sourced" outcome | Any liquidity measure | Unchanged: option (a), none in beta |
| OD-6 | A sourcing deadline | Any `aged` or due time | Unchanged: none until the pilot baseline |
| — | Optional read-only legacy `sourcing` count (§4) | Implementation, if wanted | Counts only |

Revision 1's proposed description ("No provider has accepted; no deadline is set. Counts are as stored.") is withdrawn: it does not fit `awaiting_consent` (SG-8).

### 11.2 Codex rulings (conversation review, 2026-11-27 ET; not a GitHub review)

| ID | Question | Ruling | Where applied |
|---|---|---|---|
| SG-1 | Require `needs_admin_review` at entry? | **Accepted:** not required | §3 |
| SG-2 | Timestamps | **Revised:** they describe related events, not proven sourcing-entry times. No "lower bound" or exact-exhaustion-time claim. Name each timestamp's actual basis; define deterministic ties | §5, §8.2, §10 |
| SG-3 | Overlap with offers at other terms | **Accepted:** allowed, with tested cross-references. Never sum the queues as unique requests | §6, §10 |
| SG-4 | Expired offers | **Accepted:** unsettled expired offers excluded; the reader must not settle them | §3 X-3, §7, §10 |
| SG-5 | Legacy `sourcing` | **Accepted:** remains a distinct kind | §4 |
| SG-6 | Plan visits | **Revised:** return `plan_visit` so operators can tell visits restricted to the plan's provider. No reassignment authority added | §4, §8.2, §8.3 |
| SG-7 | Summary position and link | **Revised:** row after `applications`, before finance. Link to a minimal read-only sourcing list backed by the same reader, not the differently defined generic requests list | §8.1, §8.3, §8.4 |
| SG-8 | `awaiting_consent` | **Accepted:** included as a distinct consent-wait kind, not exhausted supply | §4, §11.1 |

Opening or refreshing the list performs no business writes (Codex, with SG-7). §8.3, §9, §10.

### 11.3 Open for Codex

| ID | Question | Proposal |
|---|---|---|
| SG-9 | Per-row link and sidebar entry for `/admin/sourcing` | Neither in this slice. The only request page today, `/admin/requests?request=<id>`, calls `expire_stale_matches` on load, so a row link would lead straight to a page that settles offers. A later slice can add a read-only request view or a sidebar entry |

*Kept as written. SG-9 is now accepted (§11.4).*

### 11.4 Decisions recorded 2026-11-27 ET (owner instruction for 7.5G-2 implementation)

**OD-4a: approved by the owner (Josh), 2026-11-27 (America/New_York).** Recorded as [DEC-2026-070](DECISION-LOG.md) and verbatim in [OWNER-APPROVALS](OWNER-APPROVALS.md) ("Phase 7.5G-2 sourcing queue name — 2026-11-27"). The approval text:

> I approve the admin-only name "Sourcing" and description:
> "Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state."
>
> Record this approval with the actual date. It does not decide OD-4b, eligible-provider definitions or sourcing deadlines.

- **Settles:** the admin-only queue name "Sourcing" and the description above, exactly, for the overview row label, the `/admin/sourcing` heading and its description. No customer copy.
- **Does not settle:** OD-4b (a "sourced" outcome; recommendation (a) unchanged), any eligible-provider definition or count (OD-3, C-3), or a sourcing deadline, `aged` rule or due time (OD-6). The kind and event labels in §4 and §5 stay implementation proposals for Codex, not owner wording.

**Codex technical review (relayed by the owner in the same instruction; not a GitHub review):** "Revision 2 of #219 at `ed209ae` is technically clear." **SG-9 accepted:** no per-row links and no sidebar entry in this slice. The overview row links to `/admin/sourcing`.

**What the instruction authorizes:** local implementation, tests, commits, pushes and PR creation, on a branch stacked on this plan's head while #219 is open, retargeted to `main` after the plan merges. **Not authorized:** hosted queries or pushes, merge (of this plan or the implementation), deployment, production scans or purges, email activation, a scheduler, matching changes, booking or payments. The optional legacy `sourcing` count (§4) is a hosted query and was not run.

**Base after the decision.** `main` `d47b0f4` (#216 merged) was merged into this branch before recording the decisions; it touched only the 7.5G-1 record, TRACE-159 and the handoff.

## 12. Rollout and rollback

Codex review of this revision, then the owner's OD-4a decision, then implementation in a separate PR. Then a dry run listing only the new migration and the push, both before merge and owner-authorized (DEC-2026-037). Then merge (deploy), a READY readback, and HQ-1/HQ-2 extended to the `sourcing` row: one `REPEATABLE READ READ ONLY` transaction, as in the [7.5G-1 record](PHASE-7-APPLICATIONS-REVIEW-QUEUE-7-5G-1.md) §8.6 step 5 with one more `readers` line. A manual check of `/admin/sourcing` as the owner after deploy only reads. Rollback: `vercel promote` of the previous deployment (no `/admin/sourcing`; the unknown summary row is dropped); the database rolls forward with a migration restoring the `20261205001000` summary body. No data is written at any step.

*Dated note (2026-11-27 ET, §11.4):* Codex review of revision 2 and the OD-4a decision are done. The implementation is a separate PR stacked on this plan's head, retargeted to `main` once this plan merges, and its record carries the exact later rollout steps. Neither this plan nor the implementation is merged under that instruction.

## 13. Validation of this plan

- Documentation only: this file, a dated note in the [7.5G plan](PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md) §6, and a handoff entry. TRACEABILITY is left to #216, which edits the TRACE-159 row.
- `git diff --check`, relative-link existence, `npm run scan:secrets`, and a merge-tree check that #216's head still merges cleanly: results in the PR body.
- No hosted read or write.
- *Dated note (2026-11-27 ET, §11.4):* the decision update adds §11.4, the status line, a DEC-2026-070 entry, an OWNER-APPROVALS section and a handoff entry. #216 has merged (`d47b0f4`) and is merged into this branch. TRACEABILITY's TRACE-159 row is updated by the implementation PR.
