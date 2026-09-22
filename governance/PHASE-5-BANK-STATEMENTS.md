# Phase 5 — Bank statement reconciliation (TRACE-081)

**Status:** IMPLEMENTED on branch `codex/phase5-bank-statements`, based on `main` `5e29da3`
(PR #36, TRACE-080, merged 2026-09-21). Awaiting a PR, CI and Codex design and code review.
Merging is not phase acceptance or production activation. No hosted project, Stripe account, bank,
bank file or real money was touched.

**Authorization (2026-09-22):** the owner directed this slice after PR #36 merged. The owner
answered four semantics questions before implementation:

1. **The bank's CSV export, parsed in the operator's browser.** Only each chosen line's posting
   date, direction, amount and bank reference are sent; the file is never uploaded. A single line
   can also be entered by hand.
2. **Payout-related lines only.** ACH debits to providers and credits that are returns or provider
   repayments. The operator leaves the account's other traffic out. The tool therefore cannot prove
   nothing was left out; the owner accepted that in exchange for holding less data.
3. **Evidence only.** A statement line never changes a transfer, a payout or the ledger. A
   difference is an exception, resolved through the existing commands with the line's details
   filled in.
4. **A two-operator close.** One operator imports and resolves lines; closing the period is a
   reviewed request a second finance operator approves, refused while any exception is open. A
   closed statement is immutable.

S1–S8 below are implementer choices recorded for review. Only the four answers above are owner
decisions.

## Gap

Characterized on `5e29da3`:

- CFG-008 requires "ACH batch, statement, ledger, hold, failure, retry, and reconciliation
  scenarios" before real payout activation. Every outcome recorded since TRACE-078 was whatever an
  operator typed after looking at the bank; nothing checked it against the bank's own statement.
- Nothing found a transfer the bank paid but no one recorded, which is where TRACE-080 expected
  most late payments of withdrawn transfers to be found, or a recorded settlement the bank never
  made.
- There was no record that a period had been reconciled at all, and no place a finance owner could
  see one.

## Design

DECISION-LOG DEC-2026-011 allows storing "form/evidence references, statements and bank outcomes;
never bank credentials or full account details". The design keeps the database to the four fields
above, and returns bank references to operators only as their last four characters (TRACE-078 B4).

### S1 — What a statement line is

`money_bank_statement_lines` holds a posting date, `debit` or `credit`, an amount in cents and the
bank's reference. It has no description, payee or account column, and the import refuses a line
object with any other key, so a bank file's `ACH PAYEE … ACCT 000123456789` description cannot be
stored even by a caller that is not the panel. Lines are immutable and belong to one
`money_bank_statements` period; periods cannot overlap.

### S2 — What a recorded bank movement is

`private.money_bank_movements` is every movement Mercurius has recorded: a settled ACH event, a
returned one, a late payment of a withdrawn transfer (TRACE-080) and a provider repayment. A
settlement and a late payment are debits; a return and a repayment are credits. Only a repayment
carries no bank reference, because nothing records one.

### S3 — Pairing

A line pairs with a movement of the same direction and bank reference. Where several lines and
movements share a reference — TRACE-080's R3 allows a settled, returned and late-paid transfer to
share one — they pair in order: lines by posting date, movements by when they were recorded. A pair
whose amounts differ is an `amount_mismatch` exception rather than a match, so a bank that paid a
different amount is never read as agreement.

An operator can also match a line to a movement by hand, with a reason: a repayment, which has no
reference, or a transfer the bank shows under a different one. A manual match needs the same
direction and the exact amount, and refuses a line or a movement that something already evidences.

### S4 — Closing stores the pairing

Reference pairing is derived, so importing a line into one statement could re-rank another
statement's pairs. Closing a statement stores its pairs as rows, so a closed statement's evidence
cannot change afterwards. Every statement write takes one advisory lock, because an import into one
statement can change how another's lines pair.

### S5 — Resolving a line uses the existing commands

An unmatched line reads its transfer by reference and says what it shows:

| Suggestion | What the operator does |
|---|---|
| `record_settled`, `record_returned` | `money_operator_record_ach`, one operator (TRACE-078 B2) |
| `request_late_settlement` | `money_operator_request_ach_late_settlement`, two operators (TRACE-080 R3) |
| `match_repayment` | match the credit to the recorded repayment by hand |
| `amount_mismatch`, `outcome_conflict`, `already_evidenced` | nothing is recordable; escalate |
| `no_transfer` | match it by hand, or dismiss it as not a payout |

`money_operator_resolve_bank_line` runs the first three through the unchanged commands, with the
statement line as their evidence, and with the operator's note. The caller names the action it
showed; if the suggestion changed since the page loaded, nothing is recorded (`suggestion_changed`).
No new outcome, transition or authority is introduced: a late payment still needs two operators.

### S6 — Dismissing a line

A line imported by mistake is dismissed with a reason. A line whose reference names a recorded
transfer or late payment is refused (`line_names_transfer`), so a payout line can never be hidden.

### S7 — Closing

`money_operator_request_bank_statement_close` binds the statement, its line count and its debit and
credit totals. A line imported afterwards makes the request stale (`statement_changed`). The close
is refused while the period has not ended (`period_open`) or while the statement has exceptions
(`statement_exceptions`): an unmatched or mismatched line of its own, or a recorded movement whose
business day falls in its period that no line evidences. The kernel `money_close_bank_statement`
stores the pairings and an immutable close row naming both operators, the totals and the reason.

Dates are Mercurius's Eastern business days (CFG-010's time zone), as a bank statement is.

### S8 — Readbacks

`money_finance_operations` gains `statements`: each statement with its totals, exception count,
close blocker and lines (state, what each matched, its suggestion or its dismissal), plus
`unevidenced` — recorded movements no line shows, each naming the statement whose period covers it.
`money_finance_reconciliation` gains two exceptions: `bank_line` for each unresolved line, and
`bank_unevidenced` for a movement with no line whose day falls inside the imported periods. A
movement recorded after the last imported period is not an exception: it is waiting for the next
statement.

## Scope

- Migration `20260922001000_money_bank_statements.sql`: the six tables above; the movement, pairing,
  line-state, suggestion, totals and exception helpers; the `bank_statement_close` review operation;
  the kernel `money_close_bank_statement`; the `authenticated` commands
  `money_operator_import_bank_statement`, `_match_bank_line`, `_dismiss_bank_line`,
  `_resolve_bank_line` and `_request_bank_statement_close`; and redefinitions that learn them
  (`private.money_request_blocker`, `public.money_operator_execute_review`,
  `public.money_finance_operations`, `public.money_finance_reconciliation`). Each redefinition is
  the latest body copied by a generator that asserts exactly one match per substitution. No kernel,
  grant, predicate or ACH behavior outside the new objects changes.
- `src/lib/bankStatementCsv.ts`: the browser CSV reader — RFC 4180 parsing, a first-guess column
  mapping, the three shapes banks export money out in (a signed amount, separate debit and credit
  columns, or an amount with a type column), money and date parsing, and the file's SHA-256.
- `/admin/finance`: a new "Bank statements" section with the import form and preview, hand entry,
  each statement's lines with their resolutions, the manual match form, the reviewed close, and the
  movements not on a statement. The reconciliation exceptions table words the two new kinds.
- Suite 048, `scripts/phase5-bank-statement-concurrency.mjs` (in CI after the TRACE-080 script),
  unit and browser cases, and regenerated database types (additions only).

**Not in scope:**

- reading the bank directly: there is no ACH or statement API (DEC-2026-011);
- proving the operator imported every payout line: only the lines they chose are held (owner
  decision 2);
- an automatic outcome: no line records anything by itself (owner decision 3);
- reopening or correcting a closed statement, or undoing a match or dismissal (see findings);
- a resolution for an amount mismatch or a conflicting outcome (see findings);
- the statement of any account other than the one payouts are sent from;
- provisioning finance operators; hosted deployment.

## Findings

- **An amount mismatch or an outcome conflict cannot be resolved in the product.** The bank paid a
  different amount from the transfer, or paid one recorded as failed. Nothing here records either,
  and the statement cannot close until it is resolved, which is the intended fail-closed behavior
  (MPS §9 "correct without duplicate charge or hidden balance"). **Review question:** whether
  operators need a reviewed correction for these, or whether escalation to the finance owner is the
  right answer at pilot scale.
- **A match or a dismissal cannot be undone.** Both are immutable, and a mistaken one is only
  visible through the close review. **Review question:** whether an open statement should allow a
  reviewed release of either.
- **Completeness is bounded by the operator.** A payout line left out of the import is invisible
  unless its movement is recorded, in which case it appears as unevidenced. A line for a movement
  never recorded at all is what the import is for.
- **Statement periods are the bank's, not Mercurius's weeks.** They cannot overlap and are capped
  at 32 days. An operator who types a wrong period cannot delete it; it must be left closed or
  empty.
- **Pairing is recomputed on every read.** As with the TRACE-078 readback, this is acceptable at
  pilot scale and will need attention with volume.
- **The finance page header still says "Bank outcomes are not recorded here"**, which TRACE-078 made
  untrue. Left unchanged in this slice; it is not statement wording.
- `paymentFunctionError` (TRACE-076) and failed-refund recovery (TRACE-077) remain open.

## Evidence

See the TRACE-081 section of PHASE-5-VALIDATION.md.

## Remaining gates

- Codex design and code review: S1–S8, especially the two review questions above and S3's pairing
  rule. CI.
- Authorized owner bank workflow acceptance (CFG-008), now including importing a real statement
  export, reconciling it and closing a period. No real bank file has been read.
- The owner's bank export format: the reader covers the three common shapes, but the actual export
  has not been seen.
- Failed-refund recovery (TRACE-077); `paymentFunctionError` (TRACE-076).
- Provisioning two finance operators.
