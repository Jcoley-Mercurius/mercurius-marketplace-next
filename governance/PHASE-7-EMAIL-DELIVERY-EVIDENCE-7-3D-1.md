# Phase 7.3D-1: audited arm/disarm, interval coverage and a disabled probe harness (TRACE-155)

**Status: IMPLEMENTED LOCALLY, DORMANT. NOT PHASE 7 ACCEPTANCE.** Nothing here is armed, registered, sent or pushed. The receiver stays dormant (no `RESEND_WEBHOOK_SECRET`), the probe harness is off (no `EMAIL_EVIDENCE_PROBES_ENABLED`), and production's arming record stays empty. EO-1..EO-8 remain **proposals**.
**Authority:** the owner's 7.3D-1 instruction (2026-11-20); Codex review [5997315152](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/183#pullrequestreview-5997315152) at `89e01fe` (R3D-1..R3D-4 and two checklist corrections); the [readiness record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) §3–§4; the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §8.3, §8.4, §11.4 and §12, amended here (§18.5).
**Base:** `main` `c5e24cfc020797c39bc2303307a3bfda09c2eb89` (#180, #181 and the separate PostHog integration #182 merged). Branch `claude/phase7-3d1-arming-harness`, in its own worktree, synthetic stack (ports 5606x), browser ports 3176/56861 and build directory.

## 1. Baseline and how #183 is carried

- `origin/main` was `c5e24cf` when this branch was cut; the worktree was clean. No profile or analytics file is touched by this slice.
- **#183** (the readiness record) was still an unmerged draft. Its one commit `89e01fe` was **cherry-picked** (here `705e6b6`), unchanged, because Codex asked for the readiness wording to be synchronized in this implementation PR and its record needs the corrections below. The #183 branch was not merged into this one. If #183 merges first, a rebase drops the duplicate (D-1).

## 2. What was built

| Area | Change |
|---|---|
| Migration `20261128001000_phase7_email_evidence_arming.sql` | Precondition: refuses to apply if `email_evidence_config.armed_at` is already set (no unaudited arming). `private.email_evidence_arming_events` (append-only; contiguous `seq` with arms on odd rows; guard refuses update, delete, truncate, a non-next `seq` and a non-increasing time; RLS on; no client grants). `public.email_evidence_arm(p_reason)` / `public.email_evidence_disarm(p_reason)` through `private.email_evidence_transition`. Coverage: `private.email_evidence_retry_horizon()` (28 h) and `private.email_evidence_coverage(timestamptz)`. **Restated** `private.email_evidence_summary` (§4). `public.email_evidence_arming_readback()`, `public.email_evidence_probe_authorize()`, `public.email_evidence_probe_readback(text)` |
| Labels | [labels.ts](../src/lib/emailEvidence/labels.ts): `coverage` on every summary; rules 9 and 10 worded by coverage; rules 1–8 unchanged; a coverage vocabulary |
| Acceptance judgements | [acceptance.ts](../src/lib/emailEvidence/acceptance.ts): probe choices, expected events, probe verdicts (transport only); `qualifyLedgerAttempt` for later controlled sends (durable state, cutoff, expected identity) |
| Probe harness | [probe.ts](../src/lib/emailEvidence/probe.ts) (server-only: fixed recipients, subject, body, key; gate; configuration) and [route](../src/app/api/admin/email-evidence-probe/route.ts) `POST /api/admin/email-evidence-probe` |
| Operator page | [/admin/email-evidence](../src/app/admin/email-evidence/page.tsx): collection state, start/stop controls, history, coverage meanings, stored-report counts and purge duty, test-probe control; sidebar link |
| Environment | `EMAIL_EVIDENCE_PROBES_ENABLED` (name and description only in `.env.example`); `getEmailEvidenceProbeEnvironment()` |
| Logger | v2 events `email_probe.refused`, `.sent`, `.failed`; route `email_evidence_probe`; codes `probe_disabled`, `probe_environment_refused`. No probe choice, recipient, ID, key or content is ever logged |
| Tests | SQL 125 (new); SQL 122 and 124 deliberately edited (§5.2); [unit](../tests/unit/email-evidence-arming.test.ts); [browser](../tests/e2e/email-evidence-arming.spec.ts); [arming concurrency](../scripts/email-evidence-arming-concurrency.mjs) (new CI step); [migration-lock](../scripts/email-provider-events-migration-lock.mjs) step 7 |

Unchanged (byte-identical to `main`): the receiver and its verifier (`resendWebhook.ts`, the webhook route, fixed ±300 s freshness), the shared sender, correlation tags, the readback types, and the 7.3B, 7.3C-1 and 7.3C-2 migration files.

## 3. Settled directions, as implemented

**R3D-1 (commands).** Operator-guarded through `vendor_require_operator()`; the actor is the session's `auth.uid()`. The commands take a reason only: there is no actor parameter. `authenticated` may execute them (each still requires an operator); `anon` and `service_role` have no execute, and a service-role JWT has no `auth.uid()` anyway. No client role holds any privilege on the history or the arming record. Each call serializes on the arming-record row (`select … for update`, creating the row on first use), refuses a duplicate transition (55000), checks that the record agrees with the history (fails closed otherwise), takes `clock_timestamp()` **after** the lock, appends one event and sets or clears `armed_at`, in one transaction. `seq` is database-generated under the lock and also unique, so even unserialized inserts cannot store two consecutive arms. **Role eligibility is not EO-1 authorization:** the page's start control requires the operator to attest that the owner authorized arming and that the secret and registration exist; it does neither.

**R3D-2 (coverage).** From the audited intervals `[arm, next disarm)`, for an attempt claimed at *c* with horizon *H* = 28 h:

| Coverage | Condition | Empty fact set gives | Label (rule 9/10) |
|---|---|---|---|
| `unknown` | no claim time | rule 10 | "Delivery evidence not available" |
| `before_first_arm` | *c* before any arm | rule 10 | "Delivery evidence not available" |
| `gap` | after a disarm, before the next arm | rule 10 | "Delivery evidence not available: reports were not being collected when this was sent" |
| `partial` | inside an interval closed before *c* + *H* | rule 9 | "No provider report received; collection stopped within 28 hours of sending, so a report may have been missed" |
| `collecting` | inside the open interval, now < *c* + *H* | rule 9 | "No provider report yet" (unchanged) |
| `complete` | inside an interval open through *c* + *H* | rule 9 | "No provider report received in the 28 hours reports were collected after sending" |

An interval includes its arm instant and excludes its disarm instant; *c* + *H* exactly equal to the disarm is complete. A partial interval stays partial even if a later arm covers the rest. Rules 1–8 are unchanged and apply whatever the coverage (SQL 125 compares all 511 non-empty fact sets with the 7.3C-1 expressions at every coverage). Disarm and re-arm keep every event; stored receipts and their facts are untouched.

**Provider retry horizon, verified.** Fetched 2026-11-20 from the official page <https://resend.com/docs/webhooks/retries-and-replays> (redirected from `/docs/dashboard/webhooks/retries-and-replays`): an immediate attempt, then 5 s, 5 min, 30 min, 2 h, 5 h, 10 h and 10 h, each started after the previous failure: **27 h 35 min 5 s** of waits. It also states that a removed or disabled endpoint stops attempts, and a persistently failing endpoint is disabled automatically. *H* = 28 h rounds up for each attempt's own response time. The readiness record's "about 32 h" was not verified and is corrected there. *H* bounds webhook retries for an event raised at send time; an event Resend raises later (a late bounce) is outside it, and the labels say so.

**R3D-3 (two kinds of proof).** Probes are untagged sends to Resend test addresses: their receipts are `unmatched`, never linked, never rematched, and never credited with any ledger rule. `email_evidence_probe_readback(id)` returns only unexpired receipts for that ID, and returns nothing (`not_probe`) if any receipt for it is linked, tagged or conflicted. It never returns the ID, svix-id, tags, recipient or payload. No fourth ledger was added. Ledger linking and operator readback are proven later by controlled-mailbox sends through the real paths, judged by `qualifyLedgerAttempt`.

**R3D-4 (harness).** `POST /api/admin/email-evidence-probe`, in this order:
1. **Gate** (before reading anything): off unless `EMAIL_EVIDENCE_PROBES_ENABLED` is exactly `true`; refused in any Vercel environment other than Production (so in Preview). Answers 404.
2. **Authenticate** (session user, else 401) and **authorize** in the database (`email_evidence_probe_authorize`, else 403) on every invocation.
3. **Body**: exactly `{"choice": "delivered" | "bounced" | "complained" | "suppressed"}`, at most 256 bytes. Any other key (recipient, URL, header, subject, text, HTML, ledger, ref, attempt, claim, key) refuses the whole request (400).
4. **Configuration**: the Resend key, sender and the webhook secret must exist (presence only), else 503 "Nothing was sent".
5. **One send**, untagged, to the server-resolved address, fixed subject and body, key `email-evidence-probe:v1:<choice>:<UTC date>`. Repeating the same probe the same day replays Resend's first response instead of sending again. **No retry**: a refusal, 409, 5xx or timeout is one request and a 502 report.
6. **One readback** by the returned ID through the operator's session. The response carries the verdict and receipt facts, never the ID.

The production credential stays in Vercel Production: local and CI runs stub every send. Tests stub `fetch` and fail on any URL other than Resend's send endpoint (which is itself stubbed); browser tests abort every non-local origin.

## 4. Restated function and hashes

`pg_get_functiondef` md5, isolated stack built from this branch; "before" read from the 7.3C-2 stack built from `main` code:

| Function(s) | Before | After |
|---|---|---|
| `private.email_evidence_summary(text[],timestamptz)`: **deliberately restated** | `e3436221f69164c48be9d90f70f3dd6f` | `8eadddd6f47401258d747248a38ce507` |
| The ten 7.3C-1 functions (set, as SQL 124 pins it) | `10 \| 8177b42a7194ac42e22bd908558f1dff` | `10 \| f258d4e1699becf089efb72725581d1c` |
| The other nine 7.3C-1 functions (trust predicate, identity recheck, fact map, owner readbacks, counts, correlation ref) | `9 \| eaa066ba34ac15ceb89ecb146ae0cced` | unchanged |
| The nine 7.3C-2 functions | `9 \| dca434bc3178d8044904a19fcb00d240` | unchanged |
| The six 7.3B receiver functions (receive, purge, guard, retention, candidates) | `6 \| 57277a24ac11744bde74a0be96cbd79d` | unchanged |
| Application ledger `r0_%notification%` | `10 \| 5f14532aa26ed5400e73e210379aa4f8` | unchanged |
| Price-draft email functions | `4 \| fddc8bb9fc830932a830db9d6db9c811` | unchanged |
| 7.2C-1 owner-email functions | `12 \| 016c0e683cb19c4c68769d87f5215ff1` | unchanged |
| Renewal trigger / `vendor_submit_renewal_document` | `b1607618…` / `8c894236…` | unchanged |
| Columns of the three ledgers, the receipt table and the arming record | `7a0c78089d11d4d87a1bb3cd9e18124e` | unchanged |
| Promotion money fingerprint (`scripts/promotion-money-fingerprint.sql`) | `58 \| af0fae6e0c5b604e9073e10bc060957e` | unchanged |

Nothing else is restated. The 7.3C-1 and 7.3C-2 readbacks call the summary by name and pick up the restatement without being restated; their outputs gain the `coverage` key.

## 5. Evidence (local, synthetic)

### 5.1 Results

| Check | Result |
|---|---|
| SQL 125 (new) | **153/153**: shape and privileges (nine functions, volatility, definer split, empty `search_path`, grants; no table privilege for any client role; no actor parameter); 20 refusals (anon, service role, homeowner, vendor × five functions) all 42501, writing nothing; direct writes refused; transitions, duplicate arm/disarm refusals, six invalid reasons; guard (update, delete, truncate, skipped seq, non-increasing time, arm-after-arm); audit/record rollback when either write fails; fail-closed on disagreement; coverage at 16 boundaries; rules 1–8 over all 511 fact sets; facts surviving disarm and re-arm; durable state over response status (duplicate, content conflict, stored conflict, `other`, `invalid_payload`, unlinked); arming cutoff; retention and purge after disarm; probe readback (order, keys, no ID, expired, ledger ID, tagged ID, unknown ID, five malformed IDs, no rematch); readback keys; read purity; definitions |
| SQL 122 / SQL 124 (edited, §5.2) | 169/169 and 244/244 |
| Full SQL (clean reset) | **117 files / 8,493 PASS** (was 116 / 8,340) |
| SQL mutations | 16 mutations of the new and restated functions plus a no-op control. The control passes; all 16 are caught. The first batch ran on a database still holding the concurrency script's committed fixtures and is void (every run failed, including the control); after a clean reset the batch caught 15. M15 (horizon 27 h) reported "survived" there once; re-applied through the same code path it failed four assertions, and the first report is not reproducible (cause not identified) |
| `email-evidence-arming-concurrency.mjs` (new CI step) | A-1 8 first arms with no record row → 1 event, 7 refused; A-2 8 disarms → 1; A-3 5 rounds × 16 mixed → contiguous alternating history, record consistent, times ordered; A-4 a transition behind a 1.5 s held lock is stamped 1.508 s later (clock time after serialization); A-5 a duplicate arm behind a held arm waits and is refused |
| `email-provider-events-migration-lock.mjs` (step 7 added) | PASS: 55P03 under contention on each ledger (≈2.18 s); the chain 7.3B → 7.3C-1 → 7.3C-2 → 7.3D-1 re-applies, and the 7.3D-1 file restates the summary again (hash) with its triggers and grants |
| `email-provider-events-concurrency.mjs` | PASS (unchanged script) |
| Unit | 79 files / **1,207** (29 new in `email-evidence-arming.test.ts`): labels, verdicts, qualification (criteria 4 and 5), gate, keys, route order and refusals, 19 forbidden bodies, misconfiguration, exact provider request, repeated invocation, no retry (422, 409, 500, timeout), redaction of key, secret, ID, recipient, key and content, logger names, route inventory |
| Unit mutations | 16 plus a no-op control; control passes, all 16 caught |
| Lint, typecheck, secret scan, build | pass (build with `MERCURIUS_BUILD_WORKERS=1`; route `ƒ /api/admin/email-evidence-probe` listed) |
| Browser | §5.3 |
| Exact-head CI | §5.4 |

### 5.2 Deliberate edits to existing SQL tests

Each is required by the restatement and marked in the file with `TRACE-155 (7.3D-1, 20261128001000)`:
- SQL 122 and 124 "exactly N functions" scans exclude the nine 7.3D-1 functions by exact signature (tested in SQL 125).
- The summary, history-attempt and parity expectations gain `coverage` (`unknown` for those fixtures).
- SQL 122 S-49 and SQL 124's rule 9/10 cases arm through the history (one arm event and the matching `armed_at`) instead of writing `armed_at` alone. **Expected rules are unchanged.**
- SQL 124's 7.3C-1 set hash moves from `8177b42a…` to `f258d4e1…`, with a comment naming the single restated function.

### 5.3 Browser

`tests/e2e/email-evidence-arming.spec.ts`: never started, in light, dark and 320 px, with axe; armed history newest first, purge duty with zero expired; start control (attestation and reason required; the command receives one trimmed line); stop control showing a database refusal; the **real built probe route answering 404 when off** (the request names only the choice); a served probe answer (verdict, undocumented-address note); a provider failure reported once; a vendor turned away before any readback; Recruiting rows showing the partial, gap and complete labels. (The first test runs once per theme and width, so 11 tests.)

**Local results are not clean evidence, and are recorded as observed.** Other sessions kept this host's 5-minute load average between ≈6 and ≈33 throughout (worktree stack, the main worktree's stack and several other agent sessions). Under that load:
- every one of the nine original tests passed at least once except the three-load axe test (now split) and the served-probe test, whose failures were all 30 s timeouts in navigation, axe evaluation or a still-pending served response, never a wrong value;
- the last isolated run of this spec (load ≈8–14) passed 5 of 9: start, stop with refusal, real-route-off, vendor redirect and the Recruiting coverage labels; the other four timed out (a snapshot showed the probe dialog still "Confirming…");
- a batch with the existing Owner Emails and ledger specs at load ≈25 failed 35 of 61 in 54.7 min, including untouched tests; one of those, rerun alone at load ≈3, passed in 2.7 s.

Two real defects were found and fixed along the way: the Recruiting coverage test assigned summaries by batch index (now by application ID), and the vendor test expected an "Admin access required" page where the proxy redirects first. A third change came from review: a provider failure now stays in the probe dialog as its alert instead of closing it with "Done". **Browser acceptance therefore rests on the exact-head CI application job (§5.4), which runs every browser spec on a dedicated runner.**

### 5.4 CI

Recorded in the PR body and the handoff at the exact head.

## 6. Checklist corrections (Codex review 5997315152)

Applied in the [readiness record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) as dated corrections, originals kept:
1. **Durable state, not status.** A duplicate HTTP response is not new evidence, but an expected, trusted receipt already stored is still valid readback evidence. Qualification reads the expected attempt's durable state and identity (`qualifyLedgerAttempt`; SQL 125 §8), never a response status.
2. **Purge duty while anything is stored.** After disarm, the duty lasts while any receipt is retained, expired or not. Zero expired backlog is not zero retained data. `email_evidence_arming_readback` reports total retained, linked, unlinked and expired counts, the oldest expired and latest expiry and the last purge run, without content; `purge_duty` is true while any receipt is stored.

## 7. Decisions for Codex

- **D-1** #183's commit carried by cherry-pick (§1).
- **D-2** `partial` coverage is rule 9 with a partial label, not rule 10: the attempt was claimed while armed, but the label says a report may have been missed. Alternative: rule 10.
- **D-3** *H* = 28 h (27 h 35 min 5 s documented, rounded up). It covers retries of an event raised at send time only.
- **D-4** The page has start/stop controls (`ConfirmAction` with a required reason; start also requires the EO-1/secret/registration attestation). The readiness proposal had said "no UI control"; the owner's instruction asked for manual controls. Removing the controls leaves the commands callable only from an operator session's console. Codex to confirm.
- **D-5** The harness is a route handler under `/api/admin`, not a Next.js Server Action: the codebase has no Server Actions, and every admin command uses this route pattern with its logger. Both are HTTP-callable; this one has an explicit method, status codes and a 404 when off.
- **D-6** Probe identity is one key per test address per UTC day. A second probe of the same address the same day replays rather than sends; the next UTC day is a new probe.
- **D-7** The harness also fails closed when the webhook secret is absent (its reports could not be received).
- **D-8** A non-Vercel process (local, CI) passes the environment gate so tests can exercise it with stubbed sends; any Vercel environment other than Production is refused.
- **D-9** The migration refuses to apply over an unaudited `armed_at` (production's record was empty at the last readback).
- **D-10** Ledger qualification is a pure TypeScript judgement over the existing operator readbacks plus `coverage`, not a new SQL function.
- **D-11** `not_probe`: any linked, tagged or conflicted receipt for the ID hides all of its receipts from the probe readback.
- **D-12** SQL 122/124 edits (§5.2).

## 8. Not done (stop line)

No hosted migration push, merge, deployment, secret or environment change, webhook registration, arming, probe enablement or real email. No suppression, automatic retry, Cron, booking, payment, profile or analytics change. EO-1..EO-8 stay proposals; EO-2 retention is untouched (the 7.3B proposal constants stand). The readiness §2 operator checks (O-1..O-9) and carried items remain open. Phase 7 is not complete.

## 9. Hosted rollout (for later, owner-authorized)

1. Codex review and green exact-head CI.
2. Owner authorization, then `supabase db push --linked --dry-run`, which should list only `20261128001000`; then the push. The migration creates one empty table and functions, restates one function and refuses to run over an unaudited `armed_at`.
3. Read-only readback: nine functions with matching definitions, the restated summary hash `8eadddd6…`, grants, unchanged hashes and fingerprint, an empty history, an empty arming record, 0 receipts.
4. Merge = deploy. The probe stays off (no `EMAIL_EVIDENCE_PROBES_ENABLED`) and the receiver dormant until EO-1, EO-2, EO-3, EO-6 and EO-7 are decided.
