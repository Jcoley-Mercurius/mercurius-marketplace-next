# Phase 7.5E — Admin in-app notification readback (TRACE-159, OD-5)

**Status:** IMPLEMENTED FOR REVIEW (Codex). Not merged, not deployed, nothing activated. No hosted action.
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
| `src/hooks/useOwnNotifications.ts` | The 7.2B vendor hook's body, moved unchanged except: the realtime channel prefix is a parameter (`vendor-notifications` or `admin-notifications`), and a realtime insert or update naming another account is ignored (defense in depth for admins) |
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
- **Read state.** Per account: each admin has their own row for an event, so marking one admin's copy leaves the others unread. Opening sets `read_at` once (guarded by `read_at is null` and the operator's `user_id`), then navigates; an already read notice navigates with no write. "Mark visible as read" marks only the loaded, displayed unread rows; the page says so. No optimistic writes: after any write the affected rows and the count are read back. A failed write shows a focused alert, leaves the row unread and offers a direct link.
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
- **Carried, unchanged:** own-row UPDATE allows any column (the page writes only `read_at`); admin direct INSERT for any user, unaudited; no dedupe key; retention class (G3-06); hosted policy and realtime parity (G2-06); A2 human checks (screen reader, real devices, 200% zoom); 7.5D hosted push and deployment unverified (§1).

## 9. Not done

Codex review; merge (= deploy, DEC-2026-037); any hosted read or push (none is needed: no migration); A2 human checks; OD-1, OD-2, OD-6, OD-5 external channel; HQ-1..HQ-6.

## 10. Rollback

Revert the merge commit. No data, schema or configuration changes. `read_at` values operators set stay; they are the operator's own state and harmless.
