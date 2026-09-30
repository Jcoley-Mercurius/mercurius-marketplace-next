# R0.5 release candidate — existing-provider access, cleanup and hosted readiness (TRACE-105)

**Branch:** `codex/r0-release-candidate` from `main` `a88da4f` (R0.4 PR #72 merged 2026-09-30).
**Status:** implementation checkpoint for Codex review. **No hosted schema, data, Auth, Edge, email, deployment or domain change has been made. No real invitation has been sent.**
**Governing sources:** DEC-2026-022/024/025; [layered-launch decision](LAYERED-LAUNCH-DECISION.md) R0 vendor and operator contract; [R0.4 report](R0-VENDOR-READINESS.md) R0.5 checklist; Phase 5 invitation, binding, linking, activation-role and cutover contracts (TRACE-063/065/067/068/070/061).

## Reinspection (read-only, 2026-09-30)

| Area | Found | Consequence |
|---|---|---|
| Hosted migrations | History ends `20260731172714`; 95 local migrations pending (`20260808120000` … `20260930001000`) | Whole rebuilt schema absent in production; rehearsal required |
| Hosted functions | `vendor-invite` v11 (original deploy); no `MERCURIUS_INVITATION_*` secrets | Current function and pins must be deployed |
| Hosted Auth | Site URL `http://localhost:3000`; empty redirect allow-list; no custom SMTP (built-in sender, 2 emails/hour); link lifetime 3600 s; default invite subject | All R0 Auth settings still to apply |
| Backups | Pro plan, Micro compute; daily physical backups, 8 retained, latest 2026-09-30 10:17 UTC; PITR off | Restore point exists; rehearsal can restore it to a new project |
| Production data shape | 19 contractors, 6 Auth users, 3 applications, 16 MB database, 10 Storage objects (vendor-media), no cron jobs | Rehearsal is small and inexpensive |
| Vercel | App project `mercurius-marketplace-next`, last production deploy `735df91` (26 days); `mercuriusmarketplace.com` and `www` attached to project `mercurius-landing-page` (static page); Git deploys disabled | Domain move is a Vercel project reassignment; GoDaddy DNS already points at Vercel |
| DNS / email authentication | NS GoDaddy; `www` CNAME to Vercel; apex A to Vercel; SPF on `send.` resolves to `include:amazonses.com`; DKIM `resend._domainkey` published; bounce MX on `send.`; DMARC `p=quarantine`, relaxed alignment; Google Workspace MX | Resend DNS is correct; Resend's own domain status still needs its API (below) |
| Vercel env | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_NOTIFICATION_EMAIL`, `NEXT_PUBLIC_SITE_URL`, Supabase keys set (sensitive; values unreadable) | Values unverifiable from here; confirmed by a live send test |

`profiles.state` defaults to `'TX'` in production, so every account reads as Texas; geography identifies no fake account.

## Existing-provider access (DEC-2026-024), migration `20260930001000`

The eight confirmed real vendors are legacy contractors with no application, no account and no onboarding row. The canonical invitation reads its recipient from an application snapshot, and TRACE-065 refuses application review for an existing provider, so none could be invited without fabricating an application. This slice adds a parallel path with the same protections and leaves the application path unchanged.

- **Contact:** `r0_record_provider_contact` records an owner-confirmed address for the exact contractor (append-only, reason, owner confirmation text, idempotency key). One current contact per provider and per address. The profile's business email is normalized to it. Refused for application-onboarding, excluded or already-linked providers, and while an access attempt is live.
- **Attempt:** `r0_prepare_provider_access` with an operator-entered expiry (1–30 days) creates one live attempt per provider: `new_account`, or `existing_account` naming an exact confirmed account whose email matches the contact and which is linked to no provider.
- **Dispatch:** `vendor-invite` `source: "existing_provider"` reserves (`r0_claim_provider_access`) before Auth, never retries, records provider-accepted / unknown / refused (`r0_finish_…`, `r0_refuse_…`, service key only). Existing-account attempts are never emailed by Auth.
- **Acceptance:** the signed-in recipient explicitly accepts (`r0_accept_provider_access`); identity is checked first, then contact currency, expiry and provider state. Acceptance links nothing and grants nothing.
- **Binding:** `r0_bind_provider_access` re-proves account, confirmed email, recipient, receipt and current contact; refuses duplicates, cross-provider accounts and live attempts; sets `contractors.user_id` and grants the `vendor` role (TRACE-068 timing change), recording whether the role was added. `r0_release_provider_access` reverses only a binding it made, refuses an active provider and never removes a role it did not add.
- **Not approval:** an access-managed provider is no longer matching-eligible or listable on legacy `is_active` (the TRACE-060 compatibility branch). It needs onboarding or cutover evidence. `r0_my_provider_listing.setup_access` drives the vendor notice.
- **Interlock:** application onboarding cannot start while an access attempt is live (trigger on `vendor_onboarding`).
- **Readbacks:** `r0_provider_access_overview`, `r0_provider_access_queue`, `r0_excluded_provider_ids` (operator only).

### Vendor-role permission inspection

The role gates only the `/vendor` routes. Rights come from `contractors.user_id`: profile updates are column-limited by `enforce_contractor_update_scope` (no activation, listing, ownership or payout fields); gallery/media/package writes are own-profile only; job writes require an assigned request; `vendor_accept_job` requires a pending offer that still passes eligibility; no vendor-callable money command exists (`money_operator_*` require finance authority). Closing legacy eligibility was therefore the only restriction needed before granting the role.

### Operator and recipient surfaces

`/admin/vendors/[id]` Existing Provider Access panel (contact, prepare, send, reconcile, refuse, revoke/expire, bind, release, history); `/admin/recruiting` access section; `/invitation` and `/set-password` carry `kind=existing_provider`; the Auth invite template has existing-profile wording chosen by `invitation_kind` (own password, 3-hour link, support contact, setup separate from compliance approval and public eligibility; no jobs, booking, listing, Founding Vendor or Credits promise); vendor listing card shows setup access.

## Excluded vendors

Resolved exactly in production: Aristotle, Helios Roofing, Ultimate Homes Cooling and Electrical, and the eight Arizona samples (BugShield Pest Control, CoolBreeze HVAC, CrystalClear Pools, FixIt Right Handyman, GreenScape Pro, ProFlow Plumbing, SparkleHome Cleaning, TopShelf Exteriors). The supported action is the R0.4 exclusion (`r0_set_public_listing_exclusion`, reason required, reversible, audited), which removes them from the public directory, direct profile projection, Spotlight, matching and public pricing; this slice also removes them from the normal admin vendor list (Archived view kept) and featured/smart-pick choices. Nothing is deleted. Dependencies preserved: Aristotle 4 pending requests (one booked by the owner's own account), 1 pending invoice, 3 packages; Helios 14 service ZIPs, 1 match attempt, 2 applications; SparkleHome 1 match attempt. Linked Auth users are unchanged. The exclusion function exists only after the hosted migration, so it is applied during rollout.

## Admin roster and coverage (DEC-2026-025)

Production admin accounts: the owner's `@mercuriusmarketplace.com` account (also homeowner and vendor, linked to Aristotle, never signed in to this project), the owner's personal account (also vendor, linked to Helios, last sign-in 2026-09-28), and two `@mercurius.com` accounts whose domain ownership is unconfirmed (addresses reported to the owner privately; not trusted coverage, unchanged). Owner-only coverage is recorded as a requested exception, restated at go/no-go.

## Verification (local, 2026-09-30)

- SQL 072 `r0_existing_provider_access`: **128/128** — least privilege, contact validation/normalization/uniqueness/replay/conflict, excluded/onboarding/linked refusals, legacy eligibility and listing removed, expiry bounds, one live attempt, contact frozen under a live attempt, onboarding interlock, claim once, receipt identity, acceptance by verified recipient only, no link/role at acceptance, binding refusals and success, replay, no fabricated application/onboarding/evidence, setup-access readback, own-profile edit allowed, activation/listing/payout flags refused, other provider untouched, no job to accept, no access queue for vendors, ACH request refused, refusal→existing-account recovery, role preserved on release, unconfirmed/mismatched/linked accounts refused, expiry and closure, inherited link not releasable, immutability, application invitation still prepares.
- Full SQL suite on the migrated local stack, one rolled-back transaction per file: **3710 passed; 1 expected contract change** (071 now includes `setup_access`; 071 75/75 after update). A blank replay is covered by CI's reconstruct job.
- Local end-to-end through local Auth, mail sink and served `vendor-invite` (`scripts/r0-existing-provider-access.mjs`): **31/31** — email arrives with reviewed subject/wording and link to `/set-password?…kind=existing_provider`; POST verification; reuse refused; password; binding refused before acceptance; application accept path refuses the attempt; acceptance; binding with vendor role; sign-in; setup access not approved/listed; own edit only; no job, checkout or access-queue access; not in public directory; registered address refused and nothing sent.
- `vendor-invite` runtime tests 20/20 (5 new); CI Edge check and test scripts pass; unit 352/352; typecheck; full lint; production build (CI synthetic env).
- Browser: invitation, invitation-operations and vendor-readiness specs 40/40 including 3 new (existing-provider acceptance at 320 light/1440 dark with axe WCAG 2.2 AA and reflow; kind kept through sign-in and password setup; recruiting access queue).
- Not run: human screen reader/zoom; `@visual`; anything hosted.

## Email delivery status

DNS for Resend on `mercuriusmarketplace.com` is correct (above). Not yet proven: Resend shows the domain verified, the Vercel `RESEND_*` values work, and mail reaches the inbox. The stored Vercel values are sensitive and cannot be read back. Required: a Resend API key supplied locally (git-ignored `.env.resend`) for a read-only domain check and one test send to the owner's mailbox; the same key (or a dedicated one) is the Supabase SMTP password.

## Rehearsal recommendation

| Option | Production data | Storage objects | Incremental cost |
|---|---|---|---|
| Supabase branch | Only with **Include data**, which requires the PITR add-on | Not copied | Branch compute from $0.01344/h (not covered by compute credits) plus the PITR add-on |
| **Restore backup to a new project (recommended)** | Yes: database, schema, Auth users with hashed passwords, Vault keys, from today's physical backup | Not copied (10 vendor-media files; recreate synthetically) | Micro compute $0.01344/h (≈ $0.32/day; the org's compute credit is already used), disk within the included 8 GB; Supabase shows the estimate before confirming. Delete after the rehearsal: expected under $2 |

Restoring enables all extensions; production has `pg_cron`/`pg_net` but **no cron jobs**, so nothing runs against external services. Auth settings, Edge functions, secrets and Storage are not copied, which keeps the rehearsal from sending mail. Treat the restored copy as production data (no export, no screenshots of customer rows).

**Prepared action (needs owner approval before the charge):** Dashboard → project `mercurius-marketplace` → Database → Backups → *Restore to a new project* → backup 2026-09-30 10:17 UTC → Micro, same region (us-east-2) → name `mercurius-r0-rehearsal`. Then: `supabase db push` of the 95 migrations to that project, full SQL suite, drift check (`supabase db diff`), security advisor, exclusions/contacts on the copy, synthetic Storage upload, delete the project.

## Prepared hosted rollout (each step needs its own owner authorization)

1. Rehearsal above; record results here.
2. Production backup point: the daily physical backup taken before the window (or an on-demand backup), recorded.
3. `supabase db push --linked --dry-run` → exactly the 95 expected files; then push in a low-traffic window.
4. Deploy `vendor-invite` from the release commit; set `MERCURIUS_INVITATION_PROJECT_REF=vugqqyemuptlvcieihww`, `MERCURIUS_INVITATION_SITE_ORIGIN` and `SITE_URL` = final origin, then `MERCURIUS_INVITATION_MODE=hosted` last.
5. Auth: Site URL = final origin; redirect allow-list `https://<origin>/set-password?invitation=*` (and `/**` for sign-up/recovery); invite subject and template from `supabase/templates/provider-invitation.html`; email link lifetime 10800 s; custom SMTP `smtp.resend.com:465`, user `resend`, password = Resend key, sender `no-reply@mercuriusmarketplace.com` (or the verified sender in use); raise the email rate limit from 2/hour.
6. Vercel: production deployment of the release commit (not promoted until migrations succeed); domain reassignment from `mercurius-landing-page` to the app (no GoDaddy change).
7. Operator data: exclusions for the 11 records; owner-confirmed contacts for the eight real vendors (normalizes their email casing).
8. Hosted tests A–C from the R0.4 checklist, plus access test with the owner mailbox (below), then final-domain repeat.
9. Owner go/no-go including the DEC-2026-025 exception.

## Owner-mailbox test plan

The owner's `@mercuriusmarketplace.com` account is confirmed and linked to Aristotle, so it can prove only the existing-account refusal. The new-account path uses a synthetic, excluded-from-listing test provider (`R0 Access Test Provider`) and plus-addressed recipients that deliver to the same mailbox (`jcoley+r0access@…`). The existing-account path uses a second plus address with a confirmed account. The owner's own account and roles are not changed. Test records are archived after the run.

## Decisions for Codex review

1. Parallel private tables instead of generalizing the TRACE-063 tables (keeps application invitations byte-for-byte unchanged).
2. Vendor role at reviewed binding for this path only (DEC-2026-024).
3. Access-managed providers leave the TRACE-060 legacy eligibility branch.
4. Existing-account mode proves ownership by the named account signing in and accepting; no email is sent to a registered address.
5. Expiry bound of 30 days; the Auth link itself is 3 hours.
6. Profile business email follows the confirmed contact.
7. Excluded providers hidden from normal admin lists and featured/smart-pick choices; history lookups keep names.

## Open follow-ups

Compliance path for access-managed providers (real application or cutover evidence); backup administrator (exception recorded); `@mercurius.com` admin accounts; Aristotle disposition (archive recommended; see handoff); contact-form and renewal owner-email ledger (R0.4 D10).
