# Phase 5: cancellation assessment to refund authorization

## Boundary

TRACE-056 connects the existing Phase 4 customer-cancellation assessment to the
existing Phase 5 reviewed, idempotent refund kernel. It does not create another
cancellation policy engine or initiate a provider refund.

Customer cancellation continues to use CFG-006: 72 or more hours returns 100%,
24 to under 72 hours returns 50%, and under 24 hours returns 0%. An operations
waiver already recorded by the canonical Phase 4 action produces the existing 100%
assessment. The bridge reads that immutable record and the captured payment state.
For a fully captured order it applies the assessed percentage independently to
service, tax and tip components. For a service advance it applies the percentage
only to captured service funds, preserving the existing rule that deposit refunds
cannot invent tax or tip.

Each payment receives a deterministic allocation and business key. Existing and
pending refund authorizations count against both the policy target and payment
capacity. The authorization persists the operation ID and a SHA-256 hash of its
actor, reason, prior state, assessment and timestamp. The operation and link are
append-only. A retry with the same intent returns the same authorization; a changed
actor, approver or reason fails.

Preview and authorization are service-role operations restricted to recorded
finance authorities. The existing second operator must authenticate separately and
approve the exact computed refund command before authorization. The existing refund
attempt, provider result and webhook reconciliation paths remain unchanged and
disabled without explicit test-mode/provider integration.

## Deliberate blocked cases

- A zero-percent cancellation records no refund authorization.
- Provider cancellation and no-show do not authorize money from the initial
  operation alone. CFG-007 requires an attempted acceptable replacement first.
  A separate immutable no-replacement decision is required before that adapter.
- Existing ACH statements and unresolved chargebacks retain their current hard
  blocks. Changed statements and already-paid recovery remain operations work.
- Tax authority, promotion allocation, legacy cutover and live provider acceptance
  remain separate Phase 5 gates.

## Validation

SQL 025 covers the 73-hour, 25-hour and 23-hour outcomes, exact service/tax/tip
components, browser-role denial, separate finance approval, stable retries, changed
intent rejection, immutable source evidence, zero-refund behavior and provider
cancellation blocking. The full database suite, concurrency programs, generated
types, application checks and final-head CI remain the acceptance evidence.

No production migration, deployment, configuration, payment, refund, payout, email
or scheduler action is authorized or performed by this slice.
