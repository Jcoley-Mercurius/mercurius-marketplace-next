# Phase 7.2A — Notification contract characterization (TRACE-152)

**Status:** CHARACTERIZATION FOR REVIEW (Codex). Documentation only. It approves no policy, implements nothing and activates nothing.
**Matrix version:** NM-1 (revision 2, after Codex review).
**Checkpoints:**
- **Original inspection (history):** 2026-11-10 (America/New_York), `main` `9067f96c25a60bb9abd505737e50ca62578b56d6`.
- **Reconciliation (current):** 2026-11-11, `main` `11c05b0ca35fd716d5bd26ffb3778d60fcc5fe24`. This is the #162 merge, so 7.1 (TRACE-151) is on `main`. Every source reference below is rechecked at this checkpoint.

**Branch:** `claude/phase7-2a-notification-contract`, from `main` `9067f96`, with `11c05b0` merged in (`6977130`).
**Authority:** the owner's Phase 7.2A instruction (2026-11-10), under the Phase 7 authorization in [PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md). Roadmap Phase 7: "Implement the approved notification matrix and consent distinctions." MPS §10 notification contract.
**7.1:** PR #162 (TRACE-151) **merged** as `11c05b0`. It was inspected read-only before merge and is now part of the baseline (§10).

This document is also the 7.2A handoff (§13). It does not edit `docs/agent/HANDOFF.md`.

---

## 0. Summary

1. **There is one product notification channel: in-app rows in `public.notifications`.** 33 live database functions write them. Every row is written in the same transaction as its business change. No row is ever sent anywhere else.
2. **Only homeowners can read their rows.** The bell and `/notifications` page are homeowner-only ([Header.tsx:103](../src/components/layout/Header.tsx#L103), [roles.ts:67](../src/lib/auth/roles.ts#L67)). Rows written for **vendors** (offers, quote results, DEC-2026-063 terms answers, appointments, pricing) and for **admins** have no screen that lists them.
3. **DEC-2026-063 (O-11) approves in-app notifications** to the homeowner (provider accepted, review terms) and to the provider (homeowner accepted or declined). All three producers exist in source. None has a test that asserts its row. The provider's notice cannot be read in the app. This document treats the `offer_terms` gate as off.
   - **Off prevents new entries.** No new other-terms offer is made, and a provider cannot accept one, so no request newly enters `awaiting_terms` (N-QTE-09).
   - **Off does not stop answers.** A homeowner can still answer terms a provider accepted before switch-off ([SQL 116:338](../supabase/tests/116_o10_offer_bound_terms.sql#L338)). That answer writes the provider notice (N-QTE-10), and a decline can lead to N-QTE-11.
4. **Email covers account, invitation, operator and price-draft mail only:**
   - Owner inbox, through Resend:
     - the vendor-application email (durable ledger, TRACE-104; traced by 7.1);
     - the contact-form and renewal-document emails (**no ledger**, against MTS §5's durable-attempt rule).
   - Vendors: the price-approval notice to an unlinked vendor's contact email (durable ledger, DEC-2026-041 item 6), and provider invitations (Supabase Auth).
   - Homeowners: account verification and password recovery (Supabase Auth).
   - **No service-lifecycle email exists.** Nothing about requests, offers, quotes, appointments, fulfillment, cancellations, payments or payouts is emailed to a homeowner or vendor.
   - No marketing message is produced.
5. **No approved authority defines channels, fallback, reminder timing or retry** for the MPS §10 events. Only two decisions name a channel: DEC-2026-063 (in-app) and DEC-2026-041 item 6 (email to the contact on file). DEC-2026-010 keeps email and reminder timing inactive.
6. **Recommended 7.2B (proposal, §9):** a vendor in-app notification readback for rows that are already recorded, with DEC-2026-063 producer evidence. It changes UI and tests only. It needs no migration, no producer change and no change to 7.1's files. It does need explicit choices on list bounds, unread-count wording and mark-all scope (§9). It also depends on the free-text disclosure decision (G3-05).

---

## 1. Baseline verification

**Original inspection checkpoint (2026-11-10), kept as history:**

| Item | Observation (2026-11-10) |
|---|---|
| `origin/main` | `9067f96c25a60bb9abd505737e50ca62578b56d6` (#161 merge), matching Codex's checkpoint |
| #161 | MERGED |
| #162 | OPEN, draft, head `8d35dc59e7af9ed97a39d75eeecc3370e74cdb8a`, matching Codex's checkpoint. Not modified, merged or cherry-picked |
| Main CI, #160 merge `88d4e09` | Run 42880366052 **success**. This reconciles the "still running" note in PHASE-6-ACCEPTANCE |
| Main CI, #161 merge `9067f96` | Run 42943958221 **failure**. Backend and lifecycle passed. Application had 675 passed and **1 failed**: `tests/e2e/mds.spec.ts:50` ("public mobile menu has one trigger, a name, scroll access, trap and restoration"). #161 changed documentation only. #162's head, which contains `9067f96`, passed run 42945085368. **Never diagnosed or re-run.** It stays historical and undiagnosed |

**Reconciliation checkpoint (2026-11-11), current:**

| Item | Observation (2026-11-11) |
|---|---|
| `origin/main` | `11c05b0ca35fd716d5bd26ffb3778d60fcc5fe24`: the #162 merge, matching Codex's checkpoint |
| #162 (7.1) | MERGED. It changed no `supabase/` file, so the producer inventory (§2) is unchanged. Its changed files were `src/lib/applicationNotifications.ts`, both application routes, the new `src/lib/observability/operationalLog.ts`, the tracing unit test, the concurrency script and its CI step |
| Main CI `11c05b0` | Run [42952294566](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/42952294566) **success**. The newer run passed. The earlier `mds.spec.ts:50` failure was **not** diagnosed or repaired; it is only not reproduced on the newer run |
| #163 | Head `69771301a65bc27b4abf4284d2b15adbce0b545d` (merge of `11c05b0` into this branch), MERGEABLE. Run 43050572595 was cancelled; run 43050562731 was still running. Neither is counted as a pass. The final head's result is recorded in the PR |
| Review | Codex reviewed the earlier head outside GitHub. This revision addresses those findings (§14) |
| Working tree | The main checkout was clean on the 7.1 branch. This slice uses a separate worktree. The ignored `.phase5-local/wt` worktree was left untouched |
| Phase 6 | Owner-accepted 2026-11-10 with verification exceptions (PHASE-6-ACCEPTANCE §"Verification exceptions"). They are carried unchanged in §11. Historical "Phase 6 unaccepted" statements are not treated as blockers |
| Phase 7 brief | None exists on `main` or #162. The 7.1 record says the same. This document uses the 7.2A instruction as its brief |

---

## 2. Method and evidence rules

- **Reconciliation recheck (2026-11-11).** `git diff 9067f96 11c05b0` touches no `supabase/` path, so the migration set and every database reference are unchanged. The three 7.1-changed references were moved to their new lines (§14, finding 1). Every other `src/` reference was rechecked at `11c05b0`.
- **Producer discovery.** A clean local replay of all 226 migrations (the isolated Phase 5 stack) was read with `pg_proc`. The applied versions were checked against `main`'s migration directory and matched exactly. #162 has no `supabase/` diff. Every function in `public` or `private` whose body calls `notify_user(` or inserts into `public.notifications` was listed (33 producers plus `notify_user`). Each was located in its **last** `CREATE [OR REPLACE] FUNCTION` and checked against the live body. Source references below point to that definition at `9067f96`. Two-argument dispute functions are the bodies called by the three-argument wrappers the UI uses (cs9 and 6.10).
- **Email and Auth discovery.** I searched `src/` and `supabase/functions/` for `api.resend.com`, `sendOwnerNotification`, `sendNotificationEmail`, `inviteUserByEmail`, `signUp`, `resetPasswordForEmail` and `generateLink`, and for every `functions.invoke` caller.
- **Readback discovery.** I searched for every reader of `public.notifications` (one hook, [useNotifications.ts](../src/hooks/useNotifications.ts)) and every place it is mounted.
- **Tests.** I searched SQL tests, concurrency scripts, unit tests and browser specs for the table and for each notification title. A count-only assertion is reported as such.
- **Read-only.** The local database was only queried. No hosted database, log, Vercel or Resend resource was read or written. **No hosted state is claimed.**
- **Facts are kept apart.** Each event records requirement approval, source implementation, test evidence, hosted verification and activation separately. Source presence is not runtime delivery.

### Status vocabulary

| Status | Meaning here |
|---|---|
| **ALIGNED** | An approved authority calls for the event; the source writes it for the intended recipient; the recipient can read it in the app; a repository test asserts the record. Says nothing about hosted state or activation |
| **INCOMPLETE** | Approved or listed by authority, implemented in part. A part is missing: readback, test evidence, a recipient, or a durable record |
| **CONFLICTING** | Source behavior or copy contradicts an approved authority |
| **UNDOCUMENTED** | Source produces it, but no authority calls for it or for its channel |
| **ABSENT** | An authority lists the event; no producer exists |
| **DORMANT** | A producer exists but cannot run (no trigger attached, or a guard refuses first) |
| **UNKNOWN** | Cannot be decided from the repository (hosted or deployed state) |

**Delivery-state vocabulary.** These are used only where evidence supports them.
- *In-app:* **recorded** (row committed with the business change) and **read** (`read_at` set by the recipient). In-app has no "sent", "delivered" or "failed" state.
- *Ledgered email:* **pending / claimed (sending) / sent = provider-accepted / failed (definite refusal) / unknown (may have been accepted) / unrecorded (outcome not saved) / missed / untracked**, from the ledger.
- *Unledgered email:* **unknown**. The only trace is a `console.error` on failure.
- **Delivered to an inbox is never evidenced** anywhere in the repository.

---

## 3. Governing authorities

| Ref | What it requires for notifications |
|---|---|
| MPS §10 | "Define a required channel and fallback for" eleven event groups (account/invite verification through support acknowledgement). "Messages must be idempotent, associated with a business event, auditable, privacy-safe, and governed by consent and transactional/marketing classification." **No channel or fallback is defined in MPS.** |
| MPS §5.6 (line 135) | Every transition must define actor, prerequisites, side effects, notification, timeout, permitted reversal, audit event and customer-visible wording |
| MPS §6.4 / §6.6 | Completion confirmation, dispute and any timer are "explicit and notified". Dispute notifications are required. One policy matrix controls UI, money, **notification** and operations |
| MPS §8 | Activation checklist: "Test notification received" |
| CFG-006 | Acceptance: boundary and waiver tests "produce the same outcome in policy copy, UI, ledger, **notifications**, and admin tools". Operations records "resulting customer/provider communication" for waivers |
| CFG-009 | One exclusive **four-hour** offer. Exhaustion copy "Not available yet in your area"; never claim active sourcing |
| CFG-011 | Platform messages 3 years; operational application logs 90 days |
| CFG-014 / [LAYERED-LAUNCH-DECISION](LAYERED-LAUNCH-DECISION.md) | Early-access email and an independent, unchecked marketing choice; promotional mail has its own unsubscribe and suppression |
| DEC-2026-006 | 72-hour completion escalation, counted from the recorded notice. No other reminder or quiet-hour timer is approved |
| DEC-2026-008 | Quote revisions expire 24 hours after sending |
| DEC-2026-010 | "Email/reminder timing stays inactive until separately configured." No Cron or real messages |
| DEC-2026-041 item 6 | Unlinked vendor: notice to the contact email on file through the existing notification system. Not approval. Missing or failed delivery stays visible to the operator |
| DEC-2026-053 E5 | Replacement needs the homeowner's explicit acceptance of provider and time. Implemented with in-app notices (cited by O-11 as "in-app notification as E5") |
| **DEC-2026-063 (O-10, O-11, P-3)** | "No automatic response timeout. Operations sees unanswered terms after 24 hours. **In-app notifications for this slice.**" [Bound-terms plan §699](PHASE-6-BOUND-TERMS-PLAN.md): "In-app notifications go to the homeowner (provider accepted, review terms) and to the provider (accepted or declined)." Provider acceptance is not homeowner price consent. The `offer_terms` gate stays **off** (PHASE-6-ACCEPTANCE §4) |
| Roadmap Phase 7 | Approved matrix and consent distinctions; email delivery/retry evidence and domain authentication; PII-safe logs. Gate: staged failures create the right alert, queue item, audit event and **user communication** |
| MTS §5 (line 78) | "Every external mutation needs a durable local attempt record, stable idempotency key, timeout/retry rules, and reconciliation path" (Stripe and Resend) |
| MTS §6 (line 150) | Messaging and notifications: "Visible only to participants/admin; retention is explicit" |
| MTS §7 (line 193) | Resend: timeout, failure logging, delivery monitoring; verify domain SPF/DKIM/DMARC |
| MDS | No notification-specific component rule. The general rules apply to any notification UI: WCAG 2.2 AA, keyboard, focus, 200% zoom and 320 px reflow, empty/error/loading states, portal shell pattern (MDS lines 14, 85, 169–170, 263, 277–285) |
| R0-VENDOR-READINESS (lines 62–72) | Email path inventory. Contact and renewal owner mail "not tracked by the ledger (follow-up)". R0 sends no Resend mail to homeowners or vendors. Suppression webhooks become required when status or marketing mail is sent |

---

## 4. Shared mechanics

### 4.1 In-app channel (`public.notifications`)

| Property | Evidence |
|---|---|
| Table | `id, user_id, type, severity, title, body, link, related_request_id, related_contractor_id, read_at, created_at` ([20260427132942…sql:1](../supabase/migrations/20260427132942_eab3d799-a97e-41ee-acba-ff9e3b420183.sql#L1)). Severity adds `critical` ([20260730012329…sql:17](../supabase/migrations/20260730012329_cde8f266-499e-4682-a96a-659159fa5104.sql#L17)) |
| Writer | `public.notify_user` is a SECURITY DEFINER single `INSERT` ([20260727111646…sql:8](../supabase/migrations/20260727111646_ef9c181b-ed2a-4fe4-924c-cf2c2447f394.sql#L8)). EXECUTE is limited to `postgres` and `service_role` (local `proacl`). Four producers `INSERT` directly: `create_job_offer_internal`, `admin_send_package_draft`, `admin_send_promotion_for_vendor_approval`, `admin_suspend_package` |
| Recipient choice | Always derived server-side from the locked record: `service_requests.customer_id`, `contractors.user_id` of the assigned or offered provider, or **every** `user_roles.role = 'admin'`. No client-supplied recipient. **Exception:** the policy "Admins can insert notifications" lets an admin `INSERT` any row for any user directly, with no audit event ([20260427132942…sql:34](../supabase/migrations/20260427132942_eab3d799-a97e-41ee-acba-ff9e3b420183.sql#L34)) |
| Isolation (RLS) | SELECT own (`auth.uid() = user_id`) or admin. UPDATE own (any column, not only `read_at`). DELETE own. Local grants: `authenticated` SELECT/INSERT/UPDATE/DELETE, with INSERT restricted to admins by policy. `anon` has no grant |
| Transaction | Written inside the business command's transaction. SQL 003 forces a notification insert failure and shows the lifecycle batch, flag, audit and run record all roll back ([003_phase4_lifecycle.sql:63](../supabase/tests/003_phase4_lifecycle.sql#L63)). By construction this holds for every producer, but it is tested only there |
| Dedupe | **No dedupe key and no unique constraint** on the table. Duplicate prevention relies entirely on each command's guard: per-request advisory lock + `FOR UPDATE`, operation or response keys with replay that returns before notifying, version checks, or duplicate-transition refusal. A replayed command writes no second row where it returns early; this is listed per event |
| Realtime | Table in `supabase_realtime`, `REPLICA IDENTITY FULL`. The hook subscribes per user and shows "Live notification updates are temporarily unavailable" on channel error ([useNotifications.ts:103](../src/hooks/useNotifications.ts#L103)). The isolated local stack excludes realtime |
| Readback | **Homeowner:** bell ([Header.tsx:185](../src/components/layout/Header.tsx#L185)), sidebar, `/notifications` ([page.tsx:19](../src/app/%28homeowner%29/notifications/page.tsx#L19)) with loading, empty, error-with-retry, mark read and mark all read. The link is sanitized to a local path; a request-related row opens `/dashboard?job=<id>` ([page.tsx:181](../src/app/%28homeowner%29/notifications/page.tsx#L181)). **Vendor:** none (no nav item in [VendorSidebar.tsx:13](../src/components/vendor/VendorSidebar.tsx#L13); `/notifications` redirects non-homeowners). **Admin:** none. Operators work from queues |
| Retention | No retention or purge job. Recipients can delete their own rows. Whether rows are "platform messages" under CFG-011 (3 years) is not decided |
| Browser evidence | No browser test of `/notifications` or the bell. `early-access-account.spec.ts:99` checks only that the nav link exists |

### 4.2 Email channels

| Path | Transport | Durable record | Idempotency | Recovery |
|---|---|---|---|---|
| Vendor application → owner (APP-01) | Next route `after()` → `sendOwnerNotification` → Resend | `private.r0_application_notifications` + events; row created by trigger in the application's transaction ([20260929003000…sql:19](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L19), [:85](../supabase/migrations/20260929003000_r0_vendor_readiness.sql#L85)) | Row-locked claim; `vendor-application-notification:<id>:<attempt>` key ([applicationNotifications.ts:65](../src/lib/applicationNotifications.ts#L65)) | Operator resend at `/admin/recruiting`; unknown or untracked needs confirmation |
| Price draft → unlinked vendor's email (PRC-01) | `/api/admin/package-draft-emails` → `sendNotificationEmail` to the contact on file | `private.package_draft_email_notices`, `unique (draft_id, revision)` ([20261018004000…sql:83](../supabase/migrations/20261018004000_pricing_owner_decisions.sql#L83)) | `package-draft-email:<draft>:<attempt>` ([draftEmailNotices.ts:47](../src/lib/draftEmailNotices.ts#L47)) | Operator resend; unknown needs confirmation |
| Contact form → owner (SUP-04) | `after()` → `sendOwnerNotification` ([contact-submissions/route.ts:113](../src/app/api/contact-submissions/route.ts#L113)) | **None** (the submission row is stored; the email attempt is not) | None | None. Failure is `console.error` only |
| Renewal document → owner (APP-05) | `after()` → `sendOwnerNotification` ([renewal-documents/submit/route.ts:55](../src/app/api/renewal-documents/submit/route.ts#L55)) | **None** | None | None |
| Provider invitation (APP-03) | `vendor-invite` Edge → Supabase Auth `inviteUserByEmail` via custom SMTP ([index.ts:270](../supabase/functions/vendor-invite/index.ts#L270)) | Invitation reservation and attempt records (TRACE-071/104) | Durable reservation | Invitation operations (Phase 5) |
| Homeowner verification and recovery (APP-04) | Supabase Auth `signUp`, `resetPasswordForEmail` ([AuthProvider.tsx:73](../src/components/providers/AuthProvider.tsx#L73), [:92](../src/components/providers/AuthProvider.tsx#L92)) | Auth-owned | Auth-owned | User retries |

Provider acceptance (`sent`) means Resend accepted the email. No webhook records delivery, bounce or complaint.

### 4.3 Consent and classification

- Every in-app row and every email above is **transactional or operational**. **No marketing message is produced.**
- The R0 marketing choice is captured (CFG-014) but has no sender. The suppression ledger (`r0_record_email_suppression`) is not wired to Resend events (R0-VENDOR-READINESS line 72).
- In DEC-2026-063, "consent" means **price consent**: the homeowner's keyed acceptance bound to the terms `consent_hash`. Notification copy must not imply it. Checked:
  - Homeowner notice: "Nothing is scheduled or charged until you accept them."
  - Provider notice on accept: "The homeowner accepted the terms you accepted. The service is scheduled." It is written only after the keyed acceptance has set `scheduled`.

---

## 5. Notification matrix NM-1

Event IDs are stable: `N-<family>-<nn>`. Unless a row says otherwise:
- **channel** is in-app;
- **timing** is immediate, in the business transaction;
- **gate** is none beyond the R0/R1 transaction gates (CFG-014; R1 is not open, so request-path events cannot occur for non-admitted homeowners in production).

Source references are rechecked at `11c05b0` (database references are byte-identical to `9067f96`). "Admins" means every account holding the admin role. Admin rows have no readback (§4.1), so the admin part of any event is **UNDOCUMENTED / write-only** unless noted.

### 5.0 Index

| ID | Event | Recipients | Status (by recipient where it differs) |
|---|---|---|---|
| N-APP-01 | Vendor application saved | Owner inbox (email) | ALIGNED in source (7.1 tracing merged); hosted UNKNOWN |
| N-APP-02 | Vendor application saved | Admins | UNDOCUMENTED |
| N-APP-03 | Provider invitation | Invited provider (Auth email) | INCOMPLETE (hosted delivery unproven) |
| N-APP-04 | Homeowner verification / recovery | Account holder (Auth email) | UNKNOWN (Auth-owned) |
| N-APP-05 | Renewal document submitted | Owner inbox (email) | INCOMPLETE (no durable attempt, MTS §5) |
| N-APP-06 | Legacy `vendor-application-notify` Edge | Team inbox (email) | UNKNOWN / DORMANT in source |
| N-APP-07 | Activation "test notification received" | — (operator attestation) | INCOMPLETE (no sender exists) |
| N-REQ-01 | Offer created | Offered provider | INCOMPLETE (no vendor readback) |
| N-REQ-02 | Offer expiry reminder | Provider | ABSENT (DEC-2026-010) |
| N-REQ-03 | Provider accepts (ordinary) | Homeowner | CONFLICTING (copy) |
| N-REQ-04 | Decline / expiry / exhaustion / consent needed | Homeowner | ABSENT |
| N-REQ-05 | Legacy match trigger "24 hours" | Provider | DORMANT (would conflict with CFG-009) |
| N-REQ-06 | Request submission / coverage outcome | Homeowner | ABSENT as a message (screen confirmation only) |
| N-QTE-01 | Provider proposes quote | Admins | UNDOCUMENTED |
| N-QTE-02 | Operator returns proposal | Provider | INCOMPLETE |
| N-QTE-03 | Operator sends itemized quote | Homeowner | ALIGNED |
| N-QTE-04 | Operator sends quote | Provider | INCOMPLETE |
| N-QTE-05 | Homeowner declines quote | Admins | UNDOCUMENTED |
| N-QTE-06 | Quote expires (24 h) | Homeowner | INCOMPLETE (scheduler inactive; untested title) |
| N-QTE-07 | Legacy `quoted` transition | Homeowner | DORMANT |
| N-QTE-08 | Quote accepted | Provider / homeowner | ABSENT (approval blocked by tax gate) |
| N-QTE-09 | Provider accepts at other terms | Homeowner | INCOMPLETE (untested); gate off blocks new entries |
| N-QTE-10 | Homeowner accepts / declines terms | Provider | INCOMPLETE (no vendor readback, untested); **still producible with the gate off** for terms accepted before switch-off |
| N-QTE-11 | Re-match after decline fails | Admins | UNDOCUMENTED channel; producible with the gate off after such a decline |
| N-QTE-12 | Terms unanswered 24 h | Operations (queue) | ALIGNED (queue, not a message) |
| N-APT-01 | Operator records appointment | Homeowner; provider | Homeowner ALIGNED; provider INCOMPLETE |
| N-APT-02 | Reschedule request recorded | Homeowner; provider; admins | INCOMPLETE |
| N-APT-03 | Homeowner answers provider's proposed time | Provider; admins | INCOMPLETE |
| N-FUL-01 | Work started | Homeowner | INCOMPLETE (untested title) |
| N-FUL-02 | Vendor marked complete | Homeowner | ALIGNED |
| N-FUL-03 | Homeowner confirmed | Provider | INCOMPLETE |
| N-FUL-04 | Job closed out | Homeowner; provider | INCOMPLETE |
| N-FUL-05 | Confirmation reminder (batch) | Homeowner | INCOMPLETE (scheduler inactive) |
| N-FUL-06 | 72 h escalation | Admins; homeowner | Homeowner ALIGNED in source; scheduler inactive |
| N-FUL-07 | Fulfillment exception recorded | Homeowner; provider; admins | INCOMPLETE |
| N-FUL-08 | Generic `scheduled` transition | Homeowner | UNDOCUMENTED (overlaps N-REQ-03) |
| N-FUL-09 | Dispute raised | Homeowner; admins | Homeowner INCOMPLETE (untested title) |
| N-FUL-10 | Dispute updated / resolved | Homeowner | INCOMPLETE |
| N-FUL-11 | Resolution appealed | Admins | UNDOCUMENTED |
| N-FUL-12 | Review moderation | Homeowner | ALIGNED |
| N-SUP-01 | Support ticket opened | Admins | UNDOCUMENTED |
| N-SUP-02 | Requester replies | Admins | UNDOCUMENTED |
| N-SUP-03 | Operations replies | Requester | INCOMPLETE |
| N-SUP-04 | Contact form submitted | Owner inbox (email) | INCOMPLETE (no durable attempt) |
| N-CXL-01 | Customer cancellation | Homeowner; provider; admins | INCOMPLETE (duplicate notices; CFG-006 evidence) |
| N-CXL-02 | Provider cancel / no-show withdrawal | Homeowner; provider; admins | INCOMPLETE |
| N-CXL-03 | Replacement provider accepts the offer | Homeowner; admins | Homeowner INCOMPLETE (untested) |
| N-CXL-04 | Operator proposes replacement | Homeowner | ALIGNED |
| N-CXL-05 | Homeowner answers replacement | Provider; admins | INCOMPLETE |
| N-CXL-06 | Waiver accepted | Homeowner | INCOMPLETE (untested) |
| N-CXL-07 | Payment success / failure / refund | Homeowner | ABSENT (payments inactive) |
| N-CXL-08 | Payout scheduled / paid / failed | Provider | ABSENT (payouts inactive) |
| N-REC-01 | Recurring visit created | Homeowner (+ N-REQ-01 to provider) | ALIGNED |
| N-REC-02 | Homeowner asks to stop future visits | Homeowner; admins | INCOMPLETE (untested) |
| N-REC-03 | Operator closes stop request | Homeowner | INCOMPLETE (untested) |
| N-REC-04 | Visit unpaid / payment due | — | ALIGNED (no notice by decision) |
| N-REC-05 | Plan pause / resume / stop | — | ALIGNED (no notice, recorded as built) |
| N-CRD-01 | Credits earned / corrected | — | ABSENT (R1 gate; no authority artifacts) |
| N-PRC-01…04 | Pricing notices to vendors | Vendor | INCOMPLETE (no vendor readback); outside the 7.2 families |

### 5.1 Applications, onboarding and account (APP)

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-APP-01 | Vendor application row committed (public applicant) → owner inbox (`OWNER_NOTIFICATION_EMAIL` or the fallback) | TRACE-104; roadmap R0.4 missed-email detection; MTS §5 l.78; CFG-011 logs (7.1) | [vendor-applications/route.ts:393](../src/app/api/vendor-applications/route.ts#L393) `after()`, carrying the server correlation ID → [applicationNotifications.ts:92](../src/lib/applicationNotifications.ts#L92) → ledger (§4.2) | Pending row in the application transaction; row-locked claim; outcome only for the current claim; Resend idempotency key. On `main` (7.1): [scripts/application-notification-concurrency.mjs](../scripts/application-notification-concurrency.mjs) as a CI step: 8 concurrent claims → 1; 4 outcome records → 1; 6 operator resends → 1 attempt; 9 mixed claims → 1 | Readback `/admin/recruiting` with state, attempt and redacted error; "Sent means Resend accepted it". Tests: SQL 071, `vendor-readiness.test.ts`, `vendor-readiness.spec.ts`, and from 7.1 [application-notification-tracing.test.ts](../tests/unit/application-notification-tracing.test.ts) (45 tests). Logs: [operationalLog.ts](../src/lib/observability/operationalLog.ts) (`mercurius.oplog.v1`, allowlisted, never throws). **Missing log lines are inconclusive; the ledger decides** | ALIGNED in source. Hosted delivery, SPF/DKIM, inbox arrival and preview/production log readback **not verified**. CFG-011 90-day log retention not met (§11) |
| N-APP-02 | Same insert → all admins | None names admin in-app delivery | Trigger `trg_notify_admins_new_vendor_application` → `notify_admins_new_vendor_application` ([20261004001000…sql:66](../supabase/migrations/20261004001000_r0_legacy_provider_review.sql#L66)) | One row per admin per insert; skipped for legacy intake | Body names the business and category. No admin readback. SQL 053, 074 (counts) | UNDOCUMENTED (write-only) |
| N-APP-03 | Operator sends invitation → invited email address | MPS §8, §10 account/invite; TRACE-071/104; DEC-2026-029 | `vendor-invite` Edge ([index.ts:270](../supabase/functions/vendor-invite/index.ts#L270)) | Durable reservation prevents a second send (Phase 5) | Phase 5 tests (`invitation-operations.spec.ts`, SQL 037 and others) | INCOMPLETE: hosted SMTP and template delivery are owner work, not proven (R0-VENDOR-READINESS line 74). Characterized in Phase 5 records, not re-inspected here |
| N-APP-04 | Sign-up or password recovery → that email | MPS §10 account verification | Supabase Auth ([AuthProvider.tsx:73](../src/components/providers/AuthProvider.tsx#L73)) | Auth-owned | Auth templates | UNKNOWN (outside the app; out of 7.2 scope) |
| N-APP-05 | Provider submits a renewed document (recorded, as provider) → owner inbox | TRACE-073; MTS §5 l.78 | [renewal-documents/submit/route.ts:55](../src/app/api/renewal-documents/submit/route.ts#L55) | **No attempt record, no key.** The document row is durable | Email names the business and item. Failure is console only; not visible to operators | INCOMPLETE. Gap G1-02 |
| N-APP-06 | Any caller with a valid project JWT → team inbox | None (superseded by TRACE-104) | `supabase/functions/vendor-application-notify/index.ts`, Lovable gateway; no caller in `src/` | None | — | UNKNOWN. Recorded ACTIVE in the 2026-09-03 inventory as an August build. Deployed state not checked here. Decommissioning is an owner hosted action (G3-09) |
| N-APP-07 | Operator records "Test notification received" evidence | MPS §8 checklist | Onboarding evidence kind `test_notification` ([VendorOnboardingChecklist.tsx:110](../src/components/admin/VendorOnboardingChecklist.tsx#L110)) | — | It records an attestation. **Nothing in the app sends a test notification**, and vendors cannot see in-app rows | INCOMPLETE (G3-08) |

### 5.2 Requests, sourcing and matching (REQ)

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-REQ-01 | An exclusive offer row is created (start, decline, expiry, release, fallback consent, rematch, visit) → the offered provider's user | CFG-009; MPS §10 provider offer | `private.create_job_offer_internal` ([20261118001000…sql:446](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L446)) | Created with the offer under the request lock. "At most one active exclusive offer" is tested in matching concurrency | "New job offer — respond within four hours", link `/vendor/jobs`. Vendor sees the offer itself in Jobs & Requests, but **not the notice**. SQL 095:212 (visit offers, count) | INCOMPLETE (no vendor readback) |
| N-REQ-02 | Offer nearing expiry → provider | MPS §10 "expiry reminder" | — | — | — | ABSENT. Reminder timing inactive (DEC-2026-010). Owner policy (G3-02) |
| N-REQ-03 | Offered provider accepts a fixed or quote request (not the terms or replacement paths) → homeowner | DEC-2026-007; MPS §10 match acceptance | `public.vendor_accept_job` ([20261117001000…sql:973](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L973)) | Request advisory lock. Six concurrent accepts write **one** homeowner row (`scripts/phase6-matching-offers.mjs:143`) | "Provider accepted your service — Your service is scheduled. Review the appointment details and any pending price quote." | CONFLICTING copy: it names appointment details when none may be recorded. Known Phase 7 carry ([PHASE-6-MATCHING.md:85](PHASE-6-MATCHING.md)); MPS honest-outcome rule; D-3. The function is in the money fingerprint (G2-05) |
| N-REQ-04 | Decline, expiry or exhaustion leaves `awaiting_consent` or `exhausted` → homeowner | MPS §10 decline/exhaustion; CFG-009 copy | — (`offer_next_for_request_internal` sets state, no notice) | — | Homeowner sees state on the dashboard only | ABSENT. Channel and copy policy is the owner's (G3-01) |
| N-REQ-05 | `service_requests.contractor_id` changes → provider | None; conflicts with CFG-009 | `public.record_match_offer` ([20260729104728…sql:96](../supabase/migrations/20260729104728_ed7b52f7-e600-489c-8f0e-7ba53eca3f41.sql#L96)) | — | "respond within **24 hours**", link `/vendor/requests` (route does not exist) | DORMANT: no trigger is attached (local `pg_trigger`). Hosted attachment UNKNOWN. Must not be reattached |
| N-REQ-06 | Request submitted / coverage checked → homeowner | MPS §10; §6.1 confirmation copy | Screen confirmation only (`requestConfirmation.ts`) | — | — | ABSENT as a message. On-screen confirmation is the existing readback |

### 5.3 Quotes and offer-term changes / consent (QTE)

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-QTE-01 | Assigned provider proposes an itemized quote → admins | DEC-2026-045; CFG-015 (queue) | `vendor_propose_quote` ([20261022001000…sql:325](../supabase/migrations/20261022001000_phase6_quotes.sql#L325)) | Request lock; supersedes the pending proposal | No admin readback. Queue `/admin/requests` is the operator surface | UNDOCUMENTED |
| N-QTE-02 | Operator returns the proposal → proposing provider | DEC-2026-045 | `admin_return_quote_proposal` ([…quotes.sql:470](../supabase/migrations/20261022001000_phase6_quotes.sql#L470)) | Proposal `FOR UPDATE`; refuses an already handled proposal | "Your quote proposal was returned". No vendor readback of the notice. Untested title | INCOMPLETE |
| N-QTE-03 | Operator sends an itemized quote → homeowner | DEC-2026-045, -008; MPS §10 quote received | `admin_send_itemized_quote` ([…quotes.sql:415](../supabase/migrations/20261022001000_phase6_quotes.sql#L415)) | Request lock; proposal status | "Tax is pending confirmation, so this quote can't be approved yet … a quote is not a payment." SQL 090:132 | ALIGNED |
| N-QTE-04 | Same send → proposing provider | DEC-2026-045 | Same ([…quotes.sql:427](../supabase/migrations/20261022001000_phase6_quotes.sql#L427)) | Same | "Your quote was sent" / "corrected and sent". SQL 090:131. No vendor readback | INCOMPLETE |
| N-QTE-05 | Homeowner declines the quote → admins | MPS §6.3 decline ≠ cancellation | `homeowner_respond_to_quote` ([…quotes.sql:523](../supabase/migrations/20261022001000_phase6_quotes.sql#L523)) | Request lock; current-quote check | "The request has not been cancelled." No admin readback | UNDOCUMENTED |
| N-QTE-06 | 24 h after send, batch expires the quote → homeowner | DEC-2026-008; MPS §10 quote expiring | `private.expire_request_quotes` ([20260904001000…sql:124](../supabase/migrations/20260904001000_phase4_quote_revisions.sql#L124)), called only by `run_lifecycle_batch` | Conditional update `status='submitted'`; batch run-ID replay | "This does not cancel the service." Untested title | INCOMPLETE. **Scheduler inactive** (no `cron.job`; worker disabled, PHASE-6-FULFILLMENT F7), so expiry and its notice happen only if an operator runs the worker |
| N-QTE-07 | Transition to `quoted` → homeowner | — | `private.transition_job_status` ([20261101001000…sql:513](../supabase/migrations/20261101001000_phase6_exceptions.sql#L513)) | — | Shows a dollar amount | DORMANT: the same function refuses `quoted` first ("Use the canonical quote … workflow") |
| N-QTE-08 | Homeowner approves a quote → provider and admins | MPS §10 quote accepted | — | — | — | ABSENT. Approval is refused while tax is pending (closure report Q-1), so it cannot occur yet |
| N-QTE-09 | Provider accepts an offer bound to other terms; request enters `awaiting_terms` → homeowner | **DEC-2026-063**; plan §699 | `vendor_accept_job` ([20261117001000…sql:949](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L949)) | Request lock. The gate row is share-locked when entering `awaiting_terms` | "Review this provider's terms — … Nothing is scheduled or charged until you accept them." Link `/dashboard` + request → terms review. **No test asserts the row** | INCOMPLETE (evidence). **Gate `offer_terms` off:** no new other-terms offer is created ([20261117001000…sql:464](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L464)), and a pending one can't be accepted ([…sql:849](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L849), `offer_terms:inactive`; SQL 116:335). So while it is off, this row is not written. Requests already in `awaiting_terms` stay there |
| N-QTE-10 | Homeowner's keyed accept or decline of that terms row → the terms' provider | **DEC-2026-063**; plan §699 | `homeowner_respond_offer_terms` ([20261118001000…sql:926](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L926)) | Request lock. `(request, response_key)` replay returns **before** notifying. "Already answered" refusal. `_expected` = terms ID + `consent_hash` | Accept: "… The service is scheduled." Decline: "… no longer assigned to you." **No vendor readback; no test asserts the row** | INCOMPLETE: approved notice not readable by its recipient (G1-01) and untested (G2-01). **Not gated:** this function has no gate check. Terms the provider accepted before switch-off can still be answered ([SQL 116:338](../supabase/tests/116_o10_offer_bound_terms.sql#L338)), and the answer writes this row. Whether any such request exists in production was **not checked** (no hosted query) |
| N-QTE-11 | The re-match after a decline fails (recorded) → admins | DEC-2026-063 forward fix (plan §11) | `private.offer_terms_rematch` ([20261118001000…sql:77](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L77)) | Failure row append-only | Retry from Offers at other terms (queue). No admin readback | UNDOCUMENTED channel; queue is the authority. **Not gated:** it follows any decline under N-QTE-10. The operator retry runs "whether or not the offer_terms gate is on" ([20261118001000…sql:11](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L11)) |
| N-QTE-12 | Terms unanswered for 24 h → operations | DEC-2026-063 ("Operations sees unanswered terms after 24 hours") | `admin_offer_terms_queue` ([AdminOfferTermsQueue.tsx:47](../src/components/admin/AdminOfferTermsQueue.tsx#L47)) | Read-only queue; "Nothing changes automatically" | Not a message, by decision. No automatic timeout or reminder | ALIGNED |

### 5.4 Appointments and rescheduling (APT)

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-APT-01 | Operator records or changes the appointment → homeowner and assigned provider | MPS §6.3 "both parties see the same confirmed time"; D-3/E1 | `admin_record_appointment` ([20261102001000…sql:551](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql#L551)) | Request lock; `(job, operation_key)` replay; `appointment-concurrency.mjs` asserts 2 rows under concurrency | Eastern label (EDT/EST) + **operator reason verbatim**. Link `/notifications` (homeowner-only). SQL 092:105–161 | Homeowner ALIGNED; provider INCOMPLETE (no readback; link redirects a vendor) |
| N-APT-02 | Homeowner, provider or operator records a reschedule request → homeowner, provider, admins | CFG-006; DEC-2026-053 E2/E3 | `record_job_operation` ([20261102001000…sql:356](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql#L356)) | Request lock; `unique (job_id, operation_key)`; replay returns before notifying | "Service update — reschedule request: <actor's reason>". The proposed time is not in the text. **The actor's free text goes to the other party.** Link `/notifications` | INCOMPLETE (vendor readback, link, untested title); G3-05 |
| N-APT-03 | Homeowner answers a provider-proposed time → provider, admins | DEC-2026-053 E3 | `respond_to_reschedule_request` ([…resolutions.sql:460](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql#L460)) | Lock; `response_key` replay | "The appointment changes when Mercurius records it." Link `/notifications` | INCOMPLETE |

### 5.5 Service lifecycle, disputes, reviews and support (FUL, SUP)

All `transition_job_status` rows: per-request advisory lock + `FOR UPDATE`; same-status transition refused (`Duplicate job transition`).

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-FUL-01 | → `in_progress` (paid, or admin exception, DEC-2026-050 A) → homeowner | MPS §10 job started | `transition_job_status` ([20261101001000…sql:522](../supabase/migrations/20261101001000_phase6_exceptions.sql#L522)) | Transition guards | "Your pro has started work". Untested title | INCOMPLETE (evidence) |
| N-FUL-02 | → `vendor_completed` → homeowner | MPS §6.4; DEC-2026-006 | Same (:530) | Same | "Please confirm or report an issue … silence does not confirm completion." SQL 062:124 | ALIGNED |
| N-FUL-03 | → `homeowner_confirmed` → provider | MPS §10 | Same (:535) | Same | "Payout is handled separately." No vendor readback | INCOMPLETE |
| N-FUL-04 | → `completed` → homeowner and provider | MPS §10 | Same (:540, :545) | Same | Untested titles; no vendor readback | INCOMPLETE |
| N-FUL-05 | Batch: completion notice due → homeowner | DEC-2026-006; MPS §10 confirmation reminder | `run_lifecycle_batch` ([20260904007000…sql:38](../supabase/migrations/20260904007000_phase4_confirmation_schedule.sql#L38)) | Global advisory lock; run-ID replay; `confirmation_sent_at` | SQL 003:55–60 | INCOMPLETE: scheduler inactive (DEC-2026-003/004/010) |
| N-FUL-06 | Batch: 72 h without answer → admins + homeowner | DEC-2026-006 | Same (:64, :69) | Same; failure rolls back (SQL 003:63–76) | "do not treat silence as confirmation". SQL 003:60 | Homeowner ALIGNED in source; admins UNDOCUMENTED; inactive |
| N-FUL-07 | Exception recorded (`no_show`, `unable_to_complete`, `customer_unavailable`, `partial_completion`) → homeowner, provider, admins | MPS §6.4; DEC-2026-053 E9/E10 | `record_job_operation` (:356) | As N-APT-02 | "Service update — <kind>: <actor's reason>". Link `/notifications` | INCOMPLETE; G3-05 |
| N-FUL-08 | Any other transition to `scheduled` → homeowner | — | `transition_job_status` (:526) | Transition guards | "Your job is confirmed and scheduled" | UNDOCUMENTED (reachable through admin transitions; overlaps N-REQ-03) |
| N-FUL-09 | Homeowner raises a dispute within 48 h → homeowner; admins | MPS §6.6, §10; DEC-2026-009/054 | `homeowner_raise_dispute(uuid,text)` ([20260904002000…sql:43](../supabase/migrations/20260904002000_phase4_dispute_tickets.sql#L43), [:45](../supabase/migrations/20260904002000_phase4_dispute_tickets.sql#L45)) via the cs9 wrapper | Request lock; `disputed` transition guard | Homeowner "Dispute received"; admins get the homeowner's reason. **Provider is not notified** (consistent with DEC-2026-054: providers don't see homeowner tickets) | Homeowner INCOMPLETE (untested title) |
| N-FUL-10 | Operator updates or resolves the dispute → homeowner | MPS §10 dispute updated/resolved | `admin_resolve_dispute` (:77) | Request lock; duplicate transition refused | Body is the **operator's notes verbatim**. Untested title | INCOMPLETE; G3-05 |
| N-FUL-11 | Homeowner appeals → admins | DEC-2026-009 | `appeal_dispute_resolution(uuid,text)` (:102) via the versioned wrapper | Wrapper replay by resolution version | No admin readback | UNDOCUMENTED |
| N-FUL-12 | Operator moderates a review → review author | DEC-2026-052 | `moderate_job_review` ([20261031001000…sql:245](../supabase/migrations/20261031001000_phase6_reviews.sql#L245)) | Row lock; expected version; same-state refusal | Criterion label + operator reason. SQL 100:222 | ALIGNED |
| N-SUP-01 | Ticket opened → admins | CFG-010; MPS §10 support acknowledgement | `open_support_ticket` ([20261103001000…sql:219](../supabase/migrations/20261103001000_phase6_support_disputes.sql#L219)) | Advisory lock per user + `request_key`; replay before notify | Subject in body. **No acknowledgement notice to the requester** (screen only). No admin readback | UNDOCUMENTED (admin); acknowledgement ABSENT as a message |
| N-SUP-02 | Requester replies → admins | CFG-010 | `post_support_message` (:261) | Message key; not on replay | No admin readback | UNDOCUMENTED |
| N-SUP-03 | Operations replies → ticket owner | MPS §10 support response | Same (:264) | Same | "Mercurius replied on <ticket>", link `/support`. Homeowner readable; a vendor ticket owner is not. Untested title | INCOMPLETE |
| N-SUP-04 | Contact form saved → owner inbox | TRACE-104 email table; MTS §5 l.78 | [contact-submissions/route.ts:113](../src/app/api/contact-submissions/route.ts#L113) | **No attempt record or key** | Includes submitter PII (owner inbox only); `reply_to` = submitter | INCOMPLETE. Gap G1-02 |

### 5.6 Cancellations, replacements, refunds and payment outcomes (CXL)

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-CXL-01 | Homeowner or operator records a customer cancellation → homeowner and provider ("Job cancelled") **and** homeowner, provider and admins ("Service update") | CFG-006; DEC-2026-053 E1/E12 | `record_job_operation` (:356) calls `transition_job_status('cancelled')` (20261101001000:550, :553) | Operation key; one transaction | **Two rows per participant for one cancellation.** Neither states the refund outcome. SQL 101 tests the operation, not the notices | INCOMPLETE: CFG-006 needs evidence that notifications match the outcome (G2-03); duplicate is G3-04 |
| N-CXL-02 | Provider cancels, or operator records no-show → homeowner, provider (the withdrawing one), admins; next provider gets N-REQ-01 unless a visit or within 24 h | CFG-007; DEC-2026-053 E5/E7 | `record_job_operation` (:356) | Operation key; request lock | "Service update — provider cancel: <reason>" | INCOMPLETE |
| N-CXL-03 | A replacement provider accepts the replacement offer → homeowner; admins | DEC-2026-053 E5 | `vendor_accept_job` (20261117001000:927, :931) | Request lock | "Nothing is scheduled until you accept both." Untested titles | Homeowner INCOMPLETE (evidence); admins UNDOCUMENTED |
| N-CXL-04 | Operator proposes replacement provider and time → homeowner | DEC-2026-053 E5 | `admin_propose_replacement` ([20261102001000…sql:842](../supabase/migrations/20261102001000_phase6_exception_resolutions.sql#L842)) | `proposal_key` replay; request lock | "Nothing is scheduled until you accept." `exception-resolutions.spec.ts` and `.test.ts` | ALIGNED |
| N-CXL-05 | Homeowner accepts or declines the replacement → provider; admins | E5 | `homeowner_respond_replacement` ([20261118001000…sql:839](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L839)) | `response_key` replay before notify | Untested titles (SQL 027's "Replacement accepted" is an unrelated reconciliation reason) | INCOMPLETE (vendor readback, evidence) |
| N-CXL-06 | Operator accepts a later waiver → homeowner | DEC-2026-053 E11; CFG-006 waiver | `admin_record_waiver_adjustment` (20261102001000:1316) | `adjustment_key` replay | "Any additional refund is reviewed separately before it is sent." Untested | INCOMPLETE (evidence) |
| N-CXL-07 | Payment captured, failed or refunded → homeowner | MPS §10; CFG-015 (queue only) | — (money functions write no notices) | — | — | ABSENT. Payments not activated (R1). Channel is owner policy (G3-01) |
| N-CXL-08 | Payout scheduled, paid or failed → provider | MPS §10; DEC-2026-056 display | — (vendor earnings page shows state) | — | — | ABSENT. Payouts not activated |

### 5.7 Recurring visits and Credits (REC, CRD)

| ID | Trigger → recipient · isolation | Authority | Producer → record | Dedupe / txn / concurrency | Copy / meaning · readback · tests | Status and gap |
|---|---|---|---|---|---|---|
| N-REC-01 | Operator creates a visit (proposal or cadence) → homeowner; plan provider gets N-REQ-01 | DEC-2026-049 items 1–4 | `private.create_recurring_visit_core` ([20261026002000…sql:351](../supabase/migrations/20261026002000_phase6_recurring_cadence.sql#L351)) | Series lock; `operation_key` generation replay | "The provider accepts each visit separately." SQL 095:210–214, 096:327/475 | ALIGNED |
| N-REC-02 | Homeowner asks to stop future visits → homeowner; admins | DEC-2026-053 E8 | `homeowner_request_plan_stop` (20261102001000:1126, :1130) | `request_key` replay | "nothing is cancelled by this request". Untested titles | INCOMPLETE (evidence) |
| N-REC-03 | Operator closes the stop request without stopping → homeowner | E8 | `admin_close_plan_stop_request` (:1165) | Series lock; already-closed refusal | Operator resolution verbatim | INCOMPLETE (evidence); G3-05 |
| N-REC-04 | Accepted visit unpaid at appointment − 24 h | DEC-2026-049 item 5 (operations queue; "nothing cancels automatically") | Queue only | — | SQL 097:495 asserts **no** payment notices | ALIGNED (no notice by decision) |
| N-REC-05 | Pause, resume, stop future visits, anchor and skip | DEC-2026-049 item 4 | None | — | PHASE-6-RECURRING-VISITS line 161: these send no notification | ALIGNED as built; no authority requires a notice |
| N-CRD-01 | Credits earned, corrected or redeemed | R1 gate; DEC-2026-022 ("Credits … authority artifacts remain absent") | — | — | — | ABSENT. No authority to characterize; nothing planned |

### 5.8 Pricing notices to vendors (PRC) — outside the requested families, listed for completeness

| ID | Event | Producer | Notes | Status |
|---|---|---|---|---|
| N-PRC-01 | Operator sends a price draft for approval → linked vendor in-app, or the contact email on file (DEC-2026-041 item 6) | `admin_send_package_draft` ([20261018006000…sql:1010](../supabase/migrations/20261018006000_promotion_selection.sql#L1010)); email §4.2 | Dedupe for a resend checks whether the vendor's earlier row is still **unread**: recipient-controlled state. Vendor also sees the Price Approvals panel. SQL 080, 083, 087; `draft-email-notices.test.ts` | INCOMPLETE (in-app notice not readable) |
| N-PRC-02 | Vendor-funded promotion sent for approval → vendor | `admin_send_promotion_for_vendor_approval` ([20261018003000…sql:396](../supabase/migrations/20261018003000_promotion_offers.sql#L396)) | Promotions gate closed | INCOMPLETE |
| N-PRC-03 | Operator pauses a package → vendor | `admin_suspend_package` ([20261018004000…sql:452](../supabase/migrations/20261018004000_pricing_owner_decisions.sql#L452)) | Reason shown; the operator form says "The vendor will see it" | INCOMPLETE |
| N-PRC-04 | Operator publishes a price → vendor | `admin_publish_package_draft` ([20261030001000…sql:144](../supabase/migrations/20261030001000_pest_catalog_services.sql#L144)) | SQL 091, 099 | INCOMPLETE |

DEC-2026-034's correction notice no longer has a producer. Corrections are refused under DEC-2026-041 item 4 (SQL 079:91 asserts no notice). This is consistent with the decision, not a gap.

---

## 6. MPS §10 coverage

| MPS §10 group | Producers today | Channel decided? |
|---|---|---|
| Account/invite verification | N-APP-03, N-APP-04 (Auth email) | Only through Phase 5 decisions on invitations |
| Request submission and coverage outcome | Screen only (N-REQ-06) | No |
| Provider offer and expiry reminder | Offer N-REQ-01; reminder ABSENT | No; reminders inactive (DEC-2026-010) |
| Match acceptance/decline/exhaustion | Acceptance N-REQ-03; decline/exhaustion ABSENT | No |
| Quote received/revised/expiring/accepted/declined | Received N-QTE-03; expired N-QTE-06 (inactive); declined → admins; accepted ABSENT; "expiring" reminder ABSENT | No |
| Schedule confirmation/change/cancellation | N-APT-01..03, N-CXL-01 | No |
| Job started/completed/confirmation reminder | N-FUL-01..06 (reminder inactive) | No |
| Payment success/failure/refund | ABSENT | No |
| Dispute opened/updated/resolved | N-FUL-09..11 (provider not notified) | No |
| Payout scheduled/paid/failed | ABSENT | No |
| Support acknowledgement and response | Response N-SUP-03; acknowledgement on screen only | No |

The only explicit channel decisions are DEC-2026-063 (in-app, offer terms) and DEC-2026-041 item 6 (email to an unlinked vendor). MPS §10 asks for "a required channel and fallback" for every group. That definition is an owner decision (G3-01). This document does not supply it.

---

## 7. Gap classification

### 7.1 Category 1 — required by an approved decision, missing

| Gap | Events | Authority | Notes |
|---|---|---|---|
| **G1-01** Vendors cannot read in-app notifications addressed to them | N-QTE-10 (DEC-2026-063 provider notice) and every vendor row: N-REQ-01, N-QTE-02/04, N-APT-01..03, N-FUL-03/04/07, N-CXL-01/02/05, N-PRC-01..04 | DEC-2026-063 / plan §699 ("In-app notifications … to the provider"); DEC-2026-041 item 6 (in-app notice when linked); MTS §6 l.150 (visible to participants) | No migration needed: RLS already lets a vendor read and mark their own rows. Includes the `/notifications` and `/vendor/requests` link targets that a vendor cannot open. **Proposed for 7.2B** |
| **G1-02** Contact-form and renewal-document owner emails have no durable attempt record, idempotency key or recovery | N-SUP-04, N-APP-05 | MTS §5 l.78; R0-VENDOR-READINESS "follow-up" | Shares the sender and outcome helpers with N-APP-01. 7.1 (#162) is now merged, so it can be planned on `main` with 7.1's logger (§10) |

### 7.2 Category 2 — implemented, evidence inadequate

| Gap | Events | Missing evidence |
|---|---|---|
| **G2-01** DEC-2026-063 producers have no assertion of their rows | N-QTE-09, N-QTE-10, N-QTE-11 | Row per recipient; no row to other parties; key replay writes none; concurrent responses write one. Gate off: no N-QTE-09 row, but an answer to terms accepted before switch-off still writes N-QTE-10 (and N-QTE-11 on a failed re-match). Folded into 7.2B |
| **G2-02** Many titles have no test | N-FUL-01/03/04, N-FUL-09/10, N-QTE-02/06, N-CXL-03/05/06, N-REC-02/03, N-SUP-03, N-APT-02/03 | Per-event recipient and isolation assertions |
| **G2-03** CFG-006 consistency of notifications | N-CXL-01, N-APT-02, N-CXL-06 | Boundary and waiver tests that compare notice content with policy outcome. Today the notices are silent on refund outcome |
| **G2-04** Homeowner notification UI has no browser test | §4.1 | Loading, empty, error/retry, mark read, mark all, realtime-unavailable, keyboard, axe, 320 px |
| **G2-05** Known copy defect in a fingerprinted function | N-REQ-03 | Phase 6 carry. Changing it restates `vendor_accept_job`, a money-fingerprinted function, so it needs its own reviewed slice |
| **G2-06** Hosted parity not verified | §4.1 | Hosted grants, policies, realtime publication; whether `record_match_offer` has a hosted trigger; whether `vendor-application-notify` is still deployed. Needs a read-only, owner-authorized readback |

### 7.3 Category 3 — owner policy decisions (proposals only)

| Gap | Question |
|---|---|
| G3-01 | MPS §10 channel and fallback per event group (in-app only, email, both), including payment, payout and exhaustion notices |
| G3-02 | Reminders (offer expiry, quote expiring, confirmation reminder) and quiet hours: none approved; DEC-2026-010 keeps timing inactive |
| G3-03 | Admin in-app rows: keep writing them, build an admin readback, or stop them. Queues are the approved operator surface |
| G3-04 | Customer cancellation writes two notices per participant (N-CXL-01). Keep both, or one with an approved text |
| G3-05 | Free text in recipient notices: operator reasons and notes (appointments, dispute notes, waivers, stop closures) and the **actor's** reason in `record_job_operation` go verbatim to the other party. Approve, restrict, or template. **Also a 7.2B dependency:** vendor readback would show these reasons to vendors for the first time (N-APT-01..03, N-FUL-07, N-CXL-01/02). A date cutoff (G3-07) does not help, because new notices carry the same text |
| G3-06 | Notification retention class (CFG-011 "platform messages" 3 years?) and whether recipients may delete rows |
| G3-07 | Showing historical vendor rows when vendor readback ships (rows from earlier producers may carry outdated copy) (7.2B decision B2) |
| G3-08 | MPS §8 "Test notification received": what the test notification is, and on which channel |
| G3-09 | Decommission the legacy `vendor-application-notify` Edge function (hosted action) |

### 7.4 Category 4 — later slices

- Resend delivery events (delivered, bounced, complained), suppression wiring, domain SPF/DKIM/DMARC evidence (roadmap Phase 7; MTS §7).
- Monitoring and alerts on failed, unknown or unrecorded email outcomes; **CFG-011 90-day operational-log retention** (carried by 7.1 to the 7.6 observability and retention slice).
- Scheduler and worker activation (quote expiry, confirmation reminder, escalation). Needs separate activation approval.
- Automatic retry or reminder of any message: not approved.
- Hardening `public.notifications`: restrict recipient UPDATE to `read_at`; audit or remove direct admin INSERT; optional dedupe key per business event. All need a reviewed migration.
- Payment, payout and Credits notifications at R1 activation, after G3-01.

---

## 8. Acceptance criteria for actionable gaps

### G1-01 / G2-01 (vendor readback with DEC-2026-063 evidence; proposed 7.2B)

1. **Committed trigger.** A vendor sees only rows that already exist. A row appears only after its business transaction commits. A rolled-back command shows nothing (SQL 003's pattern for one DEC-2026-063 producer).
2. **Authorized recipient.** The signed-in vendor lists rows where `user_id = auth.uid()`, newest first, showing title, body and time. The list bound and the unread-count wording follow the choices in §9 R1–R4.
3. **Cross-account denial.**
   - In SQL: vendor A cannot select, update or delete vendor B's or a homeowner's rows; `anon` gets nothing; a vendor cannot set `read_at` on another user's row.
   - In the browser: a non-vendor is not shown the vendor page, and the homeowner page stays homeowner-only.
4. **Duplicate, concurrent and replayed events.**
   - A provider acceptance at other terms writes exactly one homeowner row.
   - A homeowner response writes exactly one provider row.
   - Replaying the same `response_key` writes no new row.
   - N concurrent responses with different keys produce one response and one provider row.
   - No row goes to another provider.
   - **Gate off (preserve SQL 116:332–339):**
     - no new other-terms offer, no provider acceptance into `awaiting_terms`, no N-QTE-09 row;
     - a homeowner answer to terms accepted **before** switch-off still succeeds and writes exactly one N-QTE-10 row;
     - a decline whose re-match fails writes N-QTE-11.
     
     Tests must assert this behavior and must not expect "no rows while off".
5. **Safe copy.** No new copy in producers. The page shows stored text as text, never as HTML. Links resolve only to local paths:
   - a vendor `/vendor/*` link is kept;
   - `/notifications`, `/vendor/requests` or a non-vendor link on a request-related row goes to `/vendor/jobs`;
   - anything else goes to `/vendor`;
   - external, protocol-relative and backslash links are dropped.
   Homeowner destinations are unchanged.
6. **Durable state.** Opening a row sets `read_at` once (`is null` guard). Mark all sets only the caller's rows, within the scope chosen under §9 R3. A failed update shows an error and reloads. No other column changes.
7. **Recovery.** A load failure shows an error with retry. A realtime failure shows the existing "temporarily unavailable" notice; refresh still works.
8. **UI states and accessibility** (MDS; light mode only, DEC-2026-026):
   - loading with an accessible name;
   - empty state with vendor wording that promises nothing;
   - error with retry;
   - unread marker not conveyed by color alone (bold title and text count);
   - keyboard reachable rows (buttons) with visible focus;
   - nav item with `aria-current`;
   - axe clean at 320 px and 1440 px;
   - no horizontal scroll at 320 px.
   A2 human checks stay carried.

### G1-02 (owner-email ledger; proposed 7.2C, 7.1 now merged)

- An attempt record is created atomically with the contact submission or renewal record, and an owner email is claimed at most once per permitted attempt.
- A Resend idempotency key per attempt.
- Outcome recorded as sent, failed, unknown or unrecorded, with the same classification as N-APP-01.
- Operator readback and resend with confirmation for unknown.
- Concurrency: concurrent claims produce one claim.
- No PII in logs, using 7.1's logger.
- The submitter's success never depends on the email.
- Migration needed; hosted push under DEC-2026-037.

### G2-03 (CFG-006 notification consistency)

For each CFG-006 boundary (72 h, 24 h; reschedule 48 h, 24 h) and each waiver, the recipient's notice text and the stored policy assessment must name the same outcome, or the notice must say nothing about money and point to the readback. **The choice is G3-04/G3-05 copy policy.**

---

## 9. Proposed 7.2B — vendor in-app notification readback (proposal; approves nothing)

**Why this slice.**
- It closes an approved-decision gap (G1-01: DEC-2026-063 provider notices; also DEC-2026-041 item 6's in-app path and every other vendor row).
- It needs no migration, does not touch producers or fingerprinted money functions, and does not touch 7.1's files.
- It is fully reversible.

**Alternatives not chosen first:**
- G2-05 copy fix: restates a fingerprinted function, so it needs a finance-scoped review.
- G1-02 ledger: needs a migration and the hosted push procedure. Proposed as 7.2C; its 7.1 dependency is now satisfied.
- Admin readback: no authority (G3-03).
- Table hardening: migration; later.

**Scope.**
1. New page `src/app/vendor/notifications/page.tsx`. It sits inside the existing vendor layout and role guard, uses `NotificationItem`, and offers mark read and mark all read. It is built on `useNotifications` only as far as the readback choices below allow.
2. `src/components/vendor/VendorSidebar.tsx`: a "Notifications" nav item. **Codex's B1 architectural recommendation:** place it immediately after Jobs & Requests, before Messages.
3. New `src/lib/notificationDestination.ts`: role-aware link mapping (§8 item 5), extracted from `src/app/(homeowner)/notifications/page.tsx`, which then imports it with identical homeowner results.
4. No SQL, migration, producer, copy, grant, realtime, email or flag change. The `offer_terms` gate stays off.

**Existing hook behavior (characterized, unchanged by 7.2A).** Reusing `useNotifications` as it is does **not** show a vendor every historical notice.
- **List.** It loads only the newest `limit` rows ([useNotifications.ts:50](../src/hooks/useNotifications.ts#L50)): 20 in the header ([Header.tsx:109](../src/components/layout/Header.tsx#L109)), 100 on the homeowner page ([page.tsx:69](../src/app/%28homeowner%29/notifications/page.tsx#L69)). There is no pagination.
- **Unread count.** Computed from the loaded rows only ([useNotifications.ts:164](../src/hooks/useNotifications.ts#L164)). Unread rows beyond the limit are not counted, and the page's "N unread updates" wording can understate.
- **Mark all.** Updates **every** unread row for the caller, with no limit ([useNotifications.ts:153](../src/hooks/useNotifications.ts#L153)), including rows the user never saw.

**Readback choices for 7.2B.** These are proposed implementation choices, not approved product policy; Codex or the owner confirm them before implementation.

| Choice | Options | Proposal |
|---|---|---|
| R1 List bound | (a) an explicit bounded list (e.g. newest 100) with wording that says older notices aren't shown; (b) keyset pagination ("Load older") on `created_at, id` | (b), or (a) if it is labelled, so nothing is silently hidden |
| R2 Unread count | (a) count of loaded rows, worded "unread in this list"; (b) an exact count from a separate `count`/`head` query on `read_at is null` | (b), so the nav and page say the true number; with R4 it counts only in-scope rows |
| R3 Mark all scope | (a) every unread row, as today; (b) only rows loaded and visible; (c) every unread row within the cutoff window (R4) | (b) or (c); "all" must never mark rows outside what the page says it covers. Wording follows the choice |
| R4 Historical cutoff (B2) | none, or a `created_at >= cutoff` read filter | Owner decision. If chosen, the **same** filter applies to listing, unread count and mark all. Rows before the cutoff are neither shown, counted nor marked read. It changes no data |

The homeowner page keeps its current behavior unless Codex asks for the same corrections there. That would be a separate, explicit change.

**Free-text dependency (G3-05).** Several vendor notices carry an actor's or operator's reason verbatim (N-APT-01..03, N-FUL-07, N-CXL-01/02). Vendor readback would show this text to vendors for the first time. A date cutoff hides old rows but **does not** cover new notices produced with the same reason text. G3-05 should be answered before or with 7.2B. Possible answers:
- accept the disclosure;
- restrict what reasons may contain;
- template the producers' copy (a producer change, so a separate slice).

**Tests.**
- `tests/unit/notification-destination.test.ts`: homeowner parity, vendor mapping and unsafe links.
- `supabase/tests/119_vendor_notification_readback.sql`:
  - RLS isolation, §8 item 3;
  - DEC-2026-063 rows, §8 item 4, with the gate toggled only inside the test transaction as SQL 116 does, **including the switch-off case**: a pending answer still writes the provider row.
- Optional: notification-count assertions added to `scripts/offer-terms-concurrency.mjs`.
- `tests/e2e/vendor-notifications.spec.ts`: §8 items 5–8 with the repository's existing Supabase stubs. It also covers R1–R4 as chosen:
  - more rows than the bound;
  - exact unread count;
  - mark-all scope;
  - cutoff, if any.
- Full unit, SQL and browser suites; typecheck, lint, secret scan, build.

**Dependencies.**
- 7.1 (#162) is merged, and 7.2B shares no file with it. Build from the then-current `main`.
- B1 confirmed, B2 answered, R1–R4 chosen, and G3-05 answered or accepted as a known disclosure.
- A2 human checks remain carried.

**Rollout.**
- Merge to `main` deploys to production (DEC-2026-037).
- No hosted migration push.
- Vendors see their existing rows **within the chosen bound and cutoff** (R1, R4). Without a cutoff that includes rows from earlier producers, which may carry outdated copy (for example, the dormant 24-hour offer text, if it ever ran in hosted).

**Rollback.** Revert the commit. Read markers set by vendors stay; they are harmless.

**Decisions needed before implementation.**
- **B1 (architecture): Codex recommends "Notifications" immediately after Jobs & Requests, before Messages.** It is recorded as Codex's recommendation for 7.2B.
- **B2 (owner, G3-07): NOT DECIDED.** Show all historical vendor rows, or only rows created after a cutoff date (R4). A cutoff is a read filter, not a data change.
  - Proposed input: one read-only hosted aggregate of vendor-recipient rows, **counts by `type` and month only**.
  - It must not read or return titles, bodies, links, user or provider identities, request IDs or any free text.
  - It needs the owner's authorization and **has not been run**.
- **R1–R4** (above): implementation choices for Codex/owner confirmation.
- **G3-05:** owner decision on free-text disclosure (above).
- None of these decisions changes channels or delivery policy.


**Update 2026-11-11 (7.2B, TRACE-153).** The text above is kept as proposed. Since then:
- the owner answered B2/G3-07 (all historical vendor notices, no cutoff) and G3-05 for the vendor readback (standard wording with links, no raw reasons): [DEC-2026-065](DECISION-LOG.md);
- Codex confirmed B1, R1 (b), R2 (b) and R3 (b) ("Mark visible as read");
- the type-and-month hosted aggregate was **not** run and is not authorized.

Implementation and evidence: [PHASE-7-VENDOR-NOTIFICATION-READBACK](PHASE-7-VENDOR-NOTIFICATION-READBACK.md). Two differences from the scope list above:
- the vendor page uses its own hook and row component, so homeowner behavior is unchanged;
- item 5's "shows stored text" is superseded by DEC-2026-065: the vendor page shows controlled wording only.
---

## 10. 7.1 (#162) — merged

- **History.** At the original checkpoint #162 was open (§1). This record said that if it merged during review, the new `main` SHA would be recorded and N-APP-01 rechecked. It merged as `11c05b0`.
- **What it changed:** N-APP-01 only:
  - `src/lib/applicationNotifications.ts`;
  - the two application routes;
  - the new `src/lib/observability/operationalLog.ts`;
  - `tests/unit/application-notification-tracing.test.ts`;
  - `scripts/application-notification-concurrency.mjs` and its CI step.
- **What it left alone:** the outcome classification (sent, failed, unknown, unrecorded) and the ledger. N-APP-01 is updated with the moved references and the new evidence (§5.1). No other row changes.
- **Overlap with this slice.** This slice touches none of those files, and the proposed 7.2B touches none of them either. TRACE-151 and TRACE-152 are both kept, in ID order.
- **7.2C.** G1-02 would reuse the shared sender and `outcomeState` ([applicationNotifications.ts:87](../src/lib/applicationNotifications.ts#L87)), and should use 7.1's logger. Its 7.1 dependency is now satisfied. It must be verified on the combined `main`.
- **Missing operational logs are inconclusive.** The durable notification ledger decides whether an attempt occurred and whether recovery is permitted (7.1 §7). The same rule applies to in-app rows: the `public.notifications` row and the business record are the evidence, never a log line.

---

## 11. Carried register and boundaries (unchanged by this slice)

- **CFG-011:** 90-day operational-log retention not met (no drain or exporter; host retention unverified). Assigned to the later 7.6 observability and retention slice.
- **A2 human verification** (screen reader, real devices, keyboard, 200% zoom and 320 px reflow, `@visual` on Windows): NOT PERFORMED; booking-readiness register.
- **Final applicable schema and grants, money fingerprint and completion-integrity checks** on the final candidate: open; booking-readiness register.
- **Main CI `9067f96`, one failed browser test** (`mds.spec.ts:50`, §1): historical and **undiagnosed**. Newer main CI on `11c05b0` passed (42952294566). That is not a diagnosis or a repair; a recurrence should be investigated.
- `offer_terms` and promotions gates **off**. No activation inferred.
- DEC-2026-064 stays limited to CS-4, CS-3 and O-10 finance review. No new finance review, human test, hosted alignment or release acceptance is claimed.
- No channel, quiet hours, reminder timing, fallback, suppression, escalation or retry policy was invented. Commission and fees are untouched.

---

## 12. Validation

| Check | Result |
|---|---|
| Diff contains documentation only | PASS: `governance/PHASE-7-NOTIFICATION-CONTRACT.md` (new) and the TRACE-152 `governance/TRACEABILITY.md` row; no other path (against `main` `11c05b0`) |
| Matrix complete against discovered producers | Every one of the 33 live producer functions maps to at least one event: create_job_offer_internal (REQ-01), create_recurring_visit_core (REC-01), expire_request_quotes (QTE-06), offer_terms_rematch (QTE-11), transition_job_status (QTE-07, FUL-01..04, FUL-08, CXL-01), admin_close_plan_stop_request (REC-03), admin_propose_replacement (CXL-04), admin_publish_package_draft (PRC-04), admin_record_appointment (APT-01), admin_record_waiver_adjustment (CXL-06), admin_resolve_dispute (FUL-10), admin_return_quote_proposal (QTE-02), admin_send_itemized_quote (QTE-03/04), admin_send_package_draft (PRC-01), admin_send_promotion_for_vendor_approval (PRC-02), admin_suspend_package (PRC-03), appeal_dispute_resolution (FUL-11), homeowner_raise_dispute (FUL-09), homeowner_request_plan_stop (REC-02), homeowner_respond_offer_terms (QTE-10), homeowner_respond_replacement (CXL-05), homeowner_respond_to_quote (QTE-05), moderate_job_review (FUL-12), notify_admins_new_vendor_application (APP-02), open_support_ticket (SUP-01), post_support_message (SUP-02/03), record_job_operation (APT-02, FUL-07, CXL-01/02), record_match_offer (REQ-05), respond_to_reschedule_request (APT-03), run_lifecycle_batch (FUL-05/06), vendor_accept_job (REQ-03, QTE-09, CXL-03), vendor_propose_quote (QTE-01). All six email or Auth paths map to APP-01/03/04/05/06, SUP-04 and PRC-01 |
| Source references | Each migration reference was checked to fall inside the last `CREATE [OR REPLACE] FUNCTION` block and to contain the live title (scripted comparison with `pg_get_functiondef` on the local replay). Links were checked to resolve to existing files |
| Consistency with decisions | DEC-2026-063 producers and gate; DEC-2026-041 item 6; DEC-2026-006/008/010; CFG-006/009/011/015; DEC-2026-053 E5/E8/E11; DEC-2026-049 items 4–5 |
| Link check (rerun at `11c05b0`) | Every relative link resolves to an existing file and an in-range line; each linked migration line is a notification write, gate check, table, trigger or policy definition; each linked `src/` line was read to carry the cited construct. 21 further unlinked `file:line` citations were checked to be `notify_user(` calls. Counts are in the PR |
| `node scripts/scan-secrets.mjs` (`npm run scan:secrets`) | PASS: "no known credential patterns detected" |
| **Not performed** | Application tests, build, lint or typecheck (no code changed; none claimed). Any hosted query, log readback or Resend check. Re-running main CI. Browser rendering of any notification UI |

---

## 13. Handoff (7.2A)

- **Base:** `main` `11c05b0` (original inspection at `9067f96`). **Head:** the commit on `claude/phase7-2a-notification-contract` named in the PR.
- **Scope:** characterization and planning only (TRACE-152).
- **Evidence:** §2–§6 and §12.
- **Unresolved gates:** §11, plus:
  - owner decisions G3-01..09;
  - B2 (not decided);
  - R1–R4 confirmation;
  - G3-05 before or with 7.2B.
  B1 has Codex's recommendation.
- **Next action:**
  1. Codex's final review of this revision.
  2. The owner answers B2, authorizes or declines the type-and-month count, and answers G3-05.
  3. Codex or the owner confirm R1–R4.
  4. Implement 7.2B from the then-current `main`.
  5. Plan G1-02 (7.2C).

---

## 14. Codex review findings (earlier head `b5f2fe2`, reviewed outside GitHub) and resolutions

| # | Finding | Resolution in this revision |
|---|---|---|
| 1 | Baseline and 7.1 references stale after #162 merged | Reconciliation checkpoint `11c05b0` recorded beside the original `9067f96` (header, §1). 7.1 marked merged (§10). N-APP-01 now cites 7.1's logger, concurrency script and tracing tests. References moved: idempotency key `applicationNotifications.ts` 57 → 65; delivery helper 65 → 92; `vendor-applications/route.ts` `after()` 355 → 393. The `9067f96` CI failure is kept historical and undiagnosed; newer main CI recorded as passing, without a claim of diagnosis or repair. TRACE-151 ordered before TRACE-152 |
| 2 | Blanket "none of the three DEC-2026-063 notices can be produced while `offer_terms` is off" was wrong | Removed (§0, index, §5.3, G2-01, §8 item 4). Off prevents new other-terms offers and new entry into `awaiting_terms` (N-QTE-09). An answer to terms accepted before switch-off still succeeds and writes N-QTE-10, and can lead to N-QTE-11. Verified against SQL 116:332–339 and the live functions: `homeowner_respond_offer_terms` has no gate check; `vendor_accept_job` refuses with `offer_terms:inactive`. Proposed tests must preserve this |
| 3 | "Reusing the hook exposes every historical notice" was inaccurate | §9 characterizes the hook: a bounded list (limit), unread count from loaded rows only, mark all over every unread row. Proposed choices R1 (bound or pagination), R2 (count and wording), R3 (mark-all scope) and R4 (cutoff applied to list, count and mark all) are listed as unresolved proposals |
| 4 | "No homeowner or vendor transactional email exists" was inaccurate | §0 now separates the absent service-lifecycle email from the existing account (Auth), invitation (Auth) and price-draft (unlinked vendor) email |
| 5 | Proposed hosted aggregate included titles | Now counts by `type` and month only, with titles, bodies, links, identities, request IDs and free text excluded. Not run; owner authorization pending (§9 B2) |
| 6 | Free-text disclosure is a 7.2B dependency that a cutoff does not solve | Recorded in G3-05 and §9 |
| 7 | B1 recommendation | Recorded: Notifications immediately after Jobs & Requests, before Messages (§9). B2 stays an owner decision, not approved |
