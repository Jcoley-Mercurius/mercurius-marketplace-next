# Phase 6.13 — admin navigation, operational queues, audit history and controlled overrides (TRACE-136)

Date: 2026-11-02 (America/New_York). Branch `claude/phase6-13-admin-operations` from `main` `8bcbfbe`.
Characterization and brief only; no application or database change. These notes approve no policy.
Owner questions are DEC-2026-057 (PROPOSED, §7). PR #129 landed 2026-11-02 (`b1a8cc3`); this branch has merged it. Implementation starts from that base.

## 1. Checkpoint (verified 2026-11-02)

| Item | Evidence |
|---|---|
| `main` | `8bcbfbe` = PR #128 (6.11B). Before it: #127 (6.12A, `224395a`), #126 (6.11A, `475f03d`), #125 (6.10, `ad4656b`), #121 (6.9A/6.9B, `2dd9bed`). |
| PR #129 | 6.12B, head `c0a19ca`: open at characterization; **merged by the owner 2026-11-02** as `b1a8cc3`. Not merged by this slice. This branch merged `main` afterward, keeping #129's decisions (DEC-2026-056 approved) and evidence. |
| Hosted migrations | `supabase migration list --linked` (read-only): history ends at **`20261107001000`** (6.12B). `20261104001000`–`20261107001000` are applied, so the handoff's "not pushed" notes for 6.11A/6.11B/6.12A/6.12B are superseded. The 6.12B migration file is on `main` since #129. |
| Stale traceability | TRACE-131/132/133 rows still say "not merged"; all three are on `main` (#121, #125). Corrected in the closure checklist (§11), not by rewriting their history. |
| Local DB | 212 migrations (6.12B branch state); probes below ran there with synthetic users in one rolled-back transaction. |

Base decision: 6.13 touches admin pages and shared governance files but no 6.12B file (`/vendor/earnings`, `vendor_own_earnings`). It can start from `main` now with a later merge of `main`, or wait for #129. **Recommended:** implement from `main` after #129 merges, so the 6.12B migration and governance edits are on the base. No stacked base is assumed.

## 2. Authorities

- MPS §3 (admin queues and controlled overrides are core; Smart Picks deferred unless approved), §4 role contract (admin override "with reason"; release/hold funds = restricted finance authority; audit/support records least-privilege; navigation guards are not authorization), §6.2 (override preserves the pre-override result), §6.5 (manual financial changes: reason, immutable audit record, restricted role, second person for high risk), §6.6 (every open dispute and support request has owner, age, priority, next action), §8 (activation by an authorized operator with recorded evidence), **§9** (named queues; each override records actor, time, reason code, detail, before/after, communication, related financial event).
- CFG-001 (ZIP allowlist authoritative; change authority = project owner), CFG-002 (every service stays visible), CFG-008, CFG-010, CFG-015 (queue items only; no automatic action).
- MDS §5 (Status, DataTable/ResponsiveDataList, ConfirmAction, OperationalQueue), §6 (remove Admin from public footer; admin groups), §7 (portal list/queue and detail templates), §8 (accessibility).
- MTS §6 (role checked in proxy, RLS, RPC; route-to-role matrix; record security-sensitive admin actions with actor, target, before/after, reason, request ID, time).
- DEC-2026-025 (Josh sole admin in R0; hosted has 2 admin role rows, both Josh's per the 2026-09-30 update), DEC-2026-045, DEC-2026-053, 6.10 contracts (TRACE-133).

## 3. Routes and navigation

The proxy (`src/proxy.ts`) gates `/admin/:path*` server-side with `auth.getUser()` + `has_role(admin)`, fails closed and preserves `pathname+search` in the login redirect. The client layout repeats the check but redirects to `/login?redirect=/admin`, dropping the deep path (only reachable if the proxy is bypassed or the session expires client-side).

The sidebar is one flat "Platform" list of 25 entries (`AdminSidebar.tsx`). Proposed grouping follows MDS §6; entries MDS does not name are placed by task and flagged for review.

| Route | Current label | Proposed group | Data / writes (browser) |
|---|---|---|---|
| `/admin` | Overview | (top) | raw table counts (§4, F613-13) |
| `/admin/requests` | Service Requests | Marketplace Operations | queues + list; RPC commands; **direct** `service_requests.update(notes)`, `messages.insert` |
| `/admin/applications` | Applications | Marketplace Operations | RPCs; `vendor_applications` read |
| `/admin/recruiting` | Recruiting Readiness | Marketplace Operations *(not in MDS list)* | RPCs only |
| `/admin/vendors`, `/admin/vendors/[id]` | Vendors | Marketplace Operations | **direct** `contractors` insert/update (`is_active`, `marketing_enabled`, services), `contractor_service_zips`, `contractor_gallery` |
| `/admin/compliance` | Provider Compliance | Marketplace Operations *(MPS §9 Compliance expiry)* | RPCs only |
| `/admin/compliance/renewals` | Compliance Expiry | Marketplace Operations | RPCs only |
| `/admin/compliance/retention` | Document Retention | Marketplace Operations | RPCs only |
| `/admin/homeowners` | Homeowners | Marketplace Operations | reads |
| `/admin/catalog` | Service Catalog | Catalog & Supply | **direct** `services_catalog` toggles (`is_active`, `is_popular`) |
| `/admin/coverage` | Coverage Areas | Catalog & Supply | **direct** `coverage_areas` insert/update/delete |
| `/admin/pricing-templates` | Pricing Templates | Catalog & Supply | **direct** template writes (reference only) |
| `/admin/vendor-prices` | Vendor Prices | Catalog & Supply | RPC commands |
| `/admin/pricing-reviews` | Package Reviews | Catalog & Supply | **direct** `vendor_packages` `needs_review=false` / `is_active=false` (stale-guarded by `updated_at`) |
| `/admin/promotions` | Promotions | Money *(DEC-2026-038; checkout refuses promotions)* | RPC commands |
| `/admin/invoices` | Invoices | Money | **direct** `invoices` insert/update; refund button (F613-1, F613-9) |
| `/admin/finance` | Finance Reconciliation | Money | finance-authority RPCs; honest "Finance authority required" state |
| `/admin/disputes` | Disputes | Money *(MDS §6)* | `admin_decide_dispute` (6.10); **direct** `contractors.payouts_paused` toggle (F613-2) |
| `/admin/reviews` | Reviews | Trust & Support | RPC commands |
| `/admin/quality` | Quality | Trust & Support | legacy `admin_resolve_dispute` (F613-8) |
| `/admin/tickets` | Support Tickets | Trust & Support | RPC commands (6.10) |
| `/admin/messages` | Message Audit | Trust & Support | reads all messages (admin only) |
| `/admin/featured` | Featured Providers | Merchandising & Insights | **direct** `featured_providers` writes (R0 D7: operator-curated Spotlight) |
| `/admin/pricing-analytics` | Pricing Analytics | Merchandising & Insights | reads |
| `/admin/smart-picks` | Smart Picks | **remove** (F613-10) | **direct** `smart_picks` writes; duplicate Spotlight tab |

Outside the portal: the public footer links "Admin" to `/admin` for everyone (`Footer.tsx:92`, F613-11). The header's "Admin Portal" is shown only to accounts holding the admin role (`Header.tsx`, `fetchRoles`) — legitimate access, kept. Public Smart Picks entry point: `/pricing` → `NegotiatedRatesSection` "Our Picks For You" legend (Top Rated, Smart Choice, …) (F613-10). No other public reader of `smart_picks` exists in `src/`.

## 4. Operational queues (MPS §9)

| MPS §9 queue | Where today | Source (server rule) | Count shown | Age / threshold | Open record | Gaps |
|---|---|---|---|---|---|---|
| Coverage interest | `/admin/recruiting` (R0 interest) | R0 RPCs | yes | n/a | n/a | — |
| Sourcing | `/admin/requests` overdue banner, list "Match" column | client: `matched` and `match_expires_at < now` | client-computed | 4 h offer (CFG-009) | dialog | not a server queue; exhausted/sourcing not listed separately |
| Quote aging + payment exception | `AdminQuoteQueue` on `/admin/requests` | `admin_quote_queue` (CFG-015 thresholds, `money_payment_exceptions`) | yes | `due_at`, Aged | "Open request" | open fails silently if the request is not in the loaded list |
| Recurring visit payment | `AdminRecurringPaymentQueue` | `admin_recurring_payment_queue` (DEC-2026-049 items 5–6) | yes | appointment-passed / Aged | "Open visit" | a failed/unknown visit payment may also appear in the quote queue via `money_payment_exceptions` — verify with a fixture before claiming a duplicate |
| Schedule exception / fulfillment | `AdminFulfillmentQueue` | `admin_fulfillment_queue` (6.7) | yes | yes | "Open request" | same silent-open gap |
| Cancellation follow-up | `AdminCancellationQueue` | `admin_cancellation_queue` (6.9A) | **no** | **no** | **no** | no count, age or link to the record |
| Dispute | `/admin/disputes` (and legacy path on `/admin/quality`) | `disputes` read + `admin_decide_dispute` | "Active disputes" | — | dialog | two resolution paths (F613-8) |
| Support | `/admin/tickets` | `admin_support_queue` (6.10: owner, age, priority, next action) | yes | yes | detail | — |
| Compliance expiry | `/admin/compliance/renewals` | `vendor_evidence_renewal_queue`, `vendor_renewal_document_queue` | yes | 30-day notice | vendor record | — |
| Payout exception | `/admin/finance` | `money_finance_reconciliation` (finance authority) | yes | — | — | admins without finance authority see the honest permission state |

Overview (`/admin`) shows none of these. It counts raw `service_requests.status` client-side: "Pending" (status `pending`) is announced as "unassigned service requests need attention" although assignment is `matching_status`; "Active Jobs" is an ad-hoc set including `pending_review`; recent requests show raw status text, not the canonical `Status` label; "Homeowner Portal" links to `/dashboard` with the homeowner count. These numbers can disagree with the queues on `/admin/requests` (F613-13).

## 5. Findings

**Evidence basis.** **L** = reproduced locally by the probe script (synthetic users, local stack, one transaction, `ROLLBACK`). **C** = code or local catalog inspection (`pg_proc`, grants, policies), not executed as an attack. **H** = hosted read-only aggregate (counts only, no row data). Nothing was reproduced on hosted. Every hosted count is an observation about exposure today, not a test of the defect.

**Review priority** (most severe first): F613-3 (provider-account reassignment), F613-6 (internal-note disclosure), F613-7 (Mercurius Support spoofing), F613-1 (invoice writes outside finance authority), F613-2 + F613-8 (ineffective payout control, two dispute-decision paths). IDs are stable; the table keeps numeric order.

| ID | Finding | Basis | Evidence |
|---|---|---|---|
| F613-1 | **Invoice writes outside finance authority.** Any admin, with or without a `money_authorities` row, can insert and edit `invoices`: amount, platform fee, vendor payout, status `paid`/`released`/`refunded`. No reason or audit is recorded. A forged invoice appears on the homeowner dashboard and counts as homeowner "history" (`HomeownerAccessProvider`). `released` feeds the legacy `get_vendor_earnings_metrics`. | L, C, H | **L:** A1, A2, X2 (`released`, payout 9999, `released_at` set), H2 (homeowner sees it). **C:** RLS "Admins can insert/update invoices", `authenticated` holds INSERT/UPDATE/DELETE. No guard trigger. The only database writer is `sync_invoice_on_request_change` (SECURITY DEFINER, owner `postgres`). No Edge Function writes `invoices` (§8.1). **H:** 1 invoice, pending. |
| F613-2 | **Ineffective payout control.** "Pause payouts" on `/admin/disputes` writes `contractors.payouts_paused`, which **no database function reads**. The reviewed hold is `money_operator_place_hold` (finance authority). The toggle claims a hold that does not exist. | L, C, H | **L:** A3 (write allowed). **C:** a `pg_proc` source search for `payouts_paused` finds nothing; the only client is `disputes/page.tsx:95`. **H:** 0 paused. |
| F613-3 | **Provider-account reassignment and command bypass.** Direct admin `contractors` updates skip every reviewed command. **Reassigning `user_id` (A5) gave a homeowner account the provider's assigned request, including its service address (B1 = 1 with A5, 0 without).** Vendor read access keys on `contractors.user_id`, so the new account inherits it without `vendor_link_existing_account` / `vendor_release_linked_account`. Also: the `is_active`/`marketing_enabled` one-click toggles bypass `vendor_decide_onboarding` (reason, expected revision, key), and `rating`/`badges` can be hand-set (A4). `enforce_contractor_update_scope` returns early for admins. | L, C, H | **L:** A4, A5, B1 (account B still held only the homeowner role). **C:** `vendors/page.tsx:169`, `vendors/[id]/page.tsx:221`, scope trigger. Matching still requires `vendor_matching_eligible`, so `is_active` alone does not make a provider matchable. **H:** 29/29 providers carry a rating (6.8 finding). |
| F613-4 | **Coverage allowlist editable without owner authority.** `/admin/coverage` adds, deactivates and deletes ZIPs directly, with no reason or history. A6 added `99999`/`ZZ`; A7/A8 removed `33901`. CFG-001 makes the backend allowlist authoritative and the owner its change authority; DEC-2026-021 committed it by migration. | L, H | **L:** A6–A8. **H:** 47/47 active (matches DEC-2026-021). |
| F613-5 | **Catalog visibility toggle.** `/admin/catalog` toggles `services_catalog.is_active` directly, hiding a service, with no reason or history. CFG-002 keeps every catalog service visible. | C (L for A9) | **C:** `catalog/page.tsx:79` (toggle not probed). **L:** pricing-mode edits are refused by a check constraint (A9). |
| F613-6 | **"Internal Notes" are not internal.** The request dialog's "Internal Notes" saves into `service_requests.notes`. The homeowner (H1) and the assigned provider (V1) can both read that column through the API. No homeowner or vendor page displays it. | L, C, H | **L:** H1, V1. **C:** column SELECT grant on `notes` to `authenticated`; the only writer is `requests/page.tsx:330`. **H:** 0 of 11 requests have notes. |
| F613-7 | **Mercurius Support message spoofing.** `messages.sender_role` is supplied by the client. A homeowner inserted a message with `sender_role='admin'`, and the thread renders it to both parties as "Mercurius Support". | L, C, H | **L:** H5. **C:** policies check `sender_id` and the thread, not the role; rendering in `HomeownerMessagesExperience.tsx:642/677`. **H:** 0 admin-labelled messages from non-admins (1 message total). |
| F613-8 | **Two dispute-decision paths.** `/admin/quality` resolves disputes through legacy `admin_resolve_dispute`, which has no request key, expected status or version. `/admin/disputes` uses the 6.10 `admin_decide_dispute`, which is keyed and stale-guarded. Both are executable by `authenticated`. | C, H | **C:** `quality/page.tsx:26`; routine grants. `admin_decide_dispute` calls `admin_resolve_dispute` internally (§8.1). SQL tests 008 and 024 call it directly. **H:** 0 disputes. |
| F613-9 | **Refund button that always fails.** "Refund" on `/admin/invoices` calls `refund-invoice` with only an invoice ID. The function requires a separately approved authorization and returns `REVIEWED_REFUND_REQUIRED` (409). Safe, but presented as an available action. | C | `refund-invoice/index.ts:26`; `invoices/page.tsx:156`. |
| F613-10 | **Smart Picks entry points:** the sidebar entry; `/admin/smart-picks` (direct `smart_picks` insert/update/delete, plus a second copy of the Spotlight manager); the public `/pricing` legend "Our Picks For You" (static copy). `smart_picks` is readable by `anon` (active rows) and writable by admins (A10). MPS §3 defers Smart Picks; the roadmap removes them unless a purpose is approved. | L, C, H | **L:** A10. **C:** anon grant in migration `20260903160000`; no other reader in `src/` or `pg_proc`. **H:** 0 picks. |
| F613-11 | Public footer "Admin" link shown to every visitor (MDS §6: remove). | C | `Footer.tsx:92`. Server authorization already holds (proxy + RLS), so this is a navigation fix only. |
| F613-12 | Flat 25-item navigation with no task grouping (MDS §6). Mobile uses a Sheet with the same flat list. | C | `AdminSidebar.tsx`. |
| F613-13 | Overview counts and labels are not authoritative and disagree with the queues (§4). | C | `admin/page.tsx`. |
| F613-14 | Queue presentation is inconsistent (§4): cancellation follow-up has no count, age or record link, and "Open request" from a queue does nothing when the record is not in the loaded list. | C | Components listed in §4. |
| F613-15 | **Context is lost.** `/admin/requests` keeps search, status filter and the open record in component state, so there is no URL or deep link to a record, and reload or Back loses context. Other admin lists behave the same, except `/admin/applications?application=` and `/admin/vendor-prices?vendor=`. | C | `requests/page.tsx:186–188`. |
| F613-16 | **Stale admin status change.** "Change Status" calls `transition_job_status(_job, _to, _reason)` with no expected current state. A dialog opened on an older state applies its target to whatever the state is now, if the state machine allows it. `create_job_offer` (reason, before-state logged, eligibility enforced even when forced) and `release_job_match` (requires the current provider) are adequately guarded. Replay behavior of `admin_record_quote_review` / `admin_close_quote_exception` is unprobed. | C | Function signatures; not probed. |
| F613-17 | Loading `/admin/requests` (or the homeowner dashboard) calls `expire_stale_matches`, so a page load triggers an expiry write. It implements the approved 4-hour expiry (CFG-009) in the absence of a scheduler. Recorded only; scheduler activation is Phase 7. | C | `requests/page.tsx:207`. |
| F613-18 | Package Reviews clears a pricing exception (`needs_review=false`) with `window.confirm`, no reason and no history (stale-guarded by `updated_at`). | C | `pricing-reviews/page.tsx:196`. DEC-2026-057 Q6. |
| F613-19 | The admin request list loads every request and every profile without pagination. Beta volume is 11 hosted requests. Recorded; changed only if a touched list needs it. | C, H | `requests/page.tsx:209–211`. |
| F613-20 | Admins can directly edit a request's address and description (A13), with no reason or history. This is customer-entered data; no admin page offers it, but the table policy allows it. Lifecycle fields are guarded (A14) and deletion is refused (A15). | L | A12–A15. DEC-2026-057 Q5. |

Role-negative results that hold (L): homeowners cannot write `smart_picks` (H3) or `coverage_areas` (H4); a vendor cannot change `payouts_paused` (V2) or invoices (V3); direct dispute status writes are refused (A11, no table grant); direct lifecycle status writes are refused (A14).

## 6. Probe record

### 6.1 Local reproduction (L)

Script: [`review-evidence/trace-136-admin-bypass.sql`](review-evidence/trace-136-admin-bypass.sql). It uses synthetic `example.invalid` users with `c613…` IDs and a placeholder address, has no credentials, and runs as one transaction ending in `ROLLBACK`. Run on the local stack (212 migrations) 2026-11-02; 28 result lines, reproduced twice:

```
A1 admin invoices insert status=paid amount=400: ALLOWED rows=1
A2 admin invoices update vendor_payout=9999 status=released: ALLOWED rows=1
A3 admin contractors payouts_paused=true: ALLOWED rows=1
A4 admin contractors rating=5 badges: ALLOWED rows=1
A5 admin contractors user_id reassigned: ALLOWED rows=1
A6 admin coverage_areas insert 99999: ALLOWED rows=1
A7 admin coverage_areas deactivate 33901: ALLOWED rows=1
A8 admin coverage_areas delete 33901: ALLOWED rows=1
A9 admin services_catalog pricing_mode change: REFUSED 23514 (check constraint)
A10 admin smart_picks insert: ALLOWED rows=1
A11 admin disputes direct status=resolved: REFUSED 42501 permission denied for table disputes
A12 admin service_requests notes: ALLOWED rows=1
A13 admin service_requests address: ALLOWED rows=1
A14 admin service_requests status direct: REFUSED 42501 Lifecycle fields must be changed through authorized RPCs
A15 admin service_requests delete: REFUSED 42501 permission denied for table service_requests
A16 admin invoices delete: ALLOWED rows=0 (no delete policy)
H1 homeowner reads own request notes: INTERNAL probe note
H2 homeowner sees forged invoice: 1
H3 homeowner smart_picks insert: REFUSED 42501 (RLS)
H4 homeowner coverage insert: REFUSED 42501 (RLS)
H5 homeowner messages as admin role: ALLOWED rows=1
V1 vendor reads assigned request notes: INTERNAL probe note   (run without A5)
V2 vendor contractors payouts_paused=false: REFUSED 42501     (run without A5)
B1 homeowner B reads A's request: 1 with A5, 0 without
X1 loyalty transactions after forged paid invoice: 0
X2 invoice state: released payout=9999.00 released_at true
X3 dispute decisions recorded: 0
```

### 6.2 Hosted observations (H, read-only aggregates)

Taken 2026-11-02 with `supabase db query --linked`; counts only, no row data, nothing written:
- invoices 1 (pending);
- paused providers 0;
- Smart Picks 0;
- featured 4;
- coverage 47/47 active;
- requests with notes 0/11;
- admin-labelled messages from non-admins 0 (1 message);
- admin role rows 2;
- money authorities 0;
- disputes 0;
- support tickets 0;
- providers with a rating 29/29.

Migration history (`supabase migration list --linked`) ends at `20261107001000`.

**No live record shows the defects; every closure below is preventive.**

## 7. Owner decision sheet (DEC-2026-057, PROPOSED)

The repairs in §8.2/§8.4 are covered by approved authorities and do not wait for these answers. Each question below changes an existing operator capability, so the owner answers it. The question text matches DEC-2026-057 in [DECISION-LOG.md](DECISION-LOG.md) word for word.

**Q1 — Coverage ZIP edits (F613-4).**
- *Question:* Should operators keep changing the Lee County ZIP allowlist from `/admin/coverage`, or should allowlist changes go only through a reviewed migration under the owner's authority (CFG-001)?
- *Today:* direct add, deactivate, waitlist toggle and delete; no reason or history.
- *Recommend:* `/admin/coverage` becomes a read-only readback (ZIP, city, active, waitlist). Changes go through a reviewed migration, as DEC-2026-021 did.
- *Alternatives:* (a) an owner-only audited `admin_set_coverage_zip` command (reason, before/after, five-digit ZIP, state `FL`); (b) keep as is (conflicts with CFG-001).
- *Affected workflows:* `/admin/coverage`; the intake coverage check (`/api/request-coverage`); the public provider coverage map (`/providers/[id]`); the vendor coverage readback; the admin vendor ZIP picker; matching eligibility; SQL test 064.

**Q2 — Hiding catalog services (F613-5).**
- *Question:* May an operator hide a catalog service (`services_catalog.is_active = false`) when CFG-002 keeps every service visible, and if so, with what reason and approval?
- *Today:* one-click toggle, no reason or history.
- *Recommend:* a reasoned, recorded command; deactivation requires the owner's approval note. "Popular" stays a plain operator toggle, and add/edit of service details is unchanged.
- *Alternatives:* (a) no deactivation in the UI (migration only); (b) a reasoned command without owner approval.
- *Affected workflows:* `/admin/catalog`; public service pages and intake; the "Not available yet in your area" display.

**Q3 — Provider activation, suspension and public listing (F613-3).**
- *Question:* How should operators activate, suspend or hide a provider: only through the reviewed onboarding decision and the reasoned public-listing exclusion, or through a new reasoned activation command?
- *Today:* direct `is_active` and `marketing_enabled` toggles on `/admin/vendors`; both saved with the profile form on `/admin/vendors/[id]`; legacy providers created directly with `is_active = true`.
- *Recommend:* providers with an onboarding record are activated or suspended through `vendor_decide_onboarding`. For legacy providers, the quick action is the existing reasoned "hide from customers" (`r0_set_public_listing_exclusion`), and activation goes through legacy provider review. Client writes to `is_active` and `marketing_enabled` are refused.
- *Alternative:* a reasoned `admin_set_provider_active` command (reason, expected revision, history).
- *Affected workflows:* `/admin/vendors` list, toggles and create; `/admin/vendors/[id]` save; public directory and listing (`r0_provider_listable`); onboarding decisions; compliance operations.

**Q4 — Hand-set ratings, badges and job counts (F613-3, 6.8).**
- *Question:* May operators hand-set a provider's `rating`, `badges` and `jobs_completed`?
- *Today:* free entry on `/admin/vendors/[id]`.
- *Recommend:* refuse client writes to these three fields; current values stay displayed until DEC-2026-052 item 6 decides the canonical source (reviews for rating).
- *Alternative:* editable with a reason and history until DEC-2026-052 is answered.
- *Affected workflows:* `/admin/vendors/[id]`; public profile and directory; the admin assignment list on `/admin/requests`.

**Q5 — Admin edits to customer-entered request data (F613-20).**
- *Question:* May operators correct a homeowner's request address or description, and if so, through what record and notification?
- *Today:* no admin page offers it, but the table policy allows direct edits (A13).
- *Recommend:* allow through a reasoned command that records before and after and notifies nobody automatically. The command refuses a ZIP change once a provider is offered or matched, because coverage and the offer depend on it.
- *Alternative:* refuse; the homeowner corrects their own request.
- *Affected workflows:* `/admin/requests` record dialog; matching and coverage; quote scope; the provider job view.

**Q6 — Package Reviews approval (F613-18).**
- *Question:* Should clearing a Package Review require a reason and history now, in 6.13, or stay with the pricing work?
- *Today:* `window.confirm` only, stale-guarded by `updated_at`.
- *Recommend:* carry to the pricing work (a reason the vendor can read, per DEC-2026-046).
- *Alternative:* add a reason and history in 6.13.
- *Affected workflows:* `/admin/pricing-reviews`; vendor price editors.

**Q7 — Manual invoices (F613-1).**
- *Question:* Is manual invoice creation or editing still needed for operations once client writes to the legacy `invoices` ledger are closed?
- *Today:* create, edit, send and mark paid; the Refund button is always refused. Closing client writes is covered by MPS §6.5 and CFG-004 (§8.2 A1) and does not wait for this answer.
- *Recommend:* no. `/admin/invoices` becomes a read-only legacy readback that points to Finance.
- *Alternative:* a finance-authority command (money-authority holder, reason, two-person review for high risk per MPS §6.5), built in a separate finance-reviewed slice, not 6.13.
- *Affected workflows:* `/admin/invoices`; homeowner dashboard invoices; homeowner "history" (`HomeownerAccessProvider`); legacy `get_vendor_earnings_metrics`.

## 8. Proposed implementation

One branch, two reviewable sub-slices. **6.13A and 6.13B merge together**: 6.13A alone would leave admin controls that fail with permission errors. No money function changes (fingerprint must stay `45 | 34c51131…`).

### 8.1 Legitimate callers (inventoried before any privilege removal)

| Privilege proposed for removal | Legitimate callers today | Effect on them | Replacement path |
|---|---|---|---|
| `INSERT, UPDATE, DELETE` on `invoices` for `authenticated` | Database: `sync_invoice_on_request_change` (SECURITY DEFINER trigger function, owner `postgres`, fired by lifecycle changes such as `transition_job_status`). Client: `/admin/invoices` only (create, edit, send, mark paid). Edge Functions: none write `invoices`. Tests: no SQL or browser test writes `invoices` as `authenticated` (`portal-server.mjs` mocks reads only). | Trigger unaffected: it runs as owner. Admin page loses its writes. `service_role` keeps its grants. | Read-only page (§8.4 B5); Q7 decides whether a finance command is ever built. |
| Client change of `contractors.user_id` (update, or non-null on insert) | Database: `vendor_link_existing_account`, `vendor_release_linked_account`, `vendor_bind_invited_account`, `r0_bind_provider_access`, `r0_release_provider_access` (all SECURITY DEFINER, owner `postgres`). Client: none (`/admin/vendors` create and `/admin/vendors/[id]` save do not send `user_id`). | None. The guard applies when `current_user = 'authenticated'`; definer commands run as `postgres`. | Existing linking and release commands. |
| Client writes to `contractors.payouts_paused*` | Database: no function reads or writes them. Client: `/admin/disputes` toggle only. | Toggle removed (B5). | `money_operator_place_hold` (finance authority, existing). |
| Client-chosen `messages.sender_role` | Homeowner thread (`HomeownerMessagesExperience.tsx:561`, `homeowner`); vendor thread (`VendorMessagesExperience.tsx:265`, `vendor`); admin request dialog (`requests/page.tsx:465`, `admin`). Database: no function inserts messages. | None: each caller already sends a role it holds for that thread. | Validation trigger (A3). |
| Admin UI writes to `service_requests.notes` | Writer: `/admin/requests` "Internal Notes" only. Readers: that dialog only; the column grant also lets the homeowner and provider read it through the API. `dispute_detail` reads dispute-decision notes, not this column. | Column, grants and existing values unchanged (hosted 0 rows). | `request_operator_notes` (A4). |
| `EXECUTE` on `admin_resolve_dispute` for `authenticated`/`anon`/`PUBLIC` | `/admin/quality` dispute action; `admin_decide_dispute` (SECURITY DEFINER, owner `postgres`, calls it internally); SQL tests 008 (lines 40, 42, 54) and 024 (line 104). | `admin_decide_dispute` unaffected (runs as owner). Tests 008/024 move to `admin_decide_dispute` or call the legacy function as owner. The **Provider Cancellations** tab on `/admin/quality` (`exceptions.spec.ts`) stays. | `/admin/disputes` (6.10 contract). |
| `smart_picks` SELECT for `anon`; all client writes | `/admin/smart-picks` and its sidebar entry only. No reader in `src/` or `pg_proc`; the `/pricing` legend is static copy. | None outside the page being removed. | None (deferred, MPS §3). |
| Client writes to `coverage_areas` (**Q1**) | Writer: `/admin/coverage`. Readers (SELECT kept): `/api/request-coverage`, `VendorCoverageReadback`, `/providers/[id]`, `/admin/vendors/[id]`; test 064. | Per Q1. | Per Q1. |
| Client writes to `services_catalog.is_active` (**Q2**) | `/admin/catalog` toggle. Add/edit (`catalog/page.tsx:93`, `VendorServiceActions.tsx:61`) is not in question. | Per Q2. | Per Q2. |
| Client writes to `contractors.is_active`, `marketing_enabled` (**Q3**) and `rating`, `badges`, `jobs_completed` (**Q4**) | `/admin/vendors` toggles and create; `/admin/vendors/[id]` save. Database: `vendor_decide_onboarding`, cutover and R0 commands (definer). | Per Q3/Q4. | Per Q3/Q4. |
| Client updates to `service_requests.address`, `description` (**Q5**) | No client writes them after submission (only `notes` is updated from `src/`). | Per Q5. | Per Q5. |

### 8.2 6.13A — database repairs covered by approved authorities

Additive migration, not pushed.

| # | Repair | Governing authority |
|---|---|---|
| A1 | Revoke `INSERT, UPDATE, DELETE` on `public.invoices` from `authenticated` and `anon`; drop the admin insert/update policies. | MPS §4 (release/hold funds is restricted finance authority), §6.5 (manual financial changes: reason, immutable audit, restricted role); CFG-004 |
| A2 | Guard trigger on `contractors` for `current_user = 'authenticated'` (admins included): refuse a change of `user_id` (and a non-null `user_id` on insert) and of `payouts_paused`, `payouts_paused_reason`, `payouts_paused_at`. | MPS §4 (finance authority; least privilege); MTS §6 (role checked in RPC; reviewed linking commands) |
| A3 | `messages` validation trigger: the supplied `sender_role` must be one the caller holds *for that thread*: `homeowner` if they are the request's customer, `vendor` if they are its provider's linked account, `admin` if `has_role(admin)`. Otherwise refuse. Dual-role accounts may post under any role they qualify for. | MTS §6 ("no client self-promotion"); MPS §4 |
| A4 | `request_operator_notes` (request, author, created_at, text; append-only). Admin-only through `admin_add_request_note(_request_id, _request_key, _text)` (keyed replay) and `admin_request_notes(_request_id)`. No table grant to any client role. | MPS §4 (audit/support records least-privilege), §9 (override records actor and time) |
| A5 | Revoke `EXECUTE` on `admin_resolve_dispute` from `authenticated`, `anon`, `PUBLIC`; update SQL tests 008/024. | 6.10 contract (TRACE-133, keyed stale-guarded decisions); MDS ConfirmAction stale protection |
| A6 | `admin_transition_job_status_expected(_job_id, _expected_status, _request_key, _to_status, _reason)`: delegates to the same transition rules and reasons, refuses with `40001` when the current status differs, and replays the first result for the same key and payload (a changed payload is refused). The existing function is unchanged. | MPS §9 (override records before/after); owner brief item 5 (stale/retry protection) |
| A7 | Smart Picks: revoke `smart_picks` SELECT from `anon` and all client writes; table and data kept (0 hosted rows). | MPS §3 (deferred unless approved); roadmap |
| A8 | `admin_operations_summary()`: read-only, admin-only. Returns `{queue, count, aged, checked_at}` by calling the **same** functions the queues call (quote, recurring payment, fulfillment, cancellation, support, renewals, applications awaiting review, sourcing). Finance counts are returned only to money-authority holders; otherwise `restricted`. No new threshold, SLA or action. | MPS §9; CFG-015 (queue items only, no automatic action) |

### 8.3 6.13A — dependent on DEC-2026-057 (not built until answered)

- Q1 → revoke client writes on `coverage_areas` (or an owner-only command).
- Q2 → `services_catalog.is_active` command or revoke.
- Q3 → add `is_active`, `marketing_enabled` to the A2 guard (or a reasoned command).
- Q4 → add `rating`, `badges`, `jobs_completed` to the A2 guard (or reason + history).
- Q5 → column guard on `address`/`description`, plus an optional reasoned correction command.
- Q6 → none in 6.13 if carried.
- Q7 → none in 6.13 (A1 stands either way).

### 8.4 6.13B — UI covered by approved authorities

| # | Change | Governing authority |
|---|---|---|
| B1 | Grouped sidebar per §3: MDS groups, `aria-current`, labelled group lists, same order in the mobile Sheet. Remove the Smart Picks entry and route (`/admin/smart-picks` → `/admin/featured`), the public footer Admin link and the `/pricing` "Our Picks For You" legend. The client layout keeps the deep path on redirect. | MDS §6; MPS §3 |
| B2 | Overview rebuilt on `admin_operations_summary`: one row per queue with count, aged count, checked-at and a link that opens the filtered queue. Canonical `Status` labels; remove the "Homeowner Portal" quick link. | MPS §9; MDS §5 |
| B3 | Shared `OperationalQueue` header for the four request queues (count, checked-at, refresh, loading/empty/error, open record). Cancellation follow-up gains a count and "Open request". | MDS §5, §7 |
| B4 | `/admin/requests` URL state: `?q=`, `?status=`, `?request=<id>`. Opening from a queue or link fetches the record by ID when it is not loaded. Closing the dialog restores focus to the opener and keeps filters; Back closes the record. | MDS §7, §8 |
| B5 | Honest controls. Invoices page read-only, with "Refunds and payment corrections go through Finance review" (link; finance-authority state shown). Disputes page removes "Pause payouts" and shows "Payout holds are placed in Finance (finance authority required)". The `/admin/quality` dispute action links to `/admin/disputes`. "Change status" uses A6 and reports "This request changed since you opened it — review the current state" on `40001`. | MPS §4, §6.5; owner brief item 8 |
| B6 | Internal-notes panel reads and appends operator notes with author and time, labelled "Visible to Mercurius operators only". | MPS §4 |

### 8.5 6.13B — dependent on DEC-2026-057

- Q1 → `/admin/coverage` read-only (or command form).
- Q2 → `/admin/catalog` hide control.
- Q3 → `/admin/vendors` toggles become links to onboarding decision / listing exclusion.
- Q4 → `/admin/vendors/[id]` rating/badges/jobs fields read-only.
- Q5 → address/description correction form (or none).
- Q6 → Package Reviews reason (or none).

### 8.6 Not changed

- Queue thresholds (CFG-015, DEC-2026-049) and any automatic action.
- Matching, pricing, payment or payout logic.
- Featured Providers and the finance pages.
- `expire_stale_matches` on page load (F613-17).
- `service_requests.notes` column and its existing visibility.

## 9. Acceptance criteria

### 9.1 6.13A (bounded; database only)

1. **Scope.**
   - One additive migration containing only §8.2 A1–A8.
   - No §8.3 item and no change to queue functions, thresholds, matching, pricing or money functions.
   - Money fingerprint `45 | 34c51131…` identical before and after.
   - No hosted push.
2. **Invoices (A1).**
   - As admin without money authority, admin with money authority, homeowner, vendor and `anon`, INSERT/UPDATE/DELETE on `invoices` is refused (`42501`); A1/A2 refused.
   - A lifecycle change still creates or updates the invoice through `sync_invoice_on_request_change`.
   - SELECT for each role is unchanged.
3. **Provider account and payout flags (A2).**
   - A5 and a client insert with non-null `user_id` are refused for admin and vendor, and B1 = 0.
   - A3 and V2 are refused.
   - Each linking, binding and release command still succeeds (existing SQL 072 and vendor-linking tests green).
   - Fields outside the guard still save from `/admin/vendors/[id]`.
4. **Messages (A3).**
   - H5 is refused.
   - Homeowner, vendor and admin posting under their own thread role succeed.
   - A vendor posting on a request they are not assigned to is refused.
   - A dual-role account posts under each role it qualifies for.
   - Existing messages are untouched.
5. **Operator notes (A4).**
   - Admin add/list works, and author and time are set by the server.
   - The same key replays the first row; a changed text under the same key is refused.
   - Empty or over-length text is refused.
   - No UPDATE/DELETE path exists for any role.
   - `anon`, homeowner A/B and vendor A/B get `42501` or zero rows.
6. **Legacy dispute path (A5).**
   - `admin_resolve_dispute` is not executable by `authenticated`, `anon` or `PUBLIC`.
   - `admin_decide_dispute` still records decisions (6.10 tests green).
   - 008/024 pass on the updated path.
7. **Expected-state status (A6).**
   - Stale expected status → `40001`, with no transition and no history row.
   - Same key and payload → first result, no second row.
   - Same key with a different payload → refused.
   - Non-admin → `42501`.
   - A table-driven test shows the allowed transitions and reason rules equal `transition_job_status`'s.
   - Two admins from the same observed state → one success, one `40001`.
8. **Smart Picks (A7).** `anon` and `authenticated` hold no privilege on `smart_picks`; A10 is refused; row count unchanged.
9. **Summary (A8).**
   - Admin-only (`42501` otherwise).
   - Each count equals the item count of its queue function in the same transaction, on fixtures crossing each CFG-015 threshold.
   - Finance entries are `restricted` without money authority.
   - The function writes nothing.
10. **Evidence.**
    - Probe script rerun with every change from ALLOWED to REFUSED stated.
    - New SQL `108_admin_operations.sql` with mutation checks.
    - Clean replay of all migrations and the full SQL suite green.
    - Probes A6–A9, A12–A15, H3/H4, V3 unchanged (the Q1/Q5 items are not yet built).

### 9.2 6.13B (UI) and the combined slice

1. Every admin route is reachable from exactly one sidebar group on desktop and mobile, and `aria-current` marks the most specific entry. Unauthenticated and non-admin requests to every `/admin/*` route are redirected by the proxy (route-to-role matrix test).
2. No public page links to `/admin` or Smart Picks; the header's admin link appears only for admin accounts.
3. Each overview count equals its queue's count at the same `checked_at`; finance counts read "restricted" for an admin without finance authority.
4. A deep link `/admin/requests?request=<id>&status=matched` opens that record with the filter applied, including a record outside the loaded page. Closing returns focus and keeps the URL filters; Back closes the dialog.
5. A stale status change shows the stale message and changes nothing; a replayed request is harmless.
6. The invoices page offers no write and no refund, and the disputes page offers no payout toggle; both explain where the reviewed action lives.
7. Operator notes show author and time and the "operators only" label; the homeowner and provider views show no operator note.
8. Keyboard: sidebar, queues, list, record dialog and ConfirmAction are operable without a pointer, with visible focus and focus trap/restoration. axe is clean on touched pages at 390 px and desktop, in light and dark. No horizontal page scroll at 320 px.
9. Applicable browser regression is green: `quote-proposals`, `recurring-visits`, `fulfillment`, `exceptions`, `support`, `finance-commands`, `portals`, `reviews`.

## 10. Test plan

- **SQL** (new `108_admin_operations.sql`): A1–A16/H1–H5/V1–V3/B1 before→after; role matrix (anon, homeowner A/B, vendor A/B, admin, finance admin, service role) for each new or changed object; summary counts equal queue counts on fixtures crossing each CFG-015 threshold; expected-state transition stale/replay/changed payload; legacy dispute function refused; mutation checks.
- **Concurrency:** two admins change the same request status from the same observed state — one succeeds, one gets `40001`.
- **Unit:** navigation grouping (every route once), URL state parse/serialize, summary-to-queue mapping.
- **Browser** (new `admin-operations.spec.ts`): grouped nav desktop/mobile Sheet, keyboard-only queue → record → action → return, deep link and Back, stale message, footer/pricing link absence, non-admin redirect; regression on `quote-proposals`, `recurring-visits`, `fulfillment`, `exceptions`, `support`, `finance-commands`, `portals`, `reviews`.
- **Not automatable here:** screen reader, real devices, `@visual` baselines — recorded as not performed.

## 11. Phase 6 closure checklist (status, 2026-11-02)

Phase 6 is **not complete**: integrated acceptance and carried corrective work remain. "Merged" means on `main`; "verified" means its own automated evidence passed; "accepted" is the owner's, after Codex review and the phase checkpoint.

| Slice | Implemented | Merged to `main` | Automated evidence | Still blocked / open |
|---|---|---|---|---|
| 6.1 TRACE-095 | yes | yes | yes | — (phase journey acceptance) |
| 6.2 TRACE-098 | yes | yes | yes | — |
| 6.3 TRACE-099 | yes | yes | yes | — |
| 6.4 TRACE-119 | yes | yes (#106) | yes | no quote approvable until a tax confirmation path exists (DEC-2026-015 §4) |
| 6.5 TRACE-121 | yes | yes (#109) | yes | MPS E1: appointments read "recorded", not "confirmed" (owner gap) |
| 6.6a–c TRACE-123/124/125 | yes | yes (#111–#113) | yes | **6.6c two-person finance sign-off not recorded**; DEC-2026-049 items 7–8 blocked |
| 6.7 TRACE-128 | yes | yes (#114) | yes | DEC-2026-050 unpaid start PROPOSED; screen reader/`@visual`/devices not done |
| 6.8 TRACE-130 | yes | yes (#116) | yes | DEC-2026-052 PROPOSED; Codex review of merged diff open |
| 6.9A/6.9B TRACE-131/132 | yes | yes (#121) | yes | F-1, F-2 (supplemental refund), F-3, P-K1/P-K2 payment-kernel repairs not built |
| 6.10 TRACE-133 | yes | yes (#125) | yes | DEC-2026-054 PROPOSED |
| 6.11A/6.11B TRACE-134 | yes | yes (#126, #128) | yes | follow-up: revoke signed-in SELECT on `contractors.special_offer` |
| 6.12A TRACE-135 | yes | yes (#127) | yes | — |
| 6.12B TRACE-135 | yes | yes (#129, `b1a8cc3`) | yes (local) | Codex review; follow-ups `/vendors` "released" copy, revoke legacy `get_vendor_earnings_metrics` |
| 6.13 TRACE-136 | **no** (this brief) | no | no | DEC-2026-057 Q1–Q7 |
| Prepaid plans (DEC-2026-048) | no | no | no | separate slice with finance review |

Carried across the phase (not closed by any slice):

- **Pricing repairs:** TRACE-126 (one-time accepted-price exposure) and TRACE-127 (add-on visit acceptance after a price change) OPEN; DEC-2026-051 items 6–8 PROPOSED; F613-18.
- **Finance sign-offs:** 6.6c two-person finance review not recorded; promotions gated pending finance review (DEC-2026-038/041/042); 0 hosted money authorities.
- **Unresolved policies:** DEC-2026-050, 052, 054, 057 PROPOSED; DEC-2026-049 items 7–8 blocked.
- **Payment kernel:** P-K1/P-K2, F-1/F-2/F-3 (6.9 brief §11).
- **Human acceptance:** screen-reader, real-device, `@visual` and 200% zoom checks for every Phase 6 journey; integrated Codex journey review (PHASE-6-SCOPE "Phase acceptance checkpoint").
- **Not authorized here:** payments, automation, financial operations, hosted pushes, merges.
