# Phase 6 A1 review manifest

**Status:** PREPARED FOR CODEX, 2026-11-05 (America/New_York). This lists what an independent Codex review must cover before the owner can accept Phase 6 (closure report §3 A1, §9). It is not a review and closes no gap. Claude's self-review, PR descriptions, bot comments (CodeRabbit, Supabase) and green CI are evidence, not review records (closure report §3).

**Checked 2026-11-05:** `origin/main` = `cbd65a7` (#146, CI push run 42043627700 green). Open PRs: #147 only. Hosted migration history (read-only `supabase migration list --linked`): all 219 local migrations paired, ending at `20261114001000` (#147's migration, pushed 2026-11-05 with owner authorization). Searched the repository (governance, docs/agent) and PR reviews/comments for #137–#147: **no Codex code review is recorded for any row below.**

**How to read a range:** `A..B` means `git diff A B`. For a merged PR it is its merge commit's first parent to the merge commit, which is exactly what the merge brought to `main` or to its base branch. A stacked PR's own diff is its base branch head to its head.

## 1. Merged to `main` without a recorded Codex code review

| # | Slice / repair | Range (`git diff`) | Size | Governing requirement | Evidence on record | Review status |
|---|---|---|---|---|---|---|
| 1 | 6.1 request submission, TRACE-095 | `bb57a61^..c2b9b81` | 27 files | CFG-001/002; DEC-2026-020/021; scope §6.1 | SQL 063–065; SQL 109 J1 | decision review only ([PHASE-6-DECISION-REVIEW](PHASE-6-DECISION-REVIEW.md)); **no code review** |
| 2 | 6.2 intake, P6-R2/P6-R3 repair, TRACE-098 | `63f1537^..63f1537` | 6 files | MDS intake; scope §6.2 | SQL 066; browser `request` | review of `c2b9b81..634837a` recorded with changes required; **re-review of the repair open** |
| 3 | 6.3 matching, TRACE-099 | `be58eee^..211a12e` | 18 files | CFG-009 | SQL 067; J1 offer | **none** |
| 4 | 6.4 quotes, TRACE-119 (#106) | `b8f1095..0675805` | 29 files | DEC-2026-045 G1–G6; CFG-015 | SQL 090; J2 | **none** |
| 5 | 6.5 appointments, TRACE-121 (#109) | `0ba710e..404ea29` | 22 files | MPS §6.3; DEC-2026-060 D-3 | SQL 092; J1 | **none** |
| 6 | 6.6a visits, TRACE-123 (#111) | `0138080..61f0601` | 25 files | DEC-2026-049 items 1–4, 9 | SQL 095; J3 | **none** |
| 7 | 6.6b cadence, TRACE-124 (#112) | `61f0601..5e6d6ce` | 22 files | DEC-2026-049 items 1–4 | SQL 096; concurrency | **none** |
| 8 | 6.6c visit payments, TRACE-125 (#113) — **money path** | `5e6d6ce..7502342` | 22 files | DEC-2026-049 items 5–6 | SQL 097; concurrency | **none**; the two-person finance review missed before merge is carried as an R1 blocker (D-10) |
| 9 | 6.7 fulfillment, TRACE-128 (#114) | `7502342..afb7c83` | 24 files | scope §6.7 | SQL 098; J1/J3 | **none** |
| 10 | 6.8 reviews, TRACE-130 (#116) | `ef1cc33..de8e802` | 26 files | DEC-2026-009/010; DEC-2026-052 (D-5) | SQL 100 | **none** |
| 11 | 6.9A/6.9B exceptions and 6.10 support, TRACE-131/132/133 (#121) | `737474f..2dd9bed` | 70 files | CFG-006/007/008/010/011; DEC-2026-053; DEC-2026-054 (D-6a–e) | SQL 101–103; J4–J6; concurrency | **none** (PR body says "reviewed in #118/#119"; no record) |
| 12 | 6.10 completion (#125) | `2dd9bed..ad4656b` | 5 files | as 11 | — | **none** (6.10's content reached `main` in #121; this merge adds 5 files) |
| 13 | 6.11A offering versions, TRACE-134 (#126) | `ad4656b..475f03d` | 25 files | DEC-2026-055 item 2; DEC-2026-039 item 2 | SQL 104; concurrency | **none** |
| 14 | 6.11B listing and 6.12A compliance, TRACE-134/135 (#128) | `475f03d..8bcbfbe` | 44 files | DEC-2026-055 item 1; DEC-2026-056 items 7–8 | SQL 105–106 | **none** |
| 15 | 6.12B earnings, TRACE-135 (#129) | `8bcbfbe..b1a8cc3` | 18 files | DEC-2026-056 items 1–6 | SQL 107 | **none** |
| 16 | 6.13 admin operations, TRACE-136 (#132) | `0ad926d..015f371` | 45 files | DEC-2026-057 as amended | SQL 108 | Codex findings recorded (brief §12.7); coverage not stated |
| 17 | 6.13 review fixes (#134) and forward fix (#135) | `015f371..85bb7c6` | 24 files | DEC-2026-057 | SQL 108; concurrency A1–A8 | **none** |
| 18 | Closeout audit, SQL 109, manual fixtures, TRACE-137 (#136) | `85bb7c6..90f6e48` | 10 files | PHASE-6-SCOPE acceptance checkpoint | SQL 109 98/98 | **none** (report and journeys) |
| 19 | CS-1 grants and `/vendors` copy, TRACE-138 (#137) | `90f6e48..d7f073d` | 7 files | DEC-2026-055 item 1; DEC-2026-056 items 1–2, 5 | SQL 110; browser | **none**; migration `20261110001000` on hosted |
| 20 | Analytics URL redaction, TRACE-139 (#138) | `d7f073d..b7b0d08` | 7 files | DEC-2026-059 | unit 6/6 | **none** |
| 21 | Decision answers, TRACE-140 (#139) | `b7b0d08..2556148` | 6 files | DEC-2026-060 | documentation | **none** (record review) |
| 22 | CS-8 contrast, TRACE-141 (#140, via #145) | `11fdee4..7b344dc` | 4 files | MDS WCAG 2.2 AA | axe on `/vendors` | **none** |
| 23 | CS-7 hold-reason grants, TRACE-142 (#141, via #145) | `7b344dc..9462757` | 5 files | DEC-2026-056 item 3 | SQL 111 | **none**; `20261111001000` on hosted |
| 24 | CS-2 Top Rated, TRACE-143 (#142, via #146) | `9462757..330789e` | 8 files | DEC-2026-058 (D-7) | browser; unit | **none** |
| 25 | CS-9 dispute categories, TRACE-144 (#143, via #146) | `330789e..1d59295` | 10 files | DEC-2026-054 item 1 (D-6b) | SQL 112 | **none**; `20261112001000` on hosted |
| 26 | CS-5 recurring start gate, TRACE-145 (#144, via #146) | `1d59295..b56c1bf` | 10 files | DEC-2026-050 A (D-4) | SQL 098/095/109 rewritten; concurrency `fulfillment` | **none**; `20261113001000` on hosted |

Rows 22–26 are the stack's own diffs. `0a173bd` (#145) and `cbd65a7` (#146) brought them to `main` together: `2556148..cbd65a7`, 31 files.

## 2. Open, not merged

| # | Item | Range | Governing requirement | Evidence | Review status |
|---|---|---|---|---|---|
| 27 | TRACE-146 onboarding decision sets `is_active` (#147; *merged 2026-11-06 as `02e04a0`*) | `cbd65a7..bd40701` (3 commits, 9 files) | DEC-2026-061; DEC-2026-057 item 3 | §3 below | **none**; migration already on hosted |
| 28 | This closeout packet (TRACE-147; *#148 merged 2026-11-06 as `61a441a`*) | branch `claude/phase6-closeout-a1-packet` from `cbd65a7` | closure report §9 | probe, lock-order demonstration, this manifest | **none** |
| 29 | **CS-4 / CS-3 plan** (must be cleared before any money function changes). *2026-11-06: CS-4 architecture cleared with five amendments (plan §7); this is a plan review, not a code review* | [PHASE-6-BOUND-TERMS-PLAN.md](PHASE-6-BOUND-TERMS-PLAN.md) | DEC-2026-060 D-1, D-2, D-4; DEC-2026-049 item 6 | probe + lock-order evidence | **plan review requested** |
| 30 | **CS-4 code**, TRACE-148 (#149; *merged 2026-11-06 into the closeout branch as `c3ce575`, not into `main`; reaches `main` with #150*) | `360e104..84f8d16` (2 commits) | DEC-2026-060 D-2; DEC-2026-062; plan §7 | plan §7.4 | **none**; finance review none; `20261115001000` **not** on hosted. *2026-11-07: #150 merged to `main` as `98fe138` and deployed; `20261115001000` **is** on hosted (fingerprint `48 \| 88c9a260…` matches); no push record in the repository; Codex code review and finance review still none; pre-release gates missed, not satisfied (plan §9.1)* |
| 31 | **CS-3 code and plan §8**, TRACE-149 (stacked on #150) | branch `claude/phase6-cs3-one-time-bound-terms` from `c3ce575` | DEC-2026-060 D-1; DEC-2026-062; plan §4, §8 (R-2 to R-5 as built; F-C1; O-10) | plan §8 | **none** (plan §4 and §8 reviewed with the code); finance review none; `20261116001000` **not** on hosted. *2026-11-07: #151 merged into the closeout branch (`a26a7fd`) after that branch had already gone to `main`; CS-3 is **not** on `main` (plan §9.1)* |
| 32 | **O-10 repair plan**, TRACE-150 (DEC-2026-063, proposed) | plan §9 on branch `claude/phase6-o10-offer-bound-terms` from `7d0bdba` | DEC-2026-063; DEC-2026-060 D-1; DEC-2026-062; DEC-2026-053 E5/E6 | plan §9.1 readback | **plan review requested** (P-1 to P-10); owner: confirm DEC-2026-063, answer P-3 and O-11 (proposed) |

## 3. Reconciliation done for this packet (2026-11-05)

- **Clean replay, `main` `cbd65a7`** (isolated stack, `scripts/prepare-phase5-local.mjs` then `phase5-db.sh reset` and `test`): 218 migrations; **103 files, 6,546 tests, PASS**; fingerprint `45 | 34c51131e2ca18f65d3b29afd8d12e11`. This covers CS-1 (SQL 110), CS-7 (111), CS-9 (112), recurring CS-5 (095/098/109), 6.1–6.13 and SQL 109. It matches the 2026-11-04 stack record (103 / 6,546). **No regression found** in CS-1, CS-2, CS-7, CS-8, CS-9 or recurring CS-5. CS-2 and CS-8 are browser-level; their evidence is `main` CI run 42043627700 (application job green). The browser suite was not rerun locally.
- **#147 clean replay at `bd40701`:** 219 migrations; **104 files, 6,576 tests, PASS**; fingerprint unchanged. CI pull_request run 42052147727 at `bd40701` is green, including "Concurrent activation role grants", "Clean reset after committed concurrency fixtures" and "Verify clean replay". The earlier failure (run 42044989171 at `493bdb0`) was the activation-role concurrency script, which `bd40701` updated. That fills the handoff's "clean-replay suite run" gap: the 2026-11-05 run had used a database holding seeded fixtures.
- **#147 baseline against changed:** SQL 113 run against `main`'s schema and against #147's; results in §3.1.
- Hosted read-only aggregate: 0 open requests, 0 visits, 0 obligations, 0 snapshots, 0 plan terms.

### 3.1 SQL 113 on `main` against #147

#147's SQL 113 file, run with `psql` on a clean replay of each schema (isolated stack, 2026-11-05):

| Schema | Result | Failing assertions |
|---|---|---|
| `main` `cbd65a7` (no `20261114001000`) | 21/28 | 4 activation sets `is_active`; 5 activated, listed provider meets the listing rule; 16 reactivation sets `is_active`; 18 renewal leaves an active provider active; 24 its `is_active` is set; 27 an admin still can't change `is_active` directly; 28 the refused direct write changed nothing |
| #147 `bd40701` | 28/28 | — |

27 and 28 follow from the missing write, not a guard difference: on `main` the provider's `is_active` is already false, so the test's direct `update … set is_active = false` changes nothing and the guard doesn't fire. The other 5 are the activation write DEC-2026-061 adds. Reject and renew behavior are unchanged on both schemas (assertions pass on both).

## 4. What Codex is asked to do

1. Review rows 1–27 (one review per row, or one integrated review naming every range) and record it in the repository with the range covered. Rows 8 and 29 touch money paths.
2. Clear, amend or reject the CS-4/CS-3 plan (row 29), including R-1 to R-5. Implementation of either money change waits for this.
3. Review this packet's record changes (row 28).
4. *(2026-11-06)* Code-review CS-4 (row 30) and CS-3 with its plan items (row 31). Both change money functions and also need the two-person finance review before reaching `main`.

Findings go to bounded forward-fix slices. A fix to a surface covered by a human-check script invalidates that script's result (closure report §4.5 A2).
