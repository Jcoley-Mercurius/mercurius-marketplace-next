# Mercurius Decision Log

Use this log for material decisions made after the approved MPS, MDS, MTS, and configuration baseline. Do not duplicate decisions already recorded in `OWNER-APPROVALS.md` or `CONFIGURATION-DECISIONS.md`.

## Decision template

```text
Decision ID: DEC-YYYY-NNN
Status: PROPOSED | APPROVED | SUPERSEDED | DEPRECATED
Date:
Decision:
Context:
Alternatives considered:
Rationale:
MPS impact:
MDS impact:
MTS impact:
Data/payment/security impact:
Implementation owner:
Required evidence:
Supersedes:
```

## Decisions

### DEC-2026-011 — Phase 5 independent contracts and bank-operated ACH

**Status:** APPROVED owner direction; implementation choices below use the owner's delegated chargeback discretion.
**Date:** 2026-09-04 UTC.

The owner authorized a clean Phase 5 branch from current remote main in a separate
worktree, without taking unmerged PR #4 code. Main was fetched at d8cceee; PR #4
was OPEN and unmerged at 91bc94f. Phase 4 schema integration and owner acceptance
remain dependencies, not assumptions or duplicated implementations.

The owner will initiate weekly ACH directly from Mercurius's bank account and
collect the relevant authorization forms during onboarding. There is no ACH API
processor selection to make and no Stripe Connect integration. Store private
form/evidence references, statements and bank outcomes; never bank credentials or
full account details in events, fixtures, logs or exports. Weekly reporting
periods span seven days and do not overlap; no bank submission weekday is invented.

Every vendor must have reviewed, current licensing and insurance evidence.
Category/jurisdiction-specific document sufficiency is reviewed against an explicit
requirement version; uploading a file or accepting an invitation is not activation.
No arbitrary licence exemption, insurance limit or bank-form expiry is inferred.

The owner delegated chargeback treatment. Selected policy: hold disputed funds;
Mercurius absorbs processor and dispute fees; allocate lost unpaid principal to
reviewed service/tax/tip components and recompute the fee on retained service.
Scheduled or already-paid funds require a separate recovery review. No automatic
vendor bank debit, clawback, or netting of future unrelated earnings is authorized.
Chargebacks are not labelled customer refunds. Fee rounding follows the recovered
nearest-cent convention; provider proceeds receive the remainder so totals balance.

MPS §6.5 second-person review is enforced for the new reviewed financial commands
by a separately authenticated approval of the exact command. No finance members
or real approvals are seeded. Release must establish the two authorized operators.

Tax calculation/remittance evidence and complete promotion terms remain required
configuration. Test fixtures are not approved real tax or promotion policy.
No live charges/refunds/payouts/emails, production changes, deployment, merge,
Cron activation, or Homeschool Haven changes are authorized.

### September 4 repository merge authorization

After the independent checkpoints above, the owner authorized merging PRs #4 and
#5, then resolving PR #6's conflicts, requesting CodeRabbit review and merging its
repository checkpoint. This later instruction supersedes earlier no-merge wording
for these PRs only. Production changes, deployment, money/email execution and Cron
activation remain outside that authorization. See PR-6-MERGE-RECONCILIATION.md.

### DEC-2026-004 — Approve Phase 2 checkpoint and defer lifecycle activation

**Status:** APPROVED

**Date:** 2026-09-03

**Decision:** The owner approved the documented live-versus-local differences
for the Phase 2 reconstruction checkpoint and authorized commit, push, and a
pull request. This includes the local grant hardening and preservation of local
checkout/refund validation and payment-to-matching behavior described in the
Phase 2 validation and Edge recovery reports. This is not approval to deploy
those differences to production or to merge the PR automatically.

**Follow-up ownership:** Remaining lifecycle and scheduler implementation,
authenticated gateway integration, concurrency/failure tests, and activation
planning move to Phase 4 (TRACE-010). Payment and payout integrity remain Phase 5.
Supabase Cron is installed and selected, but no worker job is activated.

**Completion policy:** Unconfirmed completion must escalate to admin review,
not automatically become homeowner-confirmed. The escalation deadline remains
to be defined in Phase 4. The existing four-hour vendor offer acceptance window
is a separate matching deadline, not a completion confirmation deadline. Preserve
the recovered worker as reconstruction evidence until the Phase 4 forward change
and tests replace its inherited 72-hour automatic confirmation.

**Closeout:** Phase 2 reconstruction is accepted with these explicit follow-ups.
Phase 3 may begin from the reviewed checkpoint; production activation remains
subject to its own gates. Homeschool Haven must remain untouched.

### DEC-2026-003 — Select Supabase Cron for lifecycle scheduling

**Status:** APPROVED (scheduler provider selection; activation gates remain)

**Date:** 2026-09-03

**Decision:** The owner selected Supabase Cron rather than an external scheduler.
The conversational phrase “Supabase clone” is interpreted as Supabase Cron,
the option under discussion, not a request to clone production data.

**Implementation boundary:** Prepare scheduling within Supabase, with credentials
kept in approved server-side stores. No production job was created or enabled in
this checkpoint. Provider selection does not resolve the inherited worker's
unreviewed lifecycle semantics or approve a change to homeowner confirmation and
payout eligibility. See `SUPABASE-CRON-SETUP.md` for the activation requirements.

**Required evidence:** Duplicate-scheduler check, authenticated gateway/worker
integration against synthetic fixtures, concurrency and failure tests, lifecycle
policy reconciliation, secret-safe configuration, and reviewed activation/stop
procedure. These remaining implementation gates move to TRACE-010 / Phase 4
under DEC-2026-004; they are not claimed as passing at Phase 2 closeout.

### DEC-2026-002 — Authorize deployed Edge Function source inventory

**Status:** APPROVED

**Date:** 2026-09-03

**Decision:** The owner authorized read-only export of deployed Edge Function source and JWT verification settings for Phase 2. Customer data and secret/environment values remain excluded.

**Context:** Eight deployed functions have no local source, including four invoked by the application.

**Security boundary:** Export into ignored local staging, inspect for embedded credentials before adding source to the repository, and preserve existing local implementations until drift is reviewed. No function invocation, deployment, deletion, production database mutation, or secret-store export is authorized.

**Required evidence:** Source/JWT inventory, credential scan, implementation drift review, local reconstruction tests, and confirmation that production remains unchanged.

**Supersedes:** Nothing; extends DEC-2026-001 to deployed function code and non-secret JWT settings.

### DEC-2026-001 — Authorize sanitized live-schema inventory

**Status:** APPROVED

**Date:** 2026-08-29

**Decision:** The repository owner confirmed that the linked Supabase project has a current backup and authorized a read-only, schema-only export for Phase 2. Customer data and secrets must not be exported.

**Context:** Roadmap Phase 2 requires the live backend boundary to be inventoried before the repository can become the canonical reconstructible backend definition.

**Alternatives considered:** Reconstruct from code references alone; defer the inventory.

**Rationale:** Code references and committed migrations are known to omit pre-existing live objects. A sanitized schema inventory is necessary to reconcile that drift without guessing or mutating production.

**MPS impact:** None; this records implementation evidence only.

**MDS impact:** None.

**MTS impact:** Unblocks Roadmap Phase 2 / MTS Slice 3.

**Data/payment/security impact:** Read-only metadata access only. No rows, storage objects, credentials, secret values, production migrations, or other external mutations are authorized.

**Implementation owner:** Codex implementation agent under repository-owner review.

**Required evidence:** Sanitized schema artifact; object inventory; live-to-repository drift report; secret scan; confirmation that no customer rows were committed.

**Supersedes:** Nothing.

### DEC-2026-005 — Accept Phase 3 and authorize Phase 4

**Status:** APPROVED. **Date:** 2026-09-03.

The owner accepted Phase 3 as closed at PR #3 and authorized lifecycle/scheduler
reconciliation, tests, governance updates and a draft PR. Phase 3 manual
accessibility, brand and cross-platform follow-ups remain recorded separately.
PR #3 was verified open/unmerged at 91379e9; Phase 4 initially branched from that
head. Its later merge at db3f406 was independently verified as tree-identical;
the Phase 4 branch was rebased onto that merged main without changing Phase 3.
No merge, deploy, production change, Cron activation or Homeschool Haven operation
is authorized. Heavy checks remain sequential, with MERCURIUS_BUILD_WORKERS=1.

### DEC-2026-006 — Completion escalation deadline

**Status:** APPROVED. **Date:** 2026-09-03.

Asked how long after the homeowner completion-confirmation notice an unanswered
job should escalate to admin review, the owner answered: “72 hours is approved.”
The clock begins with the recorded notice, not provider offer creation. At 72h
the job stays completion-pending and gains an auditable admin-review flag. Silence
never creates homeowner confirmation or payout eligibility. The four-hour vendor
offer deadline is separate. No other inherited reminder/quiet-hour timer is
approved by this decision. Required evidence: boundary, retry, cross-role, failure
and concurrency tests; no confirmation or financial effects on escalation.

### DEC-2026-007 — Vendor acceptance schedules service

**Status:** APPROVED. **Date:** 2026-09-03.

The owner clarified that the four-hour window is the vendor's time to accept the
homeowner's offer, not a quote-validity period. A request becomes scheduled
immediately when the vendor accepts. Do not add payment, separate homeowner quote
approval or mutual appointment confirmation as prerequisites to that scheduling
transition. The four-hour quote-expiry interpretation was discarded before any
quote-expiry migration was applied. Quote validity/revision remains an open
specification, separate from the approved offer window and 72-hour completion review.

### DEC-2026-008 — Homeowner quote approval window

**Status:** APPROVED. **Date:** 2026-09-03.

Asked how long a price quote remains valid for homeowner approval, the owner
answered “24 hour for approval.” New quote revisions therefore expire 24 hours
after being sent. This is separate from the four-hour vendor offer and 72-hour
completion escalation. Replacing or extending a quote creates a new revision;
previous revisions and decisions remain in history. No expiry is retroactively
inferred for a legacy quote that has no recorded notice/deadline.

### DEC-2026-009 — Disputes and rating-neutral reviews

**Status:** APPROVED. **Date:** 2026-09-03.

The owner approved a 48-hour dispute filing window beginning when the vendor
marks the work complete. Homeowners may appeal admin resolutions through the
ticket system. No appeal deadline was specified; none is imposed by this slice.
Every star rating uses the same moderation rules. A separate review-management
system is future work. Previously private feedback is not retroactively published.

### DEC-2026-010 — Operational defaults for Phase 4

**Status:** APPROVED. **Date:** 2026-09-03.

The owner approved at least one completion photo per visit unless a category rule
requires more; separate jobs for recurring visits; cancellations affecting one
visit; and moderation for spam, personal information, threats/abuse, or content
unrelated to the service, never for a low rating alone. Email/reminder timing
stays inactive until separately configured. These decisions do not authorize
Cron activation, real messages, charges, refunds, payouts, merge or deployment.
