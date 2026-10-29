# Phase 6.6c — recurring visit payment timing, accepted-price integrity and payment exceptions

**Status:** IMPLEMENTED FOR REVIEW, 2026-10-27 (America/New_York), on branch `claude/phase6-6c-recurring-payments` from `main` `5e6d6ce` (PR #112 merge; main CI run `40515529609` green). **Not releasable yet:** the two-person finance review must finish before merge, and its reviewers are not yet named (§6). Nothing here activates payments, provisions finance authority, publishes a snapshot or merges. The migration was pushed to hosted on 2026-10-28 at the owner's instruction (§6).
**Governing decision:** DEC-2026-049 items 5 and 6 (existing visits), owner decision 2026-10-27; items 7 and 8 kept blocked, their proposed rules not approved. **Trace:** TRACE-125; follow-ups: TRACE-126 (one-time accepted-price exposure) and TRACE-127 (add-on visit acceptance after a price change). Parent record: [PHASE-6-RECURRING-VISITS.md](PHASE-6-RECURRING-VISITS.md) §8.

## 1. Outcome

Each recurring visit becomes payable on its own, only after its own provider acceptance, at the price the homeowner accepted for the plan (including add-ons). It is paid only through the existing two-person reviewed snapshot and the homeowner's explicit checkout. A later catalog edit cannot change that price or force a review at a new price. Inconsistent terms are refused, never substituted. Operations sees every accepted, unpaid visit from 24 hours before its appointment, separated into review missing, ready but unpaid, confirmed failure and unknown outcome. Nothing charges, cancels, starts, notifies or releases funds on its own.

## 2. Governing requirements

| Source | Requirement for this slice |
|---|---|
| DEC-2026-049 item 5 (2026-10-27) | Review only after the visit's own acceptance; existing two-person publication, no automatic publication; "review missing" and "ready but unpaid" from appointment − 24 h or at a later acceptance; existing failure/unknown classification and recovery; no automatic cancellation; no new homeowner notification; unpaid-start unchanged (a 6.7 acceptance item) |
| DEC-2026-049 item 6 (2026-10-27) | Existing visits keep the price and add-ons of the exact plan terms bound to their creation (never the latest acceptance), checked against the visit's accepted offer; catalog edits change neither the amount nor force a re-review at a new price; live eligibility refusals kept, named, with recovery; new visits keep `terms_changed` |
| DEC-2026-049 items 7–8 | Quote-priced, promotional and replacement-provider visits stay unpayable; proposed rules not approved |
| MPS §6.4, §6.5 | Auditable occurrences; server-side snapshots; idempotent payment operations reconciled to events; role-appropriate money states |
| DEC-2026-034 | Agreed prices are unchanged by operator corrections (one-time conflict tracked as TRACE-126) |
| DEC-2026-045 G6 | Confirmed failure is distinct from processing/unknown; a browser return is not payment |
| DEC-2026-015 §3, DEC-2026-038/041, CFG-005 | Two-person finance review of money-path changes; promotions gate stays closed |
| CFG-008, CFG-014 | Payout unchanged; no checkout without admission |
| DEC-2026-037 | Hosted migration pushed before merge with owner authorization; merge is release |

## 3. Characterization (before this slice)

| Step | Behavior before 6.6c |
|---|---|
| 1. Accepted plan terms | `private.recurring_series_terms` row written when the plan provider's acceptance is recorded (append-only). |
| 2. Created visit | `create_recurring_visit_core` refuses `terms_changed` against current catalog values; copies the terms' `pricing_inputs`; the `created` generation row links `occurrence_id` → `terms_id`; the offer carries `base_price = visit_price`, `effective_price = visit_total`. |
| 3. Provider acceptance | `vendor_accept_job` on the visit's own offer schedules it. |
| 4. Commercial source | `money_source` refuses anything not scheduled with a provider, so review could already start only after acceptance. For a fixed offering it priced from the **current** tier. |
| 5. Publication | `money_publish_snapshot` (service_role): two distinct finance actors, a separately approved exact command, the source re-run under the request lock, identical retries return the same snapshot, repricing refused once a checkout attempt exists. |
| 6. Checkout | The snapshot is the invoice. `money_prepare_checkout` re-runs `money_source` on the first attempt and refuses if the hash changed; one open attempt per obligation. |
| 7. Readback | `recurring_series` reported `paid` when `captured > 0`. `admin_quote_queue` listed `payment_failed`/`payment_unresolved` for every obligation. |

| # | Finding | Status after 6.6c |
|---|---|---|
| F1 | A visit without add-ons was priced from the current tier price. | **Fixed:** priced from the bound terms. |
| F2 | A visit with add-ons was refused after any revision or tier price change. | **Fixed for payment:** priced from the bound terms. See F11 for acceptance. |
| F3 | Source evidence embedded the current package, tier and question rows, so any edit refused the first checkout of a published snapshot. | **Fixed for visits:** the evidence holds only the bound terms and the accepted offer. |
| F4 | No app or Edge path publishes a snapshot; hosted has 0 `money_authorities`. | Unchanged; activation dependency (§6). |
| F5 | The homeowner had no in-app way to pay a visit. | **Fixed:** "Review and pay" links into the existing `/checkout/{snapshot}` review. |
| F6 | Checkout is disabled unless `MERCURIUS_MONEY_MODE=test` with an `sk_test_` key. | Unchanged. |
| F7 | Readback treated a partial capture as paid. | **Fixed:** `paid` needs the whole snapshot total captured. |
| F8 | Snapshot expiry is not tied to the appointment. | Unchanged. An expired snapshot shows as review missing (`snapshot_expired`). |
| F9 | One-time requests have the same current-price exposure; DEC-2026-034 conflict. | **Not changed.** Separate corrective issue TRACE-126; characterized in SQL 097. |
| F10 | A stable queue cannot call `money_source` (it locks tables). | **Resolved:** one lock-free rule, `private.recurring_visit_source_check`, used by `money_source` (after its locks), the readback and the queue. |
| F11 | **New (characterized, unchanged):** after a price or add-on change, an add-on visit's offer bound to the old revision cannot be **accepted** (`vendor_accept_job` → "Provider is no longer eligible", because `find_eligible_packages_core` matches a bound request only at its revision and price). A visit without add-ons is accepted. | A refusal, not a repricing: the visit stays offered and unpaid, and nothing is substituted. **Regression evidence:** SQL 097, "existing rule (unchanged): an add-on visit's offer bound to the old revision cannot be accepted after a price change; nothing is repriced" (`22023`). **Follow-up:** TRACE-127 (open), which needs an owner decision on whether an already-offered visit may be accepted at its bound terms after a catalog change. That is acceptance policy, outside 6.6c. |
| F12 | **New (pre-existing, one-time path):** `money_source` share-locks the package before the tier, while a tier edit locks the tier and then (review trigger) the package, so publication and a tier edit can deadlock. | PostgreSQL aborts one side; no wrong data. The visit branch locks tier before package and does not deadlock (concurrency script). The one-time path is unchanged; noted for TRACE-126. |
| F13 | **New (pre-existing UI):** at 320 px the homeowner header subtitle "Manage your Mercurius services" was 4.49:1 (needs 4.5:1). The header was 95% opaque with a blur, so scrolled content tinted its background. | **Fixed:** the homeowner header is opaque (`bg-background`). The 320 px browser test runs the full-page scan. The vendor layout header uses the same translucent pattern and was not changed or scanned here. |

## 4. Owner decisions (DEC-2026-049, 2026-10-27)

Recorded in [DECISION-LOG.md](DECISION-LOG.md). Items 5 and 6 (existing visits) are approved as listed in §2. Items 7 and 8 are kept blocked; their proposed rules are **not** approved. A homeowner re-acceptance flow for new terms is deferred.

**6.7 acceptance item recorded by this decision:** whether a visit may be started or worked while unpaid. 6.6c leaves unpaid-start behavior unchanged and does not set a permanent rule (PHASE-6-SCOPE, 6.7 row).

## 5. Implementation

Migration `20261027001000_phase6_recurring_payments.sql` (additive: new private functions, one new public read, three restated functions with unchanged signatures and grants):

| Object | Change |
|---|---|
| `private.recurring_visit_terms(visit)` | **New.** The terms row of the visit's `created` generation, joined on the same plan. Never the plan's latest acceptance. |
| `private.recurring_visit_payment_problem(code)` | **New.** The message and recovery for each exception code. |
| `private.recurring_visit_source_check(visit row)` | **New, the single rule set for a visit's source.** It returns a code on the first failing check. **Blocked plan types:** `terms_missing`, `quote_terms`, `promotion_decision`, `replacement_provider`. **Consistency with the accepted offer and bound terms:** `offer_mismatch`, `terms_inconsistent` (the visit's customer, package, level, cadence, property, service, answers or priced selection; whole-cent amounts; add-on lines summing to `visit_total − visit_price`). **Live eligibility:** `provider_inactive`, `service_inactive`, `coverage_inactive`, `provider_zip`, `package_in_review`, `package_unavailable`. If no check fails, it returns the service and add-on cents **from the terms** and the immutable evidence. It never reads the current tier or add-on price. |
| `private.money_source` | **Restated.** A branch for a visit only: share-locks the rows the check reads (tier before package, F12), calls the check, and raises its message (`DETAIL recurring_visit:<code>`, `HINT` recovery). The evidence holds `recurring_terms` and `visit_offer`, not the current package or tier. The one-time and quote paths are byte-identical (the diff is the declare line and the inserted branch). |
| `private.money_payment_exceptions(at)` | **New.** The DEC-2026-045 G6 classification, moved out of `admin_quote_queue`. Its detail adds `obligation_id`, so both queues name the same obligation. One tie-break is added (§5a). |
| `public.admin_quote_queue` | **Restated.** The payment items come from the shared classification; everything else is unchanged. Parity is checked by `set_eq` in SQL 097. |
| `private.recurring_visit_payment(visit, at)` | **New.** The canonical state, with the visit's `obligation_id`: `not_accepted`, `review_pending`, `ready`, `processing`, `paid` (captured ≥ total), `failed`, `unknown` (G6 unresolved or a partial capture), or `cancelled`. `review_pending` carries one distinct operator reason, taken in this order: `held` (a dispute or refund), `source_blocked` (the terms fail the source check now, whatever the snapshot), `no_snapshot`, `snapshot_expired`. **`action`:** `pay` only for `ready`/`failed` with a current unexpired snapshot, a passing source check and an admitted homeowner; `continue` only for the visit's own open checkout session. Operations also get `problem` and `exception`. Legacy invoices are never read. |
| `private.recurring_payment_queue(at)`, `public.admin_recurring_payment_queue()` | **New, read-only, admin only.** `review_missing` (with its distinct `reason`) and `ready_unpaid` from `greatest(appointment − 24 h, acceptance)`, with `aged` meaning the appointment has passed. `payment_failed` and `payment_unresolved` appear at once with the G6 clocks. Every item carries `obligation_id`. The operator titles are distinct: "Visit terms blocked", "Visit needs commercial review", "Visit price review expired", "Visit payment held". |
| `public.recurring_series` | **Restated.** Adds per-visit `payment_state` (no `problem`/`exception` for the homeowner; null for the provider). `payment` keeps its three values; `paid` now needs the whole total. |

**UI:**
- `RecurringVisitsPanel` shows each visit's payment line. A homeowner gets "Review and pay" or "Continue payment" as a link to the existing `/checkout/{snapshot}?mode=full` review, only when `action` is set. Operations see the exception and its recovery. The provider sees no payment.
- New `AdminRecurringPaymentQueue` on `/admin/requests`, beside the quote queue: read-only, with "Open visit", and failure/unknown wording reused from the quote queue.
- The manual-visit help text no longer says charging isn't set up.
- No new Edge function, no second payment path.

**Not changed:**
- **Money and payment paths:** `money_publish_snapshot` (both), `money_prepare_checkout` and its source guard, payment event processing, payout, refunds, ACH and the money gates.
- **Checkout environment:** the checkout handler and `MERCURIUS_MONEY_MODE`.
- **Other recurring work:** cadence and creation commands, `vendor_accept_job` (F11), notifications, Cron, cancellation, replacement, quote and promotion plans, and prepaid bundles.
- **The one-time source path** (TRACE-126).

**5a. Tie-break for "latest attempt".** The G6 classification (and the visit payment state) reads each obligation's latest checkout attempt. Before: `order by created_at desc, id desc`. Now: `order by created_at desc, attempt_number desc, id desc`.
- **Distinct `created_at`** (every production checkout: each `money_prepare_checkout` is its own transaction): the newest attempt wins, exactly as before.
- **Equal `created_at`** (attempts made in one transaction, where `now()` is fixed): the higher `attempt_number` wins. `money_prepare_checkout` numbers attempts per snapshot and mode, and allows a new one only after the previous expired, so this is the retry. Previously the winner was decided by random UUID order. For example, an expired attempt 1 could be read as latest after attempt 2 was opened, reporting `payment_failed` instead of processing, or hiding a flagged attempt 2's unknown outcome.
- **Equal `created_at` and equal `attempt_number`** (only for different snapshots or modes in one transaction, which no command does): `id` decides, deterministically for a given pair but not meaningfully. No supported path reaches this case.

Tests: SQL 097 "the two attempts tie on created_at; the retry is attempt 2", "which is processing", "the outcome is unknown, not failed or paid", "and is queued as unresolved", and the quote-queue parity `set_eq`. Before the tie-break, 5 of these assertions failed intermittently in the full-suite run.

**Money fingerprint** (`scripts/promotion-money-fingerprint.sql`): it gains the changed commercial-source helpers `private.recurring_visit_terms`, `private.recurring_visit_source_check` and `private.recurring_visit_payment_problem` (whose text the source check raises), and `money_source` is restated. The value is `45 | 34c51131e2ca18f65d3b29afd8d12e11` (§8).

**Read-only, outside the fingerprint:** `money_payment_exceptions`, `recurring_visit_payment`, `recurring_payment_queue`, `admin_recurring_payment_queue`, `admin_quote_queue` and `recurring_series`. They classify and display. They decide no amount and write nothing (SQL 097 checks money, invoice and review row counts). Reviewers should still read them, because they choose when the homeowner is offered a pay link.

## 6. Gates and deployment order

1. **Codex review** of this diff.
2. **Two-person finance review before merge (owner decision 2026-10-27). OPEN: reviewer identities unresolved.** The owner names two reviewers. Neither may be the implementer; one may be Josh, and the second must be a different person. They review the restated `money_source`, the source check and the terms helper (PRICING-FINANCE-REVIEW §2/§10 TRACE-125) and sign off at the reviewed commit SHA and fingerprint. Local implementation and testing proceeded while this is arranged.
3. **Hosted migration**, with separate owner authorization:
   - Read-only check that hosted still has 0 visits, snapshots and checkout attempts. If any visit snapshot exists, stop and characterize it.
   - `supabase db push --linked --dry-run`, which should list only `20261027001000`.
   - `supabase db push --linked`.
   - Read back: grants (private functions not callable by clients, the queue not callable by anon), the fingerprint equal to the reviewed value, and the counts unchanged.
4. **Merge** (release; Vercel deploys `main`), with separate authorization.
5. **Not authorized here and not part of 6.6c:** finance-authority provisioning, a snapshot publication UI or trusted publisher (F4), payment activation (`MERCURIUS_MONEY_MODE`/Stripe), notification delivery, hosted writes, production transactions, and opening the promotions gate.

**Hosted push, 2026-10-28, at the owner's instruction:**
- **Before the push** (read-only): hosted history ended at `20261026002000`, with 0 visits, snapshots, checkout attempts, obligations and `money_authorities`, and 0 open money gates. Nothing needed characterizing first.
- **Push:** the dry run listed only `20261027001000_phase6_recurring_payments.sql`, and `supabase db push --linked` applied it.
- **Read back:**
  - History ends at `20261027001000`.
  - Money fingerprint `45 | 34c51131e2ca18f65d3b29afd8d12e11`, equal to the branch and clean-replay value.
  - `admin_recurring_payment_queue` is executable by authenticated, not by anon. `recurring_visit_terms`, `recurring_visit_source_check`, `recurring_visit_payment`, `money_payment_exceptions` and `recurring_payment_queue` are not executable by authenticated. `recurring_series` is not anon. `admin_quote_queue` is authenticated-only and uses the shared classification. `money_source` contains the visit branch.
  - Counts are unchanged (all 0).
  - The dry run now reports up to date.
- **Still open:** the finance review before merge (reviewers unnamed) and the merge itself. No payment is activated; the promotions gate stays closed.

**Compatibility:** the deployed PR #112 client works on the new schema, because `payment` keeps its values and `payment_state` is additive. Between push and deploy, the visible difference is that the live `admin_quote_queue` payment items are computed by the shared function, with identical output. **Rollback:** promote the previous deployment and keep the database forward; restoring the old `money_source` would reopen F1/F3.

## 7. Tests

**SQL `097_phase6_recurring_payments.sql`** (132 assertions; synthetic). It uses the real path: submit → plan acceptance → `admin_create_recurring_visit` → `vendor_accept_job` → two-person `money_publish_snapshot` → `money_prepare_checkout` → webhook events.

- **Access:** the private functions are not client- or service-callable; the queue is admin only (homeowner and provider get `42501`).
- **Eligibility after acceptance:** an offered visit has no source, cannot be published, shows `not_accepted` and never enters the queue.
- **Price edits:**
  - A tier correction after creation, before acceptance, gives `service` 4000 and add-on 500 from the bound terms. The evidence names the terms and carries no package or tier row. Reviewers cannot publish the corrected price.
  - A publication retry returns the same snapshot.
  - Tier price, add-on price, package name/description and tier name edits after publication leave the hash unchanged. The first checkout then succeeds at $40, a repeated checkout returns the same attempt, and another homeowner is refused.
  - Republishing after checkout is refused.
  - States move processing → paid; a duplicate capture is idempotent and captures once. Other visits and the plan get no obligation.
  - F11 is characterized.
- **Plan re-acceptance after visit creation:** a second acceptance at $50 leaves earlier visits at $40. A visit created afterwards is bound to the new terms, and each visit resolves its own creation's terms.
- **Eligibility refusals:**
  - Each refusal, named by `DETAIL`: package in review, package unavailable, provider ZIP, provider inactive, coverage inactive, service inactive, legacy package promotion. Each clears at the same price once resolved.
  - After publication, an ineligible provider refuses checkout. The state is `review_pending/source_blocked` with no action, and the queue names `provider_inactive`. Payable again once resolved.
- **Inconsistent terms:** changed answers, a changed priced selection and a different accepted-offer price are refused. A replacement provider is refused (item 8), as is a visit without a creation record.
- **Distinct reasons:** `source_blocked` (package in review, before and after publication), `no_snapshot`, `snapshot_expired`, and `held` (a dispute: no action, queued as held, ready again when released), each in the payment state and the queue item.
- **Obligation identity:** the recurring queue's `obligation_id` is the visit's obligation, equal to the quote queue's for the same failure/unknown item, with the same kind, clock and detail.
- **Queue timing:**
  - Absent at 24 h + 1 min before the appointment; present at exactly 24 h as `review_missing` (reason `no_snapshot`), since the threshold; `aged` after the appointment.
  - `ready_unpaid` after publication.
  - `snapshot_expired` after expiry.
  - Late acceptance: a manual visit 10 h away appears at once, since its acceptance.
  - Spring forward: the threshold is 24 elapsed hours (08:00 Eastern the day before).
- **Payment uncertainty:**
  - A webhook-confirmed expiry gives `failed` with a `pay` action, queued at once since the webhook. A retry is a new attempt.
  - A flagged attempt gives `unknown` with no action, queued as unresolved, and checkout stays closed. A session past expiry with no result is `unknown`.
  - The quote queue's payment items equal the shared classification.
- **Readback by role:** the homeowner sees `ready`, `pay` and the snapshot but no operations detail; legacy `payment` reads `paid`; the provider sees null; another homeowner is refused; operations see `review_pending`.
- **Reads write nothing:** money, invoice and review counts are unchanged, and no payment notice is sent.
- **One-time (TRACE-126):** priced from the current tier and package rows. A tier correction changes the unpublished price, and a non-price package edit refuses checkout of a published snapshot. These are the known exposure, asserted as-is.

**SQL 028** fixture visits gain an accepted offer, a terms row and a `created` generation row. They were inserted directly, and an unbound visit is now refused.

**Concurrency** (`scripts/recurring-payment-concurrency.mjs`, added to CI):
- 8 identical approved publications racing 4 tier and package edits give one snapshot at $40.
- 8 parallel checkouts give one attempt.
- A duplicated capture processed 4× in parallel, with queue and readback reads, captures once with one journal; the reads never fail.
- A plan pause racing a checkout: both succeed and the visit is processing.
- An unpublished visit has no obligation.

**Unit** `recurring-payments.test.ts` (payment line per role and state, checkout link only for `pay`/`continue`, queue labels reusing the G6 wording).

**Browser** `recurring-visits.spec.ts`:
- Homeowner at 320 px (full-page axe at 320 and 1440 px): ready, processing, unknown, review and paid states. Links appear only for ready and processing; no operations text.
- Operations: the queue with blocked, missing, expired and held reviews, ready, failed and unknown; "Appointment passed" and the recovery text; no charge, cancel or publish control.
- The provider gets null payment.

## 8. Evidence (2026-10-27, synthetic data only; final round after the Codex pre-push items)

| Check | Result |
|---|---|
| Clean replay of 202 migrations on the isolated stack (ports 5552x, `phase5-db.sh reset`) | Pass; history ends at `20261027001000` |
| Full SQL suite after the clean replay | 88 files, 5,228 assertions, PASS |
| SQL 097 | 132/132 (3 consecutive runs before the last assertion was added, then 1) |
| SQL 028, 086, 087, 090, 095, 096 with the migration | PASS |
| Money fingerprint (main local stack and clean replay) | `45 \| 34c51131e2ca18f65d3b29afd8d12e11` |
| `recurring-payment-concurrency`, `recurring-visit-concurrency`, `recurring-cadence-concurrency` on the isolated stack | PASS each. The payment script also passed 5/5 on the main stack in the first round; its first runs had found the publication/tier-edit deadlock (F12). |
| Full unit suite | 45 files, 539/539 |
| Typecheck, `eslint .`, secret scan, `git diff --check` (new files included) | Clean |
| Regenerated `database.types.ts` | Additive only (`admin_recurring_payment_queue`) |
| Synthetic build (fixture Supabase URL and anon key set explicitly, 1 worker) | Pass |
| Browser `recurring-visits.spec.ts` + `homeowner.spec.ts` | 21/21. Full-page axe at 320 px and 1440 px for the homeowner payment test; the 6.6a visit test (both widths) was updated for the changed help text. |
| Browser regression `appointments`, `phase4`, `matching`, `quote-proposals`, `portals`, `promotion-selection` | 61/66 in one run while the isolated stack replayed (16 min). The 5 failures were all `quote-proposals`; that spec then passed 12/12 alone on a quiet machine. |

**Not performed:**
- **Not run:** `@visual`, a human screen reader, real devices, the full non-visual browser suite.
- **Not done, needs authorization:** the hosted migration (owner authorization), the finance review (reviewers unnamed).
- **Not part of this slice:** any real payment, payout, refund, notification or scheduler activity.
