# Phase 7.1 — application-notification tracing and redacted operational logs (TRACE-151)

**Status:** IMPLEMENTED FOR REVIEW (Codex). Not merged, not deployed. No hosted, production, email or setting change.
**Base:** `main` `88d4e09c89b6499a2ca4e0612eab117829c7dc35` (#160). Main CI 42880366052 completed successfully.
**Branch:** `claude/phase7-1-application-notification-tracing`.
**Authority:** owner's Phase 7.1 instruction (2026-11-10), under the Phase 7 authorization in [PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md) (PR #161, merged to `main` as `9067f96`). Roadmap Phase 7: "PII-safe structured logs, and correlation IDs". MTS §5 module boundaries (`observability/` holds the logger and correlation IDs), §11 detective controls ("structured JSON logs with request/correlation IDs"). CFG-011 operational logs: 90 days, no secrets or unnecessary personal data.

> The instruction mentions a "reconciled Phase 7 brief supplied with this prompt". No such brief was attached, and none exists on `main` or on #161. This record treats the 7.1 instruction itself as the slice brief.

## 1. Outcome

An authorized operator can follow a saved vendor application through its owner-notification attempt and any later operator resend, using log lines that carry no applicant data. The lines never cause or prevent a send.

## 2. Characterization (before)

| Path | Before |
|---|---|
| `POST /api/vendor-applications` | `console.warn` refusal reasons. **Raw storage error object** on upload-URL failure. **Raw caught error** (message, stack, any properties) on a 500. `after()` catch logged `error.message`. |
| `POST /api/admin/application-notifications` | 500 path logged `applicationId` and **`error.message`**. No log on refusals or success. |
| `deliverApplicationNotification` | `console.error` with `{applicationId, attempt, outcome, code}` on unrecorded outcomes and on non-sent outcomes. No log on claim, refusal or success. |
| Correlation | None. Nothing tied the post-response attempt to its request. |
| Logger | No structured logger existed. `src/lib/analyticsRedaction.ts` redacts client analytics URLs only, so it was not reusable here. |

The database ledger (`20260929003000_r0_vendor_readiness.sql`) was characterized and is **unchanged**:
- The application row and its `pending` record are created in the same transaction (trigger).
- `r0_claim_application_notification` row-locks the record. Only `pending` (initial) or `resend_requested` (resend) can be claimed. It increments `attempts` and returns a fresh claim UUID.
- `r0_record_application_notification` accepts an outcome only for the current claim.
- `r0_request_application_notification_resend` requires an operator. Unknown or untracked outcomes need explicit confirmation. The request is idempotent while a resend is already requested.

## 3. What changed

| File | Change |
|---|---|
| `src/lib/observability/operationalLog.ts` (new, server-only) | Allowlisted record builder, error classifier, correlation-ID generator and a never-throwing console sink. |
| `src/lib/applicationNotifications.ts` | Optional `trace` argument. Logs claim (claimed, not claimed, failed), provider result (with a send duration), and recorded or record-failed. `providerErrorCode` derives the provider category from the `Resend returned NNN` prefix. The ad hoc `console.error` calls are removed. Message content, idempotency keys, claim handling and outcome classification are unchanged. |
| `src/app/api/vendor-applications/route.ts` | Server correlation ID per request, passed into the existing `after()` callback. Events: saved, refused (guard, limit or invalid), failed, upload-URL failed, and background failed. Raw error logging is removed. |
| `src/app/api/admin/application-notifications/route.ts` | Its own correlation ID per request. Events: refused (invalid, unauthenticated, forbidden, not found, conflict), requested, completed and failed. The `error.message` logging is removed. |
| `tests/unit/application-notification-tracing.test.ts` (new) | 45 tests (§6). |
| `scripts/application-notification-concurrency.mjs` (new) and a CI step | Real-database concurrency for claims, outcome records and resends (§6). |

The following are **not changed**: `src/lib/ownerNotifications.ts` (the shared sender behind contact and pricing mail), the email subject and body, HTTP status codes and response bodies, auth checks, rate limits, the upload flow, runtime (`nodejs`), SQL, permissions, UI and analytics.

## 4. Identity separation

| Identity | Example | Purpose | Logged? |
|---|---|---|---|
| Correlation ID | server `randomUUID()` per route request | Joins the lines of one request, including its `after()` work | Yes (`correlation_id`) |
| Business identity | application ID (server-generated UUID) | Joins the submission and every later resend | Yes (`application_id`, only after UUID validation) |
| Attempt reference | `attempt` (1, 2, …) | Which permitted send this was | Yes |
| Claim ID | UUID from `r0_claim_application_notification` | The capability to record an outcome | **No** |
| Provider idempotency key | `vendor-application-notification:<id>:<attempt>` | Resend replay protection | **No** |
| Provider message ID | Resend `id` | Stored in the ledger on success | **No** |

Client-sent `x-correlation-id`, `x-request-id` or any other header is never read for correlation. A correlation ID grants nothing: authorization still comes from the operator session and `vendor_require_operator()`.

## 5. Log schema `mercurius.oplog.v1`

One JSON object per line on stdout or stderr (`console.info`, `console.warn` or `console.error` by level). Every field is present. A value that fails validation becomes `null`, and an unknown event becomes `oplog.invalid_event`.

| Field | Type / allowed values |
|---|---|
| `schema` | `"mercurius.oplog.v1"` |
| `ts` | UTC ISO-8601 |
| `level` | `info` \| `warn` \| `error` (derived from event and outcome) |
| `env` | `VERCEL_ENV` if `production`, `preview` or `development`; otherwise `test` (NODE_ENV) or `local` |
| `release` | `VERCEL_GIT_COMMIT_SHA` if 7–40 lowercase hex, else `null` |
| `event` | see below |
| `route` | `vendor_application_submit` \| `application_notification_resend` \| `unattributed` (a helper call without a trace) |
| `correlation_id` | UUID, else `null` |
| `application_id` | UUID, else `null` |
| `attempt` | integer clamped to 1–10,000, else `null` |
| `mode` | `initial` \| `resend` |
| `outcome` | `saved`, `refused`, `invalid`, `failed`, `claimed`, `sent`, `unknown`, `recorded`, `unrecorded`, `pending`, `sending`, `missed`, `untracked`, `resend_requested`, `acknowledged`, `unauthenticated`, `forbidden`, `not_found`, `conflict` |
| `error_code` | `intake_trap`, `intake_too_fast`, `intake_email_limit`, `intake_ip_limit`, `validation_failed`, `request_unreadable`, `config_missing`, `db_permission_denied`, `db_not_found`, `db_claim_not_current`, `db_state_conflict`, `db_constraint`, `db_unavailable`, `db_error`, `storage_error`, `network_error`, `provider_refused`, `provider_rate_limited`, `provider_conflict`, `provider_server_error`, `provider_timeout_or_network`, `provider_not_configured`, `unexpected` |
| `duration_ms` | integer clamped to 0–3,600,000 |

**Events.**
- **Submission:** `application_submission.saved`, `.refused`, `.failed`, `.upload_url_failed`.
- **Delivery:** `application_notification.claimed`, `.not_claimed`, `.claim_failed`, `.provider_result`, `.recorded`, `.record_failed`, `.background_failed`.
- **Operator resend:** `application_notification_resend.requested`, `.refused`, `.completed`, `.failed`.

**Error classification.** Only a `code` matching SQLSTATE or `PGRST###` is read. A storage marker or name, the error class, and three fixed configuration phrases are also checked. The result is always an enumerated code; messages, stacks, details, hints and URLs are never written.

**Provider categories.** These come from the HTTP status in the sender's error prefix. Classification into ledger states is unchanged:
- 2xx → `sent`.
- Other 4xx (including 429) → `failed`.
- 409 and 5xx → `unknown`.
- Timeout or network error → `unknown`.
- Not configured → `failed` with nothing sent.

Provider acceptance (`sent`) means Resend accepted the email, not that it reached the inbox.

**Never logged:** names, business name, email, phone, address, IP, license or policy numbers, free text, email subject or body, request bodies or headers, document names or paths, signed upload URLs or tokens, finalize tokens, service-role or Resend keys, Auth session material, operator user IDs, claim IDs, idempotency keys, provider message IDs and raw provider response bodies.

## 6. Verification evidence (local, synthetic, isolated)

| Check | Command | Result |
|---|---|---|
| New tracing tests | `npx vitest run tests/unit/application-notification-tracing.test.ts` | 45/45 PASS |
| Repository unit suite | `npx vitest run --exclude '.phase5-local/**' --exclude '**/node_modules/**'` | 709/709 PASS (664 before + 45) |
| Existing notification tests | `tests/unit/vendor-readiness.test.ts` (in the suite above) | PASS, unchanged |
| Mutation checks (reverted) | (1) a raw error message was logged; (2) a sink exception was not swallowed; (3) a client `x-correlation-id` was trusted | 7, 3 and 2 tests failed respectively |
| Types | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS, 0 warnings |
| Secret scan | `npm run scan:secrets` | PASS |
| Build | `npm run build` | PASS |
| SQL (clean reset, 226 migrations) | `sh scripts/phase5-db.sh test` | 109 files / 7,225 PASS (incl. 071 notification ledger) |
| Notification concurrency (new) | `node scripts/application-notification-concurrency.mjs` after `phase5-db.sh reset` | PASS 3/3 runs |
| Money fingerprint (local isolated DB, not production) | `scripts/promotion-money-fingerprint.sql` | `58 \| af0fae6e0c5b604e9073e10bc060957e`, unchanged; no `supabase/` diff |

The `npm run test:unit` default glob also collects `.phase5-local/wt/tests`, a gitignored worktree left from an earlier session (on `551c76f`). Its 48 files fail to import in this checkout and it is not in CI, so it was excluded rather than deleted.

**What the tests prove:**

- **The journey is traceable.** Save → post-response attempt refused by the fake provider (422) → operator resend → accepted. It produces nine lines with one application ID: one correlation ID for the submission and its `after()` work, and a different one for the resend. Neither equals a client-sent header.
- **Outcomes are retained.** Provider responses 200, 422, 429, 500, 503 and 409, timeout, network error and missing configuration keep the same ledger outcome and record arguments as before. Claim refusal sends nothing. A record failure returns `unrecorded` with `db_claim_not_current`.
- **No duplicate sends** (unit model plus real database):
  - 8 concurrent initial claims produce 1 claim (attempt 1).
  - 4 concurrent outcome records for that claim produce 1 record; the rest are refused as not current.
  - Repeated initial claims after the outcome add nothing.
  - 6 concurrent operator requests produce 1 permitted attempt.
  - 9 mixed resend and stale initial claims produce 1 claim (attempt 2, new claim ID).
  - The operator can't open another attempt while one is sending. A stale claim can't overwrite the outcome. A sent notification can't be resent. The total is two sends.
- **Authority unchanged.** Anonymous and non-operator callers get 401/403 from the route with no claim or send. In the database, `anon` can't execute the resend request or read the overview, and a non-operator is refused with 42501.
- **Redaction.** None of these reach any log line: sentinel PII (name, business name, email, phone, address, license and policy numbers, free text, IP); a key; a claim ID; a provider body; a signed-upload token or URL; a document name; malicious or oversized correlation input; an SQL-like application ID; or a proxy that throws on property access. Every line has exactly the 14 schema keys.
- **Logging failure is harmless.** With every console method throwing, the response stays 201, the row is saved, the claim and record still happen, the ledger reaches `sent`, and the operator resend still succeeds.

**Not performed:**
- Exact-head CI on the final head after the review fixes. See §11; the result is recorded on PR #162.
- Preview or production log readback in Vercel.
- Real Resend.
- Browser and visual suites. There is no UI change, so no UI acceptance is claimed.
- Hosted schema or fingerprint readback, which was not needed: no SQL changed and no production query was made.

## 7. Operator troubleshooting example (synthetic)

**The durable notification ledger is the authority; logs only help explain it.** Logging is best effort by design: a failing log sink is swallowed, so a line can be missing while the work it describes completed. **Missing logs are inconclusive. Read the durable notification ledger before deciding whether an attempt occurred or whether resend is permitted.** Never infer the ledger state, an attempt count or resend permission from log events alone.

An operator sees application `11111111-1111-4111-8111-111111111111` with notification state **failed** in Admin → Recruiting.

1. **Read the ledger first.** Admin → Recruiting shows the state, attempt count and redacted `last_error`, which come from `private.r0_application_notifications` and its events. Only the database decides whether a resend is permitted. `r0_request_application_notification_resend` refuses states it does not allow, and requires confirmation for `unknown` and `untracked`.
2. **Then look for explanation in the logs.** In the Vercel runtime logs for the deployment, search for `"application_id":"11111111-1111-4111-8111-111111111111"`. Lines from the submission request, when present, might read:
   ```
   {"event":"application_submission.saved","route":"vendor_application_submit","correlation_id":"5e1f2c3d-…","outcome":"saved","duration_ms":412,…}
   {"event":"application_notification.claimed","correlation_id":"5e1f2c3d-…","attempt":1,"mode":"initial",…}
   {"event":"application_notification.provider_result","correlation_id":"5e1f2c3d-…","attempt":1,"outcome":"failed","error_code":"provider_refused","duration_ms":180,…}
   {"event":"application_notification.recorded","correlation_id":"5e1f2c3d-…","attempt":1,"outcome":"failed",…}
   ```
   `provider_refused` is consistent with the ledger's `failed`: Resend answered with a definite refusal for that attempt. The ledger's `last_error` holds the provider detail.
3. **The operator chooses Resend.** The database decides whether that is allowed. The new request has its own correlation ID, and its lines, when present, might read:
   ```
   {"event":"application_notification_resend.requested","route":"application_notification_resend","correlation_id":"9c0d…","outcome":"resend_requested",…}
   {"event":"application_notification.provider_result","correlation_id":"9c0d…","attempt":2,"mode":"resend","outcome":"sent",…}
   {"event":"application_notification_resend.completed","correlation_id":"9c0d…","attempt":2,"outcome":"sent",…}
   ```
4. **Confirm in the ledger and the inbox.** The ledger should now show `sent` at attempt 2. `sent` is provider acceptance only, so the operator still confirms the email is in the owner inbox.

**What log lines can and cannot tell you** (always check the ledger):
- `unknown`, with `provider_server_error`, `provider_conflict` or `provider_timeout_or_network`: the email may have been accepted. Check the inbox before confirming a resend.
- `record_failed` / `unrecorded`: an attempt was made but its outcome may not have been saved. The ledger state, not the log, says what was recorded.
- `claim_failed` followed by `background_failed`: the claim call reported an error. The ledger says whether an attempt was claimed.
- **Missing lines** (for example, `saved` with no delivery lines after it): inconclusive. The work may have run with its lines lost. Read the ledger.

## 8. Retention (CFG-011) — gap, not enforced here

The logger writes to the host's runtime log stream. It does **not** enforce or extend retention.
- Vercel's built-in runtime-log retention is plan-dependent. It was **not verified** for this project in this slice, and is not known to reach 90 days.
- No log drain, exporter or observability subscription exists or is added; the brief excludes them. MTS §2 leaves provider selection to the owner.
- So CFG-011's 90-day operational-log retention is **not yet met** for these lines.
- The durable record of each attempt remains the database ledger (`private.r0_application_notification_events`) under its existing retention.

CFG-011 stays **open**, assigned to the later Phase 7.6 observability and retention work. Closing it needs an owner decision on a drain or exporter and its retention, and a verified readback. This slice does not claim 90-day retention is satisfied. No hosted setting was changed.

## 9. Rollback

Revert the slice commits. There is no migration, data, setting or flag. Reverting restores the previous ad hoc logging. Removing the CI step goes with the revert.

## 10. Limitations and decisions for Codex

1. **Correlation ID is not returned to clients.** HTTP responses are unchanged. A submitter's 500 without a saved row can only be found by time and route. Adding a response header would be a small follow-up; it was not done to keep responses unchanged.
2. **Provider categories come from the sender's error-string prefix** (`Resend returned NNN`). This was chosen so the shared sender used by contact and pricing mail stays untouched. The coupling is covered by tests; a structured status on `NotificationResult` would be cleaner but changes the shared sender.
3. **New CI step and script.** `application-notification-concurrency.mjs` runs after the R0 interest script and before the clean reset. Its fixture IDs (`7a5…`) do not collide with existing scripts.
4. **The ledger still stores the provider error detail.** It is SQL-redacted of addresses and truncated, unchanged by design. Logs do not carry it.
5. **Only the three paths are instrumented.** Other routes keep their existing `console` logging until later slices.
6. **Retention gap** (§8): CFG-011 stays open, assigned to 7.6. Preview log readback also remains open.
7. **Carried register unchanged.** A2 human verification and the final deployed schema, fingerprint and completion-integrity checks stay open in the booking-readiness register. This slice neither performs nor waives them.

## 11. Review follow-up before merge (Codex, 2026-11-10)

1. **Troubleshooting corrected (§7).** The earlier text said missing delivery lines proved the post-response work did not run. That was wrong: the logger swallows sink failures, and Codex reproduced a `saved` line with no delivery lines while the downstream action completed. §7 now makes the durable ledger the authority, treats missing logs as inconclusive, and no longer derives ledger state or resend permission from log events. There is no code change: swallowing failures is the intended contract (§5).
2. **Reconciled with `main` `9067f96`** (#161 merged). The only conflict was in `docs/agent/HANDOFF.md`, where both sides added a top entry. Both entries were kept; main's Phase 6 acceptance entry is byte-identical, and `governance/PHASE-6-ACCEPTANCE.md` came in from `main` unchanged.
3. **CI.** Pre-fix head `9f1d199`: run 42937904890 succeeded. The final-head run is recorded on PR #162.
4. CFG-011 stays open and is assigned to 7.6 (§8). Carried human and booking-readiness checks are unchanged.
