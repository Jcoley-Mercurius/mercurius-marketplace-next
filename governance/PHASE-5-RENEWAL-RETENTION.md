# Phase 5 — Retention of declined renewal documents (TRACE-074)

**Status:** IMPLEMENTED on branch `codex/phase5-renewal-retention`, based on `main`
`bbb0482` (PR #29, TRACE-073, merged). Awaiting Codex code review. Merging is not phase acceptance or production
activation, and no file in any hosted project has been moved or deleted.

**Authorization (2026-09-15):** the owner directed implementation of the next Phase 5 item
after TRACE-073 and answered the four retention semantics below before implementation.

## Gap

CFG-011 keeps rejected or abandoned vendor documents for 90 days, subject to active
investigation or legal hold, and requires retention jobs to be observable and reversible
where appropriate. TRACE-073 left declined renewal files and never-submitted uploads in the
private bucket indefinitely, and no hold mechanism existed.

## Owner decisions (2026-09-15)

1. **Scope: declined renewal documents only.** The 90 days start at the decline decision.
   Never-submitted uploads and rejected application documents are not in this slice.
2. **An operator runs each step from a queue.** No scheduler or unattended job.
3. **Provider-level retention hold** with a required reason. While in force, the provider's
   declined documents cannot be quarantined or permanently deleted.
4. **Quarantine, then delete.** A due file moves to a private quarantine where it can be
   restored; permanent deletion opens 14 days after quarantine. The owner chose this option
   as offered ("a grace period, e.g. 14 days"); 14 is the implemented value and is defined
   once in the database, so confirm or change it at review.

## Characterized before change

- Storage refuses direct deletes from SQL (`storage.protect_objects_delete` raises unless
  `storage.allow_delete_query` is set), so files must be moved or removed through the
  Storage API. Local Storage (v1.70.3) supports a cross-bucket move; repeating a move
  returns 404 and repeating a removal succeeds with nothing removed.
- The 2026-07-31 admin `SELECT`/`UPDATE`/`DELETE` policies name only `vendor-documents`.
  Their `WITH CHECK` also prevents an operator client moving a file to another bucket.
- Operators open renewal files with a signed link from the browser against
  `vendor-documents`, so a quarantined file must stop offering Open.

## Contract

Migration `20260915002000_vendor_renewal_document_retention.sql`:

1. **Bucket `vendor-documents-quarantine`** — private, same size and type limits. No storage
   policy names it, so only the service key reaches it.
2. **Periods** — `private.vendor_document_retention_days()` = 90 and
   `private.vendor_document_quarantine_days()` = 14, the single definitions.
3. **`vendor_retention_hold_events`** — immutable, private; `placed`/`released`, reason,
   key, actor. The latest event says whether a hold is in force.
4. **`vendor_renewal_retention_actions`** — immutable, private; `quarantined`, `restored` or
   `deleted` per declined document, reason, key, actor and `under_hold`. At most one
   deletion per document. The latest action gives the ledger state (retained, quarantined,
   deleted).
5. **`vendor_prepare_renewal_retention(document, action, reason, key)`** — operator; writes
   nothing. Only declined documents; quarantine needs the ledger state retained and the
   decline at least 90 days old; restore needs quarantined; deletion needs quarantined for
   at least 14 days; a deleted document takes no further step. A hold refuses quarantine and
   deletion unless storage already shows that step complete. Returns the storage path and
   buckets, or `replay` for a key already recorded for this exact step.
6. **`vendor_record_renewal_retention(document, action, reason, key)`** — operator; takes the
   provider's onboarding lock; exact replay only (same document, action, reason and actor);
   re-checks the ledger preconditions; then **reads `storage.objects`**: quarantined requires
   the file only in quarantine with the submitted size, restored the reverse, deleted in
   neither bucket. Records `under_hold` when a hold is in force.
7. **`vendor_place_retention_hold` / `vendor_release_retention_hold(contractor, reason,
   key)`** — operator; onboarding lock; place needs no hold in force, release needs one;
   exact replay only.
8. Readbacks, all writing nothing: operator `vendor_document_retention_queue()` (due,
   quarantined and holds, each document with ledger state, dates, where storage actually
   holds the file and whether its provider is held); `vendor_renewal_document_overview`
   gains the provider's hold and each declined document's retention fields. The vendor
   readback is unchanged.

Nothing changes a submission, decision, evidence, onboarding status or revision, application
version, role, eligibility or listing. Grants: tables and helpers have no client access; the
five new public functions are `authenticated` only.

## Route and interface

- **`POST /api/renewal-documents/retention`** `{documentId, action, reason, key}`: prepare
  through the caller's session; unless it is a replay, one Storage call with the service
  client (move to or from quarantine, or remove from quarantine), restricted by
  `retentionStorageStep` to renewal paths and those two buckets whatever the prepare response
  says; then record through the caller's session. A Storage error is logged, not trusted:
  recording decides. Database refusals are returned (400/403); anything else is generic.
- **Admin → Document Retention** (`/admin/compliance/retention`, new sidebar entry): totals;
  retention holds with Release; Due for quarantine with Quarantine, or the hold message, or
  an investigate message when storage shows the file missing or in both buckets; In
  quarantine with Restore and, once 14 days have passed and no hold applies, Delete
  permanently ("cannot be undone"). Every step is a reason-required ConfirmAction confirmed
  by rereading the queue; loading, error-with-retry and empty states.
- **Activation checklist → Renewal documents**: hold status with Place hold / Release hold
  (reason-required, confirmed by rereading the overview); quarantined and deleted files show
  a retention badge and an explanation instead of Open.

## Decisions taken during implementation

1. **Prepare and record around the Storage call, with storage as the proof.** The database
   cannot delete objects itself. Recording only what `storage.objects` shows means an
   interrupted request records nothing and a retry completes it; no reservation or
   unknown-outcome state is needed.
2. **A hold refuses a step only while the file is still where the step starts.** If a move or
   removal finished before a hold was placed but was not yet recorded, the retry records it
   with `under_hold = true` instead of leaving storage and the ledger disagreeing. Restoring
   is always allowed; it destroys nothing.
3. **A separate private bucket** rather than a folder in `vendor-documents`, because the
   admin read policy is bucket-wide.
4. **A restored document becomes due again** while its decline is past 90 days. Keeping it
   longer is what a hold is for.
5. **Holds are placed from the provider's checklist**, where an operator already works on the
   provider, and listed with Release on the retention page.
6. **Idempotency keys carry the state they act on** (`retention_since` or a per-page hold
   generation), so repeating a cycle on one page is a new request, not a replay.

## Open items

- **Never-submitted uploads** (orphaned renewal uploads) and **rejected or abandoned
  application documents** remain outside retention; each needs its own clock definition.
- **Operator `DELETE` on `vendor-documents`** (2026-07-31 policy) still lets an operator
  client remove a file outside this workflow. The queue now shows such a file as "not found
  in storage", but the policy is unchanged without a decision.
- **Legal hold scope** is provider-level only, as decided; a hold does not cover application
  documents or other buckets.
- **Hosted acceptance**: bucket creation and the first real quarantine happen only when the
  migration is deployed with owner authorization.
- Codex code review; CI on the final head; confirmation of the 14-day grace period.
- Standing: malware scanning ADR (MTS §15); TRACE-065 dark-theme contrast defect.
