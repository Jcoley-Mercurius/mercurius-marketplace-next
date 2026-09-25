# Phase 5 — Retention of application uploads never attached (TRACE-090)

**Status:** IMPLEMENTED on branch `codex/phase5-orphan-uploads`, rebased onto `main`
`6d1a11a` (after PR #47, TRACE-089). Awaiting code review. Merging is not phase acceptance or
production activation. No file in any hosted project has been moved or deleted.

**Authorization:** DEC-2026-012 item 5 (owner, 2026-09-24). A file in `vendor-documents`
under an application's upload path becomes due 7 days after its signed upload grant
expires, when neither the application's `document_urls` nor any compliance evidence
references it. It then follows the existing operator-run quarantine, 14-day wait and
permanent deletion, with application and provider holds respected. Orphaned renewal uploads
are not part of this decision.

## Gap

TRACE-084 applies CFG-011 retention to the files an application lists. A file whose upload
succeeded but was never added to `document_urls` is listed nowhere, so it stayed in the
private bucket indefinitely, and neither queue showed it.

## Characterized before change (`main` `3e4236c`)

- `POST /api/vendor-applications` inserts the application row, then for each document
  creates a Storage signed upload URL at
  `<application id>/<license|insurance|other>/<uuid>-<name>.<ext>` and signs one finalize
  token for those paths, expiring after 110 minutes. Grants are issued only there, once per
  application.
- Supabase signed upload URLs last 2 hours (`@supabase/storage-js`: "valid for 2 hours";
  the local Storage container has `SIGNED_UPLOAD_URL_EXPIRATION_TIME=7200`). The upload URL
  is therefore the later of the two grants.
- `POST /api/vendor-applications/documents` checks the finalize token and the stored objects
  and appends the paths to `document_urls`. A file never finalized, whether the browser
  stopped, the token expired or the request failed, stays unlisted.
- Neither grant's expiry is stored. `storage.objects.created_at` is set when the file is
  uploaded, and Storage's move keeps it (local probe below).
- TRACE-084's retention route checks only the upload layout and the application's folder,
  not whether the file is listed, so it needs no change.
- Renewal uploads live under `renewals/`, so they cannot match an application folder.

## Contract

Migration `20260925001000_vendor_application_unattached_uploads.sql` adds private helpers
and replaces four TRACE-084 functions in place, keeping their signatures and grants:

- `private.vendor_application_upload_grant_hours()` = 2 and
  `private.vendor_unattached_upload_days()` = 7.
- `private.vendor_application_unattached_files(application)` returns `(path, uploaded_at)`
  for files in the application's folder, in the upload layout, that no version or current row
  lists (TRACE-084's `vendor_application_files`). It takes objects in either bucket plus
  paths the retention ledger already knows. `uploaded_at` is the object's `created_at`, or
  null once the file is gone.
- **Clock:** `uploaded_at + 2 hours + 7 days`. An object can only be created after its grant
  was issued, so this is never earlier than the grant's expiry plus 7 days, and at most 2
  hours later.
- `vendor_application_retention_refusal`: an attached file keeps the TRACE-084 closure rules.
  An unattached file is due on its clock, whatever the application's status. Evidence,
  quarantine first, deletion once, the 14-day wait and holds apply to both. A deletion is
  recorded after storage no longer holds the file; its clock was checked at quarantine.
- `vendor_application_file_json` adds `attached` and `uploaded_at`. For an unattached file,
  `retention_ends_at` is the upload clock.
- `vendor_application_retention_queue` adds `unattached_due`, `unattached_kept`,
  `unattached_days` and `upload_grant_hours`. Quarantined unattached files appear in
  `quarantined` with `attached=false`.
- `vendor_application_retention_overview` adds `unattached_days` and `unattached_files`.

The helpers have no client, anonymous or service-key access. The evidence guard, hold
commands, closure command, ledger table and route are unchanged.

## Interface

**Admin → Document Retention → Application documents** gains "Uploads never attached to an
application". It has the same Quarantine action and hold message as the due list, shows the
upload date and when retention ended, and explains the clock. Its count is added to the "Due
for quarantine" total. In the quarantine list, an unattached file no longer reads
"Application reopened"; deletion opens after 14 days and the confirmation text says the
application does not change. Unattached files bound to evidence join "Kept as compliance
evidence", labelled "Never attached". The page description states the 7-day rule.

## Decisions made during implementation

1. **The clock runs from the object's `created_at`,** with no new stored grant time. It is
   never early; it can be up to 2 hours late. Recording the grant would mean a new write in
   the public route for no earlier deletion.
2. **The upload URL's 2 hours, not the finalize token's 110 minutes,** is the grant, because
   an upload can still land after the finalize token expires.
3. **"Referenced by `document_urls`" includes every application version,** matching
   TRACE-084's definition of an application's files. A path removed from the current row but
   listed by a version keeps the attached rules.
4. **The application's status does not matter** for an unattached file. A closed application's
   unattached upload is due after 7 days, not 90.
5. **Deletion does not re-read the upload time.** The file is gone from storage when the
   deletion is recorded, and its clock was checked when it was quarantined.
6. **The Applications dialog is unchanged.** The overview returns `unattached_files`, but the
   dialog does not show them yet; the queue is where operators act.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-090--never-attached-application-uploads--2026-09-25).

## Open items

- **Code review** (G1–G6) and CI on the branch.
- **Hosted check:** confirm the hosted project's signed upload URL lifetime is still 2 hours
  and that hosted Storage's move keeps `created_at`, before the first real quarantine.
- **Folders with no application row** are not listed. Application rows are never deleted
  (DEC-2026-012 item 3), so such a folder would come only from a failed or legacy path.
- **Orphaned renewal uploads** stay outside retention (not part of this decision).
- **Hosted acceptance:** the migration and the first real quarantine happen only with owner
  authorization (see HOSTED-MIGRATION-ROLLOUT.md).

## Review questions

- G1: the object `created_at` bound for the grant's expiry (decisions 1 and 2).
- G2: versions counting as attached (decision 3).
- G3: the upload clock applying whatever the application's status (decision 4).
- G4: deletion trusting the quarantine-time clock check (decision 5).
- G5: replacing the four TRACE-084 functions in place rather than adding new ones.
- G6: suite 057 and the browser spec's coverage.
