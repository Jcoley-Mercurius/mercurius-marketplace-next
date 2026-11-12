# Phase 7.2B — Vendor in-app notification readback (TRACE-153)

**Status:** IMPLEMENTED FOR REVIEW (Codex). Draft PR. Not merged, not deployed, nothing activated.
**Base:** `main` `f205b5980986fecbf70df4825d2d25eed25adee5` (#163 merge). Main CI run 43067601866 on that commit: **success** (backend, lifecycle and application jobs), checked 2026-11-11 before this record was written.
**Branch:** `claude/phase7-2b-vendor-notification-readback`, from that `main`.
**Authority:** [PHASE-7-NOTIFICATION-CONTRACT](PHASE-7-NOTIFICATION-CONTRACT.md) §8 (G1-01/G2-01) and §9; owner decision [DEC-2026-065](DECISION-LOG.md) (2026-11-11); Codex's 7.2B implementation choices in the same instruction; DEC-2026-063 (O-11); DEC-2026-041 item 6; MTS §6 l.150; MDS accessibility rules.

---

## 1. Decisions applied

| Item | Answer | Source |
|---|---|---|
| B2 / G3-07 historical rows | All notices addressed to the vendor's own account; no date cutoff | Owner, DEC-2026-065 item 1 |
| G3-05 free text (vendor readback) | Standard wording with links; raw customer or operator reasons are not shown | Owner, DEC-2026-065 item 2 |
| B1 nav position | Immediately after Jobs & Requests, before Messages | Codex |
| R1 list bound | "Load older" keyset pagination | Codex |
| R2 unread count | Exact count over the caller's eligible notices | Codex |
| R3 bulk scope | "Mark visible as read": loaded, displayed unread rows only | Codex |
| R4 cutoff | None (B2) | Owner |

The approval authorizes no production query (the contract's proposed type-and-month aggregate was **not run**), no data cleanup, and no change of recipients, channels, payments or automation.

## 2. What changed

| Path | Change |
|---|---|
| `src/app/vendor/notifications/page.tsx` | New page inside the existing vendor layout and its `has_role('vendor')` guard |
| `src/hooks/useVendorNotifications.ts` | New vendor-only hook. The shared homeowner hook `useNotifications` is untouched |
| `src/lib/notificationKeyset.ts` | Keyset cursor filter for `(created_at desc, id desc)` |
| `src/lib/notificationDestination.ts` | Role-aware destination helper, extracted from the homeowner page |
| `src/lib/vendorNotificationPresentation.ts` | Controlled vendor wording |
| `src/components/vendor/VendorNotificationItem.tsx` | Row: controlled title and description, "Unread" text, Eastern recorded time, destination label |
| `src/components/vendor/VendorSidebar.tsx` | "Notifications" nav item (B1) |
| `src/app/(homeowner)/notifications/page.tsx` | Imports the shared helper; its local copy is removed. Results are identical (§5) |
| `supabase/tests/119_vendor_notification_readback.sql` | New SQL evidence (§6) |
| `scripts/offer-terms-concurrency.mjs` | Notice-count assertions in C15, C16, C17 and C22 |
| `tests/unit/*.test.ts`, `tests/e2e/vendor-notifications.spec.ts` | New unit and browser evidence |

**Not changed:** any migration, producer function, stored notification, grant, policy, realtime publication, email path, feature gate (`offer_terms` stays off), the 7.1 files, or homeowner notification behavior.

## 3. Readback behavior

- **Who.** The vendor layout admits only `has_role(uid, 'vendor')`. Every read, count and write names `user_id = auth.uid()`, and RLS enforces the same (SQL 119). Anonymous visitors go to `/login/vendor`; a homeowner is sent to the homeowner portal before the vendor layout renders.
- **Order and paging.** Newest first by `created_at desc, id desc`. Each page asks for 26 rows and shows 25; the 26th says whether more exist. "Load older" uses the last shown row as the cursor: `created_at < c or (created_at = c and id < i)`, with the values double-quoted so a PostgREST timestamp with microseconds and `+00:00` stays literal. Rows are merged by id, so a row cannot appear twice. Every row is reachable; there is no fixed total.
- **Unread count.** `count: exact, head: true` on `read_at is null` over the caller's whole history. Shown as "N unread notices", plus "· X shown, Y in older notices" when some unread rows are not loaded. If the count fails, the page says so instead of showing a number.
- **Opening.** One update with `user_id`, `id` and `read_at is null`, returning the row. Then it navigates. An already read notice is opened without a write.
- **Mark visible as read.** The ids of the loaded, displayed unread rows only, in chunks of 100, with the same guards. Unloaded rows are never touched, and the page says so beside the button.
- **No optimistic writes.** After any write, rows that were not returned (failed, already read elsewhere, or deleted) are read back, and the count is refreshed. A failure shows an alert that takes focus. An open that fails stays on the page and offers a link to the destination.
- **Realtime.** A per-user channel prepends inserts, applies `read_at` updates, removes deletes and refreshes the count. If the channel errors or times out: "Live updates are unavailable. Refresh to check for new notices." with a Refresh button.
- **States.** Loading (status), error with Try again, empty ("No notices yet", no promises), older-page error with retry, end of history ("You've reached your oldest notice."). Focus moves to the first newly loaded row after "Load older"; a polite live region announces how many loaded.

## 4. Controlled wording (DEC-2026-065 item 2)

The vendor page never renders the stored `title`, `body` or `severity`. `presentVendorNotification` uses only:
- the stored `type`;
- the exact stored title, compared with the literal titles in the live producers.

Its copy is fixed text, and nothing from the row is interpolated. A title that differs in any way (appended text, other wording) is not recognized and gets its type's generic copy. An unknown type gets "Account update recorded". Prototype keys (`__proto__`, `constructor`) are not matched.

| Producer event (contract §5) | Stored title(s) | Vendor title |
|---|---|---|
| N-REQ-01 offer; N-REQ-05 legacy | "New job offer — respond within four hours" / "… 24 hours" | Job offer recorded |
| N-QTE-02 | "Your quote proposal was returned" | Quote proposal returned |
| N-QTE-04 | "Your quote was sent" / "Your quote was corrected and sent" | Quote sent to the homeowner / Quote corrected and sent |
| N-QTE-10 (DEC-2026-063) | "Homeowner accepted your terms" / "Homeowner declined your terms" | same |
| N-APT-01 | "Appointment recorded" / "changed" / "unchanged" | Appointment update recorded |
| N-APT-02, N-FUL-07, N-CXL-01/02 | "Service update" | Service update recorded |
| N-APT-03 | "Proposed time accepted" / "declined" | Homeowner accepted / declined a proposed time |
| N-FUL-03 | "Homeowner confirmed the job" | Homeowner confirmed completion |
| N-FUL-04 | "Job completed" | Job closed out |
| N-CXL-01 | "Job cancelled" | Job cancellation recorded |
| N-CXL-05 | "Replacement accepted" / "declined" | Homeowner accepted / declined a replacement |
| N-PRC-01..04 | price approval, offer approval, paused, published | Price sent for your approval, Offer sent for your approval, Price paused, Price published |
| N-SUP-03 | "Mercurius replied on <ticket>" (prefix only) | Support reply |

**Historical safety.** Every description says an update *was recorded*, then names where the current details are ("Check Jobs & Requests …", "Check Pricing & Packages …", "Open Support …"). The tests forbid "respond within", "four hours", "24 hours", "is scheduled", and *paid / charged / refunded / released / deposited / transferred*. The offer copy says offers close at their deadline and asks the vendor to check whether this one is still open. The completion copy says payout status is tracked separately in Earnings & Payouts.

**Withheld text:**
- appointment times and the operator's reason (N-APT-01);
- the actor's reason (N-APT-02, N-FUL-07, N-CXL-01/02);
- the operator's pause reason (N-PRC-03, whose operator form says "The vendor will see it": vendors no longer see it here, by DEC-2026-065);
- package and offer names, the ticket number and subject.

## 5. Destinations

`notificationDestination(row, "homeowner")` is the removed homeowner implementation, unchanged. The unit test compares it with a verbatim copy over 28 links × with/without request (56 cases).

`notificationDestination(row, "vendor")`:
1. **Drop** anything not starting with a single `/`, longer than 512 characters, or containing a backslash, whitespace or control character. Also drop encoded `.`, `/`, `\` or NUL (`%2e`, `%2f`, `%5c`, `%00`), any `.` or `..` path segment, and anything that does not parse as same-origin.
2. **Keep** an existing vendor route (`/vendor`, jobs, notifications, messages, earnings, packages, pricing, marketing, compliance, profile, support), with a trailing slash removed. Query strings are always dropped. An anchor is kept only where it exists (`/vendor/packages#price-approvals`, `#offer-approvals`).
3. **Map** obsolete and homeowner-only links:
   - `/vendor/requests` → `/vendor/jobs`;
   - `/support` → `/vendor/support`;
   - `/messages` → `/vendor/messages`;
   - `/notifications` and `/dashboard` → `/vendor/jobs` for a request-related row, otherwise `/vendor`.
4. **Otherwise:** `/vendor/jobs` for a request-related row, else `/vendor`. Admin routes are never kept.

The body is never read. A destination confers no permission; each vendor page checks the account itself.

## 6. Evidence

| Check | Result |
|---|---|
| Unit (full suite, `--exclude '.phase5-local/**'`) | **807/807** in 65 files; new: `notification-destination` (63), `vendor-notification-presentation` (33), `notification-keyset` (2) |
| Typecheck, lint, secret scan, build, `git diff --check` | PASS |
| SQL 119 (single file, isolated stack) | **86/86** |
| SQL 119 mutations | Timestamp-only cursor: 4 fail. Inclusive id cursor: 3 fail. No `read_at is null` guard: 4 fail. Dropping `user_id` from the count query: survives, because RLS returns only the caller's rows (defense in depth, expected) |
| Full SQL suite (isolated stack, clean replay of 226 migrations) | **110 files / 7,311 PASS**, including SQL 119 |
| `scripts/offer-terms-concurrency.mjs` | PASS 3/3 runs. New assertions: C15 one homeowner N-QTE-09 per acceptance; C16 one provider N-QTE-10 for six same-key calls; C17 exactly one notice for the winning answer and none for the refused one (3 rounds); C22 one decline notice plus one N-QTE-11 per admin |
| Real local PostgREST (scratch script, not committed) | 61 rows in groups of four equal timestamps, pages of 25: 3 pages, every row once in database order, cursor `2026-01-01T10:00:03.123456+00:00` parsed. Exact count matches SQL. Mark visible returned exactly the visible unread rows; repeat 0; cross-account update 0 |
| Browser `vendor-notifications.spec.ts` | **11/11** (light 320 px and dark 1440 px) |
| Browser mutations | Render the stored title, and drop the `id` filter from mark visible: **6 of 11 fail** |
| Full browser suite (`test:a11y`, local) | **658 passed, 29 failed.** All 29 are in `request.spec.ts` (26), `invitation-binding.spec.ts` (2) and `finance-commands.spec.ts` (1), which this slice does not touch; most are timeouts. The machine had about 5 GB of RAM and a load average of about 9, and the run took 1.0 h. A rerun of those three files alone timed out on different finance tests that had passed in the full run, so it was stopped. Not diagnosed locally; the PR's CI run is the authority |

**SQL 119 covers:**
- **A.** RLS isolation:
  - a vendor reads only its own rows;
  - another vendor and a homeowner are invisible;
  - anon gets 42501;
  - cross-account update and delete change nothing;
  - a vendor cannot insert, even to itself.
- **A.** Keyset paging at sizes 2, 4 and 25 equals the database order, with no repeats, newest first, and equal timestamps ordered by id.
- **A.** Counting and marking:
  - the exact unread count, and only the caller's;
  - mark visible updates exactly the shown unread ids and leaves unloaded rows unread;
  - an already read row keeps its `read_at`;
  - repeating changes no row and no `read_at`;
  - opening marks once, and again changes nothing.
- **B.** DEC-2026-063, through the real commands:
  - Gate off: no offer, no notice.
  - N-REQ-01: one row, to the offered provider only.
  - A failed notice write rolls back the provider's acceptance (still `matched/offered`, no N-QTE-09). The retry writes exactly one N-QTE-09, to the homeowner only.
  - A failed notice write rolls back the homeowner's answer (no response row). The retry writes exactly one N-QTE-10, to the terms' provider only. Replaying the key writes none; a second key is refused and writes none.
  - The decline notice is fixed text. The homeowner's reason ("gate code 4471") appears in no notice. A re-match that finds no one writes no N-QTE-11.
  - **Switch-off (SQL 116:332–339 preserved):**
    - a pending other-terms offer can't be accepted, does not enter `awaiting_terms`, and writes no N-QTE-09;
    - terms accepted before switch-off are still answerable, take effect, and write exactly one N-QTE-10;
    - a decline whose re-match fails (forced as SQL 117 does) still succeeds and writes one N-QTE-10 plus one N-QTE-11 per admin, none to a non-admin.
  - The vendor reads its own four terms answers through the readback query; V and P1 read none.

**Browser spec covers:**
- Controlled copy for every event family on the page, with injected private text in stored titles and bodies (reasons, phone, email, ticket number, `<img onerror>`) shown nowhere, and no external link.
- Every request carries `user_id=eq.<vendor>`. Other accounts' rows never appear.
- Exact count with shown/older split.
- Nav order and `aria-current`, at desktop and in the mobile sheet.
- Load older with keyboard focus moving to the first new row; 61 rows over three pages with groups of equal timestamps across both page boundaries, shown once each in order; the exact cursors sent.
- Mark visible sends exactly the four displayed unread ids with `read_at=is.null` and only a `read_at` body; the two unseen unread rows stay unread and show as unread once loaded.
- Opening by keyboard (Tab focus ring, Enter) sends one guarded write and navigates. An already read notice navigates with no write, keeping its anchor.
- Unsafe and legacy links map to Overview or Jobs & Requests.
- A failed open or bulk write: focused alert, row still unread, count unchanged, then recovery.
- Loading, empty, error/retry and older-page error/retry.
- A live insert appears with controlled copy and an updated count. Unavailable live updates show the notice, and Refresh reloads.
- Anonymous and homeowner sessions are denied; the homeowner `/notifications` page is unchanged; a vendor on `/notifications` goes to `/vendor`.
- axe (WCAG 2.2 AA tags) and no horizontal scroll at 320 px and 1440 px, including hovered read and unread rows.

## 7. Findings during implementation

1. **Hover contrast (fixed for vendors; homeowner carried).** On a hovered row, muted text on the hover surface measured 4.35:1 (light) and 4.34:1 (dark `accent-subtle`), below 4.5:1. Vendor rows now use `text-slate` for the description and time line, and the spec checks hovered read and unread rows. The homeowner `NotificationItem` uses the same `hover:bg-surface-hover` + `text-muted-foreground` pairing; it was **not changed** here (homeowner behavior is preserved). It belongs with G2-04.
2. **postgrest-js retries GET/HEAD on 503/520** (up to its default retries, with backoff). A transient 503 on a read is retried before the page shows an error. The browser fixture uses 500 to exercise the error path. Writes (PATCH) are not retried.
3. **Copy defect caught by tests:** an early draft lowercased "Jobs & Requests" inside sentences, and used "released", which is retired payout vocabulary here. Both were fixed before commit.
4. **Carried, unchanged:** recipient RLS UPDATE still allows any column, not only `read_at` (contract §7.4 hardening; needs a migration). The vendor page writes only `read_at`.

## 8. Not done / open

- Codex review; merge; deployment (merge to `main` deploys, DEC-2026-037). No hosted migration push is needed (no migration).
- No hosted query, log or realtime readback. Hosted realtime publication parity stays G2-06.
- A2 human checks (screen reader, real devices, 200% zoom) are not performed; booking-readiness register.
- G3-05 for homeowners and producer copy, G3-01..04, G3-06, G3-08, G3-09 stay open. The homeowner page keeps its current bounded list, unread-count and mark-all behavior (contract §9).
- No unread badge on the vendor nav item. The exact count is on the page. A nav badge would add a count query to every vendor page; it was left out as a scope choice for Codex to confirm.

## 9. Rollback

Revert the merge commit. No data, schema or configuration changes. `read_at` values set by vendors stay; they are harmless and are the recipient's own state.
