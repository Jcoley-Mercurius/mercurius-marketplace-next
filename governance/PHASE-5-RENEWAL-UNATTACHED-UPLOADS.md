# Phase 5 — Retention of renewal uploads never submitted (TRACE-091)

**Status:** IMPLEMENTED on branch `codex/phase5-renewal-orphan-uploads` from `main` `cd0c041`
(after PR #48, TRACE-090). Awaiting code review. Merging is not phase acceptance or production
activation. No file in any hosted project has been moved or deleted.

**Authorization:** DEC-2026-015 item 2 (owner, 2026-09-25): the TRACE-090 rule applies to
renewal uploads. A file under `renewals/` that no renewal submission lists becomes due 7 days
after its 2-hour signed upload URL expires, unless compliance evidence references it, and then
follows TRACE-074's operator-run quarantine, 14-day wait and deletion with provider holds.

## Gap

TRACE-074 applies CFG-011 retention to declined renewal submissions, keyed by their
`vendor_renewal_documents` row. A file uploaded through `/api/renewal-documents` but never sent
to `/api/renewal-documents/submit` has no row, so it stayed in the private bucket indefinitely
and no queue showed it. TRACE-074 and TRACE-090 both recorded it as open.

## Characterized before change (`main` `cd0c041`)

- `POST /api/renewal-documents` asks `vendor_authorize_renewal_upload` through the caller's
  session, then issues one Storage signed upload URL (2 hours) at
  `renewals/<provider>/<license|insurance>/<uuid>-<name>.<ext>`. Nothing is recorded.
- `POST /api/renewal-documents/submit` calls `vendor_submit_renewal_document`, which reads the
  object from storage and inserts the submission. **There is no time limit:** unlike the
  application route's 110-minute finalize token, a provider's session can submit an old upload
  at any time. The submission takes the provider's onboarding lock.
- TRACE-074's ledger (`vendor_renewal_retention_actions.document_id not null`) cannot hold a
  file with no submission. TRACE-084's application ledger is keyed by path and records size.
- Compliance evidence reaches a renewal file only through a submission
  (`vendor_record_checklist_evidence`), but the evidence kernel accepts any reference.
- Storage's move keeps `created_at` (TRACE-090's probe).

## Contract

Migration `20260925002000_vendor_renewal_unattached_uploads.sql`:

- **Ledger** `vendor_renewal_upload_retention_actions`: immutable, private; provider, path,
  action, size on quarantine, reason, `under_hold`, key, actor. At most one deletion per path;
  the path must lie in the provider's folder.
- `private.vendor_renewal_unattached_uploads(provider?)` returns `(path, contractor_id,
  uploaded_at)` for files in the renewal layout, in either bucket or known to the ledger, for
  existing providers, that no submission lists.
- **Clock:** `uploaded_at + 2 hours + 7 days`, TRACE-090's single definitions.
- `vendor_renewal_upload_retention_prepare` / `_record(path, action, reason, key)`: operator
  only; the TRACE-074/084 prepare, Storage step, record shape. Refusals: a submitted upload,
  unknown path, deleted, not quarantined, evidence-bound, before the clock, under 14 days in
  quarantine, provider hold (unless storage already shows the step). Record takes the
  provider's onboarding lock and accepts only what `storage.objects` shows.
- **Evidence guard:** a renewal-layout path out of document storage by this ledger cannot
  become evidence, whichever command records it.
- **Submission cut-off:** `vendor_submit_renewal_document` refuses an object 7 days old or
  older ("This upload has expired; upload the document again"). Replays are unaffected.
- `vendor_document_retention_queue` adds `unattached_days`, `upload_grant_hours`,
  `unattached_due`, `unattached_quarantined` and `unattached_kept`; its existing lists are
  unchanged.

Grants: ledger and helpers have no client, anonymous or service-key access; prepare and record
are `authenticated` only and check the operator role.

## Route and interface

- **`POST /api/renewal-documents/uploads/retention`** `{path, action, reason, key}`: the
  TRACE-074 route's shape with the path as the identifier. The path must match the renewal
  layout; the Storage step is limited to that layout and the two buckets whatever prepare
  returns.
- **Admin → Document Retention** gains "Renewal uploads never submitted" (Quarantine or the
  hold message), "Renewal uploads in quarantine" (Restore, and Delete permanently after 14
  days), and "Renewal uploads kept as compliance evidence" when any exist. Both lists count in
  the page totals. A queue without the new lists (a database before this migration) shows
  them empty. Hold wording now names never-submitted uploads.

## Decisions made during implementation

1. **A separate path-keyed ledger** rather than widening TRACE-074's, because there is no
   document row; it copies TRACE-084's application ledger shape.
2. **The submission cut-off at 7 days** (DEC-2026-015 item 2) leaves a 2-hour gap before
   quarantine opens, so a submission and a quarantine can never overlap, whatever the request
   timing. A restored upload keeps its original `created_at`, so it stays unsubmittable.
3. **TRACE-090's constants are reused** (`vendor_application_upload_grant_hours`,
   `vendor_unattached_upload_days`, `vendor_application_unattached_due_at`): both routes use
   the same Storage signed upload URL, and the owner set one rule.
4. **The existing queue readback is extended** instead of adding a readback, so the page keeps
   one renewal source and one application source for its totals.
5. **Providers only:** a path whose provider does not exist is not listed. Upload authorization
   requires the provider, so such a path could come only from a legacy or failed write.
6. **The activation checklist is unchanged.** It lists submissions only.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-091--never-submitted-renewal-uploads--2026-09-25).

## Open items

- **Code review** (H1–H6) and CI on the branch.
- **Hosted check:** the TRACE-090 hosted checks (upload URL lifetime, move keeps `created_at`)
  cover this route too.
- **Hosted acceptance:** the migration and the first real quarantine happen only with owner
  authorization (HOSTED-MIGRATION-ROLLOUT.md).

## Review questions

- H1: the submission cut-off at 7 days (decision 2) — a provider-visible refusal.
- H2: a separate ledger keyed by path (decision 1).
- H3: reusing TRACE-090's constants (decision 3).
- H4: the evidence guard for renewal-layout paths.
- H5: extending `vendor_document_retention_queue` in place (decision 4) and the page tolerating
  its absence.
- H6: suite 058 and the browser spec's coverage.
