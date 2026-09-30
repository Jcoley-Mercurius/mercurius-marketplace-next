# R0.5 release candidate — existing-provider access, cleanup and hosted readiness (TRACE-105)

**Branch:** `codex/r0-release-candidate` from `main` `a88da4f` (R0.4 PR #72 merged 2026-09-30).
**Status (2026-09-30, verified read-only):** production **schema and operator data are rolled out** (migration history repair + push, 11 exclusions, 8 contacts, two `@mercurius.com` accounts removed). **Edge `vendor-invite`, Auth, SMTP, Vercel deployment and domain are unchanged.** No real invitation has been sent. The light-only release (DEC-2026-026) is on branch `codex/r0-light-only-release`. See [Production state verified 2026-09-30](#production-state-verified-2026-09-30) and the [running release checklist](#running-release-checklist).
**Governing sources:** DEC-2026-022/024/025; [layered-launch decision](LAYERED-LAUNCH-DECISION.md) R0 vendor and operator contract; [R0.4 report](R0-VENDOR-READINESS.md) R0.5 checklist; Phase 5 invitation, binding, linking, activation-role and cutover contracts (TRACE-063/065/067/068/070/061).

## Production state verified 2026-09-30

Read-only checks from this workstation on 2026-09-30 (≈20:30–21:30 UTC): Supabase CLI 2.111 (`migration list`, `backups list`, `functions list`, `secrets list` names only, `db advisors`, `db query` inside `begin transaction read only … rollback`), the Supabase Management API (Auth config, non-secret fields only), the Vercel API (projects, domains, deployments, env names only), DNS-over-HTTPS and HTTPS probes. No write was made. Row values that identify customers were not printed; vendor business names appear because they are already in this report.

**Reported vs verified.** The production push and cleanup were carried out in an earlier session and reported to this one, not observed. The dry-run output (81 files) and the push log were not available to re-read here. What is independently verified is the resulting production state below. The dry run itself cannot be repeated: nothing is pending now.

| Item | Verified result | Evidence |
|---|---|---|
| Restore point | Physical daily backup **2026-09-30 10:17:15 UTC** (id 1828642837, COMPLETED) precedes the push; 8 daily backups retained (2026-09-23 → 2026-09-30); PITR off; no later on-demand backup | `supabase backups list` |
| Migration history | **178 local = 178 remote; 0 pending; 0 remote-only.** 95 versions after `20260731172714`: the 14 repaired (`20260808120000` … `20260815140000`) + **81** (`20260903160000` … `20260930002000`), matching the rehearsed plan | `supabase migration list --linked` |
| Contractor update-scope repair (`20260930002000`) | Live function no longer contains the `current_user <> 'authenticated'` test; trigger `trg_enforce_contractor_update_scope` enabled | `pg_get_functiondef`, `pg_trigger` |
| 11 exclusions | All 11 named records excluded at 2026-09-30 18:22 UTC with reasons "Owner-approved R0 cleanup 2026-09-30: …"; 11 listing events; actor is the owner's `mercuriusmarketplace.com` admin | `private.r0_public_listing_exclusions`, `…_events` |
| 8 owner-confirmed contacts | 8 contact rows, 8 current contacts, 8 distinct addresses, all recorded 2026-09-30 18:22 UTC by the same admin; each profile email equals its contact | `private.r0_provider_contacts`, `…_current_contacts` |
| Access attempts | 0 attempts, 0 dispatches: **no real invitation sent** | `private.r0_provider_access_*` |
| `@mercurius.com` test admins | **Removed**: 0 such Auth users (6 → 4 users, 6 → 4 profiles). Admin role rows: 2, both the owner's (`mercuriusmarketplace.com`, never signed in to this project; personal Gmail, last sign-in 2026-09-28) | `auth.users`, `public.user_roles` |
| Cascade from that removal | `service_requests.customer_id` and `invoices.customer_id` cascade on Auth-user delete. Compared with the rehearsal copy of the 10:17 backup: **1 pre-existing service request owned by a `@mercurius.com` account was deleted** (12 → 11); invoices unchanged (1); applications unchanged (3) | rehearsal vs production counts |
| Public listing / matching | **0 of 19 providers listable, 0 matching-eligible; public projection returns 0 providers** | `r0_provider_listable`, `vendor_matching_eligible`, `r0_public_providers` |
| Security advisor | 0 errors. Warnings: 6 anon-callable SECURITY DEFINER functions (the intended public projections `find_public_eligible_providers`, `get_completed_job_counts`, `preview_service_request_selections`, `r0_provider_listable`, `r0_public_providers`, `resolve_package_tier_price`), 148 authenticated-callable ones, leaked-password protection off | `supabase db advisors --type security` |
| Other state | 19 contractors; 0 onboarding rows; 0 trial admissions; 0 R0 interests; 10 Storage objects; 0 cron jobs | read-only counts |
| `vendor-invite` | **Unchanged:** v11 deployed 2026-08-05; no `MERCURIUS_INVITATION_*` secrets (dispatch stays off) | `functions list`, `secrets list` |
| Legacy checkout functions | **Unchanged and ungated:** `create-checkout` v11 and `checkout-request` v16 (August source, downloaded read-only) authenticate the user and create a Stripe Checkout session for the user's own pending invoice / eligible request **without** the R0 admission check in `money_prepare_checkout` or the `MERCURIUS_MONEY_MODE` gate in current source. Whether the stored Stripe key is live cannot be read. See blocker B2 | `functions download` |
| Auth | **Unchanged:** Site URL `http://localhost:3000`; empty allow-list; no custom SMTP; 2 emails/hour; link lifetime 3600 s; default invite subject/template (173 chars) | Management API |
| Vercel app | **Unchanged:** production deployment `735df91` (2026-09-04). Its production alias `mercurius-marketplace-next.vercel.app` is **publicly reachable** (HTTP 200; `/`, `/vendors`, `/request`, `/contact`, `/vendors/apply` served) because Standard Protection exempts it, contrary to the 2026-09-24 note that every deployment sits behind login. It now runs 2026-09-04 code against the fully migrated database. See blocker B3 | Vercel API, HTTPS probes |
| Vercel env names | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_NOTIFICATION_EMAIL`, `NEXT_PUBLIC_SITE_URL` (all sensitive). **Missing: `VENDOR_UPLOAD_HMAC_SECRET`, `VENDOR_UPLOAD_HMAC_VERSION`**, which the vendor-application document upload requires | Vercel API |
| Public domain | `mercuriusmarketplace.com` and `www` still on project `mercurius-landing-page` (static page) | Vercel API; title "Mercurius Solutions – AI-Powered Marketplace for SWFL" |
| Resend | DNS correct (below). The local key is send-only (`restricted_api_key`), so domain status is not readable here; the owner verified the domain and a send was accepted (HTTP 200) on 2026-09-30. Inbox arrival not yet evidenced in this report | Resend API |

## Light-only recruiting release (DEC-2026-026)

Branch `codex/r0-light-only-release` from `main` `5df97a2`.

- `src/components/theme/themeMode.ts`: `LIGHT_ONLY_LAUNCH = true`, the single switch.
- `ThemeProvider`: `forcedTheme="light"`, `enableSystem` off, default `light`. next-themes applies the forced theme in its pre-hydration script, so a saved `dark`/`system` value or OS dark never paints first. The saved value is ignored, not erased.
- `ThemeToggle`: renders nothing while the switch is on (desktop header, mobile menu, MDS catalog).
- Root `viewport.colorScheme = "light"` → `<meta name="color-scheme" content="light">`; with `:root { color-scheme: light }` and next-themes' inline `color-scheme`, native controls, scrollbars and autofill stay light.
- Sonner toasts use the forced theme (previously they would have followed a saved `dark`).
- Unchanged: every `.dark` token and `dark:` utility, for the TRACE-106 repair.

**Evidence (local, 2026-09-30, code commit `cfdcf49`, CI synthetic build env):**

- `tests/e2e/light-only.spec.ts` **34/34**: server HTML carries `<meta name="color-scheme" content="light">` and no `dark` class; public `/`, public form `/early-access`, homeowner `/dashboard`, vendor `/vendor`, admin `/admin/recruiting` × fresh / saved `dark` / saved `system` + OS dark × 320 and 1440 px → `html.light`, never `dark` from first mutation (MutationObserver from document start), computed `color-scheme: light`, body on the light background token, no theme control, axe WCAG 2.2 AA clean, no horizontal overflow; navigation + reload keep light and leave the saved `dark` value in storage; mobile menu has no control; early-access validation errors under OS dark are light and axe-clean. First run found the two homepage contrast failures (fixed above).
- Full non-visual browser suite (`npm run test:a11y`): **458/460**. Two `finance-reconciliation` cases failed once (one timeout, then one transient contrast reading `#8c8e93` on a button); **not reproduced** in 57 later branch runs (27/27 and 30/30 with `--repeat-each`); `main` `5df97a2` 27/27. Recorded as intermittent; CI is the independent run.
- Unit 352/352; typecheck; full lint; secret scan; production build.
- The existing specs' "dark" variants now exercise a saved `dark` preference rendered light. `@visual` dark baselines (`mds`, `request`) will differ until TRACE-106 and were not run. Not run: human screen reader/zoom; anything hosted.
- Homepage light-contrast fixes found by the new check (MDS §§80/82), existing tokens only: provider CTA fill `bg-coral` → `bg-coral-dark` (white on `#d76742` was 3.55:1); Spotlight subtitle and "View all" `text-muted-foreground` → `text-slate-dark` on the slate band (4.06:1).

## Remaining hosted rollout package

Nothing below has been executed. Each numbered action needs Josh's explicit authorization for that action; this session had authorization for read-only checks only. Keys are never printed: pass them from git-ignored files or the provider dashboards.

**Hostnames.** Controlled hosted URL for pre-cutover tests: `https://mercurius-marketplace-next.vercel.app` (the app's production alias; public, not SSO-protected, not advertised). Final canonical origin: `https://www.mercuriusmarketplace.com` (what the domain already serves; apex redirects to it).

**Release SHA.** Deploy the reviewed merge of `codex/r0-light-only-release` into `main`; record that exact SHA here before step R1. The branch commit is listed in the handoff.

| # | Action | Target | Exact change | Verify | Rollback |
|---|---|---|---|---|---|
| R1 | Vercel env (Production) | project `mercurius-marketplace-next` | Add `VENDOR_UPLOAD_HMAC_SECRET` (≥32 random chars generated locally into a git-ignored file) and `VENDOR_UPLOAD_HMAC_VERSION=v1`. Re-enter (values are unreadable): `NEXT_PUBLIC_SUPABASE_URL=https://vugqqyemuptlvcieihww.supabase.co`; `RESEND_FROM_EMAIL=notifications@mercuriusmarketplace.com` (the sender proven on 2026-09-30); `OWNER_NOTIFICATION_EMAIL` = the controlled mailbox; `NEXT_PUBLIC_SITE_URL=https://www.mercuriusmarketplace.com` (no runtime consumer today). Leave `MDS_CATALOG_ENABLED` unset | Env names listed; build succeeds | Remove added vars; previous values are unchanged unless re-entered |
| R2 | Vercel deployment | same project | From a clean checkout of the release SHA: `npx vercel@latest deploy --prod --skip-domain` (Git deploys are disabled by `vercel.json`), then `npx vercel@latest promote <deployment-url>` | Alias serves the release (light-only meta, early-access CTAs, `/request` closed) | `vercel promote` the previous deployment (`735df91` is stale against the migrated DB; prefer a forward fix) |
| R3 | Legacy checkout functions | Supabase `vugqqyemuptlvcieihww` | `supabase functions deploy create-checkout checkout-request --project-ref vugqqyemuptlvcieihww` from the release SHA, with `MERCURIUS_MONEY_MODE` **unset** | Signed-in POST returns `MONEY_NOT_ACTIVATED`; no Stripe session | Redeploy the downloaded v11/v16 source (not recommended: it bypasses admission) |
| R4 | `vendor-invite` deploy + pins | same | `supabase functions deploy vendor-invite --project-ref vugqqyemuptlvcieihww`; `supabase secrets set MERCURIUS_INVITATION_PROJECT_REF=vugqqyemuptlvcieihww MERCURIUS_INVITATION_SITE_ORIGIN=https://mercurius-marketplace-next.vercel.app SITE_URL=https://mercurius-marketplace-next.vercel.app`. **Do not set `MERCURIUS_INVITATION_MODE` yet** | `send` refuses with dispatch disabled; `prepare` works | `supabase secrets unset` the three pins; `SITE_URL` previously existed (value unreadable) and is also read by the money handler, which stays disabled |
| R5 | Auth URL config | same | Site URL `https://mercurius-marketplace-next.vercel.app`; allow-list exactly: `https://mercurius-marketplace-next.vercel.app`, `https://mercurius-marketplace-next.vercel.app/set-password`, `https://mercurius-marketplace-next.vercel.app/set-password?invitation=*` | Management API readback | Restore Site URL `http://localhost:3000`, empty allow-list |
| R6 | Auth email content | same | Invite subject "Set up your Mercurius provider account"; invite body = `supabase/templates/provider-invitation.html` (reviewed; builds `{{ .SiteURL }}/set-password?invitation=…[&kind=existing_provider]&token_hash=…&type=invite`, so **Site URL decides the invitation host**); email link lifetime `mailer_otp_exp=10800` (3 h; applies to all email links); enable leaked-password protection | Readback: template length and `invitation_kind` present | Restore subject "You've been invited", default template, 3600 s |
| R7 | Auth SMTP | same | Host `smtp.resend.com`, port 465, user `resend`, password = a Resend **sending-only** key scoped to `mercuriusmarketplace.com` (from a git-ignored file), sender `no-reply@mercuriusmarketplace.com`, name "Mercurius Marketplace"; `rate_limit_email_sent=30` per hour; keep the 60 s per-user resend interval | Recovery email to a plus address arrives from the Resend sender | Disable custom SMTP (built-in sender, 2/hour) |
| R8 | Arm hosted sending (last) | same | `supabase secrets set MERCURIUS_INVITATION_MODE=hosted` only after R1–R7 read back and the non-email tests pass | Synthetic invitation (test T4) | `supabase secrets unset MERCURIUS_INVITATION_MODE` (dispatch off immediately) |
| R9 | Cutover re-pin (after DNS/domain step D2) | same | Site URL and allow-list → the three `https://www.mercuriusmarketplace.com…` equivalents; `MERCURIUS_INVITATION_SITE_ORIGIN` and `SITE_URL` → `https://www.mercuriusmarketplace.com` | Final-domain tests | Revert to the `vercel.app` values |

Redirect paths come from the code: sign-up `emailRedirectTo = window.location.origin` (root, PKCE `code` exchanged by the browser client); recovery `redirectTo = <origin>/set-password` (`code` exchanged there); invitation `redirectTo = <origin>/set-password?invitation=<attempt>`, although the reviewed template links with `token_hash` directly and does not use `{{ .RedirectTo }}`. No `/**` wildcard is needed. The default confirmation and recovery templates are unbranded Supabase defaults: review them before homeowners create accounts (decision G5).

## Pre-cutover hosted test plan

Run against `https://mercurius-marketplace-next.vercel.app` after R1–R7 (T4 after R8). Use only the synthetic **R0 Access Test Provider** (created during the test through the operator panel, excluded from listing, archived afterwards; it does not exist in production yet) and plus addresses on the controlled mailbox. Provider acceptance is not arrival: each email step needs the message in the inbox (headers checked for Resend/DKIM pass). No real vendor is invited.

| Test | Steps | Pass condition |
|---|---|---|
| T1 Vendor application | Submit `/vendors/apply` as a plus address with a synthetic PDF | Row in admin queue; document readable by admin only (anonymous and other-user Storage reads refused); owner notification ledger shows delivered and the email is in Josh's inbox |
| T2 Homeowner early access | `/early-access` list-only; then optional account with a plus address; verify email; sign in | Confirmation email arrives; waiting dashboard shows waiting state; no request/payment action |
| T3 Booking denial | As that non-admitted homeowner: `/request`, direct REST insert into `service_requests`, `money_prepare_checkout`, and POST to `create-checkout` / `checkout-request` | All refused; no Stripe session; after R3 the functions return `MONEY_NOT_ACTIVATED` |
| T4 Synthetic invitation | Contact for the test provider = `+r0access` plus address; prepare (1-day expiry), send | Email in inbox with the reviewed subject/wording; link host is the controlled URL; password setup; explicit acceptance; operator binding; vendor sign-in shows setup access, not listed/approved |
| T5 Wrong account / existing account | Second plus address with a confirmed account: existing-account attempt; try accepting while signed in as a different account; try binding an account linked elsewhere | No email sent to the registered address; wrong-account acceptance and cross-provider binding refused |
| T6 Discovery | `/vendors`, `/providers`, Spotlight, direct profile URLs of each excluded and test record | None of the 11 excluded or the test provider appears; public roster is empty (see below) |
| T7 Light-only | Fresh, saved dark and OS-dark sessions on desktop and phone | Light rendering, no toggle, `color-scheme: light` |
| Cleanup | Close attempts, release the test binding, exclude/archive the test provider, withdraw test interests | Recorded in this report; no residue in public discovery |

## Public vendor roster (explicit)

The public roster is **empty** today and will stay empty after rollout until providers complete onboarding. Account access is not compliance approval or listing eligibility (DEC-2026-024).

| Vendor (8 real, owner-confirmed) | Why not public |
|---|---|
| All Surface Pressure Cleaning & Sealing; Flash Handyman Service; Garden of Eden Lawn Service; Maritzas Cleaning Services; P & P Cleaning Solutions; Sparkling Squeegees Window Cleaning; Spiffy Clean Canz; TDJ Construction | Access-managed (current contact recorded), so the legacy `is_active` eligibility no longer applies; no onboarding/compliance/cutover evidence; `marketing_enabled=false`; no account bound. Each needs setup access, then the separate compliance path (open follow-up), then listing content |

The 11 excluded records are hidden by design. Aristotle and Helios remain linked to the owner's accounts (unchanged).

## DNS and domain

Verified 2026-09-30:

- **Authoritative DNS: GoDaddy** (`ns73/ns74.domaincontrol.com`; SOA `dns.jomax.net`, serial 2026081000). Vercel lists the domain as external (not registered or DNS-hosted at Vercel).
- Apex `A 216.198.79.1`; `www CNAME 5b7a83afadbb75bc.vercel-dns-017.com.` Vercel's current recommended values are exactly these (apex A `216.198.79.1` or `64.29.17.1`; `www` CNAME `5b7a83afadbb75bc.vercel-dns-017.com.`) and it reports **neither hostname misconfigured**.
- **Therefore no GoDaddy change is needed; cutover is a Vercel project reassignment only.**
- Preserve (do not touch): Google Workspace MX (`aspmx.l.google.com` + alts), root SPF (`include:dc-aa8e722993._spfm…`), `google-site-verification` TXT, DMARC (`p=quarantine`, relaxed), Resend `send.` MX (`feedback-smtp.us-east-1.amazonses.com`) and SPF, DKIM `resend._domainkey`. No CAA record exists (Let's Encrypt issuance unrestricted).
- Current behavior (landing project): `http://` → 308 to `https://`; apex → **307** to `https://www.mercuriusmarketplace.com/`; `www` HTTPS 200 with a Let's Encrypt certificate for `www` valid to 2026-12-27.

**Cutover (D1–D3; needs Josh's authorization of the concrete step after the pre-cutover tests pass):**

- D1: In Vercel, remove `www.mercuriusmarketplace.com` and `mercuriusmarketplace.com` from `mercurius-landing-page`, then add both to `mercurius-marketplace-next`: `www` as the production domain, apex as a **308** redirect to `www`.
- D2: Re-pin Auth and `vendor-invite` (R9).
- D3: Checks: `http://` and apex → single hop to `https://www.mercuriusmarketplace.com/` (308); valid certificate for both names; HSTS header present; page is the app (light-only meta); `/set-password`, `/early-access`, `/vendors/apply` 200; `/admin` redirects to login; repeat T1–T7 briefly on the final origin (one invitation to a plus address, one recovery email).
- Rollback: move both domains back to `mercurius-landing-page` (apex 307 → `www` as today) and revert R9. DNS never changes, so rollback is immediate apart from certificate issuance.

## Running release checklist

Status as of 2026-09-30 (UTC). PASS = verified evidence exists; PENDING = not yet done or needs authorization; FAIL = verified defect.

| # | Item | Status | Evidence / what remains |
|---|---|---|---|
| 1 | Production migration/cleanup reconciliation | **PASS** (end state) | 178/178, 0 pending; 11 exclusions; 8 contacts; test admins removed; scope repair live. Caveats: push/dry-run logs reported, not re-read; one cascade-deleted request (G3) |
| 2 | Light-only release | **PASS locally** | `cfdcf49`: light-only 34/34; suite 458/460 with 2 intermittent finance cases not reproduced (57 reruns); hosted check pending (T7) |
| 3 | Final SHA and CI | **PENDING** | PR CI on the branch (handoff); final SHA = reviewed merge commit, recorded before R1 |
| 4 | Edge/Auth/email configuration | **PENDING** | R1–R8 prepared, none executed; B1 (upload secret) and B2 (legacy checkout) must be included |
| 5 | Hosted recruiting and booking-denial tests | **PENDING** | T1–T7 not run; B2 open until R3 |
| 6 | Public vendor eligibility | **PASS (as designed)** | 0 listable; no test/excluded record public; 8 real vendors not yet eligible (above) |
| 7 | Sole-admin exception and support/privacy contacts | **PENDING owner restatement** | DEC-2026-025 confirmed by Josh 2026-09-30; restate in go/no-go; contacts per R0.4 (hello@ / phone) |
| 8 | GoDaddy DNS / Vercel cutover readiness | **PASS (DNS ready)** | No DNS change; reassignment D1 awaits pre-cutover tests and authorization |
| 9 | Final-domain verification plan | **PASS (prepared)** | D3 above |
| 10 | Rehearsal-project retirement | **PENDING owner decision** | Rehearsal evidence is recorded here; the project has no remaining migration role. Before deletion decide G2 (it holds the only copy of the cascade-deleted request once backups rotate) |

**Blockers:** B1 Vercel lacks `VENDOR_UPLOAD_HMAC_*` (vendor document upload fails hosted) → R1. B2 legacy `create-checkout`/`checkout-request` bypass R0 admission → R3 before any public exposure. B3 the stale `735df91` app is publicly reachable on the `vercel.app` alias against the migrated DB → R2 (or temporarily enable protection for the production alias). B4 hosted tests T1–T7 not yet run.

**Owner decisions (go/no-go package):** G1 authorize R1–R3 (non-email) now; G2 retention of the 10:17 UTC pre-push state: the daily backup rotates out around 2026-10-08, and the rehearsal copy contains the cascade-deleted request; choose keep-rehearsal-until-then, an owner-held encrypted dump, or accept loss; then authorize deleting `mercurius-r0-rehearsal` (`bykrrbasvjpuljnrkwdo`); G3 confirm the cascade-deleted request belonged to test data; G4 authorize R4–R8 after R1–R3 pass; G5 approve default Supabase confirmation/recovery wording or request branded templates; G6 after T1–T7 pass, authorize D1–D3 with DEC-2026-025 restated; G7 Codex review of the light-only diff and the two homepage contrast changes.

## Pre-rollout baseline (read-only, 2026-09-30, before the production push)

Historical: this table describes production **before** the migration push and cleanup. The current state is in [Production state verified 2026-09-30](#production-state-verified-2026-09-30).

| Area | Found | Consequence |
|---|---|---|
| Hosted migrations | History ends `20260731172714`; 95 local migrations pending (`20260808120000` … `20260930002000`, including this slice's two) | Rehearsed below: 14 already present outside the history; 81 apply cleanly |
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

Resolved exactly in production: Aristotle, Helios Roofing, Ultimate Homes Cooling and Electrical, and the eight Arizona samples (BugShield Pest Control, CoolBreeze HVAC, CrystalClear Pools, FixIt Right Handyman, GreenScape Pro, ProFlow Plumbing, SparkleHome Cleaning, TopShelf Exteriors). The supported action is the R0.4 exclusion (`r0_set_public_listing_exclusion`, reason required, reversible, audited), which removes them from the public directory, direct profile projection, Spotlight, matching and public pricing; this slice also removes them from the normal admin vendor list (Archived view kept) and featured/smart-pick choices. Nothing is deleted. Dependencies preserved: Aristotle 4 pending requests (one booked by the owner's own account), 1 pending invoice, 3 packages; Helios 14 service ZIPs, 1 match attempt, 2 applications; SparkleHome 1 match attempt. Linked Auth users are unchanged. The exclusion function exists only after the hosted migration, so it is applied during rollout. **Applied in production 2026-09-30 18:22 UTC (verified read-only; see above).**

## Admin roster and coverage (DEC-2026-025)

Production admin accounts: the owner's `@mercuriusmarketplace.com` account (also homeowner and vendor, linked to Aristotle, never signed in to this project), the owner's personal account (also vendor, linked to Helios, last sign-in 2026-09-28), and two `@mercurius.com` accounts whose domain ownership is unconfirmed (addresses reported to the owner privately; not trusted coverage, unchanged). Owner-only coverage is recorded as a requested exception, restated at go/no-go. **Update 2026-09-30:** the two `@mercurius.com` accounts have been removed (verified: 0 remain; 2 admin rows, both the owner's). Josh confirmed sole-admin coverage under DEC-2026-025.

## Verification (local, 2026-09-30)

- SQL 072 `r0_existing_provider_access`: **128/128** — least privilege, contact validation/normalization/uniqueness/replay/conflict, excluded/onboarding/linked refusals, legacy eligibility and listing removed, expiry bounds, one live attempt, contact frozen under a live attempt, onboarding interlock, claim once, receipt identity, acceptance by verified recipient only, no link/role at acceptance, binding refusals and success, replay, no fabricated application/onboarding/evidence, setup-access readback, own-profile edit allowed, activation/listing/payout flags refused, other provider untouched, no job to accept, no access queue for vendors, ACH request refused, refusal→existing-account recovery, role preserved on release, unconfirmed/mismatched/linked accounts refused, expiry and closure, inherited link not releasable, immutability, application invitation still prepares.
- Full SQL suite on the migrated local stack, one rolled-back transaction per file: **3710 passed; 1 expected contract change** (071 now includes `setup_access`; 071 75/75 after update). A blank replay is covered by CI's reconstruct job.
- Local end-to-end through local Auth, mail sink and served `vendor-invite` (`scripts/r0-existing-provider-access.mjs`): **31/31** — email arrives with reviewed subject/wording and link to `/set-password?…kind=existing_provider`; POST verification; reuse refused; password; binding refused before acceptance; application accept path refuses the attempt; acceptance; binding with vendor role; sign-in; setup access not approved/listed; own edit only; no job, checkout or access-queue access; not in public directory; registered address refused and nothing sent.
- `vendor-invite` runtime tests 20/20 (5 new); CI Edge check and test scripts pass; unit 352/352; typecheck; full lint; production build (CI synthetic env).
- Browser: invitation, invitation-operations and vendor-readiness specs 40/40 including 3 new (existing-provider acceptance at 320 light/1440 dark with axe WCAG 2.2 AA and reflow; kind kept through sign-in and password setup; recruiting access queue).
- Not run: human screen reader/zoom; `@visual`; anything hosted.

## Email delivery status

DNS for Resend on `mercuriusmarketplace.com` is correct (above). Not yet proven: Resend shows the domain verified, the Vercel `RESEND_*` values work, and mail reaches the inbox. The stored Vercel values are sensitive and cannot be read back. Required: a Resend API key supplied locally (git-ignored `.env.resend`) for a read-only domain check and one test send to the owner's mailbox; the same key (or a dedicated one) is the Supabase SMTP password.

## Rehearsal (performed 2026-09-30 on project `mercurius-r0-rehearsal`, restored from the 2026-09-30 10:17 UTC backup)

Owner approved the restored copy. The repo's own Supabase link stayed on production; every rehearsal command ran from an isolated working copy linked only to the rehearsal ref, and was checked before each write.

1. **Parity:** the copy matched production row counts (19 contractors, 6 Auth users, 12 requests, 1 invoice, 3 applications, 4 packages, 4 featured) and migration history (83 entries).
2. **Dry run:** exactly the pending files from `20260808120000` through this slice.
3. **First push failed on migration 1** (`package_promotions` policy already exists); nothing applied (per-migration transaction).
4. **Drift inventory:** every table, policy, index and column created by the 14 migrations `20260808120000`–`20260815140000` already exists in production (applied outside the recorded history). Later pending migrations overlap only by `create or replace` functions.
5. **Repair on the copy:** those 14 recorded as applied (`supabase migration repair --status applied`), then `db push` applied the remaining 80; history then 177/177, nothing pending or remote-only.
6. **Schema diff** (`supabase db diff --linked`, public/private/storage, migra): no table, column, policy or index difference. 15 function bodies differed; 14 are identical after whitespace normalization (production copies carry CRLF line endings). **One real difference:** `enforce_contractor_update_scope`.
7. **Security finding (present in production today):** production's live `enforce_contractor_update_scope` tests `current_user <> 'authenticated'`, which is never true inside a SECURITY DEFINER trigger, so it never enforces. Red check on the copy (synthetic vendor, rolled back): a signed-in vendor set its own `is_active` and `payouts_paused`. Forward fix `20260930002000_contractor_update_scope_repair.sql` re-applies the reviewed body from `20260729233955`; after pushing it the same attempt is refused (`Vendors are not allowed to modify`). SQL 072 pins the body and trigger.
8. **Full SQL suite on the migrated copy** (each file in a transaction forced to abort, so nothing persists): **63 files, 3713 assertions, 1 environment-dependent failure** — 003 #16 expects 2 escalation notifications and saw 6 because escalation notifies every admin and the copy holds production's admins; behavior is correct, the fixture assumes one admin.
9. **Data after migration:** all counts unchanged; 0 providers listable (all `marketing_enabled=false`); all 19 legacy providers matching-eligible until exclusions and contacts are recorded — record them in the same window (admission is closed, so no request can be matched meanwhile). 3 legacy applications have no version rows and read as untracked (R0.4 D1).

**Production migration action (for owner approval):**
```
supabase migration repair --status applied --linked 20260808120000 20260809120000 20260809180000 20260809200000 20260810120000 20260810140000 20260810160000 20260810180000 20260810200000 20260810220000 20260810230000 20260811120000 20260815120000 20260815140000
supabase db push --linked --dry-run   # expect exactly the 81 files 20260903160000 … 20260930002000
supabase db push --linked
```
The repair writes only the migration history table. Rollback: forward fixes; the restore point is the daily backup taken before the window.

## Rehearsal option comparison

| Option | Production data | Storage objects | Incremental cost |
|---|---|---|---|
| Supabase branch | Only with **Include data**, which requires the PITR add-on | Not copied | Branch compute from $0.01344/h (not covered by compute credits) plus the PITR add-on |
| **Restore backup to a new project (chosen)** | Yes: database, schema, Auth users with hashed passwords, Vault keys, from today's physical backup | Not copied (10 vendor-media files; recreate synthetically) | Micro compute $0.01344/h (≈ $0.32/day; the org's compute credit is already used), disk within the included 8 GB; Supabase shows the estimate before confirming. Delete after the rehearsal: expected under $2 |

Restoring enables all extensions; production has `pg_cron`/`pg_net` but **no cron jobs**, so nothing runs against external services. Auth settings, Edge functions, secrets and Storage are not copied, which keeps the rehearsal from sending mail. Treat the restored copy as production data (no export, no screenshots of customer rows).

**Prepared action (needs owner approval before the charge):** Dashboard → project `mercurius-marketplace` → Database → Backups → *Restore to a new project* → backup 2026-09-30 10:17 UTC → Micro, same region (us-east-2) → name `mercurius-r0-rehearsal`. Then: `supabase db push` of the 95 migrations to that project, full SQL suite, drift check (`supabase db diff`), security advisor, exclusions/contacts on the copy, synthetic Storage upload, delete the project.

## Prepared hosted rollout (original plan; step status updated 2026-09-30)

Steps 2, 3 and 7 are done (verified below); steps 4–6, 8 and 9 remain. The current, exact package is in [Remaining hosted rollout package](#remaining-hosted-rollout-package).

1. Rehearsal above; record results here.
2. Production backup point: the daily physical backup taken before the window (or an on-demand backup), recorded.
3. Migration history repair for the 14 already-present migrations, then `supabase db push --linked --dry-run` → exactly the 81 files, then push in a low-traffic window (see Rehearsal).
4. Deploy `vendor-invite` from the release commit; set `MERCURIUS_INVITATION_PROJECT_REF=vugqqyemuptlvcieihww`, `MERCURIUS_INVITATION_SITE_ORIGIN` and `SITE_URL` = final origin, then `MERCURIUS_INVITATION_MODE=hosted` last.
5. Auth: Site URL = final origin; redirect allow-list `https://<origin>/set-password?invitation=*` (and `/**` for sign-up/recovery); invite subject and template from `supabase/templates/provider-invitation.html`; email link lifetime 10800 s; custom SMTP `smtp.resend.com:465`, user `resend`, password = Resend key, sender `no-reply@mercuriusmarketplace.com` (or the verified sender in use); raise the email rate limit from 2/hour.
6. Vercel: production deployment of the release commit (not promoted until migrations succeed); domain reassignment from `mercurius-landing-page` to the app (no GoDaddy change).
7. Operator data, in the same window as step 3: exclusions for the 11 records (Aristotle approved for archive 2026-09-30); owner-confirmed contacts for the eight real vendors (normalizes their email casing). Owner removes the two `@mercurius.com` test accounts (confirmed test accounts, 2026-09-30).
8. Hosted tests A–C from the R0.4 checklist, plus access test with the owner mailbox (below), then final-domain repeat.
9. Owner go/no-go including the DEC-2026-025 exception.

## Email

Resend: the domain was not verified in the Resend account (send refused 403); the owner verified it on 2026-09-30 and a test send from `notifications@mercuriusmarketplace.com` to the owner mailbox was accepted by Resend (HTTP 200). Inbox arrival is confirmed only by the owner. The key is kept in the git-ignored `.env.resend`.

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
8. Existing-account attempts show a plain acceptance link (no token; acceptance still requires signing in as the named account), added by the CodeRabbit review commit `578b36c`. It is not used for the eight real vendors, who have no accounts and receive Auth invitations; confirm whether operators may share it.

9. Light-only launch (DEC-2026-026): forced theme via next-themes rather than removing the provider; saved preference ignored, not erased; one constant for the TRACE-106 repair to flip.
10. Two homepage light-contrast fixes (coral CTA fill, slate-band secondary text) were made in this slice because light is now the only mode and they failed the new axe check; confirm they belong here rather than in a separate MDS slice.

## Open follow-ups

Dark-mode repair (TRACE-106); legacy Edge functions beyond checkout (`stripe-webhook` v13, `refund-invoice` v1, `customer-portal`, `list-payment-methods`, `beta-access`, `loyalty-recommend`, `job-lifecycle-worker`, `vendor-application-notify` all August builds) reviewed for redeploy; compliance path for access-managed providers (real application or cutover evidence); backup administrator (exception recorded); `@mercurius.com` admin accounts; Aristotle disposition (archive recommended; see handoff); contact-form and renewal owner-email ledger (R0.4 D10).
