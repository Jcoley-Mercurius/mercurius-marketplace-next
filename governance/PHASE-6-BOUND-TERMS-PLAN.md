# Phase 6 bound-terms plan: CS-4 (TRACE-127), CS-3 (TRACE-126) and the one-time CS-5 extension

**Status:** PLAN FOR CODEX REVIEW, 2026-11-05 (America/New_York). **Nothing here is implemented.** No money function, migration or test has changed. CS-4 and CS-3 each change fingerprinted money functions. Each waits for (1) Codex to clear this plan, (2) the reading in §2 R-1, (3) implementation and a Codex code review, (4) the two-person finance review (Josh + the accountant, not yet engaged, DEC-2026-060) and (5) the owner's authorization for the hosted dry run and push, before it merges. This is not Phase 6 acceptance.

*2026-11-06: Codex cleared the architecture with five required amendments, and the owner confirmed R-1 (DEC-2026-062). Both are recorded in §7, which governs CS-4 where it differs from §2–§3. CS-4 is implemented for review as TRACE-148. CS-3 is not implemented. The text above is kept as written.*

*2026-11-06 (later): CS-4 (#149) was merged into the closeout branch, now PR #150 to `main`, with no recorded Codex code review or finance review. CS-3 is implemented for review as TRACE-149 (§8); Codex hasn't reviewed §4 or R-2 to R-5. §8 records a finding that changes R-3 (F-C1) and an owner decision (O-10).*

*2026-11-07: #150 merged to `main` (`98fe138`, deployed) with CS-4, and `20261115001000` is on hosted. #151 merged into the closeout branch after that branch had gone to `main`, so CS-3 is **not** on `main` and `20261116001000` is not on hosted. O-10 option (a) with requirements is recorded as DEC-2026-063, **proposed** (no owner confirmation is recorded). §9 records the reconciliation and the proposed O-10 repair for Codex. Nothing in §9 is implemented.*

**Base:** `main` `cbd65a7` (#146). Branch `claude/phase6-closeout-a1-packet`. *2026-11-06: `main` is `02e04a0` (#147 merged).*

**Governing answers:** DEC-2026-060 D-2 (a) "a visit offered at bound terms may be accepted at those terms after a catalog change" (CS-4); D-1 (a) "a one-time fixed request's agreed price is the tier revision and price bound at submission, as visits have been since 6.6c" (CS-3); D-4 (DEC-2026-050 A): start only when paid, with the operator exception, one-time jobs after CS-3. Also: DEC-2026-049 item 6 (bound visit terms, live eligibility refusals kept, no substitution or repricing); items 7–8 stay blocked; DEC-2026-034 (agreed prices unchanged); DEC-2026-039 item 2 and DEC-2026-055 item 2 (in-use versions become new revisions, never rewritten); DEC-2026-041 item 2 (add-ons are part of the commercial source); DEC-2026-042 (matching keeps the priced selection).

## 1. Characterization (synthetic, rolled back)

Probe: [`review-evidence/trace-126-127-bound-terms-probe.sql`](review-evidence/trace-126-127-bound-terms-probe.sql), with results in [`trace-126-127-bound-terms-probe.txt`](review-evidence/trace-126-127-bound-terms-probe.txt). It reuses SQL 097's fixtures and makes each catalog change through the real vendor command `vendor_save_package`, **not** owner maintenance. Run on a clean replay of `main` `cbd65a7` (218 migrations; full suite 103 files / 6,546 PASS; fingerprint `45 | 34c51131…`).

| Case (after the plan provider saves its live weekly version) | Price change 40 → 44 | Rename only |
|---|---|---|
| Offered visit **with** an add-on: provider accepts | refused `22023` "Provider is no longer eligible" | refused, same |
| Offered visit **without** add-ons: provider accepts | refused, same | refused, same |
| Offered one-time request: provider accepts | refused, same | refused, same |
| Accepted, published, **unpaid** visit: payment state, checkout | `review_pending / package_unavailable`; checkout refused "The plan's package or price level is no longer offered (paused, replaced or removed)." | same |
| Paid visit: start gate (CS-5) | startable | startable |
| Accepted one-time request: checkout source | refused "Selected offering is not eligible" | same |
| New visit on the plan | blocked (the existing changed-terms safeguard) | not run |
| Stored request amounts, offers | unchanged; offers stay pending | unchanged |

Findings:

- **F-B1. Since 6.11A every catalog change to a bound version is a replacement.** A version that is live or in use can't be edited in place on any application path (TRACE-134). A vendor or operator save makes a new revision and pauses the old one in the same transaction, and that includes a rename. The in-place "KNOWN EXPOSURE" cases in SQL 023/082/087/095–097 are now reachable only under owner maintenance. The live failure is the replacement.
- **F-B2. TRACE-127 is wider than recorded.** It is not limited to add-on visits. `vendor_accept_job` requires the offer's exact `package_id` in `find_eligible_packages_core`. That core matches a request with add-ons or a promotion only at its bound revision hash, and otherwise uses the live candidate pool, which excludes a paused package. Either way, a replaced bound row is refused. An offered one-time request is refused the same way.
- **F-B3. Acceptance alone doesn't deliver D-2.** After a replacement, an already accepted visit is unpayable: `recurring_visit_source_check` returns `package_unavailable` when `not p.is_active`, and `resolve_package_tier_price` (which it also calls) requires `is_active`. Fixing acceptance alone would move a visit from "offered, can't be accepted" to "accepted, can't be paid". DEC-2026-049 item 6 says "later package or tier edits neither change the amount nor force a review at a new price", but it also keeps the live refusal "package offered". Since F-B1, the strict reading of "package offered" turns every save into a payment block (§2 R-1).
- **F-B4. Lock order.** `vendor_save_package` locks the provider row (`FOR NO KEY UPDATE`), then the package and its lineage, then writes child rows. `money_source` share-locks package and tier rows first and the provider row last, in both its visit and one-time branches. Its one-time branch also starts with table `SHARE` locks on `package_promotions` and `package_qualifying_questions`, which a save's child-row writes need in `ROW EXCLUSIVE` mode. Those are opposite orders. A forced-order demonstration is in §1.1. The deadlock recorded in TRACE-126 (a tier edit locks the tier, then its package, while checkout locks package then tier) is no longer reachable on application paths for in-use rows: the version guard refuses the tier update before the row is locked. It remains reachable under owner maintenance only.
- **F-B5. What holds.** Nothing is repriced or substituted. Offers stay pending. New visits are still blocked by the changed-terms safeguard. A paid visit stays startable. Since 6.11A, a package row named by a request, offer or plan is immutable, so `package_id` + `package_tier_id` already identify an immutable bound revision. The bound terms can be read from those rows without any new evidence store.
- **Hosted (read-only aggregate, 2026-11-05):** 0 open requests, 0 open visits, 0 money obligations, 0 snapshots, 0 recorded plan terms. No live record is exposed, and no hosted record lacks submission evidence.

### 1.1 Lock-order demonstration

Script [`trace-126-127-lock-order.sh`](review-evidence/trace-126-127-lock-order.sh); output [`trace-126-127-lock-order.txt`](review-evidence/trace-126-127-lock-order.txt). Two sessions on committed synthetic rows on the isolated stack, which was reset afterwards. Session A takes checkout locks in a given order and pauses for 3 s; session B runs the real `vendor_save_package` on the same package 1 s in.

| Session A order | Result |
|---|---|
| Current visit branch: tier → package → provider | **deadlock detected** (A aborted "while locking tuple … in relation contractors"); B saved revision 2 |
| Current one-time branch: table `SHARE` on promotions and questions → package → tier → provider | **deadlock detected**, same; B saved |
| Proposed R-5: provider → package → tier | no deadlock; A committed, then B saved |

The real `money_source` takes these locks in one statement, so the window is narrower than in the forced demonstration, but the orders are the ones it uses. A deadlock aborts one transaction and leaves no wrong data. It does fail a homeowner's checkout or a vendor's save. CS-4 (visit branch) and CS-3 (one-time branch) each adopt R-5, and the concurrency script repeats this check against the real functions.

## 2. Readings needed before implementation (Codex; owner confirmation where marked)

| # | Question | Recommended | Alternative | Why it matters |
|---|---|---|---|---|
| **R-1** (owner confirms) *Confirmed 2026-11-06, DEC-2026-062* | After 6.11A, what does DEC-2026-049 item 6's live refusal "package offered and not under review" require? | **The offering is still offered:** the bound revision's lineage has a live revision for the same provider and service, priced as fixed, not held in Package Reviews, that still offers a level at the visit's cadence. Price, level, add-ons and questions always come from the bound row and terms, never from the live revision. A paused, archived or removed lineage (no live revision), or a live revision held in review, still refuses with the existing named exception. | **Strict:** the exact bound row must be live. Then every save, including a rename, blocks payment for every unpaid visit of that plan, and CS-4 changes nothing on a real journey (F-B1, F-B3). | It decides whether a bound visit is payable, so it is a money rule, not only a code reading. Recommended owner wording: *"A visit or request priced at bound terms stays acceptable and payable at those terms while its provider still offers that service at that cadence (a live, unreviewed revision of the same offering). Pausing, archiving or removing the offering, or holding it in Package Reviews, still blocks it."* |
| R-2 | Does the one-time offered-acceptance refusal (F-B2, one-time row) belong to CS-3? | **Yes.** D-1 binds the one-time price at submission, so accepting a one-time offer at bound terms is the same rule. CS-3 owns it, behind the same finance gate. | A separate slice | Without it, an offered one-time request can't be accepted after any save, even once CS-3 has fixed checkout. |
| R-3 | A one-time request accepted by a different provider than the one priced at submission (fallback offer) | **Refuse checkout with a named reason**, "This request's agreed price wasn't recorded for this provider; it needs a new request or quote". No repricing and no fabricated terms. The rule for fallback pricing stays with the owner. | Treat the accepted offer as the binding (a new rule: owner) | Submission evidence (`pricing_inputs`) covers only the submitted package. `vendor_accept_job` overwrites the request's package and price from the accepted offer. Hosted: 0 such requests. |
| R-4 | Evidence version for the one-time source | **New `commercial-v2:` prefix** for one-time evidence built from immutable bound fields, replacing the `to_jsonb()` package and tier row dumps (they carry `is_active`, `updated_at` and `needs_review`, which change on replacement). Visit evidence keeps `commercial-v1`. | Keep `commercial-v1` | A source hash changes for every one-time request. 0 hosted snapshots, so no stored snapshot changes meaning. |
| R-5 | Lock order | **One canonical order for every reader of bound terms**, matching the writers: provider row → package rows (bound row, then the lineage's live revision) → tier rows → catalog service → coverage → provider ZIP. The one-time branch's table `SHARE` lock on `package_qualifying_questions` becomes a row share of the bound package's questions, taken after the package. Bound questions are immutable, so the table lock no longer protects anything a save can change. `package_promotions` keeps its table lock, taken first as today: vendors can't write it since 6.11A, and an operator write doesn't lock a package first. | Keep current orders and add a retry | F-B4. A deadlock aborts with no wrong data, but it fails a homeowner checkout or a vendor save. |

## 3. CS-4 (TRACE-127), recurring visits

**Scope.** An already-offered recurring visit is accepted and paid at the plan terms bound to its creation after a catalog change, subject to the live checks in DEC-2026-049 item 6, read per R-1. Unchanged: new-visit creation (changed-terms safeguard), the plan's own acceptance, one-time requests (CS-3), the replacement-provider path (item 8, blocked), and quote-priced and promotional visits (item 7, blocked).

| Function | Fingerprinted | Before | After |
|---|---|---|---|
| new `private.bound_offering_problem(p_package uuid, p_tier uuid, p_frequency text) returns text` | **added to the list** | — | Null when the bound rows are structurally intact (exist, tier belongs to package, fixed, tier price > 0, all levels priced) and the lineage is offered (R-1). Otherwise `package_in_review` or `package_unavailable`. Reads only; no `is_active` requirement on the bound row. |
| `private.recurring_visit_source_check` | yes, restated | `package_unavailable` when `not p.is_active` or `resolve_package_tier_price(p, tier)` is empty; `package_in_review` from the bound row's flag | Both codes come from `bound_offering_problem`. Every other branch and code, and the price (from the terms), unchanged. |
| `public.vendor_accept_job` | no (recommend adding it, since it writes `resolved_price`/`total_amount`) | Every acceptance requires the offer's package in `find_eligible_packages_core` | **Visit branch only** (`recurrence_parent_id` set and not the replacement path): the offer must equal the visit's bound terms (plan provider, package, level, `base_price = visit_price`, `effective_price = visit_total`). Live checks: `vendor_matching_eligible(provider)` (kept: no widening of provider eligibility), provider active and listed, service, coverage, provider ZIP, promotion refusal, and `bound_offering_problem`. Refusal text unchanged ("Provider is no longer eligible"). Locks per R-5 before the check. Plans and one-time requests: unchanged. |
| `private.find_eligible_packages_core` | yes | — | **Not changed.** Matching and new visits keep their behavior. |
| `private.money_source` (visit branch) | yes, restated | locks attempts → tier → package → provider → catalog → coverage → ZIP | Same locks in the R-5 order, plus a share lock on the lineage's live revision. Evidence and price unchanged (visit `commercial-v1` hashes are identical before and after for an unchanged visit). |

**Concurrency** (new `scripts/bound-terms-concurrency.mjs`, CI step):
C1 acceptance vs. vendor save, both orders: either accepted at bound terms or refused because the lineage is no longer offered; never another price.
C2 the same offer accepted ×6: one acceptance.
C3 visit checkout vs. vendor save (forced order, §1.1): no deadlock.
C4 snapshot publication vs. save.
C5 acceptance vs. vendor pause of the lineage, and vs. an operator archive.
C6 acceptance vs. provider suspension (DEC-2026-061 now sets `is_active = false`).
C7 acceptance after the offer expired: refused as today.

**SQL (new SQL 114):** visit with and without add-ons, × change type (price save, rename save, add-on price change, lineage paused, lineage archived, successor held in review, provider suspended, coverage off, provider ZIP removed, service inactive, package promotion enabled), × acceptance, payment state, publication, checkout, start gate. Checks: amounts and source hash unchanged; other provider, homeowner and anonymous refused; replay. SQL 097's "existing rule (unchanged)" assertion becomes the D-2 expectation. 095–097 in-place cases are kept as maintenance-only characterization.

**Migration:** one additive migration (next free version after `20261114001000`): create the helper, restate the three functions with the same signatures and grants. No table, column or grant changes. `scripts/promotion-money-fingerprint.sql` adds the helper (and `vendor_accept_job` if Codex agrees). Before: `45 | 34c51131…`; the after value is recorded at implementation, with each changed function named.

**Compatibility and rollback:** no client change. `/vendor/jobs` calls `vendor_accept_job(_job_id)` with the same signature, and refused cases keep their text. The deployed client works on the new schema. Rollback is a forward migration restating the previous definitions; the migration writes no data. Hosted has 0 visits, so the push changes no live outcome.

## 4. CS-3 (TRACE-126), one-time fixed requests

**Scope.** A one-time fixed request is accepted (R-2) and checked out at the level and price bound at submission, after a catalog change, with the same live checks (R-1). Unchanged: published snapshots, explicit homeowner checkout, two-person publication, idempotency, fee (15% / 7.5%), tax, tips, promotion refusals and allocation, ledger postings, quote requests.

**Submission-time evidence (already created; nothing new is stored):** `submit_service_requests_core` writes `pricing_inputs` (pricing-v2: package, lineage, revision number, revision hash, frequency, answers, priced time, plus level, lines and `total_cents` when exactly priced) and `package_tier_id` / `total_amount`. Since 6.11A the named package row is immutable once in use, so the revision hash recorded at submission still equals `package_revision_hash(bound row)`. CS-3 **validates** that equality instead of trusting it.

| Function | Fingerprinted | Before | After |
|---|---|---|---|
| `private.money_source` (one-time fixed branch) | yes, restated | Price `t.price` from the current tier row; requires `p.is_active` and `resolve_package_tier_price`; evidence embeds `to_jsonb(p)`, `to_jsonb(t)` and question rows; add-on path compares the stored revision with the current hash | Bound record = `package_id`/`package_tier_id`, cross-checked against `pricing_inputs` (package, revision hash, frequency, `total_cents` when present) and `total_amount`. Price = bound tier price. Add-ons re-priced from the bound row's content (`price_selection`, unchanged). Live checks: provider active and listed, service, coverage, provider ZIP, answers, promotion refusals, and `bound_offering_problem`. Evidence = immutable fields (R-4). **Missing or mismatched evidence** (no pricing-v2 record, a different package (R-3), a hash mismatch) → refused with a named reason; nothing fabricated. |
| `public.vendor_accept_job` (one-time branch, R-2) | see §3 | as §3 | The offer must match the request's bound package and level at the submitted price; same live checks. |
| promotion, split, snapshot, payable, ledger functions | yes | — | **Not changed** |

**Concurrency:** C3 (checkout vs. save, forced order), C8 checkout ×6 with one key → one attempt, C9 publication vs. save vs. checkout, C10 acceptance vs. save.
**SQL (new SQL 115):** bound price across price save, rename, add-on change, lineage pause/archive/review, provider/coverage/ZIP/service changes, promotion; missing evidence; fallback provider; stale and changed payloads; cross-role. Updates the "KNOWN EXPOSURE (one-time)" assertions in SQL 097, and SQL 104's TRACE-126 assertion, to the D-1 expectation. In-place maintenance cases are kept as characterization.
**Fingerprint:** `money_source` restated; before/after recorded with the reason.
**Migration, compatibility, rollback:** as §3. One additive migration, ordered after CS-4's because it reuses the helper. Checkout and publication signatures are unchanged.
**Finance gate:** the two-person review (Josh + the accountant) before merge (DEC-2026-060). Codex can review the plan and the code before then.

## 5. CS-5 one-time extension (dependent; after CS-3 merges)

DEC-2026-050 A for one-time jobs: start only when paid (captured ≥ the reviewed snapshot total). Operations may start a job that is ready but unpaid, processing, failed or unknown, with a recorded reason. A held, terms-blocked or unreviewed job never starts. Payout still needs full capture.

- `private.fulfillment_payment_state` reports only `no_obligation`, `unpaid`, `partial` or `paid` for one-time jobs. The slice adds a one-time state that maps to the six approved states, using the existing shared G6 classification (`money_payment_exceptions`) and the CS-3 source check, so terms-blocked has one meaning. No new money semantics.
- `guard_fulfillment_start` gates one-time jobs with the same refusals. `admin_start_visit_payment_exception` is extended to one-time jobs (or a sibling command): same keyed, append-only, same-transaction exception.
- **Codex to confirm:** custom-quote jobs fall under "one-time jobs". No quote can be approved while tax is pending (closure report Q-1), so after this slice no quote job can start. That matches "paid-only", but it should be stated.
- Evidence: SQL 098 one-time cases ("one-time jobs are not gated until TRACE-126") rewritten; cross-role; concurrency of start vs. capture event.

### 5.1 Implementation record (TRACE-145, 2026-11-09; awaiting Codex review)

Branch `claude/phase6-cs5-one-time-start-gate`, stacked on the A1-F01 branch (#157). Migration `20261120001000_phase6_cs5_one_time_start_gate.sql` (additive; nothing applied is edited).

- **Payment state.** `private.one_time_job_payment` classifies a one-time job into the six approved states. It uses the same order as `recurring_visit_payment` and the same shared G6 classification (`money_payment_exceptions`):
  1. `paid` (captured ≥ snapshot total);
  2. `unknown` (unresolved or partial capture);
  3. `processing` (open checkout);
  4. `review_pending`, with `held` (dispute or refund), `source_blocked`, `no_snapshot` or `snapshot_expired`;
  5. `failed`;
  6. `ready`.
- **Terms blocked.** `private.one_time_source_problem` uses the commercial source's existing lock-free checks:
  - the accepted quote's validity (as `money_source`);
  - CS-3's `one_time_bound_problem` for the submitted offering;
  - O-10's `offer_terms_problem` for accepted terms;
  - otherwise `terms_missing`, the request `money_source` refuses by name.

  `money_source` itself isn't called, because it takes table share locks that a start must not take.
- **Every start path.** `guard_fulfillment_start` now gates one-time jobs as well as visits. It is a trigger on every update to `in_progress`, so it covers the provider's start, the operator's start, `transition_job_status`, the admin status change and rework restarts. A recurring plan row keeps its own guard.
- **Operator exception.** `admin_start_visit_payment_exception` now accepts one-time jobs. It writes the same keyed, append-only row in the same transaction. Ready, processing, failed and unknown jobs only; never held, terms-blocked or unreviewed. It now takes the request advisory lock and then the row before reading the state. The admin request view shows "Start without payment" on accepted, scheduled one-time jobs; the server decides.
- **Recorded at start.** `fulfillment_payment_state` reports the six states for one-time jobs (it was `no_obligation`/`unpaid`/`partial`/`paid`).
- **Money.** No money function changes. The fingerprint is `58 | af0fae6e0c5b604e9073e10bc060957e` before and after (local, clean replay). None of the new or restated functions is on the list.
- **Evidence (isolated stack, synthetic):**
  - Clean replay of 225 migrations: **109 files / 7,070 PASS**.
  - SQL 098 has new one-time cases:
    - each of the eight states;
    - the provider's refusal text for every unpaid state;
    - an operator's start, the lifecycle command and the admin status change are all refused;
    - exceptions for ready, processing, failed and unknown, each with its state recorded;
    - no exception for unreviewed, held or terms-blocked jobs, or for a plan;
    - replay;
    - a paid job starts with no exception recorded.
  - SQL 003 and 062 rework fixtures now use paid jobs.
  - Concurrency:
    - **C9**: start ∥ capture, both orders. On the previous guard C9 fails, because a start applies without payment.
    - **C10**: exception ∥ capture, both orders.
    - Fulfillment and admin A9 fixtures are now paid jobs.
    - All 37 locally runnable CI concurrency scripts pass. `test-lifecycle-integration.mjs` needs the edge-function server, so CI runs it.
  - Unit 664/664, typecheck, lint.
- **Decisions for Codex:**
  1. **Quote jobs count as one-time jobs.** No quote can be approved while tax is pending (closure report Q-1), so no quote job can be paid. Because it has no reviewed snapshot, it also can't get an exception. So no quote job can start.
  2. **Rework restarts are gated, as for visits.** Restarting work after rework on an unpaid job (one started under an exception) is refused. No exception exists for a restart, because the exception command starts only from `scheduled`.

## 6. Order and gates

1. Codex clears this plan, including R-1 to R-5. The owner confirms R-1 (and R-3 if the alternative is chosen).
2. CS-4 implemented on its own branch from `main`, then Codex code review.
3. CS-3 implemented on its own branch stacked on CS-4, then Codex code review.
4. Both need the two-person finance review before merge (Josh + the accountant, **not engaged**). Each migration is dry-run and pushed to hosted with owner authorization before its merge (DEC-2026-037).
5. CS-5 one-time after CS-3 merges.
6. The A2 human checks then run on the resulting candidate (closure report §9).

## 7. Codex plan review and owner confirmation (2026-11-06)

**Codex plan review (bounded).** Codex cleared the CS-4 architecture with five required amendments. This is a plan review only. It is not a code review, and it doesn't close any A1 row. **Owner:** R-1 confirmed in the owner's words (DEC-2026-062); this also sets the interpretation CS-3 will use, but CS-3 isn't authorized or implemented by it.

### 7.1 The five amendments and how CS-4 meets them

| # | Codex amendment | CS-4 design |
|---|---|---|
| 1 | `money_source` takes table `SHARE` locks on `package_promotions` and `package_qualifying_questions` before choosing its branch, so reordering row locks inside the visit branch alone isn't enough | `money_source` reads the request row first, then branches. **Visit path:** only `package_promotions` in `SHARE` (the visit check reads it). **No lock on `package_qualifying_questions`**, which the visit check never reads and package writers insert into after locking their package. **One-time and quote paths:** both table locks, unchanged. |
| 2 | Document the complete lock order, including callers, request and offer locks, provider, bound and live revisions, tiers and live-eligibility rows, against the actual writers | §7.2 |
| 3 | A price revision or rename that leaves the offering eligible must preserve acceptance, payment, bound amounts and visit source hashes. Concurrency tests mustn't treat a generic refusal as success | SQL 114 asserts success, not "no error", for each ordinary change (price, rename, add-on, two successive revisions): exact amounts, unchanged source hashes, checkout at the bound amount. The concurrency script fails on any refusal of an ordinary-edit race. Only unavailability races (pause, suspension, archive, provider suspension) may refuse, and only as "no longer eligible". |
| 4 | Explain rollback's business effect | §7.3 |
| 5 | Expand the money fingerprint to include `vendor_accept_job` and the new bound-eligibility helper; explain every changed definition and list addition | Added: `public.vendor_accept_job`, `private.bound_offering_problem` and `private.recurring_visit_offer_problem` (the rule set moved out of `recurring_visit_source_check`, which now calls it). The list grows from 45 to 48 functions. Every changed definition is explained in the CS-4 PR. |

### 7.2 Complete lock order

**Readers of a visit's bound terms**, in the order each takes locks:

| Caller | Order |
|---|---|
| `vendor_accept_job` (visit with bound terms) | advisory lock (job) → reads the pending offer (no lock) → `service_requests` row `FOR UPDATE` → `contractors` (plan provider) → bound `package_tiers` row → bound `vendor_packages` row → the lineage's live revision → `services_catalog` → `coverage_areas` → `contractor_service_zips`, each `FOR SHARE` → updates the offer rows and the request row it already holds → events and notices |
| `money_publish_snapshot` | finance checks → advisory lock (request) → `service_requests` `FOR UPDATE` → `money_source`: `package_promotions` table `SHARE` → accepted offer `FOR SHARE` → provider → bound tier → bound package → live revision → catalog → coverage → provider ZIP (`FOR SHARE`) → snapshot and obligation writes |
| `money_prepare_checkout` → `money_checkout_source_guarded` | advisory lock (request) → `service_requests` `FOR UPDATE` → `money_source` as above → checkout attempt writes |
| `money_preview_commercial_source` | advisory lock (request) → `service_requests` `FOR UPDATE` → `money_source` as above |
| `recurring_visit_payment`, the payment queue, `recurring_series` readback, the start guard | no locks (stable reads) |

**Writers whose locks these readers can meet:**

| Writer | Order | Against the readers |
|---|---|---|
| `vendor_save_package` | advisory lock (save key) → `contractors` `FOR NO KEY UPDATE` → source package → lineage rows (`NO KEY UPDATE`) → child rows of the **new** package (tiers, add-ons, questions) → publish: pause the old revision, activate the new one | Both take the provider row before any package row, so they serialize there. The reader's `SHARE` on promotions doesn't conflict (a save doesn't write promotions), and the reader no longer holds a questions table lock. |
| `vendor_set_package_active` (pause/publish) | `contractors` `NO KEY UPDATE` → package → lineage | provider row first, as above |
| `admin_publish_package_draft` | draft → `contractors` `FOR UPDATE` → target package → lineage → child inserts | provider row first |
| `admin_suspend_package`, `admin_archive_package`, `admin_clear_package_review` | one package row `FOR UPDATE` | holds a single lock, so it can't close a cycle |
| `vendor_decide_onboarding` (activate/suspend) | `vendor_onboarding` row → events → `contractors` update | readers never lock onboarding rows, so no cycle |
| Operator writes to `services_catalog`, `coverage_areas`, `contractor_service_zips`, `package_promotions` | single statement; no server function writes them | one lock each; a promotion insert takes only key-share on its package, which `FOR SHARE` doesn't block |
| Owner-maintenance tier edit (direct session only) | tier row → package row (review trigger) | readers lock tier before package, matching it |

The 2026-11-05 forced-order demonstration (§1.1) deadlocked because `money_source` took the provider row **last**. CS-4 takes it first on the visit path. The one-time branch keeps its order until CS-3.

### 7.3 Rollback: business effect, state check, recovery

Restoring the previous functions takes a forward migration that restates them. It writes no data, but it is **not harmless once bookings rely on CS-4**. Every visit whose bound revision was replaced would be judged by the strict rule again:

- offered visits can't be accepted;
- accepted, unpaid visits (published or not) become unpayable (`package_unavailable`), including any whose checkout is open;
- paid visits aren't affected: payment state checks capture first, and the start gate reads it.

**State check before any rollback** (read-only; run against the target database, results reported as counts only):

```sql
select count(distinct v.id) filter (where m.outcome = 'pending') as offered_visits_on_replaced_revision,
       count(distinct v.id) filter (where m.outcome = 'accepted' and coalesce(o.captured, 0) < coalesce(s.total, 1)) as unpaid_accepted_visits_on_replaced_revision,
       count(distinct v.id) filter (where a.status in ('prepared', 'session_created', 'reconcile')) as open_checkouts_on_replaced_revision
from public.service_requests v
join public.vendor_packages p on p.id = v.package_id and not p.is_active
join public.job_match_attempts m on m.service_request_id = v.id and m.outcome in ('pending', 'accepted')
left join public.money_obligations o on o.service_request_id = v.id
left join public.money_snapshots s on s.id = o.current_snapshot_id
left join public.money_checkout_attempts a on a.obligation_id = o.id
where v.recurrence_parent_id is not null and v.status <> 'cancelled';
```

**Procedure.** If every count is 0, a rollback changes no live outcome. If any count is above 0, **fix forward instead**. If the owner still orders a rollback, it needs that authorization. Operations then first resolves each counted visit individually under the existing recovery text: let open checkouts finish or expire and reconcile them; then handle the visit under the per-visit policy, or have the plan accepted again on current terms. Nothing is repriced or substituted. Application rollback (`vercel promote`) needs none of this, because CS-4 changes no client.

### 7.4 CS-4 implementation record (TRACE-148, 2026-11-06)

**Implemented for review.** Not merged and not pushed to hosted. Migration `20261115001000_phase6_cs4_visit_bound_terms.sql` is additive: two new private helpers and three restated functions with unchanged signatures and grants. It changes no table, column, grant or data.

**Changed definitions (fingerprint `45 | 34c51131…` on `main` → `48 | 88c9a260…`; the other 43 listed definitions are byte-identical):**

| Function | Change | Why |
|---|---|---|
| `private.bound_offering_problem` | **new**, added to the list | R-1: the bound package and level are structurally intact (exist, same provider and service, fixed price, level at the cadence, priced, exact price kind, not archived), and the lineage's live revision offers the cadence, isn't archived and isn't in Package Reviews. Returns `package_in_review`, `package_unavailable` or null. Never reads a live price as the visit's price. |
| `private.recurring_visit_offer_problem` | **new**, added to the list | The rule set `recurring_visit_source_check` applied, moved unchanged except that its last two branches call `bound_offering_problem`. One rule judges a pending offer (acceptance) and the accepted offer (payment). |
| `private.recurring_visit_source_check` | restated | Calls the rule set; its output is unchanged for any visit that passed before, so visit source hashes are unchanged (SQL 114, concurrency C4). |
| `private.money_source` | restated | Amendment 1: reads the request, then takes table locks by branch (visit: promotions only; others: both, unchanged). Visit row locks follow §7.2. The visit evidence and every one-time and quote path are byte-identical. |
| `public.vendor_accept_job` | restated, added to the list | A visit with bound terms is judged by `recurring_visit_offer_problem` on the row as acceptance leaves it (fields copied from the offer), plus `vendor_matching_eligible`. Refusal text is unchanged; the code goes in `DETAIL`. Plans, one-time requests, visits without bound terms and the replacement path keep the earlier check. |

**Choices for Codex's code review:**

1. **An archived bound revision blocks**, even while a successor is live. This is the conservative reading of "archiving … the offering". An operator archive marks history it no longer offers.
2. **The price-band ranking filter (≤ 1.25 × median) isn't applied** to a visit with bound terms. It reads the current price, and R-1 binds the price.
3. **Matching eligibility (`vendor_matching_eligible`: onboarding, compliance, listing exclusion) is checked at acceptance, as before, but not at payment**, which keeps the 6.6c payment rule unchanged. SQL 114 records both.
4. **A visit without bound terms** (pre-6.6a, no `created` generation) keeps the earlier matching check, so nothing is widened for it.
5. Acceptance doesn't take the promotions table lock. Payment re-checks promotions under it.

**Evidence** (isolated stack, synthetic):

- Clean replay of 220 migrations: full suite 105 files / 6,725 PASS. After `bound-terms-concurrency.mjs` committed and removed its fixtures, a clean reset and the full suite gave 6,725 PASS again.
- SQL 114: 148/148. SQL 097: 147/147 (its TRACE-127 assertion rewritten to the D-2 expectation).
- `bound-terms-concurrency.mjs` (C1–C8): PASS on 4 runs, with no leftover rows. The related concurrency scripts (recurring visits, cadence, recurring payment, fulfillment, exceptions, exception resolutions, vendor offerings, admin operations) all pass.
- On `main`'s schema, SQL 114 aborts at its first CS-4 check (helper missing), and the concurrency script fails at C1 round 2 with "Provider is no longer eligible".
- Unit 656/656, types, lint, secret scan.
- `vendor-offerings-concurrency.mjs` isn't a CI step on `main`; that predates CS-4 and is recorded here only.

**Deployment order (each step needs the owner's authorization):** Codex code review → two-person finance review (Josh + the accountant) → hosted dry run and push of `20261115001000` → merge. The deployed client works on the new schema (same signatures; `/vendor/jobs` reads only `error.message` and re-reads the row), so the push can precede the merge. Rollback: §7.3.

## 8. CS-3 implementation record (TRACE-149, 2026-11-06)

**Implemented for review on the owner's instruction** (2026-11-06: build CS-3 next and prepare Phase 6 closeout). Codex's recorded plan review (§7) cleared CS-4 only; it did not review §4 or readings R-2 to R-5. **Codex reviews this section, the readings as built and the code together.** The owner's R-1 (DEC-2026-062) is the rule used. Not merged and not pushed to hosted.

**Migration** `20261116001000_phase6_cs3_one_time_bound_terms.sql`, additive, ordered after CS-4's because it reuses `bound_offering_problem`. It adds one private helper and restates two functions with unchanged signatures and grants. It changes no table, column, grant or data.

**Finding F-C1 (changes R-3).** A one-time request's offer is not always for the package priced at submission. Submission prices the cheapest eligible fixed offering, or the one the homeowner chose. Matching offers the top-ranked provider (`offer_next_for_request_internal`, `preferred DESC, rank_order`), and `create_job_offer_internal` then overwrites the request's package, level and price from that offer. When the homeowner names neither a provider nor a package, any provider is permitted (`fallback_permitted`), so "another provider than the one priced at submission" is the normal outcome for those requests, not a rare fallback. A re-offer after a save also carries the newer revision and its price. Refusing all of these at checkout, as R-3 recommended, would block an ordinary booking that works today. **As built, CS-3 binds only an offer or acceptance of the submitted package and level.** Every other one-time request keeps the earlier rule unchanged: live rows, the current price, `commercial-v1` evidence. SQL 115 records the re-offer case as "OPEN (R-3)". The pricing of those requests is decision O-10 below.

**What CS-3 changes.** These conditions together select the bound path:

- a one-time fixed request with an exact `pricing-v2` record;
- the offer (at acceptance) or the request (at checkout) names that record's package and level;
- at acceptance only: no quote, no promotion overlay, redemption or homeowner selection, and not the replacement path.

On the bound path:

| Function | Change | Why |
|---|---|---|
| `private.one_time_bound_problem` | **new**, added to the fingerprint list | One rule for acceptance and checkout. It validates the bound record rather than trusting it: package, level, frequency and provider; the revision hash recomputed from the bound row; the level price equal to the recorded line; and the total equal to the request's amount when there is no promotion. With an offer, the offer must be the bound package and level at the bound prices. Then the live checks from before, in the same order: provider active and listed, service, coverage, provider ZIP, then `bound_offering_problem` (R-1), then the level's answer conditions and the bound package's required answers. Returns a named code or null; computes no amount. |
| `private.money_source` | restated | **Bound path:** price from the bound level; add-ons priced again from the bound package's content with `price_selection`, which must equal the recorded total; legacy promotion refusal and promotion logic unchanged; evidence `commercial-v2` from immutable bound fields only (R-4). Locks (R-5, as §7.2): promotions table `SHARE` only, then provider → bound tier → bound package → live revision → the bound package's questions and add-ons (row `SHARE`) → catalog → coverage → provider ZIP. **Every other path is byte-identical** (one-time unbound, quote, visit). |
| `public.vendor_accept_job` | restated | **Bound one-time branch:** the same locks, the rule judged on the row as acceptance leaves it, plus `vendor_matching_eligible`; refusal "Provider is no longer eligible" with `one_time:<code>` in `DETAIL`. `replacement` is computed before the branch choice (a read; no change in meaning). The visit branch and the earlier check are unchanged. |

**Fingerprint:** on CS-4's 48-function list, `88c9a260…` → `95658de7…`. Exactly `money_source` and `vendor_accept_job` differ; the other 46 are byte-identical. With the helper added, the new list is `49 | 52bdfc2460999a2e796633e124d71bbf`.

**Messages.** Existing texts are kept, with the code in `DETAIL`:

- provider, service, coverage, ZIP and offering refusals: "Selected offering is not eligible";
- answer refusals: "Offering answers do not match selected tier" and "Required offering answers missing";
- a bound record that no longer matches its row, on a request with add-ons: the earlier "Offering add-ons changed since the request; a new request or quote is required";
- without add-ons, new text: "Offering changed since the request; a new request or quote is required".

Clients are unaffected. `/vendor/jobs` shows acceptance's `error.message`, which is unchanged. The checkout function (`moneyCheckoutHandler.ts`) maps any refusal to `COMMERCIAL_REVIEW_REQUIRED`.

**Choices for Codex's code review:**

1. **Bound-path selection** compares the request's or offer's package and level with the submission record, not merely its presence (F-C1).
2. **Requests without a `pricing-v2` record keep the legacy path**, as visits without bound terms did in CS-4 (§7.4 item 4). Hosted has 0 fixed `pricing-v2` requests and 0 open requests, so this affects no live record.
3. **Promotional requests keep the earlier acceptance check.** Checkout's promotion logic is unchanged and the promotions gate stays closed.
4. **The revision-hash check now covers every bound request**, not only those with add-ons. An owner-maintenance in-place edit of a bound row is now refused by name (`terms_inconsistent`) instead of repricing. This closes TRACE-126's in-place exposure; SQL 097's two "KNOWN EXPOSURE (one-time)" assertions are rewritten.
5. **The price-band and ambiguous-level ranking filters aren't applied** at bound acceptance, as in CS-4 (§7.4 item 2). They read the current price, and the price is bound.
6. **The evidence version changes** (`commercial-v2`) for bound requests, so a snapshot published before deployment would be refused at checkout ("Commercial source changed; review current terms") and need re-review. Hosted has 0 snapshots.

**Rollback (business effect).** Restating CS-4's functions writes no data, but bound one-time requests whose bound row was replaced would again be unacceptable (offered) or unpayable (accepted). Their sources would revert to `commercial-v1`, so snapshots published under `commercial-v2` would be refused at checkout. **State check** (read-only; counts only):

```sql
select count(distinct r.id) filter (where m.outcome = 'pending') as offered_on_replaced_revision,
       count(distinct r.id) filter (where m.outcome = 'accepted' and coalesce(o.captured, 0) < coalesce(s.total, 1)) as unpaid_accepted_on_replaced_revision,
       (select count(*) from public.money_snapshots x where x.source_version like 'commercial-v2:%'
          and not exists (select 1 from public.money_obligations y where y.current_snapshot_id = x.id and y.captured >= x.total)) as unpaid_v2_snapshots
from public.service_requests r
join public.vendor_packages p on p.id = r.package_id and not p.is_active
join public.job_match_attempts m on m.service_request_id = r.id and m.outcome in ('pending', 'accepted')
left join public.money_obligations o on o.service_request_id = r.id
left join public.money_snapshots s on s.id = o.current_snapshot_id
where r.recurrence_parent_id is null and r.status <> 'cancelled' and r.pricing_inputs->>'version' = 'pricing-v2';
```

The procedure is §7.3's. If every count is 0, rollback changes no live outcome. If any is above 0, fix forward; a rollback then needs the owner's authorization and per-request recovery first.

**Decision O-10 (owner, with finance; not decided here).** What is the agreed price of a one-time request offered at a package or level other than the one priced at submission (another provider, or the same provider's newer revision)? Today and after CS-3 it is the accepted offer's current price, which the homeowner sees and confirms at the explicit checkout.

- (a) Bind the offer's price when the offer is created (a new binding record; its own slice).
- (b) Refuse checkout (plan R-3 as written; blocks ordinary bookings, F-C1).
- (c) Keep the current rule and record it as the policy.

D-1's wording ("the tier revision and price bound at submission") doesn't settle which applies.

**Evidence** (isolated stack, synthetic):

- Clean replay of 221 migrations: full suite 106 files / 6,868 PASS. After `bound-terms-concurrency.mjs` committed and removed its fixtures, a clean reset and the full suite gave 6,868 PASS again.
- New SQL 115: 143/143. It covers price, rename, add-on and repeated revisions; every refusal by name; the owner-maintenance edit; promotion and matching exclusion; authorization, expiry, stale and mismatched offers; the unbound paths kept (no `pricing-v2` record; the re-offer recorded as OPEN (R-3)); and the control with no revision.
- Rewritten expectations:
  - SQL 097, 147/147: the two "KNOWN EXPOSURE (one-time)" assertions and the evidence-shape assertion.
  - SQL 104, 71/71: its TRACE-126 assertion, now that the fixture carries a complete `pricing-v2` record.
  - SQL 114, 148/148: its "one-time unchanged" assertion.
- `bound-terms-concurrency.mjs`: C1–C13 PASS on 5 runs. The new one-time races are C9 (acceptance vs. save), C10 (six acceptances, one result), C11 (checkout vs. save), C12 (publication vs. save, hash unchanged) and C13 (acceptance vs. vendor pause). The related scripts pass: recurring payment, recurring visit, cadence, fulfillment, pricing, vendor offerings, phase 5 money, reviews.
- On CS-4's schema, SQL 115 fails its first evidence checks and aborts (helper missing), and the concurrency script fails at C9 round 2 with "Provider is no longer eligible".
- Rollback state check: 0/0/0 locally. Hosted (read-only): 0 snapshots, 0 obligations, 0 open requests, 0 fixed `pricing-v2` requests, 0 pending offers.
- Unit 656/656, types, lint (0 warnings), secret scan.

**Deployment order (each step needs the owner's authorization):**

1. Codex review.
2. The two-person finance review (Josh + the accountant).
3. CS-4's hosted dry run and push of `20261115001000`, then #150 to `main`.
4. CS-3's dry run and push of `20261116001000`, then its merge.

The deployed client is unchanged, so each push can precede its merge.

## 9. Reconciliation and the O-10 repair plan (TRACE-150, 2026-11-07)

**Status: PROPOSED, for Codex review. Nothing in this section is implemented.** Every behavior in §9.2–§9.8 is proposed: no function, table, migration, client or test has changed. The decision this plan follows, DEC-2026-063, is **proposed** and still needs the owner's confirmation (see its entry). O-11, P-3 and the other choices in §9.5–§9.6 are proposals too. CS-3's live-price path (§8, "every other one-time request keeps the earlier rule") is an **open repair**, not approved policy. **TRACE-126 stays open** until the complete repair is implemented and verified.

### 9.1 Reconciliation of #150 and #151 (read-only, 2026-11-07)

These are observations, not repairs. Nothing was pushed, merged, re-merged or deployed.

| Item | Found | Source |
|---|---|---|
| #150 | Base `main`; merged 2026-11-06 18:45 UTC as `98fe138` by the owner's account. It carried the closeout packet and CS-4 (#149, `c3ce575`). | `gh pr list` |
| `main` | `98fe138`. Push CI run 42273533761: success. | `gh run list` |
| Production | Deployment of `98fe138` at 2026-11-06 18:45:48 UTC. **CS-4 is live.** | GitHub deployments |
| #151 (CS-3) | Base **`claude/phase6-closeout-a1-packet`, not `main`**. Merged 2026-11-07 17:14 UTC as `a26a7fd`, about 22.5 hours after #150 had already taken that branch to `main`. **CS-3 (`ae5157e`, `7d0bdba`) is not on `main` and not deployed.** The closeout branch is now `main` plus CS-3. | `git merge-base --is-ancestor` |
| CI, CS-3 | PR run 42276023994 at `7d0bdba`: success. Push run 42395324355 at `a26a7fd` was still in progress when read. | `gh run list` |
| Hosted migrations | `20261115001000` (CS-4) **applied**; `20261116001000` (CS-3) **not applied**. | `supabase migration list --linked` |
| Hosted functions | Fingerprint `48 \| 88c9a26077e7f8fb07e140f38d839f8c` equals CS-4's recorded value (§7.4), so hosted's fingerprinted functions match `main`. Stored statements: 7, 31,943 bytes, against the file's 31,961. That fits statement splitting but wasn't compared byte for byte. | fingerprint script; `schema_migrations` |
| CS-4 push record | **None in the repository.** The manifest (row 30), the closure report and TRACE-148 still said "not on hosted". Hosted doesn't store who pushed or when. | grep |
| Reviews | #149, #150, #151: **no GitHub review and no Codex review recorded**. The only comments are automated (a CodeRabbit "review skipped" and the Supabase preview bot). **No finance review** for CS-4 or CS-3; the accountant isn't engaged. | `gh pr view` |
| Hosted data | 0 open one-time requests, 0 pending or accepted offers, 0 snapshots, 0 obligations, 0 fallback consents, 0 `pricing-v2` requests. 6 historical fixed requests without `pricing-v2`, all closed. | read-only aggregates |

**CS-4 missed its pre-release gates (recorded 2026-11-07; not satisfied).** §7.4 required, before the merge: a Codex code review, the two-person finance review, and a recorded, owner-authorized push. On 2026-11-06 CS-4 reached `main` and production with none of the three recorded. This record doesn't backdate any review or mark any gate satisfied. Both reviews are still owed, against `#149` (`360e104..84f8d16`) and the deployed fingerprint `48 | 88c9a260…`. No live visit, snapshot or obligation exists. A rollback would itself be a production change, and none is proposed.

**Route for CS-3.** CS-3 has no route to `main`. Re-merging the closeout branch would ship CS-3 alone, together with its open live-price path, so **the closeout branch must not be re-merged**. The implementation release is one reviewed PR to `main` carrying CS-3 and O-10 together. The fallback is never deployed separately.

### 9.2 Proposed requirements (DEC-2026-063, proposed) and how the plan meets each

| # | Requirement as received | Proposed mechanism |
|---|---|---|
| Q1 | Preserve submission-bound terms when the offer matches the submitted package and level | CS-3's bound path (implemented on the CS-3 branch, not on `main`). Plus P-2: the same provider's newer revision of the lineage is offered **at the bound row and level**, so it matches. |
| Q2 | Otherwise, bind the selected provider's complete commercial terms when the offer is created | `create_job_offer_internal` writes an immutable `job_offer_terms` row in the same transaction as the offer (§9.3). |
| Q3 | Later catalog edits don't reprice the offer; approved live eligibility checks remain | Acceptance and checkout price only from the terms row. Live checks are CS-3's list, with "offered" read per R-1 against the terms' package. They refuse by name and never substitute. |
| Q4 | A different provider, scope or price needs explicit homeowner acceptance of the complete terms before charging | A keyed homeowner response bound to the exact offer, terms row and terms hash (§9.4). `money_source` refuses an offer-bound request without it, so publication and checkout can't run. |
| Q5 | Provider acceptance alone isn't homeowner price consent | Provider acceptance leads only to `awaiting_terms` (§9.3), never to `scheduled`. |
| Q6 | Changed terms need a new offer and fresh acceptance | Terms rows are append-only, and a response names one row and its hash. There's no edit path. A change means a new offer, which gets a new terms row, which needs a new response. |
| Q7 | No add-ons or promotions carried to another provider without supported, explicitly agreed terms | Offer-bound terms carry **no add-ons and no promotion**. Submitted add-ons not carried are listed as "not included" (P-3, proposed). A candidate with a promotion overlay isn't offer-bound and stays refused at checkout while the promotions gate is closed. |

### 9.3 Proposed design

**Flow (P-1, proposed): provider first, then homeowner.** This is the approved E5/E6 replacement pattern applied to ordinary offers:

offer created with its terms bound → provider accepts (live checks) → `awaiting_terms` → homeowner accepts (live checks again) → `scheduled` → two-person review and publication → explicit checkout.

*Alternative, not recommended: homeowner first.* It changes the matching state machine and vendor offer visibility, and every later expiry or decline costs the homeowner another question.

**`awaiting_terms` is a matching state, not a request status.**

- `service_requests.status` stays in its existing set; the request stays `matched` while it waits.
- `service_requests.matching_status` gains the value `awaiting_terms`, by widening its check constraint.
- A new value is needed because `private.replacement_attempt` and the client (`offerStatus.ts`, `appointments.ts`, `serviceRequestStatus.ts`) read `awaiting_homeowner` as "an E5/E6 replacement". Reusing that value would route an ordinary offer into the replacement flow.

**Proposed transitions.** No other writer may set or leave `awaiting_terms`.

| From (`status` / `matching_status`) | Event and actor | To | Records |
|---|---|---|---|
| `matched` / `offered`, offer-bound offer pending | Provider accepts (`vendor_accept_job`), live checks pass | `matched` / `awaiting_terms` | attempt `accepted`; request price from the terms; homeowner notified |
| `matched` / `awaiting_terms` | Homeowner accepts the current terms (`homeowner_respond_offer_terms`), live checks pass | `scheduled` / `matched`, as an ordinary acceptance today | response row (accepted) |
| `matched` / `awaiting_terms` | Homeowner declines | `pending` / `awaiting_match`, then `offer_next_for_request_internal` moves it to `offered`, `awaiting_consent` or `exhausted` as today | response row (declined); attempt `withdrawn`, reason "Homeowner declined the terms"; provider notified |
| `matched` / `awaiting_terms` | Provider withdraws (`record_job_operation` `provider_cancel`) | `pending` / `awaiting_match` and re-match, **not** the E5/E6 replacement flow, because nothing was agreed | attempt `withdrawn`; terms row left without a response (closed by the withdrawal); `record_job_operation` and `provider_withdrawal_open` restated so this case isn't a replacement (P-9) |
| `matched` / `awaiting_terms` | Homeowner or operator cancels (`customer_cancel`) | `cancelled` under the existing assessed command; nothing has been charged | existing operation record |
| `matched` / `awaiting_terms` | Operator force offer (`_force`) | The accepted attempt is withdrawn and a new offer made | the earlier terms row is superseded; any later response to it is stale |
| `matched` / `awaiting_terms` | Time passes | **No automatic change** (O-11, proposed); operations sees it after the O-11 window | — |

**Data (proposed, additive):**

- **`public.job_offer_terms`** (one row per offer-bound offer, `offer_id` unique; modeled on `job_replacement_proposals`):
  - Columns: `id`, `request_id`, `offer_id`, `terms` (canonical JSON, below), `terms_hash`, `created_at`.
  - RLS: participants read. No client writes; an append-only trigger blocks update and delete.
- **`public.job_offer_terms_responses`** (modeled on `job_replacement_responses`):
  - Columns: `terms_id` (**unique**, so one response per terms row), `request_id`, `offer_id`, `terms_hash`, `response_key`, actor, `accepted`, reason, `before_value`, `created_at`.
  - `unique (request_id, response_key)`.
- **Constraint:** `service_requests_matching_status_check` widened with `awaiting_terms`.

**Complete commercial terms** (canonical JSON, version `offer-terms-v1`; `terms_hash` = SHA-256 of it):

- **Offer identity:** request, offer id.
- **Provider and service:** provider, service, ZIP.
- **Exact revision:** package id, lineage, the package revision hash as recorded at offer creation, level id and label, frequency.
- **Scope:** the answers the level relies on (and a hash of all answers).
- **Price:** level price in cents, add-on lines (always empty), add-ons not included (names from `pricing_inputs`), promotion (always null), service subtotal in cents.
- **Policy:** tax treatment (P-8) and cancellation policy version.

The homeowner sees exactly this content.

**Proposed functions** (same signatures; definer; grants unchanged unless noted):

| Function | Fingerprinted | Proposed change |
|---|---|---|
| new `private.offer_terms_build(r, candidate)` | **add** | Builds the terms and hash from the rows read under the offer's locks. No live-eligibility judgment. |
| new `private.offer_bound_problem(r, offer, terms)` | **add** | CS-3's rule with the terms row as the binding. It recomputes the hash and the package revision hash, and checks that the offer equals the terms. Then provider, service, coverage, provider ZIP, `bound_offering_problem` (terms package and level), answers. Returns a named code or null. |
| `private.create_job_offer_internal` | **add** (it writes the request's price) | (a) P-2 substitution. (b) A fixed one-time candidate that differs from submission gets a `job_offer_terms` row. (c) A `_force` offer whose terms hash equals a **declined** response's hash for this request is refused (§9.5). Quotes, visits and promotion overlays are unchanged. Locks per §7.2. |
| `public.vendor_accept_job` | yes | Offer-bound branch: locks, `offer_bound_problem`, then `awaiting_terms` (table above). CS-3, visit and replacement branches unchanged. |
| new `public.homeowner_respond_offer_terms(_terms_id, _response_key, _accept, _expected, _reason)` | **add**; EXECUTE to `authenticated` | §9.4. |
| `private.money_source` | yes | Offer-bound path: price and evidence (`commercial-v2`) from the terms row plus the accepted response id. Refused without an accepted response whose hash equals the row's. The fixed one-time live-price path is **removed**: with neither binding, it refuses `terms_missing` (P-4). Quotes and visits byte-identical. |
| `public.homeowner_respond_replacement` | no → **add** | P-5: accepting an E6 proposal also writes the terms response for that offer's terms row, whose content the proposal shows. E6's agreed-amount rule is unchanged. |
| `public.record_job_operation`, `private.provider_withdrawal_open` | no | P-9: a provider withdrawal in `awaiting_terms` re-matches as an ordinary offer, not a replacement. |
| `find_eligible_packages_core`, promotions, split, snapshot, ledger, payout, refund | yes | **Not changed.** |

**Lock order** (§7.2, extended): request advisory lock → request row (`FOR UPDATE` in commands) → `package_promotions` table `SHARE` (`money_source` only) → provider → `job_offer_terms` row → terms tier → terms package → live revision → package questions → catalog → coverage → provider ZIP.

**Client (proposed; MDS components, no new patterns):**

- **Homeowner:**
  - a terms card in `HomeownerJobDetailDialog`, with Accept and Decline;
  - the label "Your answer is needed: review this provider's terms" in `serviceRequestStatusLabel` and `offerStatus`;
  - the "Amount" label for `awaiting_terms`;
  - `canonicalRequestState` maps `matched`/`awaiting_terms` to matching.
- **Vendor:** `vendorOfferOutcome` treats `awaiting_terms` as accepted and waiting for the homeowner ("Waiting for the homeowner to accept your terms").
- **Admin:** shows the state and the binding basis.
- **Types:** regenerated.

### 9.4 Proposed homeowner consent: exact binding, stale answers, retries, races

`homeowner_respond_offer_terms(_terms_id, _response_key, _accept, _expected, _reason)`, where `_expected = {offer_id, terms_id, terms_hash}` as the homeowner's screen loaded them.

1. **Who.** Only the request's homeowner; anyone else gets `42501`. Anonymous callers have no grant.
2. **Locks.** Request advisory lock, then the request row `FOR UPDATE`, then the §9.3 order. Every writer that can change the outcome takes the same request locks first: provider acceptance, decline, provider withdrawal, cancellation and force offer.
3. **Retry (replay).** If a response with this `response_key` exists for the request:
   - same terms row, intent and reason → return it with `replayed: true` and write nothing;
   - otherwise → `22023`, "Response key reused with different intent".
4. **Exactly one answer.** `terms_id` is unique in the responses table. A second answer with a new key gets `22023`, "You already answered these terms". Concurrent accept and decline, from two tabs or two keys, serialize on the request lock: the first commits, and the second sees the response and is refused. The unique index backs this if the lock order is ever broken.
5. **Stale.** `40001`, "These terms changed since you opened them. Review the current terms.", and nothing is written, when any of these holds:
   - `_expected` differs from the current offer, terms row or hash;
   - the offer isn't the request's accepted attempt;
   - the request isn't `matched`/`awaiting_terms`;
   - the stored `terms_hash` no longer equals the hash recomputed from `terms`.

   This covers force offers, withdrawals and cancellations that happened in between.
6. **Exact revision.** The response stores `offer_id`, `terms_id` and `terms_hash`. The hash covers the package revision hash. `money_source` accepts the response only while all three still equal the request's accepted attempt and its terms row. A later offer, even from the same provider at the same price, has a new terms row and needs a new response.
7. **Changed eligibility.** On accept, `offer_bound_problem` runs under the locks.
   - If it returns a code, the call fails with that code named, and **nothing is written**. The request stays `awaiting_terms`; the homeowner can still decline, and operations sees the refusal in the queue (P-10).
   - A concurrent provider suspension or vendor save takes the provider or package lock. It either commits first, so acceptance is refused by name, or after, so acceptance stands at the bound terms (R-1).
   - Declining runs no eligibility check, so a homeowner is never stuck unable to say no.
8. **Charging.** Charging stays a separate step: the two-person review, publication and the explicit checkout. They proceed only when step 6 holds. Provider acceptance never satisfies it.

### 9.5 Proposed: declining doesn't bring the same terms back

- **Matching.** `create_job_offer_internal` already refuses, without `_force`, any provider with a `declined`, `expired` or `withdrawn` attempt on the request. A homeowner decline sets the attempt to `withdrawn`, so automatic matching never offers that provider on this request again, at any terms.
- **Force offers.** An operator force offer that produces the same `terms_hash` as a declined response on this request is refused: "The homeowner declined these terms". Different terms from the same provider can be forced, but they get a new terms row and need a fresh acceptance.
- **Submission terms aren't recycled.** A decline doesn't revive the submission terms for another provider. The next candidate is either submission-matched (Q1) or bound to its own terms (Q2).
- **Supply runs out.** If no candidate remains, the request reaches `exhausted`, shown as "Not available yet in your area", as today.

### 9.6 Readings and choices (all proposed)

Codex decides P-1, P-2, P-4 to P-10. The owner decides **P-3** and **O-11**.

| # | Question | Recommended | Alternative |
|---|---|---|---|
| P-1 | Order of acceptances | Provider first, then homeowner (E5/E6 pattern) | Homeowner first |
| P-2 | Same provider's newer revision of the submitted offering | Offer at the bound row and level (R-1; preserved, no new acceptance) | Bind the newer revision's terms and ask the homeowner |
| **P-3** (owner) | Submitted add-ons on a cross-package offer | Not carried; listed as "not included" in the terms the homeowner accepts | Don't offer cross-package when add-ons were chosen |
| P-4 | Requests with neither binding (no `pricing-v2`, or an offer made before deployment) | Refuse by name. Hosted has 0 open requests. Part of the repair TRACE-126 needs; it doesn't close TRACE-126 by itself. | Keep the live-price path (contradicts DEC-2026-063 as received) |
| P-5 | E6 replacement offers | In scope (§9.3) | Leave E6 alone; after P-4 a pre-payment replacement couldn't be paid |
| P-6 | One helper or two | Two; CS-3's helper untouched | Generalize `one_time_bound_problem` |
| P-7 | Customer details for a provider who accepted before the homeowner agreed | Same exposure E5/E6 already has; confirm it's the "approved workflow point" (MPS §6.2) | Hide the address until the homeowner accepts |
| P-8 | Tax in the accepted terms | The terms carry the tax treatment; the amount comes from the reviewed snapshot, shown at checkout | Compute tax at offer creation |
| P-9 | Provider withdrawal in `awaiting_terms` | Ordinary re-match, not replacement | Treat as E5/E6 replacement |
| P-10 | Eligibility refusal at homeowner acceptance | Refuse, write nothing, show it in the operations queue | Auto-withdraw and re-match |
| **O-11** (owner) | Response window; notification | No automatic change; operations sees it after 24 hours; in-app notification as E5 | Email as well; an automatic decline |

### 9.7 Evidence required (for the implementation, not this plan)

- **SQL 116 (new) matrix:**
  - Binding basis: submission match; same-lineage newer revision; other provider; same provider, other package; operator force; fallback-consented; E6 replacement.
  - × Change after binding: price, rename, add-on, pause, archive, review, provider suspension, coverage, ZIP, service.
  - × Steps: provider accept; homeowner accept, decline, stale `_expected`, replay, reused key, second key, other homeowner, provider, anonymous; provider withdrawal; cancel; force with same and different terms.
  - × Money: publication and checkout.
  - Assertions: amounts and source hash never change after binding; add-ons and promotions aren't carried; every refusal by name; P-4 refusals; no re-offer after decline.
- **Rewritten:** SQL 115's "OPEN (R-3)" cases. Recheck 097, 104 and 114. Update the matching tests (phase 1, phase 4 consent) and the exception-resolution tests.
- **Concurrency C14–C20:**
  - offer creation vs. vendor save (the hash equals the revision read);
  - provider accept vs. save;
  - homeowner accept ×6 with one key (one response);
  - accept vs. decline with two keys (one wins);
  - accept vs. provider suspension;
  - accept vs. force re-offer;
  - accept vs. provider withdrawal.
- **Browser:** homeowner accept and decline; vendor waiting state; admin state.
- **Unit and static checks:** state mapping, types, lint, secret scan.
- **Fingerprint and replay:** fingerprint before (`49 | 52bdfc24…`, CS-3) and after, each changed function named; a clean replay twice; the rollback state check.

### 9.8 Proposed migration, deployed-client compatibility, rollback

- **Migration.** `20261117001000_phase6_o10_offer_bound_terms.sql`, additive: two tables, one widened check constraint, restated functions, one new public command. It writes no data.
- **Deployed clients are not compatible with `awaiting_terms`.** On production `98fe138`:
  - The vendor screen's `vendorOfferOutcome` reports an accepted offer as "gone".
  - The homeowner sees the generic status "Matched" and has no way to answer.
  - The admin pages show the raw value. Nothing crashes: `matching_status` is a plain `string` in the types.

  *2026-11-08: **Deployment compatibility is UNRESOLVED.*** The order proposed earlier (a read-only check, push, then merge immediately) does **not** resolve it, because:
  - Between the push and the new client going live, any one-time request matched to other terms would reach `awaiting_terms` on the old client. The window lasts from the push, through the merge, to Vercel's deployment.
  - The read-only check shows only that no request is open at the moment it runs. It doesn't stop one from opening afterwards.
  - R0 isn't a guard here: you can grant trial access at any time.
  - A Vercel rollback to a pre-O-10 deployment (AGENTS.md) would bring the incompatible client back while the schema stays.

  Two proposals for Codex to choose between (or reject). **Neither is implemented.**

  - **(A) Backward-compatible states.** Don't add a `matching_status` value. After the provider accepts, keep values the deployed client already renders, and mark the wait in a new record: a `job_offer_terms` row with no response.
    - The request would be `matched`/`matched`. The old vendor client shows "accepted", which is correct.
    - The old homeowner client would show "provider confirmed" with the amount, which is **misleading**: it suggests the service is booked, and offers no way to answer. Payment stays refused (`money_source`), so nothing is charged at the wrong terms.
    - Every command that acts on `matched` (appointments, rescheduling, start, publication) would need a terms-pending guard, which widens the slice.
    - **Not recommended:** it is safe for money but not truthful to the homeowner.
  - **(B) Guarded activation (recommended).** Deploy the schema and client inactive, then activate on purpose. While inactive, no offer to other terms is created, and the live-price fallback isn't used either.
    - **Switch:** one operator-only activation record (`private`, default **off**). Changing it takes a keyed, audited command with a reason. No client can write it.
    - **While off:**
      - `create_job_offer_internal` doesn't offer a fixed one-time candidate whose terms differ from submission. It skips that candidate and logs the skip, and matching continues to the next, which ends in `exhausted` ("Not available yet in your area") if none remains.
      - CS-3's submission-bound path works.
      - P-4 still refuses requests with neither binding.
      - No request can reach `awaiting_terms`, so the old client never sees it.
    - **Sequence**, each step with the owner's authorization:
      1. Read-only pre-push check.
      2. Dry run and push `20261116001000`, then `20261117001000`, with the switch off.
      3. Merge the single PR.
      4. Read back that the production deployment SHA includes the new client.
      5. Turn the switch on with the recorded command.
      6. Read back the switch state and run a synthetic check (local, or with a test account, as the owner decides).
    - **Rollback:** turn the switch off first. Requests already in `awaiting_terms` stay answerable only while the new client is deployed, so a Vercel rollback past O-10 needs the switch off and a count of `awaiting_terms` requests first. Any count above 0 means fix forward.
    - **Cost:** while off, requests whose top candidate has other terms may end `exhausted` where the old fallback would have priced them. With 0 open requests and R0 in force, that affects no live request today.

- **Rollback.** A forward migration restoring CS-3's definitions. Business effect: `awaiting_terms` requests would have no path forward, and accepted offer-bound requests would lose their binding. A read-only state check counts both first; any count above 0 means fix forward.

### 9.9 Order and gates

1. Codex reviews §9 (P-1–P-10). The owner confirms or amends DEC-2026-063 and answers P-3 and O-11.
2. Implementation on `claude/phase6-o10-offer-bound-terms`, stacked on CS-3. No implementation starts before step 1.
3. Codex code review of CS-3 (§8) and O-10 together, plus the owed review of CS-4 (#149).
4. Two-person finance review (Josh + the accountant, **not engaged**) of CS-4's deployed fingerprint, CS-3 and O-10.
5. One PR to `main` carrying CS-3 and O-10. Release only after Codex resolves §9.8's deployment compatibility (A, B or another design); under (B), push with the switch off, merge, read back the deployment, then activate, each step with the owner's authorization.
6. One-time CS-5 (§5), then the A2 human checks. **Phase 6 is not accepted.**

## 10. O-10 implementation record (TRACE-150, 2026-11-08)

**Implemented for review on the owner's instruction (2026-11-08).** It follows DEC-2026-063 (approved with O-11 and P-3) and Codex's review of §9 at `ff98673`. **Not pushed to hosted, not merged, gate not activated.** Each of those needs the owner's separate authorization. The finance review is Josh's sole-owner review (DEC-2026-064); it has **not** been performed. CS-4's missed pre-release gates (§9.1) stay recorded as missed. **TRACE-126 stays open** (item 9 below). Phase 6 is not accepted.

**Branch and base.** `claude/phase6-o10-offer-bound-terms`, stacked on CS-3 (`7d0bdba`) and the §9 records. The release PR to `main` carries CS-3 and O-10 together, so CS-3's live-price path is never deployed alone.

**Migration** `20261117001000_phase6_o10_offer_bound_terms.sql`, additive:
- the `offer_terms` gate row (off) and its append-only audit;
- `public.job_offer_terms` and `public.job_offer_terms_responses` (append-only; participants read; no client writes);
- `private.offer_terms_blocks` and `private.offer_terms_retries`;
- `awaiting_terms` added to the `matching_status` check;
- two guard triggers;
- new helpers and commands;
- restated, with unchanged signatures: `find_eligible_packages_core`, `create_job_offer_internal`, `offer_next_for_request_internal`, `vendor_accept_job`, `money_source`, `homeowner_respond_replacement`, `job_replacement_state`, `provider_withdrawal_open`.

It writes no request, offer or money data.

### 10.1 Codex's review at `ff98673`: how each point is met

| Codex point | Built | Evidence |
|---|---|---|
| Guard offer creation **and** transitions into `awaiting_terms`; serialize switch-off against them | Offer creation (`create_job_offer_internal`), matching (`offer_next_for_request_internal`), provider acceptance and the row trigger `guard_offer_terms_pending` each share-lock the gate row (`private.offer_terms_active(true)`). Switching the gate off updates that row, so it waits for, or is waited on by, each of them. Entering `awaiting_terms` needs the acceptance command's transaction mark **and** the gate on. | SQL 116 gate-off cases; concurrency C20 (accept vs switch-off) and C21 (offer vs switch-off) |
| Separate identity-bound consent hashes from commercial-content comparisons | `content_hash` = SHA-256 of the commercial terms only; `consent_hash` = SHA-256 of {request, offer, terms row, content hash}. The homeowner's answer and `money_source` use `consent_hash`; the declined-terms check uses `content_hash`. | SQL 116: the content hash is refused as a consent; the earlier consent doesn't carry to new terms |
| Complete scope and exclusions | The terms (`offer-terms-v1`) carry: provider, service, ZIP, cadence; offering name, description, policy notes and exact revision hash; level; included scope; the answers relied on; every priced line, including the provider's required add-ons; totals. Exclusions: the earlier add-ons not carried (name, quantity, amount, whether the earlier offering required them), no promotion, tax confirmed before payment, tip optional. | SQL 116 "complete scope", "P-3 … disclosed"; unit `offer-terms.test.ts` |
| Pending-consent restrictions enforced server-side across scheduling, start and status commands | Row trigger `guard_offer_terms_pending`: while `awaiting_terms`, the request changes only through the answer, withdrawal, force and cancellation commands; every other status, schedule, quote or field change is refused. Trigger `guard_offer_terms_operation` refuses every operation except cancellation and provider withdrawal. Payment refuses ("Scheduled commercial parties required", then the consent check). | SQL 116: operator status change, provider start, reschedule request, appointment, direct write and payment all refused |
| Preserve authorized customer-data disclosure | Disclosure follows assignment (`contractor_id`), as for an open offer; `awaiting_terms` keeps the accepted provider assigned, so nothing widens. A decline or withdrawal unassigns the provider, and it can no longer read the request. It keeps read access only to its own offer's terms record. | SQL 116: the declined provider sees 0 requests and 1 terms record |
| Recovery for requests blocked while activation is off | A one-time request left without an offer while the gate is off is recorded (`offer_terms_blocks`). `admin_offer_terms_queue` lists it; after activation, `admin_retry_offer_terms_matching` (operator, keyed, reason) runs matching again. Admin page: "Offers at other terms". | SQL 116 recovery cases (refused while off, offered after activation, replayed, leaves the queue) |

### 10.2 Readings P-1 to P-10 as built

1. **P-1, provider first:** acceptance sets `matching_status = 'awaiting_terms'`; status stays `matched`.
2. **P-2, the same provider's newer revision** is offered at the submitted row, level and prices (`one_time_offer_basis` → `lineage`). It then stays on CS-3's bound path. Matching now lists such a revision for requests priced with add-ons (they were excluded before), but never the bound row itself after an in-place change.
3. **P-3, add-ons and scope (approved):** add-ons are not carried and are disclosed. A candidate whose terms can't be priced exactly for the request's answers (no single level, a required question unanswered) is skipped. While the gate is on, matching lists other fixed candidates for add-on requests.
4. **P-4, narrowed:** a one-time fixed request with a submission record or any offer, but neither binding, is refused by name (`one_time:terms_missing`). The earlier live-price path remains only for a row with neither (no record, never offered). Product commands don't create such rows: submission always writes `pricing-v2` when it prices an offering, and matching always creates an offer. Removing it entirely would break 25 money test fixtures that insert scheduled requests directly; that is left as the TRACE-126 residue.
5. **P-5, E6 replacements:** other-provider replacement offers carry bound terms. `job_replacement_state` shows them and puts `terms_id` and `consent_hash` in the expected answer. `homeowner_respond_replacement` records the terms answer (`via = 'replacement'`) and runs the bound-terms live checks.
6. **P-6:** separate helpers; CS-3's `one_time_bound_problem` is unchanged.
7. **P-7:** as 10.1, disclosure row.
8. **P-8, tax:** the terms say tax is confirmed before payment; the amount comes from the two-person snapshot review, as for every request.
9. **P-9, provider withdrawal in `awaiting_terms`:** the accepted offer is withdrawn and the request re-matches as an ordinary offer. `provider_withdrawal_open` ignores that withdrawal, so it isn't treated as a replacement.
10. **P-10, eligibility change at the homeowner's answer:** refused by name, nothing written; decline stays possible; the operations queue shows "not acceptable".

**Decline and re-offer.** Declining withdraws the attempt, unassigns the provider and runs matching. Matching never re-offers a provider with a closed attempt on the request. A force offer whose `content_hash` equals a declined answer's is refused ("The homeowner declined these terms"). Changed terms get a new row, consent hash and answer.

**O-11 (approved).** No automatic timeout. `admin_offer_terms_queue` shows terms unanswered after 24 hours. In-app notifications go to the homeowner (provider accepted, review terms) and to the provider (accepted or declined).

### 10.3 Client

- **Homeowner:** `OfferTermsReview` in the job dialog shows the complete terms, what isn't included, and Accept and Decline. The answer is keyed, a lost response is read back, and stale terms are refused and reloaded. The replacement card shows the bound terms.
- **Status:** labels, lifecycle and provider status handle `awaiting_terms`.
- **Vendor jobs:** the vendor sees "Waiting for the homeowner to accept your terms", and the accept dialog says the homeowner accepts first.
- **Admin requests:** the "Offers at other terms" queue and the amount label.
- **Types:** `database.types.ts` regenerated from the local schema. This also picks up signatures from earlier migrations that hadn't been regenerated (CS-5's start exception, CS-9's dispute overloads); typecheck is clean.

### 10.4 Evidence (isolated stack, synthetic)

- **Clean replay of 222 migrations:** full SQL suite **107 files / 6,968 tests PASS**.
- **New SQL 116:** 100/100. It covers gate off and on, recovery, P-2, complete terms and exclusions, the catalog edit after binding, every refusal while pending, identity and staleness, replay and reused keys, payment, decline with no re-offer, changed terms needing fresh consent, an eligibility change, the 24-hour queue, switch-off while pending, provider withdrawal (P-9), force supersede, cancellation, promotion and E6 (P-5).
- **Rewritten expectations:**
  - SQL 115: its CS-3 "unchanged paths" and "OPEN (R-3)" cases become the O-10 expectation, 143/143.
  - SQL 012: pool order with the gate on, 10/10.
  - SQL 087 and 028 unchanged (pass after one-time scoping).
- **New `scripts/offer-terms-concurrency.mjs` (CI step):** C14–C21 PASS on 7 runs.
- **Related CI scripts:** `bound-terms`, `recurring-payment`, `recurring-visit`, `recurring-cadence`, `fulfillment`, `exceptions`, `exception-resolutions`, `support`, `admin-operations`, `pricing` all pass. `test-lifecycle-integration` needs CI's default stack and wasn't run locally.
- **Money fingerprint:**
  - CS-3's 49-function list: `52bdfc24…` → `4919122f…`. Exactly `money_source`, `vendor_accept_job` and `find_eligible_packages_core` changed: restoring their CS-3 definitions in a rolled-back transaction gives `52bdfc24…` again.
  - The list adds 8 functions (`create_job_offer_internal`, `offer_terms_build`, `one_time_offer_basis`, `offer_terms_consent_hash`, `offer_terms_problem`, `offer_terms_current`, `homeowner_respond_offer_terms`, `homeowner_respond_replacement`): new value **`57 | ce502fe7389eb2fdfa972bb38804fcfc`**.
- **Client checks:** unit 660/660 (4 new); typecheck; lint; secret scan.
- **Not run locally:** browser suite and build (CI runs both), screen reader, real devices.
- *2026-11-09: #154's first CI run (`ad2621a`, run 42513542507) failed the browser step. Every spec that opens `/vendor/jobs` failed, because the page waited on the bound-terms read, which the fixtures don't answer. `99f035c` shows the list first and merges the flag in afterwards. CI pull_request run 42627327535 on `99f035c`: application (build, unit, full non-visual browser suite), backend (clean replay, SQL, concurrency including `offer-terms-concurrency.mjs`) and lifecycle all **pass**. Local browser reruns were inconclusive under machine load; CI is the evidence.*

### 10.5 Findings

- **F-O10-1 (pre-existing, not fixed):** a provider save that replaces the revision matching just selected makes offer creation refuse it ("Selected contractor/package is no longer eligible"), and the matching call fails with nothing written. A later matching run binds the new revision. No inconsistent terms are possible (C14). *2026-11-09 (§11.2): after a homeowner's decline this failure also rolled back the decline (Codex finding 1). A failed re-match after a decline now keeps the decline and is recorded for operations. The refusal itself is unchanged.*
- **F-O10-2 (pre-existing):** `scripts/phase6-matching-offers.mjs` (not in CI) fails in its own cleanup on the 6.11A package-delete guard.
- **F-O10-3:** the TRACE-126 residue (10.2 item 4). *2026-11-09: removed in code by the forward fix (§11.3); not yet on hosted.*

### 10.6 Release sequence (guarded activation, §9.8 B); each step needs the owner's authorization

1. Codex code review of CS-3 and O-10 together (and CS-4's owed review). Josh's sole-owner finance review (DEC-2026-064).
2. Read-only pre-push check: 0 one-time fixed requests in `pending`/`matched`; 0 pending offers.
3. Dry run and push `20261116001000`, then `20261117001000`. The gate stays **off**: no request can reach `awaiting_terms`, so the deployed client isn't exposed.
4. Merge the single PR; read back that the production deployment SHA includes the new client.
5. Owner activation: `update private.money_feature_gates set enabled = true, reason = '<reason>' where name = 'offer_terms'` (recorded in `money_feature_gate_events`). Then read back the gate and run a synthetic check.
6. Rollback: switch the gate off first. Before any Vercel rollback past O-10, count `awaiting_terms` requests; any count above 0 means fix forward.

*2026-11-09, hosted (owner-authorized: "push any migrations that need to be pushed"):*
- *`20261116001000` (CS-3) was **already applied** on hosted, pushed by someone else; the repository has no record of who or when. Hosted's CS-3 fingerprint, `49 | 52bdfc24…` on CS-3's list, matches the branch. It was not pushed again.*
- *Pre-push check: 0 open requests, 0 open fixed one-time requests, 0 pending or accepted offers, 0 snapshots, 0 obligations.*
- *Dry run listed only `20261117001000`; the push applied it.*
- *Readback: hosted ends at `20261117001000`; fingerprint `57 | ce502fe7…`, identical to the branch; gate `offer_terms` **off** with one audit row; 0 terms rows, answers, blocks and `awaiting_terms` requests; both guard triggers present; the constraint is widened; the answer command is signed-in only; no client writes terms or calls the internal rules.*
- *The push came before Codex's code review and the finance review, which the sequence in §10.6 put first, on the owner's instruction. Both reviews are still owed. The PR is not merged and the gate is not activated.*

**Rollback state check (read-only, counts only):**

```sql
select (select count(*) from public.service_requests where matching_status = 'awaiting_terms') as awaiting_terms,
       (select count(*) from public.job_offer_terms_responses where accepted) as accepted_terms,
       (select count(*) from private.offer_terms_blocks) as blocked_while_off,
       (select enabled from private.money_feature_gates where name = 'offer_terms') as gate_on;
```

## 11. Codex review of #154 and the forward fix (TRACE-150, 2026-11-09)

**Status: implemented for review.** Branch `claude/phase6-154-review-forward-fix` from `main` `762d6a4`. Migration `20261118001000_phase6_o10_review_forward_fix.sql` (additive). `20261116001000` and `20261117001000` are applied on hosted and are **not edited**. **Not pushed to hosted, not merged; the `offer_terms` gate stays off.** Each of those needs the owner's separate authorization. Phase 6 is not accepted.

### 11.1 The review this answers

| Item | Record |
|---|---|
| Reviewer and source | Codex, as relayed in the owner's implementation instruction of 2026-11-09. No GitHub review is recorded on #154 (0 reviews). |
| Commit reviewed | `main` at `762d6a480509c7e7bbe73cfdece309d865d4d20d` (merge of #154, 2026-11-09 16:43 UTC; production deployment of that SHA succeeded 16:44 UTC). |
| Coverage | PR #154: `6d56b22..762d6a4` (head `551c76f`; 27 files, +3,342/−47), meaning migration `20261117001000`, the O-10 client, SQL 116, `offer-terms-concurrency.mjs` and the records. Findings 1 and 2 also reach CS-3's `money_source` path. |
| Not covered by this record | Whether the review also covered #153 (CS-3, `98fe138..6d56b22`) or CS-4 (#149, `360e104..84f8d16`) is not stated. Those code reviews stay **owed** until Codex records them. **This is not the A1 review**, and it closes no other manifest row. |
| Findings | (1) a homeowner's recorded decline is lost when the re-match after it fails; (2) the current-catalog-price path remains for unbound one-time requests; (3) the required-scope rule (P-3) isn't enforced, because exact pricing and answered questions don't prove scope. |

### 11.2 Finding 1: the decline survives a failed re-match

- **Defect, reproduced.** `homeowner_respond_offer_terms` (and the E6 `homeowner_respond_replacement`) wrote the decline, withdrew the offer and unassigned the provider, then ran matching in the same transaction. When matching raised, everything rolled back: the request was left in `awaiting_terms` with the declined provider still assigned, and the homeowner's decline was lost. The realistic cause is F-O10-1: a provider save committing between matching's selection and offer creation. The race is now reproduced deterministically:
  - C22 in `offer-terms-concurrency.mjs` fails on O-10's definition with "Selected contractor/package is no longer eligible";
  - SQL 117 fails 17 assertions on it.
- **Fix.** `private.offer_terms_rematch(request, terms, via)` runs matching in a subtransaction. On any error, only the matching work rolls back:
  - The decline, the withdrawn offer and the unassignment are kept.
  - The request is `pending`/`awaiting_match` with `needs_admin_review`.
  - The failure is recorded in `private.offer_terms_rematch_failures`: append-only, with the error, the terms and the last attempt number. It is also logged on the request, and operators are notified.
- **Not actionable again.** The offer is withdrawn and the terms row is answered. The provider's acceptance gets "No open offer"; a second homeowner answer gets "You already answered these terms". Matching and retries never re-offer a provider with a closed attempt, and a force offer of the same content is refused.
- **Recovery.**
  - `admin_offer_terms_queue` lists the request as `rematch_failed` while it waits unassigned with no later attempt.
  - `admin_retry_offer_terms_matching` retries it with a key and a reason, whether or not the gate is on. With the gate off, matching still skips offers at other terms and records a gate block.
  - Admin screen: "Offers at other terms" shows the item with Retry matching.
- **Also changed.** A gate block counts as retried only by a retry made strictly after it. A retry of a failed re-match can record a block in its own transaction (same `now()`), and that block must stay listed.
- **Not changed (recorded, outside this brief).** `vendor_decline_job`, `release_job_match` and `expire_stale_matches` also re-match in the same transaction as the provider's decline or the expiry, so a failed re-match rolls back that action too. They are older paths, not homeowner declines. Proposed for Codex as a separate slice.

### 11.3 Finding 2: no current-catalog price for one-time requests

- `money_source`: a fixed one-time request (no quote, not a recurring visit) is priced only from its submission record (CS-3) or the accepted offer's terms (O-10). With neither, preview, publication and checkout refuse it by name: `one_time:terms_missing`, "This request's agreed price wasn't recorded; a new request or quote is required". The narrowed P-4 residue (F-O10-3) is removed. The earlier rule remains only for a fixed request that is neither one-time nor a recurring visit, which no product command prices.
- Older money fixtures that inserted scheduled one-time requests directly now carry the record `submit_service_requests` writes (pricing-v2, priced by `price_selection` from the package revision): SQL 023, 059 and 086. SQL 023's "in-place price edit" section characterized the removed rule (the request repriced to $110). It now asserts the bound-terms rule: the edit is refused by name at checkout, publication and preview, never priced. Owner maintenance then restores the bound level. Its second snapshot is a new review at the bound price.
- SQL 117 shows the refusal by name at preview, at publication and at checkout of an already published snapshot, both for a request whose record was removed and for a row with neither a record nor an offer.

### 11.4 Finding 3: required scope (P-3)

`private.offer_terms_required_work`, called by `offer_terms_build`, decides whether a candidate at other terms meets the request's required work. It reads only authoritative records:
- the submission record;
- the submitted package's level and add-on rows, which are immutable once in use (6.11A);
- their pricing-template links;
- the candidate's own level, lines and included work.

A candidate is offered only when all of these hold. Otherwise it is skipped (`required_work`, with what is missing named), and a force offer is refused: "This offering doesn't establish the work this request requires" (`offer_terms:required_work`).

1. **Submission record:** pricing-v2, exact. Without it nothing establishes the work asked for.
2. **Level:** a level submitted from a pricing template needs the same template level. A custom submitted level must name its included work.
3. **Included work:** every item the submitted offering and level included is included by the candidate, using the catalog's own normalized comparison, as `price_selection` uses.
4. **Required add-ons:** each add-on the submitted offering required is met by a candidate line of the same template add-on, at least the same quantity, or is named in the candidate's included work.

Optional add-ons the candidate doesn't meet are still omitted and disclosed (P-3, unchanged); the disclosure now lists only optional ones. The terms are `offer-terms-v2` and carry the evidence under `scope.required_work`. No terms rows exist on hosted (read-only, 2026-11-09).

**Consequences for Codex to confirm (conservative by design):**
- Custom offerings with no named included work can't be offered to another provider.
- A request without a submission record can't be offered a fixed candidate at other terms. Quote providers are unaffected.
- Text comparison of included work is exact after trimming and lower-casing, so "Edging" doesn't meet "Edge trimming".

SQL 116's fixtures now name the submitted offering's included work, as does SQL 012's request (a submission record for provider 1). The concurrency fixtures were updated the same way.

### 11.5 Evidence (isolated stack, synthetic)

- **Clean replay of 223 migrations; full SQL suite 108 files / 7,024 PASS.** SQL 117 (new) 53/53; SQL 116 100/100; SQL 012, 023, 059 and 086 pass with the updated fixtures.
- **Regression proof:** with O-10's `homeowner_respond_offer_terms` loaded (in a rolled-back transaction, or restored afterwards), SQL 117 fails 17 assertions and C22 fails, as described in 11.2.
- **Concurrency:** `offer-terms-concurrency.mjs` C14–C22 PASS (C22 new and deterministic: a test-only statement trigger holds the decline inside offer creation on an advisory lock until the provider's save has committed; removed afterwards). Related scripts PASS on the same replay: `bound-terms`, `pricing`, `recurring-payment`, `recurring-visit`, `recurring-cadence`, `fulfillment`, `exceptions`, `exception-resolutions`, `support`, `admin-operations`.
- **Money fingerprint:**
  - Before (`main` `762d6a4`, as recorded on hosted 2026-11-09): `57 | ce502fe7389eb2fdfa972bb38804fcfc`.
  - After, on the same 57-function list: `57 | 9a33e03b09303fc1acf77c519ce5f756`. Restoring the O-10 definitions of exactly six functions in a rolled-back transaction gives `ce502fe7…` again, so exactly these changed: `money_source` (finding 2), `offer_terms_build`, `one_time_offer_basis` and `create_job_offer_internal` (finding 3), `homeowner_respond_offer_terms` and `homeowner_respond_replacement` (finding 1). `find_eligible_packages_core`, `vendor_accept_job`, `offer_terms_problem` and `one_time_bound_problem` are unchanged.
  - The list adds `offer_terms_required_work`: new value **`58 | af0fae6e0c5b604e9073e10bc060957e`**. `offer_terms_rematch` isn't listed: it decides no price, only whether matching's failure undoes the decline.
- **Client:** unit 662/662 (2 new: the queue item and its retry rule); typecheck; lint; secret scan. Not run locally: browser suite and build (CI runs both).

### 11.6 Release (each step needs the owner's authorization; none is authorized here)

1. Codex reviews this fix (`762d6a4..` this branch's head).
2. Josh's sole-owner finance review (DEC-2026-064) on the new fingerprint (finance sheet).
3. Read-only pre-push check (0 open fixed one-time requests without a record; 0 terms rows); dry run; push `20261118001000`. It is additive. Between the push and the new client going live, the deployed admin screen would show a `rematch_failed` item with its generic "waited more than 24 hours" text and no retry button. That item can only arise from a decline of bound terms, and no terms exist while the gate is off (hosted: 0 terms rows), so with the gate off nothing is exposed. Money refusals are named for every client.
4. Merge; read back the production deployment.
5. Activation of `offer_terms` stays a separate owner decision (§10.6).
