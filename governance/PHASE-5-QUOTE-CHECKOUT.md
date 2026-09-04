# Phase 5 follow-up: authoritative sources for checkout

Scope: quotes and fixed offerings into immutable commercial snapshots and the
existing canonical checkout. This is not the remaining completion/payout,
cancellation/refund, recurring-visit or onboarding/matching integration work.

## Baseline and characterization

On September 4 the owner asked to remain in Phase 5 and implement this slice next.
`codex/phase5-quote-checkout` starts at fetched main
`9aeed8fd16edb16b403c872c9bf403a998bd831c`, including merged PRs #4–6. The existing
Phase 5 worktree was clean and reused for the new branch; other worktrees were not
modified. There is no merge, deployment, real payment, email or Cron authorization.

Authorities: AGENTS.md, owner approvals, MPS §§6.3/6.5 and fixed-offering rule,
MDS MoneySummary/ConfirmAction, MTS server-owned snapshots and least-privilege RPCs,
CFG-004/005, DEC-007/008/011, Phase 4 and 5 reconciliation/handoff and TRACE-050.

The merged Phase 4 quote record preserves immutable revision terms, approval
actor/time and a 24-hour approval window. Existing admin UI labels its amount
**Total amount ($)**. It is therefore unsafe to reinterpret an accepted quote as
pre-tax service price and add money on top. A quote-backed snapshot must exactly
match the accepted total; separately approved component allocation must balance to
that amount. Tax authority is still required, including for zero tax.

New quote issuance also captures immutable request scope. The quote's price cannot
authorize subsequently changed service, frequency, ZIP, qualifying answers or
selected configuration. Provider assignment remains separate under DEC-007; the
snapshot records the confirmed provider when published. Existing quotes without
issuance-scope evidence require a new revision; no scope backfill is invented.

Fixed offerings remain mutable packages/tiers with active/review, frequency,
qualifying-answer and exact ZIP eligibility. Legacy checkout never bound its
`source_version` string to either source. Manual source labels could therefore be
unrelated to the current quote or displayed offering. Those labels are now
insufficient for checkout; no old data is silently certified or backfilled.

## Implemented contract

1. A finance operator calls `money_preview_commercial_source(request_id)` through
   their authenticated connection. It resolves the current accepted quote or the
   request's exact selected fixed offering/tier and returns immutable-capture
   evidence plus a content-derived `commercial-v1:` version. No browser total,
   cheapest-tier substitution or hard-coded catalog price is authoritative.
2. The operator prepares the complete cents breakdown with that version. A second
   finance operator authenticates separately and approves the exact existing
   `snapshot` command via `money_approve_review`. Tax, promotion, adjustment, tip,
   deposit and policy evidence remain explicit; this does not invent missing policy.
3. The trusted server calls `money_publish_snapshot` with those reviewed terms and
   actor identities. It re-resolves the source under locks, rejects a changed
   version or amount mismatch, and atomically captures the source with the snapshot.
   Repeated identical publication returns the same invoice/snapshot, even after
   checkout reservation. Internal evidence is not exposed to the homeowner.
4. The unchanged canonical Edge handler calls `money_prepare_checkout` as the
   homeowner. The public RPC checks source linkage, ownership and current source
   before entering the existing amount/idempotency kernel. Raw intake/checkout
   kernels moved into the private schema with no browser/service execution grant.
5. Once an attempt is reserved, a request's quote/party/selected scope cannot change
   across the external provider-call interval. Verified expired attempts do not
   retain that source-change lock; existing snapshot replacement after any attempt
   still requires the separately tracked recovery workflow. Catalog edits never
   rewrite historical amounts; they invalidate the first attempt against stale
   unreserved terms. Existing attempts and deposit balances honor the agreed price
   despite subsequent catalog edits, while request-bound scope remains guarded.

Requests need a scheduled or later valid service state and identified parties.
This uses vendor acceptance as established by DEC-007; it does not add payment as
a scheduling prerequisite. Accepted quote validity is based on **timely acceptance**,
not the current time being within its original 24-hour approval window. The
separately reviewed commercial snapshot has its own checkout expiry.

Fixed-source checks cover exact provider/package/tier/service/frequency/ZIP,
active catalog/provider/package, pricing review, selected numeric tier range and
required-answer presence. Row locks protect existing records. Short SHARE table
locks on questions/promotions prevent inserted configuration from racing capture;
these serialize configuration edits against source checks, not checkout against
checkout. Retry a transaction aborted by the database before any provider call.

An active or request-selected legacy package promotion blocks this adapter until
its funding/allocation integration is approved. Charging the undiscounted base
price instead would be misleading. New reviewed adjustments remain subject to the
existing exact second-person approval and commercial constraints.

## Evidence and open gates

`023_phase5_source_checkout.sql` tests the real public boundary, quote replacement,
approval timing, source changes, immutable histories, fixed-price eligibility,
ownership, private helper grants and legacy rejection. The earlier 020 suite now
characterizes the private ledger kernel using transaction-local fixture grants
that roll back; it does not install a production bypass. The concurrency script
uses a source-bound accepted quote and exercises publication and checkout retries.

Measured local outcomes on September 4:

- Clean isolated reconstruction and **335 SQL assertions across 14 suites passed**,
  including 42 source/checkout assertions and all existing lifecycle/money suites.
- Eight concurrent source publications produced one snapshot/invoice; eight
  authenticated checkouts produced one attempt. Duplicate webhook effects and
  competing refund allocations also passed. A subsequent clean reset removed the
  committed synthetic concurrency fixtures.
- Lint, **84 unit tests**, TypeScript and the single-worker production build passed.
  Regenerated schema types are included. No application UI or Edge handler changed.
- The final selected-tier eligibility check also uses the existing canonical price
  resolver, including its package-wide invalid-price guard. The final function body
  is tested against the clean isolated schema; final PR CI reconstructs directly
  from the committed migration and reruns the complete application/browser suite.
- The initial withdrawal fixture tried to set a computed review flag; the inherited
  trigger correctly recalculated it. The corrected fixture pauses the offering.
  WSL startup briefly lacked a database socket; the concurrency harness now waits
  at most 30 seconds for this one isolated database, without resetting other stacks.

No Stripe network, bank, email, manual accessibility or production integration
check is implied by these tests. Final-head CI and code review remain PR gates.

Still open: finance workbench/private evidence collection and authorized provider
transport acceptance; complete quote breakdown presentation before initial quote
acceptance (the existing checkout reviews the full separately approved breakdown);
tax/promotion configuration; legacy cutover; uncertain checkout/repricing recovery;
and the remaining Phase 5 integration slices. This adapter never retroactively
claims a legacy one-number quote already had a full component acceptance record.
