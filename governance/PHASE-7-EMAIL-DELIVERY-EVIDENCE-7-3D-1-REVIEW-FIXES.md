# Phase 7.3D-1 review fixes: whole-ID probe exclusion, logical expiry, coverage-window wording and the Production-only probe gate (TRACE-155)

**Status: IMPLEMENTED LOCALLY. NOT PUSHED, NOT MERGED. NOT PHASE 7 ACCEPTANCE.** The forward migration `20261129001000` is not applied to the hosted database. Nothing is armed, registered, enabled or sent. EO-1..EO-8 remain **proposals**; these technical resolutions approve none of them.
**Authority:** the owner's 7.3D-1 review-fix instruction (2026-11-20), which relays Codex's review of #184: resolutions for D-11, logical expiry, coverage-window wording and D-8. Codex accepts D-2 (partial coverage is rule 9), D-5 (an admin API route) and D-4 (page controls), the last subject to the wording repair here. No Codex review is posted on #184 in GitHub; the instruction is the review record. Also the [7.3D-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md), the [readiness record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) and the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §8.3, §8.4 and §18.
**Base:** `main` `8a40fa46e7752ae5d6625287fb684a941978ced4` (the #184 merge). Branch `claude/phase7-3d1-review-fixes`, in the 7.3D-1 worktree with its isolated synthetic stack (ports 5606x) and browser ports (3176/56861).

## 1. Checkpoints, verified at the start (read-only, 2026-11-20)

| Item | Observed | How |
|---|---|---|
| `main` | `8a40fa46e7752ae5d6625287fb684a941978ced4`, the #184 merge (head `14bf921`) | `git fetch`; `git log origin/main` |
| #184 | **Merged** 2026-11-20 22:07:38 UTC | `gh pr view 184` |
| #184 CI | Run 44819981767 on `84b1850` succeeded (recorded in the PR body; `14bf921` is a `[skip ci]` merge of `main` with an identical tree) | PR body |
| `main` CI | Run [44826293688](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/44826293688) on `8a40fa4`: **success**, backend, lifecycle and application jobs, completed 22:43:16 UTC. Analytics privacy run 44826293578 also succeeded | `gh run view`, `gh run list` |
| Production deployment | GitHub deployment 7953668880 (environment Production, created 22:09:05 UTC) for `8a40fa4`, status **success**, URL `mercurius-marketplace-next-dt5n14xyx-mercurius-projects.vercel.app`; Vercel commit status "Deployment has completed" | `gh api …/deployments`, `…/statuses` |
| Hosted migrations | Local and remote match through **`20261128001000`** | `supabase migration list --linked` |
| Hosted state | `email_evidence_probe_readback` md5 `2d02c820f1d7a7a5356636e1e5e6e19f` (the 7.3D-1 definition) and summary `8eadddd6…`; 0 arming events; no `armed_at`; **0 receipts**; two probe functions; probe readback executable by `authenticated` only. Read at 23:04:46 UTC | one read-only `supabase db query --linked` of hashes and counts; no row content |

Who pushed `20261128001000`, and when, is not recorded in this repository. #184's body still said "not pushed" when written. Codex observed it applied, and so did this session; the push provenance stays an open item (§7).

## 2. Resolutions

### 2.1 D-11: whole-provider-ID exclusion, enforced

**Defect.** The 7.3D-1 record (D-11, §3 R3D-3) says an ID with any linked, tagged or conflicted receipt is not probe evidence and none of its receipts is returned. The shipped `email_evidence_probe_readback` checked only `identity_class <> 'unmatched' or tag_ledger is not null`. An **unmatched receipt carrying the permanent content-conflict flag** therefore did not exclude its ID, and a valid expected-event receipt for the same ID was returned beside it. The TypeScript verdict then found the expected unlinked event and reported **"Expected provider report received"**. SQL 125 had encoded this, returning the conflicted receipt marked excluded with `not_probe = false`.

**Repair (forward migration `20261129001000`).** `public.email_evidence_probe_readback(text)` is restated with the same signature, return type and keys, `security definer`, empty `search_path` and grants. Eligibility reads each receipt through the existing trust and expiry predicate, `private.email_evidence_receipt_state` (`20261125002000`). For an unexpired receipt:

| Disqualifies the whole ID when | Definition used |
|---|---|
| linked | `identity_class` `id_only`, `tag_only` or `tag_and_id` (state `trusted` or `current_conflict`) |
| tagged | any stored tag (`tag_ledger is not null`) |
| conflicted | state `stored_conflict`, `content_conflict` or `current_conflict`: the same three exclusion reasons the 7.3C-1/7.3C-2 readbacks and counts use |

A disqualified ID returns `not_probe = true` and `receipts = []`. Otherwise every returned receipt is `unlinked`. The key keeps its name, `not_probe`, so the deployed route keeps working between the hosted push and the merge (DEC-2026-037). The function is `STABLE`, so its eligibility check and its receipt list read one snapshot (concurrency P-1, §4).

**Defence in depth (TypeScript).** `probeVerdict` returns `not_probe_evidence` when `not_probe` is set **or any returned receipt is not `unlinked`**. A database still on `20261128001000` therefore cannot yield a success either. When the verdict is `not_probe_evidence`, the route strips the receipts, and the page lists only unlinked receipts and none for an excluded ID.

**Truthful wording.** The verdict `not_a_probe` ("This send is not a test probe; its reports are not shown here") became `not_probe_evidence`: "Not usable as test evidence: a current report for this send is matched to an email record, carries Mercurius tags or is in conflict, so none of its reports are shown". A content-conflicted probe *is* a probe; the wording no longer says otherwise.

### 2.2 Logical expiry in eligibility

The shipped exclusion check read **every** stored receipt, expired or not, while the receipt list already filtered `expires_at > now()`. An expired linked or conflicted receipt, logically gone but awaiting purge, could still exclude an ID. Now an expired receipt (`expires_at <= now()`, the predicate's own boundary) is ignored for eligibility, verdict and output alike. An ID whose only receipts are expired reads as "no receipts yet", never as excluded and never as evidence. A physical purge changes no readback (SQL 126 §5).

### 2.3 Coverage-window wording (D-4 kept, repaired)

The receiver accepts and stores a report whenever `RESEND_WEBHOOK_SECRET` is deployed and the endpoint is registered; it answers 503 without the secret. It never reads `armed_at` or the arming history. So the arm and disarm commands **record the start and end of a coverage window**, an operator's dated declaration used for labels. They do not enable or disable ingestion, and a window alone does not show that the receiver was available.

The manual controls stay. Every operator-facing statement now says what the marker is:

| Where | Before | After |
|---|---|---|
| Page intro | "When Mercurius collects Resend's delivery reports… Recording a start or stop here does not register the webhook, set a secret or send email." | "The coverage windows recorded for Resend's delivery reports… recording its start or end does not turn report receipt on or off, register or remove the webhook, set or remove a secret, or send email, and does not show that reports are arriving." |
| Card / state | "Report collection"; "Collecting provider reports since …"; "Not collecting provider reports. Collection has been stopped / has never been started." | "Coverage window"; "A coverage window has been recorded as open since …. This is a record, not a check that reports are arriving."; "No coverage window is open. The last recorded window has ended."; "No coverage window has ever been recorded." |
| Controls | "Start collecting reports" / "Stop collecting reports"; confirm "Start collecting" / "Stop collecting" | "Record coverage window start" / "Record coverage window end"; confirm "Record start" / "Record end" |
| Start confirmation | "Emails sent from now on will say reports are being collected for them. Start only after the webhook is registered and its secret is deployed; recording a start does neither." | "…labeled as sent inside a recorded coverage window. This only records the start: it does not turn on report receipt, register the webhook or deploy its secret, which are separate owner-authorized steps. Record it only after they are done." The EO-1 attestation is unchanged |
| End confirmation | "…will say reports were not being collected… collection was interrupted… This does not remove the webhook or its secret." | "…labeled as sent with no coverage window recorded… in a window that ended early. This only records the end: it does not stop Resend reports arriving, and it does not remove the webhook or its secret. Stopping receipt is the separately authorized shutdown procedure. Stored reports stay until purged." |
| History | "Collection history"; "Collection started" / "Collection stopped" | "Coverage window history"; "Coverage window start recorded" / "Coverage window end recorded" |
| Coverage meanings | "What an email's collection status means"; "Sent while reports were collected…", "Sent while provider reports were not being collected", "…collection continued for 28 hours after" | "What an email's coverage label means"; the 28 h follow Resend's documented retry schedule and are how long a window must stay open, not proof that every report was collected (D-3); "Sent inside a recorded coverage window…", "Sent while no coverage window was recorded", "…stayed open for 28 hours after" |
| Rule 9 (complete) | "No provider report received in the 28 hours reports were collected after sending" | "No provider report received; a coverage window was recorded for 28 hours after sending" |
| Rule 9 (partial) | "No provider report received; collection stopped within 28 hours of sending, so a report may have been missed" | "No provider report received; the recorded coverage window ended within 28 hours of sending, so a report may have been missed" |
| Rule 10 (gap) | "Delivery evidence not available: reports were not being collected when this was sent" | "Delivery evidence not available: no coverage window was recorded when this was sent" |
| Purge duty | "…even while collection is stopped." | "…even when no coverage window is open." |
| Delivery-evidence card on Owner Emails, Recruiting and price drafts (7.3C-1 component, shown while no window is open) | "Resend delivery reports are not being collected yet, so emails show “Delivery evidence not available”." (described as history in the 7.3C-1 record) | "No coverage window is recorded for Resend delivery reports, so emails without a report show “Delivery evidence not available”." |
| Stored reports | "Stopping collection or rolling back a release deletes nothing" | "Recording a window end, stopping receipt or rolling back a release deletes nothing" |

Rule 9 for `collecting` ("No provider report yet") and every rule 1–8 label are unchanged. The rule numbers, coverage values and SQL are unchanged: this is wording only. **D-3 is preserved**: the 28 h horizon is a retry-window convention, and a `complete` label says a window *was recorded* for that period, not that collection was uninterrupted.

**Shutdown procedure (unchanged, separately authorized).** Stopping receipt means removing `RESEND_WEBHOOK_SECRET` from Production, disabling or removing the Resend webhook endpoint, or promoting an earlier deployment. Each is a hosted action that needs the owner's authorization. Recording a window end is not one of them and does not replace them. Purge duty continues after any of them while anything is stored.

### 2.4 D-8: Production only, failing closed

`probeGate()` opens only when `EMAIL_EVIDENCE_PROBES_ENABLED === "true"` **and** `VERCEL_ENV === "production"`. Both are compared raw, untrimmed. A missing `VERCEL_ENV` (any local or CI process), `preview`, `development`, `Production`, `" production"` or anything else answers 404 before the request, session or database is touched, logged as `probe_environment_refused`. There is no runtime bypass. Unit tests set a mocked Production configuration in `process.env` and stub every send: the fetch stub serves only Resend's send endpoint and fails on any other URL. The browser suite runs the real built route with no flag and no `VERCEL_ENV`, so it answers 404. `.env.example` describes the requirement. This supersedes the 7.3D-1 record's D-8 ("a non-Vercel process passes the environment gate").

## 3. Forward migration `20261129001000_phase7_email_evidence_probe_eligibility.sql`

- **Scope:** `create or replace` of `public.email_evidence_probe_readback(text)` only, re-stating its unchanged revoke and grant. No table, column, trigger, index or other function changes. `lock_timeout` 2 s. Applying it twice gives the same definition.
- **Hashes (local isolated stack):** probe readback `2d02c820f1d7a7a5356636e1e5e6e19f` → **`bd5da284bbd54764df0986ac1153e529`**. Unchanged: the other eight 7.3D-1 functions `8 | 8fbc18c05a0ed9f360bc9b266423f509`, the summary `8eadddd6…`, every 7.3C-1, 7.3C-2, 7.3B, ledger, owner-email and renewal hash pinned in SQL 125 §14, and the columns hash.
- **The shipped `20261128001000` file is not edited.**

### 3.1 Dry-run expectation (for the owner-authorized push, not run here)

1. Codex review of this PR and green exact-head CI.
2. Owner authorization. Then `supabase db push --linked --dry-run` must list **only `20261129001000`** (hosted head `20261128001000`, §1). Anything else: stop.
3. `supabase db push --linked`. It replaces one function under a 2 s lock timeout; no table lock is taken. On `55P03` the CLI's per-file transaction aborts with nothing applied: do not loop; retry once at a quiet time or return to Codex.
4. Read-only readback: probe readback md5 `bd5da284…`; the other eight 7.3D-1 functions `8 | 8fbc18c0…`; summary `8eadddd6…`; `authenticated` execute only (not `anon` or `service_role`); 0 arming events, no `armed_at`; receipt count as before (0 at the §1 read); money fingerprint `58 | af0fae6e…` unchanged.
5. Merge = deploy. The probe stays off (no `EMAIL_EVIDENCE_PROBES_ENABLED`, and now also `VERCEL_ENV` must be `production`); the receiver stays dormant (no secret).

**Compatibility in both orders.** If the push lands first, the live #184 code reads the same `not_probe` key, and its verdict was already `not_a_probe` for `not_probe = true`. If the code deploys first (a missed push), the new TypeScript guard refuses any mixed readback, so no success is possible. The expiry repair then waits for the push. Push it as soon as it is noticed (DEC-2026-037).

### 3.2 Rollback and forward repair

- **Application rollback:** `vercel promote <previous dpl_id>` restores #184's code. It reads the same keys; the repaired function stays and is stricter. No data changes either way.
- **Database:** no down-migration. The function holds no state, so reverting means a **new** forward migration restating the previous definition, which is the body in `20261128001000` §5. That would reintroduce the D-11 defect, so it needs Codex review and owner authorization. Prefer a forward fix.
- **A failed push** (lock timeout) leaves the hosted function unchanged at `2d02c820…`; the deployed code's guard still refuses mixed readbacks.
- Nothing here touches receipts, the arming history, purge or retention. Purge duty is unaffected.

## 4. Evidence (local, synthetic; every send stubbed)

| Check | Result |
|---|---|
| **SQL 126** (new; first version, 56 assertions) against the **unrepaired** function (stack at `20261128001000`) | **FAIL 9/56**, the defect reproduced: the content-conflict cases A (conflict after a valid expected bounce; the old function returned the bounce, the `email.sent` and the conflicted receipt) and B (conflict first); the expiry cases H (three expired disqualifying receipts excluded a current bounce), I (an expired linked receipt kept excluding) and K (a current content conflict one microsecond before expiry did not exclude); purge stability; the predicate check and the definition pin. One further failure (H's state list order) was a test-ordering slip, fixed before the passing run |
| SQL 126 after `20261129001000` (clean reset) | **58/58** (two boundary assertions N/O added after the mutation run below): shape and grants; refusals for anon, the service role, a homeowner, a vendor and a user with no role (42501), reading nothing and writing nothing; an operator cannot read receipts directly; D-11 in both arrival orders; stored identity conflict, linked (an earlier unmatched receipt plus a later `id_only`), tagged-and-linked and tagged-conflict receipts each beside a valid receipt; an unrelated ID unaffected; expired content-conflict, tag-invalid and tagged-disagree receipts beside a current bounce; an expired linked receipt; the exact boundary (`expires_at = now()` expired, `now() + 1 µs` current) for content-conflicted, tagged-conflicted and valid receipts; only-expired IDs; nine expired receipts still stored until the operator purge deletes them, with every readback identical before and after; read purity (byte-identical history, record, receipts, purge audit and ledger); no reclassification; unchanged definitions and pinned hashes |
| SQL 126 mutations of the repaired function (applied to the stack, SQL 126 run, original restored and re-read as `bd5da284…`) | Ten, counted by **behavioural** failures (the definition pin always fails for a changed body): M0 no-op control passes; caught: M1 drop `content_conflict` (3), M2 drop `stored_conflict` (1), M4 drop the linked classes (2), M6 ignore expiry in eligibility (3), M8 return expired receipts (6), M7 an inclusive expiry boundary in eligibility (0 at first: the boundary cases used content conflicts, which are already `expired` by state; N/O added, then 2). Equivalent, as expected: M3 drop `current_conflict` (implies a linked class), M5 drop the tag clause (every tagged class is linked or conflicted; F-3), M9 list conflicted receipts too (unreachable once the ID is eligible) |
| SQL 125 (one deliberate edit, marked `TRACE-155 (7.3D-1 review fixes, 20261129001000)`) | **153/153**. The content-conflicted probe case now expects `not_probe = true` and no receipts; the 7.3D-1 expectation is quoted in the comment |
| SQL 122 / 124 (unchanged) | 169/169, 244/244 |
| **Full SQL**, clean reset | **118 files / 8,551 PASS** with the final SQL 126 (58). An earlier run with SQL 126 at 56 gave 118 / 8,549. Was 117 / 8,493 |
| `email-provider-events-migration-lock.mjs` (step 8 added) | PASS: 55P03 on each ledger (≈2.2 s); the chain 7.3B → 7.3C-1 → 7.3C-2 → 7.3D-1 → review fixes re-applies. Re-applying 7.3D-1 restores `2d02c820…`; the unchanged forward file restates `bd5da284…` with its grants |
| `email-provider-events-concurrency.mjs` | PASS (unchanged) |
| `email-evidence-arming-concurrency.mjs` (P-1 added) | A-1..A-5 PASS. P-1: see §4.1 |
| Unit | 79 files / **1,214** (1,207 + 7 new or split): D-11 mixed readbacks for each disqualifying state in both orders; the excluded label; the route strips receipts on exclusion; D-8 gate (flag values; `VERCEL_ENV` absent, empty, `preview`, `development`, `staging`, `Production`, `PRODUCTION`, padded; exact `production`); the route refused with `VERCEL_ENV` absent, Preview, Development and `Production`, reading nothing; open in mocked Production with exactly one stubbed send; coverage, rule 9/10, history and purge wording, with no label saying collected/collection or enabled/disabled. Locally, vitest also picks up the ignored `.phase5-local/iso` browser copies; run with `--exclude '.phase5-local/**'` |
| Lint, typecheck, secret scan | pass |
| Build (`MERCURIUS_BUILD_WORKERS=1`, synthetic fixture URL for the isolated ports) | pass; `○ /admin/email-evidence` and `ƒ /api/admin/email-evidence-probe` listed |
| Browser | §4.2 |
| Exact-head CI | §4.3 |

### 4.1 Concurrency P-1

On the isolated stack, after a clean reset and in CI order (migration lock, provider-events concurrency, then this script): A-1..A-5 PASS, and **P-1 PASS**. Eight rounds; each stores three valid receipts for a fresh provider ID, then fires 12 staggered operator readbacks while a 13th session re-sends one receipt with a changed payload (content conflict). Of 96 reads, 91 saw the whole ID eligible with all three receipts `unlinked` and 5 saw it excluded with nothing returned; **none was mixed**. After each commit the ID read as excluded. Against the unrepaired function, P-1's post-commit assertion would fail, because that function returned `not_probe = false` with a `content_conflict` receipt.

### 4.2 Browser

`tests/e2e/email-evidence-arming.spec.ts` updated: never-recorded state (light, dark, 320 px, axe); recorded-open state, whose page text contains no "collecting provider reports", "reports were collected" or "collection started/stopped", and does contain "does not turn report receipt on or off" and "not that the receiver was available throughout it"; the start dialog's non-claim; the end dialog naming the separate shutdown procedure; a served D-11 exclusion showing the excluded label and no report rows; the Recruiting rule 9/10 labels. The real built route still answers 404 (no flag, no `VERCEL_ENV`). `owner-emails.spec.ts` and `email-evidence-ledgers.spec.ts` assert the repaired delivery-evidence card sentence, positively when no window is open and negatively when one is.

Local run on the isolated copy (ports 3176/56861; host load ≈5–8, much lower than during 7.3D-1): **64 passed, 0 failed** in 3.5 min. `email-evidence-arming` 12/12, `owner-emails` 34/34, `email-evidence-ledgers` 18/18. Browser acceptance still rests on exact-head CI (§4.3), which runs every spec.

### 4.3 CI

Recorded in the PR body and the handoff at the exact head.

## 5. Stale statements reconciled (dated notes; originals kept)

- [7.3D-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md): a 2026-11-20 note under the header. #184 is merged; `20261128001000` is observed applied; the record's "nothing… pushed", D-8, D-11 and collection wording are superseded here; §9 steps 2–4 have happened.
- [Readiness record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) §7: §3.4's "…or disarming stops new receipts" is wrong (disarming records a window end only), and §3.5's "the audit trail is the record of when reports were collected" means recorded windows.
- [Plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md): a header note; §8.3 rule 9/10 labels and §8.4 restated, with the superseded wording in §18.6.
- [TRACEABILITY](TRACEABILITY.md) TRACE-155 and the [handoff](../docs/agent/HANDOFF.md): dated entries.

## 6. Decisions for Codex

- **F-1** The key `not_probe` is kept (now meaning "not usable as probe evidence") instead of being renamed, so the hosted function and the deployed route stay compatible in either rollout order (§3.1). The operator wording carries the truthful meaning.
- **F-2** Defence in depth: the TypeScript verdict also refuses any non-`unlinked` receipt, and the route strips receipts on exclusion. The database remains the authority.
- **F-3** "Tagged" is checked explicitly (`tag_ledger is not null`), although every tagged class is already linked or conflicted. That keeps the rule the record states readable in the SQL.
- **F-4** Labels say "coverage window … recorded". Internal identifiers (`armed`, `coverage`, `collecting`, `claimed_outside_collection`, `data-testid="collection-state"`) are unchanged, to avoid churn in the database contract and tests. Only user-visible text and comments changed.
- **F-5** The EO-1 attestation keeps "The owner has authorized arming…", because EO-1 is named for arming.
- **F-6** SQL 125's one deliberate edit (§4).

## 7. Open and not done

- **Open:** who pushed `20261128001000` and when (§1); the Vercel deployment ID for `8a40fa4` (GitHub records the deployment as successful; not read through Vercel here); operator-session readbacks O-1..O-9; the 7.3B 503 probe and push provenance; post-deploy hash readbacks; EO-1..EO-8; every carried verification item.
- **Not done:** no hosted migration push, merge, deployment, secret or environment change, webhook registration, coverage-window recording (arming), probe enablement or email. No suppression, retry, Cron, booking or payment change. Phase 7 is not accepted.
