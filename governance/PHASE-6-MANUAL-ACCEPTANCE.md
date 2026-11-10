# Phase 6 manual acceptance scripts (TRACE-137)

**2026-11-10 owner acceptance checkpoint:** Phase 6 implementation is accepted and Phase 7 is authorized under [PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md), with A2 verification explicitly carried forward. **The checks below remain NOT PERFORMED / unrecorded.** Do not mark any result passing based on owner phase acceptance or green CI. Perform and record them against the actual applicable candidate before booking-readiness acceptance.

**Status:** PREPARED, NOT PERFORMED (2026-11-03). Nothing on this page is marked passed. Automated axe, keyboard and SQL results don't satisfy these checks (PHASE-6-SCOPE "Phase acceptance checkpoint"; MDS blueprint accessibility and testing requirements). The person performing a check fills in the result columns: date, person, device and assistive technology, result, and notes. A failure becomes a finding with the checkpoint, step and what was heard or seen.

**When:** last, on the final acceptance candidate, after every acceptance-affecting repair has merged (closure report A2 and §9). Record the candidate commit with each result. A later change to a surface a script covers invalidates that result; rerun the script on the new candidate.

*2026-11-05 (TRACE-147): still not performed, and no final candidate exists yet. CS-4 (vendor job acceptance), CS-3 (checkout) and the one-time start gate are still to merge, and they touch the J1/J3 vendor-job and checkout scripts. Light mode only (D-9). Each result records the candidate SHA, the browser and version, the device, the assistive technology and version, the person and the date. "Not performed" stays until someone actually performs the check; see closure report §10.3.*

Related: [closure report](PHASE-6-CLOSURE-REPORT.md) items A2, X-1 and X-2.

## 0. Setup (isolated, synthetic, payments off)

1. **Start the isolated stack.** `node scripts/prepare-phase5-local.mjs`, `sh scripts/phase5-db.sh start`, then `sh scripts/phase5-db.sh reset` (a clean replay: an existing volume can be stale).
2. **Seed the checkpoints.** `docker exec -i supabase_db_mercurius-phase5-isolated psql -U postgres -v ON_ERROR_STOP=1 < scripts/phase6-manual-fixtures.sql`. The script refuses to run on any database with a non-synthetic account. It prints the checkpoint table (M2–M12).
3. **Run the app against the stack**, in a separate shell, without editing `.env.local`:
   - Set `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55521`.
   - Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the isolated stack's anon key, read privately from `supabase status --workdir .phase5-local`. Don't paste it anywhere.
   - Leave `MERCURIUS_MONEY_MODE`, `STRIPE_*`, `RESEND_API_KEY` and `MERCURIUS_INVITATION_*` **empty**, and set `JOB_LIFECYCLE_ENABLED=false`.
   - Then `npm run build && npm run start`.
4. **For real devices**, serve on the LAN (`npm run start -- -H 0.0.0.0`), and set the Supabase URL to the computer's LAN address before building, so the phone reaches the local API. Use only a private network.
5. **Sign in** with these synthetic accounts. They use the local-only password `synthetic-local-only` and exist only in the isolated stack:

| Account | Role |
|---|---|
| `manual-homeowner-a@example.invalid` | homeowner (owns every checkpoint) |
| `manual-homeowner-b@example.invalid` | homeowner (isolation checks) |
| `manual-provider-p@example.invalid` | assigned provider |
| `manual-provider-q@example.invalid` | other provider (isolation) |
| `manual-operator-1@example.invalid` | operator with finance authority |
| `manual-operator-2@example.invalid` | second finance operator |
| `manual-operator-3@example.invalid` | operator without finance authority |

6. **Stop at every payment button.** Checkout isn't wired locally (no Edge runtime, no Stripe key), so it fails closed. That's expected; record what the failure says, and don't configure a payment provider to get past it.
7. **Afterwards**, run `sh scripts/phase5-db.sh reset`.

**Setup smoke check, 2026-11-03.** This verifies the setup only; it is not an acceptance check.
- The seed, run on a clean replay, printed 13 checkpoints, and a rerun was refused.
- The local Auth API signed in homeowner A, provider P and operator 1.
- A dev server (`next dev` on `localhost:3207`) rendered homeowner A's dashboard with the seeded jobs, provider P's overview, and operator 3's `/admin`, where "Finance exceptions" read "Finance authority required".
- Use `localhost` rather than `127.0.0.1` with `next dev`: Next's dev server blocks its dev resources from other origins, and the page doesn't hydrate.

Theme: the launch is light-only (DEC-2026-026; `LIGHT_ONLY_LAUNCH`). Dark checks wait on the owner's answer to D-9 (closure report X-1). Until then, record "light only" in the theme column.

## 1. Checkpoints (seeded by the script)

| ID | State | Primary actor | Journey step to review |
|---|---|---|---|
| M1 | fresh homeowner A with access to ZIP `00110` | homeowner A | intake: service, frequency, provider selection, price review, honest confirmation |
| M2 | offer open to provider P | provider P | accept or decline within the four-hour window |
| M3 | appointment recorded; reviewed terms ready | homeowner A | schedule readback in Eastern Time; "Review and pay" (stop at the button) |
| M4 | paid, scheduled | provider P | start work |
| M5 | in progress | provider P | complete with two photos (upload from the device) |
| M6 | completed, awaiting confirmation | homeowner A | confirm, or report an issue |
| M7 | confirmed | homeowner A | write a review; then see the provider profile's summary |
| M8 | disputed | homeowner A, provider P, operator 1 | evidence from both parties → operator decision → homeowner appeal |
| M9 | paid; appointment six days out | homeowner A | preview reschedule (free) and cancellation (100%), then cancel |
| M10 | provider withdrew | homeowner A, operator 1 | replacement decision; cancellation outcome |
| M11 | weekly plan: visit 1 awaiting confirmation, visit 2 unpaid | homeowner A, provider P, operator 1 | per-visit states; confirm visit 1; visit 2 unaffected |
| M12 | quote sent, tax pending | homeowner A | itemized quote; approval refused with "Tax pending confirmation" |
| M13 | operator surfaces | operator 1, operator 3 | `/admin` summary and queues; finance is "restricted" for operator 3 |
| M14 | vendor earnings | provider P | `/vendor/earnings`: amounts only after capture, holds by category, no payout date |

## 2. Screen reader (SR)

Run each journey with **NVDA + Firefox or Chrome (Windows)** and **VoiceOver + Safari (macOS)**, and on phones with **VoiceOver (iOS Safari)** and **TalkBack (Android Chrome)**. MDS names request, checkout, vendor job, dispute and admin money actions as mandatory; the rest of the checkpoints follow.

For each checkpoint, the person checks and records the following:

- **SR-1** The page title and the first heading announce the job or step.
- **SR-2** The landmark and heading order makes sense; "skip to content" works.
- **SR-3** Every control has an accessible name that says the action (for example "Confirm completion", not "Confirm").
- **SR-4** Status is announced in words, not only color or icon: "Appointment recorded", "Waiting for payment", "Tax pending confirmation", "Held: dispute".
- **SR-5** Errors and refusals (stale view, missing photo, tax pending) are announced when they appear and are tied to their field.
- **SR-6** Dialogs and sheets move focus inside, trap it, announce their title, and return focus to their opener on close.
- **SR-7** Dates and times are read with "Eastern Time".
- **SR-8** Amounts are read correctly ("$60.00"), and no amount is announced where policy hides one (M14 before capture).
- **SR-9** Tables and lists (admin queues, earnings, visits) announce headers and counts.
- **SR-10** Isolation: signed in as homeowner B or provider Q, opening another party's checkpoint URL announces a refusal or not-found, never another party's details.

| Checkpoint | AT / browser | Date | Person | SR-1…10 result | Notes |
|---|---|---|---|---|---|
| M1 | | | | | |
| M2 | | | | | |
| M3 | | | | | |
| M4–M5 | | | | | |
| M6 | | | | | |
| M7 | | | | | |
| M8 | | | | | |
| M9–M10 | | | | | |
| M11 | | | | | |
| M12 | | | | | |
| M13 | | | | | |
| M14 | | | | | |

## 3. Real devices (RD)

Use at least one recent iPhone (Safari) and one Android phone (Chrome), plus one tablet in both orientations.

- **RD-1** Touch targets are at least 24×24 CSS px, and primary actions are comfortably tappable.
- **RD-2** The on-screen keyboard doesn't cover the focused field or the submit action.
- **RD-3** Photo upload from the camera and from the library works at M5. Record the file sizes used.
- **RD-4** Date and time controls show Eastern Time, even when the device is set to another zone. Test once with the phone set to Pacific Time.
- **RD-5** There's no horizontal scrolling at the device width.
- **RD-6** Sheets and menus open, scroll and close with gestures and with the back button.
- **RD-7** Rotating keeps state, and an open dialog stays usable.

| Device / OS / browser | Checkpoints | Date | Person | RD-1…7 result | Notes |
|---|---|---|---|---|---|
| | | | | | |

## 4. Zoom and reflow (Z)

Desktop Chrome and Firefox at **200% browser zoom** at 1280 px wide, and **320 px viewport** reflow (or 400% zoom at 1280 px).

- **Z-1** No content or function is lost or clipped, and no horizontal scroll appears except in data tables.
- **Z-2** Sticky headers and footers don't hide focused controls.
- **Z-3** Text spacing override (line height 1.5, paragraph spacing 2×, letter spacing 0.12em, word spacing 0.16em) keeps everything readable.
- **Z-4** Focus is visible at every step.
- **Z-5** Admin lists switch to their responsive layout without hiding actions.

| Checkpoint | Browser | 200% | 320 px | Text spacing | Date | Person | Notes |
|---|---|---|---|---|---|---|---|
| M1–M14 | | | | | | | |

## 5. Visual (V)

1. **Automated baselines.** Committed `@visual` baselines are Windows PNGs (`tests/e2e/*-snapshots/*-win32.png`); CI on Linux skips them. On the owner's Windows machine, follow the README "MDS catalog checks" build, then run `npm run test:visual`. Record pass/fail. An updated baseline is reviewed as a diff, never accepted blindly.
2. **Rendered review at 320, 375/390, 768, 1024 and 1440 px** for each checkpoint, against the MDS blueprint:
   - **V-1** brand tokens, not page-local colors;
   - **V-2** status uses the shared status component and wording;
   - **V-3** empty, loading, error and permission states (open a checkpoint while signed in as the wrong role, and with the network offline);
   - **V-4** "Request Service" stays the dominant homeowner action where it applies;
   - **V-5** no promotion, Vendor Plans, Smart Picks or public Admin entry point appears.

| Checkpoint | Widths | Date | Person | V-1…5 result | Notes |
|---|---|---|---|---|---|
| `@visual` suite (Windows) | — | | | | |
| M1–M14 | | | | | |

## 6. Keyboard-only pass (K)

Automated focus checks exist. A human pass is still required for the critical journeys.

- **K-1** Each journey from M1 to M8 can be completed with Tab, Shift+Tab, Enter, Space, the arrow keys and Escape only.
- **K-2** Focus order matches the visual order.
- **K-3** No keyboard trap exists outside dialogs.
- **K-4** Focus appearance meets WCAG 2.2.

| Journey | Date | Person | K-1…4 result | Notes |
|---|---|---|---|---|
| | | | | |
