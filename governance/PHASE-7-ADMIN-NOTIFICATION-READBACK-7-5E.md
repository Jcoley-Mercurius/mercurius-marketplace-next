# Phase 7.5E — Admin in-app notification readback (TRACE-159, OD-5)

**Status:** IMPLEMENTED FOR REVIEW (Codex). Not merged, not deployed, nothing activated. No hosted action.
**Status update (2026-11-24 ET, factual; recorded by the review repair):** PR #202 was **merged** to `main` as `afa0be8` (2026-11-25 00:33:39 UTC) from head `8569ece`, **before** the F-1/F-2 repairs below; GitHub shows no review object. `main` therefore carries the unrepaired hook and pages; under DEC-2026-037 that is the production code (deployment not verified). The repairs are in a follow-up PR from `afa0be8` (§11). The status line above is kept as history.
**Review (2026-11-24 ET):** Codex accepted D-1..D-7 subject to repairing its PR #202 findings F-1 (account-bound state) and F-2 (uncertain mark-read outcomes). Repaired for re-review in §11, in a follow-up PR because #202 had merged. This is not review acceptance.
**Status update (2026-11-25 ET, factual; recorded by the 7.5F plan):** the review repair (PR #203, head `5fc09e1`, exact-head CI 45521103690 success) **merged** as `01a5dd1` (2026-11-25 03:09:07 UTC); main CI 45537955099 success; GitHub records Production deployment 8047197415 with status `success` (READY not verified). **Codex's re-review of the repair is not recorded** (no review object) and stays open. PR #204 then merged #202's branch as `846dd34` (22:14:10 UTC): its commits `d34b2a2`/`8b75582` have trees identical to `7b72d18`/`0610688`, so no code changed, but it added duplicate documentation lines (a second "Review" line in this header, five §11.4 rows, a TRACE-159 row and a HANDOFF line). Consolidated on 2026-11-25 ET by the 7.5F plan revision 2, keeping every unique fact ([7.5F plan](PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md) §1.2).
**Date:** 2026-11-24 (America/New_York).
**Base:** `main` `dcc62e1` (#201 merge, 2026-11-24 18:18:48 UTC), fetched before work. Branch `claude/phase7-5e-admin-notification-readback`.
**Authority:** owner approval of OD-5, limited ([DEC-2026-068](DECISION-LOG.md), 2026-11-24). [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1) X-4, §9 OD-5, §10 step 4. [Notification contract](PHASE-7-NOTIFICATION-CONTRACT.md) (NM-1) §4.1, G3-03. MTS §6 l.150 (messages visible only to participants/admin). MDS accessibility and state rules. Precedent: [7.2B vendor readback](PHASE-7-VENDOR-NOTIFICATION-READBACK.md) (TRACE-153).

## What this slice does not do

No migration, producer, recipient, copy, policy, grant, index, realtime or retention change. No external alert service, email, SMS or push; no scheduler, retry, breach detector, new SLA threshold or priority. No hosted Supabase, Vercel, Stripe, Resend or PostHog call. No booking, payment or profile change. Every 7.3D email activation gate (EO-1..EO-8, PG-1/G-1, H- and T-checks) is unchanged.

**This is an in-app list.** It sends nothing to anyone. A notice listed or marked read on it is not evidence that any person was alerted, saw it in time, or acted. HQ-6 ("alert delivered to the named recipient") stays unmet, and OD-5's external-channel part stays open.

---

## 1. Baseline and #201 reconciliation

| Item | Observation (2026-11-24 ET) |
|---|---|
| `origin/main` | `dcc62e1` (#201 merge). Before it: #200 (`799303e`, TRACE-156 profile framing), #199 (`aeb20e4`, 7.5C) |
| #201 (7.5D) | **Merged** 18:18:48 UTC as `dcc62e1`, from head `28b31ca`. Exact-head CI 45442433660 success (PR comment). No GitHub review object |
| `20261202001000` hosted push | **Not verified.** No dry-run or push record exists on #201 or in the 7.5D record, and this slice made no hosted query. If it was not pushed before merge (DEC-2026-037), it is outstanding and needs the owner's authorization. Dated note added to the [7.5D record](PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md) header |
| `20261202001000` hosted readback (added by the review repair) | Codex's privileged read-only verification at **2026-11-24 22:50:29 UTC**: recorded and latest; the three definition md5s equal the local 7.5D values. Recorded in the [7.5D record](PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md) header. It does not establish push timing or deployment READY. Claude made no hosted query |
| Deployment of `dcc62e1` | **Not verified** (no Vercel readback) |
| Main CI on `dcc62e1` | Run 45458156906 **success** (backend, lifecycle, application; completed 18:51:40 UTC), checked before this slice's first push |
| Earlier main CI | Run 45452041620 on `799303e` was cancelled (superseded by the next push; concurrency group), not a test failure |
| Open PRs | None besides this slice's |
| Local working tree | `next dev`'s generated `AGENTS.md` block uncommitted and left out of this PR, as in earlier slices |

## 2. Characterization (before any change)

Read from a clean local replay of all 238 migrations on the isolated Phase 5 stack (`pg_policy`, `information_schema`, `pg_proc` live bodies, `pg_publication_tables`), and from `src/` at `dcc62e1`.

### 2.1 Access to `public.notifications`

| Property | Observation |
|---|---|
| SELECT | "Users can view own notifications" (`auth.uid() = user_id`) **and** "Admins can view all notifications" (`has_role(auth.uid(), 'admin')`). **An admin can read every account's rows.** RLS does not isolate an operator; only a `user_id` filter in the query does |
| UPDATE | Only "Users can mark own notifications read" (own row, using and check). No admin UPDATE policy: an admin cannot mark another account's row, including another admin's. Any column of an own row may be changed (NM-1 §7.4, carried) |
| DELETE | Own rows only |
| INSERT | "Admins can insert notifications": an admin may insert a row for any user, unaudited (NM-1 §4.1, carried) |
| Grants | `authenticated` SELECT/INSERT/UPDATE/DELETE; `anon` none |
| Indexes | `(user_id, created_at desc)` and the same `where read_at is null`: they serve the per-account list, keyset and unread count |
| Realtime | Table in `supabase_realtime`. Realtime applies RLS, so an unfiltered admin subscription would receive every account's changes; the subscription must name `user_id` |

**Conclusion:** existing database capabilities are sufficient. No migration or retention policy is needed for this slice.

### 2.2 Producers of admin rows (live bodies)

Fourteen functions write rows to accounts holding the admin role, one row per admin account per event (a loop over `user_roles where role = 'admin'`). These are the only admin producers; ten other functions that mention `has_role` use it only for access checks. No producer was changed.

| Function | NM-1 | Type / severity | Title (stored) | Body (stored) | Link | Related request |
|---|---|---|---|---|---|---|
| `notify_admins_new_vendor_application` (trigger) | N-APP-02 | `vendor_application` / warning | New vendor application | business name, category | `/admin/applications` | — |
| `vendor_propose_quote` | N-QTE-01 | `job_status` / info | Quote proposal ready for review | fixed | `/admin/requests` | yes |
| `homeowner_respond_to_quote` | N-QTE-05 | `job_status` / warning | Quote declined | fixed | `/admin/requests` | yes |
| `private.offer_terms_rematch` | N-QTE-11 | `job_status` / warning | Matching after a decline needs attention | fixed | `/admin/requests` | yes |
| `record_job_operation` | N-APT-02, N-FUL-07, N-CXL-01/02 | `job_status` / info | Service update | kind + actor's reason (free text) | **`/notifications`** | yes |
| `respond_to_reschedule_request` | N-APT-03 | `job_status` / info | Proposed time accepted / declined | fixed | **`/notifications`** | yes |
| `run_lifecycle_batch` (inactive: no scheduler) | N-FUL-06 | `job_confirmation` / warning | Unconfirmed completion needs review | fixed | `/admin/requests` | yes |
| `homeowner_raise_dispute` | N-FUL-09 | `dispute` / warning | Service dispute needs review | homeowner's reason | `/admin/disputes` | yes |
| `appeal_dispute_resolution` | N-FUL-11 | `dispute` / warning | Dispute resolution appealed | fixed | `/admin/disputes` | yes |
| `open_support_ticket` | N-SUP-01 | `support` / info | Support request `<number>` | subject | `/admin/tickets` | when linked to a job |
| `post_support_message` | N-SUP-02 | `support` / info | Reply on `<number>` | subject | `/admin/tickets` | — |
| `vendor_accept_job` (replacement) | N-CXL-03 | `job_status` / warning | Replacement accepted the offer | fixed | `/admin/requests` | yes |
| `homeowner_respond_replacement` | N-CXL-05 | `job_status` / info | Replacement accepted / declined | fixed | **`/notifications`** | yes |
| `homeowner_request_plan_stop` | N-REC-02 | `job_status` / warning | Homeowner asked to stop future visits | homeowner's reason | `/admin/requests` | yes |

**Links.** Four admin routes, plus `/notifications` from the three loops that share one call with homeowners or providers. `/notifications` is homeowner-only: the page sends any account without the homeowner role to its default portal ([notifications/page.tsx:33](../src/app/%28homeowner%29/notifications/page.tsx#L33)), so for an admin the stored link never opened anything useful. Historical rows (earlier producer bodies) and rows an admin inserted directly can carry any link or text.

### 2.3 Readback, read state and reusable parts

- **Admin readback: none.** The bell and `/notifications` are homeowner-only ([Header.tsx:109](../src/components/layout/Header.tsx#L109), [roles.ts:67](../src/lib/auth/roles.ts#L67)); operators work from queues (NM-1 §4.1).
- **Admin route access.** Server: the proxy redirects an anonymous visitor to `/login?redirect=…` and a signed-in non-admin to `/` ([proxy.ts](../src/proxy.ts)). Client: the admin layout re-checks `has_role(uid, 'admin')` and renders nothing else until it passes ([admin/layout.tsx](../src/app/admin/layout.tsx)).
- **Reusable from 7.2B:** the vendor hook (keyset pages of 25, exact unread count, guarded mark-read on the caller's rows only, no optimistic writes, realtime per account), `notificationKeyset.ts`, the strict local-path parser in `notificationDestination.ts`, the vendor row's structure and contrast fixes, `PageHeader` and `PageState`. Every one of the vendor hook's reads, counts, writes and its realtime subscription already names `user_id = auth.uid()`, which is what an admin needs.
- **Request record deep link:** `/admin/requests?request=<uuid>` opens one request's record (`parseRequestsQuery`, [adminOperations.ts:93](../src/lib/adminOperations.ts#L93)). No other admin page takes a record parameter.

## 3. Decision applied

| Item | Answer | Source |
|---|---|---|
| OD-5 first step | Admin page for existing notices addressed to the signed-in operator | Owner, DEC-2026-068 |
| Everything else in OD-5 | Not approved: external alerting, email, producers, automation | Owner, DEC-2026-068 |

Implementation choices for Codex are in §7.

## 4. What changed

| Path | Change |
|---|---|
| `src/app/admin/notifications/page.tsx` | New page inside the admin layout and its role guard |
| `src/hooks/useOwnNotifications.ts` | (Superseded by §11: now binds `OwnNotificationsController` to the signed-in account.) The 7.2B vendor hook's body, moved unchanged except: the realtime channel prefix is a parameter (`vendor-notifications` or `admin-notifications`), and a realtime insert or update naming another account is ignored (defense in depth for admins) |
| `src/hooks/useVendorNotifications.ts` | Now a two-line wrapper over `useOwnNotifications(enabled, "vendor-notifications")`; vendor behavior and channel name unchanged |
| `src/lib/notificationDestination.ts` | Adds the `admin` reader (§5.3). Homeowner and vendor results unchanged |
| `src/lib/adminNotificationPresentation.ts` | Stored title and body as bounded text with fallbacks (§5.2) |
| `src/components/admin/AdminNotificationItem.tsx` | Row: title, body, "Unread" text, Eastern recorded time, destination label |
| `src/components/admin/AdminSidebar.tsx` | "Notifications" entry directly under Overview, outside the task groups |
| `src/lib/adminOperations.test.ts` | The admin-navigation test covers the new top-level entry |
| `tests/unit/admin-notification-readback.test.ts` | New |
| `supabase/tests/130_admin_notification_readback.sql` | New |
| `tests/e2e/admin-notifications.spec.ts` | New |

## 5. Behavior

### 5.1 Readback

- **Who.** The proxy and the admin layout admit only `has_role(uid, 'admin')`; the page never mounts, and makes no request, for anyone else. Every read, count, write and the realtime subscription names `user_id = <signed-in operator>`. Because RLS lets an admin read all rows, that filter is the isolation; SQL 130 pins both facts.
- **Order and paging.** Newest first by `created_at desc, id desc`, 25 per page with "Load older" (keyset cursor). Every row of the operator's history is reachable; no date cutoff.
- **Unread count.** Exact (`count: exact, head: true`, `read_at is null`) over the operator's own history, with "· X shown, Y in older notices" when some unread rows are not loaded.
- **Read state.** Per account: each admin has their own row for an event, so marking one admin's copy leaves the others unread. Opening sets `read_at` once (guarded by `read_at is null` and the operator's `user_id`), then navigates; an already read notice navigates with no write. "Mark visible as read" marks only the loaded, displayed unread rows; the page says so. No optimistic writes: after any write the affected rows and the count are read back. A failed write shows a focused alert, leaves the row unread and offers a direct link. (Superseded by §11.2: what is said after a failed write response depends on the readback.)
- **Realtime.** Channel `admin-notifications:<operator>`, filtered to the operator. A row naming another account is ignored even if delivered. If the channel errors or times out: "Live updates are unavailable. Refresh to check for new notices."
- **States.** Loading, error with "Try again", empty ("No notices for your account" with wording that promises nothing), older-page error with retry, end of history.

### 5.2 Presentation and historical rows

The operator sees the stored title and body **as text**: the row is addressed to them, every admin can already read it under RLS, and the underlying reasons are on the queues. React escapes it; nothing is parsed as HTML or turned into a link. Control characters and whitespace runs collapse to single spaces; title is bounded at 200 characters and body at 600 (by code point, with "…"). A blank or non-text title shows "Notice recorded"; a blank body is omitted. Unknown types get a generic icon. **Severity is not shown**: it is the producer's label, not an approved priority or SLA. The stored `link` is never rendered.

### 5.3 Destinations

`notificationDestination(row, "admin")`:
1. Parse the link with the 7.2B strict parser: drop anything not starting with a single `/`, over 512 characters, with a backslash, whitespace or control character, encoded `.`/`/`/`\`/NUL, a `.` or `..` segment, or a different origin.
2. **Keep** an existing admin route (26 static pages including the Overview; a unit test walks `src/app/admin` and requires the list to equal every static page except `/admin/notifications` itself and the retired `/admin/smart-picks`). Query strings and anchors are dropped.
3. **Request record.** `/admin/requests` with a well-formed related request id opens `/admin/requests?request=<id>`.
4. **Anything else** — `/notifications`, `/dashboard`, vendor routes, unknown admin paths, unsafe links — opens the request record when the row has a well-formed related request, else the Overview (`/admin`).

A destination confers no permission; each admin page checks access itself.

### 5.4 In-app-only statement and navigation

A labelled region, "In-app notices only", on every state of the page: records saved inside the app; nothing emailed, texted or pushed; a notice listed or marked read does not show that anyone was alerted or acted; each admin has their own copy; open work is tracked in the Overview's queues and many queue items have no notice. Navigation: "Notifications" directly under Overview, with `aria-current` on the page. No unread badge (as 7.2B: it would add a count query to every admin page).

## 6. Evidence

### 6.1 Results (local, 2026-11-24 ET, on the implementation commit; final-head CI in the PR)

| Check | Result |
|---|---|
| SQL 130 (single file, isolated stack, plain psql as CI's lifecycle runner does) | **47/47** |
| Full SQL suite (clean replay of 238 migrations, `supabase test db`) | **123 files / 8,974 PASS** (7.5D baseline 122 / 8,927, plus SQL 130's 47) |
| Unit (full, `--exclude '.phase5-local/**'`) | **1,366/1,366** in 83 files; new `admin-notification-readback` (45); admin-navigation test extended |
| Typecheck, lint, secret scan, `git diff --check` | PASS |
| Production build (CI's synthetic Supabase env, one worker) | PASS; `/admin/notifications` static route present |
| Browser `admin-notifications.spec.ts` | **11/11.** Full run 10/11; the 11th ("mark visible") rendered nothing within 5 s at load average ≈ 9 and passed on rerun. Two test defects fixed before that run: Tab order (the in-app note's Overview link precedes the first notice) and the non-admin redirect waiting for the public home page's `load` (now `waitUntil: "commit"` and an exact redirect URL); the multi-navigation test is marked slow |
| Browser regressions: `vendor-notifications` (shared hook), `admin-operations` (navigation), `portals` (portal guards) | **49/49.** Full run 47/49; the two vendor failures were "nothing rendered within 5 s after navigation" (load ≈ 5–6) and both passed on rerun |
| Migrations, producers, policies, grants | Unchanged: the diff touches no `supabase/migrations` file; SQL 130 pins the five policies |

Not run locally: the full browser suite (`test:a11y`); exact-head CI is the authority.

### 6.2 Mutations

| ID | Mutation | Caught by |
|---|---|---|
| S-M1 | Page query without `user_id = auth.uid()` | SQL 130: 7 fail |
| S-M2 | Unread count without `user_id` | 3 fail |
| S-M3 | Mark without `read_at is null` | 5 fail |
| S-M4 | Inclusive id cursor (`<=`) | 3 fail |
| S-M5 | Timestamp-only cursor | 4 fail |
| S-M6 | An admin UPDATE policy added | 8 fail (an earlier form of assertion 4 errored instead of failing; it now aggregates every UPDATE policy) |
| U-M1 | Admin destination keeps any parsed path | unit: 13 fail |
| U-M2 | No request-id validation | 1 fail |
| U-M3 | `/admin/notifications` listed as a destination | 2 fail |
| U-M4 | Non-admin links not mapped to the request record | 29 fail |
| U-M5 | No length bound | 1 fail |
| U-M6 | No blank-title fallback | 1 fail |
| B-M1 | Client page query without the `user_id` filter (rebuilt) | browser: 3/3 selected tests fail (another admin's rows listed: 75 rows instead of 61; empty state lost; request without `user_id`) |

Sources were restored after each mutation and the application rebuilt from the unmutated tree.

## 7. For Codex review

| ID | Choice | Why | Alternative |
|---|---|---|---|
| D-1 | "Notifications" as a top-level entry under Overview, not inside a task group | The notices span every queue; the first alert surface should not hide under one group | Inside "Trust & Support" beside Owner Emails and Email Evidence |
| D-2 | Stored title and body shown as text, not controlled wording | The operator is the addressee and can already read every row; reasons are already on the queues. DEC-2026-065's controlled wording answered a vendor disclosure question | Controlled wording per producer title, as 7.2B |
| D-3 | Severity not shown | Producer label, not an approved priority (OD-6) | Show "Warning"/"Critical" as text |
| D-4 | `/notifications` and other non-admin links open the request record when request-related | The stored homeowner route sends an admin away; the request record holds the current details | Always the Overview |
| D-5 | Shared `useOwnNotifications` hook | One tested implementation; vendor behavior and channel name unchanged, covered by the vendor spec | A copied admin hook |
| D-6 | No nav badge | Avoids a count query on every admin page | Badge with an exact count |
| D-7 | Title 200 / body 600 code points | Bounds historical and hand-inserted rows; producers' text is shorter except free-text reasons, whose full text is on the linked record | Line clamp with expand |

## 8. Findings and carried items

- **F-1 (characterization).** RLS does not isolate admins on `public.notifications`. Correct for this page only because every query names the operator. Any future admin surface over this table must do the same; SQL 130 pins the policy so a change is deliberate.
- **F-2.** `/notifications` is written to admins by three producers (§2.2) and never was a working admin link. Mapped on read (§5.3); producers unchanged.
- **F-3 (documentation).** `governance/TRACEABILITY.md` holds three TRACE-159 rows (earlier merge resolutions kept stale copies). This slice updates the most complete row only and leaves the others for Codex to decide; no row is deleted.
- **Carried, unchanged:** own-row UPDATE allows any column (the page writes only `read_at`); admin direct INSERT for any user, unaudited; no dedupe key; retention class (G3-06); hosted policy and realtime parity (G2-06); A2 human checks (screen reader, real devices, 200% zoom); 7.5D push timing and deployment READY unverified (§1; the hosted schema state was read back by Codex).

## 9. Not done

Codex review; merge (= deploy, DEC-2026-037); any hosted read or push (none is needed: no migration); A2 human checks; OD-1, OD-2, OD-6, OD-5 external channel; HQ-1..HQ-6.

## 10. Rollback

Revert the merge commit. No data, schema or configuration changes. `read_at` values operators set stay; they are the operator's own state and harmless.

## 11. Review repair (Codex PR #202 findings F-1, F-2; 2026-11-24 ET)

Base: `main` `afa0be8` (#202 merged without these repairs; its tree equals `8569ece`, on which the repair was built and tested). The repair commits were first pushed to the merged #202 branch, where they cannot reach `main`; they were cherry-picked unchanged (identical tree) onto `claude/phase7-5e-review-repair`.

Scope as instructed: no migration, hosted mutation, merge, deployment, email activation, scheduler, booking or payment change. Own-account query filters and the admin and vendor route guards are unchanged. (Codex's F-1/F-2 are not this record's §8 F-1/F-2.)

### 11.1 F-1 — account-bound state

**Finding.** The hook's state outlived the account it was loaded for. `load` and counts were guarded only against a newer refresh; `loadOlder`'s cursor, write results, reconciliation and realtime callbacks were not guarded at all, and `open()` navigated after `await markRead` whatever had happened meanwhile. After a sign-out or account change, a late response could put the previous account's rows, count or feedback on screen, or navigate.

**Repair.**
- `src/lib/ownNotificationsController.ts` (new) holds all state for one **owner**. `setOwner(next)` starts a new epoch: state is reset at once, the previous realtime channel is removed and a channel for the new owner is subscribed, and every request, write, readback, count and realtime/status callback started under an older epoch is discarded on completion. Writes started under an older epoch return `stale`. Each request uses the owner captured when it started, so its `user_id` filter is never the next account's. A → B → A does not revive the first session's responses (epochs, not owner ids).
- `src/hooks/useOwnNotifications.ts` binds the controller to `enabled && user.id` (`null` when signed out or disabled; also on unmount) and never returns a snapshot whose owner differs from the current account, so not even one render shows the previous account's rows.
- Both pages (`/admin/notifications`, `/vendor/notifications`) render their body keyed by the account id, so feedback, announcements and focus targets are discarded on an account change or sign-out. `open()` and "Mark visible as read" act on the outcome: `stale` shows nothing and navigates nowhere (`src/lib/ownNotificationFeedback.ts`).
- Regression found by the browser run and fixed: the controller notifies React synchronously, so rows loaded by "Load older" rendered before the page set its focus target, and focus stayed on the button (admin and vendor pagination tests). The page now focuses the first new row directly when it has already rendered.

### 11.2 F-2 — uncertain mark-read outcomes

**Finding.** A failed write response was reported as "This notice wasn’t marked as read" / "The list now shows what was saved", although the write may have committed, and even when the readback after it had also failed (that readback silently returned).

**Repair.** `markRead` and `markVisibleRead` resolve to one of:

| Outcome | When | Page says / does |
|---|---|---|
| `read` | Every requested row is confirmed read by the write response, or by a successful readback (or no longer exists) | Single: opens the destination. Bulk: "N visible notices marked as read." |
| `unread` | A successful readback shows rows still unread | "This notice wasn’t marked as read … It still shows as unread" / "Notices weren’t all marked as read. The list now shows what was saved: N visible notices still unread." |
| `unknown` | Any row's state is established by neither the write response nor a successful readback | "We couldn’t confirm whether this notice was marked as read" / "…which notices were marked as read": the change may have been saved, the list may be out of date; "Refresh notices" (and the direct link for a single notice). The list is not changed by inference |
| `stale` | The account changed first | Nothing |

A failed chunk's write response is never treated as "not written": it and all later chunks are read back. Readback chunks that succeed are applied even if another fails; any failed chunk makes the outcome `unknown`. A successful write that did not return a requested row still needs a readback.

### 11.3 Tests

`tests/unit/own-notifications-controller.test.ts` (new, 24): a fake client holds **every** request until the test releases it, so completion order is chosen by the test.

| Area | Scenario (A's requests held, switch to B or sign out, then A's released) | Asserted under B / signed out |
|---|---|---|
| Initial load | A's page and count; A's failed page after B loaded | No A rows; count stays B's (or unknown); B not put in error |
| Pagination | A's older page (success, failure) | No A rows, no "older failed", `loadingMore` false |
| Count | Two A counts (success 99, failure) | B's count, `countFailed` false |
| Write result | A's single and bulk write confirmed after the switch | `stale`; no A readback or count issued; B rows, count, busy state unchanged; no feedback, no navigation |
| Reconciliation | A's readback and count after the switch (single, bulk; colliding id) | `stale`; B unchanged; no feedback, no navigation |
| Realtime | A's INSERT, DELETE and CHANNEL_ERROR after the switch | A channel removed; B unaffected; B's own channel works and still ignores a foreign row |
| A → B → A | First-session page and count | Not applied to the second session |
| Disable / sign-out | During single, bulk and older | State empty, channel removed, late result and realtime ignored, no further request; actions while signed out are inert |
| Filters | Every request | Names the owner it started for |
| F-2 single and bulk | Write committed, response failed: readback success → `read`; readback failure → `unknown`; readback shows unread → `unread` | Item state and page wording as above; `unknown` wording never says "wasn’t marked" or "shows what was saved" |
| F-2 chunks | 150 rows: chunk 1 confirmed, chunk 2's response failed, its readback failed | `unknown`; chunk 1 shown read, chunk 2 as last read |

Browser (`tests/e2e/admin-notifications.spec.ts`, 2 new): committed write with a failed response, single and bulk, with readback success and failure (the store commits, then answers 500); signing out while a write is held, then releasing it: URL stays `/login`, no feedback, no rows, no further request.

### 11.4 Results (local, 2026-11-24 ET)

| Check | Result |
|---|---|
| `own-notifications-controller` (new) | **24/24** |
| Unit (full, `--exclude '.phase5-local/**'`, on `7b72d18`) | **1,390/1,390** in 84 files (1,366 + 24). `0610688` changes only the two pages, which the unit suite does not import |
| Typecheck, lint, secret scan, `git diff --check` | PASS (typecheck and lint repeated after `0610688` and the final test change) |
| Production build (CI's synthetic env, one worker) | PASS on `0610688` |
| Browser on `7b72d18` | 60/62: admin and vendor pagination failed, focus not moved to the first older notice. A regression from this repair, fixed in `0610688` (§11.1) |
| Browser on `0610688`: `admin-notifications` (13, incl. 2 new) + `vendor-notifications`, `admin-operations`, `portals` (49) | **62/62** (5.2 min) |
| Commits `d34b2a2` / `8b75582` | The same changes pushed to the already-merged #202 branch and later merged by #204; their trees are identical to `7b72d18` / `0610688` (`0979a8d9…`, `181bda23…`), so every result in this table applies to both. Their duplicate rows were consolidated here on 2026-11-25 ET ([7.5F plan](PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md) §1.2) |
| `admin-notifications` after tightening the sign-out test | **13/13** (2.3 min). An earlier run of the same spec at load average 21–28 (other sessions) took 25 min and failed 4 tests that do not touch the changed test (both overview tests, pagination, mark visible); their errors were not captured. They passed at normal load and are recorded here, not explained |
| SQL | Not rerun: no SQL, migration or policy change |

| ID | Mutation | Caught by |
|---|---|---|
| U-M7 | Epoch check always true (`current()`) | unit: 9 fail (writes, reconciliation, realtime, sign-out, filter test). Load and count switches are still caught by the refresh generation, which an owner change also bumps |
| U-M8 | Failed readback reported as `unread` | unit: 4 fail (F-2 single, bulk, chunks, unreturned row) |
| B-M2 | `stale` outcome navigates (pre-repair page behavior), rebuilt | browser: the sign-out test fails, recording `/login?redirect=%2Fadmin%2Fdisputes`. Its first version **missed** this mutant: the signed-out layout bounces the late push back to `/login`, which a loose URL check accepted. The test now records every navigation after the release |

Sources were restored after each mutation and the application rebuilt from the unmutated tree. Not run locally: the full browser suite (`test:a11y`); exact-head CI is the authority (PR comment).
