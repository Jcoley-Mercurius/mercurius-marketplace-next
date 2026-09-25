# Phase 5 — Abuse protection on the public intake routes (TRACE-088)

**Status:** IMPLEMENTED on branch `codex/phase5-intake-abuse` from `main` `0d47134` (after
PR #45, TRACE-087). Awaiting code review. Merging is not phase acceptance or production
activation. No hosted table, function, grant or row has changed.

**Authorization (2026-09-24):** DEC-2026-012 item 1, as settled by DEC-2026-013. Both public
forms get a hidden honeypot field, a minimum fill time of 3 seconds and a limit of 3
accepted submissions per email address per rolling day, counted separately for each form,
in a private Postgres table only the service-key routes can use. Every refusal gets the same
HTTP 429. DEC-2026-013 keeps Turnstile out at launch (recording the MTS impact), defers the
per-IP limit until the production domain's proxy path is known, and settles the
implementation choices below.

## Gap

`/api/vendor-applications` (used by `/vendors/apply`) and `/api/contact-submissions` (used
by `/contact` and `/request`) accepted any valid submission with no limit, honeypot or timing
check. Each accepted submission stores a row and emails the owner; each application can also
issue several signed upload grants. A script could fill the review queue and the owner's
inbox.

## Characterized before change (`main` `0d47134`)

- Both routes are `runtime = "nodejs"`, parse JSON, validate, insert with the service key
  (TRACE-086/087) and notify the owner with `after()`. Neither read request headers or
  applied any limit.
- The contact route reads a flat body; the application route reads
  `{ application, documents }`. Unknown top-level fields are ignored by both.
- `/contact` renders its form only in the browser (inside `Suspense` with
  `useSearchParams`); `/request` and `/vendors/apply` are client components that build the
  request body from React state.
- The `private` schema exists (Phase 1 matching engine) with `USAGE` revoked from `PUBLIC`
  and is not exposed by the API, so the routes reach it through a `public` function.

## Contract

Migration `20260924004000_intake_submission_limits.sql`:

- `private.intake_submissions (id, form, email_hash, created_at)`, `form` in
  (`contact`, `vendor_application`), `email_hash` 64 lowercase hex characters; row level
  security on, no policy; all privileges revoked from `public`, `anon`, `authenticated` and
  `service_role`.
- `public.intake_record_submission(p_form, p_email_hash) returns boolean`,
  `SECURITY DEFINER` with an empty `search_path`, executable only by `service_role`. It
  validates both arguments (22023), takes a transaction advisory lock on the form and key,
  deletes rows older than a day, and returns false when the key already has 3 rows for the
  form in the last day; otherwise it records the submission and returns true.

`src/lib/intakeProtection.ts`:

- `intakeGuardRefusal(intake)` refuses a honeypot that is not an empty string (`trap`), and a
  missing, non-numeric, non-finite or under-3-second `elapsedMs` (`too_fast`).
- `intakeEmailHash(email)` is SHA-256 of the trimmed, lower-cased email.
- `recordIntakeSubmission(supabase, form, email)` calls the function with the hash and throws
  on a database error.

Both routes: parse the body; refuse on the guard; validate (400 as before); record against
the limit; then insert and notify as before. Each refusal returns
`429 { error: "Please try again later." }` and logs the reason, never the email.

`src/components/marketing/IntakeGuard.tsx`: `useIntakeGuard()` records `performance.now()`
when the form mounts and returns `intakePayload()` → `{ trap, elapsedMs }`;
`IntakeTrapField` renders an `sr-only` wrapper with `aria-hidden="true"` around a labelled
text input named `company_fax` with `tabIndex={-1}` and `autoComplete="off"`. `/contact`,
`/request` (service-area interest submission) and `/vendors/apply` render the field and send
`intake` with their request. Nothing visible changes.

## Evidence

See [validation](PHASE-5-VALIDATION.md#trace-088--intake-abuse-protection--2026-09-24).

## Decisions made during implementation

1. **Elapsed time, not a timestamp.** The browser sends how long the form was open, measured
   with its own monotonic clock, so a browser clock that runs fast cannot cause a refusal.
   It is still trusted, as DEC-2026-013 item 6 accepts.
2. **Honeypot and fill time are checked before validation,** so a bot gets the generic 429
   rather than field-level messages. The email limit is checked after validation, so only a
   valid submission can use an allowance.
3. **A slot is recorded just before the insert.** If the insert then fails (500), the slot
   stays used. This needs a database failure between two statements; making it atomic would
   need each route's insert inside the function.
4. **A missing honeypot counts as filled.** A page loaded before this change and submitted
   after deployment is refused once with 429; reloading fixes it.
5. **The one-day filter in the count is kept** although the prune just before it makes it
   redundant (the equivalent mutant in the evidence). It keeps the count correct if the
   prune is later moved out of the function.
6. **The concurrency script takes `PHASE5_DB_CONTAINER`** so it could run against this
   checkout's database while the isolated container was in use. CI uses the default.

## Hosted deployment order

The migration must be applied to a hosted project **before** the routes are deployed, the
reverse of TRACE-087. Deployed first, the routes would call a function that does not exist
and every contact, request-form and application submission would return 500. The migration
alone does not change the current routes.

## Open items

- **Code review** (E1–E6 below) and CI on the branch.
- **Per-IP limit** (5 per hour per form) once the production domain's proxy path, and so the
  trusted client-IP header, is known (DEC-2026-013 item 2). The table and function take an IP
  key in a later additive migration.
- **Turnstile** stays out unless intake spam is observed or the per-IP limit is still
  deferred at launch (DEC-2026-013 item 1).
- **Hosted acceptance:** apply the migration, then deploy, with owner authorization.
- Limits on the document finalize route and renewal uploads are not part of this decision.

## Review questions

- E1: the refusal order (guard, validation, limit) and one 429 for every refusal.
- E2: the advisory lock and prune-on-write in `intake_record_submission`, and its privileges.
- E3: trusting the browser's elapsed time and treating a missing honeypot as filled
  (decisions 1 and 4).
- E4: the slot recorded before the insert (decision 3).
- E5: suite 055 and the concurrency script's coverage.
- E6: the deployment order above.
