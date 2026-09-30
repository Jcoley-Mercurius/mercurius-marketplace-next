# R0.4 vendor and operator readiness — TRACE-104

**Branch:** `codex/r0-vendor-readiness` = R0.3 head `3b2c7f6` (PR #71, open) merged with `main` `80a9aa6` (R0.1 #69 and R0.2 #70 integrated) as `ac8a502`.
**Status:** implementation checkpoint for Codex review. Nothing deployed; no hosted schema, Auth, Storage, email, DNS, operator, admission or transaction change. No real email or invitation was sent.
**Governing sources:** [layered-launch decision](LAYERED-LAUNCH-DECISION.md) §R0 vendor and operator contract; CFG-002/003/010/013/014; MPS §§8–9 and R0 addendum; MDS R0 addendum; MTS §§4/8/9/11 and R0 addendum; [experience](HOMEOWNER-EARLY-ACCESS-EXPERIENCE.md) lines on email delivery and operations; Phase 5 application, document, invitation and compliance contracts.

## Base reconciliation (2026-09-30 ET)

- `main` is `80a9aa6`: R0.1 (#69) and R0.2 (#70) are merged. The earlier stacked PRs #66/#67 had merged into already-merged branches; their content reached `main` only through #69/#70 (verified with `git merge-base --is-ancestor`).
- R0.3 (#71, `codex/r0-early-access-ui` at `3b2c7f6`) is **open** and did not contain `87af7ab` (R0.2 governance update on `main`). Its first CI run failed in "Reconstruct database" because the Supabase stack did not start in the runner (infrastructure, three start attempts), not in a test.
- R0.4 needs R0.3's public CTAs and closed booking, so this branch merges `main` into the R0.3 head (clean; only `governance/R0-INTEREST.md` differed). A PR to `main` therefore shows R0.3's diff until #71 merges.

## Characterized baseline

| Area | Found | Disposition |
|---|---|---|
| Application submission | `/api/vendor-applications` validates, rate-limits, inserts with the service key (client INSERT revoked, TRACE-086), returns signed upload grants; an insert trigger notifies admins in-app. | Reused unchanged. |
| Owner email | Sent in `after()` via Resend; a failure was only `console.error`. No record of outcome, no retry, no operator readback. Fallback recipient `j.coley@…` was wrong. | **Gap repaired** (below). |
| Private documents | `vendor-documents` bucket; admin-only signed links (10 min); retention/closure (TRACE-084/093). | Reused; new SQL denial checks. |
| Review, approval, denial | Onboarding review, compliance evidence, closure (reject/abandon) under TRACE-061/065/084. | Reused unchanged. |
| Invitation | `vendor-invite` Edge function: reservation, provider-accepted/unknown/refused, reconcile, close, recipient acceptance, identity binding, 3-hour scanner-safe link (TRACE-063/066–071). Per-provider panel only. | Reused; **cross-provider attention readback added**. |
| Vendor portal | Profile, packages, compliance. Dashboard said "ready for matched work"; nothing said booking was closed. "View storefront" used `is_active && marketing_enabled`. No coverage view. | **Recruiting notice, server listing readback, coverage readback added.** |
| Public listing | Anonymous RLS allowed every `is_active` contractor; directory, profile and spotlight filtered only `is_active`. Pricing/home row already used matching eligibility. | **Server listing rule added.** |
| Contacts | Footer/contact/privacy/terms used `hello@mercurius.com`. | **Owner-confirmed values applied.** |

## Changes

### Owner-notification delivery ledger (migration `20260929003000`)

- `private.r0_application_notifications` is created by an `AFTER INSERT` trigger on `vendor_applications`, in the **same transaction** as the application. A saved application always has a delivery record; nothing about email can hide it.
- The route claims (`r0_claim_application_notification`, service key only), sends with Resend `Idempotency-Key: vendor-application-notification:<id>:<attempt>` and a 10 s timeout, then records the outcome against the claim (`r0_record_application_notification`). Email content is read from the saved row, never from the caller.
- Outcomes: `sent` (Resend accepted — **not** proof of inbox delivery), `failed` (definite refusal or missing configuration), `unknown` (timeout, network error, 5xx, 409). A record left `pending` or `sending` for 10 minutes reads as `missed` or `unknown`, so a killed serverless invocation is still detected.
- Operators (existing onboarding operator boundary: admin role) read `r0_application_notification_overview()`, request one more attempt with `r0_request_application_notification_resend(id, confirm)` or acknowledge with a reason. Unknown and untracked (pre-migration) notifications require an explicit "checked the inbox" confirmation because a duplicate owner email is possible. A `sent` notification cannot be resent. Stale senders cannot overwrite a newer claim or an acknowledgement.
- `/api/admin/application-notifications` authorizes through the operator's session in the database, then claims and sends with the service client. Recovery creates no application, account, role, invitation or listing.
- Provider error text is stored redacted (addresses removed, 500 chars). Every transition is audited without contact data.

### Invitation attention

`r0_invitation_attention()` (admin) lists the newest attempt per non-rejected provider that is uncertain, refused (`email_exists`), expired without acceptance, or provider-accepted more than 3 hours ago without acceptance (link lapsed). Recovery stays in the existing Provider invitation panel (reconcile by exact account ID, bind, revoke/expire, prepare new). No invitation logic changed.

### Truthful public listing

- `r0_provider_listable(id)`: active, not paused (`marketing_enabled`), **real content** (name, description, at least one active catalog service), and `private.vendor_matching_eligible` (the existing TRACE-060/061 decision).
- `private.r0_public_listing_exclusions`: an operator hides a test, fake or duplicate record with a reason (`r0_set_public_listing_exclusion`, audited, reversible). `vendor_matching_eligible` now also refuses excluded records, so they leave matching, public pricing (`find_public_eligible_providers`) and the home provider row too. **Nothing is deleted**; history, documents and signed-in history reads remain.
- `r0_public_providers(id?)` returns only listed providers with public profile fields. `/providers`, `/providers/[id]` and the home Spotlight use it; a featured placement shows only while its provider is listed.
- The anonymous contractor SELECT policy now uses the listing rule. Signed-in users keep the `is_active` rule so homeowners and vendors still see providers on their existing records.
- `r0_public_listing_inventory()` (admin) is the reviewed **cleanup inventory**: per contractor, eligibility, content, listing, exclusion, a name/email test-record signal, featured flag and request/invoice/review counts. The signal only prompts review.

### Vendor portal

- `/vendor` and `/vendor/jobs`: "Homeowner booking has not opened to the public yet" with honest guidance; the empty offers state says offers are rare while booking is by invitation. Existing jobs and history render unchanged below.
- `/vendor`: Public listing card from `r0_my_provider_listing()` (own record only): listed or not, preparation steps with links (description/services → profile, approval → compliance), service ZIPs on file with "ask for a change". "View storefront" appears only when the server says listed.

### Operator page

`/admin/recruiting` (sidebar **Recruiting Readiness**): application emails needing attention (show all on demand), resend/acknowledge with confirmation; invitations needing follow-up with a link that opens the application (`/admin/applications?application=<id>`); public listings with blockers, history, test signal and hide/restore.

### Contacts

Support/privacy email `hello@mercuriusmarketplace.com` in footer (now a mailto link), contact, privacy and terms; phone stays 239-339-3895 (owner corrected 2026-09-30). Owner-notification fallback `jcoley@mercuriusmarketplace.com`.

## Email paths and hosted configuration (no secrets)

| Path | Transport | Configuration names | R0 role |
|---|---|---|---|
| Vendor application → owner | Next route → Resend API | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified domain, SPF/DKIM), `OWNER_NOTIFICATION_EMAIL` (optional override), `SUPABASE_SERVICE_ROLE_KEY` | Required; tracked by the ledger above |
| Contact form and renewal documents → owner | Same helper | Same | Unchanged; not tracked by the ledger (follow-up) |
| Approved vendor → account invitation | `vendor-invite` Edge → Supabase Auth invite via custom SMTP | Edge: `SITE_URL`, `MERCURIUS_INVITATION_PROJECT_REF`, `MERCURIUS_INVITATION_SITE_ORIGIN`, `MERCURIUS_INVITATION_MODE=hosted` (last). Auth: Site URL = production origin; redirect `https://<site-host>/set-password?invitation=*`; invite subject/template from `supabase/templates/provider-invitation.html`; email link expiry 10800 s; custom SMTP (Resend) with verified sender | Required |
| Homeowner account verification and recovery | Supabase Auth via the same SMTP | Auth Site URL and redirect allow-list for the site origin (sign-up keeps `emailRedirectTo` = site origin, R0.3 D9) | Required for the optional account |
| Early-access confirmation/status, marketing | None sent in R0 | — | Not in the approved R0 flow ("We'll email you if selected" is later manual trial communication) |

**Suppression:** R0 sends no Resend-API mail to homeowners or vendors. Owner notifications go to Josh; Auth mail uses Resend SMTP, where Resend's own suppression list applies. Wiring Resend bounce/complaint webhooks to R0.2's `r0_record_email_suppression` becomes required when early-access status or marketing mail is sent; no marketing-consent policy was invented here.

**Evidence limits:** unit tests mock Resend; SQL tests exercise the ledger. Nothing here proves hosted delivery, sender verification, SMTP, Auth template rendering or inbox arrival.

## Verification (local, 2026-09-30)

Host shared with other stacks and rebooted once mid-session; load average 18–70.

- **SQL 071** `r0_vendor_readiness`: **75/75** (R0.3 and R0.4 migrations plus the test in one rolled-back transaction on the throwaway `mercurius_r0_integration` stack). Covers least privilege for every table/function, same-transaction delivery record, single initial and resend winner, forged/stale claim refusal, redaction, failure leaving the application pending, operator-only readback/commands, idempotent resend request, sent-not-resendable, no duplicate application, audit trail, missed/unknown detection, confirmation for unknown/untracked, acknowledgement over a lost sender, applicant gets no vendor role/provider/application read/listing, vendor-documents denied to anon/applicant/other user and allowed to admin, listing rule across unapproved/empty/inactive/retired-service/paused/excluded, exclusion idempotent, non-destructive and removing matching, anonymous vs signed-in RLS, inventory signal/blockers, vendor readback and invitation attention.
- **Blank reset replay:** `supabase db reset --local` on the throwaway stack from a copy of this branch's `supabase/` (only project ID/ports differ) applied all 176 migrations through `20260929003000` and the seed. The CLI then reported the local Storage container unhealthy on restart, the same local failure R0.1 recorded; the database was complete.
- **Full SQL suite** on that replay, one rolled-back transaction per file: **3583/3583 across 62 files, 0 errors** (= R0.2 integration 3491 + 070's 17 + 071's 75). The first pass found one real contract failure: suite 001's anonymous-RPC allowlist did not include the two new public reads; they were added deliberately (001 now 19/19).
- **Security advisor** (`supabase db advisors --db-url …56522 --type security --level warn --fail-on error`): **no issues**. A first attempt with `--local --workdir` silently connected to another project's local database; that output was discarded.
- **Generated types:** `database.types.ts` had not been regenerated since TRACE-098. Regenerated from the replay: additions only (R0.1–R0.4 functions, 126 lines), no removals; typecheck passes against it.
- **Unit:** `tests/unit/vendor-readiness.test.ts` **21/21** (twice): idempotency header and provider id, definite vs uncertain outcomes per HTTP status/timeout/missing config, owner fallback, claim/send/record flow, unrecorded outcome, claim failure, **route answers 201 and keeps the saved application when the email fails or the ledger is unreachable**, presentation helpers. `vitest.config.mts` now aliases `@/` and stubs Next's bundled `server-only` so server modules can be unit tested.
- **Full unit suite:** 22 files **352/352**. **Typecheck, full ESLint, secret scan, `git diff --check`:** pass.
- **Full non-visual browser suite** (`--grep-invert @visual`, all 27 spec files, final build): **416/416** (24 min).
- **Production build** (CI synthetic env, one worker): PASS; `/admin/recruiting` static, `/api/admin/application-notifications` dynamic.
- **Browser:** `tests/e2e/vendor-readiness.spec.ts` **15/15** against the synthetic fixture (new handlers for R0.4 reads, the vendor contact read and HEAD count reads; every write still refuses). Covers the vendor recruiting notice, listing steps and ZIP readback, no storefront link when not listed, existing jobs kept on `/vendor/jobs`, axe WCAG 2.2 AA and no horizontal scroll at 320/1440 light/dark for the vendor overview and `/admin/recruiting`, attention-only default and show-all, invitation link, test-record and history display, unknown-email confirmation copy, a refused resend that stays open with its error and never claims success, reason-required acknowledge/hide, the application deep link and non-admin refusal.
- **Accessibility fix found by that spec:** the pre-existing vendor overview had light-mode muted text on `accent-subtle` surfaces at 4.34:1 (launch readiness, soft-launch terms, earnings header, emphasized metric, first recommendation); raised to AA on those surfaces only, without changing global tokens or other pages.
- **Not run:** human screen reader and real browser zoom; hosted anything; `@visual` baselines; a multi-process concurrency script for the ledger (claims are row-locked and checked sequentially in SQL 071); CI on this branch at the time of writing.

## Decisions for Codex review

1. **D1 — ledger created by trigger**, not by the route, so the application and its delivery record commit together. Pre-migration applications read as `untracked`; only pending ones are flagged.
2. **D2 — admin role as operator** for email recovery and listing exclusions, reusing `vendor_require_operator` (the application/onboarding boundary), not the R0.1 trial-admission roster.
3. **D3 — duplicate owner email over lost application:** unknown/untracked resend is allowed only with explicit confirmation; Resend idempotency keys are per attempt.
4. **D4 — "real content" = name, description, one active catalog service.** Logo, photos, prices and ZIPs are not required. Confirm or tighten.
5. **D5 — exclusion also removes matching** (test records must not receive offers). It never deletes. Suspension of a genuine provider stays in compliance.
6. **D6 — signed-in contractor reads keep `is_active`** to preserve history; the directory, profile and spotlight use the listing projection for everyone.
7. **D7 — Spotlight subtitle** changed from "Live Mercurius partners recognized for strong service" (unsupported trust claim before R1) to "Approved providers selected by Mercurius". Featured placement is operator-curated, not paid.
8. **D8 — coverage is read-only to vendors.** RLS already lets a vendor write its own `contractor_service_zips`, but there is no reviewed UI and ZIP scope feeds compliance requirements (TRACE-061). Vendors see ZIPs and ask for changes; operators edit on `/admin/vendors/[id]`. Availability remains `marketing_enabled` (operator-set) plus the compliance `availability` evidence; no structured schedule exists in MPS/MTS.
9. **D9 — trial-admission operator UI** (R0-ADMISSION.md "requires a separate operator readback and UI in TRACE-104") is **not built**: it serves admitting homeowners, which this prompt forbids and R0 recruiting does not need (admission stays default-closed). Carry to R0.5/R1 preparation.
10. **D10 — contact form and renewal-document owner emails** still only log failures; they have their own admin queues. Extend the ledger if R0.5 wants the same guarantee.

## Owner assignments and unresolved decisions

- **Backup admin — CONFLICT, owner decision required.** The layered-launch contract and R0 gate require a named least-privilege backup admin for applications, missed email, privacy requests and urgent support before R0. Josh confirmed on 2026-09-29 that there is none. Name one, or record an explicit owner exception in the decision log. No person, address or privilege was invented or provisioned.
- **Contacts:** support/privacy `hello@mercuriusmarketplace.com`, 239-339-3895; owner notifications `jcoley@mercuriusmarketplace.com` (Josh, 2026-09-29/30). Confirm the mailbox is monitored under CFG-010 hours.
- **Hosted operator identity:** Josh's hosted admin role was not verified in this slice; the R0.1 trial-operator roster is empty by design. Verifying and provisioning either is an R0.5 external action.
- Carried open items: R0.2 double opt-in, expansion-interest retention, privacy/consent wording; R0.3 D1–D11; Founding Vendor and Credits source artifacts (R1).

## R0.5 checklist (hosted acceptance and cutover)

Each step needs its specific owner authorization; record evidence without secrets, tokens, real addresses or links.

1. Merge order: #71 (R0.3) then this PR; confirm green CI on the final `main` head.
2. Recalculate the [hosted migration plan](HOSTED-MIGRATION-ROLLOUT.md) for that head (hosted history ended `20260731172714`); rehearse on a restored copy of production-shaped data; verify backup and restore (CFG-011).
3. Run `r0_public_listing_inventory()` on the rehearsal copy; owner reviews every `test_signal`, not-listed-but-active and featured record; apply exclusions with reasons. Delete nothing.
4. Configure Resend: verified sending domain (SPF/DKIM), `RESEND_FROM_EMAIL`, `RESEND_API_KEY`, `OWNER_NOTIFICATION_EMAIL` in Vercel server env; Supabase custom SMTP through Resend.
5. Configure Auth: Site URL, redirect allow-list (site origin and `/set-password?invitation=*`), invite subject/template, 10800 s link expiry; Edge secrets and `vendor-invite` deploy per the [hosted invitation runbook](PHASE-5-HOSTED-INVITATION-DELIVERY.md).
6. **Hosted test A:** synthetic vendor application with a private PDF → admin queue shows it and the document opens by signed link → owner email arrives from the verified sender → `/admin/recruiting` shows `sent`. Then force a failure (e.g. temporarily invalid sender on a preview) and prove the application stays visible, the failure appears, and resend/acknowledge work once.
7. **Hosted test B:** approve the synthetic applicant → Auth invitation arrives with the reviewed template → link survives a scanner GET → password setup → acceptance → identity binding → vendor login sees the recruiting notice and not-listed state → a second invite to a confirmed address records the refusal. Close or clean up synthetic records.
8. **Hosted test C:** homeowner early-access join → optional account → verification email arrives → sign in → waiting home. No other homeowner email is expected in R0.
9. Prove `/request`, checkout and the request/checkout RPCs refuse a non-admitted homeowner on the hosted stack; money mode stays disabled.
10. Accessibility: human screen reader and 200% zoom on the early-access, vendor and admin recruiting pages; `@visual` baselines reviewed.
11. Monitoring and support: daily `/admin/recruiting` check owner named; Vercel/Supabase log access; rollback rehearsal (previous deployment; forward-fix migrations).
12. Backup admin named or exception recorded; contacts confirmed.
13. Vercel production promotion from the fixed commit (Git deploy is disabled in `vercel.json`), then GoDaddy DNS to Vercel with TTL lowered in advance, TLS verified, old target retained for rollback; re-run smoke tests A–C on the production domain.
14. Owner records the dated R0 go/no-go.

## Rollback

Code: redeploy the previous build. Database: the migration is additive (private tables, functions, one trigger, one replaced public-read policy, one redefined private eligibility function). Forward fix by restoring the prior anonymous policy and `vendor_matching_eligible` body in a reviewed migration; keep ledger and exclusion records.
