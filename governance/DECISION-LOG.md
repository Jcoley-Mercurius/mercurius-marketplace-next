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
