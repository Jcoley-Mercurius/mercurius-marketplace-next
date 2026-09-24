# Phase 5 — Removal of the legacy admin write paths to applications and their documents (TRACE-085)

**Status:** IMPLEMENTED on branch `codex/phase5-application-privileges`, based on `main`
`7cc7203` (PR #41, TRACE-084 checkpoint, merged). Awaiting Codex code review. Merging is not phase
acceptance or production activation. No hosted policy, grant, row or file has changed.

**Authorization (2026-09-23):** the owner chose this slice and approved revoking the four
legacy admin write policies and the table grants behind the two row policies.

## Gap

TRACE-084 replaced the Applications page's direct status update with a recorded closure,
and TRACE-074/084 made quarantine and deletion of stored documents operator-run steps
recorded only once Storage confirms them. Both reports left the old privileges open:

- the 2026-03-16 policies `Admins can update applications` and `Admins can delete
  applications` on `public.vendor_applications`, backed by `authenticated` `UPDATE` and
  `DELETE` grants;
- the 2026-07-31 policies `Admins can update vendor documents` and `Admins can delete
  vendor documents` on `storage.objects`, naming only the private `vendor-documents`
  bucket.

A signed-in admin could therefore change an application's status or document list, delete
the row, or overwrite, move or remove a stored file from a browser client. Each skips the
closure record, application and provider retention holds, the evidence guard and the
retention record, and the retention queue then shows the file as not found in storage.

## Characterized before change

Read from a clean local reset of `main` `76c833a`:

- `vendor_applications` policies: admin `SELECT`, admin `UPDATE`, admin `DELETE`, and the
  applicant `INSERT` (`anon`, `authenticated`) restricted to a pending, uninvited row.
  Grants: `authenticated` `SELECT, INSERT, UPDATE, DELETE`; `anon` `INSERT`.
- `vendor-documents` policies: two identical admin `SELECT` policies (2026-07-31 and
  2026-08-09), admin `UPDATE`, admin `DELETE`. TRACE-073 already removed the anonymous
  upload policy. The quarantine bucket has no policy.
- **Nothing in the application uses the write paths.** Browser code reads applications and
  opens documents with signed links (`SELECT`). The upload finalize route and the two
  retention routes use the service key. Every database function that writes
  `vendor_applications` (`vendor_close_application`, `vendor_start_onboarding_review`) or
  `storage.objects` is `SECURITY DEFINER`. No Edge Function touches either.

## Contract

Migration `20260924001000_vendor_application_admin_writes.sql`:

- drops `Admins can update applications` and `Admins can delete applications`;
- revokes `UPDATE` and `DELETE` on `vendor_applications` from `authenticated`, which also
  removes every column-level `UPDATE`;
- drops `Admins can update vendor documents` and `Admins can delete vendor documents`.

Unchanged: admin `SELECT` on both, the applicant `INSERT` policy, `service_role`
privileges, the reviewed commands, and every other bucket's policies. With no write policy
on `vendor-documents`, a client write to that bucket matches no row. Through the local
Storage API an admin's move or rename returns 404, an overwrite returns 403, and a remove
returns success with an empty list while the file stays. Operator code already confirms
retention steps by rereading, never from the remove result.

**Document Retention totals.** The page's totals counted renewal documents only. They now
add the application queue's due, quarantined and held counts; "Providers on hold" becomes
"Retention holds" (provider holds plus application holds; the two never overlap in the
queues). Until the application queue has loaded, or when its last load failed, each total
reads "Application queue not loaded" instead of a partial number. The page's Refresh now
reloads both queues.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-085--removal-of-the-legacy-admin-write-paths--2026-09-23).

## Decisions made during implementation

1. **Grants revoked as well as policies.** With the policies gone the grants no longer let
   an admin write, but a later permissive policy would reopen the path silently. The
   revoke keeps the table closed unless a migration grants it again.
2. **The duplicate admin `SELECT` policy on `vendor-documents` is left.** It is harmless
   and outside the approved revocation.
3. **Suite 041's quarantine-move assertion changed.** It expected the old update policy's
   check to raise 42501; the move now matches no row. The file-stays-put assertion after it
   still holds, and now carries the requirement.
4. **Totals are withheld, not partial,** while the application queue is unavailable, so an
   operator never reads a renewal-only count as the whole.

## Open items

- **Codex code review** (A1–A5 below).
- **Deleting an application row** now has no client path at all. A spam or duplicate
  application is closed as abandoned; if the owner wants rows removed, that needs its own
  reviewed command and a retention definition for the row.
- **The applicant `INSERT` policy** (`anon`, `authenticated`) is still open although the
  form submits through the service-key route. A direct insert creates a pending row with no
  documents and notifies admins. This was not part of the approved revocation.
- **Hosted acceptance**: the migration applies to a hosted project only with owner
  authorization. Before it does, confirm no operator relies on editing applications or
  documents in the Supabase dashboard as an `authenticated` admin (the dashboard's service
  access is unaffected).
- Carried from TRACE-084: never-submitted uploads outside retention; malware scanning ADR;
  the 14-day grace confirmation.

## Review questions

- A1: revoking the grants in addition to dropping the policies.
- A2: that no browser, route, Edge Function or `SECURITY INVOKER` function depends on the
  removed privileges.
- A3: silent zero-row client writes on `storage.objects` (RLS) rather than an error, and
  whether the Storage API surfaces that clearly enough.
- A4: withheld totals when the application queue fails, and the combined holds count.
- A5: leaving the applicant `INSERT` policy and the duplicate `SELECT` policy for later
  decisions.
