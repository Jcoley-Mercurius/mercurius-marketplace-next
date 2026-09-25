# Phase 5 — Per-network limit on the public intake routes (TRACE-089)

**Status:** IMPLEMENTED on branch `codex/phase5-intake-ip-limit` from
`main` `3e4236c` (after PR #46, TRACE-088). Awaiting code review.
Merging is not phase acceptance or production activation. No hosted table, function, grant
or row has changed.

**Authorization:** DEC-2026-012 item 1 sets 5 accepted submissions per hour per client IP,
counted separately for each form. DEC-2026-013 item 2 deferred it until the path from
`mercuriusmarketplace.com` to Vercel was known. On 2026-09-24 the owner said the domain is
registered with GoDaddy and pointed straight at Vercel; DEC-2026-014 records that and the
implementation choices below.

## Path to the app (checked read-only, 2026-09-24)

- `mercuriusmarketplace.com` uses GoDaddy nameservers (`ns73`/`ns74.domaincontrol.com`).
  The apex resolves to `216.198.79.1` and `www` is a CNAME to `*.vercel-dns-017.com`. Both
  answer with `server: Vercel`, and the apex redirects to `www`. No proxy or CDN sits between
  the visitor and Vercel.
- The domain currently serves a static page titled "Mercurius Solutions – AI-Powered
  Marketplace for SWFL" (every other path is Vercel `NOT_FOUND`), not this app. This app's
  production deployments sit behind Vercel's login. Attaching the domain to this app is part
  of the hosted rollout ([HOSTED-MIGRATION-ROLLOUT.md](HOSTED-MIGRATION-ROLLOUT.md)).

With DNS pointing straight at Vercel, Vercel's edge terminates the connection and sets
`x-real-ip` to the connecting address, replacing any value the client sent. That is the
same header `ipAddress()` in `@vercel/functions` reads.

## Contract

Migration `20260924005000_intake_ip_limit.sql` (additive; the TRACE-088 migration is unchanged):

- Adds nullable `private.intake_submissions.ip_hash` (64 lowercase hex characters) and a
  partial index on `(form, ip_hash, created_at)`.
- Replaces `intake_record_submission(p_form, p_email_hash) returns boolean` with
  `intake_record_submission(p_form, p_email_hash, p_ip_hash) returns text`. It has the same
  privileges (only `service_role`), the same `SECURITY DEFINER` setting and the same empty
  `search_path`. It validates the network key when present (22023) and locks the email key,
  then the network key. It prunes rows older than a day. It returns `email_limit` at 3 per
  email per form per day, then `ip_limit` at 5 per network per form per hour. Otherwise it
  records both keys and returns `accepted`. A null network skips the network limit. A
  refusal records nothing.

`src/lib/intakeProtection.ts`:

- `intakeClientIp(headers)` returns `x-real-ip` when `VERCEL=1` and the value is a single
  valid IPv4 or IPv6 address; otherwise null.
- `intakeNetwork(ip)` returns the IPv4 address, the IPv6 `/64` prefix, or the IPv4 address
  inside an IPv4-mapped IPv6 address. `intakeNetworkHash` is its SHA-256.
- `recordIntakeSubmission(supabase, form, email, ip)` returns the outcome and throws on a
  database error or an unexpected result.

Both routes pass `intakeClientIp(request.headers)` and log the outcome as the refusal
reason. The response is the same 429 as every other refusal.

## Decisions made during implementation (DEC-2026-014)

1. **`x-real-ip`, trusted only on Vercel.** Off Vercel (local, CI) the client controls the
   header, so it is ignored and only the per-email limit applies.
2. **IPv6 is counted by `/64`.** One IPv6 host usually holds a whole `/64`, so counting
   single addresses would let one sender rotate freely.
3. **An unknown IP skips the network limit,** rather than sharing one bucket
   (DEC-2026-013 rejected a shared bucket).
4. **Hashed with SHA-256, unkeyed,** like the email key (DEC-2026-013 item 5). An IPv4 hash
   can be reversed by trying every address, so this is pseudonymization, not anonymization.
   Rows are deleted within a day.
5. **The email limit is checked first,** so a sender over both limits is logged as
   `email_limit`.
6. **No `@vercel/functions` dependency.** It would read the same header.

## Hosted deployment order

Unchanged from TRACE-088: the migration must be applied before the routes are deployed.
Deploying first would call a function signature that does not exist, and every intake
submission would return 500. See the rollout plan.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-089--per-network-intake-limit--2026-09-24).

## Open items

- **Code review** (F1–F5) and CI on the branch.
- **Hosted acceptance:** after the domain is attached to this app, confirm in production
  logs that `x-real-ip` is present, then confirm a sixth submission within an hour from one
  network is refused.
- **Turnstile:** DEC-2026-013 item 1's condition "per-IP limit still deferred at launch" no
  longer applies. Turnstile returns only if intake spam is observed.

## Review questions

- F1: trusting `x-real-ip` only when `VERCEL=1` (decision 1).
- F2: the `/64` network and the IPv4-mapped handling in `intakeNetwork`.
- F3: lock order and outcome precedence in `intake_record_submission` (decision 5).
- F4: replacing the two-argument function rather than keeping it alongside.
- F5: suite 056 and the network race added to the concurrency script.
