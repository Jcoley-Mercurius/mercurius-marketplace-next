# Phase 7.3D-2: operator purge control for expired provider reports (TRACE-155)

**Status: IMPLEMENTED ON A BRANCH, D-3 CORRECTED FOR CODEX REVIEW (§6). NOT MERGED, NOT DEPLOYED. NOT PHASE 7 ACCEPTANCE.** No migration. Nothing hosted was read or changed for this slice, no production purge was run, and no secret, webhook, probe, synthetic record or email was touched. Retention intervals, the deletion deadline and the weekly cadence remain **proposals** under EO-2 (activation checklist [`PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-ACTIVATION-CHECKLIST.md`](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-ACTIVATION-CHECKLIST.md) §2, on `main` since #186; its second revision is carried by this PR, §6.2); this control approves none of them.
**Authority:** the owner's 2026-11-21 instruction for one bounded slice: a manual operator purge control on `/admin/email-evidence` using the existing `email_provider_events_purge(p_limit)`. It resolves provisioning gap **PG-2** of the #186 checklist as method (i), "a reviewed operator purge control", once reviewed and deployed. Also the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §11.4, the [7.3B record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3B.md) (the function) and the [7.3D-1 review fixes](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1-REVIEW-FIXES.md) §2.5 (purge duty continues after any shutdown).
**Base:** first built on `main` `96c8149dfe4ba80484ad3e65efffb2ab39011fee` (the #185 merge); updated by merge to `main` `c74b8d75dd46f734b408e5a597bc7cb9aaa5994d` (the #186 merge), §6. Branch `claude/phase7-3d2-operator-provider-event-purge`, in the 7.3D-1 worktree.

## 1. Checkpoints (read-only, 2026-11-21)

| Item | Observed | How |
|---|---|---|
| `main` | `96c8149`, unchanged since #185 | `git fetch`; `git log origin/main` |
| #186 | Open, draft, head **`5ca707b`** (the head Codex reviewed), mergeable | `gh pr view 186` |
| #186 CI | Run 44916554729 on `5ca707b`: **success** (application, backend, lifecycle); Supabase Preview skipped | `gh pr checks 186` |

The instruction said 44916554729 was still running; it has since completed successfully. Nothing else was assumed current.

## 2. What was built

| File | Change |
|---|---|
| `src/lib/emailEvidence/purge.ts` (new) | `PURGE_BATCH_MAX = 1000`; `purgeArgs()` (always `{ p_limit: 1000 }`); a strict parser of the function's answer; `classifyPurgeError` (a coded refusal vs an unknown outcome); the wording. It makes no call |
| `src/app/admin/email-evidence/page.tsx` | A **Purge expired reports** control in "Stored provider reports", through the existing `ConfirmAction`; a live result region; a refresh failure after the first load is shown inline instead of replacing the page |
| `tests/unit/email-evidence-purge.test.ts` (new) | Request, parser, failure classes, wording and call-site guards |
| `tests/e2e/email-evidence-purge.spec.ts` (new) | Browser evidence, §3.2 |

**Unchanged:** every migration and SQL test; the function, its grants, the retention intervals (90 / 30 days), purge-on-receipt, the receiver, the ledgers, the money functions, the coverage commands, the probe route and `vercel.json` (no `crons`). `git diff origin/main -- supabase/` is empty.

### 2.1 Behaviour

- **Authorization.** The page is under the existing admin layout, and the call is made from the operator's own browser session with `createClient().rpc(...)`, as the coverage-window commands are. The database decides: `vendor_require_operator()` refuses anyone else (SQL 121 covers anon, vendor, customer and service role). No service-role path, server route or forged identity is added.
- **Confirmation.** "Permanently delete expired provider reports?" States that deletion is permanent and cannot be undone, that only reports whose retention has expired are deleted (oldest first, up to 1,000), and that unexpired reports, email records and the coverage-window history are not changed. Focus starts on Cancel. The confirm button uses the destructive tone.
- **One confirmation, one call.** `onConfirm` calls the function once with `{ p_limit: 1000 }`. There is no loop, timer, retry or background work; a further run needs a further confirmation. `ConfirmAction`'s in-flight guard, disabled buttons and refusal to close while pending stop a second call during the first.
- **Result.** "N expired reports deleted · time", then the backlog: "No expired reports remain", "N expired reports remain, the oldest expired …. Run it again to delete up to 1,000 more", or above the database's 10,000 counting cap, "More than 10,000 expired reports remain …". Then the existing retention readback is read again, so the counts and "Last purge" update.
- **Failures, kept apart:**
  - *Refused*, only for a documented pre-execution refusal (`PURGE_DEFINITE_REFUSALS`, §6.1): `42501`, `PGRST202`, `PGRST301`, `PGRST302`. The dialog says "The purge was refused: …. Nothing was deleted."
  - *Unknown*, for everything else: no code (transport failure, a gateway answer), and any other code, including `08007` and other connection states, `PGRST000`–`PGRST003`, timeouts, unknown codes and coded gateway or transport answers: "The purge's result is unknown: … (code). Reports may have been deleted. Refresh the counts before running it again." An unreadable answer is also unknown, never a success.
  - In both cases the counts are read again, and the dialog stays open with the error.
  - *Refresh failed after a successful purge:* the dialog closes as done; the result stays; the result region adds "The counts above were not refreshed after this purge. The deletion stands; use Refresh to read the current counts", and a separate alert names the refresh error. Nothing claims a rollback.

## 3. Evidence

### 3.1 Unit

`tests/unit/email-evidence-purge.test.ts`: the batch and argument; the parser accepts the documented answer and refuses 15 malformed shapes; it tolerates a count and oldest expiry left out of step by a concurrent purge-on-receipt (the function computes them in separate statements under READ COMMITTED); refused vs unknown, including a thrown value and nothing at all; wording, singular and plural, below and above the cap; call sites: only the page calls the function, exactly once, with no timer, loop or recursion in `runPurge`, and `vercel.json` has no `crons`.

### 3.2 Browser (synthetic, every other origin aborted)

`tests/e2e/email-evidence-purge.spec.ts`, readback and purge served per test:

| Test | Shows |
|---|---|
| Confirmation | Permanent, expired-only wording; focus on Cancel; Cancel and Escape make **0** calls |
| One confirmation | Exactly one call `{ p_limit: 1000 }`; result and backlog shown; readback read again (2 reads); counts and "Last purge" updated; no further call 1.5 s later while a backlog remains |
| Two confirmations | Exactly two calls |
| Pending | Triple click, a forced click, a dispatched click, Enter and Escape while the answer is held: **1** call; the dialog stays open, Cancel disabled, "Confirming…" |
| Over the cap | "More than 10,000" |
| Refused (403, `42501`) | "Nothing was deleted"; focus on the alert; no result; counts re-read; axe |
| Lost answer (aborted) | "unknown … may have been deleted"; never "Nothing was deleted"; not retried |
| Coded uncertain answers (added in §6): `08007` (500), `PGRST003` (504), a coded gateway answer (502), an unknown code (400) | Exact unknown wording with the code; never "Nothing was deleted" or "rolled back" anywhere on the page; no result; counts re-read once; exactly one call `{ p_limit: 1000 }`, none 1 s later |
| Unreadable answer | Unknown, not a success |
| Refresh fails after success | Result stays; "The deletion stands"; separate refresh alert; last figures kept; no rollback wording; axe |
| Responsive | Light 320 px, dark 320 px, dark 1,440 px: the dialog fits, buttons ≥ 24 px, axe (WCAG 2.2 AA tags) with the dialog open and with the result, no horizontal overflow |

The existing `email-evidence-arming.spec.ts` passes unchanged against this build. Results and the other checks are in the PR body, with exact counts.

## 4. Decisions for Codex

- **D-1, refresh failures.** A failed refresh after the first load now shows an inline alert and keeps the last figures for every refresh on this page (the Refresh button, the coverage commands, the purge), instead of replacing the page. The first load still shows the full-page error.
- **D-2, always enabled.** The control is offered even when the last readback shows no expired report: rows may expire after the read, and a run that deletes nothing still writes a dated run record, which the proposed weekly procedure records. Disabling at zero is a one-line change if preferred.
- **D-3, refused vs unknown** was first decided by the presence of an error code on the API answer. **Codex required a correction; see §6.1.** A code alone is now never proof of a rollback.
- **D-4, fixed batch.** The page always asks for 1,000, the largest the function accepts; there is no smaller-batch option.
- **D-5, no reason field.** The function takes none; its run record keeps the operator, time, applied limit, deleted count and remaining backlog.

**Codex outcome (2026-11-21):** D-1 accepted (a failed refresh keeps the existing figures with an inline stale-data alert). D-2 accepted (a run that deletes nothing stays available and is recorded). D-4 accepted (one fixed batch of 1,000 per confirmation). D-5 accepted (no reason field; the function's contract is unchanged). D-3 required correction (§6.1).

## 5. Dependencies and remaining gates

- **PG-2 (#186):** method (i), this control, after Codex review, merge and the deployment READY on the merge commit. Until then H-9 and checklist step 30 still cannot run. The checklist's second revision says so; it reaches `main` with this PR (§6.2).
- **EO-2** is still a proposal: 90 / 30 days as implemented, P-2 with D = 14 days, a weekly manual run with Josh accountable. Under the proposed procedure, a weekly run is repeated confirmations of this control, at most 10, until a run deletes fewer than 1,000.
- Not done: merge, deploy, production purge, secrets, webhook registration, probes, synthetic production records, email. Every other activation gate in #186 §5 and §7 stays open.

## 6. Codex review correction and checklist recovery (2026-11-21)

### 6.1 D-3 corrected: refusal only from a documented allowlist

**Finding.** Any nonempty `code` was treated as proof of a rollback. That is wrong in two ways. A Postgres code can report an outcome-uncertain state: `08007` (transaction resolution unknown) means the commit may have happened. And postgrest-js passes a non-2xx JSON body through unchanged as `error` (`@supabase/postgrest-js` 2.112.0, `processResponse`), so a gateway or proxy answer that carries its own `code` field reached the "Nothing was deleted" wording.

**Correction** (`src/lib/emailEvidence/purge.ts`). `classifyPurgeError` returns `refused` only for a code in `PURGE_DEFINITE_REFUSALS`. Each code on the list is answered before the function deletes a row:

| Code | Why nothing was deleted |
|---|---|
| `42501` | Raised by `vendor_require_operator()`, the function's first statement, before the delete (migration `20260905002000`); PostgreSQL also raises it for a missing EXECUTE grant before the body runs. The function raises no other code itself |
| `PGRST202` (404) | PostgREST found no such function; nothing was called |
| `PGRST301`, `PGRST302` (401) | PostgREST rejected the JWT, or a request without one, before sending anything to the database (PostgREST 12.2 error reference) |

Everything else is `unknown`: no code, `08007` and the other class-08 connection states, `57P01`, `57014`, `PGRST000`–`PGRST003`, `PGRST303` (not in the 12.2 reference, so not listed), unknown database codes, unknown nonempty codes, coded gateway answers (string or number), coded transport answers, and lookalikes (`42501x`, `pgrst202`). The unknown wording names the code it was given and makes no claim about it. Only the listed cases say "Nothing was deleted".

**Unchanged:** one call per confirmation, no retry, the unreadable-answer path (`PURGE_UNREADABLE`, unknown), the separation of a successful command from a failed refresh (D-1), and the database function and its contract.

**Regressions.**
- Unit (`tests/unit/email-evidence-purge.test.ts`, 54 tests): `42501` and the three API refusals say nothing was deleted; the allowlist is exactly those four codes; 19 uncertain cases (above) are unknown and never say "nothing was deleted" or "rolled back"; the unknown wording carries the code.
- Browser (`tests/e2e/email-evidence-purge.spec.ts`): four coded uncertain answers (`08007` 500, `PGRST003` 504, a coded 502 gateway answer, an unknown code 400) show the exact unknown wording, never "Nothing was deleted" anywhere on the page, no result, one readback refresh and exactly one call. The `42501` refusal test still says "Nothing was deleted".
- **Mutation check.** With the old rule restored locally (`if (code) return refused`), 16 unit tests failed and all 4 new browser tests failed; the `42501` browser test still passed. With the old rule, `08007` displayed "The purge was refused: transaction resolution unknown. Nothing was deleted." The fix was restored and rebuilt before the final runs.

### 6.2 Recovery of the second checklist revision

`e85996a` ("Second revision of the 7.3D activation checklist") was pushed to the #186 branch **after** #186 had merged at `5ca707b`, so it never reached `main`. Its CI run 44932694362 on `e85996a` ended **cancelled** (backend and lifecycle success, application cancelled); no run on the closed #186 branch released those amendments in any case. They are carried here as commit `08ac8a5`, a cherry-pick of `e85996a`:
- the checklist and plan §6.4 text are byte-identical to `e85996a`;
- HANDOFF and TRACEABILITY were applied on top of `main` `c74b8d7` and the 7.3D-2 entries, keeping both sides (the 7.3D-2 and checklist handoff sections; the checklist, second-revision and 7.3D-2 parentheticals in the TRACE-155 row).

The amendments need Codex review here as part of this PR. They authorize nothing.

### 6.3 Chronology (UTC, 2026-11-21)

| Time | Event |
|---|---|
| 13:16 | #185 merged; `main` `96c8149` |
| 14:56 | #186 head `5ca707b` pushed (Codex-reviewed head); PR CI 44916554729 later success |
| 15:45 | #186 merged at `5ca707b`; `main` `c74b8d7` |
| 17:55 | `eb4e574` pushed as #187 (built on `96c8149`); CI 44932637104 started |
| 17:55 | `e85996a` pushed to the already-merged #186 branch; CI 44932694362 started, later **cancelled** |
| Later the same day | Codex review of #187: D-1, D-2, D-4, D-5 accepted; D-3 correction required; recovery of `e85996a` required |
| 18:15 | #187 updated: merge of `main` `c74b8d7` (`60bfa10`), recovery of `e85996a` (`08ac8a5`), D-3 correction and this record (next commit). At the update, CI 44932637104 on `eb4e574` had backend and lifecycle success and application still in progress |

Final-head CI is reported in the PR body, not here, so that recording it does not change the head it describes.
