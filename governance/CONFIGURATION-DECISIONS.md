# Mercurius Configuration Decisions

**Status:** ACTIVE
**Owner:** Repository owner
**Purpose:** Record concrete launch values that implement the approved MPS, MDS, and MTS without reopening those systems.

## CFG-001 — Private-beta geography

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Decision:** Mercurius will serve all of Lee County, Florida during private beta.
- **Enforcement:** An explicit backend ZIP-code allowlist is authoritative. County/city names are descriptive and must not replace ZIP-level enforcement.
- **Included examples:** Cape Coral, Fort Myers, Lehigh Acres, and the Lee County portion of Bonita Springs.
- **Change authority:** Project owner.
- **Acceptance evidence:** The committed coverage configuration must match the approved backend allowlist; covered and uncovered boundary ZIPs must pass automated request-flow tests.
- **Implementation note:** Export and reconcile the existing backend coverage records during backend reconstruction. Do not invent, expand, or silently remove ZIP codes.
- **Allowlist (DEC-2026-021, 2026-09-27):** The owner approved the 47 USPS Lee County ZIPs, committed in migration `20260927010000_cfg001_lee_county_coverage.sql`. Hosted rows are reconciled against it during the hosted migration.
- **Boundary clarification (owner reaffirmed 2026-09-27):** 33917, 33921, 33936 and 34134 are covered in full; 33955, 34110 and 34119 are excluded. ZIP enforcement does not trim coverage to county portions. Existing hosted rows must be reconciled before activation; the additive migration preserves other rows. See [Codex review](PHASE-6-DECISION-REVIEW.md#zip-boundary-calls).

## CFG-002 — Service visibility and unavailable supply

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Decision:** Every catalog service remains publicly visible during beta.
- **Unavailable behavior:** If no eligible provider serves the customer’s location for that service, show **“Not available yet in your area.”** The service must not appear bookable and no active service request is created.
- **Prohibited behavior:** Do not imply that a provider is assigned, that sourcing is underway, or that a fulfillment date exists.
- **Acceptance evidence:** Covered/eligible and unavailable combinations must produce distinct server-validated outcomes and honest confirmation copy.

## CFG-003 — Beta vendor participation

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Decision:** Every approved vendor participates in beta.
- **Eligibility:** Participation does not bypass service, coverage, active-status, or other approved match-eligibility rules.
- **Acceptance evidence:** Every approved and eligible vendor can enter the relevant candidate pool; unapproved vendors cannot.

## CFG-004 — Customer payment and commercial model

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Decision:** Customers pay Mercurius directly. Mercurius retains its platform fee and pays vendors their proceeds.
- **Commercial intent:** Mercurius is the customer-facing payment operator for platform bookings. Formal legal, tax, and payment-provider classification must be validated during implementation without changing this approved customer experience.
- **Acceptance evidence:** Customer receipts, ledger entries, refunds, provider statements, and reconciliation reflect Mercurius collection and vendor remittance.

## CFG-005 — Platform fee, tips, tax, deposits, and refunds

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Platform fee:** Flat 15% of the final service subtotal after discounts and adjustments.
- **Excluded from fee base:** Tax and tips.
- **Tips:** 100% belongs to the provider.
- **Deposits:** A deposit is a payment toward the final service subtotal, not an additional fee base.
- **Refund effect:** After a full or partial refund, the 15% fee is calculated against the final retained service subtotal.
- **Processor cost:** Customer-payment processing cost is a Mercurius operating cost and is not deducted a second time from provider proceeds.
- **Tax:** Tracked separately from service subtotal and excluded from the 15% fee; calculation and remittance must follow the implemented tax authority.

## CFG-006 — Customer cancellation and rescheduling

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Customer cancellation:** 72 or more hours before service: full refund. From 24 to under 72 hours: 50% refund. Under 24 hours: no refund.
- **Customer rescheduling:** 48 or more hours before service: free. From 24 to under 48 hours: $25. Under 24 hours: handled case by case and not guaranteed.
- **Weather, emergencies, and acts of God:** Applicable cancellation/rescheduling fees and refund penalties are waived when operations accepts that severe weather, an emergency, or another uncontrollable event reasonably prevented service. Operations records the reason and resulting customer/provider communication.
- **Acceptance evidence:** Boundary-time tests and waived-exception tests produce the same outcome in policy copy, UI, ledger, notifications, and admin tools.

## CFG-007 — Provider cancellation and no-show

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Decision:** Attempt to rematch first. If Mercurius cannot provide an acceptable replacement, issue the customer a full refund.
- **Quality effect:** Provider cancellation or no-show is recorded as a quality event.
- **Exception:** Operations may excuse a provider for a documented or reasonably accepted emergency or uncontrollable event and must record the reason.

## CFG-008 — Provider payout

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Rail:** Direct ACH from Mercurius to the vendor. Do not design the approved payout flow around Stripe Connect.
- **Schedule:** Weekly.
- **Eligibility:** Funds become payout-eligible 48 hours after homeowner-confirmed completion.
- **Holds:** Disputed work remains held until resolution. No general beta reserve applies beyond approved holds.
- **Provider proceeds:** 85% of the final service subtotal plus 100% of tips, subject to refunds/adjustments and separate tax handling.
- **Acceptance evidence:** ACH batch, statement, ledger, hold, failure, retry, and reconciliation scenarios must pass before real payout activation.

## CFG-009 — Matching

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Selected provider:** An eligible homeowner-selected provider receives the first offer.
- **Default matching:** Otherwise use the approved balanced ranking.
- **Exclusivity:** One provider receives an exclusive four-hour offer at a time.
- **Exhaustion:** When no eligible provider accepts, show the honest unavailable outcome: **“Not available yet in your area.”** Do not claim active sourcing.

## CFG-010 — Support commitment

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Business hours:** Monday–Friday, 9:00 a.m.–5:00 p.m. Eastern Time.
- **Standard response target:** Within one business day.
- **Priority:** Issues involving an appointment scheduled for that day receive same-day priority handling during support hours.
- **Escalation owner:** Project owner until a delegated operations owner is recorded.
- **Public wording:** Do not promise a universal 24-hour calendar-time response.

## CFG-011 — Recovery and retention

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **RTO:** 8 hours during beta.
- **RPO:** 24 hours maximum recoverable data loss during beta.
- **Financial and completed-service records:** 7 years.
- **Support tickets and platform messages:** 3 years.
- **Rejected or abandoned vendor documents:** 90 days, subject to active investigation or legal hold.
- **Operational application logs:** 90 days, with secrets and unnecessary personal data prohibited.
- **Acceptance evidence:** Backup and restore drills must demonstrate the targets; retention jobs must be observable and reversible where appropriate.

## CFG-012 — Private-beta cohort

- **Status:** APPROVED
- **Decision date:** 2026-08-29
- **Decision:** No household/user cap applies to the beta.
- **Boundary:** Beta remains limited by the approved Lee County ZIP allowlist and available approved vendors.
- **Expansion:** Expansion outside Lee County still requires owner approval and release evidence.

## CFG-013 — Platform accounts and access

- **Status:** APPROVED / AVAILABLE
- **Decision date:** 2026-08-29
- **Decision:** The owner controls the required GitHub, Supabase, Stripe/customer-payment, Vercel, Resend/email, and domain/DNS accounts.
- **Implementation need:** APIs, applications, webhook endpoints, scoped keys, and environment secrets may still need to be created and configured.
- **Security rule:** Credentials are entered directly into approved provider dashboards or local secret stores and are never placed in chat, commits, fixtures, screenshots, or documentation.

## Remaining release decisions

The system and configuration baselines are approved. CFG-014 adds a distinct R0 recruiting go/no-go before the later transactional checkpoints. Remaining owner decisions are evidence-based:

1. R0 public recruiting activation after its hosted and operator gate is green.
2. R1 invited transactional beta activation after its booking, money, payout and Credits gate is green.
3. R2 wider Lee County booking after measured outcomes and owner expansion decision.
4. Expansion beyond Lee County or a material change to the approved commercial/policy model.


## CFG-014 — Layered recruiting and transactional opening

- **Status:** APPROVED by founder, 2026-09-28 (America/New_York).
- **Decision:** Release the rebuilt app for public recruiting (R0), then open an invited transactional beta (R1), then widen homeowner booking by verified service/ZIP cells (R2). See [the full approved contract](LAYERED-LAUNCH-DECISION.md) and DEC-2026-022.
- **R0:** Live homeowner interest and optional verified account; real vendor applications and approved-vendor preparation. Non-invited homeowners cannot create new service requests or check out through direct URLs, RPCs or APIs. Existing legitimate history and support remains available.
- **Revocation:** Blocks every new checkout, including for a request created before revocation (DEC-2026-023), while preserving legitimate history.
- **R1 clock:** The 90-day beta Day 1 and Founding Vendor qualification begin when R1 transactions actually open, never at R0 or an assumed September 30 date.
- **R0 interest:** Email, Lee County ZIP, service interests or “still exploring”; optional first name; separate expansion-interest path for other ZIPs; independent unchecked marketing consent. Retention and withdrawal follow the full contract.
- **Activation:** Merges are implementation evidence only. Hosted migration, email, deployment, domain and R0 activation each need the release procedure and specific owner go/no-go. R1 money/payout and Credits have a separate later gate.
- **Acceptance evidence:** TRACE-100–105 and the R0 gate in the rebuild roadmap.
