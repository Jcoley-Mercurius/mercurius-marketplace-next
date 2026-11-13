# Phase 7.3A — Email delivery evidence and safe recovery: characterization and plan (TRACE-155)

**Status:** PLAN FOR CODEX REVIEW. Documentation only. Approves nothing, activates nothing.
**Branch:** `claude/phase7-3a-email-evidence-plan`, from `origin/main` `24dd455acd520a21da14b0305a92383fbedfcccf`.
**Authority:** the owner's Phase 7.3A instruction (2026-11-13), under the Phase 7 authorization ([PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md)). Roadmap Phase 7: "Implement email delivery/retry evidence and domain authentication". MTS §5 (line 78), §7 (line 193), §9, §11. MPS §10. Contract [§7.4](PHASE-7-NOTIFICATION-CONTRACT.md) Category 4.
**Precedence:** MPS → MDS → MTS → implementation evidence. Where this plan recommends something no authority approves, it says **proposal**.

---

## 0. Summary

1. **What `sent` means today.** Every ledgered email path records `sent` when Resend's API accepts the request. Nothing in the repository records whether the email reached a mail server, bounced, was marked as spam, or was suppressed by Resend. **No webhook receiver for Resend exists** (§3).
2. **Provider facts.** Per Resend's documentation, `email.sent` means "the API request succeeded, and Resend will attempt delivery". `email.delivered` means Resend handed the email to the recipient's mail server. Neither is proof that the email reached an inbox or that a person saw it. Resend can also suppress, fail or bounce an email **after** the API accepted it (§4). Our `sent` state can therefore hide non-delivery.
3. **The hard problem is mapping.** Today, the provider email ID is stored only on `sent` and only for that attempt. An `unknown` attempt (timeout, 5xx or 409) never learns its ID. A webhook can also arrive before the outcome is recorded. Supabase Auth mail goes through Resend SMTP with no local record. **Recipient email is never a matching key** (§7).
4. **Recommended model.** Keep a separate store of **provider evidence** that sits beside the send-attempt ledgers and never changes them.
   - Store only verified, allowlisted, minimal webhook receipts.
   - Match receipts to attempts **when they are read**, by provider email ID, then by signed correlation tags added at send time.
   - Rank evidence by a fixed precedence, not by arrival order.
   - Claim authority, attempt history, stale-worker refusal, resend and acknowledge rules, and the meaning of `sent` are all unchanged (§8).
5. **First implementation slice (proposed 7.3B):** a **dormant** authenticated receiver, `POST /api/webhooks/resend`.
   - It verifies the raw-body signature (current and previous secret), enforces timestamp tolerance and a size cap, and stores a duplicate-safe minimal receipt through one service-role RPC.
   - It returns a status that makes Resend retry only when a retry can help.
   - Without its secret it refuses everything (503). It is not registered with Resend.
   - It has no matching UI, no tags, no suppression and no hosted change (§13.2).
6. **Owner decisions** EO-1..EO-8 (§15.1) and **Codex decisions** EC-1..EC-10 (§15.2). None blocks Codex review of this plan. EO-2 (retention), EO-3 (subscribed events) and EO-7 (Auth-mail receipts) must be answered before hosted activation (7.3D).

---

## 1. Baseline verification (2026-11-13, before writing)

| Check | Result |
|---|---|
| `origin/main` | `24dd455acd520a21da14b0305a92383fbedfcccf`, the #166 merge (7.2C-1). Matches the handoff |
| Main CI on `24dd455` | Run 43343682357: **success** (backend, lifecycle, application), as recorded on #167 and confirmed in `gh run list` |
| Open PRs | Only **#167**, draft, `codex/phase7-2c2-renewal-handoff`, base `main`, mergeable |
| #167 head | **`7dbdf5a7a52e7d22f78c5c7a2a7f452c0fbc6e49`**. **This differs from the `f5305c2` named in the instruction:** one later commit records the owner-authorized hosted push of `20261123001000` (documentation only: handoff, 7.2C-2 record, TRACEABILITY) |
| #167 CI | `f5305c2`: run 43419555745 **success**. `7dbdf5a`: one run cancelled; one **in progress** at writing. No result is claimed for `7dbdf5a` |
| 7.2C-2 hosted state | #167's own record (§6.1) says the migration was pushed on 2026-11-13 on the owner's instruction, with a matching readback. **Not re-verified here**: this slice makes no hosted query. #167 is unmerged and undeployed. Its record also says the renewal push-to-deploy window is open |
| Working tree | The main checkout was clean on #167's branch. This plan uses a separate worktree (`../mercurius-phase7-3a-email-evidence`). #167 is not modified |
| TRACE ID | Highest used ID on `main`, every remote branch and #167: TRACE-154. **TRACE-155 is unused** |

**Main versus proposed behavior.** On `main`, contact submissions are ledgered (7.2C-1). Renewal-document owner emails are **not** ledgered in deployed code: the renewal route still sends untracked. #167 proposes the renewal ledger. Where this plan says "owner-email ledger", the contact kind is on `main`; the renewal kind is **#167, proposed**.

---

## 2. Scope and boundary of this plan

**In scope:** characterization; verified provider behavior with sources; a proposed evidence and state model, ingestion design, mapping rules, operator readback, suppression questions, data minimization, domain and real-email acceptance; slices, acceptance criteria and decisions.

**Not done here:** no application, database, migration, CI, dependency or configuration change. No hosted query, Resend dashboard action, DNS change, webhook registration or email. No automatic retry, reminder, suppression action, payment, booking, promotion or `offer_terms` activation. No test was run, because no code changed.

---

## 3. Current state (characterization)

### 3.1 Email paths and what each records

| Path | Transport | Ledger | Provider ID stored | Recipient |
|---|---|---|---|---|
| Vendor application → owner (N-APP-01) | Next `after()` → `sendOwnerNotification` → Resend API | `private.r0_application_notifications` + events ([20260929003000…sql:19](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L19)) | `provider_message_id`, only on `sent` | Owner inbox |
| Contact form → owner (N-SUP-04) | Same sender, through `deliverOwnerEmail` | `private.owner_email_notifications` (`main`, [20261122001000…sql:33](../supabase/migrations/20261122001000_phase7_owner_email_ledger.sql#L33)) | Same, only on `sent` ([:231](../supabase/migrations/20261122001000_phase7_owner_email_ledger.sql#L231)) | Owner inbox |
| Renewal document → owner (N-APP-05) | `main`: untracked send. #167: same ledger, kind `renewal_document` | `main`: none. #167: owner-email ledger | `main`: none | Owner inbox |
| Price draft → vendor contact on file (N-PRC-01, DEC-2026-041 item 6) | `sendNotificationEmail(…, recipient)` | `private.package_draft_email_notices` ([20261018004000…sql:83](../supabase/migrations/20261018004000_pricing_owner_decisions.sql#L83)) | `provider_message_id`, only on `sent` | **A vendor's contact email**: the only ledgered path to an external third party |
| Provider invitation (N-APP-03); homeowner verification and recovery (N-APP-04) | Supabase Auth → custom SMTP through Resend ([R0-VENDOR-READINESS](R0-VENDOR-READINESS.md) "Email paths") | Invitation reservation only; Auth-owned | **None.** The SMTP send returns no Resend ID to the application | Invitees and **homeowners** |
| Legacy `vendor-application-notify` Edge function | Resend through a third-party gateway ([index.ts:70](../supabase/functions/vendor-application-notify/index.ts#L70)) | None | None | Owner. Whether it is still deployed or invoked is UNKNOWN (contract G2-06, G3-09) |

### 3.2 The shared sender ([ownerNotifications.ts](../src/lib/ownerNotifications.ts))

- It sends `POST https://api.resend.com/emails` with `from`, `to: [one address]`, `subject`, `text`, optional `reply_to` and an optional `Idempotency-Key` header. It has a 10 s timeout.
- **It sends no Resend `tags` and no custom headers.** The returned `id` is the only identifier that could later link a send to a webhook event.
- Classification (in [applicationNotifications.ts:76-92](../src/lib/applicationNotifications.ts#L76)): 2xx → `sent`; 409 and 5xx → `unknown`; timeout or network error → `unknown`; any other 4xx → `failed`; not configured → `failed`, with nothing sent. This matches Resend's documented idempotency semantics: 409 means a concurrent request or a mismatched payload (§4).

### 3.3 Claim, outcome and recovery (unchanged by this plan)

All three ledgers follow the TRACE-104 pattern:
- a row-locked claim that yields a claim UUID;
- an outcome accepted only for the current claim (40001 otherwise);
- passive 10-minute expiry (`missed` / `unknown` as derived states);
- operator resend (`resend_requested`), with attestation for uncertain rows;
- acknowledgement (owner-email and application ledgers);
- **`sent` is terminal**: no ledger function resends or acknowledges a `sent` row.

The owner-email ledger records attestations `no_matching_email_found` (resend) and `inbox_evidence_reviewed` (acknowledge) ([7.2C-1 §1](PHASE-7-OWNER-EMAIL-LEDGER-7-2C-1.md)).

### 3.4 Logger ([operationalLog.ts](../src/lib/observability/operationalLog.ts))

- `mercurius.oplog.v1` has 14 fixed keys; `v2` adds `source_kind` and `source_id`.
- The schema is fixed per event name. Error codes and outcomes are enumerated, and the sink swallows failures.
- Provider message IDs, claim IDs, idempotency keys and provider bodies are never logged.
- Logs are best effort, and the durable ledger is the authority ([7.1 §7](PHASE-7-APPLICATION-NOTIFICATION-TRACING.md)).

### 3.5 Existing webhook precedent

The Stripe webhook is the only provider webhook ([stripe-webhook/index.ts](../supabase/functions/stripe-webhook/index.ts)):
- It is a Supabase Edge function with `verify_jwt = false` ([config.toml:52](../supabase/config.toml#L52)) and a mode gate (503 unless armed).
- It verifies the SDK signature over the raw `request.text()` (400 if invalid), normalizes the event to minimal allowlisted fields ([_shared/moneyWebhook.ts](../supabase/functions/_shared/moneyWebhook.ts)), then commits the receipt before processing.
- `money_receive_event` inserts with `on conflict do nothing` and raises on an identity conflict ([20260905001000…sql:224](../supabase/migrations/20260905001000_money_contracts.sql#L224)).
- It answers 500 when a retry is required.

This is the design to mirror, with two exceptions:
- Stripe stores a normalized payload. This plan stores less (§11).
- MTS places Resend in server-only Next code with `RESEND_*` in Vercel (MTS §9), so the recommended host is a Next route (EC-1).

### 3.6 Other relevant facts

- **Suppression ledger exists but is dormant.** `public.r0_record_email_suppression(p_email, p_scope, p_reason ∈ bounce|complaint|operator)` and `r0_email_allowed(p_email, p_class ∈ early_access|marketing)` hash the address and are executable by service role only ([20260929001000…sql:509](../supabase/migrations/20260929001000_r0_interest_consent.sql#L509)). Nothing calls them from a provider event. They cover only R0 early-access and marketing classes, and **no sender of either class exists** (contract §4.3).
- **Proxy.** [src/proxy.ts:104](../src/proxy.ts#L104) matches only `/admin/:path*` and `/vendor/:path*`. A route under `/api/webhooks/` is not intercepted.
- **Next.js 16.4.3** (installed docs `01-app/03-api-reference/03-file-conventions/route.md`): Route Handlers read the raw body with `await request.text()`, and no `bodyParser` configuration exists or is needed. The docs' "Webhooks and callback URLs" section (`02-guides/backend-for-frontend.md:556`) uses Route Handlers for provider callbacks.
- **Deployments.** Only `main` deploys ([vercel.json](../vercel.json), DEC-2026-037). There is no preview endpoint to register, so any registered endpoint is production. Previews share the production database (AGENTS.md).
- **Domain authentication evidence is historical.** [R0-RELEASE-CANDIDATE](R0-RELEASE-CANDIDATE.md) lines 121 and 263 (2026-09-30 / 2026-10-01) record:
  - SPF on `send.` resolving to `include:amazonses.com`;
  - DKIM `resend._domainkey` published;
  - bounce MX on `send.`;
  - DMARC `p=quarantine` with relaxed alignment;
  - one real Auth confirmation email with DKIM, SPF and DMARC passing.

  It also says "Resend's own domain status still needs its API". No later readback is recorded.

### 3.7 Gaps

| ID | Gap |
|---|---|
| D-1 | No delivery, bounce, complaint, failure or suppression evidence for any email (MTS §7 "delivery monitoring") |
| D-2 | `sent` can stand for an email Resend later suppressed or failed. Operators are told to "confirm in the inbox", but nothing flags the rows that need it |
| D-3 | An `unknown` attempt's provider ID is never known, so its later events cannot be matched by ID |
| D-4 | Auth SMTP and legacy sends have no local record. Their events (if emitted) would be unmatched and may concern homeowner addresses |
| D-5 | No path for "accepted, then not delivered": `sent` is terminal in every ledger |
| D-6 | Bounce and complaint handling is unwired. No transactional suppression policy exists |
| D-7 | Domain-authentication evidence is dated 2026-10-01 and has no Resend-side status readback |

---

## 4. Provider behavior (Resend), verified versus not verified

Fetched 2026-11-13. Sources are listed at the end. A claim is **verified** only where a fetched official page states it.

### 4.1 Verified

| Topic | Verified statement | Source |
|---|---|---|
| `email.sent` | "The API request succeeded, and Resend will attempt delivery" | [Event types] |
| `email.delivered` | Resend "successfully delivered the email to the recipient's mail server" | [Event types] |
| Other email events | `email.delivery_delayed` (temporary issue); `email.bounced` (recipient's server permanently rejected); `email.complained` (delivered, marked as spam); `email.failed` (error such as invalid recipient, API key, domain or quota); `email.suppressed`; `email.opened`; `email.clicked`; `email.scheduled`; `email.received`. Non-email events also exist (domain, contact, suppression `suppression.added/removed`, topic, inbox) | [Event types] |
| Retry identity | "Retries reuse the same `svix-id` header, so deduplicate on it" | [Event types] |
| Payload fields | Envelope `type`, `created_at`. `data`: `email_id`, `created_at`, `from`, `to` (array), `subject`, `message_id` (absent on `email.scheduled`, `email.failed` and `email.suppressed`), `tags`, `broadcast_id`, `template_id`, and for bounces `bounce.type`, `bounce.subType`, `bounce.message`, `bounce.diagnosticCode` | [Bounced event] |
| Bounce types | Permanent (General, NoEmail); Transient (General, MailboxFull, MessageTooLarge, ContentRejected, AttachmentRejected); Undetermined. The event reference's examples say `Permanent`/`Temporary`, so the exact strings need a synthetic check | [Bounces], [Bounced event] |
| Verification | Headers `svix-id`, `svix-timestamp`, `svix-signature`; "use the raw request body"; parsing and re-stringifying breaks verification; SDK `resend.webhooks.verify(...)` throws on invalid; Next.js example reads `await req.text()` and answers 400 on failure | [Verify] |
| Signature scheme | HMAC-SHA256 over `id.timestamp.body`; key is the base64 part after `whsec_`; the header is a space-delimited list of `v1,<sig>` entries ("any number of signatures"); use a constant-time comparison; check the timestamp "within your tolerance" (no value stated) | [Svix manual] |
| Success and timeout | Any 2xx counts as success. Respond "within a reasonable time-frame (30s with Svix)". Disable framework CSRF for the endpoint | [Svix receiving] |
| Retries | Immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h. An endpoint that keeps failing is **disabled automatically** and the team is emailed. Both failed and succeeded messages can be replayed manually from the dashboard | [Retries] |
| Idempotency keys | Kept 24 hours; 1–256 characters. A repeat returns the original response without sending. A different payload gives 409 `invalid_idempotent_request`. A concurrent request gives 409 `concurrent_idempotent_requests`. SMTP uses the `Resend-Idempotency-Key` header | [Idempotency] |
| Tags | Key/value pairs of ASCII letters, numbers, underscores or dashes; up to 75 per email; "the tag is included in the webhook event" | [Tags] |
| Suppression list | Hard bounces and spam complaints add the address. Later sends are marked `suppressed` and "won't be delivered until the address is removed". If the cause isn't fixed, the address is re-added on the next send. Removal is in the dashboard | [Suppression KB], [Bounces] |
| Test addresses | `delivered@`, `bounced@` (SMTP 550 5.1.1), `complained@` and `suppressed@resend.dev` simulate events "without damaging your domain reputation"; `+label` works except on `suppressed@`; they count against quota | [Test emails] |
| Domains | At least one verified domain is required; Resend recommends sending from subdomains; DMARC can be added after verification | [Domains] |
| Retrieve email | `GET /emails/{id}` returns `last_event` among other fields | [Retrieve] |

### 4.2 Not verified (must be proven by synthetic or controlled tests, or treated as unknown)

| Topic | Status and plan consequence |
|---|---|
| Delivery ordering | Not stated by Resend. Svix describes ordinary endpoints as best-effort ordering (secondary source). **Design for out-of-order events** |
| Timestamp tolerance | No value stated. The Svix and Standard Webhooks libraries are commonly described as using 5 minutes, but this was not verified from a fetched page. **Proposal: ±5 minutes** (EC-3) |
| Re-signing on retry | Not stated whether a retry six hours later carries a fresh `svix-timestamp`. If it did not, any tolerance would reject late retries. **Must be proven in 7.3D**: replay a message older than the tolerance and check that it verifies |
| Webhooks for SMTP sends | Not stated. **Assume Auth SMTP mail produces events** (D-4) |
| API response for a suppressed recipient | Not stated (2xx with a later `suppressed` status, or an error). **Assume `sent` can be followed by `email.suppressed`** |
| Rotation overlap | Not stated whether Resend signs with both old and new secrets during rotation. The multi-signature header allows it. **The receiver accepts current or previous** (§6.4) |
| Payload of `email.suppressed`, `email.failed`, `email.delivery_delayed` | Field lists not fetched beyond `message_id` absence. Parse defensively |
| Source IP ranges | Not found. **Do not use IP allowlisting as the control**: the signature is the control |

**What "delivered" means here.** `email.delivered` is evidence that the recipient's mail server accepted the email. It is **not** evidence of inbox placement (it may be filtered to spam or quarantined), that the right person received it, that it was read, or that it was acted on. `email.opened` is not proof of reading either. This plan does not propose subscribing to it (EO-3).

---

## 5. Evidence vocabulary (item 1)

There are two independent axes. **They are never merged into one state.**

| Axis | Owner | Values | Meaning |
|---|---|---|---|
| **Attempt outcome** (existing, unchanged) | Send-attempt ledgers | `pending`, `missed`, `sending`, `sent`, `failed`, `unknown`, `unrecorded` (route result), `resend_requested`, `acknowledged`, `untracked` | What our sender knows about its own API call. `sent` = **Resend accepted the request** |
| **Provider evidence** (new, proposed) | Provider-evidence store, read-time | `none_yet`, `accepted`, `delayed`, `delivered_to_server`, `bounced_permanent`, `bounced_other`, `complained`, `provider_failed`, `provider_suppressed`, `unavailable` | What Resend later reported about the email that matched this attempt |

**Proposed operator labels** (MDS truthful status wording; final copy is part of 7.3C review):

| Evidence | Label | What an operator may conclude | What they may not |
|---|---|---|---|
| `unavailable` | "Delivery evidence not available" | Receipt is not configured, or the attempt predates correlation | Anything about delivery |
| `none_yet` | "No provider report yet" (with the time since acceptance) | Nothing yet. Reports can be late or lost | That the email failed or arrived |
| `accepted` | "Accepted by Resend for delivery" | Resend intends to deliver | That it was delivered |
| `delayed` | "Delivery delayed; Resend is retrying" | A temporary problem was reported | That it will or won't arrive |
| `delivered_to_server` | "Handed to the recipient's mail server" plus the fixed note "Not proof it reached the inbox or was read" | The receiving server accepted it | Inbox placement, a human reading it, or receipt by the right person |
| `bounced_permanent` | "Bounced: not delivered" | The receiving server permanently refused it. Later sends to this address are likely suppressed by Resend | That the saved record is affected (it is not) |
| `bounced_other` | "Bounce reported (temporary or undetermined)" | A bounce was reported. A final outcome is not established | That it was or wasn't eventually delivered |
| `complained` | "Recipient marked it as spam" | It was delivered and the recipient flagged it | Who flagged it (shared mailboxes) |
| `provider_failed` | "Resend could not send it" | Not delivered by Resend | The cause (only the enumerated category is kept) |
| `provider_suppressed` | "Not sent: address is on Resend's suppression list" | Resend did not deliver it | That the address is permanently bad |

**Rule:** where evidence exists, every surface that shows `sent` also shows the evidence label. No surface may say "Delivered" alone, "Received", "Read", or "Confirmed" because of provider evidence. Inbox confirmation stays a human attestation.

---

## 6. Authenticated webhook ingestion (item 2)

### 6.1 Host and route (EC-1)

**Proposal:** a Next Route Handler at `src/app/api/webhooks/resend/route.ts`, with `export const runtime = "nodejs"` and only `POST`. Reasons:
- MTS keeps Resend in server-only Next code with `RESEND_*` secrets in Vercel.
- The logger and server env validators live there.
- No proxy matcher touches `/api`.

Alternative: a Supabase Edge function (the Stripe pattern), which keeps provider ingress off Vercel. Codex decides.

### 6.2 Request handling order

1. If the method is not `POST`, return 405.
2. **Configuration gate.** If `RESEND_WEBHOOK_SECRET` is unset or malformed, return **503** with a fixed body. Nothing is read, stored or logged beyond `email_webhook.refused` / `config_missing`. This is the dormant state.
3. If any of the three `svix-*` headers is missing, return **400**.
4. Read the raw body once with `await request.text()`. If it is over **64 KiB** (proposal; to be measured against synthetic payloads), return **413** without verifying. `Content-Length` is not trusted.
5. **Timestamp check.** `svix-timestamp` must be an integer within ±tolerance of server time; otherwise return **400**. This runs before HMAC as a cheap rejection, and verification also binds the timestamp into the signed content.
6. **Signature check.** Compute HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}` with each configured secret (current, then previous). Compare against every `v1,` entry in constant time. If nothing matches, return **400**. The body is never parsed before this step.
7. Parse JSON and validate the **allowlisted** fields (§11.1).
   - **Signed but malformed** (not JSON, no `type`, invalid `email_id` shape): return **2xx** and record a receipt with `processing = 'invalid_payload'` and no data. A retry cannot fix a signed malformed body, and repeated non-2xx responses would get the endpoint **disabled**. EC-7 decides.
8. Call **one** service-role RPC, `email_receive_provider_event(...)`, which inserts the receipt with `on conflict (svix_id) do nothing` and returns `recorded | duplicate | conflict`.
9. If the RPC errors, return **500** (or 503 if the database is unavailable) so Resend retries. **Never return 2xx before the receipt commits.**
10. Return `200 {"received":true}` for `recorded`, `duplicate` and `conflict`. `conflict` is logged at `warn` and kept for review (§7.3).

No `after()` processing is used: a receipt either commits inside the request or the request fails. Matching is read-time (§8), so no second processing stage exists that could fail after a 2xx.

### 6.3 Replay controls

- **Freshness:** the timestamp tolerance (EC-3) bounds how long a captured request stays replayable.
- **Uniqueness:** `svix_id` is the primary key. Provider retries, dashboard replays and attacker replays inside the window all become `duplicate` no-ops.
- **Effect:** a receipt has **no side effect** (no ledger change, no send, no suppression). A replay that got through would still only add evidence to the store, and duplicates add nothing.
- **Dashboard replay:** an operator's Resend dashboard "Replay" is a no-op for an already-recorded message. That is intended: processing is idempotent and there is nothing to re-run.

### 6.4 Secret handling and rotation

| Item | Proposal |
|---|---|
| Names | `RESEND_WEBHOOK_SECRET` (required to arm) and `RESEND_WEBHOOK_SECRET_PREVIOUS` (optional, only during rotation). Vercel server secrets, **Production only** (previews don't deploy, but the secret must also never be in Preview). Added to `.env.example` as names and descriptions only |
| Validation | `whsec_` prefix with valid base64 after it. Malformed values fail closed (503) |
| Never | Logged, returned, put in analytics or errors, or committed. The secret scanner already has a `whsec_` pattern ([scan-secrets.mjs:20](../scripts/scan-secrets.mjs#L20)). Test fixtures build secrets at runtime so they never match it |
| Rotation runbook (7.3D) | (1) Create the new secret in Resend. (2) Set `…_PREVIOUS` = old and `RESEND_WEBHOOK_SECRET` = new, then redeploy. (3) Confirm receipts verify under the new secret (the logger records which slot matched, `current` or `previous`, never the value). (4) After a full retry horizon (≈32 h, from the §4.1 schedule), remove `…_PREVIOUS` and redeploy. MTS §9: "rotation procedures identify dependent deployments and webhook endpoints" |
| Compromise | Rotate immediately without overlap. Receipts signed with the old secret are refused. Already-stored receipts stay as evidence; none of them caused an action |

### 6.5 Failure responses (summary)

| Condition | Status | Stored | Logged (v2, enumerated) |
|---|---|---|---|
| Not armed | 503 | Nothing | `refused` / `config_missing` |
| Missing headers | 400 | Nothing | `refused` / `webhook_headers_missing` |
| Oversize | 413 | Nothing | `refused` / `webhook_payload_too_large` |
| Stale or future timestamp | 400 | Nothing | `refused` / `webhook_timestamp_out_of_range` |
| Bad signature | 400 | Nothing | `refused` / `webhook_signature_invalid` |
| Signed, malformed | 200 | Receipt with no data, `invalid_payload` | `rejected` / `webhook_payload_invalid` |
| Signed, type not subscribed or unknown | 200 | Receipt with type `other` (§11.1) | `recorded` |
| Duplicate `svix-id`, same content | 200 | Nothing new | `duplicate` |
| Duplicate `svix-id`, different allowlisted content | 200 | First kept; conflict flag set | `conflict` (warn) |
| Database error or unavailable | 500 / 503 | Nothing (rolled back) | `failed` / `db_*` |
| Logger throws | Unaffected | Unaffected | Swallowed (7.1 contract) |

---

## 7. Mapping events to attempts (item 3)

### 7.1 Identifiers

| Identifier | Where it comes from | Use |
|---|---|---|
| `svix-id` | Webhook header | Receipt identity and dedupe. **Not** an email identity |
| `data.email_id` | Resend email ID; equals the `id` returned by `POST /emails` | **Primary match**: equal to a ledger's `provider_message_id` |
| Correlation tags (proposed, 7.3C) | Set by our sender at send time; echoed in `data.tags` | **Secondary match**, when the API response was lost (D-3) or arrives after the event |
| `data.to` | Recipient | **Never used for matching** and not stored (§11) |
| `data.message_id` | RFC Message-ID | Not stored; not needed |

**Proposed tags (EC-5):** `mm_ledger` ∈ `application|owner_email|package_draft`, `mm_ref` (the ledger row's business key: application ID, owner-email ledger row ID, or price-draft notice row ID), and `mm_attempt` (an integer). UUIDs fit the documented tag alphabet.
- Tags expose only opaque internal IDs to Resend, which already holds the full email content.
- Tags are not secret and are not trusted on their own: they come inside a **signed** payload from Resend, but they were authored by us.
- A tag match is accepted only if the referenced row exists and `mm_attempt ≤ attempts`.

### 7.2 Matching rules (read-time, deterministic)

For a ledger attempt, the matching receipts are:

1. **By ID:** receipts whose `provider_email_id` equals the row's `provider_message_id`. This applies only to the attempt that recorded `sent`.
2. **By tag:** receipts whose `(mm_ledger, mm_ref, mm_attempt)` equals the attempt.
3. **Agreement:** if a receipt matches by ID to one attempt and by tag to another, it is a **conflict**. It matches neither and is shown in the unmatched count for review.
4. **Never:** by recipient, subject, time proximity or `from`. There are no fuzzy rules.

Because matching happens at read time, the order in which a receipt and the outcome record arrive does not matter. The answer is the same once both exist.

### 7.3 Cases

| Case | Behavior |
|---|---|
| **Early callback**: event arrives before `*_record` commits `provider_message_id` | Stored. Until the record commits, it matches by tag (7.3C) or by nothing. After the commit, it matches by ID too. No error, no retry, no ledger write |
| **Missing provider ID**: API response lost, outcome `unknown` | Matches by tag only (after 7.3C). Before 7.3C, or for untagged sends, it stays unmatched. The `unknown` row keeps its attested-recovery rule; evidence informs but never replaces the attestation (§9) |
| **Outcome never recorded** (`unrecorded` → reads `unknown`) | Same as above |
| **Unknown or unsubscribed event type** | Stored as `other` with a validated type string; never matched to an evidence value |
| **Unmatched** (Auth SMTP, legacy function, another sender on the account, pre-tag sends) | Stored minimally (§11). Counted as "Unmatched provider reports" with no recipient or content. Short retention (EO-2) |
| **Duplicate** (same `svix-id`) | No-op 2xx |
| **Same `svix-id`, different content** | First receipt kept, `conflict` flagged, 2xx, warn log. Never overwritten |
| **Several events for one email** (sent, delayed ×2, delivered) | Distinct `svix-id`s; all kept as history |
| **Out of order** (`delivered` before `sent`; `delivered` after `bounced`) | Evidence is computed by precedence (§8.2), never by last arrival |
| **Tag points to a missing row or a future attempt** | Unmatched |
| **Event for an attempt superseded by a resend** | Matches its own attempt. Attempt history shows evidence per attempt; the current attempt's evidence is not inherited |
| **Ledger row deleted** (contact retention, later) | Matched receipts follow their row (EO-2). An orphaned receipt becomes unmatched and expires on the short clock |

---

## 8. Proposed event and state model (item 4)

### 8.1 Receipt table (proposed SQL, planning only; 7.3B)

```sql
create table private.email_provider_events (
  svix_id text primary key check (svix_id ~ '^msg_[A-Za-z0-9]{1,64}$'), -- prefix to be confirmed by synthetic sample (§4.2)
  received_at timestamptz not null default now(),
  signed_at timestamptz not null,                 -- svix-timestamp
  secret_slot text not null check (secret_slot in ('current','previous')),
  processing text not null check (processing in ('recorded','invalid_payload')),
  event_type text not null check (event_type in (
    'email.sent','email.delivered','email.delivery_delayed','email.bounced',
    'email.complained','email.failed','email.suppressed','other')),
  provider_type text check (provider_type ~ '^[a-z_.]{1,64}$'), -- raw type only when event_type = 'other'
  provider_created_at timestamptz,                -- envelope created_at
  provider_email_id text check (provider_email_id ~ '^[0-9a-f-]{36}$'), -- shape to be confirmed
  bounce_type text check (bounce_type in ('permanent','transient','undetermined','other')),
  bounce_subtype text check (bounce_subtype in (
    'general','no_email','mailbox_full','message_too_large','content_rejected',
    'attachment_rejected','suppressed','message_rejected','undetermined','other')),
  tag_ledger text check (tag_ledger in ('application','owner_email','package_draft')),
  tag_ref uuid,
  tag_attempt integer check (tag_attempt between 1 and 10000),
  content_conflict boolean not null default false,
  check ((processing = 'invalid_payload') = (provider_email_id is null and event_type = 'other' and provider_type is null))
);
create index email_provider_events_email on private.email_provider_events (provider_email_id);
create index email_provider_events_tag on private.email_provider_events (tag_ledger, tag_ref, tag_attempt);
create index email_provider_events_received on private.email_provider_events (received_at desc);
alter table private.email_provider_events enable row level security;
revoke all on private.email_provider_events from public, anon, authenticated, service_role;

-- service_role only; insert-or-detect; returns 'recorded' | 'duplicate' | 'conflict'
-- public.email_receive_provider_event(p_svix_id text, p_signed_at timestamptz, p_slot text, p_fields jsonb)
```

Notes:
- **No `to`, `from`, `subject`, `message_id`, `bounce.message`, `bounce.diagnosticCode`, headers, link, IP or user agent.** No raw payload (§11).
- Tag columns exist from 7.3B so 7.3C needs no table change. They stay null until tags are sent.
- **Event ordering** uses `provider_created_at`, then `received_at`, only for display. Evidence uses precedence.
- The conflict rule compares only the allowlisted fields.

### 8.2 Evidence derivation (read-time; 7.3C)

`private.email_attempt_evidence(p_ledger text, p_ref uuid, p_attempt int)` returns the highest-precedence evidence among matched receipts, plus the per-receipt history (type, provider time, bounce category):

| Precedence | Evidence | From |
|---:|---|---|
| 7 | `complained` | `email.complained` |
| 6 | `bounced_permanent` | `email.bounced` with `bounce_type = 'permanent'` |
| 6 | `provider_suppressed` | `email.suppressed`, or `email.bounced` with subtype `suppressed` |
| 6 | `provider_failed` | `email.failed` |
| 5 | `bounced_other` | `email.bounced`, transient, undetermined or other |
| 4 | `delivered_to_server` | `email.delivered` |
| 3 | `delayed` | `email.delivery_delayed` |
| 2 | `accepted` | `email.sent` |
| 1 | `none_yet` | Matched attempt known, receiver armed, no receipts |
| 0 | `unavailable` | Receiver not armed for the period, or no matchable identity |

- A complaint outranks delivery: it implies delivery and needs attention.
- A permanent bounce after `delivered` outranks delivery (late asynchronous bounce).
- Ties at precedence 6 show every type in the history.
- "Receiver armed for the period" needs an arming timestamp. **Proposal:** a private one-row `email_evidence_config(armed_at)` set at 7.3D, so attempts before arming read `unavailable` rather than a misleading `none_yet`.

### 8.3 Invariants (what does not change)

- No receipt or evidence value changes any ledger column, state, attempt count, claim or event.
- `sent` keeps its meaning (provider-accepted) and stays terminal under the existing functions.
- The claim UUID is still the only capability to record an outcome. The stale-worker refusal (40001) is unchanged.
- Resend and acknowledge permissions are decided only by the existing functions and attestations. Evidence never unlocks or blocks them (until a separately reviewed slice, §9.3).
- The 7.2C-1, 7.2C-2 (#167), application and price-draft ledger functions are **not restated** in 7.3B or 7.3C. The money fingerprint `58 | af0fae6e…` is unaffected (no listed function is touched).

---

## 9. Operator readback and manual recovery (item 5)

### 9.1 Readback (7.3C)

- **Owner Emails** (`/admin/owner-emails`), then **Recruiting** (application emails) and the **price-draft** notice panel. Each row shows its attempt state as today, plus a separate **Provider evidence** label (§5) and an expandable per-attempt report history (type and time only).
- **Attention, additive:** a `sent` row whose evidence is `bounced_*`, `complained`, `provider_failed` or `provider_suppressed` counts toward a new "Accepted, then not delivered" count. The existing exact attention counts are not redefined.
- **Unmatched provider reports:** a count and a list of type, time and bounce category only. There is no recipient, so an operator cannot tell whose mail it was. That is by design (D-4, EO-7).
- **Access:** a new guarded readback function (`vendor_require_operator()` inside, like `owner_email_overview`). No actor IDs, provider IDs, `svix-id` or tags are returned to the browser. Labels are computed server-side from the enumerations.

### 9.2 What an operator can safely conclude and do, under existing functions

| Row | Evidence | Safe conclusion | Action available today |
|---|---|---|---|
| `sent` | `delivered_to_server` | Handed to the mail server | None needed. Inbox confirmation is still the only proof of receipt |
| `sent` | `bounced_permanent` / `provider_suppressed` / `provider_failed` | The notice did not arrive. **The saved record is unaffected** | Work from the saved record: "View submission" (contact), Compliance Expiry (renewal, #167), Vendor Applications, or contact the vendor another way (price drafts). Fix the cause (owner address or suppression entry, a hosted action). **No resend:** `sent` is terminal, and a resend to a suppressed address would be suppressed again |
| `unknown` / `missed` | `delivered_to_server` via tag | Strong evidence that this attempt went out | The existing **acknowledge** with `inbox_evidence_reviewed`, stating in the reason what was found. Evidence does not replace the inbox check |
| `unknown` / `missed` | `bounced_*` / `failed` / `suppressed` via tag | That attempt was not delivered | The existing **resend** with `no_matching_email_found` once the cause is fixed. The attestation wording stays human |
| `unknown` / `missed` | `none_yet` / `unavailable` | Nothing | The existing attested recovery, unchanged |
| any | `complained` | The recipient flagged it | Review the wording or recipient (EO-4). No automatic action |

### 9.3 Proposed later recovery slice (7.3F, not first)

Allowing "resend after provider non-delivery" for `sent` rows would restate the ledger functions: a new transition from `sent` gated on matched non-delivery evidence plus an attestation. That needs Codex review (EC-10) and is not proposed for 7.3B or 7.3C.

---

## 10. Bounce, complaint and suppression; transactional versus marketing (item 6)

**Facts.** Every email the platform sends today is transactional or operational. No marketing sender exists (contract §4.3). Resend already enforces its own account-wide suppression list for hard bounces and complaints (§4.1). Mercurius's own suppression ledger covers only R0 early-access and marketing classes.

**Recommendations (proposals for owner decision):**
1. **No automatic Mercurius action** in 7.3B–7.3D: no suppression write, no contact change, no ledger change, no reminder. Evidence is shown to operators only.
2. **Owner-inbox mail** (applications, contacts, renewals): a bounce or suppression is an **operations incident** (misconfigured owner address or a suppression entry), not a recipient preference. Surface it and recover by hand (§9.2).
3. **Vendor contact mail** (price drafts): a permanent bounce suggests the contact on file is wrong, and an operator updates it through existing tools. A complaint suggests stopping non-essential mail to that address. **Whether a complaint on a transactional notice should block later transactional notices is an owner decision** (EO-4).
4. **R0 early-access and marketing:** wire bounce and complaint to `r0_record_email_suppression` **only when a sender of those classes exists** (already required by R0-VENDOR-READINESS). That needs an address, and the receipt store keeps none. The proposal (7.3E) is a narrow, owner-approved path: hash the `to` address in the receiver (`private.r0_hash` form) and pass it straight to the suppression function, without storing it in the receipt.
5. **Removing an address from Resend's suppression list** is a hosted provider action. Proposal: owner only, per address, with a recorded reason (EO-5).
6. **Auth SMTP mail** (invitations, verification): Resend's suppression applies. A suppressed homeowner verification email is a support issue. No Mercurius suppression is proposed.

---

## 11. Data minimization, access, redaction and retention (item 7)

### 11.1 Retained fields (receipt)

Exactly the §8.1 columns. Each source field is validated against a strict shape or enumeration. Anything that fails becomes `null` or `other`; it is never stored raw.

| Payload field | Retained? | Why |
|---|---|---|
| `type` | Enumerated, or `other` plus validated string | Needed |
| `created_at` | Yes | Ordering and display |
| `data.email_id` | Yes (validated shape) | Primary match |
| `data.tags` | Only the three `mm_*` keys, validated | Secondary match. Other tags are ignored |
| `data.bounce.type`, `.subType` | Enumerated | Evidence category |
| `data.to`, `from`, `subject`, `message_id` | **No** | Personal or content data with no matching role |
| `data.bounce.message`, `.diagnosticCode` | **No** | Server text can echo addresses |
| Click and open data (link, IP, user agent) | **No**, and not subscribed (EO-3) | Tracking data; no approved use |
| Raw body | **No** | Raw payload retention is not approved |

### 11.2 Access

- The table is in `private`, with RLS on and all privileges revoked.
- Insert only through the service-role RPC.
- Read only through operator-guarded functions (7.3C) that return labels and enumerations.
- Anonymous, authenticated non-operator, vendor and homeowner sessions are refused (42501).

### 11.3 Redaction in logs (v2)

- **New route:** `resend_webhook`.
- **New events:** `email_webhook.refused | rejected | recorded | duplicate | conflict | failed`.
- **New error codes:** `webhook_headers_missing`, `webhook_payload_too_large`, `webhook_timestamp_out_of_range`, `webhook_signature_invalid`, `webhook_payload_invalid`.
- **Never logged:** the secret, signature, `svix-id`, email ID, tags, recipient, subject, body and bounce text.
- The provider event type is not a v2 key; EC-6 decides between v2 without it and a v3 key.

### 11.4 Retention

No approved retention class covers provider receipts. CFG-011 covers operational logs (90 days), support tickets and platform messages (3 years), and financial records.
- **Proposal (EO-2):**
  - **unmatched, `other` and `invalid_payload`** receipts: 90 days, treated like operational logs;
  - **matched** receipts: kept as long as their ledger row, via a read-time join, so the receipt has no FK and a purge job deletes matched receipts when their row is gone.
- **No purge job in 7.3B.** Until EO-2 is answered and a purge slice exists (with 7.6), retention is **unenforced**. That must be stated at hosted activation, and it is a reason not to arm the receiver before EO-2.
- CFG-011's 90-day log retention stays **open** (7.6).

---

## 12. Domain authentication and controlled real-email acceptance (item 8)

| Work | Where | Who and when |
|---|---|---|
| Receiver, store, tests, docs, env names | Repository | 7.3B / 7.3C (Claude implements; Codex reviews) |
| Migration push | Hosted Supabase | Owner-authorized, before merge (DEC-2026-037) |
| `RESEND_WEBHOOK_SECRET` | Vercel Production | Owner, in the dashboard (CFG-013: never in chat or commits) |
| Webhook registration (URL, subscribed events) | Resend dashboard or API | Owner-authorized, 7.3D. URL is production only (no previews) |
| Domain status readback | Resend dashboard or API (`GET /domains`) | Owner-authorized read-only, 7.3D. Records domain, status and region, never keys |
| DNS (SPF, DKIM, DMARC, bounce MX) | GoDaddy | **No change proposed.** A dated read-only lookup (`dig`) refreshes the 2026-10-01 evidence (§3.6). Any change is a separate owner action |
| Real sends | Resend through the app | Owner-authorized, 7.3D, controlled only |

**Controlled acceptance (7.3D, proposal):**
1. **Resend test addresses** (§4.1): `delivered@`, `bounced@`, `complained@` and `suppressed@resend.dev`, sent through a **synthetic, operator-only** path. Delivering to those addresses needs a send helper that does not use the owner inbox; 7.3D defines it (a one-off script with the service key, with the owner present, or a guarded admin action). Expected: matched receipts and the corresponding evidence labels. No real person's address is used, and domain reputation is unaffected per Resend.
2. **Controlled mailbox:** one synthetic contact submission (and, once #167 is deployed, one synthetic provider renewal) to the owner inbox. Expected: ledger `sent`, evidence `delivered_to_server`, **and** the human sees it in the inbox. The record states that only the human check proves inbox arrival.
3. **Retry and re-signing proof:** a dashboard replay of a message older than the tolerance must verify, or the tolerance design is revisited (§4.2).
4. **Rotation rehearsal** (§6.4) with both slots.
5. Message headers of the controlled email show DKIM, SPF and DMARC pass (refreshes R0 T2 evidence).

---

## 13. Dependencies, rollout and rollback, acceptance, slices (item 9)

### 13.1 Dependencies

- #167 (7.2C-2): independent of 7.3B. 7.3C's owner-email readback should land after #167 merges, so the renewal kind exists in deployed code. If 7.3C starts first, it covers contact rows only and records the gap.
- EC-2 (verifier library): a new dependency needs the Phase 5 dependency-security review practice ([PHASE-5-DEPENDENCY-SECURITY](PHASE-5-DEPENDENCY-SECURITY.md)).
- EO-2, EO-3 and EO-7 before 7.3D arming.
- No dependency on payments, booking, promotions or `offer_terms`.

### 13.2 First implementation slice: 7.3B, dormant authenticated receipt

**Scope:**
- one additive migration (`private.email_provider_events`, `public.email_receive_provider_event` with service role only, explicit revokes);
- the route (§6);
- a server-only verifier module;
- env validator entries (optional names) and `.env.example` names;
- v2 logger allowlist additions (§11.3);
- SQL, unit and concurrency tests;
- one CI step if a concurrency script is added;
- this plan's 7.3B record.

**Out of scope:** tags, matching, readback UI, suppression, any hosted push, secret, registration or real send.

**Acceptance criteria:**
1. The route is dormant without the secret: 503, nothing stored, no RPC call.
2. Every §14 synthetic case passes, using test secrets generated in the test (never real), and fixtures built by signing synthetic payloads.
3. Exactly one receipt per `svix-id` under concurrency (8 parallel identical deliveries → 1 row, 7 `duplicate`).
4. No 2xx before commit: with the RPC failing, the response is 5xx.
5. Sentinel PII in every non-retained field never appears in the database, logs or responses.
6. v1 log keys and tests unchanged; v2 exact-key test extended.
7. No existing function, table or grant changes. The definition hashes for the application ledger (`10 | 5f14532a…`), the 7.2C-1 functions (`12 | 016c0e68…`) and the money fingerprint `58 | af0fae6e…` are unchanged.
8. Full SQL, unit, lint, typecheck, secret scan, build and exact-head CI pass.

**Rollout:**
1. Codex review and exact-head CI.
2. With owner authorization, dry-run and push the migration (it only adds an unused table and function).
3. Read-only readback.
4. Merge and deploy. The route answers 503.

Nothing is armed until 7.3D.

**Rollback:** revert the route (`vercel promote` the previous deployment). The table and function stay, unused. Schema defects are fixed forward.

### 13.3 Later slices (proposals)

| Slice | Content | Gate |
|---|---|---|
| **7.3C** Correlation and readback | Optional `tags` on the shared sender (additive parameter; callers opt in) for the three ledgers' helpers; read-time evidence function and the arming record; operator readback columns, history, the "Accepted, then not delivered" count and the unmatched count; browser tests (MDS, axe, 320 px) | Codex review; after #167 merges for renewal coverage. Note: changing a payload under a reused idempotency key returns 409. Keys are per attempt and never reused by our code, so no in-flight conflict is expected; a test confirms it |
| **7.3D** Hosted activation (owner-authorized) | Push, secret, registration (EO-3 events), domain readback, controlled acceptance (§12), rotation rehearsal, dated evidence | EO-1, EO-2, EO-3, EO-6, EO-7 |
| **7.3E** Suppression wiring | Only what EO-4 and EO-5 approve; R0 classes when a sender exists | Owner decisions |
| **7.3F** Recovery after provider non-delivery | `sent` → resend with evidence plus attestation (restates ledger functions) | EC-10; separate review |
| **7.6** (existing) | Alerts on evidence gaps, unmatched spikes and endpoint disablement; log drain; CFG-011 | Existing carry |

---

## 14. Synthetic acceptance cases (for 7.3B and 7.3C)

All cases use locally generated secrets and synthetic payloads. "Nothing stored" means zero receipt rows and no RPC call.

| # | Case | Expected |
|---|---|---|
| S-1 | No secret configured | 503; nothing stored; `config_missing` |
| S-2 | Malformed secret (no `whsec_`, bad base64) | 503; nothing stored |
| S-3 | Missing each `svix-*` header in turn | 400; nothing stored |
| S-4 | Wrong signature; signature from another secret; truncated signature; non-`v1` scheme only | 400; nothing stored; constant-time comparison used (unit spy) |
| S-5 | Valid signature, body altered by one byte | 400 |
| S-6 | Body parsed and re-stringified before verification (mutation) | Test fails, proving raw-body verification |
| S-7 | Timestamp older or newer than tolerance; non-integer timestamp | 400; nothing stored |
| S-8 | Multiple `v1,` signatures where only the second matches | Accepted |
| S-9 | Rotation: signed with `previous` only, `previous` configured | Accepted; slot `previous`. With `previous` unset, 400 |
| S-10 | Body over the size cap | 413; no HMAC computed (spy) |
| S-11 | Replay: the same signed request twice | 200 both; one row; second `duplicate` |
| S-12 | 8 concurrent identical deliveries (real database) | 1 row; 7 `duplicate` |
| S-13 | Same `svix-id`, different allowlisted content | 200; first kept; `content_conflict` true; warn |
| S-14 | Signed non-JSON; signed JSON without `type`; invalid `email_id` shape | 200; `invalid_payload` receipt with no data |
| S-15 | Signed unknown type (`email.opened`, `contact.created`, `future.type`) | 200; `other` with validated type string; an invalid type string is stored null |
| S-16 | RPC error; database unavailable | 500 / 503; nothing stored; Resend would retry |
| S-17 | RPC commits but the response is lost (client killed after commit) | Next delivery → `duplicate`; no second row |
| S-18 | Logger throws on every method | Responses and storage unchanged |
| S-19 | Direct RPC call as anon, authenticated, vendor or operator session | 42501; only service role may execute |
| S-20 | Direct table select or insert by any client role | Denied |
| S-21 | Sentinel PII in `to`, `from`, `subject`, `message_id`, `bounce.message`, `diagnosticCode`, headers, click link, IP, user agent, extra tags | Absent from the row, every log line and the response body |
| S-22 | Secret and signature values | Absent from logs and responses |
| S-23 | Non-POST methods | 405 |
| *7.3C* | | |
| S-24 | Early callback: receipt before `*_record` commits | `none` → evidence appears after the record, by ID |
| S-25 | Lost API response (`unknown`), tagged delivered event | Evidence `delivered_to_server`; row stays `unknown`; resend still requires attestation |
| S-26 | Out of order: delivered → sent; bounced → delivered; delivered → complained | `delivered_to_server`; `bounced_permanent`; `complained` |
| S-27 | ID match and tag match disagree | Conflict; matched to neither; counted unmatched |
| S-28 | Tag to a nonexistent row, or attempt > attempts | Unmatched |
| S-29 | Event for attempt 1 after attempt 2 was sent | Shown on attempt 1 only |
| S-30 | Recipient equal to an owner or vendor address but no ID or tag | Unmatched (proves no recipient matching) |
| S-31 | Operator readback as non-operator | 42501 |
| S-32 | `sent` plus `bounced_permanent` | Label "Bounced: not delivered"; additive count; no resend control offered |
| S-33 | Stale worker writes an outcome after a resend request while receipts exist | 40001 unchanged; receipts unaffected |
| S-34 | Attempt before the arming timestamp | `unavailable`, not `none_yet` |
| S-35 | Labels never say "Delivered", "Received" or "Read" alone (browser) | Pass |

---

## 15. Decisions

### 15.1 Owner decisions (proposals; nothing is assumed approved)

| ID | Question | Recommendation |
|---|---|---|
| **EO-1** | Authorize 7.3D hosted activation (push, secret, registration, controlled sends)? | Later, after 7.3B/C review; one authorization per hosted action |
| **EO-2** | Retention for provider receipts | Unmatched, other and invalid: 90 days. Matched: as long as the ledger row. Purge job with 7.6. Do not arm before this is answered |
| **EO-3** | Which events to subscribe to | `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`. **Not** opened, clicked, received, contact, domain or inbox events |
| **EO-4** | Should a bounce or complaint on transactional mail change what Mercurius sends later? | No automatic action. Operator review only. Vendor contact bounce → update the contact. Complaint → owner policy |
| **EO-5** | Who may remove an address from Resend's suppression list, and with what record? | Owner only, per address, reason recorded in the operations log |
| **EO-6** | Controlled acceptance with `resend.dev` test addresses and the controlled mailbox (quota use) | Yes, in 7.3D |
| **EO-7** | May the receiver keep minimal, address-free receipts for mail it cannot match (Auth SMTP to homeowners and invitees, legacy sends)? | Yes, minimal fields only, 90 days. Alternative: drop unmatched receipts entirely (loses the "unmatched" signal) |
| **EO-8** | Confirm that every current email is transactional or operational (contract §4.3), and that a marketing sender needs its own approval with unsubscribe and suppression | Confirm |

### 15.2 Codex decisions

| ID | Question | Recommendation |
|---|---|---|
| **EC-1** | Next Route Handler or Supabase Edge function | Next (`nodejs`), per MTS §9 and the logger |
| **EC-2** | Verifier: the `svix` package (exact-pinned, dependency review), the `resend` SDK, or `node:crypto` per the Svix manual spec | `svix`, exact-pinned. Fall back to `node:crypto` (`createHmac`, `timingSafeEqual`) if the dependency review objects. Either way, tests sign their own vectors |
| **EC-3** | Timestamp tolerance | ±5 minutes, subject to the §12 re-signing proof |
| **EC-4** | Read-time matching or a stored projection | Read-time (order-free, no second processing stage); revisit only with volume evidence |
| **EC-5** | Tag keys and values (source or ledger IDs; opt-in sender parameter) | §7.1 |
| **EC-6** | Logger: v2 additions without the event type, or a v3 with `provider_event` | v2 additions. The event type stays in the database |
| **EC-7** | Signed but malformed: 2xx plus an `invalid_payload` receipt, or 400 | 2xx (avoids endpoint disablement; a retry can't fix it) |
| **EC-8** | Size cap value | 64 KiB, adjusted after measuring synthetic payloads with 75 tags |
| **EC-9** | Readback order: owner emails → recruiting → price drafts | Yes |
| **EC-10** | Whether 7.3F ("resend after provider non-delivery") is wanted, and how it restates ledger functions | Defer. Not before 7.3D evidence |

---

## 16. Carried register (unchanged by this plan)

- **CFG-011:** 90-day operational-log retention not met; carried to 7.6. Receipt retention is a new open item (EO-2).
- **A2 human verification** (screen reader, real devices, keyboard, 200% zoom, 320 px, Windows `@visual`): NOT PERFORMED; booking-readiness register.
- **Retrospective Codex review of 7.2B** (#164 merged without a recorded Codex review): open.
- **Real-email verification** for 7.2C-1 and 7.2C-2 (plan §6.4): not performed. 7.3D's controlled acceptance may share the session, but it is recorded separately.
- **#167:** Codex review, exact-head CI on `7dbdf5a`, merge or deploy, and the post-deploy renewal window reconciliation are not performed and not claimed here.
- **Final booking-readiness checks:** final candidate schema and grants, money fingerprint and completion integrity: open.
- **Older intermittent accessibility failure** (`request.spec.ts:837`): historical, undiagnosed.
- `offer_terms` and promotions gates **off**. No payments, booking, Cron, retries, reminders or suppression actions activated or proposed for activation.

---

## 17. Validation of this document

- Facts in §1 and §3 were read from `origin/main` `24dd455`, #167 at `7dbdf5a` (`git show`), `gh pr view/list` and `gh run list` on 2026-11-13.
- Provider facts in §4 come from the fetched pages below. Anything not stated there is in §4.2.
- No test was run: no code changed. `git diff --check` was run on the documentation diff.
- No hosted query, provider dashboard access, DNS change or email.

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
- Secondary, ordering only: <https://www.svix.com/blog/guaranteeing-webhook-ordering/>
