# Finance review package: promotions in the money path (TRACE-115/116)

**Prepared:** 2026-10-20 (America/New_York) on branch `claude/pricing-revisions` (uncommitted working tree, base `main` `fdfb450`).
**Purpose:** the two-person finance review that DEC-2026-015 §3, DEC-2026-038, DEC-2026-041 and CFG-005 require before `private.money_feature_gates.promotions_checkout` is opened.
**Status: NOT REVIEWED.** Nothing here is a finance sign-off. Automated tests, the implementer's own checks (Claude) and code review (Codex) are evidence for the reviewers. None of them is the review.

## 1. What the review is, and who must do it

The repository requires a **two-person finance review** and does not name the reviewers. The money commands it gates enforce two distinct finance operators: `public.money_require_finance` needs an admin with a `money_authorities` row, and `money_require_review` needs a separately approved exact command. As of 2026-10-20, read-only on hosted: 2 admin accounts (both Josh's) and **0 `money_authorities` rows**. DEC-2026-025 (Josh as sole administrator) is an R0 exception that does not carry to R1.

**Remaining reviewer action (exact):**

1. Josh names two people who will each review this package independently. Josh may be one of them; the second must be a different person. Neither may be the implementer.
2. Each reviewer works through §9. They re-run the evidence in §8, or watch it run, check every worked example in §3–§6 against the code they cite, and records "approve" or "changes required" with their findings in the sign-off table (§10).
3. Both approvals are recorded against the same commit SHA, the same six migration files and the same deployed money-code fingerprint (§10). The split itself (`promotion_economics`, `promotion_discount`, `20261018003000`) and the eligible amount (`price_selection`, `20261018001000`) are money-changing too, so the sign-off covers all six files, not only `20261018005000`/`20261018006000`. Any change to a listed function after sign-off changes the fingerprint and needs a new review of that change; an earlier sign-off does not carry over.
4. Only then may Josh run the gate-opening statement in [PRICING-ROLLOUT.md](PRICING-ROLLOUT.md) step 9. Opening the gate is a separate owner action, not part of the review.

If the reviewers are meant to hold finance authority in production (to publish snapshots and run refunds afterwards), provisioning their `money_authorities` rows is a separate owner action. It is not needed to review the package.

## 2. Scope: every change affecting money behavior

| Migration | Object | Change | Restates |
|---|---|---|---|
| `20261018003000_promotion_offers.sql` | `private.promotion_economics`, `promotion_discount`, offers and redemptions tables | Split of an eligible amount: rate, base, commission, vendor proceeds, subsidy | new |
| `20261018005000_pricing_checkout_promotions.sql` | `private.money_feature_gates`, `money_gate` | The gate (closed) | new |
| | `private.money_split`, `money_provider_proceeds` | Fee and subsidy for a retained service amount; ordinary = `round(service × 15 / 100)` | new |
| | `public.money_snapshot_promotions` | Immutable promotion evidence per snapshot | new |
| | `money_ach_items.platform_subsidy`, balance check | `amount = service_retained + platform_subsidy − platform_fee + tip_retained` | widened |
| | `private.money_source` | Add-ons re-priced; promotion carried and revalidated | `20261018001000` |
| | `public.money_publish_snapshot` | Add-ons, discount and promotion terms must equal the source | `20260905010000` |
| | `public.money_check_journal` | `promotion_subsidy` account | latest |
| | `public.money_process_payment_event` | Earnings and refunds through `money_split`; commit at full capture; restore after full refund | latest |
| | `private.money_payable`, `money_payout_proceeds`, `money_ach_payable`, `money_ach_exceeds_proceeds`, `money_prepare_ach`, `money_refund_reversal`, `public.money_resolve_chargeback_loss`, `private.money_obligation_reconciliation` | Proceeds, fee and subsidy through `money_split` | latest |
| | `promotion_reserve`, `promotion_finalize`, `promotion_commit`, `promotion_restore_after_refund`, `promotion_release_on_cancel` (trigger), `promotion_release_unpaid`, `public.admin_restore_promotion` | Redemption lifecycle | `20261018003000` / new |
| `20261018006000_promotion_selection.sql` | `private.money_source` | Adds the homeowner-choice check (§7) | `20261018005000` |
| | `private.promotion_reserve` | Same checks through `promotion_evaluate`; an unmatched request is evaluated for its package's provider | `20261018005000` |
| | `private.promotion_release_unpaid` | Per-request and obligation locks, re-check, exactly once; also releases unpaid reservations whose offer ended, changed or was retired | `20261018005000` |
| | `public.submit_service_requests` | Reserves the chosen offer in the submission transaction | `20260928232242` |
| | `private.find_eligible_packages_core` | Bound requests matched only to their package, level and revision, at the price including add-ons | `20260905016000` |
| | `public.create_service_occurrence` | Visits keep the template's priced add-ons | `20260904004000` |
| | `promotion_selections`, `homeowner_*` commands, `run_promotion_release_sweep` | Homeowner choice and confirmation; cleanup entry point | new |

Every restated function is a full `create or replace`. Reviewers can diff it against the definition it replaces: `pg_get_functiondef` on a database at `20261016003000`, or the earlier migration named above. Changes are commented `DEC-2026-041` or `TRACE-116`.

**Unchanged and out of scope:** tax calculation and remittance, tips (100% to the provider), deposits, processor cost, CFG-006 cancellation charges, chargeback evidence handling, ACH transport. Legacy `package_promotions` overlays are still refused at checkout. No Credits ledger exists, so nothing can stack (DEC-2026-038).

## 3. Calculation: the split of one booking

`private.promotion_economics(eligible, discount, funding)`, all whole cents:

- rate = 1500 bps without a promotion, 750 bps with one;
- base = eligible − discount for vendor funding, otherwise eligible;
- commission = round(base × rate / 10000);
- vendor proceeds = base − commission;
- subsidy = discount for Mercurius funding, otherwise 0.

The homeowner pays eligible − discount for the service. Provider proceeds at payout are retained service + subsidy − fee + tip (`money_provider_proceeds`).

| Case | Eligible | Discount | Homeowner pays | Base | Commission | Vendor | Subsidy | Evidence |
|---|---|---|---|---|---|---|---|---|
| Ordinary | $100.00 | – | $100.00 | $100.00 | $15.00 (15%) | $85.00 | – | SQL 084 |
| Vendor-funded $10 | $100.00 | $10.00 | $90.00 | $90.00 | $6.75 | $83.25 | – | SQL 084, 086 (ledgers, payout) |
| Mercurius-funded $10 | $100.00 | $10.00 | $90.00 | $100.00 | $7.50 | $92.50 | $10.00 | SQL 084, 086 |
| Vendor 20%, $50 + two $15 add-ons | $80.00 | $16.00 | $64.00 | $64.00 | $4.80 | $59.20 | – | SQL 087 (reservation) |
| Mercurius $10, $50 + two add-ons | $80.00 | $10.00 | $70.00 | $80.00 | $6.00 | $74.00 | $10.00 | SQL 087 (source, snapshot, ledgers) |
| Ordinary, same $80 | $80.00 | – | $80.00 | $80.00 | $12.00 | $68.00 | – | SQL 087 |

The eligible amount is the exact service subtotal of the request, add-ons included: `pricing_inputs.total_cents` from the shared calculation, which `money_source` re-prices and requires to match. Tax and tips are never in it. A promotional package (`kind = package_price`) has no discount and pays 7.5% of its approved price.

## 4. Ledger treatment

At full capture (`money_process_payment_event`, earnings journal):

| Account | Ordinary $100 | Vendor-funded $10 | Mercurius-funded $10 |
|---|---|---|---|
| `customer_advance` (debit) | 10000 | 9000 | 9000 |
| `promotion_subsidy` (debit) | – | – | 1000 |
| `platform_revenue` (credit) | 1500 | 675 | 750 |
| `provider_payable` (credit) | 8500 | 8325 | 9250 |

Commission revenue and the subsidy are separate accounts, so the subsidy is never netted against commission. Reconciliation (`money_obligation_reconciliation`) checks `promotion_subsidy` against the expected subsidy for the retained share. SQL 086 and 087 assert an empty issue list after capture, partial refund and full refund. ACH statement items carry `platform_subsidy`, and the item balance check includes it.

## 5. Refunds from the original snapshot, and rounding

`money_split(obligation, retained_service)` scales the snapshot's commission and subsidy by the retained share of the snapshot subtotal:

- fee = round(commission × retained / subtotal);
- subsidy = round(subsidy × retained / subtotal).

A refund posts the difference between the split before and after it. The fee and subsidy remaining are always computed from the original snapshot and the cumulative retained amount, never from the previous step, so rounding cannot drift across several refunds. A vendor-funded discount is not cash: the homeowner can be refunded at most what they paid.

| Scenario (evidence) | Refund | Commission left | Subsidy left | Vendor proceeds left |
|---|---|---|---|---|
| Mercurius $10 on $100, $90 paid; half refund (SQL 086) | $45.00 | $3.75 | $5.00 | $46.25 |
| Mercurius $10 on $80, $70 paid; uneven refund (SQL 087) | $23.33 | round(600 × 4667/7000) = $4.00 | round(1000 × 4667/7000) = $6.67 | $46.67 + $6.67 − $4.00 = $49.34 |
| Same, then the remaining $46.67 (SQL 087) | $46.67 | $0.00 | $0.00 | $0.00 |
| Vendor-funded $10 on $100, full $90 refund (SQL 086) | $90.00 | $0.00 | – | $0.00 |

**Rounding:** whole cents, PostgreSQL `round()` on numeric, which rounds half away from zero, as in the reviewed `money_payable`. Cases checked in SQL 087:

- 7.5% of $30.00 = $2.25;
- 7.5% of $33.33 = 249.975 cents, rounded to $2.50;
- 15% of $33.33 = 499.95 cents, rounded to $5.00;
- a 20% discount on $33.33 = 666.6 cents, rounded to $6.67.

A percentage discount is rounded before the split, and the split uses the rounded discount.

**Reviewer check:** an ordinary snapshot has no `money_snapshot_promotions` row, so `money_split` returns `round(service × 15 / 100)` and no subsidy, exactly the previous formula. The full SQL suite (77 files at the 005 checkpoint; 78 with SQL 087) passes unchanged for every ordinary booking. Reviewers should confirm no ordinary path changed by diffing each restated function.

Lost chargebacks use the same split (`money_resolve_chargeback_loss`); refund reversals restore the shares they removed (`money_refund_reversal`).

## 6. Redemption lifecycle: cancellation, release and restoration

| Event | Redemption | Rule (DEC-2026-041 item 1) | Evidence |
|---|---|---|---|
| Homeowner submits with an offer | reserved | Eligibility, dates, limit and budget checked under the offer lock in the submission transaction; a different saving or revision refuses the whole plan | SQL 087; concurrency (last redemption via submission) |
| Homeowner replaces or removes the offer before checkout | old released ("Replaced/Removed by the homeowner"), new reserved | Atomic: a failed reserve rolls the release back | SQL 087; concurrency (cleanup against replacement) |
| Revalidated until the homeowner commits (first checkout attempt) | reserved | Same revision, within dates, first booking still true, same eligible amount and provider | SQL 086, 087 |
| Unpaid request cancelled | released | Trigger; never while a checkout attempt is open | SQL 086 |
| Terms expired unpaid, or offer ended, changed or retired before payment | released by cleanup | Exactly once, under request and obligation locks; homeowner must choose again | SQL 087; concurrency (six overlapping runs) |
| Full capture | finalized | Committed on the snapshot's terms; a later campaign change never reprices it | SQL 086, 087 |
| Full refund before service, nothing retained | restored | Automatic | SQL 086, 087 |
| Partial refund, retained charge, delivered service | stays finalized | Restored only by `admin_restore_promotion` with a documented reason | SQL 086 |

Restoration never extends dates or overrides eligibility; it only stops the redemption counting against the offer's limits and the homeowner's first-booking slot.

## 7. Homeowner choice and confirmation (TRACE-116)

`private.promotion_selections` records the homeowner's choice per request: applied (with a redemption), needs_homeowner (released by cleanup), or declined (the homeowner confirmed the price without an offer). `money_source` refuses the request, so no snapshot can be published and checkout cannot start, when:

- the choice is needs_homeowner;
- the applied redemption is not the active one;
- the confirmed amount differs from the source.

So the undiscounted amount is never charged without the homeowner's confirmation, and no other offer is ever substituted. Requests that never had an offer have no row and are unaffected.

## 8. Concurrency and idempotency evidence

`scripts/pricing-concurrency.mjs`, real parallel connections, three consecutive passes on 2026-10-20:

- **last redemption:** 8 direct reservations for 1 remaining use, so 1 succeeds;
- **budget:** $25 against $10 subsidies, so 2 of 8 succeed;
- **retries:** 6 parallel retries with one key create 1 redemption;
- **first booking:** one homeowner races two first-booking offers, so 1 succeeds;
- **intake race (TRACE-116):** 8 homeowners submit the offer with 1 use left. One request is created; the 7 refusals say `redemption_limit_reached` and leave no request;
- **overlapping cleanup:** 6 simultaneous cleanup runs over 6 ended reservations release each exactly once, with 6 release events and 6 homeowners asked to choose again;
- **cleanup against replacement:** 6 homeowners replace an ended offer while cleanup runs. Each request ends with the new offer reserved once and the old one released once.

Idempotency:

- submission replay returns the recorded result without reserving again (SQL 087);
- a reservation retried with its key returns the original;
- snapshot publication retries return the same snapshot (`money_publish_snapshot`);
- capture and refund events are processed once (`money_webhook_events`);
- the homeowner's retried choice returns `reused` (SQL 087);
- a second cleanup run releases nothing (SQL 087).

Lock order is the same on every path: request advisory lock, then obligation row, then redemption row. That covers checkout preparation, snapshot publication, matching, the homeowner choice and cleanup; capture locks obligation then redemption.

**Reproduce** (local disposable stack with the six migrations applied):

```sh
docker exec -i <db-container> psql -U postgres -d postgres < supabase/tests/084_promotion_offers.sql   # likewise 086, 087
npx supabase test db                                             # full suite
PRICING_DB_CONTAINER=<db-container> node scripts/pricing-concurrency.mjs
npx vitest run tests/unit/promotion-offers.test.ts tests/unit/promotion-selection.test.ts
```

## 9. Reviewer checklist

1. The economics formulas (§3) and the 7.5%/15% rule match DEC-2026-038 and CFG-005 for vendor funding, Mercurius funding, promotional packages and repeat bookings.
2. No ordinary booking changes: diff every restated function (§2) against its predecessor.
3. Refund, reversal and chargeback allocation (§5) follow DEC-2026-041 item 1 from the original snapshot; check the rounding at small amounts and at several sequential refunds.
4. Subsidy accounting (§4): posted apart from commission, reconciled, and on ACH items.
5. The lifecycle (§6) matches DEC-2026-041 items 1 and 3, including the operator exception.
6. The homeowner-choice gate (§7) prevents an undiscounted charge without confirmation.
7. Concurrency and idempotency (§8): the lock order is consistent, and the tests cover the races that matter.
8. Gate: promotions stay refused while closed (SQL 086, 087), and opening it is reversible (rollout step 9).
9. Open questions for the owner, listed in [PRICING-ROLLOUT.md](PRICING-ROLLOUT.md) §9, are acceptable to launch with or must be decided first.
10. **Late refund release after an automatic restoration (open, found in the pre-PR audit 2026-10-20).** A full refund before service restores the promotion (`promotion_restore_after_refund`). If that refund later fails at Stripe and finance *releases* it (`money_release_late_refund`), the booking keeps its payment again but the redemption stays `restored`: it no longer counts against the offer's limit or budget, or the homeowner's first-booking slot. DEC-2026-041 restores only after the homeowner *receives* a full refund. Decide before opening the gate: refuse the release while the redemption is restored (finance resends instead), or return the redemption to committed when the release is recorded (and say what happens if the slot was reused meanwhile). Unreachable while the gate is closed.
11. **Gate control is procedural.** `private.money_feature_gates` is writable only by the database owner; no client role or RPC can open it. Nothing in the database requires two reviewers before `enabled = true`; the control is this sign-off, the fingerprint check and the owner's statement in rollout §7. Decide whether that is acceptable, or whether opening needs a two-finance-operator command (which needs `money_authorities` rows, 0 on production today).

## 10. Sign-off

Record against:

- the commit SHA once committed;
- `sha256sum supabase/migrations/20261018001000_pricing_catalog_calculation.sql supabase/migrations/20261018002000_pricing_vendor_approval.sql supabase/migrations/20261018003000_promotion_offers.sql supabase/migrations/20261018004000_pricing_owner_decisions.sql supabase/migrations/20261018005000_pricing_checkout_promotions.sql supabase/migrations/20261018006000_promotion_selection.sql`;
- the deployed money-code fingerprint, `scripts/promotion-money-fingerprint.sql` (39 functions). On a clean replay of the uncommitted tree on 2026-10-20 it was `39 | b2bcf028bb1b955fd8644e7a73be3c32`; on production before the push it covers only the 16 pre-existing functions. Record the production value after the push, check it equals the reviewed rehearsal value, and re-run it immediately before opening the gate (rollout §7). A different value means a listed function changed: review again.

TRACE-123 (2026-10-25, `20261026001000`): `create_service_occurrence` now refuses and `admin_create_recurring_visit` carries a plan's priced add-on selection into each visit, offered only on the accepted package, level and revision. The list gains that function (40 functions), so the fingerprint differs from the 2026-10-20 rehearsal value; reviewers cover this change too (record the new value on the reviewed commit).

TRACE-124 (2026-10-27, `20261026002000`): the `admin_create_recurring_visit` body moves into `private.create_recurring_visit_core` (adds the recorded paused/stopped refusals and the cadence source; the pricing, offer and terms checks are unchanged) and `public.admin_create_cadence_visit` reaches the same core. Both join the list (42 functions); the local value on this branch is `42 | 1fe362b252a565ffe58d3f0ad36e1ee4`. Recurring visit charge timing (6.6c) is not built.

TRACE-125 (2026-10-27, `20261027001000`, **review required before merge**; owner decision DEC-2026-049 items 5–6):
- **The change.** `private.money_source` is restated with a branch for recurring visits only. A visit is priced from the plan terms bound to its creation (`private.recurring_visit_terms`), checked against its accepted offer by one rule (`private.recurring_visit_source_check`). Its evidence holds those immutable terms instead of the current package and tier rows, so catalog edits change neither the amount nor the source hash. Live eligibility still refuses; nothing is substituted.
- **Unchanged.** The one-time and quote paths are byte-identical (the one-time exposure is TRACE-126). Publication, checkout, capture, refunds and payout are unchanged.
- **Fingerprint.** Both new functions join the list (44 functions); the local value is `44 | f845be9c1a9505d03a2b21854e7bc937`.
- **Read-only, outside the fingerprint.** These classify and display and write nothing: `money_payment_exceptions` (the G6 classification moved out of `admin_quote_queue`, with an `attempt_number` tie-break), `recurring_visit_payment`, `recurring_payment_queue`, `admin_recurring_payment_queue`, the restated `admin_quote_queue` and `recurring_series`. Reviewers should read them because they decide when a homeowner is offered a pay link.
- **Evidence.** [PHASE-6-RECURRING-PAYMENTS-BRIEF.md](PHASE-6-RECURRING-PAYMENTS-BRIEF.md) §7–§8.
- **Reviewers.** Two people, not yet named by the owner; neither may be the implementer.

| Reviewer (name) | Role | Date | Commit SHA | File hashes match | Decision | Findings |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
