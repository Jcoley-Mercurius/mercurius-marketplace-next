# Phase 7.3A — Email delivery evidence and safe recovery: characterization and plan (TRACE-155)

**Status:** PLAN, REVISED AFTER CODEX REVIEW [#5891386779](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/168#pullrequestreview-5891386779) (at `7c2d0e5`), for Codex re-review. Documentation only. Approves nothing, activates nothing. **No 7.3B implementation clearance has been given.**
**Branch:** `claude/phase7-3a-email-evidence-plan`. First written on `main` `24dd455` (§1.1). Rebased onto `main` **`8a9603b94ea908e83742cbc2548d40f63ba4263b`** for this revision (§1.2).
**Authority:**
- The owner's Phase 7.3A instruction and revision instruction (2026-11-13), under the Phase 7 authorization ([PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md)).
- Roadmap Phase 7: "Implement email delivery/retry evidence and domain authentication".
- MTS §5 (line 78), §7 (line 193), §9, §11; MPS §10; contract [§7.4](PHASE-7-NOTIFICATION-CONTRACT.md) Category 4.

**Precedence:** MPS → MDS → MTS → implementation evidence. Where this plan recommends something no authority approves, it says **proposal**. Codex's technical directions are recorded in §15.2. Owner items (EO) remain **proposals**.

---

## 0. Summary

1. **What `sent` means today.** Every ledgered email path records `sent` when Resend's API accepts the request. Nothing records whether the email reached a mail server, bounced, was marked as spam, or was suppressed. **No Resend webhook receiver exists** (§3).
2. **Provider facts.** `email.sent` means "the API request succeeded, and Resend will attempt delivery". `email.delivered` means Resend handed the email to the recipient's mail server. Neither proves inbox placement or human receipt. Resend can suppress, fail or bounce an email **after** API acceptance (§4).
3. **Mapping.**
   - Provider email IDs are stored only on `sent`.
   - `unknown` attempts never learn theirs.
   - Callbacks can arrive before the outcome is recorded.
   - Auth SMTP mail has no local record.
   - **Recipient email is never a matching key** (§7).
4. **Model, revised.** Provider evidence is kept apart from the send-attempt ledgers:
   - **minimal receipts**, linked **durably at receipt time** to exactly one ledger row by tag or ID, with an access-controlled FK that cascades with the source;
   - **finite expiry** for every receipt, enforced in the database (R2);
   - **conflicted receipts excluded** from evidence (R4);
   - **all facts preserved**, with a deterministic summary that separates *proven non-delivery* from *needs review* (R3).

   Claims, attempt history, stale-worker refusal, attestations and the meaning of `sent` are unchanged (§8).
5. **Ingestion, revised.** The raw body is read as a **bounded byte stream** (64 KiB ceiling, cancelled at overflow) with bounded headers. It is verified by the **exact-pinned official `svix` verifier**, whose `verify` authenticates without parsing (inspected source, §4.3). JSON parsing is a separate later step. Only a verified, parse-failed body becomes an `invalid_payload` receipt. **No verification exception is ever turned into a 2xx** (R1, R5).
6. **First slice: 7.3B, a dormant authenticated receipt.** Not cleared. Its scope now includes the linkage, expiry and conflict mechanisms, so collection never precedes enforceable deletion (§13.2).
7. **Owner decisions** EO-1..EO-8 stay open (§15.1). EO-2 now asks for a concrete retention value and enforcement mechanism (§11.4). **Codex directions** EC-1..EC-10 are recorded (§15.2). Findings R1–R5 and how each is resolved are in §18.

---

## 1. Baseline

### 1.1 History: first draft (2026-11-13, preserved as written then)

| Check | Result at the first draft |
|---|---|
| `origin/main` | `24dd455acd520a21da14b0305a92383fbedfcccf` (#166, 7.2C-1); main CI 43343682357 success |
| Open PRs | Only #167 (7.2C-2), draft |
| #167 head | `7dbdf5a`, one commit past the `f5305c2` named in the instruction (records the owner-authorized hosted push of `20261123001000`) |
| #167 CI | `f5305c2` run 43419555745 success; `7dbdf5a` in progress |
| TRACE ID | TRACE-155 unused |

### 1.2 Reconciliation at this revision (2026-11-13)

Each kind of evidence is listed separately. **Merge is not hosted acceptance.**

| Evidence | Result | Source |
|---|---|---|
| Current `origin/main` | **`8a9603b94ea908e83742cbc2548d40f63ba4263b`**, the merge of #167 | `git fetch`; `gh pr view 167` |
| #167 | **MERGED** 2026-11-13 12:54:15 UTC; head `7dbdf5a` | `gh pr view 167` |
| #167 exact-head CI | `7dbdf5a`: run 43424109360 **success** (one earlier run cancelled). `f5305c2`: run 43419555745 success | `gh run list` |
| Main merge CI | `8a9603b`: run 43429080720 **success** (push) | `gh run list --branch main` |
| Code review of #167 | **No GitHub review is recorded on #167.** No Codex review record for 7.2C-2 exists on `main` | `gh api …/pulls/167/reviews` (empty) |
| Hosted migration `20261123001000` | **Recorded by #167** as pushed on 2026-11-13 on the owner's instruction, with a matching readback (7.2C-2 record §6.1). **Not re-verified here** (no hosted query) | 7.2C-2 record |
| Production deployment | GitHub records a `Production` deployment for `8a9603b` (id 7765736655) with status `success` at 12:54:55 UTC. This is GitHub metadata from the deploy integration. It is **not** a Vercel READY readback, and no deployment URL or ID was checked against Vercel | `gh api …/deployments?sha=8a9603b` |
| Post-deploy renewal rollout reconciliation | **Not recorded** on `main`. 7.2C-2 §6 step 5 requires a fresh count of `missed` renewal rows created between the push and the deploy, then per-row attested handling. Not performed or claimed here | 7.2C-2 record §6 |
| Stale status text | The 7.2C-2 record on `main` still reads "Not merged or deployed; Codex review pending". It was written before the merge. **Not edited here**: it is another slice's record, and its owner should update it with the deployment and reconciliation evidence | `governance/PHASE-7-OWNER-EMAIL-LEDGER-7-2C-2.md` line 3 |
| Conflicts | `docs/agent/HANDOFF.md` and `governance/TRACEABILITY.md` conflicted on rebase. **Both sides kept**: `main`'s two 7.2C entries and its updated TRACE-154 row are unchanged; the 7.3A entries and TRACE-155 sit above or after them | This branch |

**Source inventory now (for EO-8).** At `8a9603b`, the renewal-document owner email is **ledgered in source on `main`** (kind `renewal_document`). The 7.2C-2 code is deployed according to GitHub's deployment record only (above). Every other row in §3.1 is unchanged from the first draft.

---

## 2. Scope and boundary

**In scope:** characterization; provider and library behavior with sources; proposed ingestion, linkage, evidence, readback, suppression, retention, acceptance and slices; decisions.

**Not done:** no application, database, migration, CI, dependency or configuration change. No hosted query, Resend action, DNS change, webhook registration or email. No retry, reminder, suppression, scheduler, payment, booking, promotion or `offer_terms` activation. No tests were run, because no code changed. The `svix` and `standardwebhooks` tarballs were downloaded into a scratch directory **outside the repository** to read their source. Nothing was installed or executed.

---

## 3. Current state (characterization)

### 3.1 Email paths

| Path | Transport | Ledger | Provider ID stored | Recipient | Source deletion today |
|---|---|---|---|---|---|
| Vendor application → owner (N-APP-01) | Next `after()` → shared sender → Resend API | `private.r0_application_notifications` ([20260929003000…sql:19](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L19)); row cascades with `vendor_applications` | `provider_message_id`, only on `sent` | Owner | No SQL path deletes applications (document retention deletes files, not rows: [PHASE-5-APPLICATION-RETENTION](PHASE-5-APPLICATION-RETENTION.md)) |
| Contact form → owner (N-SUP-04) | `deliverOwnerEmail` | `private.owner_email_notifications` ([20261122001000…sql:33](../supabase/migrations/20261122001000_phase7_owner_email_ledger.sql#L33)); cascades with `contact_submissions` | Only on `sent` ([:231](../supabase/migrations/20261122001000_phase7_owner_email_ledger.sql#L231)) | Owner | No purge exists; no retention class approved (7.2C plan §3.10) |
| Renewal document → owner (N-APP-05) | `deliverOwnerEmail` (on `main` since `8a9603b`) | Same ledger, kind `renewal_document` ([20261123001000](../supabase/migrations/20261123001000_phase7_owner_email_renewal_trigger.sql)) | Only on `sent` | Owner | Renewal documents are immutable, so the ledger row is kept |
| Price draft → vendor contact (N-PRC-01, DEC-2026-041 item 6) | `sendNotificationEmail(…, recipient)` | `private.package_draft_email_notices` ([20261018004000…sql:83](../supabase/migrations/20261018004000_pricing_owner_decisions.sql#L83)); cascades with drafts | Only on `sent` | **A vendor's contact email** | Notices cascade with `operator_package_drafts`; no SQL path that deletes drafts was found |
| Invitations (N-APP-03); homeowner verification and recovery (N-APP-04) | Supabase Auth → Resend SMTP | Auth-owned | **None** | Invitees, **homeowners** | Not applicable |
| Legacy `vendor-application-notify` Edge function | Third-party gateway ([index.ts:70](../supabase/functions/vendor-application-notify/index.ts#L70)) | None | None | Owner | Deployment state UNKNOWN (contract G2-06/G3-09) |

### 3.2 Shared sender ([ownerNotifications.ts](../src/lib/ownerNotifications.ts))

- One `POST /emails` per attempt, with an optional `Idempotency-Key`, a 10 s timeout, and **no tags or custom headers**.
- Classification ([applicationNotifications.ts:76-92](../src/lib/applicationNotifications.ts#L76)): 2xx → `sent`; 409 and 5xx → `unknown`; timeout or network → `unknown`; other 4xx → `failed`. This matches Resend's documented 409 semantics (§4.1).

### 3.3 Claim, outcome and recovery (unchanged by this plan)

All three ledgers follow the TRACE-104 pattern:
- a row-locked claim yields a claim UUID; the outcome is accepted only for the current claim (40001);
- passive 10-minute expiry (`missed` / `unknown`);
- attested resend; acknowledgement on the owner-email and application ledgers;
- **`sent` is terminal**.

### 3.4 Logger ([operationalLog.ts](../src/lib/observability/operationalLog.ts))

- `v1` has 14 keys and `v2` has 16. The schema is fixed per event name, with enumerated codes, and sink failures are swallowed.
- Provider IDs, claim IDs, keys and bodies are never logged.
- The [scanner](../scripts/scan-secrets.mjs#L20) already detects `whsec_` secrets.

### 3.5 Webhook precedent

The Stripe Edge function ([stripe-webhook/index.ts](../supabase/functions/stripe-webhook/index.ts)) follows this sequence:
1. A mode gate returns 503 while unarmed.
2. The signature is verified over raw `request.text()`; failure returns 400.
3. The event is normalized to allowlisted fields.
4. The receipt commits before processing (`money_receive_event`, insert-or-detect, [20260905001000…sql:224](../supabase/migrations/20260905001000_money_contracts.sql#L224)).
5. It returns 500 when a retry is needed.

Two differences here:
- This plan bounds the body before reading it fully (R1).
- It stores less than Stripe does (§11).

### 3.6 Other facts

- **Dormant suppression ledger.** `r0_record_email_suppression` / `r0_email_allowed` cover the R0 early-access and marketing classes only. They are service-role only, nothing calls them from provider events, and no sender of either class exists ([20260929001000…sql:509](../supabase/migrations/20260929001000_r0_interest_consent.sql#L509)).
- **Proxy.** It matches only `/admin` and `/vendor` ([src/proxy.ts:104](../src/proxy.ts#L104)).
- **Next.js 16.4.3** (installed docs):
  - Route Handlers use the Web `Request` and `Response` APIs (`03-file-conventions/route.md` lines 6 and 64). `request.body` is a standard `ReadableStream`.
  - The documented body-size settings (`proxyClientMaxBodySize`, `serverActions.bodySizeLimit`) cover the proxy and Server Actions, **not** Route Handlers. The route must enforce its own ceiling.
  - The webhook guide is at `02-guides/backend-for-frontend.md:556`.
- **No scheduler is active.** `pg_cron` is installed, but no production schedule exists ([SUPABASE-CRON-SETUP](SUPABASE-CRON-SETUP.md)). Phase 5 retention runs through **operator-invoked, guarded, audited commands**, not schedules ([PHASE-5-APPLICATION-RETENTION](PHASE-5-APPLICATION-RETENTION.md) §Contract).
- **Production-only webhooks.** Only `main` deploys ([vercel.json](../vercel.json), DEC-2026-037), so a registered endpoint is production.
- **Domain evidence is historical.** [R0-RELEASE-CANDIDATE](R0-RELEASE-CANDIDATE.md) lines 121 and 263 (2026-09-30 / 2026-10-01) record SPF, DKIM, bounce MX and DMARC `p=quarantine`, and one real email passing all three. "Resend's own domain status still needs its API."

### 3.7 Gaps

| ID | Gap |
|---|---|
| D-1 | No delivery, bounce, complaint, failure or suppression evidence (MTS §7) |
| D-2 | `sent` can stand for an email later suppressed or failed |
| D-3 | `unknown` attempts never learn their provider ID |
| D-4 | Auth SMTP and legacy sends are unmatched and may concern homeowner addresses |
| D-5 | No path for "accepted, then not delivered" (`sent` is terminal) |
| D-6 | Bounce and complaint handling unwired; no transactional suppression policy |
| D-7 | Domain-authentication evidence dated 2026-10-01; no Resend status readback |

---

## 4. Provider and library behavior

### 4.1 Resend and Svix, verified from fetched official pages (2026-11-13)

| Topic | Verified statement | Source |
|---|---|---|
| `email.sent` | "The API request succeeded, and Resend will attempt delivery" | [Event types] |
| `email.delivered` | Resend "successfully delivered the email to the recipient's mail server" | [Event types] |
| Other events | `delivery_delayed`, `bounced` (permanent rejection), `complained` (delivered, marked as spam), `failed`, `suppressed`, `opened`, `clicked`, `scheduled`, `received`; plus domain, contact, `suppression.added/removed`, topic and inbox families | [Event types] |
| Retry identity | "Retries reuse the same `svix-id` header, so deduplicate on it" | [Event types] |
| Payload fields | `type`, `created_at`; `data.email_id`, `created_at`, `from`, `to[]`, `subject`, `message_id` (absent on scheduled, failed and suppressed), `tags`, `broadcast_id`, `template_id`, `bounce.{type, subType, message, diagnosticCode}` | [Bounced event] |
| Bounce types | Permanent, Transient and Undetermined, with subtypes. The event page's examples say `Permanent`/`Temporary`, so the exact strings need a synthetic check | [Bounces], [Bounced event] |
| Verification | `svix-id`, `svix-timestamp` and `svix-signature`; use the raw body (parse plus re-stringify breaks it); the SDK `verify` throws if invalid | [Verify] |
| Scheme | HMAC-SHA256 over `id.timestamp.body`; key is the base64 after `whsec_`; the header is a space-delimited list of `v1,<sig>`; constant-time comparison | [Svix manual] |
| Success | Any 2xx; respond within about 30 s; disable CSRF for the endpoint | [Svix receiving] |
| Retries | Immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h. A persistently failing endpoint is **disabled automatically**. Failed and succeeded messages can be replayed from the dashboard | [Retries] |
| Idempotency keys | 24 h retention; 1–256 characters; a repeat returns the original response; a different payload → 409 `invalid_idempotent_request`; a concurrent request → 409 `concurrent_idempotent_requests` | [Idempotency] |
| Tags | ASCII letters, digits, `_` and `-`; up to 75; included in webhook events | [Tags] |
| Suppression list | Hard bounce or complaint → suppressed. Later sends are "marked as suppressed" and not delivered until removed; the address is re-added if the cause persists | [Suppression KB], [Bounces] |
| Test addresses | `delivered@`, `bounced@`, `complained@` and `suppressed@resend.dev`, "without damaging your domain reputation"; they count against quota | [Test emails] |
| Domains | A verified domain is required; subdomains are recommended; DMARC after verification | [Domains] |
| Retrieve | `GET /emails/{id}` returns `last_event` | [Retrieve] |

### 4.2 Not verified (prove in tests or treat as unknown)

| Topic | Consequence |
|---|---|
| Delivery ordering | Not stated by Resend; Svix calls ordinary endpoints best-effort (secondary). Design for out-of-order |
| Re-signing on retry | Not stated. If a late retry kept its original timestamp, the verifier's fixed 5-minute check (§4.3) would reject it. **Must be proven before activation** (§12, EC-3) |
| Webhooks for SMTP sends | Not stated. Assume Auth mail produces events |
| API response to a suppressed recipient | Not stated. Assume `sent` can be followed by `email.suppressed` |
| Rotation overlap | Not stated. The receiver accepts current or previous (§6.4) |
| Payloads of `suppressed`, `failed`, `delivery_delayed` | Not fully fetched. Parse defensively |
| Source IPs | Not found. Not used as a control |

**"Delivered" is not inbox placement.** It is not human receipt, reading or action either. `email.opened` is not proof of reading and is not proposed for subscription.

### 4.3 Verifier library: inspected source (R5, EC-2)

Packages were inspected from npm tarballs in a scratch directory, not installed, on 2026-11-13.
- `svix` latest is 2.10.0, published 2026-11-09. That is **under two weeks old**, so it is not a candidate.
- **2.9.1** (2026-10-26) is the newest version past two weeks.
- It depends on `standardwebhooks` `^1.1.1`; 1.1.1 was published 2026-08-28.

| Fact | Evidence (`svix@2.9.1` `dist/index.mjs`; `standardwebhooks@1.1.1` `dist/index.js`) | Plan consequence |
|---|---|---|
| `svix` `Webhook.verify(payload, headers)` returns **`undefined`**. It maps the `svix-*` headers to `webhook-*` and calls `standardwebhooks` `verify(payload, headers, { jsonParse: false })` | `src/webhook.ts` region of `index.mjs`; `index.d.mts:4932` declares `: undefined` | **Authentication and parsing are separate by construction.** A normal return means a matching signature. The route parses JSON itself, afterwards |
| Missing headers → `WebhookVerificationError("Missing required headers")`. Non-numeric timestamp → `"Invalid Signature Headers"`. More than 300 s old or new → `"Message timestamp too old/new"`. No `v1` match → `"No matching signature found"` | `standardwebhooks` `verify`, `verifyTimestamp` | All authentication failures share one error class. They map to **400**, never 2xx |
| Tolerance is a **fixed constant**, `WEBHOOK_TOLERANCE_IN_SECONDS = 5 * 60`, checked in both directions; it is not configurable | `index.js` | EC-3's ±5 minutes is the verifier's supported check. The route does **not** add its own range check |
| The timestamp is read with `parseInt(…, 10)` (lenient: `"123abc"` → 123) | `verifyTimestamp` | The route bounds the header format **before** calling `verify` (`^[0-9]{1,12}$`, §6.2) |
| Every space-separated entry is checked; non-`v1` entries are skipped; comparison is a constant-time byte comparison after a length check | `verify`; `timing_safe_equal.js` | The route bounds the signature header length and entry count before `verify` |
| A payload must be a `string` or `Buffer`; anything else throws a **plain `Error`** (not `WebhookVerificationError`). A `Buffer` is turned into a string by UTF-8 decoding | `sign` | The route passes the **string it decoded itself with fatal UTF-8 decoding** (§6.2), so the verified string is exactly the retained, parsed text. Any non-`WebhookVerificationError` exception → **500**, no receipt |
| The constructor strips `whsec_` and base64-decodes. An empty or invalid secret throws a plain `Error` | `constructor` | Verifier instances are built during configuration validation. Failure → **503** (unarmed), separate from request authentication |
| An empty payload with a matching signature returns `undefined` | `verify` | An empty signed body reaches the parse step → `invalid_payload` (§6.2 step 9) |
| `svix` is the full API client (`dist/index.mjs` ≈ 250 KB); its transitive dependencies are `standardwebhooks`, `@stablelib/base64` and `fast-sha256` | `package.json` files | **Dependency review (EC-2) must cover all four**, with the lockfile pinning each exact version. If the review rejects `svix`, 7.3B stops and returns to Codex. **There is no automatic fallback to handwritten cryptography** |

---

## 5. Evidence vocabulary (item 1)

There are two independent axes, never merged:

| Axis | Values | Meaning |
|---|---|---|
| **Attempt outcome** (existing, unchanged) | `pending`, `missed`, `sending`, `sent`, `failed`, `unknown`, `unrecorded`, `resend_requested`, `acknowledged`, `untracked` | What our sender knows. `sent` = **Resend accepted the request** |
| **Provider evidence** (proposed) | Facts: `accepted`, `delayed`, `delivered_to_server`, `bounced_permanent`, `bounced_transient`, `bounced_undetermined`, `complained`, `provider_failed`, `provider_suppressed`. Derived summary and flags: §8.3 | What Resend later reported about the matched email. Every trusted fact is kept and shown |

**Label rules:**
- Where evidence exists, every surface that shows `sent` also shows the evidence summary.
- No surface says "Delivered" alone, "Received", "Read" or "Confirmed".
- A `delivered_to_server` fact always carries "Not proof it reached the inbox or was read".
- Transient and undetermined bounces are always **inconclusive**.
- A complaint always states that delivery to the server occurred.

---

## 6. Authenticated webhook ingestion (item 2)

### 6.1 Host (EC-1, directed)

A Next Route Handler, `src/app/api/webhooks/resend/route.ts`, with `runtime = "nodejs"` and `POST` only.

### 6.2 Request handling, in order (revised for R1 and R5)

1. **Method.** Anything other than `POST` → 405.
2. **Configuration gate.** Build the verifier instances from `RESEND_WEBHOOK_SECRET` and optional `RESEND_WEBHOOK_SECRET_PREVIOUS`. If the current secret is missing, or either constructor throws → **503**, fixed body. No body is read and nothing is stored.
3. **Header bounds** (before any body read):
   - `svix-id` matches `^msg_[A-Za-z0-9]{1,64}$`; the exact form is to be confirmed by a synthetic sample (§4.2).
   - `svix-timestamp` matches `^[0-9]{1,12}$`.
   - `svix-signature` is at most **1,024 bytes**, has at most **8** space-separated entries, and each entry is at most 128 bytes.
   - Missing, oversized or malformed → **400**. Nothing is read, verified or stored.
4. **Early length check.** If `Content-Length` is present, valid and over **65,536** → **413** before reading. If it is invalid, it is ignored. `Content-Length` is **advisory**: it is never trusted as the actual size.
5. **Bounded byte read.** Read `request.body` with a stream reader, summing `Uint8Array` chunk lengths in **bytes**.
   - The moment the running total exceeds 65,536, call `reader.cancel()` and return **413**. Nothing is decoded, verified or stored.
   - A missing body (`null`) is treated as zero bytes.
   - The retained bytes are exactly the chunks read, concatenated once.
   - `request.text()`, `request.json()` and `arrayBuffer()` are **not** used.
6. **Decode.** `new TextDecoder("utf-8", { fatal: true }).decode(bytes)` on the **whole** buffer, never per chunk, so a multibyte character split across chunks decodes correctly. Invalid UTF-8 → **400**: an unauthenticated body is never decoded leniently. Resend signs UTF-8 JSON text, so for valid UTF-8 the decoded string is byte-equivalent to what was signed.
7. **Verify** that exact string with the current verifier, then the previous one if the first threw `WebhookVerificationError` with "No matching signature found".
   - A normal return (`undefined`) = authenticated; record the slot (`current` / `previous`).
   - `WebhookVerificationError` from every configured verifier → **400**.
   - **Any other exception → 500** (no receipt, no 2xx).
   - **A verification exception is never converted into a receipt or a 2xx.**
8. **Stop on rejection.** After any rejection in steps 1–7, no parse, normalization or RPC happens.
9. **Parse** the same string with `JSON.parse` in its own `try`. A parse error, a non-object, or a missing or invalid `type` → a **verified-malformed** receipt (`processing = 'invalid_payload'`, no data fields) and 200. This path is reached **only** after step 7 returned normally (EC-7, conditioned on R5).
10. **Normalize** the allowlisted fields (§11.1). Invalid values become `null` or `other`.
11. **Receive.** One service-role RPC, `email_receive_provider_event(...)`, in one transaction: insert-or-detect, receipt-time linkage (§7.2), the conflict flag (§7.4) and bounded expiry purge (§11.4). It returns `recorded | duplicate | conflict`.
12. **RPC error or database unavailable** → **500 / 503**, so Resend retries. **No 2xx before the receipt, or the conflict flag, has committed.**
13. **Response.** `200 {"received":true}` for `recorded`, `duplicate` and `conflict` (the conflict flag has durably committed).

There is no `after()` work: everything that matters commits inside the request.

### 6.3 Replay controls

- **Freshness:** the verifier's fixed ±300 s check.
- **Uniqueness:** `svix_id` primary key, so provider retries, dashboard replays and in-window replays are `duplicate`.
- **No side effect:** a receipt never changes a ledger, sends anything or suppresses anything.
- **Dashboard replay:** a no-op for recorded messages.
- **Before activation (§12):** prove that a late retry or replay verifies (re-signing), or redesign (§4.2).

### 6.4 Secrets and rotation (EC-6 wording corrected)

| Item | Proposal |
|---|---|
| Names | `RESEND_WEBHOOK_SECRET` (arms the route) and `RESEND_WEBHOOK_SECRET_PREVIOUS` (rotation only). Vercel **Production** server secrets; never in Preview. Names and descriptions go in `.env.example` |
| Never | Logged, returned, committed, or put in analytics or errors |
| **Which secret matched** | Stored **only on the receipt** (`secret_slot`). **It is not a log field**: the v2 logger keeps its 16 keys (EC-6) |
| Rotation runbook (7.3D) | (1) Create a new secret in Resend. (2) Set `…_PREVIOUS` = old and the current secret = new; redeploy. (3) Confirm new receipts record `secret_slot = 'current'` through the operator readback (counts by slot, no values). (4) After the retry horizon (≈32 h), remove `…_PREVIOUS` and redeploy |
| Compromise | Rotate with no overlap. Stored receipts stay; none caused an action |

### 6.5 Failure responses

| Condition | Status | Stored | Logged (v2, existing 16 keys, enumerated codes) |
|---|---|---|---|
| Not armed or bad secret | 503 | Nothing | `refused` / `config_missing` |
| Header missing, oversized or malformed | 400 | Nothing | `refused` / `webhook_headers_invalid` |
| `Content-Length` over the limit, or streamed bytes over the limit | 413 (stream cancelled) | Nothing | `refused` / `webhook_payload_too_large` |
| Invalid UTF-8 | 400 | Nothing | `refused` / `webhook_payload_invalid_encoding` |
| `WebhookVerificationError` (any reason) | 400 | Nothing | `refused` / `webhook_signature_invalid` |
| Other verifier exception | 500 | Nothing | `failed` / `unexpected` |
| Verified, unparseable or untyped | 200 | `invalid_payload` receipt | `rejected` / `webhook_payload_invalid` |
| Verified, unknown or unsubscribed type | 200 | Receipt, type `other` | `recorded` |
| Duplicate `svix-id`, same normalized content | 200 | Nothing new | `duplicate` |
| Duplicate `svix-id`, different normalized content | 200 **after** the flag commits | First kept; `content_conflict = true` | `conflict` (warn) |
| RPC error or unavailable | 500 / 503 | Rolled back | `failed` / `db_*` |
| Logger throws | Unaffected | Unaffected | Swallowed |

The timestamp reason is not split out of `webhook_signature_invalid` in logs. The verifier reports it only in a message string, and the logger never records messages.

---

## 7. Mapping events to attempts (item 3; revised for R2 and R4)

### 7.1 Identifiers

| Identifier | Use |
|---|---|
| `svix-id` | Receipt identity and dedupe only |
| `data.email_id` | Agreement check and fallback match against the ledger's `provider_message_id` |
| **Correlation tags** (7.3C, opt-in, EC-5) | `mm_ledger` ∈ `application\|owner_email\|package_draft`, `mm_ref` (ledger row key, UUID), `mm_attempt` (1–10,000). Values are validated opaque IDs only |
| `data.to`, `from`, `subject`, `message_id` | **Never matched, never stored** |

### 7.2 Receipt-time durable linkage

Inside `email_receive_provider_event`, each new receipt is linked to **at most one** ledger row and attempt, through **one of three nullable FKs**:
- `application_notification` → `private.r0_application_notifications(application_id)`;
- `owner_email_notification` → `private.owner_email_notifications(id)`;
- `package_draft_notice` → `private.package_draft_email_notices(id)`.

Each FK is `ON DELETE CASCADE`, with a check that at most one is set, plus `linked_attempt`.

1. **Tag first.** If all three tags are valid and the referenced row exists with `tag_attempt ≤ attempts`, link it (`link_basis = 'tag'`). Tags are authored by us inside a signed payload, but they are only accepted with the existence and attempt checks.
2. **Else by ID.** If exactly one ledger row across the three has `provider_message_id = email_id`, link it to that row's final attempt (`link_basis = 'provider_id'`).
3. **Else unlinked.**
4. **Never** by recipient, subject, time or `from`.

The links live in `private`, have no client grants, and are read only through the operator-guarded readback. Because each link is an FK that cascades, **a receipt for a deleted source is deleted with it**. A previously matched receipt therefore cannot survive as an "unmatched" one (R2).

### 7.3 Read-time agreement check

A tag-linked receipt is re-checked each time it is read, because the ledger's ID may be recorded after the receipt arrives (an early callback).
- If the linked attempt is the ledger's `sent` attempt, `provider_message_id` is set, and it differs from the receipt's `email_id` → **`id_conflict`**.
- If the receipt's `email_id` equals `provider_message_id` but the tag names an earlier attempt → **`id_conflict`**.
- Agreement and "not yet known" are both acceptable.

### 7.4 Conflicts (R4)

| Conflict | Recorded how | Effect |
|---|---|---|
| **Content conflict**: same `svix-id`, different normalized fields | Inside the receive transaction: `insert … on conflict (svix_id) do nothing`; then `select … for update` on the existing row and compare normalized fields. If they differ, set `content_conflict = true` and `conflict_seen_at`, and keep the **first** normalized receipt unchanged. The differing content is **not stored**. The 2xx is sent only after this commits | **Excluded** from evidence facts, summaries and every non-delivery claim. Counted in the attempt's "Conflicting provider reports" signal, or in a global count if unlinked |
| **ID conflict** (§7.3) | Derived at read time | Same exclusion and signal |
| **Tag invalid** (missing row, future attempt, malformed) | Not linked | Unlinked receipt; no claim |

### 7.5 Cases

| Case | Behavior |
|---|---|
| Early callback (receipt before `*_record`) | Tag-linked at receipt; the agreement check applies once the ID is recorded. Untagged: unlinked (only possible before 7.3C ships; the receiver is unarmed until then, §13.3) |
| Lost API response (`unknown`) | Tag-linked; evidence shown; the row stays `unknown` and its attested recovery is unchanged |
| Unknown type | Stored as `other`; never a fact |
| Unmatched (Auth SMTP, legacy, other senders) | Unlinked, address-free, short expiry (EO-7, §11.4) |
| Duplicate | No-op 2xx |
| Concurrent differing payloads, same `svix-id` | One row (the first to commit); the flag set by the loser; both requests answered 2xx only after commit |
| Several events per email | Kept as history |
| Out of order | The summary uses the fixed rules in §8.3, never arrival order |
| Resend after an earlier attempt | Each receipt stays on its own attempt |
| Source deleted | Linked receipts cascade away |

---

## 8. Proposed event and state model (item 4)

### 8.1 Receipt table (proposed SQL, planning only; 7.3B)

```sql
create table private.email_provider_events (
  svix_id text primary key check (svix_id ~ '^msg_[A-Za-z0-9]{1,64}$'),
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,                 -- set by the receive function (§11.4)
  secret_slot text not null check (secret_slot in ('current','previous')),
  processing text not null check (processing in ('recorded','invalid_payload')),
  event_type text not null check (event_type in (
    'email.sent','email.delivered','email.delivery_delayed','email.bounced',
    'email.complained','email.failed','email.suppressed','other')),
  provider_type text check (provider_type ~ '^[a-z_.]{1,64}$'),
  provider_created_at timestamptz,
  provider_email_id text check (length(provider_email_id) <= 100),  -- shape fixed after a synthetic sample
  bounce_type text check (bounce_type in ('permanent','transient','undetermined','other')),
  bounce_subtype text check (bounce_subtype in ('general','no_email','mailbox_full','message_too_large',
    'content_rejected','attachment_rejected','suppressed','message_rejected','undetermined','other')),
  tag_ledger text check (tag_ledger in ('application','owner_email','package_draft')),
  tag_ref uuid,
  tag_attempt integer check (tag_attempt between 1 and 10000),
  application_notification uuid references private.r0_application_notifications(application_id) on delete cascade,
  owner_email_notification uuid references private.owner_email_notifications(id) on delete cascade,
  package_draft_notice uuid references private.package_draft_email_notices(id) on delete cascade,
  linked_attempt integer check (linked_attempt between 1 and 10000),
  link_basis text check (link_basis in ('tag','provider_id')),
  content_conflict boolean not null default false,
  conflict_seen_at timestamptz,
  check (num_nonnulls(application_notification, owner_email_notification, package_draft_notice) <= 1),
  check ((num_nonnulls(application_notification, owner_email_notification, package_draft_notice) = 1)
         = (linked_attempt is not null and link_basis is not null)),
  check (content_conflict = (conflict_seen_at is not null)),
  check ((processing = 'invalid_payload') = (event_type = 'other' and provider_email_id is null and provider_type is null)),
  check (expires_at > received_at)
);
-- indexes: (provider_email_id); (tag_ledger, tag_ref, tag_attempt); each FK column; (expires_at)
alter table private.email_provider_events enable row level security;
revoke all on private.email_provider_events from public, anon, authenticated, service_role;
```

- **Adding FKs to existing ledgers alters none of their definitions.** A cascade adds work only to deletions of their rows. SQL tests cover those cascades, and the 7.2C functions, the application ledger functions and the money fingerprint stay byte-identical.
- No address, subject, Message-ID, bounce text, header, link, IP, user agent or raw payload is stored.

### 8.2 Ordering for display

Receipts sort by `(provider_created_at nulls last, received_at, svix_id)`. This is deterministic and used **only for display**.

### 8.3 Summary and flags (revised for R3)

Only **trusted** receipts are used: linked, `processing = 'recorded'`, not `content_conflict`, no `id_conflict`, not expired. From them, the derivation computes the fact set **F** (types present) and evaluates the rules **top-down**; the **first** matching rule gives the summary. Ties are therefore deterministic.

| # | Rule over F | Summary label (proposal) | `delivered_fact` | `non_delivery_proven` | `needs_review` |
|---|---|---|---|---|---|
| 1 | `complained` ∈ F | "Handed to the mail server; the recipient marked it as spam" | yes | **no** | yes |
| 2 | `delivered` ∈ F and any of `bounced_permanent`, `provider_failed` or `provider_suppressed` ∈ F | "Provider reports disagree: handed to the mail server, and later reported <bounced permanently / failed / suppressed>" | yes (reported) | **no** | yes |
| 3 | `delivered` ∈ F and (`bounced_transient` or `bounced_undetermined`) ∈ F | "Handed to the mail server; a temporary or undetermined bounce was also reported" | yes | no | yes |
| 4 | `delivered` ∈ F | "Handed to the recipient's mail server. Not proof it reached the inbox or was read" | yes | no | no |
| 5 | Any of `bounced_permanent`, `provider_failed` or `provider_suppressed` ∈ F (no `delivered`, no `complained`) | "Not delivered: Resend reported <a permanent bounce / a failure / suppression>" | no | **yes** | yes |
| 6 | `bounced_transient` or `bounced_undetermined` ∈ F | "Bounce reported (temporary or undetermined); delivery not established" | no | no | yes |
| 7 | `delayed` ∈ F | "Delivery delayed; not yet established" | no | no | no |
| 8 | `accepted` ∈ F | "Accepted by Resend for delivery" | no | no | no |
| 9 | F empty; receiver armed at send time (§8.4) | "No provider report yet" | no | no | no |
| 10 | Otherwise | "Delivery evidence not available" | no | no | no |

- **Full history is always shown** under the summary: type, provider time and bounce category, including excluded receipts, which are marked "Excluded: conflicting report".
- A conflict signal (§7.4) is a **separate** flag, `has_conflict`, shown as "Conflicting provider reports: excluded from this summary". It is independent of the rules.
- **A complaint never counts as non-delivery. A transient or undetermined bounce never counts as non-delivery.** "Delivered" plus a permanent bounce is shown as a disagreement, not resolved by precedence.

### 8.4 Arming record

`private.email_evidence_config` holds a single row with `armed_at`, set in 7.3D. An attempt whose `claimed_at` is earlier than `armed_at` gets rule 10, not rule 9.

### 8.5 Invariants (unchanged)

- No receipt, link or summary changes any ledger column, state, attempt count, claim or event.
- `sent` keeps its meaning and stays terminal.
- Claims, stale-worker refusal (40001), resend and acknowledge permissions and attestations are unchanged. Evidence never unlocks or blocks them.
- No 7.2C, application, price-draft or money-fingerprinted function is restated (`58 | af0fae6e…`).

---

## 9. Operator readback and manual recovery (item 5; revised for R3)

### 9.1 Readback (7.3C)

Owner Emails comes first (EC-9), then Recruiting, then the price-draft panel. The guarded readback (`vendor_require_operator()`) returns labels, flags and enumerations, never IDs, tags or `svix-id`.
- **Per row:** the attempt state as today; the evidence summary (§8.3) with an expandable per-attempt history; the conflict signal.
- **Additive counts.** The existing exact attention counts are unchanged.
  - **"Not delivered (Resend reported)"**: `sent` rows with `non_delivery_proven` on their sent attempt.
  - **"Provider reports to review"**: rows with `needs_review` and not `non_delivery_proven` (complaints, inconclusive bounces, disagreements).
  - **"Conflicting provider reports"**: rows with `has_conflict`.
  - **"Unmatched provider reports"**: a global count of unlinked receipts by type, with no recipient or content.

### 9.2 What an operator may conclude and do (existing functions only)

| Row and summary | Safe conclusion | Action today |
|---|---|---|
| `sent`, rule 4 | Handed to the mail server | None. Inbox confirmation is still the only proof |
| `sent`, rule 5 | Resend reports the notice was not delivered. **The saved record is unaffected** | Work from the saved record (View submission, Compliance Expiry, Vendor Applications, or contact the vendor another way). Fix the cause: the owner address or a suppression entry (a hosted action, EO-5). **No resend:** `sent` is terminal, and a resend to a suppressed address would be suppressed again |
| `sent`, rule 1 | It was handed over, then flagged as spam | Review wording and recipient (EO-4). No automatic action |
| `sent`, rules 2, 3 or 6 | **Inconclusive** | Check the inbox. Handle the saved record if the notice matters |
| `unknown` / `missed`, rule 4 by tag | Strong indication this attempt went out | The existing **acknowledge** with `inbox_evidence_reviewed`, stating what was found. Evidence does not replace the inbox check |
| `unknown` / `missed`, rule 5 by tag | That attempt was not delivered | The existing **resend** with `no_matching_email_found` after fixing the cause |
| Any row with `has_conflict` | The conflicting reports prove nothing | Treat as rules 9 and 10. Report the conflict to Codex or the owner |
| Rules 7–10 | Nothing about delivery | The existing attested recovery |

### 9.3 Later (7.3F; EC-10, deferred)

A transition that resends a `sent` row after proven non-delivery would restate the ledger functions. It is not proposed before 7.3D evidence exists.

---

## 10. Bounce, complaint and suppression; transactional versus marketing (item 6)

**Facts.** All current email is transactional or operational (contract §4.3; **EO-8 asks the owner to confirm against the §1.2 inventory**). Resend enforces its own account-wide suppression. The Mercurius suppression ledger covers R0 early-access and marketing only.

**Proposals (unapproved):**
1. No automatic Mercurius action in 7.3B–7.3D.
2. A bounce or suppression on owner-inbox mail is an operations incident, handled by hand (§9.2).
3. A bounce on vendor contact mail → the operator updates the contact. Whether a complaint should change later transactional sends is **EO-4**.
4. R0 early-access and marketing wiring to `r0_record_email_suppression` happens only when a sender of those classes exists, via the narrow 7.3E path (an address hashed in the receiver and never stored), under EO-4.
5. Removal from Resend's suppression list is owner-only, per address, with a recorded reason (**EO-5**).
6. Auth SMTP suppression is a support matter. No Mercurius suppression.

---

## 11. Minimization, access, redaction and retention (item 7; retention revised for R2)

### 11.1 Retained fields

Exactly the §8.1 columns.

| Payload field | Retained? |
|---|---|
| `type`, `created_at`, `data.email_id` | Yes (validated) |
| `data.tags` | Only the three validated `mm_*` keys |
| `bounce.type`, `bounce.subType` | Enumerated |
| `to`, `from`, `subject`, `message_id`, `bounce.message`, `diagnosticCode`, headers, link, IP, user agent | **No** |
| Raw body | **No** |

### 11.2 Access

- The table is in `private`, with RLS on and all privileges revoked.
- Insert, link and purge happen only inside `email_receive_provider_event` (service role only) and the operator-guarded purge command (§11.4).
- Readback is operator-guarded.
- Anonymous, authenticated non-operator, vendor and homeowner callers get 42501.

### 11.3 Logs (EC-6)

- **Existing v2 key set** (16 keys). New route `resend_webhook`; new events `email_webhook.refused | rejected | recorded | duplicate | conflict | failed`.
- **New error codes:** `webhook_headers_invalid`, `webhook_payload_too_large`, `webhook_payload_invalid_encoding`, `webhook_signature_invalid`, `webhook_payload_invalid`.
- **Never logged:** the secret, signature, secret slot, `svix-id`, email ID, tags, recipient, subject, body, bounce text or event type.

### 11.4 Retention and deletion (R2): proposed design for EO-2

**Mechanism, built in 7.3B, before any collection:**
1. **Source-lifetime bound (durable):** linked receipts cascade with their ledger row, which cascades with its source (§7.2). SQL tests delete a contact submission, a vendor application and a price draft, and prove their receipts are gone.
2. **Finite clock (all receipts):** the receive function sets `expires_at = received_at + interval`. The intervals are **owner-chosen (EO-2)**. **Proposal:**
   - **linked receipts: 90 days;**
   - **unlinked, `other` and `invalid_payload` receipts: 30 days.** That is longer than the ≈32 h retry horizon (for dedupe), and short because the receipts are not ours to explain.

   Both are below CFG-011's 90-day operational-log class. Matched evidence older than 90 days has little recovery value: the ledger keeps the settled outcome.
3. **Logical expiry (immediate, enforced in the database):** every readback, summary and count excludes rows with `expires_at <= now()`. Once expired, a receipt is never shown, counted or used, even before physical deletion.
4. **Physical deletion, without new automation:**
   - **(a) Purge on receipt:** each receive call deletes up to 100 expired rows, in the same transaction, oldest first.
   - **(b) Operator purge command:** `email_provider_events_purge(p_limit)`, operator-guarded and bounded. It returns the number deleted and the oldest remaining `expires_at`, and is audited by count only. This follows the Phase 5 retention precedent.
   - **Physical upper bound:** an expired row is gone at the next receipt or the next operator purge, whichever comes first. With no traffic and no operator purge, a row can outlive `expires_at`, though it stays logically expired.
5. **Optional (c), a scheduled purge:** an owner-approved `pg_cron` job calling the same function. Not proposed for activation without EO-2's choice. It would be a new scheduler activation.

**Activation gate.** The receiver is not armed (7.3D) until:
- EO-2 names the intervals and the mechanism (a+b, or a+b+c);
- SQL tests prove cascade, logical expiry, purge-on-receipt, operator purge and boundary times;
- the hosted readback after arming shows `0` rows past `expires_at` + the agreed lag.

**Deferring enforcement to 7.6 is withdrawn.** 7.6 keeps CFG-011 for log lines only.

---

## 12. Domain authentication and controlled acceptance (item 8)

| Work | Where | Who and when |
|---|---|---|
| Receiver, store, linkage, expiry, tests, env names | Repository | 7.3B / 7.3C |
| Migration push | Hosted Supabase | Owner-authorized, before merge (DEC-2026-037) |
| Secrets | Vercel Production | Owner (CFG-013) |
| Webhook registration (EO-3 events) | Resend | Owner-authorized, 7.3D |
| Domain status readback | Resend `GET /domains` (read-only) | Owner-authorized, 7.3D; domain, status and region only |
| DNS | GoDaddy | **No change proposed.** A dated read-only lookup refreshes the 2026-10-01 evidence |
| Real sends | App to `resend.dev` test addresses and the controlled mailbox | Owner-authorized, 7.3D (EO-6) |

**Controlled acceptance (7.3D, proposal):**
1. **`resend.dev` test addresses** through a synthetic operator-only path defined in 7.3D. Expected summaries:
   - `delivered@` → rule 4;
   - `bounced@` → rule 5 (and confirm the bounce `type` strings);
   - `complained@` → rule 1, never in the not-delivered count;
   - `suppressed@` → rule 5.
2. **Controlled mailbox:** one synthetic contact submission and one synthetic provider renewal. Expected: ledger `sent`, rule 4, **and** a human sees each email in the inbox. Only the human check proves inbox arrival.
3. **Retry and re-signing proof (before arming is accepted):** a dashboard replay of a message older than 5 minutes must verify under the fixed ±300 s check. If it fails, stop: the design must change before activation (EC-3).
4. **Rotation rehearsal** with both slots (§6.4).
5. **Headers** of the controlled email show DKIM, SPF and DMARC passing.
6. **Expiry readback** (§11.4).

---

## 13. Dependencies, rollout, acceptance and slices (item 9)

### 13.1 Dependencies

- #167 is merged, so renewal rows exist in source. Its post-deploy rollout reconciliation and its review record remain open (§1.2). They do not block 7.3B, which touches none of its objects except by adding FKs to them.
- Dependency review of `svix` 2.9.1 and its transitive packages (EC-2), following [PHASE-5-DEPENDENCY-SECURITY](PHASE-5-DEPENDENCY-SECURITY.md). If rejected, stop and return to Codex.
- EO-2, EO-3 and EO-7 before arming; EO-1 and EO-6 for each hosted action.

### 13.2 First slice: 7.3B, dormant authenticated receipt (not yet cleared)

**Scope:**
- one additive migration: the §8.1 table and `email_evidence_config` (empty); `email_receive_provider_event` (service role only, with linkage, conflict and purge-on-receipt); `email_provider_events_purge` (operator-guarded); explicit revokes;
- the route (§6) and a server-only verifier wrapper around `svix@2.9.1`, exact-pinned;
- env names; v2 logger allowlist additions;
- SQL, unit and concurrency tests, and their CI step;
- the 7.3B record.

**Out of scope:** tags at send time, the readback UI, suppression, any hosted push, secret, registration or send.

**Acceptance criteria:**
1. Dormant without the secret: 503, no body read, nothing stored.
2. Every §14 case for 7.3B passes, with locally generated secrets and synthetic signed payloads.
3. Exactly one receipt per `svix-id` under concurrency, including differing payloads.
4. No 2xx before commit.
5. Expiry, cascade and purge are enforced and tested.
6. No PII is retained or logged.
7. v1 unchanged; v2 exact-key test extended, still 16 keys.
8. Existing function definitions unchanged: application ledger `10 | 5f14532a…`; 7.2C-1 `12 | 016c0e68…`; renewal submit `8c894236…`; renewal trigger function `b1607618…`; fingerprint `58 | af0fae6e…`.
9. The dependency review is recorded.
10. Full SQL, unit, lint, typecheck, secret scan and build pass; exact-head CI passes.

**Rollout:**
1. Codex review and CI.
2. Owner-authorized dry run and push. The migration adds only unused objects, and FKs on an empty table.
3. Read-only readback.
4. Merge and deploy. The route answers 503.

**Rollback:** promote the previous deployment. The objects stay, unused. Fix forward.

### 13.3 Later slices (proposals)

| Slice | Content | Gate |
|---|---|---|
| **7.3C** | Opt-in validated tags on the shared sender for the three ledger helpers (an additive parameter; keys stay per attempt, so no 409 from a reused key); read-time agreement and summary function; arming record use; readback columns, counts and history (owner emails first); browser tests (MDS, axe, 320 px) | Codex review |
| **7.3D** | Hosted push, secrets, registration, domain readback, controlled acceptance (§12), rotation, expiry readback, dated evidence. **The receiver is armed only after 7.3C is deployed**, so every ledger send is tagged | EO-1, EO-2, EO-3, EO-6, EO-7 |
| **7.3E** | Suppression, only as approved | EO-4, EO-5 |
| **7.3F** | Resend after proven non-delivery | EC-10, deferred |
| **7.6** | Alerts (evidence gaps, unmatched spikes, endpoint disablement), log drain, CFG-011 for logs | Existing |

---

## 14. Synthetic acceptance cases

All cases use locally generated secrets and synthetic payloads. "Rejected" means: no decode or verify after the rejecting step (spies), no RPC, and no row.

| # | Case | Expected |
|---|---|---|
| S-1 | No secret; malformed secret (constructor throws) | 503; body not read |
| S-2 | Each `svix-*` header missing; `svix-id` malformed; timestamp `"123abc"` or 13 digits; signature header over 1,024 bytes, 9 entries, or an entry over 128 bytes | 400; body not read; `verify` not called |
| S-3 | `Content-Length` 70,000 with a small body | 413 before reading |
| S-4 | **No `Content-Length`**, chunked body of 65,537 bytes | 413; `reader.cancel()` observed; no decode, `verify` or RPC |
| S-5 | **False `Content-Length`** (declares 100, streams 80,000) | 413 at the byte ceiling; stream cancelled |
| S-6 | `Content-Length` invalid (`abc`, negative) | Ignored; the byte ceiling still applies |
| S-7 | Body of exactly 65,536 bytes containing multibyte characters (byte count ≠ character count) | Accepted when signed; 65,537 bytes → 413 |
| S-8 | A multibyte character split across two chunks | Decodes correctly; verifies |
| S-9 | Invalid UTF-8 bytes | 400; `verify` not called |
| S-10 | Body re-read with `request.text()` or parsed before verify (mutation) | Tests fail |
| S-11 | Wrong signature; a different secret; truncated; only non-`v1` entries | 400 (`WebhookVerificationError`) |
| S-12 | One byte altered after signing | 400 |
| S-13 | Timestamp 301 s old or 301 s ahead (fake clock) | 400 (`WebhookVerificationError` from the verifier); no own range check (spy) |
| S-14 | Several `v1` entries, only the second matching | Accepted |
| S-15 | Rotation: signed with previous only, previous configured; previous unset | Accepted, slot `previous`; then 400 |
| S-16 | **Verifier throws a non-`WebhookVerificationError`** (injected) | 500; no receipt; never 2xx |
| S-17 | **Verified non-JSON; verified JSON without `type`; verified empty body** | 200; `invalid_payload` receipt with no data |
| S-18 | **Same non-JSON body with an invalid signature** | 400; no receipt (proves authentication runs before the malformed path) |
| S-19 | Verified unknown type | 200; `other` |
| S-20 | Replay of the same request | 200 twice; one row; `duplicate` |
| S-21 | 8 concurrent identical deliveries (real database) | 1 row; 7 `duplicate` |
| S-22 | **8 concurrent deliveries, same `svix-id`, 2 different normalized contents** | 1 row with the first committed content; `content_conflict` true; every 2xx after commit |
| S-23 | Conflict flag update fails (injected) | 5xx; no 2xx |
| S-24 | RPC error; database unavailable | 500 / 503; nothing stored |
| S-25 | Commit then lost response | Next delivery `duplicate` |
| S-26 | Logger throws everywhere | Responses and storage unchanged |
| S-27 | RPC, purge or table access by anon, authenticated, vendor or homeowner sessions | 42501 / denied; purge refused to non-operators |
| S-28 | Sentinel PII in every non-retained field, and in extra tags | Absent from the row, logs and responses |
| S-29 | Secret, signature, slot, `svix-id` and email ID in logs | Absent |
| S-30 | Non-POST | 405 |
| S-31 | Tag link to an existing row and attempt; to a missing row; to attempt > attempts | Linked; unlinked; unlinked |
| S-32 | ID fallback link; two ledgers sharing an ID (impossible by construction; forced) | Linked to one; ambiguous → unlinked |
| S-33 | **Delete a contact submission, a vendor application, or a price draft** | Their linked receipts are cascade-deleted; no unlinked survivor |
| S-34 | Expiry: a row at `expires_at - 1 s` and at `expires_at` | Visible, then excluded from every readback |
| S-35 | Purge on receipt: 150 expired rows, then one receive | 100 deleted, oldest first, in the same transaction |
| S-36 | Operator purge | Bounded deletion; returns count and oldest remaining; non-operator refused |
| *7.3C* | | |
| S-37 | Early callback: tag-linked receipt before `*_record`; the record then commits a matching or a different ID | Agreement → trusted; different → `id_conflict`, excluded |
| S-38 | `unknown` row with a tagged delivered receipt | Rule 4 shown; row stays `unknown`; resend still needs attestation |
| S-39 | **Delivered + complaint** (either arrival order) | Rule 1; `delivered_fact` yes; **not** in "Not delivered"; in "to review" |
| S-40 | **Delivered + transient bounce**; delivered + undetermined bounce | Rule 3; not in "Not delivered" |
| S-41 | **Permanent bounce only** | Rule 5; in "Not delivered" |
| S-42 | **Delivered + permanent bounce** (either order) | Rule 2 (disagreement); **not** in "Not delivered"; in "to review" |
| S-43 | Transient bounce only | Rule 6; never "not delivered" |
| S-44 | Same facts in every arrival permutation (property test) | Identical summary and flags |
| S-45 | **A content-conflicted receipt that would change the summary** (for example a permanent bounce) | Excluded; summary from the others; `has_conflict` shown; not in "Not delivered" |
| S-46 | Readback after concurrent differing payloads (S-22) | The conflict signal is visible; evidence excludes the receipt |
| S-47 | Event for attempt 1 after attempt 2 | Attempt 1 only |
| S-48 | Recipient equals a ledger address, but no tag or ID | Unlinked (no recipient matching) |
| S-49 | Attempt claimed before `armed_at` | Rule 10 |
| S-50 | Labels never say "Delivered", "Received" or "Read" alone; rule 4 always carries the disclaimer (browser) | Pass |
| S-51 | Stale worker after a resend request, with receipts present | 40001 unchanged |

---

## 15. Decisions

### 15.1 Owner decisions: proposals, **none approved**

Codex's review recommendations are noted beside each. They are not approvals.

| ID | Question | Recommendation (proposal) |
|---|---|---|
| **EO-1** | Authorize 7.3D hosted activation (push, secrets, registration)? | Later, per action |
| **EO-2** | Receipt retention: intervals and enforcement mechanism (§11.4) | Linked 90 days, unlinked 30 days; purge on receipt plus an operator purge, with logical expiry immediate; optional `pg_cron` purge as a separate approval. *Codex recommends minimal finite retention with enforceable deletion.* No arming before this is decided and tested |
| **EO-3** | Subscribed events | The seven operational types: `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `failed`, `suppressed`. Not opens or clicks. *Codex concurs as a recommendation* |
| **EO-4** | Should a bounce or complaint on transactional mail change later sends? | No automatic action; operator review only. *Unapproved* |
| **EO-5** | Who removes addresses from Resend's suppression list, and how is it recorded? | Owner only, per address, with a reason. *Unapproved* |
| **EO-6** | Controlled acceptance with `resend.dev` test addresses and the controlled mailbox | Yes, in 7.3D, separately authorized |
| **EO-7** | Keep minimal, address-free receipts for unmatched mail (Auth SMTP, legacy)? | Yes, 30 days. *Codex recommends minimal address-free receipts* |
| **EO-8** | Confirm that all current email is transactional or operational, against the §1.2 inventory at `8a9603b` | Confirm |

### 15.2 Codex technical directions (from review #5891386779), as recorded

| ID | Direction | Where applied |
|---|---|---|
| EC-1 | A Next `nodejs` Route Handler | §6.1 |
| EC-2 | The exact-pinned official Svix verifier, subject to dependency review; **no silent cryptography fallback** | §4.3, §13.1, §13.2. Candidate `svix@2.9.1` (newest version past two weeks); review covers its transitive dependencies |
| EC-3 | ±5-minute freshness through the verifier's supported checks; controlled retry and replay proof before activation | §4.3 (fixed 300 s constant), §6.2 step 7 (no own range check), §12 item 3 |
| EC-4 | Read-time evidence, conditional on R2 and R4 | Revised: durable receipt-time linkage (§7.2) **plus** read-time agreement and summary (§7.3, §8.3) |
| EC-5 | Opt-in, validated, opaque tags with agreement checks | §7.1, §7.3, §13.3 (7.3C) |
| EC-6 | The existing v2 key count; secret slot on the receipt only | §6.4, §11.3 |
| EC-7 | Signed-non-JSON policy subject to R5 | §4.3 and §6.2 step 9: reached only after a normal `verify` return; S-16 to S-18 |
| EC-8 | 64 KiB as an enforced raw-byte ceiling, with measured fixtures | §6.2 steps 4–5. 7.3B measures the largest synthetic payload (75 tags, long bounce text) and records the margin |
| EC-9 | Owner-email readback first | §9.1 |
| EC-10 | Defer new resend transitions | §9.3 |

### 15.3 Open for Codex re-review

1. Is receipt-time linkage through three nullable cascading FKs on the receipt table acceptable, given it adds cascade work to deletions of existing ledger rows? (No SQL path that deletes those rows or their sources was found: §3.1. S-33 therefore deletes sources directly in tests.)
2. Purge-on-receipt batch size (100), and whether physical deletion lag without traffic is acceptable when logical expiry is immediate.
3. Rule 2 (delivered plus permanent bounce as "disagreement", not non-delivery): confirm the wording and that it should stay out of the "Not delivered" count.
4. Header bounds (1,024 bytes; 8 entries; 128 bytes per entry; `svix-id` pattern), pending a synthetic Resend sample.
5. Invalid UTF-8 → 400 (unauthenticated) versus verifying first and then recording `invalid_payload`. The plan chooses 400, because lenient decoding before authentication would verify bytes other than those retained.

---

## 16. Carried register (unchanged by this plan)

- **CFG-011:** 90-day log retention not met (7.6). Receipt retention is now designed for EO-2 (§11.4) and is **not** deferred to 7.6.
- **A2 human verification:** NOT PERFORMED; booking-readiness register.
- **Retrospective Codex review of 7.2B:** open.
- **7.2C-2 (#167):** merged. Its Codex review record, a deployment READY readback, the post-deploy renewal-window reconciliation and the stale status line in its record are open (§1.2). This plan does not perform or claim them.
- **Real-email verification** for 7.2C-1 and 7.2C-2: not performed.
- **Final booking-readiness checks** (schema and grants, fingerprint, completion integrity on the final candidate): open.
- **Older intermittent accessibility failure** (`request.spec.ts:837`): historical, undiagnosed.
- Gates `offer_terms` and promotions are off. No payments, booking, Cron, retries, reminders or suppression.

---

## 17. Validation of this document

- Baseline facts: `git fetch`; `gh pr view 167`; `gh run list`; `gh api` (reviews, deployments) on 2026-11-13. No hosted Supabase or Vercel query.
- Provider facts: fetched official pages (Sources). Library facts: the published `svix@2.9.1` and `standardwebhooks@1.1.1` tarballs, read in a scratch directory outside the repository and not executed.
- No tests were run: no code changed. `git diff --check`, the secret scan and a relative-link check were run on the documentation diff (§19).

## 18. Codex review #5891386779: finding-to-resolution table

| Finding | Summary | Resolution in this revision | Tests |
|---|---|---|---|
| **R1** | `request.text()` reads the whole body before the 64 KiB check; header bounds missing | §6.2 steps 3–6: bounded header checks; advisory `Content-Length`; a streamed byte counter with `reader.cancel()` at overflow; fatal UTF-8 decoding of the exact retained bytes; no `text()`/`json()`/`arrayBuffer()`; nothing verified or stored after rejection | S-2 to S-10 |
| **R2** | Read-time matching can't enforce "follow source lifetime"; purge deferred to 7.6 | §7.2 durable FK linkage with cascade; §11.4 finite expiry for all receipts, immediate logical expiry, purge on receipt and an operator purge (optional `pg_cron` as a separate approval); an activation gate on EO-2 plus tested enforcement; the 7.6 deferral withdrawn | S-33 to S-36 |
| **R3** | A complaint counted as "not delivered"; inconclusive bounces ranked above delivery | §8.3 replaces single-precedence evidence with fact sets, top-down deterministic rules and independent flags (`delivered_fact`, `non_delivery_proven`, `needs_review`); full history kept; §9.1 separate counts; §9.2 recovery wording revised | S-39 to S-44 |
| **R4** | Content-conflicted receipts not excluded from evidence | §7.4: first normalized receipt kept; a durable flag in the same transaction; 2xx only after commit; excluded from every summary and claim; `has_conflict` signal; read-time ID conflicts treated the same | S-22, S-23, S-45, S-46 |
| **R5** | The verifier may not separate authentication failure from malformed content | §4.3 inspected the `svix@2.9.1` source: `verify` returns `undefined` without parsing (`jsonParse: false`) and throws `WebhookVerificationError` for authentication failures; §6.2: our parse is separate, any other exception → 500, and verification exceptions are never 2xx; no handwritten fallback | S-11 to S-18 |
| Baseline | Reconcile #167's merge; separate kinds of evidence | §1.1 history kept; §1.2 separates source and CI, review, hosted migration, deployment metadata and rollout reconciliation | — |
| Conflicts | Handoff and TRACEABILITY | Both sides kept (§1.2) | — |
| EC directions | Record them | §15.2 | — |

## 19. Revision validation

Recorded in the PR body and handoff: `git diff --check`, `node scripts/scan-secrets.mjs`, and a relative-link existence check over this document and the handoff entry.

## Sources

- [Event types]: <https://resend.com/docs/dashboard/webhooks/event-types>
- [Verify]: <https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests>
- [Retries]: <https://resend.com/docs/dashboard/webhooks/retries-and-replays>
- [Webhooks introduction]: <https://www.resend.com/docs/webhooks/introduction.md>
- [Bounced event]: <https://www.resend.com/docs/webhooks/emails/bounced.md>
- [Bounces]: <https://resend.com/docs/dashboard/emails/email-bounces>
- [Suppression KB]: <https://www.resend.com/docs/knowledge-base/why-are-my-emails-landing-on-the-suppression-list.md>
- [Idempotency]: <https://resend.com/docs/dashboard/emails/idempotency-keys>
- [Tags]: <https://resend.com/docs/dashboard/emails/tags>
- [Retrieve]: <https://resend.com/docs/api-reference/emails/retrieve-email>
- [Test emails]: <https://resend.com/docs/dashboard/emails/send-test-emails>
- [Domains]: <https://resend.com/docs/dashboard/domains/introduction>
- [Svix manual]: <https://docs.svix.com/receiving/verifying-payloads/how-manual>
- [Svix receiving]: <https://docs.svix.com/receiving/introduction>
- [Svix library verification]: <https://docs.svix.com/receiving/verifying-payloads/how>
- Library source: `svix@2.9.1` (npm, 2026-10-26) and `standardwebhooks@1.1.1` (npm, 2026-08-28) tarballs, inspected 2026-11-13
- Secondary, ordering only: <https://www.svix.com/blog/guaranteeing-webhook-ordering/>
