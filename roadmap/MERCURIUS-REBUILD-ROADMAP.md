# Mercurius Rebuild and Implementation Roadmap

**Status:** IN PROGRESS — Phase 5 closed and Phase 6 authorized (DEC-2026-017, 2026-09-26); Phase 4 owner acceptance remains open
**Implementation checkpoint:** `main` at `417e642` (PR #52, TRACE-092–094, merged 2026-09-26 UTC); the original planning baseline was `94d608a`
**Authority:** owner-approved MPS, MDS, and MTS
**Delivery model:** stabilize and rebuild in vertical slices; do not perform a blind rewrite

## 1. Objective

Turn the inherited Mercurius application into a reproducible, accessible, payment-safe, operationally measurable Southwest Florida soft launch while preserving working value and replacing undocumented behavior with approved contracts and automated evidence.

This roadmap supersedes the technology-only sequencing in `mts/MERCURIUS-BUILD-ROADMAP.md` as the combined program plan. That file remains the detailed technical source for its individual controls.

## 2. Governing chain

```text
Approved MPS
  → approved MDS
    → approved MTS
      → roadmap slice
        → code + migration + tests + documentation
          → automated and manual acceptance evidence
```

Implementation may not silently redefine a product rule, state, role, commercial amount, policy, design token, accessibility requirement, or technology boundary.

## 3. What is approved versus still configurable

### Approved

- Product purpose, audience baseline, managed-marketplace model, roles, lifecycle direction, and honesty rules.
- Geist typography, sage commitment actions, SWFL editorial identity, dark-mode support, responsive scope, and WCAG 2.2 AA.
- Modular-monolith architecture, Next.js/Supabase direction, reproducible infrastructure, payment integrity, testing, CI/CD, observability, and recovery requirements.

### Configuration status

The pre-build owner configuration is approved in `governance/CONFIGURATION-DECISIONS.md`:

- all Lee County ZIPs; no beta household cap;
- every catalog service remains visible, with honest unavailable behavior where supply is absent;
- every approved and otherwise eligible vendor participates;
- customers pay Mercurius; Mercurius retains 15% of final service subtotal excluding tax/tips;
- weekly direct ACH provider payout, eligible 48 hours after homeowner-confirmed completion, with disputes held;
- approved cancellation, rescheduling, provider cancellation, weather/emergency, matching, and support rules;
- eight-hour RTO, 24-hour RPO, and approved retention periods;
- owner control of required platform accounts, with scoped APIs/keys to be configured during implementation.

Only evidence-based beta activation, production activation, expansion, and material policy changes require later owner decisions.

## 4. Delivery phases

### Phase 0 — Establish the implementation baseline

**Outcome:** one clean implementation branch, one authority chain, one issue register, and no accidental production mutation.

Work:

1. Commit the MPS, MDS, MTS, approvals, and this roadmap as the documentation baseline.
2. Add a project-level `AGENTS.md` that points implementation work to the approved systems and prohibits silent product/design changes.
3. Create a decision log and traceability matrix: requirement → implementation → test → metric → release gate.
4. Convert every P0/P1 finding into a trackable item with dependency, owner, and acceptance evidence.
5. Capture repository, live-environment, schema, payment, and deployment unknowns without changing production.

**Gate:** documentation baseline reviewed; no application behavior changed; blocking work is traceable.

### Phase 1 — Deterministic developer platform

**Status:** COMPLETE — local and GitHub CI gates passed on 2026-08-29

**Outcome:** a clean clone installs, validates, and runs predictably.

Work:

- Pin Node/npm and enforce the lockfile.
- Add `typecheck`, test, database, E2E, accessibility, and combined `check` scripts.
- Remove build-time type-check bypasses.
- Scope linting to owned code and resolve production dependency advisories.
- Add secret-free environment templates and typed validation.
- Replace the generic README with setup, architecture, safety, and workflow guidance.
- Establish CI for install, lint, type check, and build immediately; expand gates as tests arrive.

**Gate:** `npm ci`, lint, type check, build, secret scan, and production dependency audit pass in CI.

### Phase 2 — Reconstruct the real backend

**Status:** COMPLETE — owner accepted the verified reconstruction and documented
live/local differences on 2026-09-03 (DEC-2026-004). See
`governance/PHASE-2-VALIDATION.md`. Production deployment is not authorized.

**Outcome:** a blank environment recreates every required table, policy, RPC, trigger, bucket, seed, and Edge Function.

Work:

- Obtain a sanitized read-only live schema inventory after backup confirmation.
- Reconcile committed migrations with live objects.
- Commit the missing payment, onboarding, matching, transition, review, and metrics functions.
- Generate typed database bindings.
- Add deterministic reference seed data.
- Add RLS and role-negative tests for anonymous, homeowner, vendor, admin, and service roles.
- Prove two consecutive clean local resets.

**Gate:** the application no longer depends on undocumented live-only backend behavior.

### Phase 3 — MDS foundation and accessibility repair

**Owner acceptance:** COMPLETE on 2026-09-03 (DEC-2026-005); manual follow-ups remain separately tracked.

**Status:** COMPLETE — owner accepted Phase 3; documented manual follow-ups remain separate. See `governance/PHASE-3-VALIDATION.md`.

**Outcome:** critical journeys use an accessible, documented component foundation before large workflow changes.

Work:

- Fix sheet trigger composition, titles/descriptions, mobile menu naming, skip navigation, and focus targets.
- Implement 44px customer and 40px compact portal control contracts.
- Adopt accessible semantic colors and remove failing small-text combinations.
- Complete dark-mode tokens and light/dark logo assets.
- Approve Geist in `DESIGN.md` and align metadata/content identity.
- Add commitment Button, FormField, Select, Textarea, Checkbox, Switch, Status, PageHeader, state patterns, and ConfirmAction.
- Create the component catalog with light/dark, density, responsive, and accessibility examples.

**Gate:** primitives pass axe, keyboard, focus, contrast, 320px reflow, dark-mode, and screenshot baselines.

### Phase 4 — Canonical product lifecycle

**Status:** IN PROGRESS — implemented under DEC-2026-005–010 and merged as PR #5 (`735df91`, 2026-09-04); owner acceptance is open. DEC-2026-017 closed Phase 5 without accepting Phase 4; Phase 4 acceptance and review questions P4-1–P4-7 remain open for a separate owner decision; see governance/PHASE-4-RECONCILIATION.md, PHASE-4-VALIDATION.md and PHASE-5-CLOSURE-READINESS.md. Money integrity remains Phase 5; email/reminder timing stays inactive under DEC-010.

**Phase 2 handoff (TRACE-010):** replace inherited automatic completion
confirmation with admin review; define its deadline separately from the four-hour
vendor offer window. Implement and verify authenticated Supabase Cron-to-worker
execution, concurrency, failure handling, and notification deduplication in an
isolated environment. Keep production scheduling inactive until reviewed activation.

**Outcome:** request, match, quote, job, payment, payout, dispute, and review states follow the approved MPS.

Work:

- Version canonical state machines and actor permissions.
- Migrate existing statuses without losing history.
- Define transition side effects, notifications, timeouts, reversals, and audit events.
- Reconcile the matching specification with the approved lifecycle.
- Implement deterministic offer expiry, provider selection, supply-exhaustion/unavailable behavior, quote expiry/revision, completion, and review eligibility.
- Build role-specific status and next-action UI from the shared Status pattern.

**Gate:** transition matrix and cross-role acceptance tests pass; no record can be stranded in an unmapped state.

### Phase 5 — Money and vendor onboarding integrity

**Status:** CLOSED by the owner, 2026-09-26 (DEC-2026-017). TRACE-050–094 are implemented as
bounded slices through PR #52 on `main` `417e642`; post-merge main CI run 36256537232 passed backend, lifecycle and application. Activation
gates are carried to later phases as listed in the closure readiness report;
the latest [Phase 5 validation](../governance/PHASE-5-VALIDATION.md) records the
synthetic checks. Merging a slice does not close its review, manual acceptance,
hosted integration or production-activation gates.

The delivered contracts cover source-bound checkout and durable Stripe processing;
immutable money journals, reviewed refunds and late reversals; weekly direct ACH
eligibility, transfer outcomes, replacement statements, recovery and bank statement
reconciliation; onboarding, invitation, compliance, renewal and operator-run
retention of declined renewal and rejected or abandoned application documents.
See [traceability](../governance/TRACEABILITY.md) and the
[Phase 5 handoff](../governance/PHASE-5-HANDOFF.md) for each slice's evidence and
limits. TRACE-084's application retention is documented in
[its slice report](../governance/PHASE-5-APPLICATION-RETENTION.md).

Open gates include Codex review of the merged slices; tax and promotion rules;
recurring visit generation and charge timing; legacy money/data cutover; finance
operator provisioning; authorized Stripe, bank and hosted invitation/retention
acceptance; real licensing and insurance requirements; and manual accessibility/brand
acceptance. TRACE-085 removed the admin
application `UPDATE`/`DELETE` and document-storage write privileges (owner decision
2026-09-23). TRACE-086 (PR #43, merged at `1d8a27e`) removed
the direct applicant insert path (owner decision 2026-09-24); route abuse protection,
the `contact_submissions` anonymous insert and application-row deletion were decided in
DEC-2026-012 (2026-09-24); TRACE-087 (PR #45, merged at `0d47134`) makes the contact route
the only writer to `contact_submissions`; TRACE-088 (PR #46, merged at `3e4236c`) adds the honeypot,
fill time and per-email limit to both intake routes (DEC-2026-013); TRACE-089 (PR #47, merged at
`6d1a11a`) adds the per-IP limit (DEC-2026-014); TRACE-090 (PR #48, merged at `cd0c041`) applies
retention to never-attached application uploads (DEC-2026-012 item 5);
TRACE-091 (PR #49, merged at `6c41143`) applies it to renewal uploads never submitted (DEC-2026-015 item 2).
The Codex closure review (TRACE-092) found a retention hold/deletion race and a finalization lost update;
TRACE-093 and TRACE-094 fix them and await re-review ([fixes report](../governance/PHASE-5-REVIEW-FIXES.md)). DEC-2026-015 sets the closure
basis: the gate below plus Codex review, with activation gates carried to named later phases; see
[closure readiness](../governance/PHASE-5-CLOSURE-READINESS.md). The owner closed the phase and authorized Phase 6 in DEC-2026-017.

**Outcome:** customer charges, refunds, provider earnings, payouts, and vendor activation are reproducible and reconciled.

Work:

- Choose and implement one canonical customer checkout flow while preserving the approved Mercurius-direct collection model.
- Persist immutable commercial snapshots and idempotent checkout attempts.
- Make Stripe webhooks durable, replayable, and reconciled.
- Implement fee, tax, deposit, discount, refund, chargeback, and provider-payable ledger rules.
- Implement direct ACH vendor payout, weekly batching, 48-hour post-confirmation eligibility, dispute holds, statements, and failure recovery without Stripe Connect.
- Version provider application, vetting, compliance, activation, invitation, suspension, and renewal evidence.
- Use ConfirmAction and MoneySummary for financial operations.

**Gate:** concurrent checkout, duplicate webhook, partial/full refund, dispute, chargeback, payout, and invite tests pass in non-production environments.

### Phase 6 — Customer, vendor, and admin workflow rebuild

**Status:** AUTHORIZED, not started (DEC-2026-017, 2026-09-26). Steps 2–5 build on Phase 4
contracts that are not yet owner-accepted. Carried in from Phase 5: hide promotion UI and set
recurring generation and charge timing.

**Outcome:** each role can complete its core job using the approved lifecycle and design patterns.

Order:

1. Coverage and request intake.
2. Matching and provider offers.
3. Quotes and scheduling.
4. Job start, evidence, completion, confirmation, and review.
5. Cancellation, rescheduling, support, dispute, and refund.
6. Vendor profile, packages, coverage, compliance, and earnings.
7. Admin operational queues, responsive data lists, audit history, and controlled overrides.

Remove or hide the public Admin link, premature Vendor Plans, and Smart Picks unless an approved purpose is added. Resolve `reviews` versus `quality_feedback` and support-ticket intake.

**Gate:** critical journeys pass desktop/mobile, light/dark, keyboard, screen-reader, role, database, and visual acceptance.

### Phase 7 — Communications, analytics, and operations

**Outcome:** the team can see, measure, and recover every important marketplace outcome.

Work:

- Implement the approved notification matrix and consent distinctions.
- Add funnel, liquidity, quote, checkout, fulfillment, dispute, refund, payout, quality, and admin-override events.
- Create owned operational queues with age, priority, SLA, alert, and next action.
- Add error reporting, uptime/synthetic checks, PII-safe structured logs, and correlation IDs.
- Implement email delivery/retry evidence and domain authentication.
- Create operator runbooks and audit logs.

**Gate:** staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication.

### Phase 8 — Security, recovery, and release automation

**Outcome:** deployment, abuse protection, recovery, and promotion are evidence-driven.

Work:

- Add public abuse protection, rate limits, Turnstile, upload constraints, cleanup, and malware/quarantine policy. (Turnstile is replaced at launch by a honeypot, fill time, and per-email and per-IP limits; DEC-2026-013/014, TRACE-088/089.)
- Add security headers and CSP rollout.
- Complete CI gates for unit, integration, RLS, E2E, axe, visual regression, dependency, secret, migration, and drift checks.
- Isolate preview data and provider configuration.
- Test database and storage restoration separately.
- Record RPO/RTO and exercise payment replay, rollback, and incident runbooks.

**Gate:** security suite, CI, restore drill, alert drill, and rollback drill pass.

### Phase 9 — Private beta

**Outcome:** a controlled cohort proves the complete business loop without uncontrolled expansion.

Work:

- Load only approved ZIPs, services, providers, prices, policies, and support coverage.
- Run real-world request → provider → service → payment → payout → review scenarios with controlled limits.
- Review funnel, liquidity, timing, exception, reconciliation, accessibility, and support results daily.
- Fix P0/P1 issues before adding users or services.

**Gate:** owner signs the beta activation record after all critical evidence is green. There is no household cap; the Lee County boundary and provider availability control exposure.

### Phase 10 — Production activation and measured expansion

**Outcome:** real users and money operate under verified controls.

Work:

- Promote reviewed environment configuration.
- Apply migrations and deploy functions under the approved procedure.
- Run production-safe smoke and controlled payment/refund/payout checks.
- Confirm alerts, backups, reconciliation, policies, support coverage, and rollback readiness.
- Expand by ZIP/service only when supply and outcome thresholds remain green.

**Gate:** owner production go/no-go; pause or rollback automatically when approved stop conditions are met.

## 5. Dependency model

```text
Phase 0 → Phase 1 → Phase 2
                    ├─→ Phase 3
                    └─→ Phase 4
Phase 3 + Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10
```

Phase 3 component work and Phase 4 lifecycle work can proceed in parallel after the backend contract is known. Money work must not precede the schema authority. Broad UI route migration must not precede stable components and lifecycle semantics.

## 6. First implementation increment

The first implementation task should be **Phase 0 plus the smallest safe portion of Phase 1**:

1. Create an implementation branch using the `codex/` prefix.
2. Commit the approved audit/governance baseline.
3. Add the project-level implementation `AGENTS.md` and traceability/decision templates.
4. Pin the supported Node runtime.
5. Repair install reliability and add the initial CI quality gate.
6. Add environment documentation without secrets.
7. Produce a baseline validation report; do not touch production or business workflows yet.

This increment is low-risk, unlocks every later slice, and gives the owner a clean checkpoint before schema reconstruction.

## 7. Working agreement

- One bounded concern per branch/checkpoint.
- Preserve unrelated owner changes.
- Characterize behavior before replacing it.
- Use additive database migrations and forward fixes.
- Never use production data as development seed data.
- Never put secrets into chat, commits, fixtures, screenshots, or command history.
- Every completed slice reports repository changes, external changes, tests, manual evidence, risks, rollback status, owner action, and next slice.
- A phase is complete only when its gate has evidence, not when its code is written.
