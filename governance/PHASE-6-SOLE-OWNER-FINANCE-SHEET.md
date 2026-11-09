# Finance review sheet: CS-4, CS-3 and O-10 (sole-owner review, DEC-2026-064)

**For:** Josh, as the sole finance reviewer for these three repairs (DEC-2026-064).
**Status: NOT PERFORMED.** This sheet prepares the review; it records no sign-off. It is not a two-person sign-off and must not be described as one.
**Prepared:** 2026-11-08, from the code on `claude/phase6-o10-offer-bound-terms`. **Updated 2026-11-09:** deployment state corrected (all three repairs are now live), and Codex's code review of #154 and its forward fix added. Technical record: [bound-terms plan](PHASE-6-BOUND-TERMS-PLAN.md) §7.4 (CS-4), §8 (CS-3), §10 (O-10) and §11 (review and forward fix).

## What these repairs decide

They decide **which price a homeowner pays**. None of them changes the 15% fee, tax, tips, how payment is captured, payouts or refunds.

| Repair | Plain-language rule | Live today? (2026-11-09) |
|---|---|---|
| **CS-4**, recurring visits | A visit offered at the plan's agreed price keeps that price if the provider later edits their catalog. A real problem still blocks payment: offering paused or archived, provider suspended, ZIP no longer covered. | **Yes.** Deployed 2026-11-06 (`98fe138`), *before* its finance and code reviews (missed gates, recorded in plan §9.1). |
| **CS-3**, one-time requests at the submitted offering | The homeowner pays the price shown when they submitted, if the same provider's offering is still offered. Later catalog edits don't change it. | **Yes.** Merged to `main` by #153 and deployed 2026-11-09 13:58 UTC (`6d56b22`). Its migration was already on hosted (no push record). Deployed *before* its finance review. |
| **O-10**, one-time requests at another provider's terms | If the request goes to a different provider, offering or price, that provider's **complete** price is fixed when the offer is made. The provider accepts first. Then the **homeowner must accept those exact terms** before anything is scheduled or charged. Declining sends the request to the next provider. | **Code live, switched off.** Merged by #154 and deployed 2026-11-09 16:44 UTC (`762d6a4`). Migration pushed to hosted 2026-11-09. The `offer_terms` switch is **off** (recorded readback 2026-11-09). With it off, no offer at other terms is made. Deployed *before* its finance review. |
| **Forward fix** for Codex's review of #154 | See "Code review" below. | **No.** Branch only: not pushed, not merged. |

**Hosted, read-only, 2026-11-09:** migration history ends at `20261117001000`; 0 bound-terms rows; 0 open (pending, matched or scheduled) fixed one-time requests. Completed or paid requests weren't counted in this read.

## Worked examples (synthetic, from the tests)

1. **Same provider edits their price (CS-3/P-2).** The homeowner submitted at **$60**. The provider raises the price to $66 before accepting. The homeowner still pays **$60**.
2. **Another provider (O-10).** The homeowner submitted at $60 + $5 edge trimming = **$65**. The original provider stops offering it. Another provider's offering is **$70 + a required $10 haul-away = $80**.
   - The homeowner sees $80, that edge trimming isn't included, that no promotion applies, and that tax is confirmed before payment.
   - Nothing is charged unless they accept.
   - If that provider then raises their price to $100, the homeowner still pays **$80**.
3. **Declined.** The homeowner declines the $80 terms. The provider is unassigned and the same terms are never offered again. If the provider later offers $95, that is new terms and the homeowner must accept again.
4. **Replacement (E6).** A provider withdraws. A replacement works only at the same agreed amount, and the homeowner's acceptance now covers the replacement's exact terms.
5. **Required work (forward fix).** The homeowner's offering required haul-away. Another provider without haul-away (as an add-on or included work) is **not** offered, however its price compares. Optional extras the homeowner chose may still be omitted, disclosed by name and price.

## What to check

Tick each box only when you have checked it yourself. Leave it unticked otherwise.

- [ ] **Price source.** Every charge for a one-time request comes from either the price shown at submission or terms the homeowner explicitly accepted. Never from today's catalog price.
- [ ] **No silent repricing.** A provider editing their catalog after the offer never changes what the homeowner pays (examples 1 and 2).
- [ ] **Consent before charge.** For another provider's terms, provider acceptance alone never makes the request payable. Only the homeowner's answer to those exact terms does.
- [ ] **Nothing carried over.** Add-ons and promotions from the original offering aren't moved to another provider. Omitted optional add-ons are disclosed by name and price. Required work is never omitted; such a provider isn't offered (example 5).
- [ ] **Unchanged money rules.** The fee (15%; 7.5% with a promotion, which stays switched off), tax (set by the two-person snapshot review), tips, capture, payout timing and refunds are unchanged.
- [ ] **Remaining gap closed (forward fix).** The narrow TRACE-126 case, a request with neither a submission price nor any offer priced from the current catalog, is removed in the forward fix: such a request is refused by name. Until the fix is released, the deployed code still has that case; hosted has no such request.
- [ ] **CS-4 after the fact.** CS-4 is already live. Confirm whether its rule (a visit keeps the plan's agreed price after catalog edits) is acceptable now that you're reviewing it after deployment.
- [ ] **Fingerprint.** Record the money fingerprint you reviewed (below). If production later shows a different value, a money function changed after your review.

## Fingerprints (the "seal" on the money code)

| State | Functions | Fingerprint |
|---|---|---|
| CS-4, deployed on production (2026-11-07 readback) | 48 | `88c9a26077e7f8fb07e140f38d839f8c` |
| CS-3 (deployed with #153; its own list) | 49 | `52bdfc2460999a2e796633e124d71bbf` |
| CS-3 + O-10, deployed with #154 (hosted readback 2026-11-09) | 57 | `ce502fe7389eb2fdfa972bb38804fcfc` |
| **Forward fix** (branch; not on hosted) | 58 | `af0fae6e0c5b604e9073e10bc060957e` |

`scripts/promotion-money-fingerprint.sql` computes them.
- O-10 changed exactly three earlier definitions (`money_source`, `vendor_accept_job`, `find_eligible_packages_core`) and added eight.
- The forward fix changes exactly six definitions on O-10's 57-function list (that list now reads `57 | 9a33e03b…`): `money_source`, `offer_terms_build`, `one_time_offer_basis`, `create_job_offer_internal`, `homeowner_respond_offer_terms` and `homeowner_respond_replacement`. It adds one, `offer_terms_required_work`. Restoring the six O-10 definitions gives `ce502fe7…` again.

If you review before the forward fix is released, record which value you reviewed. Reviewing the deployed `ce502fe7…` doesn't cover the fix, and reviewing `af0fae6e…` doesn't describe what is on production until the fix is pushed and merged.

## Code review attached to this sheet

| Item | Record |
|---|---|
| Review | Codex's code review of PR #154 (CS-3 + O-10 release), relayed in the owner's instruction of 2026-11-09. Not a GitHub review (PR #154 has 0 reviews). |
| Exact commit | `main` at `762d6a480509c7e7bbe73cfdece309d865d4d20d` (#154 merge; deployed to production 2026-11-09 16:44 UTC). |
| Coverage | `6d56b22..762d6a4`: migration `20261117001000`, the O-10 client, SQL 116, the concurrency script and records (27 files). Findings 1 and 2 also concern CS-3's payment path. |
| Not covered | Not stated for #153 (CS-3, `98fe138..6d56b22`) or CS-4 (#149). Those code reviews stay owed. **This is not the Phase 6 A1 review.** |
| Findings | 1. A homeowner's decline was lost when matching after it failed. 2. The current-catalog price remained for one-time requests with no binding. 3. Required scope wasn't enforced. |
| Fix | Branch `claude/phase6-154-review-forward-fix`, migration `20261118001000` (plan §11). Each finding is fixed and tested. **Not pushed, not merged.** The fix itself awaits Codex's review. |

## What this review does not authorize

The forward fix's hosted push and merge, turning on offers at other terms (the `offer_terms` switch), opening promotions, and Phase 6 acceptance. Each needs your separate authorization.

## Record of the review (fill in when performed)

- Reviewed by: Josh (sole owner, DEC-2026-064)
- Date and time (Eastern):
- Commit reviewed:
- Fingerprint reviewed:
- Outcome (approve / approve with conditions / reject) and conditions:
