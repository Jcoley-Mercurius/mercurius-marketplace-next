# Phase 5 — Retention of rejected and abandoned application documents (TRACE-084)

**Status:** IMPLEMENTED on branch `codex/phase5-application-retention`, based on `main`
`44e4efa` (PR #39, TRACE-083, merged). Awaiting Codex code review. Merging is not phase
acceptance or production activation, and no file in any hosted project has been moved or
deleted.

**Authorization (2026-09-23):** the owner directed implementation of TRACE-084 and answered
the four decisions below before implementation.

## Gap

CFG-011 keeps rejected or abandoned vendor documents for 90 days, subject to active
investigation or legal hold, with retention jobs that are observable and reversible where
appropriate. TRACE-074 applied this to declined renewal documents only. Its report lists
rejected or abandoned application documents as still outside retention.

## Characterized before change

- Application files live in the private `vendor-documents` bucket at
  `<application id>/<license|insurance|other>/<uuid>-<name>.<ext>`. The service-key
  finalize route appends their paths to `vendor_applications.document_urls`, and each
  append creates an application version whose snapshot lists them.
- **A rejection recorded nothing.** The Applications page set `status = 'rejected'`
  directly, behind `window.confirm`. It stored no time, actor or reason. The 2026-03-16
  admin `UPDATE` policy lets any admin set the status back, and `updated_at` is not
  maintained.
- **Nothing set `abandoned`.** Guards in eleven places read the status, but no code path
  wrote it.
- **An application file can become compliance evidence.** TRACE-062
  (`vendor_record_compliance_document`) and TRACE-069 (checklist) store the file's path as
  `vendor_compliance_evidence.evidence_ref`. The TRACE-062 path does not check the
  onboarding status.
- **Provider rejections record a time.** `vendor_decide_onboarding` records a provider
  rejection as an immutable `vendor_onboarding_events` row, and the rejection is terminal.
- **Holds cover providers only.** TRACE-074 holds are provider-level, and most rejected
  applicants never have a provider record.

## Owner decisions (2026-09-23)

1. **The clock starts at a recorded rejection.** A reviewed closure command records the
   actor, reason and time, and replaces the direct status update. A provider rejected
   through onboarding review also starts the clock, from its rejection event. A legacy
   rejection with no record is not due until an operator records it. Nothing is
   backfilled.
2. **An operator marks an application abandoned,** with a required reason. There is no
   inactivity timer.
3. **Evidence is never purged.** A file referenced by any compliance evidence is never
   quarantined or deleted.
4. **Application-level holds.** A hold can be placed on an application. A TRACE-074
   provider hold also covers the documents of that provider's applications.

Never-submitted uploads (files uploaded but not finalized, and orphaned renewal uploads)
were not asked about and stay outside retention; each needs its own clock definition.

## Contract

Migration `20260923002000_vendor_application_document_retention.sql` reuses TRACE-074's
quarantine bucket, its 90-day and 14-day definitions, `vendor_retention_hold` and the
storage-location reader unchanged.

1. **`vendor_application_closures`** — immutable, private. Each row records the outcome
   (`rejected` or `abandoned`), the status it replaced, the reason, the key, the actor and
   the time. The latest closure is in force only while the application's status still
   equals its outcome, so a status changed afterwards takes the files out of retention.
2. **`vendor_application_retention_hold_events`** — immutable, private; `placed` or
   `released`. The latest event says whether a hold is in force.
3. **`vendor_application_retention_actions`** — immutable, private. Each row records one
   `quarantined`, `restored` or `deleted` step per file path, with its reason, key, actor
   and `under_hold`. The path must be inside the application's folder, a quarantine stores
   the size storage showed, and a file is deleted at most once.
4. **An application's files** are every path its versions or current row list, limited to
   the form's upload layout in that application's own folder.
5. **The clock** is the recorded closure in force, or the provider's onboarding rejection
   event for the application under review. When both exist, the later one is used.
6. **`vendor_close_application(application, outcome, reason, key)`** — operator only,
   under the application row lock; exact replay only.
   - Refused when the application has a provider or onboarding record (decide it through
     onboarding review) or a closure already in force.
   - Allowed from `pending` or `approved`, or from a legacy status equal to the outcome,
     which records it and starts its clock now.
   - Sets only `vendor_applications.status`, which is not versioned.
7. **`vendor_application_retention_prepare(application, path, action, reason, key)`** —
   operator only; writes nothing.
   - Quarantine needs the file retained, not bound to evidence, a closure in force and 90
     days passed.
   - Deletion needs the same, plus 14 days in quarantine.
   - Restore needs only the file in quarantine.
   - A hold refuses quarantine and deletion unless storage already shows the step
     complete.
8. **`vendor_application_retention_record(...)`** — operator only. It locks the attached
   providers' onboarding rows and then the application, the same order evidence recording
   uses. It re-checks everything and reads `storage.objects`:
   - quarantined: the file is in quarantine only, with a readable size, which is stored;
   - restored: the file is back in document storage, with that stored size;
   - deleted: the file is in neither bucket.
   It records `under_hold` when a hold is in force.
9. **`vendor_place_application_retention_hold` / `vendor_release_application_retention_hold`**
   — operator only, under the application lock; exact replay only.
10. **Evidence guard** — a `BEFORE INSERT` trigger on `vendor_compliance_evidence` refuses
    an application file whose application is closed, or which retention has moved out of
    document storage. This freezes the evidence set a retention step checks, whichever
    command records evidence.
11. **Readbacks**, all writing nothing:
    - `vendor_application_retention_queue()`: due, quarantined, kept (bound to evidence),
      unrecorded (legacy statuses with no closure) and holds;
    - `vendor_application_retention_overview(application)`: closure, allowed outcomes,
      holds and each file's retention fields.

Grants: tables and helpers have no client access, and the seven new public functions are
`authenticated` only.

## Route and interface

- **`POST /api/vendor-applications/retention`** `{applicationId, path, action, reason, key}`.
  It has the same shape as the TRACE-074 route:
  - the caller's session prepares the step;
  - one service-key Storage move or removal, which `applicationRetentionStorageStep`
    restricts to that application's upload paths and the two buckets, whatever prepare
    returned;
  - the caller's session records the step.
  `retentionStorageStep`'s bucket logic became the shared `preparedStorageStep`.
- **Applications → application dialog → Closure and retention**. This replaces the direct
  Reject button and its `window.confirm`.
  - Reject and Mark abandoned are reason-required ConfirmActions. A legacy status offers
    Record rejection only.
  - An application with a provider points to onboarding review.
  - The panel shows the recorded closure, reason and retention end date, and how many
    files are kept as evidence.
  - Application hold: Place application hold / Release application hold.
  - Credential documents that retention has moved show their state instead of offering
    Open.
  - The status filter gains Abandoned.
- **Admin → Document Retention** gains an Application documents section:
  - application holds with Release;
  - due files with Quarantine, the hold message or an investigate message;
  - quarantined files with Restore and, once open, Delete permanently. A reopened
    application's file offers Restore only.
  - Kept as compliance evidence;
  - Closed without a recorded time.
  Every step is confirmed by rereading, and the section has loading, error-with-retry and
  empty states.

## Decisions taken during implementation

1. **A status changed after a closure takes the files out of retention.** The admin
   `UPDATE` policy still permits it, so a clock cannot outlive the closure it came from.
   Quarantined files can still be restored.
2. **The closure command refuses applications with a provider record.** Their rejection
   belongs to `vendor_decide_onboarding`, whose event already starts the clock.
3. **The evidence guard trigger** was added so that no evidence path (including TRACE-062's,
   which does not check onboarding status) can bind a closed application's file between a
   retention prepare and record. It also aligns TRACE-062 with the checklist's existing "a
   rejected provider takes no further evidence" rule.
4. **The prepare and record functions are named `vendor_application_retention_prepare` and
   `_record`**, not the TRACE-074 word order. The repository's secret scanner treats
   `re_` followed by 20 or more characters as a Resend key, and the TRACE-074 order
   (`vendor_prepare_` + `application_retention`) produces exactly that.
5. **Hold labels in the dialog say "application hold"**, so they are distinct from the
   provider hold in the activation checklist on the same dialog.

## Open items

- **Codex code review** (C1–C8 below) and CI on the final head.
- **Never-submitted uploads** remain outside retention; they need a clock definition.
- **The admin `UPDATE` and `DELETE` policies on `vendor_applications`** (2026-03-16) still
  let an admin change a status directly. The TRACE-074 open item on operator `DELETE` in
  `vendor-documents` also still stands. Both need a decision.
- **Document Retention totals** at the top of the page count renewal documents only.
- **Hosted acceptance**: the migration, and the first real closure and quarantine, happen
  only with owner authorization.
- Standing: malware scanning ADR (MTS §15); the 14-day grace confirmation (TRACE-074).

## Review questions

- C1: fail-closed closure when the status changes afterwards (decision 1 above).
- C2: the later of a recorded closure and an onboarding rejection as the clock.
- C3: the evidence guard trigger's effect on TRACE-062 evidence for a rejected provider.
- C4: lock order (onboarding rows, then application) in record versus evidence recording.
- C5: size recorded at quarantine as the only integrity check for application files.
- C6: files listed on another application's row are ignored, not refused.
- C7: legacy statuses recorded with the same outcome only.
- C8: provider holds covering application files through both the legacy link and onboarding.
