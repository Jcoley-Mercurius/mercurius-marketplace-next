# Pilot standard commission 10% (DEC-2026-067, TRACE-160)

**Prepared:** 2026-11-23 (America/New_York) by Claude (implementer) on branch `claude/pilot-commission-10pct`, base `main` `ebc7de5` (#196). Independent of open #197.
**Status:** implemented and locally verified; **not reviewed, not released.** Nothing here is a finance sign-off, a hosted push, a merge, a deployment, a gate change or a vendor notice.

## 1. Decision and scope

DEC-2026-067 (owner, 2026-11-23): the pilot standard commission is **10%** of the final service subtotal after discounts and adjustments, excluding tax and tips, for future eligible bookings of existing and new vendors. One valid applied promotion halves the standard (DEC-2026-038), so the promotional rate is **5%**. Membership stays free; no lead fees, no paid placement; no expiry, subscription, new fee or changed basis. 7% is a possible future decision, not a fallback: nothing in the code moves to 7% (the snapshot check constraint admits only 1000 and 1500 bps, so any other rate needs a reviewed migration).

## 2. Every commission path, classified

Searches: `15%`, `15 percent`, `0.15`, `1500`, `750`, `85%`, `7.5%`, `92.5`, `*15/100`, `fee_percent`, `commission`, `take rate`, `platform fee`, `application fee`, `_bps`, across `src`, `supabase/functions`, `supabase/tests`, `scripts`, `tests`, governance and the **live function bodies** of a database replayed from `main` (`pg_proc.prosrc`), because many migrations restate functions and only the latest body matters.

| Where | What it was | Class | Action |
|---|---|---|---|
| `private.money_split` (live; `20261018005000`) | Ordinary fee `round(service × 15 / 100)` recomputed from the code at every capture, refund, chargeback, payout and reconciliation. **Not snapshotted.** Every money path reaches it: `money_process_payment_event`, `money_refund_reversal`, `money_resolve_chargeback_loss`, `money_provider_proceeds`/`money_payable`/`money_ach_payable`, `money_prepare_ach`, `money_obligation_reconciliation` (finance page, vendor earnings) | Active policy | Uses the rate stamped on the snapshot |
| `private.money_publish_snapshot` (only writer of `money_snapshots`; one-time, quote, offer-at-terms and recurring-visit bookings all publish through it) | Wrote no rate | Active policy | Stamps the policy rate; refuses a rate in the reviewed terms |
| `private.promotion_economics` (`20261018003000`) | `1500` ordinary / `750` promotional constants | Active policy | Reads the policy (1000 / 500) |
| `private.promotion_usage` | Relief against constant `1500` | Active policy | Relief against twice the redemption's own rate |
| `promotion_redemptions` / `money_snapshot_promotions` checks | `commission_rate_bps = 750` | Active constraint | `in (500, 750)` |
| `public.money_finance_reconciliation` | `'fee_percent', 15` | Active display value | Current standard, plus both rates and effective time |
| Older migrations' `*15/100` (`20260905…`–`20260923…`) | Superseded bodies, restated since | Historical evidence | Unchanged (old migrations are never edited) |
| `supabase/functions/_shared/platformFee.ts` | `PLATFORM_FEE_RATE = 0.15`, "single source of truth"; imported by no repository code, but it is the recovered source of the **hosted** August builds of `stripe-webhook` (v13) and `checkout-request`, pinned by digest in `EDGE-FUNCTION-INVENTORY.json` (DEC-2026-002) | Intentional exception: recovered hosted-source evidence | Kept byte-identical (the edge contract test requires it). See F-1 |
| `supabase/functions/_shared/money.ts` `fee()` | `× 15` constant; a TypeScript model used only by unit tests (the deployed checkout imports `checkout` only) | Model | Takes the stamped rate; no edge redeploy needed |
| `src/lib/promotionOffers.ts` `ORDINARY_/PROMOTIONAL_COMMISSION_BPS` | `1500`/`750`, exported, unused | Stale constant | Removed; labels come from the server's rate |
| `/vendors/apply` (twice), `/vendor` dashboard (twice), `/admin/promotions`, vendor offer approval (twice, one hardcoding "(7.5%)" beside a server amount), `/admin/finance` | "15%", "7.5% instead of 15%" | Active copy | One module, `src/lib/commission.ts`; the offer example now reads the server's `commission_rate_bps` |
| `public.invoices.platform_fee`/`vendor_payout`, `service_requests.platform_fee` (legacy app) | Stored amounts, no writer in live code | Historical record | Unchanged |
| Vendor earnings and statements, admin invoices | Show server amounts per booking | Follows snapshot | No change needed |
| Agreements, onboarding, email templates, FAQ, `/terms` | No commission rate stated. R0-ONBOARDING-STANDARD-V1 records (O2) that no separate vendor agreement exists | Not applicable | Nothing to update; no accepted version overwritten |
| CFG-005, CFG-008, MPS §7.2 and its acceptance line, roadmap, AGENTS.md, LAYERED-LAUNCH-DECISION, PHASE-6-PREPAID-PLANS-BRIEF (unbuilt plan), DEC-2026-038 | 15% / 85% / 7.5% | Active authority | Annotated with DEC-2026-067; original values kept as history |
| MPS-AUDIT, MPS-APPROVAL-CHECKLIST, PRICING-IMPROVEMENTS, PRICING-FINANCE-REVIEW §3–§5, PHASE-5-*, PHASE-6-EXCEPTIONS-BRIEF, PHASE-6-SOLE-OWNER-FINANCE-SHEET, PHASE-6-CLOSURE-REPORT, TRACEABILITY rows ≤ 159, HANDOFF entries, PRICING-CONTINUATION | Dated audits, reviews, sign-offs | Historical evidence | Unchanged (they describe what was reviewed then) |
| `globals.css`, animation delays, `waitForTimeout(1500)`, `sqft max 1500`, `$15 off` offer fixtures, `percent_bps 750` input parsing | Unrelated numbers | Unrelated | Unchanged |

No provider-specific rate, override, settings row or default exists anywhere (`information_schema.columns` and function bodies checked): every vendor, existing or new, gets the same policy rate.

## 3. Rate source, effective time and snapshot

- **Source:** `private.money_commission_policies` (migration `20261201001000`): append-only (update/delete refused by trigger), RLS on, no grants. Rows: `1500/750` from `-infinity` (history) and `1000/500` effective `now()` at the push. A check enforces promotional × 2 = standard. Readers: `private.money_standard_commission_bps()`, `…promotional…`, `…effective_at()`, all private.
- **Effective moment:** the commit of the hosted `supabase db push` of `20261201001000`, recorded in that row's `effective_at`. Readable afterwards with `scripts/commission-transition-inventory.sql`.
- **Snapshot:** `money_snapshots.commission_rate_bps`, stamped by `private.money_publish_snapshot` when the two-person review publishes the booking's invoice. Existing rows read **1500** through a metadata-only column default (no row is rewritten or updated, so the `immutable_evidence` trigger never fires); the default is then dropped, so a new row can get its rate only from publication. The column is not granted to homeowners (column-level grants). A promotional snapshot also keeps its redemption's own rate in `money_snapshot_promotions`.
- **Tampering:** reviewed terms naming `commission_rate_bps` are refused (`22023`), whatever the value. Checkout (`money_prepare_checkout`), the webhook and every refund, payout and reconciliation path take no rate input. A homeowner's total does not depend on the commission.
- **Application window:** the deployed app computes no commission; it only displays server amounts and the finance page's `fee_percent`. Between the push and the merge the old copy still says 15% while new invoices are stamped 10% (vendor-favorable). Merge promptly after the push (§7).

## 4. Worked examples (whole cents; round half away from zero)

| Case | Eligible | Discount | Homeowner pays | Base | Commission | Vendor (before separate deductions) | Subsidy | Evidence |
|---|---|---|---|---|---|---|---|---|
| Standard | $100.00 | – | $100.00 | $100.00 | **$10.00 (10%)** | **$90.00** | – | SQL 127 §2–3; unit `commission`, `money` |
| Standard + $7 tax + $10 tip | $100.00 | – | $117.00 | $100.00 | $10.00 | $90.00 + $10.00 tip | – | SQL 127 §3 |
| Mercurius-funded $10 | $100.00 | $10.00 | $90.00 | $100.00 | **$5.00 (5%)** | $95.00 | $10.00 | SQL 127 §2, §5 |
| Vendor-funded $10 | $100.00 | $10.00 | $90.00 | $90.00 | $4.50 (5%) | $85.50 | – | SQL 127 §2, §5 |
| Promotional package price | $100.00 | – | $100.00 | $100.00 | $5.00 | $95.00 | – | SQL 127 §2 |
| Historical (published before) | $100.00 | – | $100.00 | $100.00 | $15.00 (15%) | $85.00 | – | SQL 127 §4; rehearsal |
| Historical promotion, vendor $10 | $100.00 | $10.00 | $90.00 | $90.00 | $6.75 (7.5%) | $83.25 | – | rehearsal; SQL 086 (pinned) |

Promotional relief reported to operators: standard on the same base minus the promotional commission (vendor $10: $9.00 − $4.50 = $4.50). Relief is never applied to an ordinary booking and never twice: the snapshot records standard 1000 and promotional 500 once (SQL 127 §5).

**Rounding:** 10% of $33.33 = 333.3¢ → $3.33; 10% of $33.35 = 333.5¢ → $3.34; 10% of $0.05 = 0.5¢ → $0.01; 5% of $33.33 = 166.65¢ → $1.67; 5% of $0.30 = 1.5¢ → $0.02. For a 1500 stamp, `round(s × 1500 / 10000)` is the same rational as the old `round(s × 15 / 100)`, so historical amounts are identical.

**Refunds:** recomputed on the cumulative retained subtotal at the booking's own rate. 10%: $100 paid, $33.33 refunded → fee 10% of $66.67 = 666.7¢ → $6.67, provider $60.00 + tip; then the rest → $0. 15% booking refunded $40 after the change → 15% of $60 = $9.00, provider $51.00. Vendor-funded 5%, half refunded → $2.25 (SQL 127 §3–5).

## 5. Historical, accepted, recurring and outstanding bookings

| State at the push | Treatment | Why |
|---|---|---|
| Paid (captured) | Keeps 15% (7.5% promotional) for life: refunds, chargebacks, reversals, payout, statements, reconciliation | Stamped 1500; journals byte-identical across the migration (rehearsal) |
| Checkout attempted, not captured | Keeps its 15% stamp; publication already refuses repricing once a checkout exists | Existing rule (`Existing checkout requires reconciliation before repricing`) |
| Invoice published, no checkout attempt | Keeps its 15% stamp unless the two-person review publishes a new revision, which is stamped 10% | Stored terms are not silently rewritten. **Decision T-2** |
| Accepted booking, quote, offer at other terms or recurring plan with no invoice yet | Stamped 10% when its invoice is published | No homeowner- or vendor-accepted term carries a commission: bound terms, consent hashes, series terms and package approvals hold price and scope only. The homeowner's total is unchanged and the vendor's share rises. **Decision T-1** (implemented; confirm) |
| Recurring visits | Each visit has its own obligation and snapshot; visits published before keep 15%, later visits 10% | `money_recurring_occurrence_identities` (one snapshot per visit). Prepaid plans are not built |
| Promotion reserved at 7.5%, unpaid | Reported `commission_changed` ("this offer needs to be applied again"), refused at publication (`40001`), released by the existing unpaid sweep with "Commission rate changed before payment"; the homeowner can apply the same offer again at 5% | DEC-2026-042 refresh flow; no consent fabricated, nothing repriced. Reservations need the open gate, so none should exist (inventory confirms) |
| Approved promotion offers | Remain approved: the approval hash covers the offer's discount and scope, not the commission | The vendor saw a 7.5% worked example; at 5% the vendor receives more. **T-3** (whether to notify) |
| Legacy `invoices` rows | Stored amounts, untouched | No writer |

## 6. Evidence (synthetic data, local isolated stack)

- **SQL 127** (new): 78/78. Policy and its protections; economics and rounding; ordinary booking publish → capture → identical-event replay (no second charge, commission or journal) → partial and full refund; historical 15% booking with refunds after the change; existing provider's next booking at 10%; vendor- and Mercurius-funded promotions at 5% with refund; 7.5% reservation flow; finance page rates; vendor earnings amounts.
- **Legacy money suites**, pinned to the historical policy by one inserted policy row (and, for fixtures that write snapshots directly, the same 1500 default pre-existing rows receive): 003, 020, 024–027, 042, 044–050, 062, 068, 084, 086, 087, 090, 101, 102, 107 all pass with no assertion changed. Every existing money mechanic computes exactly as before on a 15% stamp.
- **Full SQL suite** on a clean replay of the branch (all 236 migrations): 119 files, 8,629 tests, PASS. Money concurrency scripts `pricing`, `phase5`, `phase5-payout`, `phase5-finance-command`, `phase5-finance-refund`: PASS.
- **Upgrade rehearsal** (`scripts/commission-upgrade-rehearsal/run.sh`): on a database replayed to `main`, commits a paid-and-refunded 15% booking, an unpaid published invoice, a paid 7.5% promotion and an unpaid 7.5% reservation; applies the real migration in one transaction; then shows the journals byte-identical, all three snapshots reading 1500, no default left, a refund after the migration at 15%, the unpaid invoice paid at its 15% stamp, the 7.5% promotion refunded at 7.5%, the reservation released, and the same provider's next booking at 10%. Passed.
- **Mutations against SQL 127:** 12 mutants; 11 caught (split ignoring the stamp; split reading today's policy; rate accepted from terms; superseded promotion published; promotion not halved; halved twice; relief against fixed 15%; no `commission_changed`; sweep ignoring the rate; finance page 15; truncating instead of rounding). M4 (rate taken from terms behind the refusal) is equivalent: unreachable while the refusal stands; with the refusal removed it is caught. Control passes.
- **Money fingerprint** (`scripts/promotion-money-fingerprint.sql`): `main` reproduces the reviewed `58 | af0fae6e0c5b604e9073e10bc060957e`; the same 58-function list on this branch reads `58 | 55c47785f79647a76059825abc151e25`; the list extended with the three rate readers reads **`61 | eb3f9702d45f9f22e61f6a7da17349c4`**.
- **Unit** 82 files / 1,311 tests; **lint**, **typecheck**, **secret scan** and **production build** pass. **Browser** (built with the CI fixture environment): `pricing-approval`, `finance-reconciliation`, `finance-commands`, `bank-statements`, `vendor-service-areas`, `vendor-readiness`, `vendor-earnings`: 93/93. The full browser and accessibility lanes are left to exact-head CI.

## 7. Release steps prepared (none performed)

1. **Finance review** (§9) and Codex review of the same commit.
2. **Inventory before the push (read-only):** `npx supabase db query --linked -f scripts/commission-transition-inventory.sql`. Expect 0 reservations at 750 and the gate closed; record the count of published-unpaid invoices for T-2. (Run 2026-11-24 00:4x UTC; results below.)
3. **Dry run:** `supabase db push --linked --dry-run`. Expect `20261201001000` only, or with #197's `20261130001000` if that has not been pushed. If `20261201001000` is pushed first, #197's older timestamp later needs `--include-all`; pushing #197's first avoids that.
4. **Push** with the owner's authorization: `supabase db push --linked`. This is the effective moment.
5. **Readback (read-only):** the inventory again (policy `1000/500 @ <push time>`; stamps all `1500` until the first new invoice) and the fingerprint (`61 | eb3f9702…` expected).
6. **Merge** (= Production deploy, DEC-2026-037) promptly after the push, so the copy matches; check `/vendors/apply`, `/vendor`, `/admin/finance`, `/admin/promotions` on Production.
7. **Not part of this release:** opening the promotions gate, republishing unpaid invoices (T-2), vendor notices (T-3), any real transaction.

**Hosted push performed (owner instruction 2026-11-23, "Please go ahead and push any migrations if any"):**

- *Inventory before (read-only):* 0 money snapshots (so 0 paid, 0 checkout attempts, 0 published-unpaid invoices), 0 recurring-visit snapshots, 0 promotion reservations or redemptions, gate closed, 0 approved offers, 0 ACH items, 1 legacy invoice (stored amounts), migration not applied.
- *Dry run:* first refused (`LegacyDbPushMissingLocalError`) because hosted already had #197's `20261130001000`, which this branch does not contain. `migration repair` was **not** used. #197's exact file was placed in the local migrations folder, uncommitted, for the history check only; the dry run then listed `20261201001000` alone. The file was removed afterwards.
- *Push:* `supabase db push --linked` 00:44:59–00:45:03 UTC on 2026-11-24 (19:45 ET on 2026-11-23); applied `20261201001000` only.
- *Readback (read-only):* migration applied; policy `1500/750 @ -infinity; 1000/500 @ 2026-11-24 00:45:03.001674+00`. **The 10% standard is effective from that moment.** 0 snapshots exist, so none carries a stamp yet. The money fingerprint reads `61 | eb3f9702d45f9f22e61f6a7da17349c4`, equal to the local value in §6.
- *Consequence for §5/§8:* no booking exists in any transition state, so T-2 has nothing to act on and the 7.5% reservation path is defensive only. Remaining: merge (step 6), Codex and finance review, T-1, T-3, F-1.

**Rollback limitations.** The migration is additive and the deployed app keeps working on it. Promoting the previous Vercel deployment reverts copy only; the rate stays 10% in the database. Returning to 15% (or moving to 7%) is a new reviewed migration that appends a policy row (and widens the snapshot check for 7%); the append-only table refuses edits. Snapshots stamped 10% in between stay 10% for life, by design. Do not drop the column or the table: historical stamps depend on them.

## 8. Decisions still needed

- **T-1 (owner):** confirm that bookings accepted before the push but invoiced after it are stamped 10% (implemented; vendor-favorable; homeowner unaffected).
- **T-2 (owner + finance):** invoices published before the push and still unpaid with no checkout attempt keep 15% unless finance republishes them at 10%. Recommendation: republish any the inventory finds, before the next pay link, so "future eligible bookings" holds; or record that they keep 15%.
- **T-3 (owner):** whether and how to tell vendors (no notice is sent by this change); vendors who approved promotion offers saw a 7.5% example.
- **F-1 (owner, hosted, not verified):** the inventory (captured 2026-09-03) lists the hosted `stripe-webhook` v13 as an August build that inserts legacy `invoices` rows with `platform_fee` from `platformFee.ts` at 15%. The R0 record still lists it "for redeploy" review. It writes only the legacy tables, not the money ledger, and only acts on legacy checkout sessions, but if it is still deployed and receiving Stripe events, its 15% is live outside this repository's control. A read-only `supabase functions list` (and the Stripe endpoint list) answers whether it is; decommissioning or redeploying it is a separate authorized hosted action. Nothing here changes it.
- **Finance (DEC-2026-064 condition):** the changed money definitions need renewed two-person review before they are relied on for R1 money; the earlier sole-owner approval covered `af0fae6e…`, not this change. The reviewers are named by Josh; neither may be the implementer.

## 9. Finance review package

Reviewers confirm, against the same commit and the fingerprint in §6:

- [ ] The 10%/5% policy and its effective-time row; append-only; no grants.
- [ ] `money_split`: the ordinary branch is the only change; a 1500 stamp gives the old amounts (diff against `20261018005000`).
- [ ] Publication stamps the policy rate; terms cannot carry one; a 7.5% reservation is refused and released, never repriced.
- [ ] Worked examples in §4 against SQL 127 and the rehearsal output.
- [ ] Historical and transition treatment in §5, and decisions T-1/T-2.
- [ ] Ledger: commission in `platform_revenue`, subsidy in `promotion_subsidy`, tax in `tax_liability`, provider share plus tips in `provider_payable`; replay creates nothing.
- [ ] Copy: `/vendors/apply`, `/vendor`, offer approval, Promotions and Finance pages say 10%/5% and show earlier bookings at their own rate.

| Reviewer (name) | Role | Date | Commit SHA | Fingerprint matches | Decision | Findings |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
