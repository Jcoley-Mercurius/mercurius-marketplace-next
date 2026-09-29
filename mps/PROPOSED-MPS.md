# Proposed Mercurius Product System

**Status:** **APPROVED by owner on 2026-08-29**
**Product:** Mercurius Marketplace
**Approved release geography:** All of Lee County, Florida, enforced by explicit backend ZIP allowlist
**Companion evidence:** [MPS-AUDIT.md](./MPS-AUDIT.md)

## 1. Product charter

### Proposed purpose

Mercurius helps people throughout approved Lee County, Florida ZIP codes arrange dependable home services with eligible local providers through one managed workflow for discovery, request intake, matching or provider selection, price or quote confirmation, service delivery, payment, issue resolution, and review.

### Proposed customer promise

1. Show only coverage, providers, availability, reviews, and prices supported by real operational data.
2. Explain whether a request has a fixed price, requires a quote, or is not yet available in the customer’s area.
3. Never charge a customer without an explicit, reviewable amount and authorization.
4. Keep the customer and provider informed whenever action or a deadline is pending.
5. Provide a visible path to help, correction, cancellation, dispute, and refund where policy permits.

### Proposed launch model

Mercurius should launch as a **limited-region, operationally assisted marketplace beta**. The admin team is part of the product system, not an invisible workaround. Manual actions are acceptable during soft launch only when ownership, response times, reason codes, customer communication, and audit records are defined.

**Approved geographic configuration:** all of Lee County, Florida. The explicit backend ZIP allowlist is authoritative. Cape Coral, Fort Myers, Lehigh Acres, and the Lee County portion of Bonita Springs are included examples rather than an exhaustive city definition.

### Proposed initial audience

- Primary: individual homeowners with one or more homes in supported ZIP codes.
- Secondary: remote homeowners and snowbirds using the same individual account model.
- Deferred unless explicitly approved: property-management companies, HOA organizations, team accounts, delegated access, and portfolio workflows.

## 2. Product outcomes

| Outcome | Proposed measure | Soft-launch target to approve |
|---|---|---|
| Covered customers can submit valid requests. | Request completion rate after coverage confirmation. | Owner to set after baseline. |
| Requests reach viable supply quickly. | Time to first eligible offer; match success rate by ZIP/service. | Owner to set by service mode. |
| Providers respond predictably. | Offer response rate and response time. | Four-hour exclusive offer window approved for beta. |
| Customers receive clear commercial terms. | Quote acceptance, checkout completion, payment failures, pricing complaints. | Zero unreviewed amount mismatches. |
| Booked work reaches a confirmed outcome. | Scheduled-to-completed rate; cancellation/no-show/dispute rate. | Owner to set after pilot cohort. |
| Providers are paid correctly and predictably. | Time from eligible completion to release/payout; payout exceptions. | 100% reconciled; timing owner-approved. |
| Service quality is visible and recoverable. | Review rate, rating, dispute time, rework/refund outcomes. | Owner to set by category. |
| Launch claims remain honest. | Inventory/coverage/copy audits and unsupported-claim incidents. | Zero knowingly unsupported claims. |

Targets must be approved after an instrumented pilot baseline; invented launch metrics should not be used as substitutes.

## 3. Scope model

### Soft-launch core

1. Public service, coverage, provider, and policy discovery.
2. Homeowner registration and property profile.
3. Covered request intake with fixed-price, quote, and honest unavailable outcomes.
4. Provider selection or controlled matching.
5. Vendor application, vetting, activation, profile, coverage, and offering management.
6. Offer, acceptance/decline, scheduling, messaging, fulfillment, completion evidence, and confirmation.
7. Invoice, payment authorization, payment reconciliation, fee calculation, payout eligibility, and provider earnings.
8. Cancellation/rescheduling, disputes, refunds, reviews, and support.
9. Admin operational queues and controlled overrides.
10. Product funnel, marketplace liquidity, reliability, money, and quality measurement.

### Explicitly deferred unless approved

- Paid vendor subscriptions or premium plans.
- Advanced vendor growth analytics or automated campaign tools.
- Organization/team/property-management portfolios.
- Unattended AI ranking or matching decisions.
- Expansion outside approved services and ZIP codes.
- Smart Picks as a separate editorial marketplace surface.
- Native mobile applications.

## 4. Role contract

| Capability | Visitor | Homeowner | Vendor | Admin |
|---|:---:|:---:|:---:|:---:|
| Browse supported public inventory | ✓ | ✓ | ✓ | ✓ |
| Create and manage own requests |  | ✓ |  | supervised |
| Select or receive a provider |  | ✓ |  | override with reason |
| View customer contact details |  | own | assigned jobs only | support need only |
| Configure provider offerings |  |  | own | supervised |
| Accept/decline/start/complete assigned work |  |  | ✓ | correction with reason |
| Approve price/quote |  | ✓ | propose | send/correct with reason |
| Authorize customer payment |  | ✓ |  | retry/support, not impersonation |
| Release or hold provider funds |  |  | view | restricted finance authority |
| Resolve disputes/refunds | participate | participate | participate | restricted resolution authority |
| Moderate public content |  | own submission | own profile | authorized moderator |
| View audit/message/support records |  | own | own job threads | least-privilege support role |

**Proposed rule:** role checks must be enforced server-side and at the database boundary. Navigation guards are usability controls, not authorization.

## 5. Canonical lifecycle

Separate domain states should be used instead of forcing every concern into one request-status field.

### 5.1 Request state

`draft → submitted → matching | quote_required | unavailable → provider_confirmed → scheduled → in_progress → completion_pending → completed → closed`

Terminal or exception paths:

- `cancelled`
- `expired`
- `disputed → resolved`

### 5.2 Match state

`not_started → eligible_pool_created → offered → accepted | declined | expired → next_offer | exhausted`

**Proposed rule:** only one provider has an exclusive actionable offer at a time unless an owner approves competitive bidding. Offer duration and escalation must be configurable and observable.

### 5.3 Quote state

`not_required | requested → submitted → accepted | declined | expired | superseded`

An accepted quote must preserve an immutable commercial snapshot: labor/service amount, add-ons, discounts, taxes, platform/customer fees, deposit, balance, currency, expiry, and policy version.

### 5.4 Payment state

`not_due → authorization_pending → authorized | failed → captured → partially_refunded | refunded | disputed | chargeback`

### 5.5 Provider-funds state

`not_eligible → held → eligible → scheduled → paid | payout_failed | reversed`

Payment capture, Mercurius revenue recognition, and provider payout are different events and must never share an ambiguous `released` meaning.

### 5.6 Review state

`not_eligible → requested → submitted → published | held_for_moderation | rejected | appealed`

Every transition must define actor, prerequisites, side effects, notification, timeout, permitted reversal, audit event, and customer-visible wording.

## 6. Workflow contracts and acceptance behavior

### 6.1 Coverage and request intake

**Proposed rules**

- Coverage is authoritative by ZIP, service, and effective date.
- An uncovered user may join an interest list but must not receive a service-request confirmation.
- A price is displayed only when a currently eligible provider-backed offering can fulfill the selected configuration.
- The confirmation screen names the service mode: fixed price or quote required. A service without eligible local supply is not bookable and displays “Not available yet in your area.”
- Authentication handoff preserves the drafted request without duplicating it.

**Minimum acceptance**

- Covered and uncovered ZIP scenarios are tested.
- Anonymous-to-authenticated continuation creates exactly one request.
- Invalid provider/service/ZIP combinations are rejected server-side.
- Confirmation copy accurately reflects provider, price, payment, and next action.

### 6.2 Matching

**Proposed rules**

- Eligibility precedes ranking and includes active status, service capability, exact coverage, current availability/marketing eligibility, and any approved compliance requirements.
- Ranking factors and weights are approved, explainable to operations, and logged with a version.
- A homeowner-selected eligible provider receives the first offer; an ineligible selection is explained and falls back only with consent.
- Expired and declined offers move deterministically to the next provider.
- Exhausted supply produces the approved unavailable outcome: “Not available yet in your area.” It must not imply that active sourcing or fulfillment is underway.
- Admin override requires a reason and preserves the pre-override result.

**Minimum acceptance**

- Eligible, ineligible, selected-provider, tie, decline, expiry, exhaustion, and concurrent-worker scenarios pass integration tests.
- Each request has at most one active exclusive offer.
- No provider receives customer details before the approved workflow point.

### 6.3 Quote and scheduling

**Proposed rules**

- A quote has an expiry, revision lineage, complete price breakdown, policy version, and acceptance actor/time.
- Declining a quote does not automatically mean cancellation unless the UI says so and an owner approves that rule.
- Scheduling becomes confirmed only after the provider and customer conditions defined for that service mode are met.
- Rescheduling preserves history and recalculates policy consequences before confirmation.

**Minimum acceptance**

- Quote accept, decline, expiry, replacement, deposit, and payment-failure scenarios are tested.
- Both parties see the same confirmed time and timezone.
- Rescheduling/cancellation outcomes match public policy exactly.

### 6.4 Fulfillment and completion

**Proposed rules**

- Only the assigned vendor or an authorized admin may start or complete a job.
- Required completion evidence is category-configurable.
- Homeowner confirmation, dispute, and any auto-confirm timer are explicit and notified.
- Recurring work creates auditable occurrences rather than overwriting one request.

**Minimum acceptance**

- Invalid and duplicate transitions are rejected.
- Completion cannot release funds until required evidence and payment conditions are met.
- No-show, unable-to-complete, customer-unavailable, and partial-completion paths have operator actions.

### 6.5 Payment, refunds, and payout

**Proposed rules**

- One version-controlled checkout service is the authority.
- Server-side commercial snapshots determine amounts; client-supplied totals are never authoritative.
- Every payment and refund operation is idempotent and reconciled to Stripe events.
- The 15% platform fee basis is explicitly defined: included/excluded taxes, discounts, tips, refunds, and processor fees.
- Provider payout timing begins only from an approved eligibility event and accounts for holds/disputes.
- Manual financial changes require a reason, immutable audit record, and restricted role; high-risk changes require second-person approval.

**Minimum acceptance**

- Success, decline, retry, duplicate event, stale checkout, partial refund, full refund, dispute, chargeback, and payout failure are tested.
- Ledger totals reconcile among customer charge, refunds, processor cost, Mercurius fee, and provider payable.
- The customer and vendor see accurate, role-appropriate money states.

### 6.6 Cancellation, rescheduling, dispute, and support

**Proposed rules**

- One approved policy matrix controls UI eligibility, financial outcomes, notification, and operational handling.
- The policy must cover customer cancellation, vendor cancellation, rescheduling by either party, no-show, weather/emergency, partial work, and recurring service.
- Disputes have filing windows, reason categories, evidence, response times, payout holds, resolution types, notifications, and appeal handling.
- Support promises are made only when a queue owner, business-hours calendar, escalation, and measurement exist.

**Approved beta policy:** customer cancellation 72+ hours before service receives a full refund; 24–72 hours receives 50%; under 24 hours receives no refund. Customer rescheduling 48+ hours before service is free; 24–48 hours costs $25; under 24 hours is case by case and not guaranteed. Operations waives applicable penalties for accepted severe weather, emergencies, or acts of God. Provider cancellation/no-show triggers rematching first, otherwise a full customer refund, and creates a quality event unless operations records an accepted exception.

**Approved support commitment:** Monday–Friday, 9:00 a.m.–5:00 p.m. Eastern; response within one business day; same-day priority during support hours for an appointment happening that day.

**Minimum acceptance**

- Boundary-time scenarios for every fee/refund window are automated.
- Public policy, confirmation snapshot, support script, and actual computed outcome match.
- Every open dispute and support request has an owner, age, priority, and next action.

### 6.7 Reviews and trust

**Proposed rules**

- Only an eligible completed service relationship can create a verified review.
- One canonical review/quality model distinguishes private feedback from public review.
- Moderation is based on published criteria, preserves original content, and supports appeal/correction.
- “Vetted,” “licensed,” “insured,” and similar labels are shown only when current evidence satisfies an approved definition.

**Minimum acceptance**

- Ineligible, duplicate, edited, moderated, and appealed review scenarios are tested.
- Expired compliance evidence automatically changes provider eligibility and public badges as approved.

## 7. Approved commercial rules

1. **Payment role:** customers pay Mercurius directly; Mercurius retains its fee and remits vendor proceeds. Formal legal, tax, and provider classification must validate this approved customer-facing model.
2. **Platform fee:** 15% of the final service subtotal after discounts and adjustments, excluding tax and tips. After a refund, calculate the fee against the retained service subtotal.
3. **Vendor subscription:** $0 during soft launch; any future plan requires a separate approved product release.
4. **Fixed price:** only a versioned eligible offering can generate a fixed commercial snapshot.
5. **Deposit-plus-quote:** deposits apply toward the final service subtotal and do not create an additional fee base; refundability, expiry, and abandonment follow the approved commercial snapshot and cancellation policy.
6. **Promotions:** funder, limits, stacking, refund allocation, expiry timezone, and customer/provider display must be defined.
7. **Payout:** Mercurius pays vendors directly by ACH on a weekly schedule. Funds become eligible 48 hours after homeowner-confirmed completion. Disputed work remains held; no general beta reserve applies. Do not use Stripe Connect as the approved payout design.
8. **Tax and tips:** tax is excluded from the platform-fee base and handled separately under the implemented tax authority. Tips are excluded from the fee base and belong 100% to the provider.

## 8. Provider trust and supply governance

### Proposed activation checklist

- Identity and business contact verified.
- Terms and marketplace agreement accepted with version/time.
- Service categories and coverage approved.
- Required licensing/insurance reviewed by category/jurisdiction with expiry.
- Payment/payout onboarding complete where required.
- Profile and pricing claims reviewed.
- Availability and response expectations accepted.
- Test notification received.
- Activation approved by an authorized operator with recorded evidence.

Provider eligibility should automatically reflect suspension, expired requirements, coverage, service capability, and payout/account restrictions. Public wording must describe only checks Mercurius actually performs.

## 9. Admin operating model

The soft launch requires named queues:

| Queue | Entry condition | Proposed owner outcome |
|---|---|---|
| Coverage interest | Unsupported ZIP/service demand | Aggregate demand; send no availability promise. |
| Sourcing | No eligible provider or exhausted offers | Find supply or close transparently by deadline. |
| Quote aging | Quote not received/accepted by threshold | Prompt, reassign, extend, or close with notice. |
| Schedule exception | Conflict, reschedule, no-show | Apply approved policy and restore a valid plan. |
| Payment exception | Failure, mismatch, webhook/reconciliation issue | Correct without duplicate charge or hidden balance. |
| Payout exception | Hold, failure, missing compliance | Resolve and communicate next action/date. |
| Dispute | Customer/provider issue reported | Gather evidence and issue documented resolution. |
| Support | User asks for help | Respond under approved SLA and escalate. |
| Compliance expiry | Provider evidence nearing/at expiry | Renew, restrict, or suspend eligibility. |

Each admin override should record actor, timestamp, reason code, free-text detail, before/after values, affected user communication, and related financial event.

## 10. Notification contract

Define a required channel and fallback for:

- account/invite verification;
- request submission and coverage outcome;
- provider offer and expiry reminder;
- match acceptance/decline/exhaustion;
- quote received/revised/expiring/accepted/declined;
- schedule confirmation/change/cancellation;
- job started/completed/confirmation reminder;
- payment success/failure/refund;
- dispute opened/updated/resolved;
- payout scheduled/paid/failed;
- support acknowledgement and response.

Messages must be idempotent, associated with a business event, auditable, privacy-safe, and governed by consent and transactional/marketing classification.

## 11. Measurement plan

### Event families

- Discovery: service/provider viewed, coverage checked.
- Intake: request started, step completed, auth handoff, submitted, abandoned.
- Liquidity: eligible pool count, offer sent, accepted, declined, expired, exhausted, sourced.
- Commercial: price shown, quote sent/revised/accepted/declined/expired, checkout started/completed/failed.
- Fulfillment: scheduled, rescheduled, started, completion submitted/confirmed/disputed.
- Money: payment authorized/captured/refunded/disputed; provider funds held/eligible/paid/failed.
- Quality: review requested/submitted/moderated; support/dispute opened/resolved.
- Operations: admin override, SLA breach, manual correction.

### Required dimensions

Use privacy-minimized identifiers plus service, ZIP/coverage area, service mode, provider, request cohort, lifecycle version, matching version, policy version, device class, actor role, and operational/manual indicator.

### Proposed dashboards

1. Request funnel and abandonment.
2. Supply/liquidity by service and ZIP.
3. Quote and checkout conversion.
4. Fulfillment reliability and exception aging.
5. Payment, refund, and payout reconciliation.
6. Quality, reviews, disputes, and support SLA.
7. Admin intervention rate and reason.

## 12. Release acceptance

The soft launch should not be approved until all critical gates pass:

- [ ] Owner approves product charter, launch audience, geography, services, and commercial role.
- [ ] Owner approves canonical lifecycle and all status transitions.
- [ ] Public cancellation/reschedule/refund policy matches implemented behavior.
- [ ] One checkout, refund, and payout contract is version-controlled and reconciled.
- [ ] Provider vetting standard and public trust wording match.
- [ ] All required database migrations, RPCs, and Edge Functions are reproducible from source.
- [ ] Server/database authorization passes role and cross-account abuse scenarios.
- [ ] Critical request, match, quote, fulfillment, payment, dispute, review, and admin journeys pass automated acceptance tests.
- [ ] Operational queues have owners, hours, SLAs, alerts, and runbooks.
- [ ] Funnel, liquidity, reliability, money, and quality telemetry is live and validated.
- [ ] Terms, privacy, pricing, support, and product UI have one approved policy version.
- [ ] A limited pilot proves end-to-end requests and reconciled payouts before broader traffic.

## 13. Governance

After approval, this document should become the product authority and be versioned with:

- owner and approver names;
- effective date and product version;
- approved/deferred/deprecated scope;
- links from requirements to acceptance scenarios and metrics;
- a decision log for every changed policy, state, role, price, or release gate;
- a project-level `AGENTS.md` directing implementation agents to preserve the approved product contract.

This document was approved by the owner on 2026-08-29. Explicitly unset configuration values and release evidence remain open; approval does not manufacture values or proof that the document requires implementation to produce.


## Approved layered-release addendum — 2026-09-28

Under DEC-2026-022 and CFG-014, the rebuilt app opens first as **R0 public recruiting**: truthful service and approved, eligible provider exploration, homeowner early-access interest and optional verified accounts, real vendor applications, reviewed approvals and invited vendor profile/offer preparation. A homeowner role or verified account alone cannot create a new request or check out. Josh, or a later explicitly authorized admin, grants or revokes audited trial access by service and area. Revocation prevents new transactions while preserving legitimate history and support. The full [interest, consent, withdrawal, vendor and operator contract](../governance/LAYERED-LAUNCH-DECISION.md) governs R0.

**R1** is the invited transactional beta after full booking, money, payout, support and both-role Credits C0–C4 acceptance and owner activation. Its actual opening begins the 90-day beta Day 1 and Founding Vendor qualification. **R2** widens booking by service and Lee County coverage only after measured outcomes and owner decision. The Section 12 transactional checklist remains an R1 gate; R0 has a separate hosted recruiting and backend-refusal gate in the rebuild roadmap. This addendum does not change existing coverage, provider eligibility, price, fee, payout or lifecycle semantics.
