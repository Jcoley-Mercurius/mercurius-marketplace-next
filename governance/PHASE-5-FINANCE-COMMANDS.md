# Phase 5 — Finance operator command gateway, part 1 (TRACE-076)

**Status:** IMPLEMENTED on branch `codex/phase5-finance-commands`, based on `main` `3f98939`
(PR #31, TRACE-075, merged). **Merged as PR #32 on 2026-09-17 (main `f945910`)** after final-head
CI passed; Codex design and code review remain open.
Merging is not phase acceptance or production activation. No hosted project, Stripe account,
bank or real money was touched.

**Authorization (2026-09-16):** the owner directed part 1 of the finance operator command
gateway (refund send and result, payout holds, Stripe readback record and resolve, event replay
and exclusion) with ConfirmAction, and asked for the authenticated actor and approval design to
be proposed for Codex review. Owner decision the same day: **the global unsupported-event
payout hold is kept**; the reviewed exclusion is how operators clear it. Decisions G1–G9 below
are implementer choices recorded for review, not presented as pre-approved.

## Gap

TRACE-050–059 kernels are `service_role` only and trust a caller-supplied `p_actor` (and
`p_approver`). TRACE-075 made reconciled money visible but left every command without an
operator path (its D1). The only `authenticated` entry point was `money_approve_review`, which
binds `auth.uid()` as approver to a hashed command but gives nobody a way to see what to approve.

## Design proposed for review

### G1 — Actor: the signed-in session, derived server-side, never an input

- Database commands are new `security definer` functions granted to `authenticated`. Each sets
  `actor := auth.uid()` and calls `money_require_finance(actor)` (admin role plus
  `money_authorities`). None takes an actor or approver parameter; SQL 043 asserts that for every
  `money_operator_*` function.
- They call the kernels unchanged; kernel grants stay `service_role` only (asserted).
- Refund send and readback need Stripe, so they stay in the `refund-invoice` Edge function. It
  verifies the bearer token with Auth (`auth.getUser`) and passes that user ID as `p_actor` to
  the service-only functions; a body `p_actor`/`actor` is ignored (Edge tests assert it).
- No service-role key is added to the Next.js tier.

### G2 — Second-person approval: stored exact command, approver's own session, requester runs

1. **Request** (`money_operator_request_review`): the requester states operation, subject,
   reason and evidence. The database builds the command object itself — byte-for-byte the
   object `money_exclude_event` / `money_resolve_reconciliation` hash — stores it immutably with
   its hash, and refuses if the command is not currently actionable.
2. **Approve** (`money_operator_approve_review`): a *different* finance operator, in their own
   session, approves the stored command through the existing `money_approve_review`. The
   approver sees the full reason and evidence in `money_finance_operations`.
3. **Execute** (`money_operator_execute_review`): only the requester runs it. The approver is
   re-derived from `money_review_approvals` (different operator, still holds finance authority,
   and for a readback resolution did not record that readback), actionability is re-checked
   under the kernel's row lock, and the kernel re-verifies the hash. An execution record names
   actor and approver; a repeat execution replays.

Why the requester executes (not the approver): the kernels record `p_actor` as the operator who
performed the change; approval stays a separate authenticated act, and an approval cannot
itself move anything. A direct `money_approve_review` call that bypasses step 2 is still bound by
step 3's checks (SQL 043 covers a recorder approving directly).

### G3 — Which commands need a second person

| Command | Kernel | Operators |
|---|---|---|
| Place payout hold | `money_place_hold` | one (protective) |
| Release payout hold | `money_resolve_hold` | **two** — gateway-enforced; the kernel has no review |
| Record Stripe readback | `money_record_reconciliation` | one; a mismatch opens a hold, a match never clears one |
| Resolve readback hold | `money_resolve_reconciliation` | two (kernel) |
| Replay Stripe event | `money_replay_event` | one; processing re-validates the event |
| Exclude Stripe event | `money_exclude_event` | two (kernel) |
| Send refund | `money_prepare_refund` + Stripe | the refund's author or approver (kernel) |
| Read refund back | Stripe + `money_record_refund_result` | one; never settles a refund |

Releasing held provider funds is a high-risk manual change under MPS §7 ("high-risk changes
require second-person approval"), so G3 is stricter than the kernel. **Review question:** confirm
hold release needs two operators.

**Owner answer 2026-09-17:** hold release does not need a second operator. TRACE-077 makes it a
one-operator command (PHASE-5-FINANCE-REFUNDS.md R1).

### G4 — Readback attribution and recorder separation

The kernel observation names no actor, so `money_readback_entries` records who entered each
gateway readback. The recorder may request a resolution but cannot approve it. Readbacks are
operator-entered from Stripe (amount collected less refunded, plus a Stripe reference);
automated provider readback remains the scheduled-readback gate.

### G5 — Holds only where they can act

A hold only affects ACH preparation. A payout already on an ACH statement is refused
("a hold cannot stop it") rather than shown as held.

### G6 — Refund readback records, never settles

`money_refund_readback_target` reads without writing (so a readback never creates an attempt).
The Edge function retrieves the refund by its recorded reference, or lists the payment's refunds
and matches `metadata.money_authorization_id`; a refund for another payment or authorization is
refused and nothing is recorded. `money_record_refund_readback` records "not found" or passes the
Stripe status to the unchanged `money_record_refund_result`, which never marks success without
Stripe's refund event. Each readback is logged with the verified user (`money_refund_readbacks`).

### G7 — Idempotency and races

Hold, readback and request commands take a caller key; the same key replays and a different
payload with that key conflicts. The UI keeps one key per form until the server confirms the
command. Executions serialize on the request row, an advisory lock per subject, and the kernel's
row (obligation or event), so the gateway's actionability check sees concurrent changes.

### G8 — Data returned to operators

`money_finance_operations` returns request reasons and evidence, hold reasons and evidence, and
readback evidence, because an approver must see what they approve (TRACE-075 D4 withheld these
from the read-only page). It returns `*_by_me` flags, not operator identities, and no bank
references or customer identities.

### G9 — Stale requests

Requests have no expiry or withdrawal. A request whose subject changed reads `stale` with its
reason and cannot be approved or run. **Review question:** whether requests and approvals need an
expiry or withdrawal.

**Owner answer 2026-09-17:** requests and approvals expire after 24 hours. TRACE-077 implements
the window and binds approvals to their request (PHASE-5-FINANCE-REFUNDS.md R2).

## Scope

- Migration `20260916002000_money_finance_commands.sql`: immutable `money_review_requests`,
  `money_review_executions`, `money_readback_entries`, `money_refund_readbacks`; `authenticated`
  functions `money_operator_place_hold`, `_record_readback`, `_replay_event`,
  `_request_review`, `_approve_review`, `_execute_review` and `money_finance_operations`;
  service-only `money_refund_readback_target` and `money_record_refund_readback`; private helpers.
  No kernel, kernel grant or payout predicate changes.
- `refund-invoice`: `action: "readback"`; `send` unchanged apart from the shared body parsing.
- `/admin/finance`: `FinanceCommands` panel (review queue with approve/run, hold place and release
  request, readback record, event exclusion request, readback resolution, event replay, refund
  send and readback), every action behind ConfirmAction and confirmed by server readback.

**Not in scope:** refund authorization, chargeback allocation, ACH preparation, bank outcomes and
ACH retry (part 2); scheduled Stripe readback; bank statement import; provisioning finance
operators; hosted deployment.

## Findings (existing behavior, unchanged)

- A refund attempt left `prepared` past 23 hours becomes `reconcile` and can never be re-sent,
  even after a readback proves Stripe has no refund; its authorization then holds the payout
  indefinitely. Recovery needs a reviewed kernel change.
- The legacy `/admin/invoices` "Refund Payment" sends `invoice_id` and is refused with
  `REVIEWED_REFUND_REQUIRED`, as before this slice.
- `paymentFunctionError` (`src/lib/payments.ts`) checks `context.body` before `context.json()`.
  On a real Edge `Response` the body is a `ReadableStream`, so the structured `error` code and
  message are lost and every caller (checkout review, homeowner dashboard, invoices) shows its
  fallback text. The finance panel reads the response itself; the shared helper is unchanged
  and needs its own fix.
- `money_approve_review` remains directly callable by finance operators; the gateway does not
  depend on it being closed.

## Evidence

See the TRACE-076 section of PHASE-5-VALIDATION.md.

## Remaining gates

Codex design and code review (G1–G9, especially G3 and G9); CI; part 2 (refund authorization,
chargeback allocation, ACH preparation, bank outcomes, retry); stuck `reconcile` refund recovery;
scheduled Stripe readback and bank statement import; provisioning two finance operators;
authorized Stripe test-mode and bank acceptance.
