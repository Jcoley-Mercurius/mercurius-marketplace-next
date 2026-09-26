# Phase 6 scope and Claude starting brief

Date: 2026-09-26. Planning base: `7ed92a9`; Phase 5 implementation checkpoint: `417e642` (PR #52).
Status: planned under DEC-2026-017; **hold released** and Phase 4 accepted (DEC-2026-019). Start with slice 6.1 (TRACE-095).
Phase 4 review findings P4-R1/P4-R2 were repaired by TRACE-097 ([report](PHASE-4-COMPLETION-INTEGRITY.md)).
Codex scopes and reviews; Claude implements one bounded slice at a time.

## Count and order

The roadmap lists seven workflow areas. Plan for **13 implementation slices**, followed
by a phase acceptance checkpoint. This is a planning count, not a fixed PR count;
characterization and review findings may require documented splits. Detailed briefs
for later slices follow before their implementation.

| Slice | Roadmap area | Bounded result |
|---|---|---|
| 6.1 / TRACE-095 | Coverage and intake | Authoritative, duplicate-safe request submission; server/database coverage, eligible supply and pricing-mode enforcement |
| 6.2 | Coverage and intake | Accessible intake, property/details/photos, authentication continuation, interest, price review and honest confirmation; hide public promotions on these surfaces |
| 6.3 | Matching and offers | Homeowner provider selection/status and vendor accept/decline/expiry; four-hour exclusivity, fallback consent and honest exhaustion |
| 6.4 | Quotes and scheduling | Quote creation/revision/expiry and acceptance/decline with immutable commercial review and payment/deposit failure recovery |
| 6.5 | Quotes and scheduling | One-time appointment confirmation, shared timezone and schedule history |
| 6.6 | Quotes and scheduling | Recurring occurrence generation and charge timing after an owner operating decision; auditable visit identities and duplicate-safe generation |
| 6.7 | Fulfillment and review | Vendor start/evidence/completion; homeowner confirmation and exception next actions; assigned-actor and payout guards |
| 6.8 | Fulfillment and review | Canonical verified reviews/private feedback and moderation/edit/appeal history; resolve reviews versus quality_feedback |
| 6.9 | Exceptions | Cancellation/rescheduling, provider cancellation/no-show, rematch/refund and emergency waivers under CFG-006/007 |
| 6.10 | Exceptions | Support-ticket intake and dispute/evidence/resolution/appeal with role-appropriate refund status and payout holds |
| 6.11 | Vendor workflow | Profile, offerings/packages and exact coverage; hide promotion editor, Vendor Plans and premature subscription actions |
| 6.12 | Vendor workflow | Compliance/renewal next actions and earnings/statements/ACH exceptions using existing reviewed commands and readbacks |
| 6.13 | Admin workflow | Grouped navigation, operational queues, responsive lists, audit history and controlled overrides; remove public Admin and unapproved Smart Picks entry points |

Every slice includes relevant navigation, loading/empty/error/permission states,
role boundaries and MDS conformance. Remove premature links when touching their
owning surface; 6.13 checks remaining navigation entry points. Hiding links does
not substitute for authorization or remove legitimate operator access.

## Dependencies and authority

Read AGENTS.md, docs/agent/README.md, the current HANDOFF.md checkpoint and all six
governing authorities before implementation. Read CLAUDE.md and relevant installed
Next.js documentation before framework changes. Product policy is not invented here.

Phase 4 is not accepted. P4-1–P4-7 remain Phase 4 review questions. Under DEC-2026-017,
Phase 6 can proceed on those contracts; matching through disputes must identify
its dependencies and accommodate review fixes. Historical combined-acceptance
wording in PHASE-5-CLOSURE-READINESS.md is superseded by DEC-2026-017.

Authority discrepancy recorded: MTS §1 still lists PRODUCT.md → DESIGN.md → matching.md.
OWNER-APPROVALS.md, AGENTS.md and the combined roadmap explicitly establish the
current MPS → MDS → MTS → implementation-evidence chain. Use that explicit approved
chain; stop and record any substantive unresolved requirement conflict.

Phase 7 owns communication delivery/activation, analytics, alerts, SLA automation
and operating runbooks. Phase 6 builds actionable status and queue surfaces and
preserves required event contracts. Hosted rollout and external Stripe/bank checks
stay Phase 8; taxability, finance provisioning, real compliance evidence/cutover and
carried manual release checks keep Phase 9 gates. No external activation is included.

## Claude starts with 6.1 / TRACE-095 after the Phase 4 hold is released

Outcome: a homeowner submits a valid covered, eligible configuration once.
Unsupported/unavailable combinations create no active request. A failed eligibility
or pricing lookup stays a recoverable verification error; it must not manufacture a
quote request. A genuinely eligible quote offering remains valid.

Characterize before replacing:

- src/app/request/page.tsx: handleSubmit, draft persistence, live package resolution,
  direct service_requests insert, photos, matching and checkout continuation.
- src/app/api/request-coverage/route.ts and src/lib/requestCoverage.ts: exact ZIP lookup;
  geography alone does not establish service/provider supply.
- src/hooks/useServiceCatalog.ts, src/lib/serviceData.ts, src/lib/vendorPricing.ts,
  src/lib/requestPhotos.ts and tests/e2e/request.spec.ts.
- Relevant service_requests RLS/insert/price guards, authoritative coverage reference
  data, start_request_matching and eligible candidate/package functions. Include
  TRACE-060 onboarding eligibility and TRACE-059 commercial identities.

Observed code inserts a request per selected service from the browser, catches live
package lookup failure and continues as quotes, then invokes matching or checkout.
This is a characterization lead, not a completed security finding: inspect database
protections before deciding which changes are necessary.

Scope:

1. Reuse complete existing guards and implement a narrow transactional submit contract.
   Authenticate the actor, derive ownership server-side and refuse authoritative client totals.
2. Revalidate exact approved ZIP, service/configuration, provider/package/tier, current
   eligibility and pricing mode at submission. Do not invent ZIPs, prices or compliance rules.
3. Distinguish eligible fixed, eligible quote, uncovered, unavailable and verification-error
   results. Unavailable copy: “Not available yet in your area.” Unsupported/unavailable
   outcomes create no active request, offer or checkout. Interest is a separate explicit action.
4. Bind submission retry identity to actor and payload. Concurrent or repeated submission
   reuses its result; changed payload cannot silently reuse it. Multi-service plans intentionally
   create separate requests: exactly one per intended selection. Document mixed
   eligible/unavailable handling; record unresolved product choices before implementation.
5. Preserve selected-provider consent, authentication draft continuation, photo ownership
   and Phase 5 checkout. Prove legitimate callers before closing bypass write paths.
   Adapt intake minimally to the submit contract; full UI rebuild belongs to 6.2.
6. Use additive migrations if required and document upgrade order/forward recovery.
   Work locally with synthetic data; scheduler activation and money-kernel redesign are excluded.

Acceptance and return to Codex:

- Baseline guard coverage and precise before/after outcomes.
- SQL/RLS plus real local API/RPC round trips, including anonymous, homeowner A/B,
  vendor/admin/service identities as relevant and direct-write bypass probes.
- Covered/uncovered boundary ZIPs from approved data; no eligible supply; invalid
  ZIP/service/provider; stale or suspended eligibility; lookup failure; eligible fixed/quote;
  tampered totals and identifiers.
- Same-key and concurrent retry, changed-payload retry and distinct multi-service requests.
  Failure after save must not duplicate requests or charges on recovery.
- Relevant browser regression: authentication continuation, coverage interest, photos and
  recovery. Applicable lint/type/unit/build/secret checks, backend regression and CI.
- Update TRACE-095, a slice validation report and concise handoff. Return changed files,
  exact commands/results, unperformed checks, unresolved decisions, migration/recovery
  notes and a reviewable diff. Apply relevant frontend skills during UI implementation.

Suggested branch: codex/phase6-request-submission from current merged main after
verifying status. The current planning branch is not an assumed implementation base.

## Phase acceptance checkpoint

Codex reviews integrated critical journeys after the slices: request → offer →
quote/schedule → fulfillment → confirmation → review, plus unavailable,
cancellation, dispute/refund and vendor/admin exception paths. The Phase 6 gate
requires desktop/mobile, light/dark, keyboard, screen-reader, role, database and
visual evidence, including MDS viewport/reflow/zoom requirements. Axe does not prove
screen-reader acceptance. Record human checks separately; carried Phase 3 release
checks do not erase Phase 6 journey acceptance. Reuse only unchanged valid evidence.
The owner closes Phase 6 on evidence; this plan does not close it.
