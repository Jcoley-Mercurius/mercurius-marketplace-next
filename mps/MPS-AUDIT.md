# Mercurius Product System Audit

**Mode:** AUDIT
**Repository:** `Jcoley-Mercurius/mercurius-marketplace-next`
**Evidence baseline:** `main` at `94d608a`
**Audit date:** 2026-08-29
**Release disposition:** **NOT APPROVED — product contract and launch behavior require owner decisions**

## 1. Audit mandate

This audit reconstructs the apparent product system of an inherited application that has no established Mercurius Product System (MPS) or project-level product governance file. It examines repository documentation, routes, user interfaces, schemas, workflows, role behavior, permissions, business logic, tests, analytics, and commit history.

Existing code and copy are treated as evidence, not approved product truth. This audit does not certify the live Supabase project, Stripe account, deployed Edge Functions, operational procedures, or production data because those were not available in the repository.

### Truth labels

| Label | Meaning |
|---|---|
| **OBSERVED** | Directly evidenced by the repository or its history. |
| **INFERRED** | Most plausible interpretation of multiple observations. |
| **PROPOSED** | Recommended product rule or decision; not yet owner-approved. |
| **APPROVED** | Explicitly accepted by an authorized product owner. None were established during this audit. |
| **DEPRECATED** | Deliberately retired behavior. No repository-wide deprecation authority was found. |

### Behavior labels

| Label | Meaning |
|---|---|
| **ALIGNED** | Implementation and repository product intent agree. |
| **INCOMPLETE** | Some intended behavior exists, but the end-to-end outcome is not complete. |
| **CONFLICTING** | Two sources or product surfaces promise materially different behavior. |
| **UNDOCUMENTED** | Behavior exists without an authoritative product rule or acceptance contract. |
| **DEPRECATED** | Behavior should no longer be part of the supported product. |
| **UNKNOWN** | The repository cannot establish the actual behavior. |

## 2. Executive assessment

Mercurius appears to be a **managed home-services marketplace for Southwest Florida**. It connects homeowners with service providers while Mercurius controls or assists with coverage, pricing presentation, matching, quotes, scheduling, payment, disputes, reviews, and operational oversight.

The repository contains a credible soft-launch product surface: public discovery, request intake, homeowner and vendor portals, an extensive admin console, provider-backed pricing, sequential matching, job fulfillment, invoices, disputes, and reviews. The public experience generally avoids fabricated providers, reviews, prices, and geographic scale. That honesty is a meaningful strength.

The product system is nevertheless **not release-contract ready**. The primary reasons are:

1. Public policy promises cancellation and rescheduling outcomes that the application does not implement.
2. Several critical workflows invoke Edge Functions and database RPCs that are absent from version control, so the effective product cannot be reconstructed or accepted from the repository.
3. Matching, request, job, payment, dispute, and payout states do not have one canonical, approved lifecycle.
4. No automated acceptance suite, CI gate, event analytics, or defined product outcome metrics exist.
5. Provider vetting, payout timing, support response time, refunds, and administrative override authority are asserted or implied without operational acceptance evidence.

**Audit conclusion:** the application is best classified as an **operationally assisted soft-launch candidate**, not an approved self-contained marketplace release.

## 3. Apparent product reconstruction

### 3.1 Purpose and promise

| Reconstruction | Truth | Behavior | Evidence interpretation |
|---|---|---|---|
| Mercurius coordinates trusted local home services rather than acting as a passive directory. | INFERRED | ALIGNED | Request intake, matching, quotes, messaging, payment, dispute, and admin operations are integrated. |
| Initial market is Cape Coral, Fort Myers, and selected Southwest Florida ZIP codes. | OBSERVED | ALIGNED | Product copy, terms, coverage tables, and request gating consistently describe a limited launch region. |
| Customers should receive honest availability and provider-backed pricing. | OBSERVED | ALIGNED | Empty states, coverage checks, quote fallbacks, and public provider eligibility avoid invented inventory. |
| Mercurius is a managed intermediary; providers remain independent businesses. | OBSERVED | ALIGNED | Terms and vendor/application surfaces state this relationship. |
| The product aims to serve homeowners, property managers, snowbirds, and HOA/community use cases. | OBSERVED | INCOMPLETE | Copy identifies these audiences, but the account and property model is homeowner-centric and lacks organizations or delegated property management. |

### 3.2 Users and desired outcomes

| User | Apparent desired outcome | Truth | Behavior |
|---|---|---|---|
| Visitor | Understand coverage, services, providers, pricing modes, and trust model. | INFERRED | ALIGNED |
| Homeowner | Request, schedule, pay for, monitor, confirm, dispute, and review a service. | INFERRED | INCOMPLETE |
| Property manager / snowbird | Coordinate service for one or more remote properties. | OBSERVED audience claim | INCOMPLETE |
| Vendor applicant | Apply, be vetted, receive access, and become eligible for work. | INFERRED | INCOMPLETE |
| Active vendor | Configure offerings, accept work, fulfill jobs, communicate, and understand earnings. | INFERRED | INCOMPLETE |
| Administrator / operator | Govern supply, coverage, price, matching, service delivery, money movement, quality, and support. | INFERRED | ALIGNED but UNDOCUMENTED |
| Mercurius business owner | Build marketplace liquidity and earn a fee on completed work without misleading launch users. | INFERRED | UNKNOWN |

### 3.3 Roles and capabilities

| Role | Observed capabilities | Product-system assessment |
|---|---|---|
| Anonymous | Browse services, pricing, providers, provider profiles, policies; submit contact requests; start a service request; apply as a vendor. | ALIGNED. Request confirmation correctly requires authentication. |
| Homeowner | Maintain home profile; submit requests; review quotes; see jobs and invoices; pay; message; manage payment methods; confirm completion; dispute; review. | INCOMPLETE. Rescheduling and the published cancellation matrix are absent. |
| Vendor | Manage profile/gallery/services/packages; receive offers; accept/decline; start/complete jobs; upload completion evidence; message; view earnings; access basic marketing guidance. | INCOMPLETE. Payout execution and onboarding acceptance are not repository-complete. |
| Admin | Manage requests, matching, vendors, applications, customers, catalog, coverage, pricing, invoices, refunds, disputes, quality, reviews, support, message audit, featured providers, and Smart Picks. | UNDOCUMENTED. Broad override powers lack a product authority and auditability contract. |
| Service role | Execute privileged database/payment/invite operations. | UNKNOWN. Effective privileges depend on live functions and schema not committed here. |

## 4. Feature and domain assessment

| Domain | Observed state | Classification | Key product issue |
|---|---|---|---|
| Public discovery | Services, providers, provider profiles, pricing, about, FAQs, contact, policies. | ALIGNED | Some operational claims still require owner validation. |
| Coverage | ZIP-gated availability with waitlist/contact capture outside coverage. | ALIGNED | Coverage ownership and change approval are undocumented. |
| Customer request intake | Multi-step request wizard, auth handoff, photos/details, frequency, provider selection, price/quote/sourcing paths. | ALIGNED / INCOMPLETE | End-to-end outcomes depend on live-only RPCs. |
| Matching | Eligibility, provider choice, balanced ranking, sequential exclusive offers, offer expiry, admin override. | INCOMPLETE / UNKNOWN | Spec is detailed, but many implementing RPCs are absent from migrations. |
| Quotes | Provider/admin quote flow and homeowner approve/decline behavior. | INCOMPLETE | Quote expiry, revision, tax, cancellation, and payment consequences lack canonical rules. |
| Scheduling | Requested and scheduled dates appear in workflows. | INCOMPLETE | No complete reschedule workflow despite a public policy page. |
| Fulfillment | Vendor start/complete, homeowner confirmation, completion photos, dispute. | INCOMPLETE | Canonical transitions, timeouts, and auto-confirmation rules are not approved. |
| Customer payments | Invoice checkout, saved payment methods, Stripe customer portal, webhook/refund surfaces. | UNKNOWN / INCOMPLETE | Two checkout paths and missing functions prevent repository-level acceptance. |
| Vendor earnings/payout | Earnings derived from invoices marked `released`; copy describes a weekly payout cycle as intended. | INCOMPLETE / UNKNOWN | No Stripe Connect or other payout execution is evidenced. |
| Disputes/refunds | Customer issue reporting, admin dispute resolution, payout hold, refund function. | INCOMPLETE | Resolution matrix, evidence standard, deadlines, and authority limits are undocumented. |
| Reviews/quality | Verified job review flow, public reviews, admin moderation/quality views. | INCOMPLETE | `quality_feedback` and `reviews` overlap; moderation and appeal rules are not defined. |
| Vendor onboarding | Public application and admin approve/reject/invite/link flow. | UNKNOWN / INCOMPLETE | Invite function is absent; vetting criteria are not codified. |
| Vendor pricing | Fixed, deposit-plus-quote, custom quote; tiers, add-ons, questions, promotions, price-review guardrails. | ALIGNED / UNDOCUMENTED | Rule details exist in code but lack approved product authority. |
| Admin operations | Large operational console spanning nearly every marketplace domain. | ALIGNED / UNDOCUMENTED | Manual controls have no explicit separation-of-duties or audit-log acceptance rule. |
| Notifications/messages | Portal messaging and notification surfaces. | INCOMPLETE / UNKNOWN | Delivery channels, triggers, retention, escalation, and consent are not specified. |
| Vendor marketing | Share listing, review guidance, launch checklist; growth features shown as deferred. | ALIGNED | Route naming and plan positioning need an explicit soft-launch decision. |
| Product analytics | Admin pricing summaries derived from service requests. | INCOMPLETE | No customer journey, liquidity, reliability, revenue, or quality event instrumentation. |

## 5. Reconstructed workflows

### 5.1 Service request

**Observed:** a visitor selects a service and location, passes a coverage check, provides details and optional media, chooses an eligible provider or defaults to matching, signs in if needed, and confirms the request. The system then follows fixed-price, quote, or sourcing behavior.

**Assessment:** ALIGNED in interface design; INCOMPLETE as a product contract. The repository cannot prove every matching RPC, provider notification, offer timeout, or quote outcome.

### 5.2 Provider matching

**Observed:** documentation describes eligible-provider filtering, `marketing_enabled`, balanced ranking, a default “Match me” path, homeowner choice, sequential exclusive four-hour offers, and admin controls. Code invokes matching and offer RPCs.

**Assessment:** INCOMPLETE / UNKNOWN. The design is unusually explicit, but the actual database implementation is not fully committed. Matching states such as `awaiting_match`, `offered`, `quote_pending`, and `sourcing` also do not map cleanly to the central request-status list.

### 5.3 Quote path

**Observed:** quote-mode work can be priced and sent; a homeowner can accept, causing scheduling, or decline, causing cancellation.

**Assessment:** INCOMPLETE. There is no approved rule for quote validity, revision, competing quotes, deposits, expiry, tax/fee presentation, or what happens after decline.

### 5.4 Fulfillment and completion

**Observed:** vendors can accept or decline offers, start work, complete work with photos, and wait for homeowner confirmation. A homeowner may confirm, dispute, and later review.

**Assessment:** INCOMPLETE. Time-based transitions, no-show handling, repeat service behavior, evidence standards, and auto-resolution are not authoritative.

### 5.5 Payment, fee, and payout

**Observed:** Mercurius charges customers through Stripe-oriented checkout and invoice flows; a 15% platform fee is encoded; admins may modify invoice attributes and mark funds released; vendors see earnings tied to released invoices.

**Assessment:** UNKNOWN / INCOMPLETE. The repository does not establish one checkout authority, money-state lifecycle, tax treatment, chargeback behavior, or actual provider payout rail.

### 5.6 Dispute and refund

**Observed:** homeowners can report issues; admins can hold payout, resolve disputes, and invoke a refund function.

**Assessment:** INCOMPLETE. The product lacks approved eligibility, deadlines, partial-refund policy, evidence requirements, appeal path, notification contract, and reconciliation rules.

### 5.7 Vendor lifecycle

**Observed:** an applicant submits business and service information; an admin reviews, approves/rejects, links or creates a contractor record, and sends an invite. The vendor configures profile, eligibility, coverage, and offerings before taking work.

**Assessment:** UNKNOWN / INCOMPLETE. The invite function and much of the account-linking authority are outside the committed system. “Vetted” is public-facing, but the vetting standard is not a product rule.

## 6. Reconstructed business rules

These rules are repository observations, not owner approvals.

| Rule | Truth | Classification |
|---|---|---|
| Soft launch has no vendor subscription fee. | OBSERVED | ALIGNED |
| Mercurius takes 15% of completed work. | OBSERVED | UNDOCUMENTED operationally |
| Pricing modes are fixed, deposit-plus-quote, and custom quote. | OBSERVED | ALIGNED |
| Service frequencies include one-time, weekly, twice monthly, monthly, and quarterly. | OBSERVED | ALIGNED |
| Fixed-price publication requires valid active provider-backed pricing. | OBSERVED | ALIGNED |
| Fixed-price packages require positive tier pricing and review clearance. | OBSERVED | ALIGNED |
| Deposit-plus-quote requires a valid deposit. | OBSERVED | ALIGNED |
| Promotions are capped at 80%; fixed promotions apply to a single tier. | OBSERVED | UNDOCUMENTED |
| Custom-price review uses an approximate 25%–400% reference band or $20–$5,000 fallback. | OBSERVED | UNDOCUMENTED |
| Matching eligibility requires appropriate service/coverage and marketing eligibility. | OBSERVED | INCOMPLETE |
| Sequential offers are intended to remain exclusive for four hours. | OBSERVED | UNKNOWN implementation |
| Homeowner-selected provider may override default matching order. | OBSERVED | INCOMPLETE |
| Vendor earnings are visible when invoice funds are marked released. | OBSERVED | INCOMPLETE |

## 7. Material conflicts

### C-01 — Cancellation and rescheduling

**Severity: critical**
**Truth:** OBSERVED
**Behavior:** CONFLICTING

The public reschedule policy promises dashboard rescheduling/cancellation and specifies timing-based fees and refund percentages. The application exposes no reschedule action and only permits cancellation while a request is `pending`. This creates customer expectation, financial, support, and legal risk.

### C-02 — Checkout authority

**Severity: high**
**Truth:** OBSERVED
**Behavior:** CONFLICTING / UNKNOWN

The repository contains a `checkout-request` function while application code also invokes an uncommitted `create-checkout` function. Without an approved boundary, it is unclear which flow is canonical and whether both enforce the same amount, customer, invoice, idempotency, and eligibility rules.

### C-03 — Status language

**Severity: high**
**Truth:** OBSERVED
**Behavior:** CONFLICTING / UNDOCUMENTED

Matching documentation and RPCs use a layer of matching states that does not align cleanly with the central service-request status vocabulary. Job, quote, invoice, dispute, and match states also have interdependencies without one state machine.

### C-04 — Audience versus account model

**Severity: medium**
**Truth:** OBSERVED
**Behavior:** INCOMPLETE

Public copy includes property managers, snowbirds, and HOA/community scenarios, while the application provides a single homeowner profile model rather than organizations, multiple managed properties, team members, or delegated access.

## 8. Critical unknowns and incomplete behavior

| ID | Finding | Classification | Consequence |
|---|---|---|---|
| U-01 | Invoked functions `list-payment-methods`, `create-checkout`, `customer-portal`, and `vendor-invite` are not committed. | UNKNOWN | Core payment and onboarding outcomes cannot be audited or reproduced. |
| U-02 | Many invoked RPCs, including matching, transition, quote, metrics, and review operations, are absent from migrations. | UNKNOWN | Live behavior may differ materially from repository intent. |
| U-03 | No canonical product lifecycle spans request, match, quote, job, invoice, dispute, review, and payout. | UNDOCUMENTED | UI and operations can diverge or strand records. |
| U-04 | Provider vetting criteria and approval evidence are not codified. | UNDOCUMENTED | “Vetted” and licensing/insurance claims may not be consistently supportable. |
| U-05 | Weekly payout is described as intended, but no payout execution is evidenced. | INCOMPLETE | Vendors cannot form a reliable cash-flow expectation. |
| U-06 | “We respond within 24 hours” has no queue, calendar, escalation, or measurement contract. | UNDOCUMENTED | Public SLA may be missed without visibility. |
| U-07 | Admins can exercise broad financial and lifecycle overrides without an approved permission/audit matrix. | UNDOCUMENTED | Fraud, mistake, and accountability risks remain. |
| U-08 | No consent and delivery contract governs email, portal notification, or possible SMS behavior. | UNDOCUMENTED | Users may miss time-sensitive offers, quotes, or service changes. |
| U-09 | Account deletion, data export, and privacy-request handling are not available as an explicit workflow. | INCOMPLETE | Privacy obligations rely on manual contact handling. |
| U-10 | Production environment, actual coverage, real providers, real payment readiness, and operational staffing were not evidenced. | UNKNOWN | Release state cannot be certified from source. |

## 9. Orphan, legacy, and premature surfaces

| Surface | Evidence | Assessment | Proposed disposition |
|---|---|---|---|
| Smart Picks | Admin management exists; no public consumer was found. | Orphan / UNDOCUMENTED | Either define its public purpose and ranking relationship or deprecate it. |
| Support tickets | Admin queue exists; no customer ticket-creation route was found. | Orphan / UNKNOWN | Identify external ingestion or add an approved intake; otherwise deprecate. |
| `quality_feedback` | Admin references exist while customer reviews use `reviews`. | Possible legacy overlap | Migrate to one quality model or document separate purposes. |
| Vendor Plans | Navigation exists, but subscriptions are intentionally absent in soft launch. | Premature / potentially transparent | Keep only if framed as launch status, not a purchasable promise. |
| Public Admin link | Footer exposes `/admin`; authentication still gates access. | Product-navigation defect | Remove from public navigation; it adds confusion without user value. |

No item is formally **DEPRECATED** until an owner approves that disposition.

## 10. Product risks

| Risk | Likelihood | Impact | Product control required |
|---|---:|---:|---|
| Customer receives a refund/cancellation outcome different from published policy. | High | Critical | One approved policy implemented and acceptance-tested. |
| Customer is charged the wrong amount or twice across competing checkout paths. | Unknown | Critical | Canonical payment authority, idempotency, and reconciliation. |
| Vendor accepts or completes work but is not paid predictably. | Medium | Critical | Approved payout mechanism, timing, holds, and exception handling. |
| Request becomes stranded between matching/status layers. | Medium | High | Unified lifecycle and timed operational queues. |
| Public “vetted” claim exceeds actual review procedure. | Medium | High | Vetting checklist, expiry, proof, and public wording. |
| Operational team misses a quote, match expiry, dispute, or support SLA. | High | High | Queue ownership, alerts, timers, and service-level telemetry. |
| Admin action changes money or status without sufficient traceability. | Medium | High | Least privilege, reason codes, immutable audit events, dual control where needed. |
| Marketplace appears functional but has inadequate supply/liquidity. | Unknown | High | Funnel and matching outcome metrics by ZIP/service. |
| Property-manager promise creates needs the homeowner model cannot serve. | Medium | Medium | Narrow launch audience or define multi-property requirements. |

## 11. Tests, analytics, and acceptance evidence

### Tests

No automated unit, integration, end-to-end, policy, accessibility-regression, payment, matching, or role-authorization suite was found. No CI release gate was found. Type checking and production build validation are useful engineering checks but do not establish product acceptance.

### Analytics

No customer-journey event system or error/outcome telemetry was found. The admin pricing analytics page queries application records and is not a product measurement system.

The repository cannot currently answer:

- What percentage of covered requests reach a provider offer, acceptance, schedule, completion, payment, and review?
- How long do matching, quote, support, dispute, refund, and payout take?
- Where do users abandon request intake or checkout?
- Which ZIP/service combinations lack viable supply?
- How often do admins override price, match, status, refund, or payout?
- What are cancellation, dispute, refund, repeat-use, and provider-retention rates?

### Acceptance posture

There is no durable mapping from product requirement to scenario, evidence, metric, owner, or release gate. Current acceptance behavior is therefore predominantly **UNDOCUMENTED**.

## 12. History and release-state interpretation

The commit history shows rapid construction from a default Next.js application into public marketing, homeowner authentication, multi-role portals, storefront, payment safety, vendor operations, pricing/coverage, matching, disputes/refunds, and repeated “soft-launch honesty” passes over roughly two weeks.

This indicates a deliberate launch-oriented prototype with significant operational breadth. It does **not** establish that the product was released, accepted, or run successfully in production.

**Observed release language:** soft launch.
**Inferred release model:** limited-region, high-touch, operationally assisted beta.
**Actual live release state:** UNKNOWN.
**Proposed release classification:** `SOFT_LAUNCH_CANDIDATE / NOT_APPROVED` until the launch gates in the proposed MPS are satisfied.

## 13. Decision register summary

Owner approval is required for at least these boundaries:

1. Exact launch geography, services, and customer segments.
2. Whether Mercurius is a coordinator, merchant of record, marketplace agent, or another commercial role.
3. Canonical request/job/payment lifecycle and which system owns each transition.
4. Matching eligibility, ranking, offer exclusivity, expiry, and administrator override rules.
5. Fixed, quote, deposit, promotion, platform-fee, tax, refund, and payout rules.
6. Cancellation, rescheduling, no-show, dispute, and rework policy.
7. Provider vetting standard and public trust language.
8. Support and operational response commitments.
9. Customer/provider notification channels and consent.
10. Product metric targets and soft-launch exit criteria.
11. Disposition of Smart Picks, support tickets, `quality_feedback`, Vendor Plans, and the public Admin link.
12. Whether property managers and organizations are in launch scope.

The actionable decision list is in [MPS-APPROVAL-CHECKLIST.md](./MPS-APPROVAL-CHECKLIST.md). The proposed product contract is in [PROPOSED-MPS.md](./PROPOSED-MPS.md).

## 14. Audit disposition

The reconstruction is suitable as a **proposal for owner review**, not an approved MPS. No application code was modified during this audit. The recommended next move is to resolve the critical policy, money, state, and role decisions; then use the approved MPS and the existing technology audit as inputs to a single Mercurius build roadmap.
