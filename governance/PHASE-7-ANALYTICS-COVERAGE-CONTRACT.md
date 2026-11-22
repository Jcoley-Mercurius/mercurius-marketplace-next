# Phase 7.4A — Marketplace analytics coverage and event contract (TRACE-158)

**Status:** CONTRACT FOR REVIEW (Codex). Documentation only. It approves no policy, implements nothing and activates nothing.
**Matrix version:** AC-1.
**Checkpoint:** 2026-11-21 (America/New_York), `main` `458555a0f259b2c7f1b912f167c2523ba8554c1d` (#188 merge), re-read with `git fetch` before work. Every source reference below is at this commit.
**Branch:** `claude/phase7-4a-analytics-coverage-contract`, from `main` `458555a`.
**Authority:** the owner's Phase 7.4A instruction (2026-11-21). Roadmap Phase 7 ("Add funnel, liquidity, quote, checkout, fulfillment, dispute, refund, payout, quality, and admin-override events"). MPS §2, §3 item 10, §9, §11, §12. MTS §8 (PostHog row), §11 detective controls, §14. [POSTHOG-ANALYTICS](POSTHOG-ANALYTICS.md) (TRACE-157). DEC-2026-059. CFG-011.

## Owner instruction and what it does not do

On 2026-11-21 the owner instructed us to continue independent Phase 7 work. This slice is that work. The instruction is recorded here as a scheduling instruction only. It does **not**:

- complete any 7.3D operator check or preflight item;
- accept 7.3D or any part of Phase 7;
- authorize activation of email evidence, probes, purge runs, payments, booking or any feature gate.

PR #189 (third revision of the 7.3D activation checklist) stays a separate PR. This branch does not contain its commits. Its pending evidence and decisions are unchanged.

**Read-only:** no production query, no PostHog query or test traffic, no Vercel, Supabase, Stripe or Resend call. No hosted state is claimed beyond what earlier records already say, and those are cited as history.

---

## 0. Summary

1. **There are two measurement layers, and they must stay separate.**
   - **(A) Optional product analytics (PostHog, TRACE-157).** Opt-in, browser-consented, limited to public and intake pages. 13 custom events plus `$identify` and `$pageview`. It covers discovery, account and intake up to request submission. Nothing else.
   - **(B) Essential operational records (database).** Every later MPS §11 family has an authoritative durable table written by the lifecycle command: matching, quotes, checkout, fulfillment, money, quality and admin actions. These records are not analytics. They do not depend on consent and must not be gated by it.
2. **Lifecycle families should be measured from layer B, not sent to PostHog.** Four reasons, each from an authority:
   - DEC-2026-059 requires a separate decision for any custom event. The 2026-11-19 approval covers visits, clicks, sign-in and conversion (request, early-access, coverage). Lifecycle events in PostHog are outside it.
   - Most lifecycle outcomes are produced by webhooks, workers, vendors or operators. There is no consenting browser for the affected homeowner. The TRACE-157 consent contract cannot be satisfied for that subject.
   - A consent-gated sample cannot give complete or reconciled money or liquidity numbers. MPS §2 and §12 require them ("100% reconciled", "telemetry live and validated").
   - The free-only boundary (1M events, shared across the organization) is not a home for ledger-grade data.
3. **Most layer-A trigger rules are untested where they fire.** Tests cover the consent, projection and replay mechanics well. Among the 13 custom events, only `login_failed` is asserted from a real call site (browser lane). The helper tests for `coverage_checked` and `early_access_submitted` call the helper directly, not the routes. The rules the contract promises are not asserted: "reused/idempotent saves excluded", "server-confirmed outcome" and "Auth provider accepted signup" (§4).
4. **Four trigger-semantics findings** (§5): `request_started` fires again after Back → Continue; `early_access_submitted` counts accepted submissions, including repeats, by design; `coverage_checked` counts lookups; `request_submitted` is captured in the browser after save, so the database stays authoritative.
5. **Layer B is broad but has three measurement gaps:** eligible pool size is computed and discarded; there is no "sourced" outcome; SLA breach is computed when a queue is read and never recorded. None can be closed without a definition or a migration. None is in the first slice.
6. **Recommended first slice, 7.4B (§8):** verify the trigger contract of the existing, approved PostHog events with call-site tests. No new event, property, consent rule, replay rule, project setting or hosted traffic. It closes an evidenced gap in an approved contract and needs no owner decision.

---

## 1. Baseline verification

| Item | Observation (2026-11-21) |
|---|---|
| `origin/main` | `458555a0f259b2c7f1b912f167c2523ba8554c1d`, matching Codex's checkpoint |
| Open PRs | #189 only (head `9fa68e1`, documentation, TRACE-155). Not modified, merged or cherry-picked |
| PostHog integration | Merged in #182 as `c5e24cf` (2026-11-20). PR record: deployment `dpl_GA94nCyQRuSsx33FEm2wKA2vKgvY` READY; live opt-in, decline and one consented `coverage_checked` observed; live pageviews **not** observed because the hosted automation browser was bot-filtered. History, not re-checked |
| Analytics code | [policy.ts](../src/lib/analytics/policy.ts), [client.ts](../src/lib/analytics/client.ts), [server/analytics.ts](../src/server/analytics.ts), [AnalyticsConsent.tsx](../src/components/analytics/AnalyticsConsent.tsx) |
| Analytics tests | [posthog-policy](../tests/unit/posthog-policy.test.ts) (5), [posthog-client](../tests/unit/posthog-client.test.ts) (6), [posthog-server](../tests/unit/posthog-server.test.ts) (3), [analytics-redaction](../tests/unit/analytics-redaction.test.ts), browser lane [posthog.pw.ts](../tests/analytics/posthog.pw.ts) (4), CI job [analytics.yml](../.github/workflows/analytics.yml) |
| Migrations | 235 files. No migration is read or changed by this slice |

## 2. Method and status vocabulary

- **Layer A discovery.** Every name in `ANALYTICS_EVENTS` ([policy.ts:11](../src/lib/analytics/policy.ts#L11)) was traced to every `captureAnalytics` / `captureServerAnalytics` caller in `src/`. Each event name was searched in `tests/`.
- **Layer B discovery.** Every `create table` in `supabase/migrations/` was listed. For each MPS §11 outcome, the table whose row or state change records it was located, with its status vocabulary. Function bodies were read only where a claim depends on them (pool count, exhaustion, queue aging, journal kinds).
- **Evidence.** Layer B verification cites the existing phase records. This slice did not re-run them. Source presence is not hosted behavior.

**Product analytics (A) status**

| Status | Meaning |
|---|---|
| IMPLEMENTED | In `ANALYTICS_EVENTS`, produced at the trigger TRACE-157 describes, and a test asserts that trigger |
| IMPLEMENTED — TRIGGER UNTESTED | Produced, but no test asserts the trigger rule at the call site |
| MISSING | Within an existing approval; no producer |
| POLICY-BLOCKED | Capture needs an owner decision: outside the 2026-11-19 approval (DEC-2026-059), or no consenting subject exists |
| DERIVED | A measure computed from other events or records, not an event of its own |

**Operational record (B) status**

| Status | Meaning |
|---|---|
| RECORDED | A durable row or append-only event records the outcome and its time |
| PARTIAL | The outcome is a state column; its transition time or a required field is not separately recorded |
| MISSING | No durable record of the outcome |
| DEFERRED | Needs a definition, a migration or a later slice |

---

## 3. Layer rules (both layers)

### 3.1 Layer A — optional product analytics (unchanged by this slice)

Preserved exactly as [POSTHOG-ANALYTICS](POSTHOG-ANALYTICS.md) states:

- **Consent:** versioned opt-in cookie; GPC/DNT, refusal, preview hosts and unconfigured builds collect nothing ([client.ts:21-27](../src/lib/analytics/client.ts#L21-L27)). Re-checked at send time in `before_send` ([client.ts:118](../src/lib/analytics/client.ts#L118)).
- **Where:** browser events only on `EVENT_PAGES` (public pages plus `/request`, `/login`, `/login/vendor`, `/signup`, `/register`) and `/providers/[id]` ([policy.ts:9](../src/lib/analytics/policy.ts#L9), [policy.ts:25](../src/lib/analytics/policy.ts#L25)). Portals, checkout, documents and admin produce no event.
- **Properties:** projection, not denylist ([policy.ts:67](../src/lib/analytics/policy.ts#L67)). Unknown event families are dropped.
- **Replay:** public allowlisted routes only, never with a query or fragment, never `/contact` or `/early-access` ([policy.ts:55](../src/lib/analytics/policy.ts#L55)).
- **Server capture:** two events only, after the business response, with consent cookie and UUID telemetry headers, no retries, errors contained ([server/analytics.ts:10](../src/server/analytics.ts#L10)).
- **Cost:** free-only, $0 product caps, no proxy, no paid product.
- **Idempotency:** PostHog events carry no business key. Client guards suppress obvious repeats (one pageview per page key, one scroll milestone per page, `reused` saves excluded). Loss is accepted: blockers, closed tabs and outages drop events. **Layer A is never a count of record.**

### 3.2 Layer B — essential operational records

- Written by database commands as part of the business change. Idempotency comes from business keys (`submission_key`, `request_key`, `business_key`, Stripe `event_id` primary key and others named in §6).
- Not consent-based. Access is by role and RLS. Retention follows CFG-011: financial and completed-service records 7 years, support and messages 3 years, operational logs 90 days.
- Measurement derived from layer B must be read-only, aggregate and operator-only. It must carry no free text, names, contact data, addresses or file content. It must never be forwarded to PostHog. These are proposed criteria for a later slice, not new policy.
- Existing derivations: the queue summary `admin_operations_summary` ([20261108001000](../supabase/migrations/20261108001000_phase6_admin_operations.sql), with `aged`/`overdue` flags) and `/admin/pricing-analytics`, which reads up to 1,000 `service_requests` rows in the browser ([page.tsx:16](../src/app/admin/pricing-analytics/page.tsx#L16)). Neither is a validated measurement surface.

---

## 4. Matrix AC-1 — layer A events (PostHog)

Governing requirement for every row: MPS §11 (family named), owner approval 2026-11-19 (TRACE-157), DEC-2026-059 (custom events need their own decision; TRACE-157 is that decision for these rows). Consent for every row: §3.1. Replay: none of these is a replay control.

| ID | Event | MPS family | Authoritative trigger (success / failure) | Source | Permitted properties | Replay / idempotency | Verification | Status (A) |
|---|---|---|---|---|---|---|---|---|
| A-01 | `$pageview` | Discovery | Permitted page reached, including SPA transitions / none | [client.ts:63](../src/lib/analytics/client.ts#L63) | `page`, sanitized `$current_url`, referrer origin, five `utm_*` | One per page key (`lastPage`) | Browser lane test 1 (pre-consent, redaction, SPA, refusal) | IMPLEMENTED |
| A-02 | `navigation_clicked` | Discovery | Click on an internal link to a permitted destination / none | [client.ts:154](../src/lib/analytics/client.ts#L154) | `destination`, `provider_id` | None; every click | None names the event | IMPLEMENTED — TRIGGER UNTESTED |
| A-03 | `button_clicked` | Discovery | Click on a button outside `[data-analytics-private]` / none | [client.ts:154](../src/lib/analytics/client.ts#L154) | `action` (curated), `button_index` | None; every click | None names the event | IMPLEMENTED — TRIGGER UNTESTED |
| A-04 | `page_scrolled` | Discovery | 25/50/75/100% on a replay-safe public page / none | [client.ts:168](../src/lib/analytics/client.ts#L168) | `depth` | Once per milestone per page | None names the event | IMPLEMENTED — TRIGGER UNTESTED |
| A-05 | `provider_profile_viewed` | Discovery (provider viewed) | Public provider loaded / not on load failure | [providers/[id]/page.tsx:107-113](../src/app/providers/%5Bid%5D/page.tsx#L107-L113) | `provider_id` | Once when the page is ready, and again on each consent change while open, so a view counts after opt-in | None | IMPLEMENTED — TRIGGER UNTESTED |
| A-06 | `service_viewed` | Discovery (service viewed) | Explicit service focus on a provider profile / none | [providers/[id]/page.tsx:155](../src/app/providers/%5Bid%5D/page.tsx#L155) | `provider_id`, `service_id` | None | None | IMPLEMENTED — TRIGGER UNTESTED. Catalog service views are only `$pageview` `/services` (no per-service event; none proposed) |
| A-07 | `coverage_checked` | Discovery (coverage checked) | Server decision covered / waitlist / uncovered; not on invalid input or lookup failure | [request-coverage/route.ts:45](../src/app/api/request-coverage/route.ts#L45) | `coverage` only; never ZIP | One per lookup (§5 F-3); no retry | Helper unit test only; one live event in #182 (history) | IMPLEMENTED — TRIGGER UNTESTED (route) |
| A-08 | `early_access_submitted` | Discovery (coverage interest) | Route answered 201 `saved` / not 400, 409, 429, 500 | [early-access/route.ts:19](../src/app/api/early-access/route.ts#L19) | `kind` only | One per accepted submission, repeats included (§5 F-2); no retry | Helper unit test only | IMPLEMENTED — TRIGGER UNTESTED (route) |
| A-09 | `login_succeeded` | Account (owner approval "sign-in") | Password sign-in returned no error | [AuthProvider.tsx:69](../src/components/providers/AuthProvider.tsx#L69) | none beyond `page` | None | None | IMPLEMENTED — TRIGGER UNTESTED |
| A-10 | `login_failed` | Account | Password sign-in returned an error; no message forwarded | [AuthProvider.tsx:69](../src/components/providers/AuthProvider.tsx#L69) | none beyond `page` | None | Browser lane test 2 (also asserts no credential leak) | IMPLEMENTED |
| A-11 | `signup_submitted` | Account | Auth provider accepted signup; not email verification | [AuthProvider.tsx:85](../src/components/providers/AuthProvider.tsx#L85) | none beyond `page` | None | None | IMPLEMENTED — TRIGGER UNTESTED |
| A-12 | `$identify` | Account | Consented sign-in or session restore; `reset` on logout or switch | [client.ts:53](../src/lib/analytics/client.ts#L53) | Supabase user UUID only | Once per identity change | Client unit test 2 | IMPLEMENTED |
| A-13 | `request_started` | Intake (started) | Services step passes validation | [request/page.tsx:725](../src/app/request/page.tsx#L725) | `service_count` | Re-fires on every pass of the services step (§5 F-1) | Used only as a sample event in client tests | IMPLEMENTED — TRIGGER UNTESTED |
| A-14 | `request_step_completed` | Intake (step completed) | Services or details step passes validation | [request/page.tsx:726](../src/app/request/page.tsx#L726), [:775](../src/app/request/page.tsx#L775) | `step`, `service_count` | Per forward pass | None | IMPLEMENTED — TRIGGER UNTESTED |
| A-15 | `request_submitted` | Intake (submitted) | Submission RPC saved new requests; excluded when `result.reused`; not on refusal outcomes | [request/page.tsx:983](../src/app/request/page.tsx#L983) | `service_count` (= saved requests) | `reused` excluded; browser-side after save (§5 F-4) | None | IMPLEMENTED — TRIGGER UNTESTED |
| A-16 | auth handoff | Intake (auth handoff) | Signed-out visitor sent from `/request` to `/login?redirect=/request` ([page.tsx:1160](../src/app/request/page.tsx#L1160), [:1182](../src/app/request/page.tsx#L1182)) | none | — | — | — | MISSING; whether the 2026-11-19 "sign-in and conversion" approval covers it is decision D-3 |
| A-17 | abandoned | Intake (abandoned) | Started without a later submitted, per session or person | none | — | — | — | DERIVED in PostHog from A-13 and A-15. Depends on F-1 |

## 5. Trigger-semantics findings (layer A)

| ID | Finding | Evidence | Effect | Proposed handling |
|---|---|---|---|---|
| F-1 | `request_started` fires every time the services step passes. Back → Continue fires it again in one draft | The Back handlers return to `services` and `details` ([page.tsx:1364-1365](../src/app/request/page.tsx#L1364-L1365)); the capture has no once-per-draft guard ([:725](../src/app/request/page.tsx#L725)) | Inflates "started" and abandonment. The contract text ("valid forward steps") fits both readings | 7.4B pins current behavior in a test. Changing it is decision D-2 |
| F-2 | `early_access_submitted` fires for every accepted submission, including a repeat by an email that already has interest | Identical 201 `saved` answer for new and existing interest, to prevent membership probing ([earlyAccess.ts:129-192](../src/lib/earlyAccess.ts#L129-L192)) | Counts submissions, not people. Distinct interest is in `private.r0_interests` ([20260929001000](../supabase/migrations/20260929001000_r0_interest_consent.sql)) | Keep. Do not add a "new vs repeat" property: analytics must not become a membership signal. Document in 7.4B |
| F-3 | `coverage_checked` fires once per lookup, so repeated lookups count again | [route.ts:45](../src/app/api/request-coverage/route.ts#L45) | Lookup volume, not visitors | Keep; document |
| F-4 | `request_submitted` is sent from the browser after the RPC answers | [page.tsx:983](../src/app/request/page.tsx#L983) | Lost if the tab closes, the SDK is blocked or consent is absent. The authoritative count is `service_request_submissions` (`unique (customer_id, submission_key)`, [20260927000000](../supabase/migrations/20260927000000_phase6_request_submission.sql)) | Keep. PostHog conversion is a consented sample; the database is the count of record |

## 6. Matrix AC-1 — layer B lifecycle outcomes

Governing requirement for every row: Roadmap Phase 7 and MPS §11 (family named), plus MPS §5 ("every transition must define … audit event"). **Layer A status for every row is POLICY-BLOCKED** (§0 item 2; decision D-1). Consent: not applicable (§3.2). Properties for any later derived measure: §3.2 criteria plus the dimensions in §7.

### 6.1 Liquidity (matching)

| ID | Outcome | Authoritative record / trigger | Idempotency | Existing evidence | Status (B) |
|---|---|---|---|---|---|
| L-1 | Eligible pool count | Computed as `candidate_count` inside matching, then discarded ([20260904000100:215](../supabase/migrations/20260904000100_phase4_matching_consent.sql#L215)) | — | — | MISSING — DEFERRED (needs a migration and a definition) |
| L-2 | Offer sent | `job_match_attempts` row, `outcome='pending'`, `offered_at`, `expires_at` ([20260729104728](../supabase/migrations/20260729104728_ed7b52f7-e600-489c-8f0e-7ba53eca3f41.sql)); `job_events` `match_offered` | Unique index `idx_job_match_attempts_one_pending_per_request` | [PHASE-6-MATCHING](PHASE-6-MATCHING.md) M1–M5 | RECORDED |
| L-3 | Offer accepted / declined / expired | `job_match_attempts.outcome`, `responded_at`; `job_events` `match_declined`, `match_expired`; `expire_stale_matches` | State guard on `pending` | PHASE-6-MATCHING | RECORDED |
| L-4 | Exhausted | `service_requests.matching_status='exhausted'`, `needs_admin_review=true` | State column | PHASE-6-MATCHING | PARTIAL — no append-only exhaustion event was found by search; only `updated_at` |
| L-5 | Sourced | No outcome exists. CFG-009 forbids claiming active sourcing | — | — | MISSING — DEFERRED (needs an MPS/CFG definition; D-4) |

### 6.2 Commercial (price, quotes, checkout)

| ID | Outcome | Authoritative record / trigger | Idempotency | Existing evidence | Status (B) |
|---|---|---|---|---|---|
| C-1 | Price shown | Request preview is read-only and records nothing | — | — | MISSING. Layer A capture would expose prices on an intake page (POLICY-BLOCKED). Not proposed |
| C-2 | Quote sent / revised | `request_quotes` `submitted` with revision ([20260904001000](../supabase/migrations/20260904001000_phase4_quote_revisions.sql)); operator send via `request_quote_proposals` `pending→sent` ([20261022001000](../supabase/migrations/20261022001000_phase6_quotes.sql)) | Revision numbers; `based_on_revision` | [PHASE-6-QUOTES](PHASE-6-QUOTES.md) | RECORDED |
| C-3 | Quote accepted / declined / expired | `request_quotes.status` (`accepted`, `declined`, `expired`, `superseded`) | Status guard | PHASE-6-QUOTES | RECORDED |
| C-4 | Checkout started | `money_checkout_attempts` `prepared` / `session_created` ([20260905001000](../supabase/migrations/20260905001000_money_contracts.sql)) | Attempt row per mode | [PHASE-5-QUOTE-CHECKOUT](PHASE-5-QUOTE-CHECKOUT.md) | RECORDED |
| C-5 | Checkout completed | Attempt `captured`; `money_journals` kind `capture`, from `money_webhook_events` (Stripe `event_id` primary key) | Webhook event ID; journal `business_key` | PHASE-5 money records | RECORDED |
| C-6 | Checkout failed | Attempt `expired` or `reconcile`; webhook `failed` / `dead_letter`. A card decline inside Stripe's hosted page is not recorded locally | Webhook event ID | PHASE-5 money records | PARTIAL |

### 6.3 Fulfillment

| ID | Outcome | Authoritative record / trigger | Idempotency | Existing evidence | Status (B) |
|---|---|---|---|---|---|
| F-01 | Scheduled / rescheduled | `job_visits` `scheduled` ([20260501110453](../supabase/migrations/20260501110453_05e4f975-6cb7-4eb7-bfe7-5de02cb9299b.sql)); `job_reschedule_responses` ([20261102001000](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql)) | Response rows | [PHASE-6-APPOINTMENTS](PHASE-6-APPOINTMENTS.md) | RECORDED |
| F-02 | Started | `job_visits` `in_progress`; start payment exceptions (`visit_start_payment_exceptions`) | Visit state guard | [PHASE-6-FULFILLMENT](PHASE-6-FULFILLMENT.md) | RECORDED |
| F-03 | Completion submitted | `job_completion_evidence` ([20260926003000](../supabase/migrations/20260926003000_phase4_completion_integrity.sql)); `job_events` `job_completed_by_vendor` | Evidence rows | PHASE-6-FULFILLMENT | RECORDED |
| F-04 | Completion confirmed | `money_lifecycle_confirmations` ([20260905011000](../supabase/migrations/20260905011000_completion_payout_bridge.sql)); request `homeowner_confirmed` | Confirmation row | [PHASE-5-COMPLETION-PAYOUT](PHASE-5-COMPLETION-PAYOUT.md) | RECORDED |
| F-05 | Disputed | `disputes` (§6.5 Q-5) | — | — | RECORDED |

### 6.4 Money

| ID | Outcome | Authoritative record / trigger | Idempotency | Existing evidence | Status (B) |
|---|---|---|---|---|---|
| M-1 | Payment authorized / captured | `money_journals` `capture`. No separate authorization record: checkout captures | Journal `business_key` | PHASE-5 money records | RECORDED (captured); authorized not distinct |
| M-2 | Refunded | `money_refund_attempts` and events ([20260905006000](../supabase/migrations/20260905006000_refund_attempts.sql)), `money_refunds`, journal `refund`, `refund_late_failure` | Provider ref primary key; attempt keys | [PHASE-5-FINANCE-REFUNDS](PHASE-5-FINANCE-REFUNDS.md) | RECORDED |
| M-3 | Disputed (chargeback) | `money_disputes` `open/won/lost`, `money_dispute_events` ([20260905004000](../supabase/migrations/20260905004000_money_reconciliation.sql)); journals `chargeback_*` | Event rows | PHASE-5 reconciliation records | RECORDED |
| M-4 | Provider funds held | `money_holds`, `money_hold_resolutions` ([20260905003000](../supabase/migrations/20260905003000_manual_ach.sql)) | Resolution rows | [PHASE-5-FINANCE-ACH](PHASE-5-FINANCE-ACH.md) | RECORDED |
| M-5 | Funds eligible | Derived from confirmation time + 48 h (configuration) and holds; `money_payable` | — | PHASE-5-COMPLETION-PAYOUT | PARTIAL — derived, no eligibility row |
| M-6 | Paid / failed | `money_ach_attempts` `submitted/unknown/settled/failed/returned`; append-only `money_ach_events`; journals `ach_settled`, `ach_returned` | `business_key`; one unresolved attempt per item | PHASE-5-FINANCE-ACH | RECORDED |

### 6.5 Quality and support

| ID | Outcome | Authoritative record / trigger | Idempotency | Existing evidence | Status (B) |
|---|---|---|---|---|---|
| Q-1 | Review requested | `job_events` `review_requested`; request status | — | [PHASE-6-REVIEWS](PHASE-6-REVIEWS.md) | RECORDED |
| Q-2 | Review submitted | `reviews` (rating), `quality_feedback` ([20260325154947](../supabase/migrations/20260325154947_0c6c0e0b-005b-481d-825d-0eeff006ff88.sql)) | `UNIQUE(service_request_id)` | PHASE-6-REVIEWS | RECORDED |
| Q-3 | Review moderated | `reviews.moderation_state`; `review_history` with actor, before value, reason ([20260904003000](../supabase/migrations/20260904003000_phase4_review_integrity.sql)) | History rows | PHASE-6-REVIEWS | RECORDED |
| Q-4 | Support opened / resolved | `support_tickets`; append-only `support_ticket_events` (`opened`, `status`, `assigned`, `next_action`, `request_key`) ([20261103001000](../supabase/migrations/20261103001000_phase6_support_disputes.sql)) | `request_key`, `seq` | Phase 6 support record | RECORDED |
| Q-5 | Dispute opened / resolved | `disputes` (`open`, `vendor_contacted`, `resolved`, `escalated`); `dispute_decisions` (`decided`, `appealed`), `dispute_appeals` | Decision rows | Phase 6 support record | RECORDED |

### 6.6 Operations

| ID | Outcome | Authoritative record / trigger | Idempotency | Existing evidence | Status (B) |
|---|---|---|---|---|---|
| O-1 | Admin override | `private.admin_request_actions` (`status_change`, `detail_correction`; actor, payload, result, reason) ([20261108001000](../supabase/migrations/20261108001000_phase6_admin_operations.sql)); `job_operation_adjustments` (waiver); `review_history`; `vendor_role_decisions`; `catalog_visibility_events`; `money_feature_gate_events`; two-person `money_review_*` | `request_key` primary key and decision keys | [PHASE-6-ADMIN-OPERATIONS-BRIEF](PHASE-6-ADMIN-OPERATIONS-BRIEF.md) | RECORDED for listed actions. MPS §9 field completeness (reason code, affected communication, linked financial event) is not characterized here |
| O-2 | SLA breach | `aged` / `overdue` computed when a queue is read (`admin_operations_summary`); never stored; no alert. CFG-015 sets quote and payment thresholds; others open | — | Phase 6 admin operations | MISSING — DEFERRED to the Phase 7 queue/alert slice (D-5) |
| O-3 | Manual correction | `admin_request_actions` `detail_correction`; `money_reconciliation_resolutions` ([20260905008000](../supabase/migrations/20260905008000_reconciliation_resolution.sql)); bank line matches and dismissals | Business keys | PHASE-5 reconciliation records | RECORDED |

**Reachability.** Repository defaults keep most layer-B outcomes from occurring in Production. R0 admission is default-closed ([R0-ADMISSION](R0-ADMISSION.md)). `offer_terms` and `promotions_checkout` gates are seeded off. PHASE-6-ACCEPTANCE authorizes no booking, payment or gate opening. Hosted state was not queried. Instrumenting these families now would produce no Production data before Phase 9.

## 7. MPS §11 required dimensions

| Dimension | Layer A (PostHog) | Layer B (records) |
|---|---|---|
| Privacy-minimized identifiers | Supabase user UUID after consent; `provider_id` UUID | Row UUIDs |
| Service | `service_id` on provider profile only; intake sends `service_count` only | Request and offering rows |
| ZIP / coverage area | **Excluded by design**: only the `coverage` outcome | Request ZIP; aggregate only in any derived measure |
| Service mode | Not projected | `pricing_mode` |
| Provider | `provider_id` | Contractor ID |
| Request cohort, lifecycle, matching and policy versions | Not projected | Not characterized here |
| Device class | `$device_type` (system key) | — |
| Actor role | Not projected | Actor columns |
| Operational / manual indicator | — | Admin action and resolution tables |

No layer-A property is proposed. Adding ZIP, price, role or version properties to PostHog would need an owner decision.

## 8. Recommended first slice — 7.4B trigger-contract verification

**Why this slice.** TRACE-157 is approved and live. Its contract promises specific trigger rules (§4: "server-confirmed outcome", "reused/idempotent saves excluded", "Auth provider accepted signup"). No test enforces them where they fire, so a regression could silently corrupt the only funnel data Mercurius collects. MPS §12 requires telemetry to be "live and validated". This gap is evidenced (§4), sits inside an approved contract, and needs no owner decision, migration or hosted action.

**Scope (exact).**
1. Route tests for `/api/request-coverage`: `coverage_checked` with exactly `{ coverage }` for covered, waitlist and uncovered; no capture for invalid ZIP or lookup failure; ZIP never in the properties.
2. Route tests for `/api/early-access`: capture only on 201 `saved` with `{ kind }`; none on 400, 409 boundary, 429 or 500. A repeat accepted submission captures, which pins F-2.
3. `request_submitted`: one capture with `service_count` equal to saved requests on a fresh save; none when `reused`; none on refusal outcomes. If the 2,000-line page cannot be unit-tested directly, extract the decision into a small pure helper without changing behavior.
4. `request_started` / `request_step_completed`: pin current behavior, including F-1 re-firing, with a test that names F-1 and D-2.
5. `AuthProvider`: `login_succeeded` / `login_failed` by outcome, identity sync only on success, `signup_submitted` only without error, no credential or error text in properties.
6. `provider_profile_viewed` only after a successful load, never on a failed or not-found load, and again after a consent change while open; `service_viewed` on focus with valid IDs.
7. Client listeners: `navigation_clicked` only for internal permitted destinations; external and private links dropped; `[data-analytics-private]` skipped; `page_scrolled` once per milestone per page.
8. Documentation: POSTHOG-ANALYTICS "Verification" lists these tests and F-1..F-4; TRACE-157/158 evidence updated.

**Out of scope.** New events (including auth handoff), new properties, consent, replay or projection changes, PostHog project settings, Vercel variables, hosted traffic, layer-B measurement, dashboards and migrations.

**Acceptance criteria.**
- Each rule in items 1–7 has a test that **fails** when the rule is mutated. At minimum: drop `!result.reused`; capture early access on any status below 500; capture coverage before the lookup succeeds; capture `login_succeeded` regardless of error. Record the mutations.
- Existing analytics tests, the full unit regression, typecheck, changed-file lint, secret scan and production build pass. The `Analytics privacy` CI job passes on the exact head.
- No change to `ANALYTICS_EVENTS`, `sanitizeProperties`, `replayAllowed`, `analyticsPath` or the consent code. Any extracted helper is behavior-preserving, and its diff is shown.
- No network call to PostHog from any test. Synthetic fixtures only.

**Dependencies.** Codex review of this contract. Nothing hosted. Independent of #189 and 7.3D.

## 9. Decisions needed

| ID | Decision | Owner | Recommendation |
|---|---|---|---|
| D-1 | Confirm the layer split: lifecycle families (§6) are measured from operational records, and no lifecycle event goes to PostHog | Owner (Codex advises) | Confirm. The alternative needs a new consent and subject model for server-originated events |
| D-2 | `request_started`: once per draft, or once per pass of the services step (current) | Owner / Codex | Once per draft, as a separate change after 7.4B pins current behavior |
| D-3 | Does the 2026-11-19 approval ("sign-in and conversion tracking") cover an intake auth-handoff event (A-16)? | Owner | If yes, a later slice adds one event with no properties beyond `page`, on `/request` only |
| D-4 | Define "sourced" and whether eligible pool size is persisted (L-1, L-5), consistent with CFG-009 | Owner | Defer to the Phase 7 operations-queue slice |
| D-5 | SLA breach recording and alerting (O-2); thresholds beyond CFG-015 | Owner | Defer to the queue/alert slice; MPS says targets follow a pilot baseline |
| D-6 | A validated operator measurement surface for layer B (MPS "proposed dashboards") | Owner | Later slice; no dashboard redesign here. `/admin/pricing-analytics` stays as is |

**Carried, unchanged:** O-9 (DEC-2026-059 open items: purge of Vercel analytics events collected before redaction; re-issue of invitations opened since 2026-11-02). TRACE-157's open items: live positive pageview evidence (bot-filtered in #182) and replay activation remain owner/production checks. 7.3D items and #189 are untouched.

## 10. Validation of this slice

- Documentation only: this file, one TRACEABILITY row (TRACE-158) and the handoff entry.
- `git diff --check` and relative-link existence check: results in the PR body.
- No code, test, migration, workflow or configuration change. No hosted read or write.
