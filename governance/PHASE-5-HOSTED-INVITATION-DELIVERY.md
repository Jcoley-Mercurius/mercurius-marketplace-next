# Phase 5 — Hosted provider invitation delivery (TRACE-071)

**Status:** IMPLEMENTED on branch `codex/phase5-hosted-invitation-delivery`, based on
`main` `6bdcff3` (PR #25, TRACE-063 forward fix, merged). Awaiting Codex code review.
Merging is not phase acceptance, hosted activation or production activation.

**Authorization:** owner instruction 2026-09-12: implement the next Phase 5 item, hosted
invitation delivery. Owner decisions 2026-09-13: the Auth email-link lifetime is 3 hours
(onboarding needs longer than the 1-hour default); the recipient link must be one mail
scanners cannot burn; the new variables are added to the MTS environment contract; the
hosted SMTP/Resend connection is owner work tracked separately and is not attempted here.

The instruction covers repository work only. Setting hosted secrets, deploying the
function, changing hosted Auth URL/template/SMTP settings and sending any real invitation
are external actions that still need explicit owner authorization. None was performed.
The design decisions below were taken during implementation and are recorded for review,
not presented as pre-approved.

## Gap

TRACE-063 shipped `vendor-invite` so that it could not send real mail: `send` returned
`503 INVITATION_DELIVERY_DISABLED` unless `MERCURIUS_INVITATION_MODE=local-test`, a
loopback Supabase and a loopback site were all present. Every invitation document since
then lists hosted delivery, mail templates and redirect allowlists as an open gate.

Characterizing the local stack for this slice also found that the earlier local
round-trips never exercised the invitation redirect: local Auth's allowlist was the CLI
default `https://127.0.0.1:3000`, so a `http://localhost:3000/set-password?invitation=…`
redirect fell back to the site root, silently dropping the attempt ID. The reviewed
template no longer depends on that redirect (D3a), and the local allowlist now contains
the entry.

The TRACE-063 link also went through Auth's verify URL, which any GET consumes: a mail
scanner that pre-opens links would burn a provider's invitation before they saw it.

## Contract

1. `supabase/functions/vendor-invite/delivery.ts` decides, before any Auth call, whether
   dispatch is on and which site root the recipient returns to. Anything other than a
   mode whose every condition holds returns `503 INVITATION_DELIVERY_DISABLED`, exactly as
   before. `local-test` is unchanged.
2. New mode `hosted` requires two pins that the owner sets when arming it, and both must
   agree with the environment the function actually runs in:
   - `MERCURIUS_INVITATION_PROJECT_REF`: a 20-character lowercase Supabase project ref.
     `SUPABASE_URL` must be exactly `https://<ref>.supabase.co` (no port or path).
   - `MERCURIUS_INVITATION_SITE_ORIGIN`: an HTTPS origin written as an origin (no
     trailing slash). `SITE_URL` must be that same origin with no path, query, fragment,
     credentials or explicit port, and must not be loopback or an IP literal.
3. The redirect is still built only from the checked site root:
   `<site>/set-password?invitation=<attempt>`. Caller-supplied `email`, `origin` or
   `redirect_to` fields remain ignored.
4. Reservation, provider-accepted receipts, unknown outcomes, the `422 email_exists`
   refusal, reconciliation and closure are unchanged and apply identically in both modes.
   `reconcile` and `refuse` read an account by exact ID and never invite, so they stay
   ungated, as before.
5. `supabase/templates/provider-invitation.html` is the reviewed invite email: MDS token
   colours, Geist with a system fallback, AA contrast, no remote asset or tracking pixel,
   a visible fallback address, and a statement that accepting does not activate the
   provider. Its link is
   `{{ .SiteURL }}/set-password?invitation={{ .Data.invitation_attempt }}&token_hash={{ .TokenHash }}&type=invite`
   — the project's own Site URL, never the Auth verify URL. `/set-password` already
   verifies `token_hash` with a POST, so a mail scanner's GET cannot consume the link.
6. `send` passes `data: { invitation_attempt }` to `inviteUserByEmail` so the template can
   name the attempt. It is read only while Auth renders the email and is not an
   authorization input: acceptance re-verifies the attempt, recipient and state in the
   database. The server-built `redirectTo` is still sent and unchanged.
7. `supabase/config.toml` mirrors the hosted settings locally: `site_url` is the site
   itself (what the template builds from), a 3-hour `otp_expiry`, the invite subject and
   template, and an allowlist entry for the redirect the handler still passes.
   `scripts/prepare-phase5-local.mjs` copies `supabase/templates` into the isolated stack.

No migration, RPC, table, grant, application page, operator panel, role, activation or
product rule changes.

## Decisions for review

- **D1 — two pins, not a mode flag alone.** Edge secrets are easy to copy between
  projects. Pinning the project ref and site origin means a copied secret set, a preview
  deployment or a stale `SITE_URL` fails closed instead of inviting real providers to the
  wrong site.
- **D2 — custom Auth domains fail closed.** None is configured. Supporting one is a
  deliberate change to `delivery.ts` and its tests.
- **D3 — site-hosted `token_hash` link (owner decision 2026-09-13).** The Auth verify URL
  is consumed by any GET, so a corporate mail scanner can burn an invitation before the
  provider opens it. The link now points at our own `/set-password`, which verifies by
  POST; this was proven locally (a GET caused no Auth request, and the token still
  verified afterwards, then refused reuse).
- **D3a — the attempt comes from invite metadata, not `{{ .RedirectTo }}`.** `.RedirectTo`
  was measured to be the Auth-validated redirect (a hostile origin was replaced with the
  Site URL), so it is safe, but on a misconfigured allowlist it degrades to a bare origin
  and `{{ .RedirectTo }}&token_hash=…` then renders a malformed link. That was observed
  during implementation. Building from `{{ .SiteURL }}` plus the metadata attempt is
  always well-formed and depends on one hosted setting (Site URL) rather than allowlist
  glob syntax.
- **D4 — no new user-facing error.** A misconfigured hosted mode shows the existing
  `INVITATION_DELIVERY_DISABLED` in the operator panel. The handler does not report
  which pin failed, so the response does not describe the deployment.

## Hosted arming runbook (owner-authorized external steps; not performed)

Perform these on the intended project only, after Codex review and merge, and record
evidence without credentials, tokens, real addresses or invitation links.

1. **SMTP.** Configure custom SMTP (MTS names Resend for transactional email) with a
   verified sending domain (SPF/DKIM). Supabase's built-in hosted mailer is documented as
   restricted to project team addresses and heavily rate-limited, so it cannot deliver
   provider invitations. Re-verify this against current Supabase docs at the gate.
2. **Auth URL configuration.** Set Site URL to the production site origin: the invitation
   email builds the recipient's link from it, so a wrong value sends providers elsewhere.
   Also add the redirect URL `https://<site-host>/set-password?invitation=*`, which covers
   the redirect the handler still passes.
3. **Invite template.** Set the invite subject to `Set up your Mercurius provider account`
   and paste the body from `supabase/templates/provider-invitation.html` at the merged
   commit. Do not run `supabase config push` for this: it pushes every Auth setting in the
   local file, including local-only URLs.
4. **Email link lifetime.** Set the email OTP/link expiry to 3 hours (10800 s), the owner
   decision of 2026-09-13, matching `supabase/config.toml`. It is independent of the
   operator-entered invitation expiry, which should be at least as long.
5. **Edge secrets.** Set `SITE_URL` to the site origin, `MERCURIUS_INVITATION_PROJECT_REF`
   to the project ref, `MERCURIUS_INVITATION_SITE_ORIGIN` to the site origin, then
   `MERCURIUS_INVITATION_MODE=hosted` last. Removing the mode disarms dispatch.
6. **Deploy** `vendor-invite` from the merged commit with `verify_jwt = true`.
7. **Acceptance.** With owner authorization, invite one synthetic application whose
   recipient is an owner-controlled mailbox. Verify: provider-accepted receipt, email
   received with the reviewed subject/body, link lands on `/set-password?invitation=<id>`,
   password setup hands off to `/invitation`, acceptance receipt recorded, link reuse
   refused, the link still valid after a mail scanner may have opened it, and a second invitation to an existing confirmed address records the
   `email_exists` refusal (re-verifying the hosted refusal contract). Then bind, or close
   and clean up, the synthetic records.

## Open questions and follow-ups

- **Settled 2026-09-13 — email link lifetime.** 3 hours, set locally and in the runbook.
  An operator-entered invitation expiry longer than 3 hours still outlives the email link;
  the same attempt cannot resend (the reservation forbids it, and `expired` closure waits
  for the invitation expiry), so the reissue path remains revoking the attempt with a
  reason and preparing a new one, after which Auth re-invites the same unconfirmed account
  (characterized in TRACE-063's refusal slice, not re-run hosted). Whether operators need
  a reviewed reissue command instead is still open.
- **Owner work, tracked separately.** Connecting Resend as the hosted SMTP sender, with a
  verified domain, is owner-operated and deliberately not attempted in this slice.
- A wrong hosted Site URL sends the recipient's link to the wrong origin. The runbook
  covers it; the code cannot check a setting it never sees.
- Mailbox delivery/bounce receipts from the SMTP provider remain a follow-up; a
  provider-accepted receipt still does not mean the mail was delivered.
- MTS §9 now lists the three invitation variables (owner decision 2026-09-13).
- Standing items: rejection-after-activation role policy; account deletion vs
  role/link audit rows; re-inviting unconfirmed existing accounts.
