# Prepaid plans — slice brief (DEC-2026-048)

**Status:** PROPOSED slice brief, 2026-10-25. Not started. Governing decision: [DEC-2026-048](DECISION-LOG.md) (owner answers 2026-10-24; owner rules 2026-10-25). Nothing in PR #110 (TRACE-122) builds or activates any part of it.

## Outcome

A recurring price level can be sold as a prepaid bundle (a total price covering a number of visits, e.g. Quarterly: $135 for 4 cleanings): collected up front through the existing checkout, delivered as individually tracked visits, paid out per visit, refunded per visit share, renewed only by an explicit new payment.

## Dependencies

- **Phase 6.6 recurring operation** (PHASE-6-SCOPE): auditable visit identities, duplicate-safe occurrence generation and recurring charge timing. Prepaid visits must be 6.6 occurrences; this slice starts after 6.6's visit identity contract is merged. The contract is TRACE-123 ([record](PHASE-6-RECURRING-VISITS.md)): visit identity `private.recurring_visit_key(plan, Eastern date)` in `occurrence_key`, accepted terms in `private.recurring_series_terms` and attempts in `private.recurring_visit_generations`; per-visit allocations should reference the visit request and its identity.
- **6.7 fulfillment**: homeowner-confirmed completion per visit (payout eligibility starts 48 hours after it).
- **6.9 exceptions**: cancellation/rescheduling and provider cancellation under CFG-006/007, applied per visit share.
- **Promotions money path** (TRACE-115/116, `20261018005000`/`006000`): the 7.5% rule and subsidy allocation; the promotions gate stays closed until its own finance review passes.

## Rules to implement (DEC-2026-048, 2026-10-25)

1. Fee base: bundle service subtotal (bundle price plus prepaid add-ons, after discounts; excluding tax and tips); commission rule snapshotted once at purchase (15%, or 7.5% with one valid promotion); never reassessed per visit.
2. Cancellation per scheduled visit share: 72 h+ full, 24 to under 72 h 50%, under 24 h none; CFG-006 waivers apply; unscheduled unused visits refunded in full; plan cancellation evaluates each remaining visit.
3. Allocation once at purchase, whole cents, stable visit order, remainder cents to the earliest visits; service, add-ons, discounts, commission and subsidy allocated the same way and reconciling exactly; never recalculated from visits remaining.
4. Renewal: a new term and a new payment obligation; unpaid renewal activates nothing and authorizes no work; no automatic charge; provisional schedule shown as unpaid; current term and unused visits preserved; late payment re-checks availability and terms; duplicate-payment and duplicate-visit protection.
5. Payout per visit 48 hours after homeowner-confirmed completion, subject to existing holds (CFG-008).
6. Ending or nonrenewal never forfeits paid unused visits.
7. Provider cancellation follows CFG-007 replacement/refund, with no homeowner penalty.

## Expected records (for the slice to confirm with MTS)

Price-level billing mode (`per_visit` / `prepaid_bundle`, visits covered); a plan term (purchase snapshot, commission rule, totals); per-visit allocation rows (service, add-ons, discount, commission, subsidy cents) bound to 6.6 visit identities; renewal obligations keyed for idempotency. All money writes through reviewed security-definer commands; additive migrations.

## Required acceptance evidence

- SQL: allocation with and without remainders (e.g. $135/4, $100/3, $0.01 components), sums reconcile per component; commission snapshot ordinary vs promotional; no per-visit commission; cancellation at 72 h, just under 72 h, 24 h, just under 24 h, waived, unscheduled, whole-plan; provider cancellation without penalty; renewal unpaid / paid / paid late (availability or terms changed) / paid twice / generated twice; payout eligibility at completion + 48 h, held on dispute; role-negative access on every new command and readback.
- Concurrency: duplicate checkout completion, duplicate renewal payment and duplicate visit generation under parallel calls.
- Unit and browser: bundle totals on public profile and booking; operator/vendor editor billing mode; unpaid provisional renewal state; refund preview per visit; axe at 320 and 1440 px.
- Finance: two-person finance review of snapshot, allocation, ledger, refund and payout changes before any release flag opens; owner authorization for hosted migrations and activation.

## Gates and non-goals

Not in this slice without separate approval: saved cards or off-session charges, automatic renewal, Stripe Connect payouts, plan changes mid-term. The MPS §7 amendment for the billing mode is drafted with the implementation and approved before release.
