# Phase 6.4 — Marketplace quotes

TRACE-119; owner decisions DEC-2026-045 (G1–G6); thresholds CFG-015. Slice 6.4 of
[PHASE-6-SCOPE.md](PHASE-6-SCOPE.md) ("Quotes and scheduling"). Marketplace quote processing only;
the separate Quote Tool product is out of scope. Implemented by Claude for Codex review. Not phase
acceptance and not production activation.

## Baseline

- Branch `claude/phase6-4-vendor-quote-proposals`, started from `main` `60d4f06` (pricing #103 and
  #104 merged; CI 39645127747 green on backend, lifecycle and application) and moved by fast-forward
  to `main` `66d495e` (PR #105, TRACE-118/DEC-2026-044) on 2026-10-22. The #103 merge-run failure
  (39534231692) was the image registry refusing pulls (`toomanyrequests: Data limit exceeded`), not code.
- One additive migration, `20261022001000_phase6_quotes.sql` (replaces the unpushed first-cut file
  `20261022001000_quote_proposals.sql`; neither was ever applied outside the isolated local stack).

## Governing requirements

MPS §4 (vendor proposes; admin sends/corrects with reason; homeowner approves), §5.3, §6.3, §7.5,
§9 queues; DEC-2026-007 (vendor acceptance schedules), DEC-2026-008 (24-hour approval; replacement
is a new revision), DEC-2026-015 §3–4 (no promotions or untaxed categories at checkout until
approved), DEC-2026-039/041 (estimates never payable without quote acceptance), DEC-2026-045, CFG-005,
CFG-007, CFG-015. MDS ConfirmAction, FormField, status tones, 320/1440 reflow, WCAG 2.2 AA.

## Characterization before this slice

| Step | Existing path |
|---|---|
| Request | Estimates, ranges, walkthroughs and quote packages become quote requests with the estimate in `pricing_inputs` (TRACE-112) |
| Offer | The assigned provider accepts the four-hour offer; request `scheduled`, `matching_status` `matched` (TRACE-099, DEC-2026-007) |
| Quote | Only an operator typed one total and a reason (`admin_send_quote`); immutable `request_quotes` revision, 24-hour deadline, scope captured for checkout. The same command could replace an **accepted** quote, and operators could update the request's quote fields directly (RLS) |
| Decision | Homeowner approve/decline; late answers refused; decline never cancels |
| Expiry | `private.expire_request_quotes` in the lifecycle batch (scheduler inactive on hosted) |
| Money | Accepted, timely, scope-matching quote is the source for a two-person finance snapshot; checkout total must equal the accepted quote; one open checkout attempt per obligation (unique index); unpaid sessions recorded `expired` by webhook, unknown outcomes `reconcile` |

## What is implemented

### Database (`20261022001000_phase6_quotes.sql`)

- `request_quote_proposals`: the assigned provider's itemized estimate (lines, server subtotal,
  scope, revision and request scope it was based on); one pending per request; immutable terms;
  decided once; providers read their own, operators all, homeowners none.
- `request_quote_terms` (G1/G2): immutable itemized terms of each quote revision — lines, service,
  add-on and discount totals, subtotal, tax status (`pending` unless confirmed; confirmed requires a
  tax amount, basis and total = subtotal + tax), deposit fixed at $0, payment terms and policy version.
  Participants read.
- `request_quote_exceptions` (G2/G3/G5): accepted-quote change exceptions (open → closed once) and
  recorded deposit and provider reviews; operators read.
- Commands: `vendor_propose_quote(job, items, scope, expected_revision)`;
  `admin_send_itemized_quote(job, items, scope, reason, expected_revision, proposal?)` (the only send);
  `admin_return_quote_proposal`; `admin_open_quote_exception`; `admin_close_quote_exception`;
  `admin_record_quote_review(job, deposit_review | provider_review, note)`; `admin_quote_queue()`.
  Identical retries return the earlier result. Lock order: request advisory lock → request row →
  proposal.
- Restated: `homeowner_respond_to_quote` (approval needs terms, confirmed tax, payment terms, policy
  version and an eligible provider; decline unchanged); `admin_send_quote` (retired: refuses).
- Guards (G3): a decided `request_quotes` row cannot change status or decision; once a request's
  quote is accepted, its quote pointer, revision, status, amount and timestamps cannot change on any
  path, including direct operator writes and the table owner.

### Application

- Shared `src/lib/quoteProposals.ts` (line parsing in whole cents, prefill from the homeowner's
  priced selection, approval and window rules, vendor view, queue labels) and
  `src/components/quotes/QuoteItems.tsx` (line editor, lines, breakdown).
- Vendor job dialog: itemized estimate prefilled from the selection's level and add-ons; tax pending;
  lost-response read-back; correction and return outcomes.
- Admin request dialog (`AdminQuotePanel`): current revision and terms; deposit review before
  sending; provider proposal with "Use proposed lines" and "Return to provider"; itemized send with
  scope and reason; accepted terms final with "Open change exception".
- Admin `/admin/requests` "Quote and payment exceptions" queue (`AdminQuoteQueue`): aged and
  immediate items, provider and deposit reviews, closing change exceptions, "Open request".
- Homeowner dialog: itemized breakdown with "Tax pending confirmation" and $0 deposit; Approve only
  for complete terms with confirmed tax; Decline while the window is open; closed window explained.
- Dashboard return from Stripe now reads "Waiting for payment confirmation" (was "Payment submitted
  securely", success tone).
- Homeowner `scheduled` badge on the info tone (sage-on-sage measured 4.43:1).

## Gap status (DEC-2026-045)

| Gap | Status | Where |
|---|---|---|
| G1 Itemized quotes | **Resolved, with a dependency.** Itemization, server subtotal, tax pending, approval gate on complete terms with confirmed tax. No command confirms tax (no approved tax rule); every quote sent now is reviewable but not approvable until the tax authority exists | migration, SQL 090, unit, browser |
| G2 Deposits | **Resolved.** Terms carry $0; deposit-requesting jobs need a recorded operator review before send; existing records untouched | SQL 090 deposit block |
| G3 Changes after acceptance | **Resolved.** Old send retired; guards refuse every replacement path; change exception instead | SQL 090, 023 |
| G4 Aging | **Resolved.** Queue at 24 h / 4 h / 12 h from recorded events; 24-hour expiry unchanged; edits do not reset | SQL 090 aging block, CFG-015 |
| G5 Suspended providers | **Resolved.** Eligibility rechecked at propose, send, approve; assigned jobs flagged; nothing unassigned or cancelled | SQL 090 suspension block |
| G6 Payment failure | **Resolved within existing money paths.** Confirmed failure vs unknown queued immediately; failure aged at 24 h; second active attempt refused; quote and request preserved; return copy fixed. No kernel change | SQL 090 payment block, browser |

## Remaining activation dependencies and open items

1. **Tax authority** (DEC-2026-015 §4): no approved tax rules or command to confirm a quote's tax
   treatment. Until then no quote can be approved. Owner/accountant and finance decision; a later
   reviewed slice adds the confirmation path.
2. **Quote discounts in the money snapshot:** snapshots require promotion terms for any discount.
   Finance review must decide how a quote's discount line is posted (net service amount vs discount
   component) before a discounted quote is checked out. The money source only checks the total.
3. **Finance two-person snapshot review** stays the checkout gate; line-to-snapshot reconciliation
   is not automated.
4. Hosted migration push before merge (owner, DEC-2026-037); Codex review.
5. Not built: change orders, reminders or external delivery of aging, configurable deposits,
   automatic rematch for suspended providers (CFG-007 bound-provider replacement stays open).

## Evidence (2026-10-22, this branch; synthetic data only)

| Check | Result |
|---|---|
| Clean replay of 195 migrations on the isolated stack (`.phase5-local`, ports 5552x) | Pass |
| SQL `090_quote_proposals.sql` | 118/118 |
| Updated SQL 005 / 007 / 023 | 10/10, 16/16, 44/44 |
| Full SQL suite (isolated, clean replay of 195 migrations) | 81 files, 4,598 assertions, PASS |
| Unit `quote-proposals` / full unit | 13/13 / 481/481 |
| Typecheck, lint, secret scan, synthetic build | Clean; build uses the fixture URL only |
| Browser `quote-proposals.spec.ts` (12 tests), `portals`, `homeowner` | All pass; under machine load four `homeowner` screen tests needed a 120 s diagnostic timeout and passed |
| Full non-visual browser suite (quiet machine) | 555/556 in 26 min; `request.spec.ts:904` (intake add-ons, untouched) passed 3/3 alone |
| Regenerated `database.types.ts` | Additive only |

SQL 090 coverage: itemization math and refusals; wrong actors (other provider, homeowner, operator,
anonymous); fixed price and unaccepted offer; stale revision; changed scope; replaced provider;
identical retries (propose, send, return, review); superseding; RLS isolation; no direct writes;
immutability against the table owner; tax-pending approval refused; legacy single-amount approval
refused; suspended provider at propose, send (fresh and pending proposal) and approval; complete
final quote approved; replacement after acceptance refused by command and by direct write; change
exception open/close; deposit review before send; provider review flag and acknowledgement;
aging at exactly 24 h, 4 h, 12 h and not at 23 h 59 m / 3 h 59 m / 11 h 59 m; ordinary edit does
not reset aging; aging leaves quote state alone; worker expiry at 24 h; passed deadline visible
before the worker; checkout in progress not an exception; second active attempt refused (unique
index); confirmed failure aged at 24 h; unknown outcome immediate and not reported as failure;
captured payment clears; no request, quote or service change from payment exceptions.

Not run: `@visual` (Windows baselines), human screen reader, real zoom, dark mode (light-only
release), hosted anything, Stripe, email delivery, a new concurrency script (commands reuse the
existing per-request advisory lock; checkout concurrency is the unchanged Phase 5 kernel covered by
`scripts/phase5-concurrency.mjs`).

## Migration and rollback

Additive: three tables, guard triggers, new functions; `homeowner_respond_to_quote` and
`admin_send_quote` restated in place (same signatures). Before the deploy, the live site's old admin
"Send Quote" button calls the retired command and gets a refusal, and the homeowner Approve button is
refused for quotes without confirmed itemized terms; both are intended. Order under DEC-2026-037:
owner-authorized dry run and push, then merge. Rollback: promote the previous deployment; to restore
the old send behavior a forward migration must restate it (not recommended: it reopens the G3
bypass). Do not drop the new tables once rows exist.
