# Phase 5 — Route-only contact submissions and the duplicate document read policy (TRACE-087)

**Status:** IMPLEMENTED on branch `codex/phase5-contact-insert`, stacked on the checkpoint
branch `codex/phase5-trace086-status` (PR #44, which carries DEC-2026-012), itself on `main`
`1d8a27e`. Awaiting code review. Merging is not phase acceptance or production activation.
No hosted policy, grant or row has changed.

**Authorization (2026-09-24):** DEC-2026-012 items 2 and 4. The owner chose to make the
contact route the only writer to `contact_submissions`, as TRACE-086 did for applications,
and to drop the identical `Admins can review vendor application documents` read policy.
Rejected: keeping the length-checked anonymous policy, and keeping both read policies.

## Gap

`Anyone can submit contact form` (2026-06-02) let any anonymous or signed-in client insert a
contact submission directly, backed by `INSERT` grants to `anon` (the 2026-09-03 Phase 2
intake grant) and `authenticated` (the Phase 2 blanket grant). The policy checks field lengths
and an email pattern. A direct insert skips the route's trimming and email normalization, the
request context it appends and the owner notification email.

`vendor-documents` carried two admin `SELECT` policies with the same condition:
`Admins can read vendor documents` (2026-07-31) and `Admins can review vendor application
documents` (2026-08-09, created only if missing by name). TRACE-085 left the duplicate.

## Characterized before change

Read from the migrations and application code on `main` `1d8a27e`, and confirmed against the
local database after the change (the unchanged grants and policies):

- `contact_submissions` has 8 columns and two policies: the anonymous `INSERT` above and
  `Admins can view submissions` (`SELECT`). Grants: `anon` `INSERT`; `authenticated`
  `SELECT`, `INSERT`, `UPDATE`, `DELETE`. No policy permits `UPDATE` or `DELETE`, and no
  trigger is defined on the table.
- **The only writer is the contact route.** `/contact` and `/request` post to
  `/api/contact-submissions`, which validated the body and then inserted with the anonymous
  key, so it relied on the policy. No Edge Function, `SECURITY INVOKER` function or other
  browser code inserts into the table.
- Both `vendor-documents` read policies are `SELECT` to `authenticated` with
  `bucket_id = 'vendor-documents' AND has_role(auth.uid(), 'admin')`. Suite 052 asserts the
  first by name; nothing references the second.

## Contract

Migration `20260924003000_contact_submission_insert.sql`:

- drops `Anyone can submit contact form`;
- revokes `INSERT` on `contact_submissions` from `anon` and `authenticated`, which also
  removes every column-level `INSERT`;
- drops `Admins can review vendor application documents` on `storage.objects`.

`src/app/api/contact-submissions/route.ts` creates its client with the service key
(`getServiceSupabaseEnvironment`, already required by the application route) instead of the
anonymous key. Validation, request context, response codes and the post-response owner
notification are unchanged.

Unchanged: `Admins can view submissions`, `authenticated` `SELECT`, `service_role` privileges,
the contact and request pages, and `Admins can read vendor documents`. Admins read the same
objects as before.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-087--route-only-contact-submissions--2026-09-24).

## Decisions made during implementation

1. **Grants revoked as well as the policy,** as in TRACE-085 and TRACE-086, so a later
   permissive policy cannot reopen the path silently.
2. **The later copy of the read policy is dropped.** Suite 052 already asserts the earlier
   one by name, and suite 054 asserts exactly one client read policy remains on the bucket.
3. **Suite 053's assertion that the contact insert grant was unchanged now asserts its
   removal.** No other suite changed.
4. **`authenticated` keeps its unused `UPDATE` and `DELETE` grants on `contact_submissions`.**
   No policy permits either, so RLS refuses them; revoking them was outside the decision.
5. **Round trip through a production build,** not `next dev`. Turbopack's dev server in this
   environment answered 404 for every API route, including unchanged ones, while pages
   answered 200. The built app served the route normally. Every variable `.env.local` names was
   overridden with local-stack values and the Resend variables were unset, so no hosted
   project or email provider was reachable.

## Hosted deployment order

The route change must be deployed **before** the migration is applied to a hosted project.
Applied first, the migration would make the deployed route's anonymous insert fail with
42501, and every contact and request-form message would return 500. The hosted environment
must also have `SUPABASE_SERVICE_ROLE_KEY` configured; the application route already requires
it.

## Open items

- **Code review** (D1–D4 below) and CI on the branch.
- **Hosted acceptance:** deploy the route first, then apply the migration with owner
  authorization. Before it applies, confirm no external form, integration or script inserts
  contact submissions with the anonymous or a user key.
- **Abuse protection** on both public routes is DEC-2026-012 item 1, a separate slice.
- The unused `authenticated` `UPDATE`/`DELETE` grants on `contact_submissions` (decision 4).

## Review questions

- D1: revoking both roles' grants rather than only `anon`'s.
- D2: that no client, Edge Function or integration depends on the removed privilege.
- D3: the deployment order above, and whether it needs a guard beyond documentation.
- D4: suite 054's coverage, including the single remaining client read policy on
  `vendor-documents`.
