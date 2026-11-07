# Phase 6 bound-terms plan: CS-4 (TRACE-127), CS-3 (TRACE-126) and the one-time CS-5 extension

**Status:** PLAN FOR CODEX REVIEW, 2026-11-05 (America/New_York). **Nothing here is implemented.** No money function, migration or test has changed. CS-4 and CS-3 each change fingerprinted money functions. Each waits for (1) Codex to clear this plan, (2) the reading in §2 R-1, (3) implementation and a Codex code review, (4) the two-person finance review (Josh + the accountant, not yet engaged, DEC-2026-060) and (5) the owner's authorization for the hosted dry run and push, before it merges. This is not Phase 6 acceptance.

*2026-11-06: Codex cleared the architecture with five required amendments, and the owner confirmed R-1 (DEC-2026-062). Both are recorded in §7, which governs CS-4 where it differs from §2–§3. CS-4 is implemented for review as TRACE-148. CS-3 is not implemented. The text above is kept as written.*

*2026-11-06 (later): CS-4 (#149) was merged into the closeout branch, now PR #150 to `main`, with no recorded Codex code review or finance review. CS-3 is implemented for review as TRACE-149 (§8); Codex hasn't reviewed §4 or R-2 to R-5. §8 records a finding that changes R-3 (F-C1) and an owner decision (O-10).*

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
