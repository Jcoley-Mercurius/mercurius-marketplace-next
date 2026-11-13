# Phase 7.2C — Owner-email ledger plan for contact-form and renewal-document emails (TRACE-154)

**Status:** CLEARED BY CODEX FOR 7.2C-1 IMPLEMENTATION at `fedaf5f419e49349371e4a183987e05d5036f722` (2026-11-12), with the two binding clarifications in §0.2. This document is still documentation only; the 7.2C-1 implementation and its evidence are in [PHASE-7-OWNER-EMAIL-LEDGER-7-2C-1](PHASE-7-OWNER-EMAIL-LEDGER-7-2C-1.md). Nothing is pushed, deployed or activated.
**Previous status (kept as history):** REVISED PLAN FOR CODEX FINAL REVIEW (2026-11-12).
**Original status (kept as history):** PLAN FOR CODEX REVIEW, at head `89edfaefc37e262d3349e82c6ab770ce3e1cc572`.
**Revision:** §0.1 lists what changed after Codex's plan review: the owner's approval of O-1 ([DEC-2026-066](DECISION-LOG.md)), Codex's settled decisions C-1..C-8, and the four review findings.
**Checkpoint:** 2026-11-12 (America/New_York), `main` `3eb8ff4521c17bdf009247792f5a93d742c626d8` (#164 merge, 7.2B). Re-verified unchanged at the revision (§1.1).
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
7. **One genuine owner decision** (O-1): whether operators may open a contact submission's stored content from the new page. Without it, "acknowledge" for a contact email cannot be backed by having read the message (§5.3). **Approved by the owner on 2026-11-12** ([DEC-2026-066](DECISION-LOG.md)).

### 0.1 Revision after Codex's plan review (2026-11-12)

**Owner approval (product policy).** Josh approved all recommendations in Codex's plan review on 2026-11-12, as stated in the owner's revision instruction of that date. The owner decision is recorded as [DEC-2026-066](DECISION-LOG.md):

> **O-1:** Admins may open a tracked contact submission's stored name, email, phone, subject and message **on demand for operational handling**. Server-side operator authorization is required. Contact content must not appear in queue summaries, operational logs, analytics or URLs. This does not authorize a hosted push, real email or release.

**Codex's technical decisions (architecture, not product policy).** Settled by Codex in its review, and adopted here:

| ID | Settled | Where |
|---|---|---|
| C-1 | New shared owner-email ledger; the application ledger is unchanged | §3.1 |
| C-2 | Two implementation slices: contact first, renewal second | §7 |
| C-3 | Inbox-check confirmation before resending a `missed` or `unknown` outcome | §3.4, §3.6 |
| C-4 | Enumerated provider error categories only | §3.2 |
| C-5 | The expanded logging contract uses `mercurius.oplog.v2`; existing `v1` behavior is preserved | §3.8 |
| C-6 | The saved submission timestamp and the current renewal business name are accepted; the lookup failure behavior is specified | §3.5, §3.5.1 |
| C-7 | `/admin/owner-emails` under Support | §5.1 |
| C-8 | Bounded pages with "Load older" and exact attention counts, not every attention row without a limit | §3.4, §5.2 |

**Codex's review findings and their resolution.**

| # | Finding | Resolution |
|---|---|---|
| R-1 | Queue privacy: contact subjects are arbitrary user text and must not be queue summaries | Contact rows show the fixed label "Contact submission", the submitted time and a reference. The overview never returns subject or any other contact field. Full content only in the authorized on-demand detail view (§3.4, §5.2, §5.3; tests 17a, 23) |
| R-2 | Renewal lookup: a missing name and a genuine database/claim failure must be distinguished, and a changed failure path must not be called unchanged | §3.5.1 specifies both cases: what is committed, the claim rollback, whether an email is attempted, and how the obligation stays recoverable. The failure path **is changed** from today and is recorded as such (F-4; tests 3a, 14a) |
| R-3 | Audit classification: actor/source identifiers and free-form reasons are not anonymous | Classified as restricted administrative data, excluded from operational logs, analytics and URLs; retention follows existing approved rules with no new period or purge job (§3.10). The earlier statement that the events table "holds no personal data" is withdrawn |
| R-4 | Rollout compatibility: the old application can send without a ledger claim | A new acceptance test runs the old route's behavior against the new schema. Such rows are never claimed automatically (an initial claim refuses a `missed` row), and resend or acknowledgement from `missed`/`unknown` requires an explicit inbox-verification attestation; there is no bulk acknowledgement (§3.4, §4.4; test 26) |

### 0.2 Codex clearance and binding clarifications (2026-11-12)

Codex reviewed this plan at `fedaf5f` and cleared local implementation of **7.2C-1 only**. O-1 and C-1..C-8 stay settled. Two clarifications are binding and supersede any conflicting wording below; where older wording is kept, it is marked as superseded.

**Clarification 1: claim errors are not all confirmed rollbacks.**
- A confirmed SQL exception raised inside the claim rolls that claim transaction back.
- A timeout, lost connection or lost RPC response may happen **after** the claim committed.
- Without a successfully received claim result, the provider is not called.
- The ledger is never reset, and attempts are never assumed unchanged, because the client received an error. Actual durable state is read where available (the operator page always reloads from the database).
- A committed claim whose response was lost stays `sending` and later reads `unknown`. It is never claimed again automatically; recovery needs the attested resend.
- Required test: the database commits the claim but the response is lost; no automatic second claim or send occurs, and uncertain recovery requires confirmation.

**Clarification 2: acknowledgement and resend need different attestations.**
- **Resend** from `missed`/`unknown`: the operator checked and **found no matching email**.
- **Acknowledge** from those states: the operator **checked the inbox and provider evidence**, and the reason records what they found and why no further email is needed. Acknowledgement must work when the email **was found**; it never requires a "found no email" statement.
- Both stay explicit, per row, reasoned where required, and audited. The event table stores which attestation was given (`attestation`: `no_matching_email_found` or `inbox_evidence_reviewed`) in place of the single `inbox_checked` boolean proposed in §3.2.

---

## 1. Repository state at this checkpoint (factual)

| Item | Evidence |
|---|---|
| Working tree | Clean on `claude/phase7-2b-vendor-notification-readback` before branching; this branch was created from `origin/main` |
| `main` | `3eb8ff4521c17bdf009247792f5a93d742c626d8`, "Merge pull request #164", merged 2026-11-12T12:01:51Z |
| #164 (7.2B, TRACE-153) PR-head CI | Head `137dd24`: backend, lifecycle, application **success** (pull_request and push runs); Supabase Preview success; CodeRabbit skipped |
| Main merge CI on `3eb8ff4` | Run 43214230785: **in progress** at this checkpoint. No result is claimed. *(Later result: failure; see §1.1.)* |
| Codex review of 7.2B | **None recorded** in the repository or on the PR. Merging is not review acceptance. Codex owns the retrospective review; this plan does not substitute a self-review |
| 7.2B record | Said "Not merged, not deployed" ([PHASE-7-VENDOR-NOTIFICATION-READBACK.md:3](PHASE-7-VENDOR-NOTIFICATION-READBACK.md)). A dated factual status line is added in this branch; the original text is kept |
| Earlier Phase 7 PRs | #162 (7.1) merged `11c05b0`; #163 (7.2A) merged `f205b59`; #161 Phase 6 acceptance merged `9067f96` |
| Latest migration on `main` | `20261121001000_phase6_cs5_f01_exception_hard_stops.sql`. Latest SQL test: `119_vendor_notification_readback.sql` |

Deployment: merging to `main` deploys to production (DEC-2026-037). This plan did not query Vercel or the hosted database, so no deployment SHA or hosted schema state is claimed.

### 1.1 Reconciliation at the revision (2026-11-12)

Checked with `git fetch` and `gh` before editing:

| Item | Evidence |
|---|---|
| `main` | Still `3eb8ff4521c17bdf009247792f5a93d742c626d8`. The plan's base is current |
| #165 head before the revision | `89edfaefc37e262d3349e82c6ab770ce3e1cc572` (the original plan commit) |
| #165 pull-request CI on `89edfae` | Run 43217178220: backend, lifecycle, application **success** |
| #165 push CI on `89edfae` | Run 43217145834: backend and lifecycle success; application still **in progress** when checked. No result claimed |
| Main merge CI on `3eb8ff4` | Run 43214230785: **failure**. Backend and lifecycle success; the application job failed in the step "Component accessibility and keyboard tests". This supersedes the "in progress" row in §1 |
| Codex review of 7.2B | Still **none recorded** on #164 or in the repository |

**The main failure.** One browser test failed; 686 passed (Playwright, `retries: 0`):

- `tests/e2e/request.spec.ts:837` › accessibility matrix (I7) › **confirmation dark: axe and reflow at 320px**.
- axe `color-contrast` (serious) on the "Continue to secure checkout" button inside the confirmation's "Secure checkout" section ([RequestConfirmation.tsx:98](../src/components/request/RequestConfirmation.tsx#L98)): foreground `#f8f8f7` on background `#7d8288`, ratio 3.64 against 4.5.
- The run's `accessibility-evidence` artifact holds the trace and error context. Its page snapshot, taken after the failure, shows the button present and not disabled.

**What the evidence shows, and does not.**
- **It is intermittent on `main`, and unrelated to the 7.2B diff.** The same test failed on `main` before, in its **light** variant: run 42874195409 (commit `48d1bba`, 2026-11-10) reported the identical colours and ratio (`#f8f8f7` on `#7d8288`, 3.64). Run 42943958221 (#161 merge) failed in the same CI step on a different test (`tests/e2e/mds.spec.ts:50`, public mobile menu). Runs 42952294566 and 43067601866 passed. `request.spec.ts`, `src/components/request/`, `button.tsx` and `globals.css` are unchanged between `48d1bba` and `3eb8ff4` (`git diff --name-only` is empty), so #164 touched none of them.
- **The sampled background is not a resting theme colour.** It is the same in light and dark, and matches neither theme's `--color-primary` ([globals.css:16](../src/app/globals.css#L16), [:130](../src/app/globals.css#L130)). The button uses `transition-all` and `disabled:opacity-50`, and its `loading` prop disables it while `checkout.busy` ([button.tsx:60](../src/components/ui/button.tsx#L60)). The likeliest explanation is that axe sampled the button mid-transition out of a busy/disabled state. **This is a hypothesis.** The trace was not replayed frame by frame for this plan.
- **The passing #165 run does not explain it.** That run used a different commit and simply did not hit the timing.

**Recommended next action (not part of 7.2C).** A separately bounded CI-stability change, reviewed by Codex:
1. Replay the stored trace to confirm the state at the moment axe ran.
2. If the transient is confirmed, make the test wait for the settled state (for example, the button no longer `aria-busy` and transitions finished) before `expectAccessible`. If the resting state itself fails contrast, treat it as an MDS defect in the button's busy/disabled styling instead.
3. Until then, a red `main` run in this step should be read through its failing test and evidence, not rerun until green and reported as passing.

This plan makes no application, test or CI change for it.

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
| Email content | Inside `after()`: a service-client read of `contractors.name` ([route.ts:49](../src/app/api/renewal-documents/submit/route.ts#L49)); a missing or failed read becomes "A provider" (the returned `error` is ignored, so a database error still sends the email with the fallback; a thrown exception sends nothing and leaves no record). Subject `Renewal document submitted — <business, 100 chars>`; body: Submitted (route clock after the RPC), Business, Item (`License` / `Insurance` label, fallback "Compliance"), and a fixed review instruction. No reply-to. No submitter personal data |
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

-- Transition audit. No submitter address, name, subject or message is copied in.
-- actor and reason are restricted administrative data (§3.10).
create table private.owner_email_notification_events (
  id bigint generated always as identity primary key,
  notification_id uuid not null
    references private.owner_email_notifications(id) on delete cascade,
  source_kind text not null,
  source_id uuid not null,
  previous_state text,
  state text not null,
  attempt integer not null,
  actor uuid,
  error_code text,
  reason text check (length(reason) <= 500),
  inbox_checked boolean not null default false,  -- operator attested an inbox check (C-3, R-4)
  created_at timestamptz not null default now()
);

alter table private.owner_email_notifications enable row level security;
alter table private.owner_email_notification_events enable row level security;
revoke all on private.owner_email_notifications, private.owner_email_notification_events
  from public, anon, authenticated, service_role;
```

Notes:
- **Delete behavior.** Contact rows cascade, like the application ledger, so the ledger never blocks a future retention decision on contact submissions. Renewal documents cannot be deleted (`money_immutable`), so no cascade is needed.
- **Events follow their ledger row (revised, R-3).** The original plan gave the events table no FK because it "holds no personal data", so the audit would outlive its source. That premise was wrong: `actor` identifies a staff account, `source_id` links to a personal record, and `reason` is free text. The events now cascade with their ledger row, so they are kept exactly as long as the source record under existing rules (§3.10).
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
| `public.owner_email_claim(p_kind text, p_source uuid, p_mode text)` | `service_role` only | `FOR UPDATE` on the ledger row found by kind and source. `initial` claims only `pending` **within the claim window**; a `pending` row older than the window (view state `missed`) returns `{claimed:false, state:'missed'}` and is never claimed automatically (R-4). `resend` claims only `resend_requested`. Otherwise `{claimed:false, state:<view>}`. On claim: `sending`, new claim UUID, `attempts + 1`, audit, and returns `{claimed, claim_id, attempt, source:{…}}` built from the **source row** (§3.5). Not found → P0002. A confirmed SQL exception inside the function rolls the claim back; a lost response may follow a committed claim (§0.2, clarification 1; §3.5.1). *(Superseded wording: "Any error inside the function rolls the whole claim back.")* |
| `public.owner_email_record(p_kind, p_source, p_claim uuid, p_outcome text, p_provider_id text, p_error_code text)` | `service_role` only | `FOR UPDATE`; refuses unless `state = 'sending'` and `claim_id = p_claim` (40001). `p_outcome ∈ {sent, failed, unknown}`; `p_error_code` must be in the enumeration, or null for `sent`. Clears `claim_id`; sets `sent_at` and provider ID only for `sent` |
| `public.owner_email_request_resend(p_kind, p_source, p_confirm_uncertain boolean default false)` | `authenticated`, guarded by `vendor_require_operator()` | `FOR UPDATE` on the ledger row. `resend_requested` → idempotent return. Allowed from `failed`; from `missed` and `unknown` only with `p_confirm_uncertain = true`, the operator's attestation that they checked the owner inbox and Resend log and found no email (C-3); without it → 55000. The attestation is stored on the event (`attestation = 'no_matching_email_found'`; §0.2, clarification 2). *(Implemented as `p_confirm_no_email`.)* `sending` within the claim window, `sent`, `pending` within the window and `acknowledged` → 55000. **No ledger row (untracked) → 55000 "Not tracked; recovery for records saved before tracking is a separate proposal."** Clears `claim_id`, so a stale worker's later outcome write is refused |
| `public.owner_email_acknowledge(p_kind, p_source, p_reason text, p_inbox_checked boolean default false)` | `authenticated`, operator guard | Reason required (1–500). Allowed from `failed` and `resend_requested`; from `missed` and `unknown` **only with `p_inbox_checked = true`** (the operator checked the inbox and Resend log; the reason records what they found, including finding the email; §0.2, clarification 2), else 55000, so an uncertain row is never acknowledged blind (R-4). Idempotent from `acknowledged`. Untracked → 55000 (no row is created for history). One row per call; **no bulk acknowledgement** |
| `public.owner_email_overview(p_kind text default null, p_include_settled boolean default false, p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50)` | `authenticated`, operator guard | **Bounded keyset page (C-8).** `p_limit` is clamped to 1–100. Rows are ordered `created_at desc, id desc` and start strictly after the `(p_before_created_at, p_before_id)` cursor. Without `p_include_settled`, the page holds attention rows only. Returns `checked_at`, `stale_after_minutes`, `next_cursor` (null on the last page), **exact `attention_count`** in total and per kind (a `count(*)` over the full set, not the page), and per item: kind, source ID, a **non-sensitive label** (§5.2), submitted at, view state, attempts, `last_error_code`, sent, requested and acknowledged times, acknowledged reason, `needs_attention`. It **never returns a contact submission's name, email, phone, subject or message**, nor any actor ID (R-1, R-3) |
| `public.owner_email_contact_submission(p_source uuid)` | `authenticated`, operator guard (O-1, **approved**, DEC-2026-066) | The stored contact fields (name, email, phone, subject, message, submitted at) for one submission that has a ledger row, for an operator handling it. Untracked or unknown ID → P0002. Called only on an explicit operator action (§5.3) |

The claim window reuses `private.r0_notification_stale_after()` (10 minutes) rather than adding a second constant. Codex may prefer a new private constant with the same value; the behavior is identical.

### 3.5 What delivery reads, and what may change in meaning

The claim returns the data the existing email uses, read from the saved record inside the claim transaction:
- **contact_submission:** `id, created_at, first_name, last_name, email, phone, subject, message`;
- **renewal_document:** `id, created_at, kind`, and `contractors.name` for `contractor_id` (may be null).

The message builders move from the routes into server-only helpers (`contactNotificationMessage`, `renewalNotificationMessage`) with the **same subject, body lines, labels, fallbacks and reply-to**.

Two differences in content, both **accepted by Codex (C-6)**. A third, in the failure path, is specified in §3.5.1:

| # | Difference | Why it is acceptable | Alternative |
|---|---|---|---|
| 1 | "Submitted:" comes from the row's `created_at` (database transaction time) instead of the route clock | Same moment within the request. It is the time the fact was saved, and it is stable across resends. The helper formats it with `new Date(created_at).toISOString()`, so the text format stays `YYYY-MM-DDTHH:MM:SS.sssZ`. The application ledger already uses the saved `created_at` | Snapshot the route time in the ledger. Rejected: no gain, one more column |
| 2 | Renewal "Business:" is read at **claim** time, so a resend after a provider rename shows the current name | For the initial attempt this is today's behavior (the route reads the name in `after()`). Operators review from Compliance Expiry, which also shows the current name. No personal data is involved | Snapshot the name in the ledger at insert. Keeps the original wording on resend, at the cost of copying business data |

Nothing else changes in the **content**: same recipient resolution, subject truncation, "Not provided" and "A provider" fallbacks, reply-to for contact only, and the fixed renewal instruction. The **failure path does change**; §3.5.1 records how.

#### 3.5.1 Renewal business-name lookup: missing name versus failure (R-2)

The claim reads `contractors.name` with a left join on `contractor_id`. (`vendor_renewal_documents.contractor_id` references `vendor_onboarding`, not `contractors`, so a contractors row may be absent.) Two cases are distinct:

| Case | Today ([route.ts:49](../src/app/api/renewal-documents/submit/route.ts#L49)) | Proposed (7.2C-2) |
|---|---|---|
| **Missing name**: no contractors row, or `name` null | Email sent with "A provider" | **Unchanged.** The claim succeeds and returns a null name; the message builder uses "A provider"; the email is sent and recorded like any other attempt |
| **Genuine failure**: the claim function raises (statement error, lock or statement timeout, lost connection, unexpected exception) | The read's `error` is ignored, so a database error still sends "A provider". A thrown exception in `after()` sends nothing, is unhandled and leaves no record | **Changed.** See below |

**On a genuine claim failure, the proposed behavior is:**
- **What stays committed.** The `vendor_renewal_documents` row and its `pending` ledger row, both committed earlier in the `vendor_submit_renewal_document` transaction. The route has already returned 200 with the same body.
- **A confirmed exception rolls the claim back.** When the claim function raises, the ledger row stays `pending`, `attempts` is unchanged, there is no claim ID and no claim event. No partial claim is ever visible.
- **A lost response is not a rollback (§0.2, clarification 1).** A timeout or lost connection can follow a committed claim. The route then has no claim result and sends nothing, but the row may already be `sending` at attempt 1. Nothing resets it; it reads `unknown` after the window and needs the attested resend.
- *(Superseded wording, kept as history: "The claim rolls back entirely." It applies only to a confirmed exception.)*
- **No email is attempted.** The sender runs only after a successful claim, so the initial attempt sends nothing. This is the change from today, where a failed read still sent an email with the fallback.
- **Logged.** `owner_email.claim_failed` (v2) with `source_kind`, `source_id` and the mapped `error_code` (e.g. `db_unavailable`, `db_error`); no name, file name or path. The log is best effort; the ledger is the record.
- **Recoverable.** After the 10-minute window the row reads `missed` and enters the attention count. It is not claimed again automatically (§3.4). The operator checks the inbox and Resend log (the page cannot tell a failed claim from an old release's send), then resends with the attestation or acknowledges with a reason and the attestation. A successful resend claims attempt 1 with a fresh key.
- **Why change it.** Sending "A provider" because the database is failing hides the failure and leaves no recovery record. The new path never loses the obligation and never sends without a claim. If Codex prefers today's "send anyway" behavior, the alternative is a claim that tolerates only the name read failing. That needs a sub-transaction and was not chosen.

The **contact** claim has the same failure semantics: a raised claim leaves the submission and its `pending` row committed, sends nothing, and becomes `missed` after the window; a lost response after a committed claim leaves it `sending`, then `unknown` (§0.2). Today a contact email does not depend on any read, so this is also a changed failure path for contact. It is reached only when the database fails after the insert has already committed.

### 3.6 Delivery helper and states

`deliverOwnerEmail(service, kind, sourceId, mode, send, trace)` mirrors `deliverApplicationNotification`:
claim → build message → `send({...message, idempotencyKey})` → `outcomeState` + `providerErrorCode` → `owner_email_record` → return `sent | failed | unknown | unrecorded | not_claimed`. Classification is reused unchanged from `applicationNotifications.ts` (imported; that file is not edited).

| State | Stored / derived | Meaning | Operator next action |
|---|---|---|---|
| `pending` | stored | Saved; no claim yet, within 10 minutes | Wait; refresh |
| `missed` | derived: pending > 10 min | No sender claimed it (`after()` never ran, the claim failed, or the old release was serving and may have sent it) | Check the inbox and Resend log; then resend or acknowledge, each with the inbox-check attestation (C-3, R-4). Never claimed automatically |
| `sending` | stored, within 10 min | A sender holds the claim | Wait; no action offered |
| `unknown` | stored (409, 5xx, timeout, network) **or** derived: sending > 10 min | The email may have been accepted; includes a lost process and a failed outcome write | Check the owner inbox and Resend log; then resend or acknowledge, each with the inbox-check attestation |
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
- **Schema version (C-5, settled: `v2`).** The new events above are written as `mercurius.oplog.v2`, with 16 keys: the 14 `v1` keys plus `source_kind` (`contact_submission | renewal_document`, else null) and `source_id` (UUID-validated, else null). `application_id` stays in `v2` and is null for these events.
- **`v1` is preserved.** Every existing `v1` event (the 7.1 vendor-application events) keeps the schema string `mercurius.oplog.v1`, exactly its 14 keys and its current values. The 7.1 exact-key test is **not** edited; a separate exact-key test covers `v2`. A `v1` event can never carry the new keys, and a `v2` event can never be emitted as `v1`. The schema version is fixed per event name in the allowlist, not chosen by the caller.
- *(Original proposal, kept as history: add the two keys under `v1` and update the 7.1 test. Not adopted.)*
- **Never logged:** submitter name, email, phone, subject, message, business name, file name or path, claim ID, idempotency key, provider message ID, provider body, operator or actor ID, acknowledgement reason, and anything returned by the contact detail function (§3.10).
- **Logs are best effort.** The sink swallows failures, so missing lines are inconclusive; the ledger decides whether an attempt occurred and whether a resend is permitted.

### 3.9 Historical records

- Rows saved before the migration have **no ledger row**. They read as `untracked`.
- The new overview lists only ledger rows. Resend and acknowledge refuse `untracked` with 55000.
- This **diverges deliberately** from the application ledger, which allows an untracked resend with confirmation. The instruction for this slice is that history must not become sendable.
- The page states: "Messages saved before email tracking began are not listed here and cannot be resent."
- **No backfill.** A historical inventory or resend is a separate proposal needing its own owner decision.

### 3.10 Data classification and retention of the ledger (R-3)

**Classification.** The ledger and its events copy no submitter content, but they are **not anonymous**:

| Field | Why it is not anonymous |
|---|---|
| `contact_submission_id`, `renewal_document_id`, events `source_id` | Each joins to a record with personal or business data |
| `requested_by`, `acknowledged_by`, events `actor` | Each identifies a staff account |
| `acknowledged_reason`, events `reason` | Free text an operator types; it may name or quote a person |

All of these are **restricted administrative data**:
- **Storage and access.** In `private`, with RLS on and all table privileges revoked. Reached only through the operator-guarded functions. The overview returns reasons, because operators need them to handle a row, but never actor IDs.
- **Never in operational logs** (§3.8), analytics, URLs, provider payloads or error responses. `source_id` is the one identifier the logger carries, as a validated UUID, so a request can be traced. It is needed to recover the record and reveals nothing without database access.
- **The reason field** carries the hint "Describe what you checked. Don't include the submitter's personal details." A hint is guidance, not a control. The field remains restricted either way.

**Retention: existing approved rules only.** No new period or purge job is proposed.
- **CFG-011** sets 90 days for *operational application logs* and 3 years for *support tickets and platform messages*. The ledger is a durable business record, not an operational log, so the 90-day rule governs only the v2 log lines (still carried to 7.6).
- **No approved retention class exists for contact submissions.** No purge job exists either. Whether they are "support tickets" under CFG-011 is **not decided here**. It is the same kind of open question as contract G3-06.
- **The ledger follows its source.** A contact ledger row and its events cascade when the contact submission is deleted under whatever rule is later approved. A renewal ledger row is kept with its immutable document row.
- **The application ledger's events are unchanged.** Only the new events table gains the cascade (§3.2).

---

## 4. Migration, permissions and rollout

### 4.1 Objects per slice

| Slice | Migration (next free version, e.g. `20261122001000_phase7_owner_email_ledger.sql`) |
|---|---|
| 7.2C-1 | Both tables and indexes; log/view helpers; claim, record, resend, acknowledge and overview functions (claim already builds both payloads, so 7.2C-2 needs no restatement); the contact trigger; `owner_email_contact_submission` (O-1 approved, DEC-2026-066); revokes and grants |
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
- The old route ignores the new tables, and the insert still succeeds because the trigger only adds a row.

**Old application on the new schema (R-4).** Between the push and the deploy, the old route can send an email for a row that the ledger never saw claimed. The plan treats such rows as *possibly sent*:
- **No automatic resend.** The new release never claims them. Its initial claim runs only for the ID its own request inserted, and the claim refuses a `pending` row older than the window (§3.4). No scheduler or sweep exists.
- **No blind acknowledgement.** Resend and acknowledge from `missed` both require the inbox-check attestation, and acknowledge takes one row at a time with a reason.
- **Recovery is by actual inbox verification.** After the deploy, an authorized read-only query counts `missed` rows created in the window. For **each** row, the operator finds the matching email in the owner inbox or Resend log. If it is there, they acknowledge it with the attestation and a reason such as "Sent by the previous release during rollout; found in the inbox". If it is not, they resend it with the attestation. The database cannot verify that a human looked; the attestation, the reason and the per-row action are the controls, and they are recorded.
- **Test 26** (§6.1) proves this.

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
- **Summary:** the **exact** number needing attention (from `attention_count`, not the loaded page), in total and per kind, with an alert style that does not rely on colour alone.
- **Filter:** All / Contact form / Renewal documents. "Show settled" toggle (attention only by default).
- **Paging (C-8):** the first page loads up to 50 rows. **"Load older"** appends the next keyset page and disappears on the last page. Changing the filter or toggle, refreshing, or completing an action reloads from the first page. The count always reflects the whole set, so loaded rows can be fewer than the count; the page says "Showing N of M needing attention" when they differ.
- **Row:**
  - kind label;
  - a non-sensitive label:
    - **contact: the fixed text "Contact submission"**, plus a reference (the first eight characters of the submission ID, e.g. "Ref 3f2a9c1e"). No subject, name or other submitted text (R-1). *(The original plan used the 100-character subject summary. Withdrawn: subjects are arbitrary user text.)*
    - renewal: business name and item;
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
  - **Resend email** (ConfirmAction, commitment tone, names the entity). For `unknown`/`missed`, the consequence copy says an earlier email may already have arrived. The dialog requires a checkbox: "I checked the owner inbox and the Resend log and found no email for this submission." The confirm button stays disabled until it is ticked, and the request sends the flag only then.
  - **Acknowledge** (reason required). For `unknown`/`missed`, a **different** checkbox is required: "I checked the owner inbox and the Resend log for this submission." The reason is labelled "What you found and why no further email is needed" and may say the email was found (§0.2, clarification 2).
  - Contact rows also get **View submission** (O-1, approved). Renewal rows get **Open Compliance Expiry**.
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
- **Decision: O-1 approved by the owner, 2026-11-12 ([DEC-2026-066](DECISION-LOG.md)).** Admins may open a tracked submission's stored name, email, phone, subject and message on demand for operational handling. It matches the MPS role table: admin access to customer contact details for "support need only" ([PROPOSED-MPS.md:81](../mps/PROPOSED-MPS.md#L81)) and to support records through a "least-privilege support role" ([:89](../mps/PROPOSED-MPS.md#L89)). *(The original plan cited "rows 81 and 89" as both "support need only"; line 89 reads "least-privilege support role".)* Admins already hold SELECT on the table by policy. Acknowledging then means "I read it here and will handle it".
- *(The original plan also described declining O-1. That branch is no longer needed and is kept only in history.)*

**How the approval's conditions are met:**

| Condition (DEC-2026-066) | Design |
|---|---|
| On demand | "View submission" opens a dialog and only then calls `owner_email_contact_submission`. Nothing is prefetched, and closing the dialog discards the content from component state |
| Server-side operator authorization | The function checks `vendor_require_operator()` in the database; a non-admin gets 42501 and no content. The page's admin guard is a convenience, not the control |
| Tracked submissions only | Untracked or unknown IDs → P0002 |
| Not in queue summaries | The overview never returns contact fields (§3.4); rows show "Contact submission" and a reference (§5.2) |
| Not in operational logs | No log line is written with detail content. The detail call logs nothing beyond the generic route events, if any (§3.8) |
| Not in analytics | The dialog changes no URL, so Vercel Web Analytics sees only the redacted `/admin/owner-emails` page view ([analyticsRedaction.ts](../src/lib/analyticsRedaction.ts)). No custom analytics event is added |
| Not in URLs | The page takes no query parameter or path segment for a submission or its content. The detail is fetched by RPC with the ID in the body, never in the URL |

- **Out of scope:** the page is not a support inbox (no reply, assignment or status). Approval does not authorize a hosted push, real email or a release.
- **Not proposed:** a per-view access log. O-1 does not require one. Codex may ask for it in final review; it would be a restricted event like those in §3.10.

---

## 6. Acceptance evidence (for the implementation slices)

### 6.1 Local, synthetic, isolated (required before review)

**SQL (new suite, e.g. `120_owner_email_ledger.sql`)**
1. **Atomic creation.** A contact insert creates exactly one `pending` row and one event. A forced trigger failure rolls back the contact row (count 0). A renewal provider submission creates one row. An operator submission and a path replay create none. A forced trigger failure rolls back the document.
2. **Shape and enumeration checks.** Wrong kind/FK pairing, `sending` without a claim, `sent` without `sent_at`, an unknown error code: each refused.
3. **Claim rules.** An initial claim only from `pending` within the window; a `pending` row moved past the window (`missed`) returns `claimed:false` with state `missed` and is unchanged. Resend only from `resend_requested`; attempts increment; a fresh claim UUID; the payload equals the source row. A stale claim's record → 40001. A record after a resend request (claim cleared) → 40001.
3a. **Renewal lookup (R-2).**
   - **Missing name.** No contractors row, and a null name: the claim succeeds with a null business name.
   - **Forced claim failure** (a test-only fault inside the claim transaction, e.g. a lock timeout against a concurrent holder): the error is raised. Afterwards the document row exists, the ledger row is still `pending` with `attempts = 0` and no `claim_id`, and no claim event was written.
   - **Recovery.** Moved past the window, the row reads `missed`. Resend without the attestation → 55000. With it → `resend_requested`; the resend claim succeeds as attempt 1.
   - **Contact.** The same forced claim failure leaves the contact submission and its `pending` row committed.
4. **Derived states.** With `created_at`/`claimed_at` moved past 10 minutes: `missed` and `unknown`. A row created and settled reads its stored state.
5. **Resend and acknowledge.**
   - Allowed only from `failed` (direct), and `missed`/`unknown` with confirmation.
   - Refused from `pending`/`sending` inside the window, `sent` and `acknowledged`, and untracked.
   - Idempotent while requested.
   - Acknowledge needs a reason, is idempotent, and refuses untracked. From `missed`/`unknown` it refuses without `p_inbox_checked` (55000) and succeeds with it; the event records `attestation = 'inbox_evidence_reviewed'`.
5a. **Overview paging and counts (C-8).** With 130 attention rows and 20 settled rows across both kinds:
   - The default page returns 50 attention rows, newest first, with a `next_cursor`.
   - Following the cursor returns the next 50, then 30 with a null cursor. No row is repeated or skipped, including rows with equal `created_at`.
   - `attention_count` is 130 on every page, with the correct split per kind.
   - `p_limit` above 100 is clamped to 100, and below 1 to 1.
   - With settled rows included, paging covers all 150.
   - The derived `missed` and `unknown` rows are counted and listed as attention.
5b. **Queue privacy (R-1).** Sentinel values are placed in a contact row's name, email, phone, subject and message. No overview item, at any page, contains any of them, and no item carries an actor ID.
6. **Authorization.**
   - `anon` cannot execute any function.
   - A homeowner and a vendor get 42501 from overview, resend, acknowledge and contact detail.
   - `authenticated` cannot claim or record.
   - Neither `authenticated` nor `service_role` can select from either table directly.
   - An admin succeeds.
   - A vendor can't read another provider's renewal row through any path.
   - `owner_email_contact_submission`: `anon` cannot execute it; homeowner and vendor → 42501 with no content; an admin gets exactly the stored fields; an untracked submission → P0002.
7. **No submitter content copied into the ledger or events.** Sentinel PII inserted in a contact row appears in no ledger or event column. Actor and reason columns hold only what an operator supplied. They are restricted (§3.10), and the test asserts they can be read only through the operator-guarded functions.
7a. **Event retention follows the source (R-3).** Deleting a contact submission (as a superuser in the test, standing in for a future approved rule) removes its ledger row and every event for it.
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
14a. **Claim failure sends nothing (R-2).** When the claim RPC errors, the fake sender is never called. The helper returns a non-sent result, and `owner_email.claim_failed` is logged with a mapped `error_code`. When the claim returns a null business name, the email is sent with "Business: A provider" and the subject `Renewal document submitted — A provider`.
15. **Logger (C-5).**
   - Every owner-email, contact and renewal line has `schema: "mercurius.oplog.v2"` and exactly the 16 keys.
   - Every existing application-notification line is still `mercurius.oplog.v1` with exactly its 14 keys. The 7.1 exact-key test passes **unedited**.
   - Sentinel PII, claim ID, key, provider body, file name or path, actor ID, acknowledgement reason, contact detail content, and a malicious `source_id` never appear.
   - A throwing sink changes no outcome. A client `x-correlation-id` is ignored.
16. **Resend route.** 400/401/403/404/409/500 mapping; the uncertain confirmation is passed only when the operator confirmed; non-operators send nothing.

**Browser (`owner-emails.spec.ts`)**
17. **States.** Loading, error with retry, empty attention, empty all, the historical note.
17a. **Paging and privacy.**
   - The exact count shows with fewer rows loaded ("Showing 50 of 130 needing attention").
   - "Load older" appends the next page and disappears on the last page.
   - A filter change resets to the first page.
   - A contact row shows "Contact submission" and its reference. The page text, with no dialog open, contains none of the sentinel subject or message values.
18. **Rows.** Attention-only default and show settled; the kind filter.
19. **Labels.** Each state label and error category label with its next action.
20. **Confirmation copy.** For `unknown`/`missed` versus `failed`. For uncertain rows, the confirm button stays disabled until the inbox-check box is ticked, and the flag is sent only then. The same applies to Acknowledge.
21. **Refusals.** A refused resend stays open with its message; acknowledge requires a reason.
22. **Reload.** The list reloads after an action.
23. **Detail and links.**
   - View submission makes no detail request until clicked, then shows the stored fields.
   - The URL is unchanged before, during and after.
   - A 42501 response shows an access error and no content.
   - Closing the dialog removes the content from the page.
   - The renewal link target.
24. **Access.** Non-admin denied; nav placement; axe and 320 px / 1440 px, light and dark.

**Regression**
25. Existing suites pass unchanged: `vendor-readiness`, `application-notification-tracing`, renewal SQL and e2e, request and contact e2e. The full unit, SQL and browser suites pass, as do typecheck, lint, build and the secret scan.

**Rollout compatibility (R-4)**
26. **Old application on the new schema.**
   - **Setup.** With the 7.2C-1 migration applied, run the **old** contact route's behavior: a service-role insert with no `RETURNING`, no claim and a fake email "sent" outside the ledger. In SQL this is the bare insert. In a unit test, today's route handler is preserved as a fixture before it changes.
   - **Assert:**
     1. The insert succeeds and creates one `pending` row.
     2. The new release's code never claims it: no initial claim names that ID, and an initial claim forced on it after the window returns `claimed:false, state:'missed'`.
     3. Resend and acknowledge each refuse it without the inbox-check attestation.
     4. No function acknowledges more than one row per call.
     5. With the attestation and a reason (email found), acknowledge records `acknowledged` with `attestation = 'inbox_evidence_reviewed'`.

   Together these prove the row is never resent automatically or acknowledged blind.

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

**Why split:** each slice has its own trigger, hosted push, rollout window and review, and 7.2C-2 is small once the ledger exists. **Settled by Codex (C-2): two slices, contact first.** They must not share a migration while their route changes ship separately, or the renewal trigger would produce `missed` rows with no claimer.

**Test 26 in 7.2C-2.** The old-application test is repeated for the renewal trigger: the old renewal route sending without a claim.

---

## 8. Findings during characterization

| # | Finding | Disposition |
|---|---|---|
| F-1 | R0-VENDOR-READINESS D10 says the contact form and renewal documents "have their own admin queues". Contact submissions have none | Recorded here; addressed by §5 and O-1. The R0 record is history and is not edited |
| F-2 | Both routes print the raw caught error and the provider's error detail with `console.error`; 7.1 left these paths alone | Replaced by logger events in each slice |
| F-3 | A contact double submit creates two submissions and two emails | Current behavior, kept. Submission idempotency would need a client key and is not proposed |
| F-4 | The renewal name lookup in `after()` swallows its error and emails "A provider" | **Revised (R-2).** A *missing* name keeps the "A provider" fallback, unchanged. A *genuine failure* moves into the claim transaction and is a **changed** failure path: the claim rolls back, no email is attempted, and the committed `pending` row becomes a recoverable `missed` row (§3.5.1). *(The original wording, "Kept as the fallback", described only the missing-name case.)* |
| F-5 | Main CI on `3eb8ff4` failed one accessibility test, intermittently, also seen earlier on `main` | Outside 7.2C. Evidence and recommended next action in §1.1 |

---

## 9. Decisions

### 9.1 Genuine owner decision

| ID | Question | Recommendation | Decision |
|---|---|---|---|
| **O-1** | May operators open a contact submission's stored content (name, email, phone, subject, message) from Owner Emails, on demand, for a tracked submission? | **Yes.** Without it, a contact message whose email cannot be delivered can be read only from the database console. Consistent with MPS "support need only" | **APPROVED by the owner (Josh), 2026-11-12**, with server-side operator authorization and no contact content in queue summaries, operational logs, analytics or URLs. Recorded as [DEC-2026-066](DECISION-LOG.md). Not an authorization of a hosted push, real email or release |

No other owner decision is needed. Recipients, subjects, content, consent, rate limits and retention are unchanged.

### 9.2 Codex decisions

**Settled by Codex in its 2026-11-12 plan review** (§0.1). These are technical decisions, not owner policy. The owner's approval of "all recommendations" in that review is recorded separately in DEC-2026-066. The table below keeps the original recommendations as history; the column on the right is the settled outcome.

| ID | Question | Original recommendation | Settled |
|---|---|---|---|
| C-1 | Ledger shape | Shared new ledger (§3.1 C) | As recommended |
| C-2 | Slicing | Two slices, contact first (§7) | As recommended |
| C-3 | Does `missed` need the inbox-check confirmation? | **Yes**, for this ledger (rollout window and old instances). The application ledger is unchanged | As recommended, for resend; extended to acknowledgement from `missed`/`unknown` (R-4) |
| C-4 | Store provider error text? | **No**: enumerated category only | As recommended |
| C-5 | Logger keys | Add `source_kind` and `source_id` under `v1`, or bump to `v2` | **`v2`**; `v1` preserved exactly (§3.8) |
| C-6 | Content differences | Accept §3.5 items 1 and 2, or snapshot the business name | Accepted (saved timestamp, current name); lookup failure behavior specified in §3.5.1 |
| C-7 | Page placement | `/admin/owner-emails` in the Support group | As recommended |
| C-8 | Overview bound | All attention rows plus 100 recent settled rows; keyset paging deferred until volume needs it | **Bounded keyset pages with "Load older" and exact attention counts** (§3.4, §5.2) |

### 9.3 For Codex's final plan review

Choices made in this revision that Codex has not yet seen:
- **Events cascade** with their ledger row (§3.2, §3.10). Previously they had no FK.
- **Acknowledgement attestation.** Acknowledge from `missed`/`unknown` requires the inbox-check attestation (§3.4).
- **Initial claim refuses `missed`** rows (§3.4).
- **Page size** of 50, clamped to 1–100.
- **Claim failure sends nothing** on the initial attempt; the alternative is in §3.5.1.
- **No per-view access log** for contact detail (§5.3).

---

## 10. Dependencies and carried boundaries

- **Dependencies:**
  - Codex review of this plan and the O-1 answer (**both received 2026-11-12**; Codex's final review of this revision is pending);
  - 7.1 logger and classification on `main` (satisfied);
  - main CI on `3eb8ff4` reaching a result (**reached: failure**, an intermittent accessibility test outside this plan; §1.1). Codex decides whether the separate CI-stability change must land before 7.2C-1 starts or can proceed in parallel;
  - the owner's authorization for each hosted push.
- **Not dependent on:** the retrospective Codex review of 7.2B (it touches none of these files).
- **Carried, unchanged:**
  - Phase 6 acceptance exceptions;
  - CFG-011 90-day log retention, not met and assigned to 7.6. The ledger's own retention class is not decided here; it follows its source record (§3.10). No approved retention class exists for contact submissions;
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

The 2026-11-12 revision performed the same checks. It also made read-only GitHub reads of the CI runs and downloaded the `accessibility-evidence` artifact of run 43214230785 to a local scratch directory. Nothing from that artifact is committed.
