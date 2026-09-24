# Phase 5 — Removal of the direct applicant insert path to applications (TRACE-086)

**Status:** MERGED as PR #43 on 2026-09-24 13:23 UTC (main `1d8a27e`).
Implemented from branch `codex/phase5-application-insert`, based on `da64e4d`.
Final-head and post-merge main CI passed. Code review and Phase 5 acceptance remain
open. No hosted policy, grant or row has changed.

**Authorization (2026-09-24):** the owner chose option A of four presented: drop the
applicant `INSERT` policy on `vendor_applications` and revoke the `INSERT` grants from `anon`
and `authenticated`, so the application route is the only way to create an application.
Rejected: narrowing the policy to the form's columns (B), recording the risk and leaving it
(C). Deferred: rate limiting or a bot check on the route (D), as its own slice if spam
through the form becomes a problem.

## Gap

TRACE-085 left `Anyone can submit vendor application` open because its revocation was not
approved. The policy (2026-03-16, last replaced 2026-07-31) lets any anonymous or signed-in
client insert a pending, uninvited row, backed by `INSERT` grants to `anon` and
`authenticated`. A direct insert skips the route's validation, the owner notification email
and the signed upload grant, and may set any column the policy does not check, including
`document_urls`. The admin notification trigger still fires, so the row appears in the admin
queue as a pending application with no uploaded documents.

## Characterized before change

Read from a clean local reset of `main` `da64e4d`:

- `vendor_applications` policies: admin `SELECT`, and the applicant `INSERT` (`anon`,
  `authenticated`), which checks field lengths, an email pattern, a service count, and
  `status = 'pending'`, `invite_status = 'not_invited'` and null `contractor_id`,
  `invited_user_id` and `activated_at`. Grants: `anon` `INSERT`; `authenticated` `SELECT`,
  `INSERT`; both hold `INSERT` on all 32 columns.
- Through the local REST API an anonymous insert of a synthetic row returned 201 with a
  `document_urls` entry naming another application's folder. TRACE-084 retention refuses such
  a path (its records require the application's own prefix), but an admin reviewing the row
  would see it listed.
- **Nothing in the application uses the direct path.** `/vendors/apply` posts to
  `/api/vendor-applications`, which inserts with the service key. No other browser code, Edge
  Function or `SECURITY INVOKER` function inserts into `vendor_applications`. Test and script
  fixtures insert as the database owner.

## Contract

Migration `20260924002000_vendor_application_applicant_insert.sql`:

- drops `Anyone can submit vendor application`;
- revokes `INSERT` on `vendor_applications` from `anon` and `authenticated`, which also
  removes every column-level `INSERT`.

Unchanged: admin `SELECT`, `service_role` privileges, the application and document routes,
the admin notification and intake version triggers, and `contact_submissions`, whose
anonymous insert grant has the same shape but was outside the decision. Together with
TRACE-085, no client role can insert, update or delete an application row.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-086--removal-of-the-direct-applicant-insert-path--2026-09-24).

## Decisions made during implementation

1. **Grants revoked as well as the policy,** as in TRACE-085, so a later permissive policy
   cannot reopen the path silently.
2. **Suite 052's assertion that the applicant policy was unchanged now asserts its
   removal.** No other suite changed.
3. **No `next dev` round trip.** The route's code is unchanged and needs only the service
   key's `INSERT`, which suite 053 and a REST call cover. A local run would load `.env.local`,
   whose provider keys were not inspected, and could send a real notification email.

## Open items

- **Code review** (B1–B4 below). Final-head and post-merge CI passed.
- **Hosted acceptance:** the migration applies to a hosted project only with owner
  authorization. Before it does, confirm no external form, integration or script inserts
  applications with the anonymous or a user key.
- **Abuse protection on the route** (option D) remains a possible later slice; the route has
  no rate limit or bot check today.
- **`contact_submissions`** keeps its anonymous insert; any change needs its own decision.
- Carried from TRACE-085: application-row deletion and the duplicate admin `SELECT` policy on
  `vendor-documents`.

## Review questions

- B1: revoking both roles' grants rather than only `anon`'s.
- B2: that no client, Edge Function or integration depends on the removed privilege (A2 for
  inserts).
- B3: suite 053's coverage, including the service-key insert still notifying admins and
  recording the intake version.
- B4: leaving `contact_submissions` and route abuse protection to later decisions.
