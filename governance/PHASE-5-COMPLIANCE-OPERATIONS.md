# Phase 5 — Provider compliance operations (TRACE-062)

## Behavior

`/admin/compliance` connects the TRACE-061 contracts to an operator workflow:

- Review participating providers, immutable include/exclude decisions, generic
  onboarding eligibility and current service/ZIP evidence.
- Author versioned license and insurance requirements for a selected service/ZIP.
- Select documents from the application version under review. Source files remain
  in the private vendor-documents bucket and are reviewed through Applications'
  existing short-lived signed-link flow.
- Record and bind reviewed evidence transactionally. Exact retries reuse the same
  evidence. Replacement requires the observed evidence head; a stale operator
  cannot silently overwrite a newer review. Existing evidence can be reused across
  compatible requirements without superseding it.
- Show only active requirements and current bindings at the database evaluation
  time. Historical, expired or superseded bindings do not imply readiness.
- Require a reason and ConfirmAction for provider decisions and strict matching
  finalization. The database rechecks authorization and readiness on every command.

The dashboard RPC and document-recording RPC require an authenticated admin.
Anonymous and service-role callers receive no execution grant. The browser receives
private storage paths, not public URLs. No credentials or real provider documents
are used in fixtures.

## Review boundaries

Recording replacement evidence supersedes the prior record for that evidence kind.
Other requirement bindings must be reviewed and rebound to the replacement; the UI
states this consequence. The inherited kernel supports one current evidence record
per kind, so simultaneously incompatible requirement versions remain a follow-up.
A new application revision must enter onboarding review before its documents can
be bound. This page does not silently change the application under review.

This bounded slice reuses existing private application collection and file review.
It does not implement bank-document intake, Auth provisioning, invitation delivery
or acceptance receipts, retention/legal-hold/purge jobs, or complete renewal operations.
Those remain Phase 5 work, alongside tax/promotions, recurring automation, finance
operations, legacy reconciliation and authorized integration acceptance.

No real requirements, provider decisions or cutover activation are seeded or run.
No production migration, email, payment, payout, deployment or scheduler is activated.

## Validation

Evidence is recorded in PHASE-5-VALIDATION.md after checks finish. SQL 030 covers the
real database contracts; browser tests use isolated synthetic HTTP responses and
prove UI request shape, failure handling, confirmation, accessibility and reflow.
Synthetic browser tests do not establish production integration or human acceptance.
