# Provider invitation link valid for the whole invitation (DEC-2026-029 follow-up)

**Status:** PROPOSED for Codex architecture review. Nothing is implemented. Owner instruction
2026-10-13: the link in the provider invitation email must work for the whole invitation
(7 days by default), using a Mercurius-owned link ("option 1"). Hosted Auth caps its own
email link at 24 hours (DEC-2026-029), so the Auth link cannot be stretched to match.

## Characterized today (`main` `283cfe5` plus DEC-2026-029)

- `vendor-invite` claims the attempt, then calls `auth.admin.inviteUserByEmail` with
  metadata `{ invitation_attempt, invitation_kind?, business_name? }`. Auth creates the
  unconfirmed user and sends the reviewed template through Resend SMTP. A 422
  `email_exists` is a definite refusal; any other error leaves the attempt `unknown`
  (never retried). Success records the receipt (`provider_accepted`).
- The template link is `/set-password?invitation=<attempt>[&kind=existing_provider]&token_hash=<TokenHash>&type=invite`.
  `/set-password` verifies `token_hash` from the browser after load, so a mail scanner's GET
  cannot spend it. The token dies with the Auth email link (24 hours).
- After the password is set the browser goes to `/invitation?attempt=…`, which re-verifies
  the attempt server-side and records acceptance. Both paths (application invitations,
  TRACE-063/066; existing-provider access, TRACE-105) share the template and this flow.

## Proposal

Keep Auth's invite call, its refusal contract and its email. Change only what the email
link points to, and mint a fresh Auth sign-in when the provider uses it.

1. **Open key per attempt.** At dispatch, `vendor-invite` generates a 256-bit random key,
   stores only its SHA-256 on the attempt (new nullable `open_key_hash` on
   `vendor_invitation_attempts` and `private.r0_provider_access_attempts`, written by the
   claim RPC so it exists before Auth sends anything), and passes the key to Auth as invite
   metadata `invitation_key`.
2. **Template link** becomes
   `{{ .SiteURL }}/invitation/open?invitation={{ .Data.invitation_attempt }}[&kind=existing_provider]&key={{ .Data.invitation_key }}`.
   `{{ .TokenHash }}` is no longer used.
3. **`/invitation/open` page.** A GET renders the business context and one "Continue to set
   your password" button; nothing is spent on GET (mail-scanner safe, as today).
4. **`POST /api/invitations/open`** (Next route, service key): a `SECURITY DEFINER`
   function checks, under the attempt's lock, that the key hash matches, the attempt is
   `submitted` with a `provider_accepted` dispatch, it is before `expires_at`, and it has
   no acceptance or closure. It returns the recipient Auth user. The route then calls
   `auth.admin.generateLink({ type: "magiclink", email })` (sends no email) and answers with
   `/set-password?invitation=…[&kind=…]&token_hash=<hashed_token>&type=magiclink`.
   Every refusal returns one generic "This invitation link is no longer valid" plus the
   existing contact path; the reason is logged, never the key.
5. **`/set-password`** accepts `type=magiclink` alongside `invite`; the rest of the flow
   (password, `/invitation` acceptance) is unchanged.
6. **Clean-up.** On acceptance, remove `invitation_key` from the user's metadata. The
   lapsed-link attention reason (`link_lapsed`) is retired for attempts with an open key,
   since the link now lives as long as the invitation; `expired` still applies.
7. **Limits.** The key makes guessing infeasible; add a per-attempt cap (for example 10
   opens per hour) so a forwarded email cannot be used to mint sessions in a loop.

## Decisions for review

- **Key in Auth metadata.** The plaintext key sits in `auth.users.raw_user_meta_data`
  until acceptance, readable by the recipient and by service-role/database admins. It only
  opens that one recipient's own invitation. The alternative is Mercurius sending the
  invitation email itself (`generateLink({ type: "invite" })` plus Resend), which keeps the
  key out of the database but changes the reviewed dispatch contract (TRACE-063/071).
- **Magic link for an invited, unconfirmed user.** `generateLink("magiclink")` on a user
  created by `inviteUserByEmail` must be verified locally before relying on it (expected:
  verifying confirms the email and signs in).
- **Opens after the password is set but before acceptance** (for example, the provider
  closed the tab): allow, so the provider can finish; acceptance stays single-use.
- **Already-sent invitations** keep their 24-hour Auth links; only new dispatches use the
  open link.

## Hosted work (owner-authorized, after review and merge)

Additive migration; deploy `vendor-invite`; paste the updated template into Auth (subject
unchanged); deploy the site. No new secrets or Auth settings.

## Acceptance evidence to produce

SQL tests for the key hash, check function, lock and limit; Edge runtime cases for key
creation and metadata; unit and browser tests for `/invitation/open` (GET spends nothing,
POST redirects, expired/accepted/wrong key refused with one message); a local Auth
round-trip on day 2 of an invitation (Auth link expired, open link still signs in);
mutation check on the guards.
