# MPS Owner Approval Checklist

**Status:** OPEN
**Instruction:** The product owner should approve, revise, defer, or deprecate each item. A checked box alone is insufficient for commercial, legal, or operational policy; record the decision, owner, effective date, and policy version.

## A. Product and release boundary

- [ ] **A1 — Product role:** Approve whether Mercurius is a managed marketplace/coordinator and define its contractual and merchant-of-record role.
- [ ] **A2 — Launch classification:** Approve `limited operationally assisted soft-launch beta` as the current release state.
- [x] **A3 — Geography:** All Lee County, Florida ZIP codes, enforced by the existing explicit backend allowlist; changes require project-owner approval. See `governance/CONFIGURATION-DECISIONS.md` CFG-001.
- [x] **A4 — Services:** Every catalog service remains visible; a service without eligible local supply displays “Not available yet in your area” and is not bookable.
- [ ] **A5 — Customer scope:** Decide whether launch supports only individual homeowners or also property managers, HOAs, teams, and delegated users.
- [ ] **A6 — Exit criteria:** Set measurable conditions for moving from soft launch to broader availability.

## B. Roles, permissions, and administration

- [ ] **B1 — Role matrix:** Approve visitor, homeowner, vendor, admin, finance, support, and service-role capabilities.
- [ ] **B2 — Admin separation:** Decide which actions require finance/admin specialization or second-person approval.
- [ ] **B3 — Override policy:** Approve required reasons, audit fields, notifications, and reversibility for price, match, status, refund, dispute, and payout overrides.
- [ ] **B4 — Customer data access:** Define when vendors and administrators may view contact, property, payment, message, and job evidence data.
- [ ] **B5 — Account lifecycle:** Approve invitation, suspension, role change, closure, deletion, and data-export behavior.

## C. Request and matching model

- [ ] **C1 — Canonical lifecycle:** Approve separate request, match, quote, payment, payout, dispute, and review states.
- [x] **C2 — Fixed/quote/unavailable:** Fixed and quote services require eligible supply; otherwise display “Not available yet in your area” without creating a request.
- [ ] **C3 — Provider selection:** Decide when a homeowner can select a provider and what happens if that provider is ineligible or declines.
- [ ] **C4 — Eligibility:** Approve required provider status, service capability, coverage, availability, compliance, and marketing flags.
- [ ] **C5 — Ranking:** Approve ranking factors, weights, fairness goals, explainability, and versioning.
- [x] **C6 — Offer exclusivity:** Sequential-exclusive offers with a four-hour expiry are approved.
- [x] **C7 — Supply exhaustion:** Close with the honest unavailable outcome; do not claim active sourcing.
- [ ] **C8 — Manual assignment:** Define when admins may bypass matching and what consent/evidence is required.

## D. Pricing and commercial model

- [x] **D1 — Platform fee:** 15% of final service subtotal after discounts/adjustments, excluding tax and tips; refunds reduce the retained fee base.
- [ ] **D2 — Vendor subscription:** Approve $0 subscriptions during soft launch and remove/clarify any contrary plan expectation.
- [ ] **D3 — Fixed pricing:** Approve tier, add-on, qualification, effective-date, and commercial snapshot rules.
- [ ] **D4 — Quote pricing:** Approve quote contents, revision, expiry, decline, competing-quote, and acceptance behavior.
- [ ] **D5 — Deposits:** Define when deposits apply, whether refundable, how credited, and what happens after abandonment/cancellation.
- [ ] **D6 — Promotions:** Approve the 80% cap, funder, stacking, tier limitations, refund allocation, and expiry timezone.
- [ ] **D7 — Price guardrails:** Approve or replace the existing 25%–400% / $20–$5,000 review thresholds.
- [ ] **D8 — Taxes and tips:** Define calculation, collection, reporting, display, fee basis, and refund treatment.

## E. Fulfillment policy

- [ ] **E1 — Schedule confirmation:** Define the conditions that make an appointment confirmed.
- [x] **E2 — Rescheduling:** 48+ hours free; 24–48 hours $25; under 24 hours case by case. Accepted weather/emergency/acts-of-God events waive penalties.
- [x] **E3 — Customer cancellation:** 72+ hours full refund; 24–72 hours 50%; under 24 hours no refund, with approved uncontrollable-event waiver.
- [x] **E4 — Vendor cancellation:** Rematch first, otherwise full refund; record quality impact unless an emergency/uncontrollable exception is accepted.
- [x] **E5 — No-shows:** Provider no-show follows vendor cancellation/rematch/refund and quality handling; detailed evidence and appeal UX remains an implementation contract.
- [ ] **E6 — Completion:** Approve required evidence, homeowner confirmation window, and any auto-confirm rule.
- [ ] **E7 — Recurring services:** Decide whether recurring requests are launch scope and define occurrence, cancellation, pricing, and review behavior.

**Critical decision:** the current public reschedule/cancellation page must be revised or the matching behavior must be implemented before release approval.

## F. Payment, refund, and provider payout

- [ ] **F1 — Checkout authority:** Select one canonical checkout flow and deprecate the other.
- [ ] **F2 — Charge timing:** Decide authorization/capture timing for fixed, quote, deposit, recurring, and adjusted work.
- [ ] **F3 — Money ledger:** Approve immutable commercial snapshots and reconciliation across charge, fee, refund, and provider payable.
- [ ] **F4 — Refund authority:** Define full/partial refund eligibility, admin limits, reason codes, and notification.
- [ ] **F5 — Disputes/chargebacks:** Define evidence, response deadlines, ownership, financial treatment, and appeal.
- [x] **F6 — Payout mechanism:** Direct ACH from Mercurius to vendors; do not use Stripe Connect as the approved payout design.
- [x] **F7 — Payout timing:** Weekly; eligible 48 hours after homeowner-confirmed completion.
- [x] **F8 — Holds/reserves:** Disputed work remains held; no general beta reserve applies beyond approved exception holds.
- [ ] **F9 — Financial approval:** Decide which manual money changes require dual control.

## G. Provider trust and quality

- [ ] **G1 — “Vetted” definition:** Approve the exact checks and acceptable public wording.
- [ ] **G2 — Licensing/insurance:** Define category/jurisdiction requirements, evidence, expiry, renewal, and public badges.
- [ ] **G3 — Provider activation:** Approve the activation checklist and accountable operator.
- [ ] **G4 — Suspension/removal:** Define triggers, pending-job handling, appeals, and customer communication.
- [ ] **G5 — Review eligibility:** Approve verified-review requirements, duplicate/edit behavior, and publication timing.
- [ ] **G6 — Moderation:** Approve public/private feedback distinction, moderation criteria, provider response, and appeal.

## H. Support, communications, and privacy

- [x] **H1 — Support SLA:** Monday–Friday 9 a.m.–5 p.m. Eastern; response within one business day; same-day priority during support hours for that day’s appointments.
- [ ] **H2 — Notification matrix:** Approve required events, channels, fallbacks, reminders, and message ownership.
- [ ] **H3 — Consent:** Define transactional versus marketing email/SMS consent and opt-out behavior.
- [ ] **H4 — Message/privacy retention:** Approve retention and access for messages, photos, application documents, payment metadata, and audit events.
- [ ] **H5 — Privacy requests:** Define identity verification, export, correction, deletion, exceptions, and completion time.
- [ ] **H6 — Policy versioning:** Ensure terms, privacy, cancellation, pricing, and accepted quotes preserve the governing version.

## I. Orphan and deferred feature disposition

- [ ] **I1 — Smart Picks:** Approve a customer-facing editorial purpose and relationship to matching, or mark DEPRECATED.
- [ ] **I2 — Support tickets:** Identify the real intake source and workflow, add one, or mark DEPRECATED.
- [ ] **I3 — `quality_feedback`:** Define a private-feedback role distinct from reviews, migrate it, or mark DEPRECATED.
- [ ] **I4 — Vendor Plans:** Keep as honest soft-launch information, remove from navigation, or define a later approved release.
- [ ] **I5 — Public Admin link:** Approve removal from the public footer.
- [ ] **I6 — Advanced vendor marketing:** Keep explicitly deferred until core marketplace outcomes are proven.

## J. Measurement and acceptance

- [ ] **J1 — Outcome metrics:** Approve request, liquidity, quote, fulfillment, money, quality, and retention definitions.
- [ ] **J2 — Event taxonomy:** Approve event names, required dimensions, privacy constraints, and ownership.
- [ ] **J3 — Operational queues:** Assign owners, business hours, SLAs, alerts, and runbooks for availability exceptions, quotes, schedule exceptions, money, payouts, disputes, support, and compliance.
- [ ] **J4 — Acceptance suite:** Require automated role, request, matching, quote, payment, refund, payout, dispute, and review scenarios.
- [ ] **J5 — Reproducible product backend:** Require every production migration, RPC, trigger, and Edge Function in version control.
- [x] **J6 — Pilot cohort:** No household cap; all Lee County ZIPs, every catalog service visible, and every approved eligible vendor participates. Unavailable supply is clearly labeled.
- [ ] **J7 — Go/no-go authority:** Name the product, operations, technical, finance, legal, and security approvers.
- [ ] **J8 — Post-launch review:** Set a review date and thresholds for pause, rollback, policy change, or expansion.

## Decision record template

Use this block for each approved item:

```text
Decision ID:
Disposition: APPROVED | REVISED | DEFERRED | DEPRECATED
Decision:
Rationale:
Owner:
Required approvers:
Effective date:
Policy/product version:
Implementation impact:
Acceptance evidence:
Metric/alert impact:
Supersedes:
```

## Approval state

At audit completion, no checklist item is marked **APPROVED**. Repository behavior remains evidence; the proposed MPS remains a recommendation until the authorized owner records decisions and acceptance evidence.
