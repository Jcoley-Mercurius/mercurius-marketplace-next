# Hosted migration rollout — proposed plan

**Status:** PROPOSED; awaiting owner approval. **Date:** 2026-09-24 UTC.
Nothing in this plan has been performed. Each hosted step below needs explicit owner
authorization for that action (AGENTS.md, "Required working behavior").

## Observed state (read-only checks, 2026-09-24)

- Linked Supabase project `vugqqyemuptlvcieihww`: the last applied migration is
  `20260731172714`. **77 local migrations are not applied**, `20260808120000` through
  `20260924004000` (TRACE-088, PR #46); TRACE-089 adds a 78th, `20260924005000`. This
  covers Phases 1–5 work since August, not only the intake slices.
- Latest Production deployment recorded on GitHub: `735df91` (2026-09-04, PR #5 merge),
  105 commits behind `origin/main`. That commit already contains 32 of the 77 pending
  migrations, so that deployment is probably running ahead of its database. Every
  deployment of this app sits behind Vercel's login, so the public cannot reach it.
- `mercuriusmarketplace.com` (GoDaddy DNS pointing at Vercel) serves a separate static page
  ("Mercurius Solutions – AI-Powered Marketplace for SWFL"), not this app. The public site
  is therefore unaffected by the migration backlog. Moving the domain onto this app is a
  rollout step of its own.
- 62 pending migrations add constraints or alter columns, and 53 update or insert
  existing rows. They have run only against synthetic local data and CI, never against
  production rows.
- `main` adds `MERCURIUS_MONEY_MODE` and the three `MERCURIUS_INVITATION_*` variables.
  Leaving them empty keeps money and invitation dispatch in their safe default modes.

## Ordering conflict

Neither "migrate first" nor "deploy first" is clean:

- Live `735df91` inserts contact submissions with the anonymous key; `20260924003000`
  (TRACE-087) revokes that, so migrating first breaks `/contact` until the deploy.
- `main` calls the intake-limit function from `20260924004000` (TRACE-088; replaced by
  `20260924005000` in TRACE-089), so deploying first makes `/contact`, `/request` and `/vendors/apply` fail until the migration.

The plan keeps that window to the seconds between the push and a Vercel promote.

## Proposed steps

1. **Merge gate.** Merge TRACE-088 and TRACE-089 (or pick the rollout commit explicitly) so the
   rollout commit and its migration set are fixed. Record the commit SHA here.
2. **Backup.** Confirm point-in-time recovery or take a fresh backup of
   `vugqqyemuptlvcieihww` from the dashboard. Record the restore point.
3. **Rehearsal (recommended).** Restore that backup into a separate, non-production
   Supabase project (or a Supabase branch). Run `supabase db push` there and the pgTAP
   suites against it. This is the only way to find constraint or data-migration failures on
   real rows before production. Rehearsal data stays hosted; nothing is exported to source,
   fixtures or chat.
4. **Dry run.** `supabase db push --linked --dry-run` against production; confirm the list
   is exactly the 78 expected files.
5. **Prepare, don't promote.** Build the rollout commit as a Vercel deployment with
   production environment variables, not promoted. Set the four new variables empty.
6. **Push.** `supabase db push --linked` in a low-traffic window.
7. **Promote** the prepared deployment immediately after the push succeeds.
8. **Attach the domain.** Move `mercuriusmarketplace.com` and `www` from the static page's
   Vercel project to this app's project, with owner authorization. DNS at GoDaddy does not
   change, because both are Vercel projects.
9. **Smoke checks** on production: `/contact`, `/request`, `/vendors/apply` (one owner test
   submission each, then close it as abandoned), sign-in, and the vendor and admin portals
   loading. Check Vercel and Supabase logs for errors, and that `x-real-ip` reaches the
   routes (TRACE-089).
10. **Record** the push output, the promoted deployment, and the smoke results in
   `PHASE-5-VALIDATION.md` and the handoff.

**If the push fails part-way:** Supabase applies each migration in its own transaction, so
a failure stops at that file with earlier files applied. Do not promote. Leave the live
deployment in place, capture the error, and write a forward-fix migration. Restoring the
backup is the last resort, because it discards anything written since.

## Decisions needed from the owner

- A. Approve this order, or name a different one.
- B. Rehearsal on a restored copy: yes/no, and which project to use.
- C. The rollout commit: `main` after TRACE-088 and TRACE-089 merge, or another.
- D. Authorization and a time window for steps 4–9 against `vugqqyemuptlvcieihww` and
  the Vercel production project.
- E. When to replace the static page on `mercuriusmarketplace.com` with this app (step 8),
  in the same window or later.

## Out of scope

Activation gates (hosted invitations, money mode, cron, provider cutover) stay separate
owner decisions.
