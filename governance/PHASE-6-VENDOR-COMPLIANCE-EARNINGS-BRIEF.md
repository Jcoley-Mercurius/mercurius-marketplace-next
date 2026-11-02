# Phase 6.12 — vendor compliance/renewal next actions and earnings/statements/ACH exceptions (TRACE-135)

Date: 2026-11-01 (America/New_York). Branch `claude/phase6-12-vendor-compliance`, stacked on the 6.11B
head `c3a0668` (`claude/phase6-11a-offering-boundaries`, which carries 6.11A and 6.11B). Main is `ad4656b`
(6.10, PR #125). These notes approve no policy. Proposed policy is DEC-2026-056 (PROPOSED, §7).

## 1. Checkpoint reconciliation (verified 2026-11-01)

| Item | Evidence |
|---|---|
| 6.10 on `main` | PR #125 merged as `ad4656b` 23:44 UTC; Vercel production deployment `mercurius-marketplace-next-240lcgvep` is READY with `githubCommitSha ad4656b`. |
| `main` CI for `ad4656b` | push run 41363559823 **failed**: one browser test, `invitation-operations.spec.ts:185`, "Response has been disposed" (backend and lifecycle green). Same flake as below (F612-9). |
| PR #126 (`claude/phase6-11-vendor-offerings` → `main`) | head `26adbd6` (= PR #123 merge). Push run 41359562001 failed on `onboarding-checklist.spec.ts:156` (same flake, 634 passed); pull_request run 41363990097 on the same head is **green** (backend, lifecycle, application). |
| PR #126 scope | **6.11A only.** PR #124 (6.11B) merged 23:11 UTC into `claude/phase6-11a-offering-boundaries` *after* #123 had already merged that branch (22:55 UTC), so 6.11B (`b6021ea`, `5e6bc85`, `9a3ceca`, merge `c3a0668`) is not in #126. Route to `main` is an owner decision (§9). |
| Hosted migrations | `supabase migration list --linked` (read-only): history ends at `20261103001000`. `20261104001000` (6.11A) and `20261105001000` (6.11B) are **not applied**. A branch merge deployed nothing to hosted. |

## 2. Authorities

MPS §5.5 (provider-funds state `not_eligible → held → eligible → scheduled → paid | payout_failed | reversed`;
never an ambiguous `released`), §6.5 (vendor sees accurate, role-appropriate money states), §6.7, §7.7, §8
(activation checklist; DEC-2026-047 exception), §9 (payout exception and compliance expiry queues). CFG-008
(weekly direct ACH; eligible 48 h after homeowner-confirmed completion; disputes held; no reserve). DEC-2026-047
(+ amendment 2026-10-25): an exception is documentation pending, expires at the end of its follow-up date
(America/New_York), never verification, never automatically renewed. Owner decision 2026-09-13: lapsed payout
onboarding holds payouts; 30-day renewal notice. TRACE-060/061/069/072/073/078/080 contracts.

## 3. Characterization — compliance

| ID | Finding | Evidence |
|---|---|---|
| F612-1 | **Live.** The vendor renewal notice words a temporary exception as a document on file being renewed ("License · Expires in N days … Upload your renewed documents"). Exceptions are ordinary `vendor_compliance_evidence` rows (`requirement_version='exception'`) and `vendor_own_evidence_renewal` did not distinguish them. | Hosted read-only: 2 exceptions (license, insurance), both active providers, unexpired, both returned by `private.vendor_renewal_items` to the vendor notice. |
| F612-2 | Exception dates read one day late. `expires_at` is 00:00 Eastern on the day **after** the follow-up date; the notice printed `expires_at` with the browser's timezone. Other dates also used the browser timezone. | `checklist_exception_expires_at`; `formatRenewalDate` (no `timeZone`). |
| F612-3 | A vendor could not see missing, awaiting-review or declined items in one place. The notice lists only items inside the 30-day window; the documents page lists uploads only. | `vendor_own_evidence_renewal`, `vendor_own_renewal_documents`. |
| F612-4 | Scoped (service/ZIP) compliance is not vendor-visible. `vendor_category_evidence_current` is false whenever requirements are absent; hosted has 0 requirements and cutover is not enforced. Exceptions never satisfy scoped requirements (requirement version differs), as DEC-2026-047 requires. **Unchanged**; showing it now would tell every vendor they are non-compliant. | Hosted: 0 `vendor_compliance_requirements`, `cutover_enforced=false`. |
| F612-5 | Matching for onboarded providers already requires active status + nine current items (`vendor_is_eligible`) regardless of cutover; providers without an onboarding record keep legacy behavior. Payout eligibility additionally requires **active** status and current payout onboarding (`vendor_payout_eligible`), so a suspended provider is payout-held. | Migrations 20260905002000, 20260913002000. |
| F612-8 | Private documents: `vendor-documents` has only an operator SELECT policy; the anonymous upload policy was removed (20260915001000); vendors upload through server-issued grants and read back only file name, time, state and decline note. | Migrations; SQL 040 (existing). Not re-probed against hosted storage in this session. |

Hosted counts (read-only, aggregates only): 16 onboarding records (6 active, 9 review, 1 rejected), 64 evidence rows, 2 exceptions, 8 renewal documents, 0 scoped requirements, 13 linked providers.

## 4. Characterization — earnings, statements, ACH

| ID | Finding |
|---|---|
| F612-6 | The vendor dashboard's "Released earnings" card sums legacy `invoices.status='released'` (`get_vendor_earnings_metrics`, owner-or-admin checked, so isolated). This is the ambiguous `released` meaning MPS §5.5 forbids and a legacy invoice source requirement 4 excludes. Hosted: 1 invoice, 0 released. |
| F612-7 | No vendor-scoped money readback exists. `money_finance_operations`/`money_finance_reconciliation` are operator-only. `job_fulfillment` (6.7) already gives a vendor a per-job payout state from `private.money_ach_payable` (eligible, awaiting confirmation, confirmation window, payment incomplete, onboarding, paid, held …) but knows nothing about prepared/submitted/unknown/failed/returned transfers. |
| F612-10 | Payee is `private.money_effective_contractor(obligation)`, which differs from `money_obligations.contractor_id` after a provider replacement. A vendor money readback must scope on the effective payee, not the obligation's original provider. |
| F612-11 | `money_payable` writes (records completion) and raises; it cannot back a read. `private.money_ach_payable` is a stable read-only classifier (13 blockers) and is in the money fingerprint; calling it does not change it. |
| F612-12 | ACH model: one `money_ach_items` row per obligation (unique), attempts `prepared → submitted → unknown/settled/failed`, `settled → returned`, retries as new attempts; withdrawals, late settlements and payout recoveries are separate reviewed records. Bank statements are Mercurius's own bank reconciliation, not vendor statements. |

Hosted: 0 obligations, 0 confirmations, 0 ACH batches/items/attempts, 0 holds, 0 bank statements, **0 `money_authorities`** (no finance operator can prepare a batch). No vendor has money to show today.

## 5. Approved requirements and acceptance criteria

1. Upload is not verification; an exception is documentation pending, never a verified license or insurance (DEC-2026-047). *AC:* every exception is labelled "Exception: document pending", says it is not verified, shows its Eastern follow-up date; no "recorded/reviewed" claim for an exception; a lapsed exception says no verified document is on file.
2. No automatic renewal, activation or waiver; operator review, expiry, scoped evidence and exception history preserved. *AC:* readbacks are `stable`, write nothing (SQL fingerprint of evidence, exceptions, documents, decisions, onboarding, roles, notifications unchanged).
3. Vendor A/B isolation server-side. *AC:* readbacks take no provider parameter; resolve from `auth.uid()`; anon/homeowner refused; another provider's ids, files and notes absent; evidence references, requirement versions, exception reasons, approvers, actors and storage paths absent.
4. Earnings from reviewed canonical records only (`money_obligations`, snapshots, retained parts, `money_provider_proceeds`, ACH items/attempts). *AC (6.12B):* no amount from `service_requests` totals or `invoices`.
5. Provider-funds states distinguished (MPS §5.5). *AC (6.12B):* pending service proceeds, eligible, held (with category), in a prepared transfer, sent/awaiting bank, paid (settled), failed, returned, unknown — never summed across attempts; an unknown outcome is never "paid" or "failed".
6. 48-hour rule and every hold preserved by reading `money_ach_payable`, never re-deriving it.
7. Reuse reviewed commands/readbacks; no payout-kernel, bank-detail, authority or transfer change. Money fingerprint must stay `45 | 34c51131e2ca18f65d3b29afd8d12e11`.
8. Loading, empty, permission, error and recovery states, including vendors with no transactions.
9. Admin navigation/queue consolidation stays in 6.13.

## 6. 6.12A — implemented for review (compliance status and next actions)

Migration `20261106001000_phase6_vendor_compliance_status.sql` (additive, read-only, **not pushed**):

- `vendor_own_compliance_status()` — parameterless, `stable`, vendor-only. Nine items with `state` (`missing`, `current`, `expiring`, `expired`, `exception`), `exception`, `follow_up_due`, `expires_at`, `recorded_at` (null for exceptions), renewal documents awaiting review, latest decline note, plus `checklist_current`, `matching_allowed` (= `vendor_is_eligible`), `payout_onboarding_current` (= `vendor_payout_eligible`), `accepting_uploads`. Providers without an onboarding record get no items and no eligibility claim.
- `vendor_own_evidence_renewal()` restated with two added keys per item (`exception`, `follow_up_due`); listed items and states unchanged.

UI: `/vendor/compliance` "Your checklist" (attention order, state badge, plain detail, next action: upload / wait for review / contact Mercurius; payout onboarding says never to send bank details), with its own loading, error-with-retry (uploads keep working), empty (no onboarding record) states. Renewal notice words exceptions by follow-up date; vendor dates are Eastern (`formatEasternDate`). No scoped compliance shown (F612-4).

Evidence (local, 2026-11-01):
- Clean replay of all migrations (`supabase db reset --local`) including `20261104001000`, `20261105001000`, `20261106001000`.
- SQL 106: 47/47 PASS. Mutations killed 5/5 (exception reported as current; any-vendor resolution; evidence reference leaked; notice exception key forced false; exception given a recorded time).
- Full SQL suite on the clean replay: **97 files, 6,064 tests, PASS** (first run found SQL 039 #26 pinning the notice's key set; updated to the additive `exception`/`follow_up_due` keys, then the whole suite rerun).
- Unit: `vendor-compliance` 17/17 (also under `TZ=Pacific/Kiritimati`, `America/Los_Angeles`, `UTC`); full unit 620/620.
- Browser (1 worker, synthetic build): `vendor-compliance-status` 9/9 plus `renewal-documents`, `evidence-renewal`, `onboarding-checklist` — 54/54. Axe clean at 320 px and 1440 px.
- Money fingerprint on the replay: `45 | 34c51131e2ca18f65d3b29afd8d12e11` (unchanged).
- Typecheck, lint, `git diff --check` clean.

Not performed: screen reader, real devices, `@visual`, the dark-theme screenshot rendered light (axe passed; visual dark evidence not claimed), hosted storage probe, CI.

## 7. Proposed decisions — DEC-2026-056 (PROPOSED; owner answers before 6.12B)

| # | Question | Recommendation |
|---|---|---|
| 1 | Retire the dashboard "Released earnings" card (legacy invoices)? | Yes: replace with the 6.12B canonical summary; hosted has 0 released invoices. |
| 2 | Show a vendor an expected payout date? | No date: no weekday or cutoff is approved (DECISION-LOG, TRACE-078 B1). Show "eligible since …; paid in a weekly transfer Mercurius prepares". |
| 3 | Hold detail shown to the vendor? | Category only: dispute, payment not complete/under review, refund in progress, payout onboarding, held by Mercurius. Never the internal hold reason or evidence. |
| 4 | Amounts before capture? | None. Amounts only from captured, retained parts via `money_provider_proceeds`; before capture show the state without an amount (requirement 4). |
| 5 | Wording for unknown, failed and returned transfers? | Unknown: "Mercurius is confirming this transfer with the bank; it is not counted as paid." Failed: "Not paid; Mercurius will review a retry." Returned: "Returned by your bank; Mercurius will contact you." No recovery or retry promise. |
| 6 | Vendor statement? | A weekly statement per ACH batch: period, each job (service retained, platform fee, tips, amount), latest attempt status; no bank account, reference or approver. |
| 7 | Exception history for the vendor? | Current exception only (implemented); history stays operator-only. Confirm. |
| 8 | Scoped compliance display | After cutover requirements exist (F612-4). |

## 8. 6.12B — proposed design (not implemented)

`vendor_own_earnings()` — parameterless, `stable`, vendor-only; rows where `private.money_effective_contractor(o.id)` is the caller's provider. Per obligation: job reference and service date, state from latest ACH attempt first (`prepared/submitted/unknown/settled/failed/returned`), else `money_ach_payable` blocker mapped to MPS §5.5 (reusing 6.7's `job_fulfillment` vocabulary), amounts only when captured. Statements from `money_ach_batches/items`. Totals per state never sum attempts; paid uses `money_payout_received`. Tests: A/B and replacement-payee isolation, every blocker, 48-hour boundary, duplicate attempts, unknown never paid, no bank fields, fingerprint unchanged, read-only. UI: `/vendor/earnings` (sidebar entry) and the dashboard card replaced, with empty state for no transactions.

## 9. Open items kept visible (not closed here)

TRACE-126 and TRACE-127 open; DEC-2026-050 (unpaid start) PROPOSED; 6.6c two-person finance sign-off not recorded; 6.9 money scopes F-1, F-2 (supplemental refund), F-3, P-K1/P-K2 unbuilt; 0 `money_authorities` on hosted (finance provisioning is Phase 9); DEC-2026-052/054 PROPOSED; F10 (payout does not re-verify completion evidence) unchanged.

Owner decision needed for 6.11B's route to `main`: (a) a PR `claude/phase6-11a-offering-boundaries` → `claude/phase6-11-vendor-offerings` so #126 carries both, or (b) after #126 merges, a PR from that branch to `main`. Either way `20261104001000` then `20261105001000` must be pushed before the merge that carries them.

## 10. Release, compatibility and rollback

- Order: 6.11A → 6.11B → 6.12A. `supabase db push` applies pending migrations in order, so `20261106001000` cannot be pushed alone while the 6.11 migrations are pending.
- Old client on new schema: unaffected (new keys ignored, new function unused). New client on old schema: the checklist shows its error state with retry and the notice falls back to document wording; therefore push before merge (DEC-2026-037).
- Rollback: promote the previous production deployment; the migration can stay (additive, read-only). A schema rollback is a forward fix: drop `vendor_own_compliance_status()` and restate `vendor_own_evidence_renewal()` from `20260913001000`.
- Fingerprint impact: none.
- F612-9 (CI flake): fetch-and-patch route handlers fail when the test ends mid-`route.fetch()`. Fixed with `page.unrouteAll({ behavior: "ignoreErrors" })` in `onboarding-checklist`, `evidence-renewal`, `renewal-documents` and the new spec. Twelve other specs (including `invitation-operations`, which failed `main`) still use the pattern; recommend the same one-line fix as a separate CI PR to `main`.
