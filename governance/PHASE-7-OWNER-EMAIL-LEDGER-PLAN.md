# Phase 7.2C — Owner-email ledger plan for contact-form and renewal-document emails (TRACE-154)

**Status:** PLAN FOR CODEX REVIEW. Documentation only. Nothing here is implemented, migrated, pushed, deployed or activated.
**Checkpoint:** 2026-11-12 (America/New_York), `main` `3eb8ff4521c17bdf009247792f5a93d742c626d8` (#164 merge, 7.2B).
**Branch:** `claude/phase7-2c-owner-email-ledger-plan`, from that `main`.
**Authority:**
- the owner's Phase 7.2C planning instruction (2026-11-12), under the Phase 7 authorization in [PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md);
- gap **G1-02** in [PHASE-7-NOTIFICATION-CONTRACT](PHASE-7-NOTIFICATION-CONTRACT.md) §7.1 and its acceptance criteria in §8;
- MTS §4 provider boundary ([TECHNOLOGY-BLUEPRINT.md:78](../mts/TECHNOLOGY-BLUEPRINT.md#L78)): "Every external mutation needs a durable local attempt record, stable idempotency key, timeout/retry rules, and reconciliation path";
- MPS §10: messages must be "idempotent, associated with a business event, auditable, privacy-safe";
- 7.1 (TRACE-151) logger and its rule that durable records, not logs, govern recovery ([PHASE-7-APPLICATION-NOTIFICATION-TRACING](PHASE-7-APPLICATION-NOTIFICATION-TRACING.md) §7);
- MDS ConfirmAction and OperationalQueue rules ([DESIGN-SYSTEM-BLUEPRINT.md:215](../mds/DESIGN-SYSTEM-BLUEPRINT.md#L215));
- DEC-2026-037 for any later hosted push and release.

This plan proposes. It approves no policy and changes no recipient, subject, content, consent rule, rate limit, upload rule or HTTP response.

---

## 0. Summary

1. **Two owner emails have no durable attempt record.** The contact form (N-SUP-04) and a provider's renewal-document submission (N-APP-05) save their business record, then send the owner email in `after()` with no ledger, no idempotency key and no recovery. A failure is a `console.error` line that also prints the raw provider error.
2. **The contact form has no other readback.** No screen reads `contact_submissions` (§2.1). If its email fails, the submission is visible only through a database console. The R0.4 record says both paths "have their own admin queues" ([R0-VENDOR-READINESS.md:104](R0-VENDOR-READINESS.md)); that is true for renewal documents (Compliance Expiry) and **not** for contact submissions (finding F-1).
3. **Recommendation: a small new shared ledger** (`private.owner_email_notifications`) with the same state machine, claim and resend rules as the vendor-application ledger (TRACE-104), created by an `AFTER INSERT` trigger in the business record's transaction. The application ledger is **not** changed or migrated.
4. **No fingerprinted function is touched.** The renewal path gets a trigger on its table; `vendor_submit_renewal_document` is not restated. The fingerprint must stay `58 | af0fae6e0c5b604e9073e10bc060957e`.
5. **Two implementation slices**, because each needs its own trigger and hosted push and the contact path carries more risk and more value:
   - **7.2C-1:** ledger, contact path, operator page.
   - **7.2C-2:** renewal path, added to the same ledger and page.
6. **Historical records stay untracked and are not sendable** from the new surface. Backfill or historical resend is a separate proposal.
7. **One genuine owner decision** (O-1): whether operators may open a contact submission's stored content from the new page. Without it, "acknowledge" for a contact email cannot be backed by having read the message (§5.3).

---

## 1. Repository state at this checkpoint (factual)

| Item | Evidence |
|---|---|
| Working tree | Clean on `claude/phase7-2b-vendor-notification-readback` before branching; this branch was created from `origin/main` |
| `main` | `3eb8ff4521c17bdf009247792f5a93d742c626d8`, "Merge pull request #164", merged 2026-11-12T12:01:51Z |
| #164 (7.2B, TRACE-153) PR-head CI | Head `137dd24`: backend, lifecycle, application **success** (pull_request and push runs); Supabase Preview success; CodeRabbit skipped |
| Main merge CI on `3eb8ff4` | Run 43214230785: **in progress** at this checkpoint. No result is claimed |
| Codex review of 7.2B | **None recorded** in the repository or on the PR. Merging is not review acceptance. Codex owns the retrospective review; this plan does not substitute a self-review |
| 7.2B record | Said "Not merged, not deployed" ([PHASE-7-VENDOR-NOTIFICATION-READBACK.md:3](PHASE-7-VENDOR-NOTIFICATION-READBACK.md)). A dated factual status line is added in this branch; the original text is kept |
| Earlier Phase 7 PRs | #162 (7.1) merged `11c05b0`; #163 (7.2A) merged `f205b59`; #161 Phase 6 acceptance merged `9067f96` |
| Latest migration on `main` | `20261121001000_phase6_cs5_f01_exception_hard_stops.sql`. Latest SQL test: `119_vendor_notification_readback.sql` |

Deployment: merging to `main` deploys to production (DEC-2026-037). This plan did not query Vercel or the hosted database, so no deployment SHA or hosted schema state is claimed.

---

## 2. Characterization of the two paths

### 2.1 Contact form → owner inbox (N-SUP-04)

| Aspect | Current behavior (source) |
|---|---|
| Callers | `/contact` ([contact/page.tsx:40](../src/app/contact/page.tsx#L40)) and two `/request` flows: service interest and coverage interest ([request/page.tsx:833](../src/app/request/page.tsx#L833), [:1200](../src/app/request/page.tsx#L1200)). All anonymous-capable |
| Route | `POST /api/contact-submissions`, `runtime = "nodejs"` ([route.ts:16](../src/app/api/contact-submissions/route.ts#L16)) |
| Guards before write | Intake trap/timing check → 429 ([route.ts:82](../src/app/api/contact-submissions/route.ts#L82)); validation and normalization (email lowercased, lengths, request-context suffix) → 400 ([route.ts:44](../src/app/api/contact-submissions/route.ts#L44)); `intake_record_submission` email/IP limit → 429 ([route.ts:91](../src/app/api/contact-submissions/route.ts#L91)). The limit is recorded in its own call, before the insert |
| Committed business event | One `INSERT` into `public.contact_submissions` with the **service key** ([route.ts:102](../src/app/api/contact-submissions/route.ts#L102)). The route does not read back the new row's ID |
| Transaction boundary | The single PostgREST insert statement. No trigger exists on the table ([PHASE-5-CONTACT-INSERT.md](PHASE-5-CONTACT-INSERT.md), "no trigger is defined") |
| Source record | `contact_submissions(id, first_name, last_name, email, phone, subject, message, created_at)` ([20260215142758…sql:1](../supabase/migrations/20260215142758_c9fe7cfa-05d5-4af6-a27d-ee439a2480ff.sql#L1)). The stored `message` already includes the appended "Request ID" context |
| Permissions | Only the service key inserts (TRACE-087, [20260924003000…sql:18](../supabase/migrations/20260924003000_contact_submission_insert.sql#L18)). `authenticated` SELECT, filtered by "Admins can view submissions". `anon` none. No UPDATE/DELETE policy |
| Readback | **None.** No `src/app`, component or hook reads `contact_submissions` |
| Email content | Built in the route from the parsed request, not the stored row ([route.ts:113](../src/app/api/contact-submissions/route.ts#L113)). Subject `New contact submission — <subject, whitespace-collapsed, 100 chars>`; `reply_to` = submitter email; body: Submitted (route clock, `toISOString()`, taken **before** the insert), Name, Email, Phone or "Not provided", Subject, Message |
| Recipient | Owner inbox: `OWNER_NOTIFICATION_EMAIL`, else the owner-confirmed fallback ([ownerNotifications.ts:51](../src/lib/ownerNotifications.ts#L51)). Never from the request |
| Failure behavior | `after()` callback. `!result.ok` → `console.error(..., { error: result.error })` ([route.ts:130](../src/app/api/contact-submissions/route.ts#L130)), which prints the provider detail (up to 300 characters of Resend's body). An exception inside `after()` is unhandled. A route failure logs the **raw** caught error ([route.ts:139](../src/app/api/contact-submissions/route.ts#L139)) |
| HTTP | 201 `{ submitted: true }` once the insert succeeds, whatever happens to the email ([route.ts:134](../src/app/api/contact-submissions/route.ts#L134)); 400 validation; 429 refusal; 500 otherwise |
| Recovery evidence | The row itself. No attempt record, provider message ID or outcome. Logs are best effort and unstructured |
| Tests | SQL 054 (grants and policies). No unit or browser test of the email |

### 2.2 Provider renewal document → owner inbox (N-APP-05)

| Aspect | Current behavior (source) |
|---|---|
| Caller | Vendor portal upload flow; an operator can also submit on the provider's behalf (owner decision 2026-09-15, [PHASE-5-RENEWAL-DOCUMENTS.md](PHASE-5-RENEWAL-DOCUMENTS.md) item 3: provider submissions notify, operator uploads and replays do not) |
| Route | `POST /api/renewal-documents/submit`, session client, 401 without a user ([route.ts:29](../src/app/api/renewal-documents/submit/route.ts#L29)) |
| Committed business event | `vendor_submit_renewal_document(p_path, p_contractor)` inserts one `vendor_renewal_documents` row ([20260925002000…sql:301](../supabase/migrations/20260925002000_vendor_renewal_unattached_uploads.sql#L301), insert at [:331](../supabase/migrations/20260925002000_vendor_renewal_unattached_uploads.sql#L331)) |
| Transaction boundary | The RPC. It locks the provider's onboarding row, verifies the storage object, enforces the open limit and inserts. A replay of the same path by the same submitter returns `recorded: false` without inserting |
| Source record | `vendor_renewal_documents(id, contractor_id, kind, storage_path, file_name, mime_type, size_bytes, submitted_by, submitted_as, created_at)` ([20260915001000…sql:21](../supabase/migrations/20260915001000_vendor_renewal_documents.sql#L21)). **Immutable**: `money_immutable` refuses UPDATE and DELETE ([:54](../supabase/migrations/20260915001000_vendor_renewal_documents.sql#L54)). Retention removes storage objects through deletion requests, never this row |
| Permissions | Table: all revoked from client roles and `service_role`; access only through SECURITY DEFINER functions |
| Readback | Admin → Compliance Expiry queue (`vendor_renewal_document_queue`, [renewals/page.tsx:83](../src/app/admin/compliance/renewals/page.tsx#L83)) |
| Notify condition | `result.recorded === true && result.submitted_as === "provider"` ([route.ts:44](../src/app/api/renewal-documents/submit/route.ts#L44)) |
| Email content | Inside `after()`: a service-client read of `contractors.name` ([route.ts:49](../src/app/api/renewal-documents/submit/route.ts#L49)); a missing or failed read becomes "A provider". Subject `Renewal document submitted — <business, 100 chars>`; body: Submitted (route clock after the RPC), Business, Item (`License` / `Insurance` label, fallback "Compliance"), and a fixed review instruction. No reply-to. No submitter personal data |
| Failure behavior | `console.error` with document ID and raw provider detail ([route.ts:68](../src/app/api/renewal-documents/submit/route.ts#L68)); raw caught error on a 500 ([route.ts:79](../src/app/api/renewal-documents/submit/route.ts#L79)) |
| HTTP | 200 `{ documentId, kind, recorded }` once the RPC returns; refusals mapped by `databaseRefusal`; 500 otherwise |
| Recovery evidence | The document row and its queue entry. No attempt record |
| Tests | SQL renewal suites and `tests/e2e/renewal-documents.spec.ts`. None asserts the email |

### 2.3 The established pattern (vendor application, N-APP-01, TRACE-104/151)

| Element | Evidence |
|---|---|
| Ledger | `private.r0_application_notifications`, PK = application ID, states `pending, sending, sent, failed, unknown, resend_requested, acknowledged`, shape checks tying `sending`↔`claim_id`, `sent`↔`sent_at`, `acknowledged`↔`acknowledged_at` ([20260929003000…sql:19](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L19)). Audit events without addresses ([:42](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L42)) |
| Atomic creation | `AFTER INSERT` trigger on `vendor_applications` ([:76](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L76); legacy-intake guard at [20261004001000…sql:79](../supabase/migrations/20261004001000_r0_legacy_provider_review.sql#L79)) |
| View-derived states | `missed` (pending older than 10 minutes), `unknown` (sending older than 10 minutes), `untracked` (no row) ([:91](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L91)); 10 minutes from `r0_notification_stale_after` ([:59](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L59)) |
| Claim | Row lock; only `pending` (initial) or `resend_requested` (resend); increments `attempts`; new claim UUID; content read from the saved record, never from the caller ([:104](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L104)) |
| Outcome write | Only for the current claim, else SQLSTATE 40001; provider error redacted of addresses ([:129](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L129)) |
| Resend | Operator (`vendor_require_operator()`, admin role). `failed`/`missed` directly; `unknown`/`untracked` only with explicit confirmation; idempotent while requested ([:155](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L155)) |
| Acknowledge | Operator, reason required ([:186](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L186)) |
| Grants | Revoke all from `public, anon, authenticated, service_role`; claim/record → `service_role`; resend/acknowledge/overview → `authenticated` with the operator guard inside ([:434](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L434), [:455](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L455)) |
| Sender and classification | `sendOwnerNotification` with `Idempotency-Key` ([ownerNotifications.ts:59](../src/lib/ownerNotifications.ts#L59)); 10 s timeout; `definite` for 4xx except 409. `outcomeState` and `providerErrorCode` ([applicationNotifications.ts:76](../src/lib/applicationNotifications.ts#L76), [:87](../src/lib/applicationNotifications.ts#L87)); key `vendor-application-notification:<id>:<attempt>` ([:64](../src/lib/applicationNotifications.ts#L64)) |
| Logging | `mercurius.oplog.v1`, server correlation ID per request carried into `after()` ([vendor-applications/route.ts:393](../src/app/api/vendor-applications/route.ts#L393)) |
| Operator UI | `/admin/recruiting` "Application emails": attention-only default with show-all, state badge with text, ConfirmAction resend (confirmation copy for unknown/untracked) and reason-required acknowledge ([recruiting/page.tsx:195](../src/app/admin/recruiting/page.tsx#L195); [recruitingReadiness.ts:90](../src/lib/recruitingReadiness.ts#L90)) |

### 2.4 Four identities, kept separate

| Identity | Contact | Renewal | Purpose | Logged? |
|---|---|---|---|---|
| Business-event identity | `contact_submissions.id` | `vendor_renewal_documents.id` | The saved fact the email describes. One ledger row per event | Yes, as `source_id` (UUID-validated) |
| Delivery-attempt identity | `(source, attempt)` plus a per-claim UUID | same | Which permitted send; the claim UUID is the capability to record its outcome | Attempt number yes; claim UUID **no** |
| Request correlation | server `randomUUID()` per route request | same | Joins log lines of one request and its `after()` work | Yes |
| Provider idempotency key | `contact-submission-notification:<id>:<attempt>` | `renewal-document-notification:<id>:<attempt>` | Resend replays the first result for a repeated key | **No** |

**What the ledger does not make idempotent.** The ledger guarantees at most one claim per permitted attempt for a saved record. It does **not** make the submission itself idempotent:
- **Contact:** a double click or a client retry after a lost 201 creates **two** contact rows and therefore two ledger rows and two owner emails. This is current behavior, and the plan keeps it (finding F-3).
- **Renewal:** idempotent by storage path in the database already. A replay inserts nothing, so the trigger does not fire and no second ledger row appears.

---

## 3. Recommended design

### 3.1 Extend the application ledger, or add a small shared one?

| Option | For | Against |
|---|---|---|
| **A. Extend `r0_application_notifications`** | One table and one screen | Its primary key and foreign key are the application ID. Holding other sources needs a new surrogate key, a polymorphic source and restated functions, all on a working production table that Phase 7.1 just characterized. That is not additive. The `r0_` names and the Recruiting page are vendor-specific |
| **B. One cloned ledger per path** | Each table has a direct FK | Two copies of every function, grant and test; drift between copies |
| **C. One small shared owner-email ledger (recommended)** | Additive; the application ledger stays byte-identical; one set of functions and tests; real FKs through one nullable column per source kind | A source-kind discriminator with a shape check; the operator surface is new rather than reused |

**Recommendation: C.** The existing application ledger, its functions, its route and `/admin/recruiting` are unchanged. Consolidating applications into the new ledger later is **not** proposed.

### 3.2 Ledger tables (proposed SQL, planning only)

```sql
-- 7.2C-1. Owner emails for saved records other than vendor applications.
create table private.owner_email_notifications (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('contact_submission', 'renewal_document')),
  contact_submission_id uuid unique references public.contact_submissions(id) on delete cascade,
  renewal_document_id uuid unique references public.vendor_renewal_documents(id),
  state text not null default 'pending'
    check (state in ('pending','sending','sent','failed','unknown','resend_requested','acknowledged')),
  attempts integer not null default 0 check (attempts between 0 and 10000),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text check (length(provider_message_id) <= 200),
  last_error_code text check (last_error_code in (
    'provider_refused','provider_rate_limited','provider_conflict',
    'provider_server_error','provider_timeout_or_network','provider_not_configured')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  acknowledged_reason text check (length(acknowledged_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_kind = 'contact_submission') = (contact_submission_id is not null)),
  check ((source_kind = 'renewal_document') = (renewal_document_id is not null)),
  check ((state = 'sending') = (claim_id is not null)),
  check (state <> 'sending' or claimed_at is not null),
  check ((state = 'sent') = (sent_at is not null)),
  check ((state = 'acknowledged') = (acknowledged_at is not null))
);

create index owner_email_notifications_attention
  on private.owner_email_notifications (state, created_at desc)
  where state <> 'sent' and state <> 'acknowledged';
create index owner_email_notifications_recent
  on private.owner_email_notifications (created_at desc, id desc);

-- Transition audit. No address, name, subject or message.
create table private.owner_email_notification_events (
  id bigint generated always as identity primary key,
  notification_id uuid not null,
  source_kind text not null,
  source_id uuid not null,
  previous_state text,
  state text not null,
  attempt integer not null,
  actor uuid,
  error_code text,
  reason text check (length(reason) <= 500),
  created_at timestamptz not null default now()
);

alter table private.owner_email_notifications enable row level security;
alter table private.owner_email_notification_events enable row level security;
revoke all on private.owner_email_notifications, private.owner_email_notification_events
  from public, anon, authenticated, service_role;
```

Notes:
- **Delete behavior.** Contact rows cascade, like the application ledger, so the ledger never blocks a future retention decision on contact submissions. The events table has no FK and holds no personal data, so the audit survives. Renewal documents cannot be deleted (`money_immutable`), so no cascade is needed.
- **Error storage.** Only the enumerated category from `providerErrorCode` is stored, not provider text (Codex decision C-4). The contact payload is personal data, and a provider body may echo it. The application ledger keeps redacted text; that is unchanged.
- **No recipient column.** The recipient is resolved at send time from configuration, as today. Storing it would duplicate an address with no recovery value.
- **No content column.** Content is read from the source record at claim time (§3.5). Nothing personal is copied into the ledger.

### 3.3 Atomic creation (triggers)

```sql
create function private.owner_email_contact_create() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n uuid;
begin
  insert into private.owner_email_notifications(source_kind, contact_submission_id)
    values ('contact_submission', new.id)
  on conflict (contact_submission_id) do nothing
  returning id into n;
  if n is not null then
    perform private.owner_email_log(n, 'contact_submission', new.id, null, 'pending', 0, null, null, null);
  end if;
  return new;
end $$;
create trigger owner_email_contact_create
  after insert on public.contact_submissions
  for each row execute function private.owner_email_contact_create();

-- 7.2C-2 only. Provider submissions notify; operator uploads and replays do not
-- (owner decision 2026-09-15). A replay inserts nothing, so this never fires for it.
create function private.owner_email_renewal_create() returns trigger
language plpgsql security definer set search_path = '' as $$ ... same shape ... $$;
create trigger owner_email_renewal_create
  after insert on public.vendor_renewal_documents
  for each row when (new.submitted_as = 'provider')
  execute function private.owner_email_renewal_create();
```

**Exact atomic-write boundaries:**
- **Contact:** the PostgREST `INSERT … RETURNING id` statement is one transaction. The row and its `pending` ledger record commit together, or neither does. The intake-limit record is written earlier in its own call, as today.
- **Renewal:** the `vendor_submit_renewal_document` RPC transaction. The document row and its ledger record commit together, or the RPC fails and the route returns 500, as any RPC failure does today. The `money_immutable` trigger is `BEFORE UPDATE OR DELETE` and does not interact with an `AFTER INSERT` trigger.
- **Neither path restates its business function.** `vendor_submit_renewal_document` keeps its body and grants. The ledger trigger is the only addition.

### 3.4 Functions

All are `SECURITY DEFINER`, `set search_path = ''`, with explicit revokes (default privileges already revoke EXECUTE from client roles, [20260903160000…sql:97](../supabase/migrations/20260903160000_phase2_client_grant_hardening.sql#L97); the migration still revokes explicitly, as TRACE-104 does).

| Function | Caller and grant | Behavior |
|---|---|---|
| `private.owner_email_log(...)`, `private.owner_email_view(n)` | none (private) | Audit insert; derived state |
| `public.owner_email_claim(p_kind text, p_source uuid, p_mode text)` | `service_role` only | `FOR UPDATE` on the ledger row found by kind and source. `initial` claims only `pending`; `resend` claims only `resend_requested`. Otherwise `{claimed:false, state:<view>}`. On claim: `sending`, new claim UUID, `attempts + 1`, audit, and returns `{claimed, claim_id, attempt, source:{…}}` built from the **source row** (§3.5). Not found → P0002 |
| `public.owner_email_record(p_kind, p_source, p_claim uuid, p_outcome text, p_provider_id text, p_error_code text)` | `service_role` only | `FOR UPDATE`; refuses unless `state = 'sending'` and `claim_id = p_claim` (40001). `p_outcome ∈ {sent, failed, unknown}`; `p_error_code` must be in the enumeration, or null for `sent`. Clears `claim_id`; sets `sent_at` and provider ID only for `sent` |
| `public.owner_email_request_resend(p_kind, p_source, p_confirm_uncertain boolean default false)` | `authenticated`, guarded by `vendor_require_operator()` | `FOR UPDATE` on the ledger row. `resend_requested` → idempotent return. Allowed from `failed`; from `missed` and `unknown` only with confirmation (C-3). `sending` within the claim window, `sent`, `pending` within the window and `acknowledged` → 55000. **No ledger row (untracked) → 55000 "Not tracked; recovery for records saved before tracking is a separate proposal."** Clears `claim_id`, so a stale worker's later outcome write is refused |
| `public.owner_email_acknowledge(p_kind, p_source, p_reason text)` | `authenticated`, operator guard | Reason required (1–500). Allowed from `failed`, `missed`, `unknown`, `resend_requested`. Idempotent from `acknowledged`. Untracked → 55000 (no row is created for history) |
| `public.owner_email_overview(p_kind text default null, p_include_settled boolean default false)` | `authenticated`, operator guard | All attention rows, plus up to 100 most recent settled rows when asked. Returns `checked_at`, `stale_after_minutes`, and per item: kind, source ID, a **non-sensitive label** (§5.2), submitted at, view state, attempts, `last_error_code`, sent, requested and acknowledged times, acknowledged reason, `needs_attention` |
| `public.owner_email_contact_submission(p_source uuid)` | `authenticated`, operator guard — **only if O-1 is approved** | The stored contact fields for one submission that has a ledger row, for an operator acting on a failed email |

The claim window reuses `private.r0_notification_stale_after()` (10 minutes) rather than adding a second constant. Codex may prefer a new private constant with the same value; the behavior is identical.

### 3.5 What delivery reads, and what may change in meaning

The claim returns the data the existing email uses, read from the saved record inside the claim transaction:
- **contact_submission:** `id, created_at, first_name, last_name, email, phone, subject, message`;
- **renewal_document:** `id, created_at, kind`, and `contractors.name` for `contractor_id` (may be null).

The message builders move from the routes into server-only helpers (`contactNotificationMessage`, `renewalNotificationMessage`) with the **same subject, body lines, labels, fallbacks and reply-to**.

Two differences, both proposed for acceptance (C-6):

| # | Difference | Why it is acceptable | Alternative |
|---|---|---|---|
| 1 | "Submitted:" comes from the row's `created_at` (database transaction time) instead of the route clock | Same moment within the request. It is the time the fact was saved, and it is stable across resends. The helper formats it with `new Date(created_at).toISOString()`, so the text format stays `YYYY-MM-DDTHH:MM:SS.sssZ`. The application ledger already uses the saved `created_at` | Snapshot the route time in the ledger. Rejected: no gain, one more column |
| 2 | Renewal "Business:" is read at **claim** time, so a resend after a provider rename shows the current name | For the initial attempt this is today's behavior (the route reads the name in `after()`). Operators review from Compliance Expiry, which also shows the current name. No personal data is involved | Snapshot the name in the ledger at insert. Keeps the original wording on resend, at the cost of copying business data |

Nothing else changes: same recipient resolution, subject truncation, "Not provided" and "A provider" fallbacks, reply-to for contact only, and the fixed renewal instruction.

### 3.6 Delivery helper and states

`deliverOwnerEmail(service, kind, sourceId, mode, send, trace)` mirrors `deliverApplicationNotification`:
claim → build message → `send({...message, idempotencyKey})` → `outcomeState` + `providerErrorCode` → `owner_email_record` → return `sent | failed | unknown | unrecorded | not_claimed`. Classification is reused unchanged from `applicationNotifications.ts` (imported; that file is not edited).

| State | Stored / derived | Meaning | Operator next action |
|---|---|---|---|
| `pending` | stored | Saved; no claim yet, within 10 minutes | Wait; refresh |
| `missed` | derived: pending > 10 min | No sender claimed it (`after()` never ran, or the old release was serving) | Check the inbox; resend with confirmation (C-3) or acknowledge |
| `sending` | stored, within 10 min | A sender holds the claim | Wait; no action offered |
| `unknown` | stored (409, 5xx, timeout, network) **or** derived: sending > 10 min | The email may have been accepted; includes a lost process and a failed outcome write | Check the owner inbox and Resend log; resend with confirmation or acknowledge |
| `sent` | stored | **Resend accepted it.** Not proof of inbox delivery | Confirm in the inbox if needed; no action offered |
| `failed` | stored (other 4xx incl. 429; not configured) | Definitely not accepted | Fix the cause if shown; resend or acknowledge |
| `resend_requested` | stored | An operator allowed one more attempt; the resend route is claiming it | Refresh; acknowledge if it never proceeds |
| `acknowledged` | stored | An operator recorded that no email is needed, with a reason | None |
| `untracked` | derived: no ledger row | Saved before tracking | Not listed; not sendable (§3.9) |

**Outcome-recording failure** (`unrecorded`) is a route-level result, not a stored state. The ledger stays `sending`, the claim window lapses, and the row reads `unknown`. That is truthful: an email may have gone out.

**Claims and stale workers.**
- **Expiry is bounded and passive.** After 10 minutes a `sending` row *reads* as `unknown`; nothing re-claims it automatically.
- **No automatic retry or scheduler** is added.
- **Stale writes.** A late outcome from the original worker is still accepted while its claim is current, because it is the truth for that attempt. Once an operator requests a resend, `claim_id` is cleared, and the stale worker's write fails with 40001.
- **The resend timeout** is 10 s, well inside the window.

### 3.7 Routes

- **Contact route.** Insert with `.select("id").single()`. `service_role` has table ALL, so `RETURNING` works. Then `after()` calls `deliverOwnerEmail(..., "contact_submission", id, "initial")` inside a try/catch that logs `owner_email.background_failed`. The response stays **201 `{ submitted: true }`** and is sent before any email work, whatever the email outcome.
- **Renewal route.** Same condition (`recorded && submitted_as === "provider"`). `after()` calls `deliverOwnerEmail(..., "renewal_document", document_id, "initial")`. The service-client name read moves into the claim. Same 200 body.
- **Resend route.** `POST /api/admin/owner-emails` `{ kind, sourceId, confirmUncertain }`:
  1. The session client calls `owner_email_request_resend`; the operator guard is in the database.
  2. The service client claims in `resend` mode and sends.
  3. Status mapping as in the application route: 400 invalid, 401 no session, 403 (42501), 404 (P0002), 409 (55000 or not claimed), 500.
  4. Result messages reuse the application route's wording ("Resend accepted… Confirm it arrived in the owner inbox", etc.).
- **Unchanged:** intake guard, validation, rate limits, `runtime`, the upload and verification flow, response bodies and status codes. The ad hoc `console.warn`/`console.error` calls in both routes are replaced by logger events; no raw error is printed (finding F-2).

### 3.8 Logging (7.1 logger)

Additive changes to `src/lib/observability/operationalLog.ts`, same allowlist discipline:

- **Routes:** `contact_submit`, `renewal_document_submit`, `owner_email_resend`.
- **Events:**
  - Submission: `contact_submission.saved | refused | failed`, `renewal_document_submission.saved | failed`.
  - Delivery: `owner_email.claimed | not_claimed | claim_failed | provider_result | recorded | record_failed | background_failed`.
  - Operator resend: `owner_email_resend.requested | refused | completed | failed`.
- **Keys:** two new keys, `source_kind` (`contact_submission | renewal_document`, else null) and `source_id` (UUID, else null). Every line then has 16 keys; the 7.1 exact-key test is updated. The schema string stays `mercurius.oplog.v1` because the change only adds nullable keys and no consumer exists yet (C-5). The alternative is `v2`.
- **Never logged:** submitter name, email, phone, subject, message, business name, file name or path, claim ID, idempotency key, provider message ID, provider body, operator ID.
- **Logs are best effort.** The sink swallows failures, so missing lines are inconclusive; the ledger decides whether an attempt occurred and whether a resend is permitted.

### 3.9 Historical records

- Rows saved before the migration have **no ledger row**. They read as `untracked`.
- The new overview lists only ledger rows. Resend and acknowledge refuse `untracked` with 55000.
- This **diverges deliberately** from the application ledger, which allows an untracked resend with confirmation. The instruction for this slice is that history must not become sendable.
- The page states: "Messages saved before email tracking began are not listed here and cannot be resent."
- **No backfill.** A historical inventory or resend is a separate proposal needing its own owner decision.

---

## 4. Migration, permissions and rollout

### 4.1 Objects per slice

| Slice | Migration (next free version, e.g. `20261122001000_phase7_owner_email_ledger.sql`) |
|---|---|
| 7.2C-1 | Both tables and indexes; log/view helpers; claim, record, resend, acknowledge and overview functions (claim already builds both payloads, so 7.2C-2 needs no restatement); the contact trigger; `owner_email_contact_submission` only if O-1 is approved; revokes and grants |
| 7.2C-2 | The renewal trigger only (separate migration) |

No existing table, column, policy, grant, function body or trigger is altered or dropped in either slice.

### 4.2 Grants, RLS and roles

| Role | Tables | Functions |
|---|---|---|
| `anon` | none | none |
| `authenticated` (non-admin) | none | overview, resend, acknowledge and contact detail are executable but refuse with 42501 through `vendor_require_operator()` |
| `authenticated` admin (operator) | none directly | overview, resend, acknowledge, contact detail (O-1) |
| `service_role` | **none directly**; access only through the functions | claim, record |
| Trigger functions | — | private; no grant |

Source IDs and recipients are derived securely:
- **Source ID.** The route reads the source ID from its own insert result (contact) or its own RPC result (renewal), never from the client.
- **Resend request.** The operator's request names `(kind, sourceId)`. The database resolves the ledger row, and the claim reads content from the source row.
- **Recipient.** Always the configured owner inbox. The contact reply-to is the stored submitter email; no caller-supplied address reaches the sender.

### 4.3 Money fingerprint and integrity checks

- **Fingerprint.** No function on [promotion-money-fingerprint.sql](../scripts/promotion-money-fingerprint.sql) is created or restated. `vendor_submit_renewal_document` and the contact insert path are not on the list, and the triggers attach to non-money tables without restating their writers. The fingerprint must read `58 | af0fae6e0c5b604e9073e10bc060957e` before and after, locally and in the hosted readback.
- **Completion integrity and final schema/grants checks** are not affected. They stay carried in the booking-readiness register.

### 4.4 Rollout and compatibility (DEC-2026-037)

1. Codex reviews the implementation PR. Exact-head CI passes.
2. With the owner's authorization: `supabase db push --linked --dry-run`, then `supabase db push --linked`.
3. A read-only hosted readback of tables, functions, triggers, grants and fingerprint, also authorized.
4. Merge, which deploys.

**Compatibility with the deployed application during the push-to-deploy window:**
- The old contact route still sends its untracked email and never claims. Each contact saved in the window gets a `pending` row that becomes `missed` after 10 minutes, although its email was probably sent.
- Old Vercel instances may serve briefly after the deploy, with the same effect.
- **Mitigation.** `missed` requires the inbox-check confirmation (C-3). After the deploy, an authorized read-only query counts `missed` rows created in the window; the operator checks the inbox and acknowledges them ("sent by the previous release during rollout").
- The old route ignores the new tables, and the insert still succeeds because the trigger only adds a row.

**Rollback / fix-forward.**
- **App-only rollback** (`vercel promote` of the previous deployment): old code keeps emailing, and new rows become `missed` noise. If the rollback lasts more than briefly, a forward migration drops the triggers.
- **Ledger data stays.** Tables and rows are kept as evidence and never dropped.
- **Schema defect:** fix forward with a new migration. No destructive rollback.

---

## 5. Operator surface

### 5.1 Placement

- **Route:** a new admin page, `/admin/owner-emails`, sidebar label **"Owner Emails"** in the Support group, next to Support Tickets (C-7).
- **Why not Recruiting:** Recruiting Readiness is a vendor-operations page and keeps its application emails.
- **Renewal rows** link to Compliance Expiry.

### 5.2 Content (MDS OperationalQueue, ConfirmAction)

- **Header:** "Owner emails". It states "Every saved message stays saved whatever happens to its email. 'Accepted by Resend' means Resend accepted it, not that it reached the inbox", plus the last checked time and a Refresh button.
- **Summary:** number needing attention, with an alert style that does not rely on colour alone.
- **Filter:** All / Contact form / Renewal documents. "Show settled" toggle (attention only by default).
- **Row:**
  - kind label;
  - a non-sensitive label: for contact, the same 100-character subject summary the email subject carries; for renewal, business name and item;
  - submitted time (Eastern);
  - a state badge with text (labels reused from `notificationStateLabel`);
  - attempt count, accepted time, acknowledged time and reason;
  - error category label plus a next-action sentence:

| Code | Label | Next action |
|---|---|---|
| `provider_refused` | Resend refused the email | Check the Resend dashboard for the reason, then resend |
| `provider_rate_limited` | Resend rate limit | Resend later |
| `provider_not_configured` | Email is not configured | No email was sent. Configuration needs fixing before a resend |
| `provider_conflict`, `provider_server_error`, `provider_timeout_or_network` | Result unknown | Check the owner inbox and Resend log before resending |

- **Actions** (only where `needs_attention`):
  - **Resend email** (ConfirmAction, commitment tone, names the entity). The consequence copy for `unknown`/`missed` says an earlier email may already have arrived, so check first. The request sends the confirmation flag.
  - **Acknowledge** (reason required).
  - Contact rows also get **View submission** if O-1 is approved. Renewal rows get **Open Compliance Expiry**.
- **States:**
  - loading (`AdminLoading`);
  - error with retry (`AdminError`);
  - empty attention list ("No owner emails need attention.");
  - empty all ("No tracked owner emails yet.");
  - the historical note (§3.9);
  - a refused resend keeps the dialog open with the database message and never claims success;
  - after any action the list reloads from the database (no optimistic state).
- **Accessibility:** keyboard reachable, visible focus, `aria-current` nav, axe clean and no horizontal scroll at 320 px and 1440 px, light and dark. A2 human checks stay carried.

### 5.3 Contact content and acknowledgement (owner decision O-1)

- **The gap.** For a contact submission, the owner email is the only way anyone reads the message today.
- **Approve O-1 (recommended).** The page offers "View submission" for tracked rows: the stored name, email, phone, subject and message, shown to admins only, on demand. It matches MPS role table rows 81 and 89 (customer contact details and support records for support need only), and admins already hold SELECT on the table by policy. Acknowledging then means "I read it here and will handle it".
- **Decline O-1.** Acknowledge for a contact row only records that no email is needed, and the message can be read only from the database console. The plan keeps Acknowledge in both cases, but with different consequence copy.
- **Out of scope either way:** the page is not a support inbox (no reply, assignment or status).

---

## 6. Acceptance evidence (for the implementation slices)

### 6.1 Local, synthetic, isolated (required before review)

**SQL (new suite, e.g. `120_owner_email_ledger.sql`)**
1. **Atomic creation.** A contact insert creates exactly one `pending` row and one event. A forced trigger failure rolls back the contact row (count 0). A renewal provider submission creates one row. An operator submission and a path replay create none. A forced trigger failure rolls back the document.
2. **Shape and enumeration checks.** Wrong kind/FK pairing, `sending` without a claim, `sent` without `sent_at`, an unknown error code: each refused.
3. **Claim rules.** An initial claim only from `pending`; resend only from `resend_requested`; attempts increment; a fresh claim UUID; the payload equals the source row. A stale claim's record → 40001. A record after a resend request (claim cleared) → 40001.
4. **Derived states.** With `created_at`/`claimed_at` moved past 10 minutes: `missed` and `unknown`. A row created and settled reads its stored state.
5. **Resend and acknowledge.**
   - Allowed only from `failed` (direct), and `missed`/`unknown` with confirmation.
   - Refused from `pending`/`sending` inside the window, `sent` and `acknowledged`, and untracked.
   - Idempotent while requested.
   - Acknowledge needs a reason, is idempotent, and refuses untracked.
6. **Authorization.**
   - `anon` cannot execute any function.
   - A homeowner and a vendor get 42501 from overview, resend, acknowledge and contact detail.
   - `authenticated` cannot claim or record.
   - Neither `authenticated` nor `service_role` can select from either table directly.
   - An admin succeeds.
   - A vendor can't read another provider's renewal row through any path.
7. **No personal data in events.** Event rows hold no submitter field values. Sentinel PII inserted in a contact row appears in no event column.
8. **Unchanged surfaces.**
   - SQL 054's grants still hold.
   - `vendor_submit_renewal_document`'s definition hash is unchanged.
   - The application ledger's functions are unchanged.
   - The fingerprint reads `58 | af0fae6e…`.

**Real-database concurrency (new script, as 7.1 did, plus a CI step)**
9. Eight concurrent initial claims → one claim. Four concurrent records for it → one recorded, the rest 40001.
10. Six concurrent operator resend requests → one permitted attempt. Mixed resend claims and stale initial claims → one claim (attempt 2). A stale worker cannot overwrite. Total sends: two.

**Unit (fake provider and fake database)**
11. **Provider outcomes.** 200 → `sent`; 422 and 429 → `failed`; 409, 500, 503 → `unknown`; timeout and network → `unknown`; not configured → `failed`, nothing sent; record failure → `unrecorded`. Error codes as in 7.1.
12. **Keys.** The idempotency key is per kind, source and attempt. A same-attempt replay (send twice with the same key against a fake that replays) records once. A distinct authorized resend uses attempt + 1 and a new key.
13. **Content parity.** Subject, body, reply-to and fallbacks equal the current route output for the same inputs: golden tests built from today's route code before it moves. The `Submitted:` format is checked.
14. **Submission success despite email failure.** The provider throws, the claim RPC errors, or the logger throws: the response stays 201 (contact) or 200 (renewal), and the row exists.
15. **Logger.** Every line has the 16 keys. Sentinel PII, claim ID, key, provider body, file name or path, and a malicious `source_id` never appear. A throwing sink changes no outcome. A client `x-correlation-id` is ignored.
16. **Resend route.** 400/401/403/404/409/500 mapping; the uncertain confirmation is passed only when the operator confirmed; non-operators send nothing.

**Browser (`owner-emails.spec.ts`)**
17. **States.** Loading, error with retry, empty attention, empty all, the historical note.
18. **Rows.** Attention-only default and show settled; the kind filter.
19. **Labels.** Each state label and error category label with its next action.
20. **Confirmation copy.** For `unknown`/`missed` versus `failed`, and the flag sent.
21. **Refusals.** A refused resend stays open with its message; acknowledge requires a reason.
22. **Reload.** The list reloads after an action.
23. **Detail and links.** View submission (if O-1) or its absence; the renewal link target.
24. **Access.** Non-admin denied; nav placement; axe and 320 px / 1440 px, light and dark.

**Regression**
25. Existing suites pass unchanged: `vendor-readiness`, `application-notification-tracing`, renewal SQL and e2e, request and contact e2e. The full unit, SQL and browser suites pass, as do typecheck, lint, build and the secret scan.

### 6.2 Exact-head CI

The PR's backend, lifecycle and application jobs pass on the final head, including the new SQL suite and the concurrency step. Result recorded on the PR.

### 6.3 Hosted migration verification (owner-authorized, after review, before merge)

- Dry run output.
- After the push: read-only readback of the new tables, columns, checks, indexes, triggers (`tgenabled`), function definitions and `proacl`, and RLS enabled.
- Fingerprint `58 | af0fae6e…`, and the `vendor_submit_renewal_document` definition hash unchanged.
- After the deploy: a count of `missed` rows in the rollout window, resolved as in §4.4.
- No production data copied into evidence.

### 6.4 Real-email verification (separate, owner-authorized, future)

- Only with the controlled test mailbox and the owner's instruction: one synthetic contact submission and, in 7.2C-2, one synthetic provider renewal.
- Evidence: the ledger reads `sent` with a provider message ID, and the email appears in the owner inbox.
- **Provider acceptance is never reported as inbox delivery.** No delivery webhook exists, and none is proposed.

---

## 7. Slices

| Slice | Scope | Hosted push |
|---|---|---|
| **7.2C-1 (proposed first)** | Migration 1 (§4.1). Contact route change, shared delivery helper, message builder, logger additions, resend route, `/admin/owner-emails` with contact rows, SQL suite, concurrency script and CI step, unit and browser tests | Yes, one |
| **7.2C-2** | Migration 2 (renewal trigger). Renewal route change and message builder, renewal rows and link on the page, SQL/unit/browser additions | Yes, one |

**Why contact first:**
- it has no other readback;
- it carries personal data;
- it takes anonymous traffic.

**Why split:** each slice has its own trigger, hosted push, rollout window and review, and 7.2C-2 is small once the ledger exists. Codex may merge the two into one slice with one migration if it prefers one push (C-2). They should not share a migration while their route changes ship separately, or the renewal trigger would produce `missed` rows with no claimer.

---

## 8. Findings during characterization

| # | Finding | Disposition |
|---|---|---|
| F-1 | R0-VENDOR-READINESS D10 says the contact form and renewal documents "have their own admin queues". Contact submissions have none | Recorded here; addressed by §5 and O-1. The R0 record is history and is not edited |
| F-2 | Both routes print the raw caught error and the provider's error detail with `console.error`; 7.1 left these paths alone | Replaced by logger events in each slice |
| F-3 | A contact double submit creates two submissions and two emails | Current behavior, kept. Submission idempotency would need a client key and is not proposed |
| F-4 | The renewal name lookup in `after()` swallows its error and emails "A provider" | Kept as the fallback; the read moves into the claim transaction, where an error fails the claim and is logged |

---

## 9. Decisions

### 9.1 Genuine owner decision

| ID | Question | Recommendation |
|---|---|---|
| **O-1** | May operators open a contact submission's stored content (name, email, phone, subject, message) from Owner Emails, on demand, for a tracked submission? | **Yes.** Without it, a contact message whose email cannot be delivered can be read only from the database console. Consistent with MPS "support need only" |

No other owner decision is needed. Recipients, subjects, content, consent, rate limits and retention are unchanged.

### 9.2 Codex decisions (recommendations)

| ID | Question | Recommendation |
|---|---|---|
| C-1 | Ledger shape | Shared new ledger (§3.1 C) |
| C-2 | Slicing | Two slices, contact first (§7) |
| C-3 | Does `missed` need the inbox-check confirmation? | **Yes**, for this ledger (rollout window and old instances). The application ledger is unchanged |
| C-4 | Store provider error text? | **No**: enumerated category only |
| C-5 | Logger keys | Add `source_kind` and `source_id` under `v1`, or bump to `v2` |
| C-6 | Content differences | Accept §3.5 items 1 and 2, or snapshot the business name |
| C-7 | Page placement | `/admin/owner-emails` in the Support group |
| C-8 | Overview bound | All attention rows plus 100 recent settled rows; keyset paging deferred until volume needs it |

---

## 10. Dependencies and carried boundaries

- **Dependencies:**
  - Codex review of this plan and the O-1 answer;
  - 7.1 logger and classification on `main` (satisfied);
  - main CI on `3eb8ff4` reaching a result (in progress at this checkpoint);
  - the owner's authorization for each hosted push.
- **Not dependent on:** the retrospective Codex review of 7.2B (it touches none of these files).
- **Carried, unchanged:**
  - Phase 6 acceptance exceptions;
  - CFG-011 90-day log retention, not met and assigned to 7.6. The ledger's own retention class is not decided here; it follows its source record;
  - A2 human verification;
  - final schema/grants, fingerprint and completion-integrity checks on the final candidate;
  - `offer_terms` and promotions gates off.
- **No** automatic retry, scheduler, delivery webhook, suppression, marketing send, payment or booking activation is proposed.

---

## 11. Validation of this document

Recorded in the PR body and the handoff:
- the diff is documentation only;
- every relative link resolves to an existing file and in-range line;
- `npm run scan:secrets` passes;
- `git diff --check` passes.

This plan performed:
- no hosted query;
- no email;
- no test or build run, because no code changed.
