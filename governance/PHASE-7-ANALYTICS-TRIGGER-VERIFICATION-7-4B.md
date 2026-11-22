# Phase 7.4B — Analytics call-site trigger verification (TRACE-158)

**Status:** IMPLEMENTATION FOR REVIEW (Codex). Tests and the CI job's file list only. Nothing is activated.
**Base:** `main` `0f48cff` (#190 merged 2026-11-22 13:47 UTC, after exact-head CI 45024066373 passed on `ff81620`). Branch `claude/phase7-4b-analytics-trigger-tests`.
**Authority:** [analytics coverage contract](PHASE-7-ANALYTICS-COVERAGE-CONTRACT.md) §4, §5 and §8 (AC-1); [POSTHOG-ANALYTICS](POSTHOG-ANALYTICS.md) (TRACE-157); the owner's 2026-11-22 instruction accepting the prepared approach (real route handlers and server analytics with synthetic dependencies; real browser call sites in the existing analytics lane; no helper extraction unless necessary).

## 1. What changed

| File | Change |
|---|---|
| `tests/unit/posthog-routes.test.ts` | New. 21 tests that call the real `GET /api/request-coverage` and `POST /api/early-access` handlers, the real `submitEarlyAccess` command and the real `captureServerAnalytics`. Synthetic: the Supabase client, Next's `after` scheduler (run explicitly, as Next does after the response) and the `posthog-node` SDK |
| `tests/analytics/posthog.pw.ts` | 13 tests appended in four `7.4B` sections. Real pages, real `posthog-js`, installed listeners. The existing `isolate()` helper and the four existing tests are byte-identical |
| `.github/workflows/analytics.yml` | The vitest step also runs `posthog-routes.test.ts` (already matched by the `tests/unit/posthog*` trigger). `tests/fixtures/browser-session.ts`, now imported by the lane, is added to both trigger lists |
| `governance/POSTHOG-ANALYTICS.md` | "Verification and release" lists these tests and F-1..F-4 |

**Unchanged:** every file under `src/`, `ANALYTICS_EVENTS`, `sanitizeProperties`, `replayAllowed`, `analyticsPath`, consent code, `playwright.analytics.config.ts`, PostHog project settings, Vercel variables, database and migrations. No helper was extracted: every producer, including the 2,000-line intake page, was reachable from a test.

## 2. Contract §8 coverage

| §8 item | Event(s) | Producer exercised | Positive | Negative |
|---|---|---|---|---|
| 1 | `coverage_checked` (A-07) | Route handler | Exactly `{ coverage }` for covered, waitlist, uncovered; a repeat lookup counts again (F-3) | Invalid ZIP (4 forms, no lookup made); lookup error answer; lookup throws; no consent, denied, GPC, non-UUID telemetry ID. ZIP, city and area ID never in the event |
| 2 | `early_access_submitted` (A-08) | Route handler + command | Exactly `{ kind }` for early access and expansion; a repeat by the same address captures again with identical properties (F-2) | 400 input and database validation; 409 boundary before and from the save; 429 guard, limit and unreadable body; 500 failure and unexpected outcome; no consent, denied, DNT, non-UUID ID. Email, name, ZIP and services never in the event |
| 3 | `request_submitted` (A-15) | `/request` page | One event, `service_count` 2 for a two-request save | Reused save (shown as saved, never captured); refused save, then the fresh resubmission captures exactly once |
| 4 | `request_started`, `request_step_completed` (A-13, A-14) | `/request` page | Services and details steps with `step` and `service_count` | **F-1 pinned:** Back → Continue fires `request_started` and the services step again (D-2 open) |
| 5 | `login_succeeded`, `login_failed`, `$identify`, `signup_submitted` (A-09..A-12) | `AuthProvider` through `/login` and `/register` | Accepted sign-in: one `$identify` with the account UUID, before `login_succeeded`, which carries it. Accepted signup: `signup_submitted` | Refused sign-in: `login_failed` only, no identity, no success. Refused signup: nothing, then the accepted retry captures. Signup sends no identity. No consent: no request at all. No email, password, token, name or provider error text in any event |
| 6 | `provider_profile_viewed`, `service_viewed` (A-05, A-06) | `/providers/[id]` page | Viewed once after load, with `provider_id`; `service_viewed` on an explicit chip choice with `provider_id`, `service_id`, without a second view. Opened before consent: counts once after "Allow analytics" | Not-found and unreadable profiles: pageview only. Provider name, location and query never in events |
| 7 | `navigation_clicked`, `button_clicked`, `page_scrolled` (A-02..A-04) | Installed document listeners | Internal `/privacy`; provider link as `/providers/[id]` + `provider_id` (query and fragment dropped); a real header link; a button as `{ action: "other", button_index }`; 25/50/75/100 once each on `/faq`, and 25 again on the next page | External, `/admin`, `/dashboard`, links and buttons inside `[data-analytics-private]` (including the real consent panel), inputs. No label, input value, query or fragment. Nothing scrolled before consent |
| 8 | Documentation | — | POSTHOG-ANALYTICS verification; this record; TRACE-158; handoff | — |

## 3. Mutation checks

Each mutation was applied to the source alone, the relevant suite run, and the source restored with `git checkout`. `git status --short src` was empty afterwards.

### 3.1 Route mutations (local, `--testTimeout=60000`)

The host was overloaded during this session (§5), so the per-test timeout was raised to stop timeouts from masking or imitating mutation failures. The unmutated control passed 21/21 under the same setting.

| ID | Mutation | Result |
|---|---|---|
| R-M1 | `early-access`: capture when `result.status < 500` instead of `=== 201` | Caught: 7 failed (every 400, 409 and 429 case) |
| R-M2 | `early-access`: producer invocation removed | Caught: 4 failed (both kinds, F-2 repeat, outage) |
| R-M3 | `request-coverage`: capture moved before `if (result.error) throw` | Caught: 1 failed (lookup failure) |
| R-M4 | `request-coverage`: producer invocation removed | Caught: 4 failed (three outcomes, F-3) |
| R-M5 | `request-coverage`: capture before input validation | Caught: 6 failed (invalid ZIP, lookup failure, and the exact-event cases) |

### 3.2 Browser mutations (GitHub runner, `Analytics privacy` job)

The local host could not run the browser lane (§5). The job runs only for pull requests, so the mutations ran through a temporary draft PR, #192 ("DO NOT MERGE"), on top of this branch's tests. It was closed and its branch deleted afterwards. Each batch is one commit of source mutations; within a batch every mutation targets different tests. Test numbers follow the lane's order (1–4 existing, 5–17 new).

| ID | Mutation | Run | Caught by |
|---|---|---|---|
| B-M1 | `request/page.tsx`: `!result.reused` guard removed | A 45040209508 | 14 (reused save) |
| B-M2 | `AuthProvider`: `login_succeeded` regardless of error | A | 6 (refused sign-in) and existing 2 (expects `login_failed`) |
| B-M3 | `AuthProvider`: `signup_submitted` regardless of error | A | 8 |
| B-M4 | Provider page: the on-load `viewed()` invocation removed | A | 9 |
| B-M5 | `request/page.tsx`: `request_started` invocation removed | A | 13 |
| B-M6 | `client.ts`: `[data-analytics-private]` check removed | A | 16 |
| B-M7 | `client.ts`: scroll milestone de-duplication removed | A | 17 |
| B-M8 | Provider page: `if (!ready) return` removed from the view effect | B 45040581998 | 9 (3 views), 11 (not found), 12 (unreadable) |
| B-M9 | Provider page: `service_viewed` invocation removed | C 45040888759 (alone, because B-M8 stopped test 9 first in B) | 9 (`service_viewed` 0) |
| B-M10 | `client.ts`: same-origin check on navigation removed | B | 16 |
| B-M11 | `request/page.tsx`: details-step `request_step_completed` removed | B | 13 |
| B-M12 | `AuthProvider`: identity synced after the sign-in outcome instead of before | B | **Not caught: equivalent.** `signInWithPassword` awaits `_notifyAllSubscribers('SIGNED_IN')` before it returns (`@supabase/auth-js` `GoTrueClient.js:955`), so the `onAuthStateChange` handler has already called `syncAnalyticsIdentity` when `signIn` captures the outcome. The order assertion in test 5 still guards the observable behavior |

Uncaught otherwise: none. In run A, existing test 3 (320px preferences) also failed: the panel was not visible 5 s after "Analytics preferences" was clicked. No batch-A mutation touches the consent panel or GPC handling, and test 3 passed in batches B and C and in every unmutated run. It is recorded as an unattributed flake in an existing test, not a catch.

## 4. Verification

| Check | Result |
|---|---|
| Route tests (local) | 21/21. Under load, with `--testTimeout=60000` for the mutation set and its control |
| Changed-file ESLint (local) | Pass (`tests/unit/posthog-routes.test.ts`, `tests/analytics/posthog.pw.ts`) |
| Typecheck (local) | Pass |
| Analytics privacy, unmutated (CI) | `04ef1db` run 45039595629 and `cc88e8b` run 45040559374: success. Vitest 35/35 (4 files); browser 17/17 |
| Analytics privacy duration | 2 min 6 s for the whole job on `04ef1db` (`npm ci` 44 s, vitest 1 s, browser lane 66 s; Playwright reports 1.1 min); 12-minute limit. Main's job before this slice: 80 s. No adjustment needed |
| First run on `d0f0652` | 14/17. The three intake tests looked for "Your request is saved"; a two-service save is headed "Your 2 requests are saved". Selector fixed in `04ef1db`. The same commit waits for the client-only consent panel before the scroll test changes the FAQ page, which removed one dev-server hydration warning |
| Full unit regression, build, secret scan | `CI` workflow on the final head: PR body |

## 5. Local environment

- **Browser configuration.** The lane uses the job's supported setup unchanged: full Chrome through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (system `google-chrome` in CI; Playwright's full `chromium-1243` locally). No new test alters `navigator.webdriver`, the user agent or any other bot-detection signal. **For Codex:** the existing, reviewed `isolate()` helper from #182 already sets `navigator.webdriver` to `false` and the config sets a fixed desktop user agent. A probe here showed that, without those, both headless-shell and full Chromium report `webdriver: true` and a `HeadlessChrome` user agent, and `posthog-js` drops every event as a bot. The new tests therefore run through `isolate()` exactly as the existing four do; nothing was added to it. Removing it would require an SDK setting change (`opt_out_useragent_filter`), which is out of scope.
- **Host load.** Two other worktrees' isolated Supabase stacks (`phase7-3d1`, `phase5-isolated`) were running on a 5 GB WSL VM. Load stayed around 20–45, and single Playwright API calls took seconds. With a pre-warmed dev server (git-excluded `playwright.analytics.local.config.ts`), the four existing tests passed locally; the new browser tests could not start a page within the timeout. Those stacks belong to other slices and were left running. Browser acceptance rests on exact-head CI.
- **`AGENTS.md`.** `next dev` adds the managed Next.js block. It stays in the working tree, intact and uncommitted, outside this slice.

## 6. For Codex review

- **R-1 `isolate()` and bot signals (§5).** The new tests add no signal change, but they depend on the existing helper's `navigator.webdriver` override and the config's fixed user agent, as the four reviewed tests do. Confirm this matches "use the existing supported full-browser configuration; do not alter `navigator.webdriver` or other bot-detection signals".
- **R-2 Placement.** The browser tests are appended to `posthog.pw.ts` rather than a new file, so `isolate()` is reused without being moved or exported. Playwright refuses to import one spec from another.
- **R-3 Workflow triggers.** `tests/fixtures/browser-session.ts` was added to both trigger lists because the lane now imports it. `src/components/mds/profiles/profileFixtures.ts` is already covered by `src/**`.
- **R-4 Temporary PR #192.** It was used only to run browser mutations through the supported job; it was closed unmerged and its branch deleted. Runs: A 45040209508, B 45040581998, C 45040888759.
- **R-5 Observation, no change.** `/register` shows the same "check your email" answer for an existing account (TRACE-103), but `signup_submitted` fires only when the provider returns no error. If Supabase ever returns an error for an existing address, PostHog would count new and existing signups differently. That is visible only to the analytics owner, not to the visitor. Pinned as current behavior ("only without error"); no decision requested now.
- **Unchanged decisions.** D-1..D-6 remain recommendations. The auth-handoff event (A-16) stays out of scope. F-1 is pinned, not changed (D-2).
