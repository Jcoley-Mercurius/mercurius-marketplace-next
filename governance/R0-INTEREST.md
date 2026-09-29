# R0.2 interest, consent, linkage and retention — TRACE-102

**Branch:** `codex/r0-interest`, stacked on R0.1 `codex/r0-admission` (`5e31d55`).
**Status:** implementation checkpoint for independent review. No hosted schema, email, deployment, domain, scheduler or admission change.
**Governing contract:** [layered launch decision](LAYERED-LAUNCH-DECISION.md) §R0 homeowner contract; CFG-014; MPS/MTS/MDS R0 addenda. The founder's companion early-access experience artifact is still not in this checkout; exact copy and state designs remain a TRACE-103 gate. Server messages here are provisional.

## Characterized baseline

No interest, consent or suppression record existed. `coverage_areas.has_waitlist` is a coverage flag only. The `beta-access` Edge Function is an unrelated site-access code gate. Public writes (`/api/contact-submissions`, `/api/vendor-applications`) use the TRACE-088/089 honeypot, fill-time and per-email/per-network limits, and a service-key client whose key holds no table privilege.

## Change and trust boundary

Migration `20260929001000_r0_interest_consent.sql` adds seven private tables (no privilege for `anon`, `authenticated` or `service_role`) and database commands:

| Caller | Commands | Boundary |
|---|---|---|
| Public route (service key) | `r0_zip_in_lee`, `r0_submit_interest`, `r0_manage_interest`, `r0_unsubscribe_marketing` | Route honeypot/fill time; `early_access` joins the existing 3-per-email-per-day and 5-per-network-per-hour limits |
| Future sender (service key) | `r0_issue_link_token`, `r0_email_allowed`, `r0_record_email_suppression` | Nothing in this slice sends mail |
| Signed-in account | `r0_my_interest`, `r0_save_my_interest`, `r0_withdraw_my_interest`, `r0_set_my_marketing` | Confirmed Auth email required; own linked rows only |
| R0 operator (TRACE-101 roster + admin) | `r0_record_r2_opening`, `r0_set_interest_hold`, `r0_run_interest_retention`, `r0_interest_retention_status` | Admin role alone is insufficient; the service key may also run retention |

- **Minimal collection:** email, five-digit ZIP, services *or* still exploring, optional first name. The route refuses any other field, so phone, address, photo, payment or SMS input cannot be stored.
- **Early access and expansion:** early access requires one of the private Lee ZIPs; a separate expansion kind accepts only other ZIPs. A mismatch returns an honest boundary outcome before a rate-limit slot is spent and saves nothing. Neither kind grants admission, request, checkout or Credits.
- **Deduplication and anti-enumeration:** at most one live interest per kind per email, and per kind per account. The anonymous form never changes an existing interest, including a withdrawn one kept by a hold, and returns the same `saved` answer either way.
- **Independent consent:** marketing consent is an explicit boolean, stored separately and only while opted in (an opt-out keeps a hash, never the address). An anonymous form cannot lift an earlier unsubscribe; a verified account holder can. Nothing lifts an `all` suppression.
- **Linkage:** a confirmed account links unlinked interests carrying its current email. If the account already holds that kind, the unheld email-matched duplicate is removed and the merge audited. Unconfirmed accounts link nothing.
- **Update and withdrawal:** email links carry a random 256-bit token (stored as SHA-256, 90-day expiry). A manage link reads, updates or withdraws exactly one interest; an account holder uses the account commands. Withdrawal de-identifies immediately unless a legitimate hold applies. Account deletion removes the linked interest.
- **Email classification:** `r0_email_allowed` permits early-access status mail only for a live interest without an `all` suppression, and marketing only for a current opt-in with no suppression. Promotional unsubscribe (RFC 8058 one-click compatible) is separate from early-access withdrawal.
- **Retention:** the operator records the actual R2 broad-booking opening once, never in the future. Each retention pass de-identifies a withdrawal whose hold has ended at any time (linked or not) and every unheld list-only interest once R2 + 90 days has passed; live account-linked and held interests stay. Every pass, including before R2, writes a run record, and `r0_interest_retention_status` reads back the R2 event, due date, counts and last pass. De-identification clears email, hash, first name and account link and deletes link tokens; kind, ZIP, services and dates remain for aggregate demand.
- **Audit:** `r0_interest_events` records joins, links, merges, updates, withdrawals, holds, consent changes and de-identification without any email.

## Verification — isolated R0 stack, 2026-09-28

Host memory and swap were exhausted, so no new stack was started. The existing isolated R0 stack (ports 5642x, R0.1 migrations applied) was used without committing anything: each run applied the R0.2 migration and one test file inside a single transaction and rolled it back.

- SQL `069_r0_interest_consent.sql`: **140/140**. Covers least privilege for all seven tables and every command, absence of uncollected fields, boundary, content rules, deduplication, anti-overwrite, consent independence, unsubscribe and idempotency, suppression scopes, manage read/update/withdraw, holds, pre-R2 and post-R2+90 retention, observability, verified and unverified linkage, merge, cross-account isolation, account opt-in/out, account deletion, email-free audit and the limiter form.
- Full SQL suite with the R0.1 `5e31d55` fix plus R0.2: **59 files, 3410 assertions, 0 failures, 0 errors** (3270 existing + 140 new). A per-file comparison against R0.1 alone shows no change to any existing file.
- `scripts/r0-interest-concurrency.mjs` (added to CI after the intake-limit step): 8 parallel joins create one interest, one consent record and one join event; parallel unsubscribes and form opt-ins leave the address unsubscribed; account linkage racing anonymous joins leaves one linked identity; a withdrawal racing six operator/service retention passes de-identifies once and records six passes; no Cron job is active. It commits synthetic fixtures, so it runs only in CI's disposable stack. **Local run not possible** without committing to the shared R0 stack; CI result pending.
- Unit: `tests/unit/early-access.test.ts` covers strict fields, normalization, consent explicitness, honeypot/fill time, boundary-before-limit, identical limit refusals, generic manage/unsubscribe answers and error mapping. 19 unit files **295/295**; `tsc --noEmit` clean; ESLint clean on changed files.
- Not yet run: blank `supabase db reset` replay of this branch (CI performs it), `supabase db advisors`, direct REST/route integration against a running Next server.

## Open gates and decisions

1. **Companion experience artifact** (owner): exact copy, confirmation, boundary and withdrawal wording, and the waiting/account states for TRACE-103.
2. **Confirmation and status email** (owner/R0.4–R0.5): this slice mints link tokens and classifies mail but sends nothing. Delivery, sender, footer and Resend bounce/complaint wiring to `r0_record_email_suppression` need their own slice and external-action authorization.
3. **Double opt-in** (owner): the approved contract asks for an unchecked, independent choice; it does not say whether form consent needs email confirmation before promotional mail. Recorded as single opt-in with source `early_access_form` until decided.
4. **Expansion-interest retention** (owner): expansion interest is treated as list-only interest and follows R2 + 90 days. Confirm, or set a separate period tied to an expansion decision.
5. **Retention scheduling** (R0.5/R2 operations): the command is callable by an operator or the service key; no schedule is created. A pg_cron or worker schedule needs its own authorization.
6. **Account email change:** a linked interest keeps the email it was linked with until the holder saves it. A second account later confirming that old address cannot link or save the same kind (unique identity); this fails safely, and an operator/privacy path resolves it.

## Rollback

Code: redeploy the previous build; the routes disappear and the tables stay untouched. Database: the migration is additive (new private tables and functions, one widened constraint and limiter form list). Once applied, roll forward by revoking the new command grants in a reviewed migration; do not drop tables holding consent or suppression records without an owner retention decision.
