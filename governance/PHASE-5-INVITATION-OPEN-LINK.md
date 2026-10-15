# Provider invitation link valid for the whole invitation (TRACE-107, DEC-2026-029)

**Status:** IMPLEMENTED on branch `claude/invitation-open-link` (stacked on
`claude/invitation-link-7-days`). Owner is the reviewer; Codex review optional. Nothing is
deployed. Owner instruction 2026-10-13: the link in the provider invitation email must work
for the whole invitation (7 days by default) through a Mercurius-owned link ("option 1").
Hosted Auth caps its own email link at 24 hours (DEC-2026-029).

## Characterized before change (`main` `283cfe5` plus DEC-2026-029)

- `vendor-invite` claims the attempt, then calls `auth.admin.inviteUserByEmail` with
  metadata `{ invitation_attempt, invitation_kind?, business_name? }`. Auth creates the
  unconfirmed user and sends the reviewed template through Resend SMTP. A 422
  `email_exists` is a definite refusal; any other error leaves the attempt `unknown`
  (never retried). Success records the receipt (`provider_accepted`).
- The template link was `/set-password?invitation=…[&kind=existing_provider]&token_hash=…&type=invite`,
  verified from the browser after load (scanner-safe), dying with the 24-hour Auth link.
- After the password is set the browser goes to `/invitation?attempt=…`, which re-verifies
  the attempt server-side and records acceptance. Both invitation paths (application,
  TRACE-063/066; existing-provider access, TRACE-105) share the template and flow.

## Contract

Auth's invite call, refusal contract and email stay. Only the link changes, and each use
mints a fresh Auth sign-in.

**Migration `20261014001000_invitation_open_link.sql`**

- `private.provider_invitation_open_keys (source, attempt_id, key_hash, created_at)`,
  primary key `(source, attempt_id)`, `key_hash` 64 lowercase hex; and
  `private.provider_invitation_opens (source, attempt_id, opened_at)`. Row level security on,
  no policy, every privilege revoked from `public`, `anon`, `authenticated`, `service_role`.
- `public.provider_invitation_set_open_key(source, attempt, key_hash)`: only while the
  attempt's dispatch is `started` (reserved, nothing sent), once per attempt (the primary key
  refuses a second). Malformed input is 22023.
- `public.provider_invitation_open(source, attempt, key_hash) returns jsonb`: under the key
  row's lock, requires the key, a `submitted` attempt with a `provider_accepted` dispatch,
  `expires_at` in the future, and the recipient's Auth address still equal to the dispatch
  recipient; at most 10 opens per link per rolling hour (`private.provider_invitation_open_limit()`).
  Records the open and returns `{ auth_user_id, email }`. Every refusal raises the same
  P0001 "Invitation link not valid" (the limit adds detail `open_limit` for logs).
- Both functions execute only as `service_role`.
- `r0_invitation_attention` and `r0_provider_access_queue` no longer report `link_lapsed` for
  an attempt that has an open key; otherwise unchanged from `20261013001000`.

**`vendor-invite`**: after a successful claim it generates 32 random bytes (base64url, 43
characters), stores the SHA-256 with `provider_invitation_set_open_key`, then invites with
`invitation_key` in the metadata. If the key cannot be stored, the reserved dispatch is
marked `unknown` and Auth is never called. On a successful acceptance it removes
`invitation_key` from the recipient's own metadata (best effort; the database stops
honoring the key at acceptance either way).

**Template** (`supabase/templates/provider-invitation.html`): with a key, the button and
copyable link are `{{ .SiteURL }}/invitation/open?invitation=…[&kind=existing_provider]&key=…`
and the copy says the link works until the invitation expires. Without a key (a dispatch by
a `vendor-invite` that predates this change) it falls back to the 24-hour Auth link, so the
deploy order cannot produce a broken email.

**Site**

- `/invitation/open`: reads the link in the browser and shows Continue. Loading the page
  sends nothing. `referrer: no-referrer`, `noindex`. A 410 shows the generic "no longer
  valid" text with the contact path; an outage keeps the button for a retry; only a
  `/set-password?…` redirect is followed.
- `POST /api/invitations/open` (Node runtime, service key): parses and hashes the key, calls
  `provider_invitation_open`, then `auth.admin.generateLink({ type: "magiclink", email })`
  (sends no email) and returns `/set-password?invitation=…[&kind=…]&token_hash=…&type=magiclink`.
  P0001 is 410 with one message; any other failure is 503. The key is never logged.
- `/set-password` accepts `type=magiclink` alongside `invite` and `recovery`. Verifying it
  signs the provider in and confirms the address; the password and `/invitation`
  acceptance steps are unchanged.

## Decisions taken while building

- **Key in Auth metadata.** The plaintext key sits in `raw_user_meta_data` from dispatch
  until acceptance, readable by the recipient and by service-role/database administrators.
  It opens only that recipient's own invitation, the database holds only its hash, and
  acceptance removes it. Mercurius sending the email itself (keeping the key out of Auth)
  would change the reviewed TRACE-063/071 dispatch contract and was not chosen.
- **Magic link for an invited, unconfirmed user** verified against local Auth before
  relying on it: `generateLink("magiclink")` works for a user created by
  `inviteUserByEmail`; verifying it signs in and confirms the email; each token is single
  use and a newer one invalidates older ones; `user_metadata: { invitation_key: null }`
  removes only that key.
- **Opens after the password is set but before acceptance** are allowed, so a provider who
  closed the tab can finish. Acceptance ends the link.
- **Already-sent invitations** keep their 24-hour Auth links.
- **Key-store failure** marks the reserved dispatch `unknown` rather than leaving it
  `started`, matching the existing rule that a reservation is never silently retried.
  Recovery is to close the attempt and prepare a new one.

## Evidence (local)

- SQL `077_invitation_open_link.sql`: 40 assertions over both invitation paths (privileges,
  key once and only before Auth, wrong source/key, before Auth acceptance, day 3, expiry,
  changed address, hourly limit incl. rolling window and unrecorded refusals, acceptance,
  attention with and without a key).
- `vendor-invite` runtime: 23 cases (4 new: key recorded between claim and invite with the
  right source; key failure stops the send; acceptance clears the caller's own key; a
  refused acceptance clears nothing).
- Unit `invitation-open-link`: 7 (parsing, redirect path, route success hashes the key and
  ignores body-supplied addresses, malformed links, generic refusal without minting or
  logging the key, outages).
- Browser `invitation-open`: 7 (light 320 / dark 1440 with axe; GET spends nothing; meta
  referrer and robots; Continue posts the link values and follows only `/set-password`;
  invalid, outage and incomplete states).
- Local end-to-end `scripts/r0-existing-provider-access.mjs` with real Auth, the mail sink,
  served `vendor-invite` and the site: 37/37, including the rendered email, a page load that
  spends nothing, a day-3 open, single-use sign-in, a wrong key, the link ending at
  acceptance and the key removed from metadata.
- Regression: 390 unit, lint, typecheck, all 11 Edge suites, 3889/3890 SQL (the one failure,
  `003` test 16, is local data: six admin accounts in the local database).

## Hosted work (owner-authorized, in this order)

1. `supabase db push --linked` (applies `20261014001000` only).
2. Deploy `vendor-invite` from the merged commit (`verify_jwt = true`). Emails still use the
   old link until step 4; the key is stored but unused.
3. Deploy the site (adds `/invitation/open` and `/api/invitations/open`).
4. Paste the updated `supabase/templates/provider-invitation.html` into Auth → Email
   Templates → Invite (subject unchanged).
5. Acceptance with an owner-controlled mailbox: the email links to `/invitation/open`;
   Continue reaches the password step; acceptance works; the link then shows "no longer
   valid".
