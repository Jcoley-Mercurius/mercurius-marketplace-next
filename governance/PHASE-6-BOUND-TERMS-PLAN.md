# Phase 6 bound-terms plan: CS-4 (TRACE-127), CS-3 (TRACE-126) and the one-time CS-5 extension

**Status:** PLAN FOR CODEX REVIEW, 2026-11-05 (America/New_York). **Nothing here is implemented.** No money function, migration or test has changed. CS-4 and CS-3 each change fingerprinted money functions. Each waits for (1) Codex to clear this plan, (2) the reading in §2 R-1, (3) implementation and a Codex code review, (4) the two-person finance review (Josh + the accountant, not yet engaged, DEC-2026-060) and (5) the owner's authorization for the hosted dry run and push, before it merges. This is not Phase 6 acceptance.

**Base:** `main` `cbd65a7` (#146). Branch `claude/phase6-closeout-a1-packet`.

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
| **R-1** (owner confirms) | After 6.11A, what does DEC-2026-049 item 6's live refusal "package offered and not under review" require? | **The offering is still offered:** the bound revision's lineage has a live revision for the same provider and service, priced as fixed, not held in Package Reviews, that still offers a level at the visit's cadence. Price, level, add-ons and questions always come from the bound row and terms, never from the live revision. A paused, archived or removed lineage (no live revision), or a live revision held in review, still refuses with the existing named exception. | **Strict:** the exact bound row must be live. Then every save, including a rename, blocks payment for every unpaid visit of that plan, and CS-4 changes nothing on a real journey (F-B1, F-B3). | It decides whether a bound visit is payable, so it is a money rule, not only a code reading. Recommended owner wording: *"A visit or request priced at bound terms stays acceptable and payable at those terms while its provider still offers that service at that cadence (a live, unreviewed revision of the same offering). Pausing, archiving or removing the offering, or holding it in Package Reviews, still blocks it."* |
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
