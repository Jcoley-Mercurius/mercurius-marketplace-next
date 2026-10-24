# Phase 6.5 — One-time appointments, Eastern Time and schedule history

TRACE-121. Slice 6.5 of [PHASE-6-SCOPE.md](PHASE-6-SCOPE.md) ("Quotes and scheduling"). Implemented
by Claude for Codex review. Not phase acceptance and not production activation; Phase 6 is not complete.

## Baseline

- 6.4 checkpoint verified: PR #106 (TRACE-119) merged to `main` as `0675805` on 2026-10-23, its
  migration `20261022001000` already on hosted; Codex review of 6.4 is still open. PR #107 (TRACE-120)
  and #108 (Next.js 16.4.3) are also merged.
- Base: `origin/main` `0ba710e` (merge of PR #107), in a separate worktree on branch
  `claude/phase6-5-appointment-confirmation`. The owner's checkout and branch were not touched.
- Hosted, read-only aggregates on 2026-10-24: 11 service requests, 0 with `scheduled_start_at`,
  0 `scheduled`, 0 `job_operations`, every request's `timezone` `America/New_York`. No recorded
  appointment or schedule history exists to migrate or reinterpret.

## Governing requirements

- MPS §6.3: “Scheduling becomes confirmed only after the provider and customer conditions defined
  for that service mode are met”; “Rescheduling preserves history…”; acceptance “Both parties see
  the same confirmed time and timezone.” MPS §6.6 and CFG-006 (rescheduling 48 h free / 24–48 h $25 /
  under 24 h case by case) govern policy consequences, which belong to 6.9.
- DEC-2026-007: vendor acceptance schedules immediately; no payment, quote approval or mutual
  appointment confirmation as a prerequisite to that transition.
- Phase 4 reconciliation (`PHASE-4-RECONCILIATION.md`): appointment time is independent, stored as an
  instant, parties see Eastern Time; state `scheduled` = “Vendor accepted; admin records/changes
  appointment with reason”. This is the approved recording workflow used here.
- MDS §4.1 DateTime (“timezone and locale explicit; keyboard/manual entry supported”), §9 (“Dates
  include timezone where appointment interpretation could differ”), ConfirmAction, FormField, 44 px
  customer controls, WCAG 2.2 AA, 320/1440 reflow.

## Product gap recorded (not resolved here)

**MPS checklist E1 — schedule confirmation is open.** No approved rule defines what makes an
appointment *confirmed* (for example homeowner or provider acknowledgement). This slice therefore never
calls an appointment “confirmed”: it says “Appointment recorded” (by Mercurius, with a reason), shows
the same instant to every role, and adds no acknowledgement step. If the owner defines E1, a later
slice adds the acknowledgement on top of this record. No decision ID was allocated; the existing
approvals were sufficient for everything implemented.

## Characterization before this slice

| Area | Observed (base `0ba710e`) |
|---|---|
| Acceptance | `scheduled` with no `scheduled_start_at`; provider status and vendor card already say “No appointment time recorded yet” (TRACE-099) |
| Command | `record_job_operation` (single definition, `20260904004000`): any participant; `appointment` kind admin-only, future time, refused in progress; per-job advisory lock and row lock; same-key replay; `job_operations` row immutable (Phase 5 trigger) |
| Entry | `JobOperations` used `<input type="datetime-local">` labelled “your device’s local time” and `new Date(value)`: the device timezone decided the instant |
| Readback | Homeowner “Appointment: … Eastern”, admin `toLocaleString … Eastern`, vendor “… ET”: three formats, none with EST/EDT |
| History | No surface read `job_operations`; reasons reached people only through in-app notices |
| Requests | `reschedule_request` stored a proposed time and a CFG-006 assessment; the same field label called it “Appointment” |
| Notifications | `notify_user` inserts in-app rows only; no delivery trigger |

## Gaps found and resolved

| # | Gap | Resolution |
|---|---|---|
| A1 | A device outside Eastern Time silently shifted the appointment (9:00 entered in Los Angeles became 12:00 ET) | Entry is Eastern wall time (`EasternDateTimeField`); the client converts with explicit offsets; `admin_record_appointment` requires the instant to equal the Eastern wall time sent (`_local_start`) |
| A2 | Daylight saving: nonexistent spring-forward times were moved by the browser; fall-back times were picked silently | Nonexistent times are refused with an explanation (client and server); a repeated time asks EDT or EST; the display always carries EST/EDT |
| A3 | No stale-read protection: two operators could overwrite each other and both see success | `_expected_start` must equal the current appointment (40001 otherwise); omitting it counts as “none loaded” |
| A4 | An appointment could be recorded on a pending request, an open offer or a recurring job (where it could break the Phase 5 recurring checkout identity, which binds `scheduled_at`) | Only `scheduled` one-time jobs with an assigned provider; recurring visits are left to 6.6 |
| A5 | Recording an appointment overwrote the homeowner’s `preferred_date` | The new command leaves `preferred_date`/`preferred_time` alone; surfaces label them “(your request)” / “(homeowner request)” |
| A6 | No schedule history for any role | `job_schedule` returns the appointment, the open request and the history (outcome, old/new values, actor role, time, reason) to participants only |
| A7 | A requested time was labelled “Appointment” | Requests use “Requested time”; the appointment stays “until Mercurius changes it” |
| A8 | No way to answer a request without moving the appointment | Operations may “keep” the current appointment with a reason; recorded as outcome `kept`, answering the request |
| A9 | Lost response or failure read as a generic error; no readback | The panel re-reads after every attempt; success is claimed only from the readback holding the caller’s operation key; failures keep the key for a retry |
| A10 | Inconsistent appointment formats across roles | One formatter, “Tue, Nov 3, 2026, 9:00 AM EST”, used by homeowner, vendor, admin, offer outcomes and notices |

## What is implemented

Migration `20261024002000_phase6_appointments.sql` (additive):

- `job_operations.seq` (identity) and index: deterministic history order (`created_at` is the
  transaction time and can tie).
- `admin_record_appointment(_job_id, _operation_key, _starts_at, _local_start, _expected_start, _reason)`:
  admin only; replay first (same key and intent returns the recorded result, different intent refused);
  `scheduled` + provider + one-time; stale check; whole-minute instant equal to the Eastern wall time;
  future only; outcome `recorded` / `changed` / `kept` (kept only while a request is open; the same time
  otherwise refused); immutable `job_operations` row with previous and new values; `scheduled_start_at`
  and `timezone` updated; `job_events` entry; in-app notice to homeowner and provider
  (“Appointment recorded/changed/unchanged”, “Tue, Nov 3, 2026, 9:00 AM EST (Eastern Time). reason”).
  No money, fee, ticket or scheduler effect.
- `job_schedule(_job_id)`: participants only (homeowner, current provider, admin); missing and foreign
  jobs refuse alike; actors returned as roles (`homeowner`, `provider`, `previous_provider`,
  `operations`); operation keys only on the caller’s own rows.
- `record_job_operation` restated in place (same signature): the generic `appointment` kind is refused
  (“Record appointments with admin_record_appointment”); everything else is unchanged, including
  `reschedule_request` and its CFG-006 assessment.

UI:

- `AppointmentPanel` on the homeowner job dialog, vendor job details and admin request dialog: state
  heading, Eastern Time note, open request, history list, loading/error/permission states with retry.
  Admin: Record/Change appointment, “Use requested time”, “Keep current appointment”. Homeowner and
  provider: “Request a different time” (homeowner and admin see the CFG-006 wording; the provider does not).
- `EasternDateTimeField` (MDS DateTime): separate date and time inputs labelled Eastern Time, typed or
  picked, device-equivalent note, nonexistent and repeated-time handling.
- `JobOperations` keeps cancellation, provider and exception kinds; its recurring “new visit” time uses
  the Eastern field. Lists show “Appointment: …” when recorded, else the preferred date as a request;
  the vendor list orders by appointment, then preferred date; admin column “Appointment”.

The four states the slice had to distinguish:

| State | Shown as |
|---|---|
| Provider accepted, no time | “Provider accepted · appointment time not recorded yet” |
| Appointment recorded | “Appointment recorded” + time |
| Reschedule requested | “Reschedule requested” — “The current appointment stays … until Mercurius changes it. Requested time: …” |
| Appointment changed | “Appointment changed” — “… Previously …”, with every value in the history |

Also: “No appointment yet” (offer open or no provider), “Appointment on hold” (a provider withdrew after
a time was recorded; no provider is committed), and closed jobs.

## Evidence (2026-10-24, this branch; synthetic data only)

Automated, run now on the final code:

| Check | Result |
|---|---|
| Clean replay of 197 migrations on the isolated stack (`.phase5-local`, ports 5552x) | Pass |
| SQL `092_phase6_appointments.sql` (new) / `010_phase4_operations.sql` | 68/68 / 11/11 |
| Full SQL suite after the clean replay | 83 files, 4,683 assertions, PASS |
| `scripts/appointment-concurrency.mjs` (new; separate connections) | PASS on 3 consecutive runs; synthetic rows removed |
| Unit `appointments` + `offer-status` under device TZ America/New_York, America/Los_Angeles, Asia/Kolkata, UTC, Pacific/Auckland | 27/27 in each |
| Full unit suite | 40 files, 495/495 |
| Typecheck, lint (`eslint .`), secret scan, `git diff --check` | Clean |
| Synthetic build (fixture URL, no env file) | Pass |
| Browser `appointments.spec.ts` (new: Pacific and India device timezones, 320/1440, axe) | 8/8 |
| Browser regression `phase4`, `matching`, `quote-proposals`, `homeowner`, `portals`, `promotion-selection` | 64/65. The failure was a 30 s timeout in `homeowner.spec.ts:23` under machine load, as recorded for 6.4. Of six reruns of that line (4 tests each), the first had one failure and the next five passed 4/4 |
| Regenerated `database.types.ts` | Additive only (`seq`, two functions) |

SQL 092 covers: participant-only readback (other homeowner, other provider, missing job, anonymous);
admin-only recording (homeowner, provider refused); pending, open offer, recurring and in-progress
refused; reason and wall time required; a Pacific-shifted instant, seconds and the past refused; the
retired generic path; refusals record nothing; record, same-key replay, same key with another time,
same time again, a second operator's stale read, an omitted expected value; one row, two in-app
notices with the Eastern time and reason; immutable history; no direct writes even for operators;
preferred date preserved; change; homeowner and provider requests leave the appointment alone; kept
and changed answers; history order, actor roles, old/new values, keys only to their actor, identical
history for operator, homeowner and provider; spring-forward 2:30 refused under both offsets; fall-back
1:30 EDT and EST both accepted one hour apart and named in the notices; previous-provider labelling
and loss of access after withdrawal. DST dates are computed for next year, so the test does not age.

Browser coverage: Eastern entry from a Pacific device (9:00 EST stored as 14:00Z, device note “6:00 AM
PST”); spring-forward gap refused with `aria-invalid`; fall-back choice; failed save keeps the retry
key and claims nothing; lost response confirmed from the readback; stale save explained and re-read;
homeowner keyboard entry from an India device, request versus appointment, focus order to the confirm
button; vendor sees the same values without fee wording; keep-current answer; load failure with retry;
permission state without retry; no horizontal overflow at 320 px; axe WCAG 2.2 AA clean.

Finding while testing, fixed: a failed save moved focus from the open confirmation to the panel’s
alert; the panel now focuses its alert only when no confirmation is open. Finding recorded, not fixed:
axe measured the homeowner dashboard header (“Manage your Mercurius services”, 12 px muted text) at
4.49:1 through an open dialog’s backdrop; the homeowner check is scoped to the dialog. Whether this
fails without a backdrop was not established here.

Not performed: hosted anything, human screen reader, real zoom, `@visual` (Windows baselines), dark
mode (light-only release), the full non-visual browser suite, real devices in other timezones (device
timezones were emulated by Playwright and by `TZ` for unit tests), notification delivery (none exists).

## Not done, and remaining decisions

1. **E1 schedule confirmation** (owner): what makes an appointment confirmed. Until then, “recorded”.
2. **Reschedule policy consequences** (6.9): requests keep the existing CFG-006 assessment; changing an
   appointment does not recalculate or charge anything. A provider-initiated request still receives the
   customer fee assessment from the unchanged command (pre-existing; not shown to the provider).
3. **Provider withdrawal** (6.9): `provider_cancel` keeps `scheduled_start_at`; the panel shows
   “Appointment on hold”. Whether a replacement provider inherits the time is a rematch rule.
4. **Recurring visits** (6.6): appointment changes for occurrences are refused by the new command
   (the old path could break the recurring checkout identity). The legacy `job_visits` row created at
   scheduling does not follow the appointment (pre-existing).
5. **Reason visibility**: the operator’s reason is shown to homeowner and provider (as notices already
   did); the dialog says so. A private operator note would need a decision.
6. **History visibility to a replacement provider**: a later provider sees earlier schedule entries
   (labelled “Previous provider”), consistent with existing `job_operations` RLS.
7. Not built: provider availability, calendar conflicts, reminders, external delivery, scheduler
   activation (all out of scope by the slice boundaries).

## Migration and rollback

Additive: one identity column, one index, two new functions; `record_job_operation` restated with the
same signature. Hosted holds 0 job operations, so the new column backfills nothing. Between the
migration push and the deploy, the live admin “appointment” option in the old Schedule panel is refused
with a clear message (intended: it is the unguarded path); every other operation works unchanged.
Order under DEC-2026-037: owner-authorized dry run and push, then merge. Rollback: promote the previous
deployment; restoring the old appointment path needs a forward migration restating
`record_job_operation` (not recommended: it reopens A1/A3/A4). Do not drop `seq` once rows exist.
