# Phase 7.2C-2 — renewal owner-email ledger implementation (TRACE-154)

**Status: IMPLEMENTED on draft PR #167; MIGRATION PUSHED TO HOSTED 2026-11-13 on the owner's instruction (§6.1).** Exact-head CI 43419555745 passed on `f5305c2`. Not merged or deployed; Codex review pending; no email sent. The handoff as Codex issued it is kept unchanged in the appendix.
**Base:** `main` `24dd455acd520a21da14b0305a92383fbedfcccf`, the #166 merge. 7.2C-1's reviewed head passed all PR CI jobs; production is READY and the fresh rollout count is zero. Main merge CI 43343682357 was still running when this handoff was prepared. Read the [release checkpoint](PHASE-7-OWNER-EMAIL-LEDGER-CODEX-REVIEW.md) before proceeding.

The owner authorized review, fixes, release, rollout reconciliation and starting this renewal slice. O-1 (DEC-2026-066) and Codex C-1..C-8 remain settled. No new owner decision is required for the scope below. This does not authorize a renewal hosted push or release.

## 1. Baseline verification (before any application or database edit)

| Check | Result |
|---|---|
| Branch / PR | `codex/phase7-2c2-renewal-handoff`, draft PR #167, head at start `7dcd335` (documentation only, on top of `main`) |
| `origin/main` | `24dd455acd520a21da14b0305a92383fbedfcccf` (#166 merge); unchanged through implementation; `main` is an ancestor of the PR head |
| Main merge CI | Run [43343682357](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/43343682357) was still running at the start; waited without rerunning. It **completed with success**: backend, lifecycle and application all PASS on `24dd455` |
| Working tree | Clean at start; no unrelated work present |

## 2. What changed

| Area | Change |
|---|---|
| Migration `20261123001000_phase7_owner_email_renewal_trigger.sql` | Additive. One function, `private.owner_email_renewal_create()`, and one trigger, `owner_email_renewal_create` (`AFTER INSERT ON public.vendor_renewal_documents FOR EACH ROW WHEN (new.submitted_as = 'provider')`). It inserts the pending ledger row and its creation event in the submitting transaction. EXECUTE is revoked from every client role. Nothing else is created, altered or restated. No backfill |
| `src/lib/ownerEmailNotifications.ts` | `OwnerEmailKind` adds `renewal_document`. `renewalNotificationMessage` has the old route's subject, body lines, `A provider`/`Compliance` fallbacks and no reply-to; `Submitted` is the saved `created_at`. Key `renewal-document-notification:<id>:<attempt>`. The claim must name the requested kind and, for renewal, carry a well-formed source. Otherwise `claim_failed` and nothing is sent. Shared sender and provider classifier unchanged |
| `src/app/api/renewal-documents/submit/route.ts` | Same validation, session, RPC, refusal mapping, response bodies and statuses. For `recorded && submitted_as === "provider"`, `after()` runs `deliverOwnerEmail(serviceClient(), "renewal_document", document_id, "initial")` inside a try/catch (`owner_email.background_failed`). The route no longer reads `contractors.name`; the claim does. The raw `console.error` calls are replaced by v2 `renewal_document_submission.saved` / `.failed` |
| `src/app/api/admin/owner-emails/route.ts` | Accepts exactly `contact_submission` or `renewal_document`; anything else is 400. Authorization, attestation, status mapping, lost-claim wording and no automatic retry are unchanged. The "refused" message names the saved record per kind |
| `src/lib/observability/operationalLog.ts` | v2 allowlists only: route `renewal_document_submit`; events `renewal_document_submission.saved`, `renewal_document_submission.failed`. v1 events, keys (14) and the 7.1 test are unchanged; v2 keeps 16 keys |
| `/admin/owner-emails` (`page.tsx`, `src/lib/ownerEmails.ts`) | All / Contact form / Renewal documents filter (`aria-pressed` group, as Compliance Expiry uses). Exact attention counts in total and per kind, from the overview. "Showing N of M" uses the selected kind's count. A filter change, toggle, refresh or completed action reloads from the first page, and earlier responses are discarded (generation ticket). Renewal rows show "Renewal document", the overview label and **Open Compliance Expiry** (`/admin/compliance/renewals`, no ID in the URL). "View submission" is on contact rows only. Attestation and confirmation copy name "renewal document" for renewal rows; contact wording is unchanged. "No recorded attempt" is kept |
| Tests | SQL 120 adapted and extended (§5). `scripts/owner-email-concurrency.mjs` gains a renewal section in the existing CI step. Unit tests in `tests/unit/owner-email-ledger.test.ts`. Browser tests in `tests/e2e/owner-emails.spec.ts`. `tests/fixtures/legacy-renewal-document-submit-route.ts` holds the pre-change route byte for byte below a marker line; a unit test checks its SHA-256 `979e5bfb…ef1f` |

**Not changed:** `vendor_submit_renewal_document` (hash `8c8942365d8f9d34bdcd1d839f86c472`); the twelve 7.2C-1 ledger functions (`12 | 016c0e683cb19c4c68769d87f5215ff1`); the application ledger (`10 | 5f14532a…`); `ownerNotifications.ts`; `applicationNotifications.ts`; the contact route; renewal upload/authorization; Compliance Expiry; recipients, retention and grants.

## 3. Implementation decisions and findings for Codex review

1. **Migration timestamp.** `supabase migration new` produced `20261113014623` (the current UTC time). That sorts *before* the hosted head `20261122001000`, so `db push` would refuse it as out of order. Renamed to `20261123001000`, the next step in the repository's future-dated sequence. Local replay applies it last (`max(version) = 20261123001000`).
2. **Queue label versus email item label (finding, not fixed).** The 7.2C-1 overview labels a license row "<business> — License". The email (and `renewalDocumentKindLabel`, DEC-2026-030) says "License or business tax receipt". The label is built inside `owner_email_overview` (hosted `20261122001000`), and this slice may not restate shared ledger RPCs. Recommendation: accept for now, or correct it in a later reviewed forward fix. Not blocking: it is an operator queue label, not customer wording.
3. **Missing name.** Every renewal document's provider has a `contractors` row (`vendor_renewal_documents → vendor_onboarding → contractors`), and `contractors.name` is NOT NULL, so in the database a "missing" name is a blank one. The claim returns it as stored. The email keeps the old route's exact expression (`name ?? "A provider"`, whitespace collapsed, 100 characters), so a blank name produces the same email as before. The overview label falls back to "A provider". A null name (unit tests) sends "A provider". A genuine claim failure sends nothing (plan §3.5.1; changed failure path, as recorded in R-2).
4. **Logging.** `renewal_document_submission.saved` is written for every newly recorded document (provider or operator) with only the document ID. A replay (`recorded: false`) and the existing 400/401/403/P0001 refusals write no line, as before. `.failed` carries only the classified code. Neither carries a name, file name, path, contractor ID or provider body.
5. **Claim validation.** A claim that names another kind, or whose renewal source is malformed, is treated as `claim_failed`: nothing is sent and nothing is reset. A claim that did commit stays `sending` and reads `unknown` after the window, under the existing attested recovery.
6. **Missing service configuration in `after()`.** `serviceClient()` runs inside the guarded callback. If it throws, the route has already answered 200, `owner_email.background_failed` is logged with `config_missing`, nothing is sent, and the row becomes `missed` after the window.
7. **Page copy.** The summary card is now "Owner emails needing attention" with Contact form / Renewal documents / Total. The list is "Tracked owner emails" (accessible name "Owner emails"). The historical note says "Messages and documents saved before email tracking began…".

## 4. Privacy

- The renewal ledger and events hold the document ID, states, codes, actor and reason only. SQL 120 §9.12 checks that no ledger row, event or overview item contains the file name, path, MIME type or submitter.
- The claim payload is exactly `id, created_at, kind, business_name` (SQL 120 §9.5, concurrency script).
- Logs carry `source_id` (UUID-validated) only. Unit tests put sentinel business names, file names, storage paths, contractor IDs and provider bodies into every route and failure path and check that none appears in a log line.
- Contact detail stays contact-only and on demand. Renewal rows have no detail action, and a renewal ID is refused by `owner_email_contact_submission` (P0002). URLs, analytics and summaries never carry contact content; the renewal link carries no ID.

## 5. Verification (local, synthetic, isolated)

| Check | Result |
|---|---|
| SQL 120 alone (clean replay) | **302/302** (7.2C-1: 207). The "no renewal trigger" assertion and the manual renewal ledger inserts are replaced by assertions on the real trigger. Contact, privacy, grants, paging and hash coverage is kept |
| SQL 120 renewal coverage (§9) | Provider-only creation through the real RPC; replay and operator suppression; forced ledger failure rolls the document back; claim payload; name read at claim time; forced claim fault leaves `pending`/0/no event, then `missed` → attested resend as attempt 1; lost committed claim → `sending` → `unknown` → attested acknowledgement; stale worker 40001 after a resend request; old route on the new schema (test 26); untracked history; cross-account, vendor, anon and operator-session claim boundaries; source privacy; exact per-kind counts; document immutability keeps its ledger row; blank-name label |
| SQL mutations (4) | Each caught: trigger without the provider-only `WHEN` (6 failures), trigger disabled, no creation event, trigger swallowing its own failure |
| Unchanged definitions | `vendor_submit_renewal_document` `8c8942365d8f9d34bdcd1d839f86c472`; 7.2C-1 ledger functions `12 \| 016c0e683cb19c4c68769d87f5215ff1`; application ledger `10 \| 5f14532aa26ed5400e73e210379aa4f8`; contact grants |
| Money fingerprint (local, after migration) | `58 \| af0fae6e0c5b604e9073e10bc060957e` |
| Concurrency (`owner-email-concurrency.mjs`, clean reset) | PASS. Contact section unchanged. Renewal: 8 racing submissions of one upload → 1 document, 1 row, 1 creation event; operator upload → no row; 8 initial claims → 1; 4 records → 1; anon, the provider itself and a member refused; 6 attested requests → 1 attempt; 9 mixed claims → 1 (attempt 2); stale worker refused; a claim committed while its client was killed → no automatic claim, attested recovery as attempt 2 |
| Unit `owner-email-ledger.test.ts` | **83/83** (7.2C-1: 54) |
| Unit mutations (6) | Each caught: operator uploads notify, renewal key prefix, builder trims the name, raw route error logged, no claim-kind check (after strengthening the wrong-kind test so it uses a renewal-shaped payload), `after()` delivery not guarded |
| Browser `owner-emails.spec.ts` | **24/24** (7.2C-1: 17), one worker, 6.2 min. See §5.1 |
| Full unit, SQL, lint, typecheck, secret scan, build | See §5.1 |
| Exact-head CI | [43419555745](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/43419555745) on `f5305c2`: backend, lifecycle and application PASS. SQL 111 files / 7,613; owner-email concurrency with its renewal section; unit 66 / 890; browser 711 passed |

### 5.1 Full-suite results

| Check | Result |
|---|---|
| Full unit suite | 66 files, **890 tests** (7.2C-1: 861). The 7.1 tracing test and its v1 exact-key test are unedited and pass |
| Full SQL suite, clean replay | **111 files, 7,613 tests, PASS** (7.2C-1: 7,518) |
| Concurrency, one clean reset, CI order | `phase5-renewal-document`, `phase5-renewal-retention`, `phase5-renewal-upload-retention`, `phase5-intake-limit`, `application-notification`, `owner-email`: all PASS; clean reset afterwards |
| Lint (`eslint .`, excluding the ignored `.phase5-local/**` copy), typecheck, secret scan, `git diff --check` | Pass |
| Production build | Pass with CI's synthetic public Supabase values and `MERCURIUS_BUILD_WORKERS=2`. The first attempt with default workers (15 static-generation workers on this 5 GB host) timed out generating unrelated static pages and aborted on `/request`; that is a host limit, not a code error |
| Browser `owner-emails.spec.ts` | **24/24.** The 7 new tests cover mixed-kind totals and per-kind counts, filter resets of paging (and refresh), tied cursors across kinds (180 rows, none skipped or repeated), stale-response discard, the renewal Compliance Expiry link and no contact detail on renewal rows, renewal resend/acknowledge attestations, the renewal lost-response regression (alert dialog checked first, then closed before reading rows), keyboard filters and axe/reflow at 320 and 1440 px, light and dark, with renewal rows. A first run with two workers under a load average near 10 had 16 timeouts or "session closed" errors, including untouched 7.2C-1 tests. One genuine test error was found and fixed: the expected kind split of the first mixed page (26/24, from the id tie-break). The rerun passed 24/24 |
| Browser mutation | The first-page load's stale-response check was removed and the page rebuilt: "a response for an earlier filter is discarded" fails. Restored afterwards |
| Full local browser suite | **Not run.** On this host the 7.2C-1 attempt stalled at 48/702. Exact-head CI is the authority |

## 6. Rollout and rollback (requires separate owner authorization; nothing performed)

1. Codex review; exact-head CI passes.
2. **With the owner's authorization:** `supabase db push --linked --dry-run` must list exactly `20261123001000_phase7_owner_email_renewal_trigger.sql`; then `supabase db push --linked`.
3. **Authorized read-only readback:** `owner_email_renewal_create` present and enabled (`O`) with the provider-only `WHEN`; function ACL owner-only; `vendor_submit_renewal_document` `8c894236…`; 7.2C-1 functions `12 | 016c0e68…`; fingerprint `58 | af0fae6e…`.
4. Merge, which deploys (DEC-2026-037).
5. **After the deploy:** an authorized read-only count of `renewal_document` rows created between the push and the deploy. During that window the old route still emails without claiming, so those rows become `missed` after 10 minutes. For each one, the operator checks the owner inbox and the Resend log, then acknowledges with the inbox-evidence attestation and a reason (email found) or resends with the no-email attestation. No bulk acknowledgement; nothing automatic. Operator uploads create no rows.

**Rollback.** App-only: `vercel promote` the previous deployment. Old code keeps emailing, and new provider renewals become `missed` noise. If that lasts more than briefly, a forward migration drops the renewal trigger. Ledger rows are kept as evidence. Schema defects are fixed forward.

## 6.1 Hosted migration (performed 2026-11-13, owner-authorized)

The owner instructed the push ("Please run the migration") after exact-head CI passed on `f5305c2`. Steps 2 and 3 of §6 were performed; nothing else was. Codex review had not yet happened.

| Step | Result |
|---|---|
| `supabase db push --linked --dry-run` | Exactly one pending migration: `20261123001000_phase7_owner_email_renewal_trigger.sql` |
| `supabase db push --linked` | Applied `20261123001000` |
| Read-only readback | Migration head `20261123001000`. `owner_email_renewal_create` is enabled (`O`) with `AFTER INSERT … FOR EACH ROW WHEN ((new.submitted_as = 'provider'::text))`. `owner_email_contact_create` is still enabled. The trigger function is security definer with `search_path=""`, is not executable by anon, authenticated or service_role, and its definition hash `b1607618f1af59ca19d9c6e5d0d410f5` equals local |
| Unchanged definitions (hosted) | `vendor_submit_renewal_document` `8c8942365d8f9d34bdcd1d839f86c472`; 7.2C-1 ledger functions `12 \| 016c0e683cb19c4c68769d87f5215ff1`. All equal to local |
| Money fingerprint (hosted) | `58 \| af0fae6e0c5b604e9073e10bc060957e` |
| Ledger rows at readback | 0 in total (no contact or renewal rows); 0 events. Counts only; no row contents were read |

**The push-to-deploy window is open.** Until this PR merges and deploys, the old renewal route keeps emailing without claiming. Each provider renewal saved in the window gets a `pending` row that becomes `missed` after 10 minutes and needs per-row attested handling (§6 step 5). Merge and deploy have not happened.

## 7. Unresolved and carried

- Codex review; merge/deploy; post-deploy window reconciliation. Not performed. The hosted push is done (§6.1).
- Finding §3.2 (queue label "License" vs. email "License or business tax receipt") needs a Codex decision.
- Real-email verification with the controlled mailbox (plan §6.4): separate and owner-authorized.
- Carried unchanged: CFG-011 log retention (7.6), A2 human verification, retrospective 7.2B review, final booking-candidate schema/grants, fingerprint and completion-integrity checks, the older intermittent accessibility failure (`request.spec.ts:837`), and the `offer_terms`/promotions gates. No payments, booking, Cron, retries or automation activated. Proposed channel/reminder/retention decisions remain proposals.

---

## Appendix — handoff as issued by Codex (unchanged)

### Prompt for Claude

Continue this draft PR on its existing branch. **Implement Phase 7.2C-2 only.**

1. Verify the current branch, working tree, `origin/main`, this PR's head and current CI. Preserve unrelated work. Before application/database edits, confirm main merge CI has succeeded; if it is still running, wait, and if it fails, diagnose and report the actual blocker rather than blindly rerunning it. Reconcile any newer main baseline explicitly.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/agent/HANDOFF.md`, the six repository authorities, the [approved plan](PHASE-7-OWNER-EMAIL-LEDGER-PLAN.md) (§0.2, §3.5.1, §4.4, §6 and §7), the [7.2C-1 record](PHASE-7-OWNER-EMAIL-LEDGER-7-2C-1.md), the [Codex checkpoint](PHASE-7-OWNER-EMAIL-LEDGER-CODEX-REVIEW.md), TRACE-154 and the booking-readiness register. Use the installed Next.js documentation for changed framework code.
3. Add **one additive migration for the renewal trigger only**. Provider inserts into `vendor_renewal_documents` create one pending ledger row and event in the same transaction. Operator uploads and existing-path replays create none. Generate with the CLI and verify migration ordering after `20261122001000`. Never edit an applied migration or restate `vendor_submit_renewal_document`, shared ledger RPCs or money-fingerprinted functions. No backfill.
4. Extend the shared delivery kind and message builder. In `src/app/api/renewal-documents/submit/route.ts`, call `deliverOwnerEmail(..., "renewal_document", document_id, "initial")` in guarded `after()` only for `recorded && submitted_as === "provider"`. Preserve validation, authorization, upload behavior, recipient, subject/body, response body/status and replay behavior. Read saved content from the claim; accepted differences are the saved timestamp and current business name. A missing name retains "A provider"; a genuine claim failure sends nothing. A lost claim response can follow a commit: never reset state or assume rollback.
5. Use `renewal-document-notification:<source-id>:<attempt>`. Extend the existing resend route to the two approved explicit kinds. Keep database authorization, passive expiry, no automatic reclaim/retry, stale-worker refusal, distinct resend/acknowledge attestations, and readback after returned errors or lost responses. Keep the truthful "No recorded attempt" label.
6. Extend the existing admin page with All / Contact form / Renewal documents filters, exact total/per-kind counts and bounded keyset paging. Reset paging on filter/action/refresh and reject stale responses. Renewal rows link to `/admin/compliance/renewals`. Contact details remain contact-only, opened on demand. Never put contact content in summaries, logs, analytics or URLs. Follow existing MDS queue and confirmation patterns.
7. Add renewal route/event names to the v2 logger allowlists and replace raw renewal-submit errors. Preserve the v1 logger's exact 14 keys and its tests unchanged; v2 keeps 16. No names, file names/paths, record content, provider bodies, claim IDs, keys, actor IDs or acknowledgement reasons in logs. Keep the shared sender and provider classifier unchanged.
8. Update this document with implementation evidence, TRACE-154 and the handoff. Preserve the dated 7.2C-1 release evidence. Rewrite the PR title/body around the actual implementation when ready for Codex.

### Acceptance evidence

Follow plan §6, including:

- Preserve the pre-change renewal route byte-for-byte as a synthetic content-parity and old-application fixture. Verify unchanged 200 success despite email/claim/logger failure, replay/operator suppression, saved time/current name and missing-name fallback.
- SQL: provider-only atomic creation and rollback through the real submit RPC; no duplicate on replay; expired claims and attested recovery; missing name versus genuine claim failure; source privacy; operator, service-only and cross-account boundaries.
- **Adapt SQL 120 to the combined schema.** It currently asserts no renewal trigger and no auto-created renewal ledger rows, then manually inserts reserved renewal fixtures. Update those assertions and remove conflicting manual inserts. Preserve contact/privacy/grants/paging/hash coverage; do not disable the new trigger or weaken checks.
- Real-database renewal concurrency: initial claims, outcome races, authorized resend attempts and stale workers. Keep contact/application regression coverage; use the existing CI step where practical.
- Unit: every provider outcome; failed/lost claims and records; per-kind/per-attempt keys and replay; route/auth/status boundaries; redaction and exact schemas.
- Browser: mixed-kind totals/filter/paging/tied cursors/stale responses; renewal destination; contact-only detail privacy; both kinds' recovery and lost-response regressions; roles, loading/error/empty, keyboard, axe and 320/1440 px light/dark. When a modal remains open, assert dialog behavior first and close it before locating background rows by role.
- Full local SQL/unit/lint/typecheck/secret/build and applicable browser checks; full exact-head backend/lifecycle/application CI. Report environment-blocked checks as blocked.
- Fingerprint unchanged: `58 | af0fae6e0c5b604e9073e10bc060957e`; renewal submit definition hash `8c8942365d8f9d34bdcd1d839f86c472`; application-ledger functions unchanged. This does not close final booking-candidate verification.

### Stop boundary

Push a reviewable implementation to this **draft PR** and return exact base/head, changed files, results, rollout/rollback plan and unresolved checks for Codex review.

**Do not push the renewal migration to hosted, merge/deploy this PR, send a real email, change hosted resources, or activate payments, booking, offer terms, promotions, Cron, retries or other automation.** The renewal push requires separate owner authorization after review. Keep CFG-011, A2, retrospective 7.2B review, final booking-readiness checks and the older intermittent accessibility failure carried. Proposed channel/reminder/retention decisions remain proposals.
