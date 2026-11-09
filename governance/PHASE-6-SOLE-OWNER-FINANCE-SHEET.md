# Finance review sheet: CS-4, CS-3 and O-10 (sole-owner review, DEC-2026-064)

**For:** Josh, as the sole finance reviewer for these three repairs (DEC-2026-064).
**Status: NOT PERFORMED.** This sheet prepares the review; it records no sign-off. It is not a two-person sign-off and must not be described as one.
**Prepared:** 2026-11-08, from the code on `claude/phase6-o10-offer-bound-terms`. Technical record: [bound-terms plan](PHASE-6-BOUND-TERMS-PLAN.md) §7.4 (CS-4), §8 (CS-3) and §10 (O-10).

## What these repairs decide

They decide **which price a homeowner pays**. None of them changes the 15% fee, tax, tips, how payment is captured, payouts or refunds.

| Repair | Plain-language rule | Live today? |
|---|---|---|
| **CS-4**, recurring visits | A visit offered at the plan's agreed price keeps that price if the provider later edits their catalog. A real problem still blocks payment: offering paused or archived, provider suspended, ZIP no longer covered. | **Yes.** Deployed 2026-11-06 *before* its finance and code reviews (missed gates, recorded in plan §9.1). Hosted has 0 visits, so no one has been charged under it. |
| **CS-3**, one-time requests at the submitted offering | The homeowner pays the price shown when they submitted, if the same provider's offering is still offered. Later catalog edits don't change it. | No (not merged, not on hosted). |
| **O-10**, one-time requests at another provider's terms | If the request goes to a different provider, offering or price, that provider's **complete** price is fixed when the offer is made. The provider accepts first. Then the **homeowner must accept those exact terms** before anything is scheduled or charged. Declining sends the request to the next provider. | No (not merged; switched off until you turn it on). |

## Worked examples (synthetic, from the tests)

1. **Same provider edits their price (CS-3/P-2).** The homeowner submitted at **$60**. The provider raises the price to $66 before accepting. The homeowner still pays **$60**.
2. **Another provider (O-10).** The homeowner submitted at $60 + $5 edge trimming = **$65**. The original provider stops offering it. Another provider's offering is **$70 + a required $10 haul-away = $80**.
   - The homeowner sees $80, that edge trimming isn't included, that no promotion applies, and that tax is confirmed before payment.
   - Nothing is charged unless they accept.
   - If that provider then raises their price to $100, the homeowner still pays **$80**.
3. **Declined.** The homeowner declines the $80 terms. The provider is unassigned and the same terms are never offered again. If the provider later offers $95, that is new terms and the homeowner must accept again.
4. **Replacement (E6).** A provider withdraws. A replacement works only at the same agreed amount, and the homeowner's acceptance now covers the replacement's exact terms.

## What to check

Tick each box only when you have checked it yourself. Leave it unticked otherwise.

- [ ] **Price source.** Every charge for a one-time request comes from either the price shown at submission or terms the homeowner explicitly accepted. Never from today's catalog price.
- [ ] **No silent repricing.** A provider editing their catalog after the offer never changes what the homeowner pays (examples 1 and 2).
- [ ] **Consent before charge.** For another provider's terms, provider acceptance alone never makes the request payable. Only the homeowner's answer to those exact terms does.
- [ ] **Nothing carried over.** Add-ons and promotions from the original offering aren't moved to another provider. Omitted add-ons are disclosed by name and price.
- [ ] **Unchanged money rules.** The fee (15%; 7.5% with a promotion, which stays switched off), tax (set by the two-person snapshot review), tips, capture, payout timing and refunds are unchanged.
- [ ] **Remaining gap.** TRACE-126 stays open for one narrow case: a request with neither a submission price nor any offer can still be priced from the current catalog. Product screens can't create one; hosted has none. Decide whether that is acceptable until it is removed.
- [ ] **CS-4 after the fact.** CS-4 is already live. Confirm whether its rule (a visit keeps the plan's agreed price after catalog edits) is acceptable now that you're reviewing it after deployment.
- [ ] **Fingerprint.** Record the money fingerprint you reviewed (below). If production later shows a different value, a money function changed after your review.

## Fingerprints (the "seal" on the money code)

| State | Functions | Fingerprint |
|---|---|---|
| CS-4, deployed on production (2026-11-07 readback) | 48 | `88c9a26077e7f8fb07e140f38d839f8c` |
| CS-3 (branch, not deployed) | 49 | `52bdfc2460999a2e796633e124d71bbf` |
| CS-3 + O-10 (this release, not deployed) | 57 | `ce502fe7389eb2fdfa972bb38804fcfc` |

`scripts/promotion-money-fingerprint.sql` computes them. O-10 changes exactly three earlier definitions (`money_source`, `vendor_accept_job`, `find_eligible_packages_core`) and adds eight.

## What this review does not authorize

The hosted migration pushes, the merge, turning on offers at other terms (the `offer_terms` switch), opening promotions, and Phase 6 acceptance. Each needs your separate authorization.

## Record of the review (fill in when performed)

- Reviewed by: Josh (sole owner, DEC-2026-064)
- Date and time (Eastern):
- Commit reviewed:
- Fingerprint reviewed:
- Outcome (approve / approve with conditions / reject) and conditions:
