# R0.3 homeowner early-access experience — TRACE-103

**Branch:** `codex/r0-early-access-ui` from PR #70 head `1965383` (R0.2 on integrated R0.1 and Phase 6.3), merged with PR #69 head `6c20314` (neutral account-response wording in the approved experience) as `791e1c9`.
**Status:** implementation checkpoint for Codex review. Not deployed; no hosted schema, Auth, email, domain, admission or booking change.
**Governing sources:** [approved experience](HOMEOWNER-EARLY-ACCESS-EXPERIENCE.md) (Josh, 2026-09-28) under its [reconciliation](HOMEOWNER-EARLY-ACCESS-RECONCILIATION.md); MDS R0 addendum; MPS/MTS R0 addenda; [layered-launch decision](LAYERED-LAUNCH-DECISION.md); DEC-2026-023.

## Characterized baseline

Before this slice every public booking entry point (header, home hero and plan builder, services/pricing rows, provider directory and profile, homeowners, how-it-works, FAQ) led to `/request`, which let anonymous visitors plan and then sign in to submit. R0.1 made the request and checkout commands refuse unadmitted accounts, so those routes now ended in a backend refusal. The dashboard and sidebar always offered **Request Service**. `/register` promised to "request local services" and showed Supabase's raw sign-up error. No UI read R0.2 interest, and R0.1 exposed no admission readback to the account.

## Route and state coverage

| Route / surface | States implemented | Authority used |
|---|---|---|
| `/early-access` (new) | Approved two-column desktop / stacked mobile composition; email, Lee ZIP, live-catalog services or "I’m still exploring", optional first name, separate unchecked marketing choice; preselected services from `?service=`; validation summary; confirmed-save result with optional account; out-of-area boundary with a separate, explicit expansion save and its own result; refusal/rate limit; storage failure ("not saved"); unknown confirmation with **Check submission** (same payload, deduplicated by R0.2); catalog failure with retry | R0.2 `/api/early-access` (unchanged) |
| `/register` | Early-access explanation; same-tab email prefill from the confirmed save (session storage, never a URL); one neutral **Check your email** answer for new and existing addresses; other errors still shown; link to list-only participation | Supabase Auth sign-up (unchanged) |
| `/login` | Copy mentions early-access status; existing `/request` continuation unchanged for invited accounts | — |
| `/dashboard` | **Waiting home** for a non-invited account with no history (status banner, interests card, explore, next steps, account); **Invited to book** banner with service/ZIP scope and **Request a service**; **closed** banner plus full history for non-invited accounts with records; revoked and unavailable variants; access-check failure alert with retry (request actions hidden, records kept) | R0.1 via new readback; R0.2 `r0_my_interest` |
| Interests card | Read, edit (ZIP/services/first name), save readback, boundary, verification pending, missing-interest recovery, withdrawn state, leave-the-list confirmation; expansion interest noted as not eligible | R0.2 account commands |
| `/account` | **Email preferences** switch for the independent marketing choice, read back from the command; verification pending | R0.2 `r0_set_my_marketing` |
| Homeowner sidebar | **Request Service** only when invited; a waiting account without history sees Overview, Notifications, Account Settings only; history keeps every area | Same |
| `/request` | Closed states for signed out, waiting, revoked, unavailable, not a homeowner, access-check error (retry); service context carried to early access; **Sign in to request service** for invited visitors; invited accounts see their scope and a scoped explanation when the command refuses a cell. The unsubmitted draft is kept, never shown | R0.1 command still enforces |
| `/checkout/[snapshotId]` | Breakdown stays readable as a record; checkout offered only when the account is admitted for the request's ZIP and service; never-invited, revoked, other-cell and access-error states explain and link support | R0.1 `money_prepare_checkout` still enforces; DEC-2026-023 |
| Public CTAs | Header, footer, home hero/final CTA/negotiated-rates, homeowners, services (hero, rows, CTA), pricing (rows, CTA), providers (CTA, empty and error states), provider profile, how-it-works, FAQ: **Join early access** with service context where known. Plan builder and provider-profile actions keep the real request path only for an admitted account | MDS R0 addendum; reconciliation conflict 1 |

## Backend addition

R0.1 gave the account no way to read its own admission, so the invited, revoked and unavailable states had no authoritative source. Additive migration `20260929002000_r0_my_trial_access.sql` adds `public.r0_my_trial_access()`: `stable`, `security definer`, authenticated only (revoked from `anon` and `service_role`). It returns the caller's homeowner flag and own cells as ZIP, service ID/name, derived state (`active`, `unavailable` when the Lee ZIP, coverage or service is inactive, `revoked`) and change time. It returns no operator identity, reason or other homeowner, writes nothing, and grants nothing: the request and checkout commands decide admission as before.

## Verification

Local, 2026-09-29. Host shared with other sessions and Supabase stacks; one run hit load average ~150 and a host reboot.

- **SQL 070** `r0_my_trial_access`: **17/17**, migration plus test applied in one transaction on the throwaway `mercurius_r0_integration` stack (R0.2 head applied) and rolled back. Covers privilege boundary, stable volatility, unauthenticated refusal, default-closed, own-cell isolation, catalog names, no operator/reason fields, unavailable for inactive area/service/non-Lee ZIP, revoked, the readback not opening a revoked cell, and no admission event written.
- **Unit:** 21 files **331/331** (320 existing + 11 in `tests/unit/early-access-experience.test.ts`: links and query parsing, fail-closed parsing, booking-state precedence, cell matching, scope wording, interest parsing, join-outcome mapping, neutral sign-up error detection).
- **Typecheck, full ESLint, secret scan, `git diff --check`:** clean.
- **Production build** with the CI synthetic env: PASS; `/early-access` builds as a dynamic route.
- **Browser (Playwright, synthetic fixture, reduced motion):**
  - `early-access-account.spec.ts` **21/21** (waiting home, recovery and save readback, boundary, unverified, leave list, revoked without history, invited scope, revoked with history, access error and retry, email preferences by keyboard, axe/reflow light/dark 320/1440 for waiting and invited, editor at 320, 640px/200% zoom).
  - `early-access.spec.ts` **36/36**: composition, validation summary, preselection, catalog failure, confirmed save and exact minimal payload, independent marketing, boundary → expansion, ZIP change, refusal, storage failure, unconfirmed resend, keyboard-only completion, signed-in pointer, neutral account answer for new vs existing address, other sign-up errors, public CTAs on seven routes, axe/reflow light/dark at 320/390/768/1440 plus result and error states, 200% zoom, 44px targets. See the full-suite line below for the final count.
  - `money.spec.ts` adds never-invited, revoked, other-cell and access-error checkout states; existing pay-flow cases now run with an admitted fixture.
  - `request.spec.ts` adds 12 R0 cases (five closed states, service context, access error and retry, invited scope and scoped refusal, closed-state axe light/dark 320/1440).
  - Full non-visual suite (`--grep-invert @visual`, all 26 spec files): **401/401 passed** (22.6 min). After two layout fixes found in screenshot review (desktop fact-list gap, stretched interests card), `early-access` + `early-access-account` were rerun on a fresh build: **57/57**.
  - Earlier runs under host load average ~150 produced 30-second timeouts in axe/click steps. They passed unchanged once the load dropped. The same runs exposed and fixed two real defects: focus was lost after an out-of-area save because the field was still disabled, and a preselected category collapsed when “I’m still exploring” was chosen.
- **Screenshot review (by the implementer, not a human accessibility pass):** form, result, `/request` closed state and waiting home at 375/1440, light/dark.
- **Not run:** `@visual` baselines (the invited scope banner changes `request-review-*`/`request-confirmation-*`; they need regeneration and review), CI, full SQL suite and blank reset with the new migration, security advisor, real Next-route integration against a running database, human screen reader, physical-device and real browser-zoom checks.

## Changed existing tests (intentional behavior change)

- `request.spec.ts`: anonymous continuation, signed-out draft privacy and signed-out photo warning now assert the closed state; the invited sign-in still keeps the draft and never auto-submits. The request intake defaults to an invited account.
- `mds.spec.ts`: the mobile menu's booking link is **Join early access**.
- `money.spec.ts`: existing checkout cases admit the synthetic invoice's cell.
- `tests/fixtures/portal-server.mjs`: R0 readbacks default to closed; the obligation names its request; `service_requests` honours an `id=eq.` filter.

## Decisions for Codex review

1. **D1 readback command** above: additive, least-privilege; confirm scope and field set.
2. **D2 no release flag:** R0 presentation is unconditional in code. R1 reopening needs a reviewed change or explicit release control, as the experience requires. A `NEXT_PUBLIC_` flag was not used because MTS forbids it as an authority.
3. **D3 header label:** always **Join early access**, even for an invited account (the header does not read admission). Invited accounts get **Request a service** from the dashboard, sidebar, plan builder and provider profile.
4. **D4 checkout:** the Edge handler still maps every `money_prepare_checkout` error to `CHECKOUT_NOT_READY`, and money mode is disabled in R0, so the review page pre-checks the cell for honest copy. No Edge change in this slice.
5. **D5 legacy invoice Pay button** stays on the dashboard for accounts with history. With money mode off (R0) the Edge function already answers "Online payment is awaiting verification"; with money mode on it would lead to the review page, which shows the closed state. Alternative: hide it for non-admitted accounts.
6. **D6 neutral duplicate:** every confirmed save shows "You’re on the early-access list." Edge case from R0.2: an address withdrawn but kept under a hold still receives `saved` without being reactivated, so that heading would be inaccurate for it. Needs an owner/R0.2 decision on the wording or the command.
7. **D7 expansion result** offers no account step, to avoid implying invitation eligibility.
8. **D8 waiting-home test** is "no service requests and no invoices"; if that read fails, history is assumed present so nothing legitimate is hidden.
9. **D9 verification redirect:** sign-up keeps `emailRedirectTo` = site origin; a dashboard redirect would need a hosted Auth allow-list change (external action).
10. **D10 no expired state:** R0.1 admissions carry no expiry; only revoked and unavailable are rendered.
11. **D11 copy removed:** an unapproved "we use your details only for…" privacy sentence was drafted and removed; privacy wording remains an R0.2 gate. The services page's sourcing link now carries the real service ID instead of `general-home-service`.

## Unresolved gates

- Codex review of this diff and D1–D11; CI on the pushed branch.
- Human screen-reader pass (VoiceOver/NVDA) and real 200% browser zoom on desktop and mobile. The automated axe, focus, live-region and 640px reflow checks are proxies, not that evidence.
- `@visual` baseline regeneration and review.
- R0.2 open items still gate live collection: privacy/consent wording, double opt-in, expansion retention, confirmation/status email delivery.
- Full SQL suite and blank reset including `20260929002000`; security advisor.
- R0.4 vendor/operator readiness and R0.5 hosted release candidate, owner go/no-go.

## Rollback

Code: redeploy the previous build. Database: the migration only adds one read-only function; roll forward by revoking its grant in a reviewed migration.
