# Phase 7.4C — `request_started` once per draft (TRACE-158, decision D-2)

**Status:** IMPLEMENTATION FOR REVIEW (Codex). Not merged; merging needs the owner's release authorization. Nothing is activated.
**Base:** `main` `aab602b` (#191). Branch `claude/phase7-4c-request-started-once-per-draft`. It carries #193's evidence commit unchanged (here `0687776`, from `0ca0f2d`) because both edit the TRACE-158 row and the handoff; if #193 merges first, the duplicate drops out (as #183 did for 7.3D-1).
**Authority:** the owner's approval of **D-2, `request_started` once per draft**, given 2026-11-22 ET for implementation only (not merge or production configuration), with clarifications listed in §2.4. [Analytics coverage contract](PHASE-7-ANALYTICS-COVERAGE-CONTRACT.md) §4 (A-13), §5 (F-1), §9 (D-2); [POSTHOG-ANALYTICS](POSTHOG-ANALYTICS.md) (TRACE-157); [7.4B record](PHASE-7-ANALYTICS-TRIGGER-VERIFICATION-7-4B.md) §7 (Codex R-1: no bot-signal override outside the isolated synthetic lane).

## 1. What changed

| File | Change |
|---|---|
| `src/lib/requestDraft.ts` | `RequestDraft.startCounted: boolean`, `false` in `emptyDraft`. `parseDraft` restores only a stored boolean; a missing field (a draft stored before this change) or a malformed value stays `false`. No draft-version bump |
| `src/lib/analytics/client.ts` | `captureAnalytics` returns `true` only when `posthog.capture` was invoked and returned without throwing, and `false` for the existing guard refusals (not initialized, not permitted, untracked path) or an SDK exception. `true` is an **SDK handoff**, not confirmed transmission or ingestion. Other callers ignore the value |
| `src/app/request/page.tsx` | `continueFromServices`: `request_started` is captured only while `!draft.startCounted`, and `update({ startCounted: true })` follows a `true` handoff. `request_step_completed` for the services step still fires on every valid pass, after `request_started` |
| `tests/unit/request-intake.test.ts` | D-2 marker: default, restore of `true`/`false`, legacy draft (not reported as dropped), six malformed values, survival across storage and a new submission key, adoption and keep |
| `tests/unit/posthog-client.test.ts` | The handoff return: `true` once on capture; `false` before installation, without consent, on a private path, on an SDK exception, after withdrawal and under GPC |
| `tests/analytics/posthog.pw.ts` | The pinned F-1 test becomes the once-per-draft test; seven 7.4C tests (§3). `intake()` takes an optional `{ consented, seed }`; its defaults leave the 7.4B tests unchanged. `isolate()` is byte-identical |
| Documentation | Contract (dated notes on the status, A-13, F-1, D-2), POSTHOG-ANALYTICS (trigger row and verification), this record, TRACE-158, handoff |

**Unchanged:** event names and properties (`ANALYTICS_EVENTS`, `sanitizeProperties`), consent code and cookie, replay, the analytics lane configuration and workflow, the server, the database and migrations, PostHog and Vercel settings. No hosted traffic.

**Code placement.** The capture stays in the Continue click handler: not in render, an effect or a state-updater callback. Both draft writes go through `update`, which merges into the current state (`setDraft(current => …)`), so the following `changeStep` (`update({ step })`) keeps the marker (mutation C-M9 shows what happens otherwise).

## 2. Draft semantics (existing boundaries, unchanged)

A draft is the tab's `sessionStorage` entry `nextRequestFlowState`. Its submission key is not its identity: "Submit as a new request" replaces the key inside the same draft. The marker therefore lives in the draft and is reset exactly where the page already starts a new draft with `emptyDraft`.

### 2.1 New draft (marker `false`, one start may be counted)

- First visit to the tab, or a stored draft that cannot be read ("fresh start").
- Plan-builder or `?service=` entry while a saved request is stored.
- "Start a new request" after saving (`startNewRequest`).
- "Start over" (`startOverAsVisitor`, which calls `startNewRequest`).
- A draft belonging to another account, discarded at sign-in.
- Opening the page after a coverage or interest completion cleared the stored draft.

### 2.2 Same draft (no second start)

Back then Continue; a reload; leaving and returning in the same tab; the sign-in round trip, including an account adopting an ownerless draft; plan-builder or `?service=` entry into an unsaved draft; "Submit as a new request" (new key); the retry of an unconfirmed submission; changing the selected services.

### 2.3 Consent

- The marker is set only after a `true` handoff. Without consent, under GPC or DNT, or on any guard refusal, nothing is sent and the marker stays `false`.
- No retroactive capture: granting consent sends nothing for a pass made earlier. The next valid services pass in that draft counts the start once. A visitor who opts in after the services step and never returns to it shows no start.
- Withdrawing and re-granting consent in the same draft does not count a second start. The marker is kept on withdrawal: it holds no identifier and is cleared with the draft.

### 2.4 Owner clarifications (2026-11-22) and how they are met

| Clarification | Where |
|---|---|
| `startCounted` on `RequestDraft`, default `false` | §1, `emptyDraft` |
| Restore only valid booleans; missing or malformed → `false`; no version bump | `parseDraft`; unit tests |
| `captureAnalytics` returns a boolean: `true` only when `posthog.capture` is invoked without throwing | `client.ts`; unit test |
| `true` described as an SDK handoff, never transmission or ingestion | Doc comment in `client.ts`; this record; POSTHOG-ANALYTICS |
| Capture only while uncounted; persist `true` on a successful handoff | `continueFromServices` |
| Capture outside render, effects and updater callbacks; the step update preserves the marker | §1 "Code placement"; C-M9 |
| `request_step_completed` on every valid services pass | Unchanged line; browser tests 1–3 |
| Documented boundaries; no retroactive capture on consent changes | §2; browser tests |

### 2.5 Known edges (documented, not changed)

- **Storage unavailable.** The marker lives only in memory; a reload is already a fresh draft (the page says progress isn't saved), so it can count a new start.
- **Duplicated tab.** Duplicating a tab copies `sessionStorage`. A tab duplicated before the first start can count one start in each copy (they share a submission key, so the server still saves one request).
- **Drafts open at deploy.** A draft stored before this change reads as uncounted, so it can count one more start.
- **"Start over" is not reachable in a browser today.** The R0 trial gate shows signed-out visitors the closed booking state before the form, so the held-draft screen that offers "Start over" cannot render. It calls the same `startNewRequest` reset that "Start a new request" exercises (C-M4).

## 3. Verification

### 3.1 Tests added or changed (browser lane order; tests 1–12 and 14–15 are unchanged)

| # | Test | Criteria |
|---|---|---|
| 13 | Back then Continue: one `request_started` (before the first services completion), two services completions; a fresh save captures `request_submitted` once. The seed has no `startCounted` (legacy draft) | 1, 7 |
| 16 | A reload, then leaving for `/faq` and returning with browser Back: same draft, no second start; marker stored `true` | 2 |
| 17 | A seeded counted draft, adopted by the signed-in account: no start; the services step still counts | 7, 2 (adoption) |
| 18 | `?service=` entry while a request is saved: new draft (marker `false`), one start with `service_count` 1; `?service=` entry into that unsaved, counted draft: no second start | 4 |
| 19 | "Start a new request" after saving a counted draft: marker `false`; the new draft counts one start | 3 |
| 20 | A seeded counted draft owned by another account, discarded at sign-in: the replacement draft counts one start | 3 |
| 21 | Unconfirmed submission, then "Check and finish submitting" answered by a key conflict, then "Submit as a new request": no start; the stored marker is still `true` under a different submission key | 5 |
| 22 | No consent: nothing sent, marker `false`. Opt-in: nothing retroactive. Next pass: one start. Withdraw: nothing sent. Re-grant: the step counts again, the start does not | 6 |

Unit (criterion 8): `request-intake.test.ts` D-2 block (11 cases including the six malformed values); `posthog-client.test.ts` handoff test.

### 3.2 Results

| Check | Result |
|---|---|
| Typecheck (local) | Pass |
| Changed-file ESLint (local) | Pass (6 files) |
| Unit suite (local, `vitest run` excluding the untracked `.phase5-local/` worktree of another slice) | 81 files, 1301 tests passed |
| Secret scan (local) | Pass |
| Production build (local) | Pass (compiled in 2.2 min; 87/87 static pages) |
| Analytics privacy, exact head `092e5cf` (run 45078349655) | Success: vitest 36/36 (4 files), browser 24/24 (1.9 min) |
| Browser lane, local | Ran with the host lightly loaded: the intake and 7.4C tests passed in isolated runs. A full local run later could not finish: two other slices' Supabase stacks (`phase7-3d1`, `phase5-isolated`) came back after a VM reboot and drove load to 30–57; tests 12–15, including unchanged 7.4B tests, timed out and the run hit its 40-minute limit. Those stacks were left running. Browser acceptance rests on exact-head CI |
| Final head | `Analytics privacy` and `CI` on the PR's final head: recorded in the PR body (writing them here would change the head) |

## 4. Mutation checks

Unit mutations ran locally; each was applied to the source alone, the file restored with `git checkout`, and `git status --short src` was empty afterwards. Browser mutations ran through the supported `Analytics privacy` job on temporary draft PR #195 ("DO NOT MERGE"), because the local lane could not run reliably (§3.2). Each run was one commit on top of `092e5cf`, force-pushed after the previous run finished.

| ID | Mutation | Run | Caught by |
|---|---|---|---|
| C-M1 | Marker check removed (capture on every pass) | C 45080826007 | 13, 16, 17, 18, 22 |
| C-M2 | Marker set even when nothing was handed to the SDK | A 45080090620 | 22 |
| C-M3 | `parseDraft` no longer restores `startCounted` | Unit; B 45080435832 | Unit: 8 D-2 cases. Browser: 16, 17, 18, 21 |
| C-M4 | "Start a new request" keeps the old marker | E 45081547330 (alone) | 19 |
| C-M5 | Explicit entry while saved keeps the old marker | A | 18 |
| C-M6 | Another account's draft discarded, its marker kept | A | 20 |
| C-M7 | `captureAnalytics` returns `true` for a guard refusal | Unit | The handoff unit test. Not run in the browser: that unit test runs first in the same job, so the browser lane would not start |
| C-M8 | `request_started` sent after the services completion | B | 13 |
| C-M9 | Step change writes the draft from the render closure (marker lost) | D 45081167375 | 13, 16, 18, 19, 22 |
| C-M10 | An SDK exception reported as a handoff (`true`) | Unit | The handoff unit test |

Every run failed only the tests listed; all other tests passed (A 21, B 19, C 19, D 19, E 23 of 24). PR #195 was closed unmerged and its branch deleted afterwards. **Batching note:** batch B first held C-M3 with C-M4, and test 19 passed: C-M3 already resets the seeded marker to `false` on restore, so C-M4 kept a `false` marker and looked correct. That was a batching error, not a gap in test 19; C-M4 was rerun alone (run E). C-M7 was also dropped from batch B before it ran, for the reason in its row.

## 5. For Codex review

- **R-1 Carried commit.** #193 (7.4B review and release evidence, documentation only) was open when this branch started. Its commit is carried unchanged (`0687776`) so this PR's TRACE-158 and handoff edits build on it instead of conflicting. If #193 merges first, the duplicate drops out.
- **R-2 `captureAnalytics` return value.** The shared function now returns `boolean`. Only the intake page uses it; `AuthProvider` and the provider page ignore it (the provider page passes it as a consent-event listener, whose return value the browser ignores). `true` is documented as an SDK handoff only.
- **R-3 "Start over" not exercised in a browser.** Under the R0 trial gate, signed-out visitors see the closed booking state, so the held-draft screen offering "Start over" cannot render today. It runs `startNewRequest`, the reset that test 19 and C-M4 cover. Confirm this is acceptable coverage.
- **R-4 Known edges (§2.5).** Storage unavailable, a duplicated tab before the first start, and drafts already open at deploy can each count one extra start. Documented, not changed.
- **R-5 Marker kept on consent withdrawal.** By design (§2.3): re-granting consent in the same draft does not count a second start. The marker holds no identifier and is cleared with the draft.
- **R-6 Bot signals (Codex R-1, 7.4B).** No test changes `navigator.webdriver`, the user agent or any SDK setting. `isolate()` and the lane configuration are unchanged. `intake()` gained an optional `{ consented, seed }` argument; its defaults keep the 7.4B tests as they were.
- **R-7 Temporary PR #195.** Used only to run browser mutations through the supported job, because the local lane could not run reliably; closed unmerged and its branch deleted afterwards. The batching error (§4) is recorded with its rerun.
- **R-8 Test-table fix.** The malformed-value table first passed `[]` bare, which `it.each` reads as an argument list (its title printed "undefined"). Each value is now wrapped, so the `[]` case tests `[]`. The unit mutations were rerun on the final tests with the same outcome (C-M3: 8 failed; C-M7 and C-M10: 1 failed each).
- **R-9 Local environment.** Locally, `vitest run` also collects the untracked `.phase5-local/wt` worktree of another slice; the local unit run excluded it. CI is unaffected.
- **Unchanged decisions and gates.** D-1 and D-3..D-6 remain open. No new event or property, consent change, database change, hosted traffic, email activation or production setting. 7.3D stays unactivated. Merging needs the owner's release authorization; under DEC-2026-037 the merge is the release (no migration).
