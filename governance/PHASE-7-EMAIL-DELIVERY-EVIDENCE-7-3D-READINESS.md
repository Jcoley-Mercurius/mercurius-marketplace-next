# Phase 7.3C release evidence and 7.3D readiness checklist (TRACE-155)

**Status: DOCUMENTATION ONLY. NOT PHASE 7 ACCEPTANCE.** This record does not authorize activation, a webhook registration, arming, real email, suppression, retries, Cron, booking or payments. The receiver stays dormant: no `RESEND_WEBHOOK_SECRET`, no registration, and `armed_at` empty.
**Authority:** the owner's follow-up instruction (2026-11-20); Codex review [5995373396](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/181#pullrequestreview-5995373396) on #181; the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §4.2, §6.3, §8.4, §11.4, §12, §13.3 and §15.1; the [7.3B](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3B.md), [7.3C-1](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1.md) and [7.3C-2](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-2.md) records.
**Branch:** `claude/phase7-3d-readiness-release-evidence`, from `main` `d44342b`.
**Earlier records are kept as written.** Each gets a dated correction that points here.

> **Corrected 2026-11-20, later (7.3D-1 review fixes):** §3.4 and §3.5 overstate what arming does. The correction is in §7, with the original text kept.
>
> **Corrected 2026-11-20 (7.3D-1, Codex review [5997315152](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/183#pullrequestreview-5997315152)):** Codex settled R3D-1..R3D-4 and corrected two checklist items. The original wording below is kept; the corrections are in §6, and 7.3D-1 is implemented locally and dormant in the [7.3D-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md). Nothing here authorizes arming, registration, real email or hosted changes.

## 1. Release evidence (read-only, observed 2026-11-20)

### 1.1 Repository and review

| Item | Observed | Source |
|---|---|---|
| `main` | `d44342b311b1c330aaeaed28d9d7d9821755ae51`, the #181 merge | `git fetch`; `git log origin/main`, 15:47 UTC |
| #181 | **Merged** 2026-11-20 15:44:35 UTC as `d44342b`; head `2eaacc02dbf1a81c50d6bfea7961befe4a1d1a41` | `gh pr view 181` |
| #181 Codex review | [5995373396](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/181#pullrequestreview-5995373396), submitted 15:46:20 UTC at `2eaacc0`: retrospective **source** review, no blocking finding. D-1..D-11 accepted, including the D-3 repair (`package-draft-email:v2:<claimed notice_id>:<attempt>`). Codex states that it did not rerun tests, read back any hosted state or deployment, or accept hosted or operator evidence | `gh api …/pulls/181/reviews/5995373396` |
| #180 | Merged 2026-11-19 23:29:16 UTC as `9e7fd39`; head `ff34e78`. Codex review [5985392153](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/180#pullrequestreview-5985392153), no blocking finding (recorded in the 7.3C-1 record's correction) | `gh pr view 180` |

### 1.2 CI

| Run | Commit | Result | Notes |
|---|---|---|---|
| [44671950207](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/44671950207) (pull_request) | `2eaacc0`, the #181 exact head | **success**: backend, lifecycle and application jobs, 04:04:37–04:42:04 UTC | The first CI run on #181 that completed. Runs on `b29ac8e`, `ca66206` and `9eadbc4` were cancelled by later pushes |
| [44766326691](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/44766326691) (push) | `d44342b` on `main` | **success**: backend, lifecycle and application jobs, 15:44:41–16:23:20 UTC (verified 16:23 UTC with `gh run view`) | Codex saw it running at review time |

### 1.3 Production deployments

**Independently read back by Claude in this session** (2026-11-20, 15:48–15:49 UTC, read-only). No earlier repository record held #180's READY evidence. The owner's instruction refers to a *reported* observation; these values are this session's own readback, not a copy of that report.

| Merge | GitHub deployment | Vercel deployment | Vercel commit field | State and times (UTC) |
|---|---|---|---|---|
| #180 → `9e7fd39` | 7928715364, Production, `success` 2026-11-19 23:29:54 | `dpl_4pSMR5HxeVZ3G6fxSyhCambJAQxB`, target production | `meta.githubCommitSha` = `9e7fd397715fb0641796d404b8de5faa2c3dec96`, ref `main` | **READY**. Created 23:29:19, ready 23:29:53, 2026-11-19 |
| #181 → `d44342b` | 7945886537, Production, `success` 2026-11-20 15:45:33 | `dpl_3cQ15yBJoXtQVYea1QVRgreGV3Br`, target production | `meta.githubCommitSha` = `d44342b311b1c330aaeaed28d9d7d9821755ae51`, ref `main` | **READY**. Created 15:44:38, ready 15:45:32, 2026-11-20 |

- **Sources:** GitHub `deployments?sha=` and `/statuses`; the Vercel connector's `get_deployment` with Git metadata (this links each deployment to its commit through Vercel's own field, not only through GitHub); `vercel inspect`.
- **Currently serving:** `vercel inspect www.mercuriusmarketplace.com` resolved to `dpl_3cQ15y…` (`d44342b`) at 15:49:05 UTC. Each deployment's alias list records assignments, not which deployment serves now, so it was not used for this.
- **Not read back:** runtime behavior and logs, function invocations, and any page or route. "READY" proves that the build deployed, not that the 7.3C features work in production.

### 1.4 Hosted database

- `supabase migration list --linked` (read-only) at 15:49:55 UTC: local and hosted match through **`20261127001000`**, with nothing remote-only and nothing local-only.
- Functions, grants, hashes and receipt counts were **not** re-read. The last readback is #181's (7.3C-2 record §5.1).

### 1.5 Hosted migration timing for `20261127001000` (no preflight reconstructed)

These facts come from the 7.3C-2 record §5.1 and `gh run list`. They are recorded as they happened.

| Time (UTC, 2026-11-20) | Event |
|---|---|
| 03:38:47 / 03:39:17 | CI starts on `b29ac8e` (runs 44669132443 push, 44669184392 pull_request) |
| **03:47:58–03:48:02** | **Migration pushed to production** on the owner's instruction, from `b29ac8e`'s `supabase/` tree. No Codex implementation review existed yet. Run 44669184392 was still running; it was later **cancelled** (03:49:44), not passed |
| 04:01:53 (commit time) | `9eadbc4`, the D-3 repair: TypeScript only. `git diff b29ac8e d44342b -- supabase/` is empty, so the pushed file equals the merged file |
| 04:42:04 | **First green CI** on #181: 44671950207 at `2eaacc0` |
| 15:44:35 | Merge (= production deploy, DEC-2026-037) |
| 15:46:20 | Codex source review |

- So **the hosted migration was applied about 54 minutes before the first green CI** and before any Codex review.
- The only checks made at the time are those in record §5.1: `migration list --linked`, the dry run (only `20261127001000` listed) and the post-push readback.
- No other preflight was run then, and **none is reconstructed now**. A retrospective record is not a contemporaneous preflight.
- The same gap is open for 7.3B (push provenance, timing and the §7 preflight script; §2 below).

## 2. Outstanding operator-session and production checks

None of these is done. Each needs the owner (an operator session, or an owner-authorized action).

| # | Check | Slice | Notes |
|---|---|---|---|
| O-1 | Operator-session `owner_email_evidence_counts()` on production, expecting zeros and `receiver_armed` false | 7.3C-1 | Needs an operator browser session; Claude has none |
| O-2 | Operator-session `application_email_evidence_counts()` and `package_draft_email_evidence_counts()`, expecting zeros and `receiver_armed` false | 7.3C-2 | As O-1 |
| O-3 | Operator view of Owner Emails, Recruiting and the price-draft panel on production, showing "Delivery evidence not available" | 7.3C-1, 7.3C-2 | A visual check of the deployed labels |
| O-4 | Post-deploy probe: `POST /api/webhooks/resend` returns **503** with no secret | 7.3B | Read-only in effect, but an outward request; not run without the owner's word |
| O-5 | Push provenance and timing for `20261124001000`, and the §7 preflight record | 7.3B | Missing. Record the gap; do not reconstruct a preflight |
| O-6 | Function, grant and hash readback after both deploys (7.3B six, 7.3C-1 ten, 7.3C-2 nine; money fingerprint `58 \| af0fae6e…`; 0 receipts; empty arming record) | 7.3B–7.3C-2 | Last done at each push, not after deploy |
| O-7 | Production smoke of the tagged senders: one owner email, one application email and one price-draft notice carry the expected tags | 7.3C-1, 7.3C-2 | **Sends real email**, so it belongs to 7.3D controlled acceptance (EO-6), not here |
| O-8 | Exact-commit READY readbacks for #180 and #181 | 7.3C-1, 7.3C-2 | **Done 2026-11-20 by Claude, read-only (§1.3).** Listed so the earlier "open" entries can be closed against it |
| O-9 | #167 review record, READY readback and renewal-window reconciliation | 7.2C-2 | Carried |

Carried and unchanged: CFG-011; A2; the retrospective 7.2B review; real-email verification for 7.2C-1 and 7.2C-2; final booking-readiness checks; `request.spec.ts:837`.

## 3. 7.3D readiness checklist

This replaces nothing in the plan. It adds the corrections from Codex review 5995373396 to the plan's gates (§11.4 activation gate, §12, §13.3 7.3D row). Where a plan sentence reads more permissively, this checklist governs until the plan is amended under review.

### 3.1 Decisions (owner)

- [ ] **EO-1..EO-8 remain PROPOSALS.** None is approved by this record, by Codex's reviews, or by any merge. Each needs separate owner approval. Arming needs EO-1, EO-2, EO-3, EO-6 and EO-7 at minimum (plan §13.3).
- [ ] EO-2 names the intervals, P-1 or P-2 (with D) and the accountable purge mechanism, and the implementation matches it (plan §11.4). The interval constant in `20261124001000` is still the proposal.

### 3.2 Arming cutoff and what counts as proof

- [ ] **Define the arming cutoff before any live send is called qualifying.** The cutoff is the `armed_at` written by the audited arm command (§3.5). It must come after the secret is deployed and the webhook registered. Only a send whose ledger `claimed_at` is at or after the cutoff can qualify as acceptance evidence. A send before it is recorded as non-qualifying, whatever arrives later.
- [ ] **A bare 2xx is not proof.** The receiver answers 200 for verified but unparseable bodies (`invalid_payload`), for unknown or unsubscribed types, for duplicates and for content conflicts (plan §6.5). So a Resend dashboard "succeeded" or a 200 in a log proves only that the request was authenticated and handled.
- [ ] **A check qualifies only when every one of these holds:**
  - one verified receipt is durably recorded;
  - it has the **expected** event type;
  - it is linked to the **expected** ledger row and attempt (identity class `tag_and_id`, or as the case defines), with trust state `trusted`;
  - it is read back through the authenticated operator functions, giving the expected summary rule;
  - the readback is dated and recorded with its commit and deployment.
- [ ] An unlinked, conflicted, `other` or `invalid_payload` receipt is recorded as a finding, never as a pass.

### 3.3 Freshness and re-signing (plan §4.2, §6.3, §12 item 3; EC-3)

- [ ] **Keep the verifier's fixed ±300 s freshness check unchanged.** Never relax, bypass or catch it to make a test pass.
- [ ] **Two different facts; record them separately:**
  - **(a) An old signed request is rejected.** Re-posting a captured request with its original headers more than 5 minutes later gets 400 `webhook_signature_invalid`. That shows the freshness check works. It says nothing about what Resend does.
  - **(b) Resend re-signs a delayed delivery.** A **provider-originated** delivery made more than 5 minutes after the event (an automatic retry, or a dashboard replay) is verified and recorded under the unchanged check. Only this proves re-signing.
- [ ] (a) never counts as (b). If (b) cannot be shown, the item stays open and arming is not accepted. The design returns to Codex (plan §12 item 3).
- [ ] Any design for producing (b) is reviewed first. For example, letting a registered endpoint answer 503 so Resend retries is a hosted action that needs owner authorization (EO-1).

### 3.4 Expiry and deletion (plan §11.4)

- [ ] **Expiry is logical exclusion, not deletion.** A receipt past `expires_at` is hidden from every readback and count, but stays in storage until a purge deletes it.
- [ ] Physical deletion needs purge execution: purge-on-receipt (at most 100 per receive call) and the operator purge `email_provider_events_purge(p_limit)`. With no traffic and no operator purge, nothing is deleted.
- [ ] **Purge duty survives rollback and disarm.** *(Corrected 2026-11-20, §6 item 2: the duty lasts while any receipt is retained, expired or not.)* Promoting an older deployment, removing the secret, deregistering the webhook or disarming stops new receipts and stops purge-on-receipt. It does not delete stored receipts. The accountable operator purge continues on the EO-2 cadence until the backlog readback shows zero retained rows, and each run leaves a dated record.
- [ ] The expiry readback (expired count, oldest `expires_at`) is part of acceptance and of every rollback record.

### 3.5 Arm and disarm audit (plan §8.4)

- [ ] Arming and disarming go through restricted, manual tooling (7.3D-1, §4) that **appends a dated audit record**: action, time, actor and reason. It is append-only.
- [ ] **Clearing `armed_at` does not erase activation history.** Today `email_evidence_config` is a single row. Rule 9 ("no report while armed") applies to an attempt claimed at or after `armed_at` (migration `20261125002000`). Clearing it would silently turn those attempts into rule 10, and re-arming later could not represent the gap. The audit trail is the record of when reports were collected.
- [ ] **Define historical coverage labels before the first arming**, for at least:
  - sent before reports were ever collected;
  - sent while collected, with the receiver still armed through the retry horizon (about 32 h; *corrected 2026-11-20, §6 item 3: 27 h 35 min 5 s documented, 28 h used*);
  - sent while collected, but disarmed before the retry horizon ended (partial coverage);
  - sent during a disarmed gap.
  The wording follows MDS and Codex review. No label may claim more coverage than the audit trail proves.
- [ ] Rollback and disarm records state what stays stored (receipts until purged) and which attempts each coverage label applies to.

### 3.6 Provider fixtures (plan §4.1, §4.2, §12 item 1)

- [ ] **For each EO-3 event, record which fixture produces it**, with its source, before the controlled run. Then confirm by observation. Do not assume the test addresses cover every event.

  | Event | Candidate fixture | Status |
  |---|---|---|
  | `email.sent`, `email.delivered` | `delivered@resend.dev`; the controlled mailbox | Documented for `delivered@`; observe |
  | `email.bounced` | `bounced@resend.dev` | Documented; exact `bounce.type` strings unverified |
  | `email.complained` | `complained@resend.dev` | Documented; observe |
  | `email.suppressed` | `suppressed@resend.dev` | Documented as a test address. **Which event it produces, and with what payload, is unverified** |
  | `email.failed` | None identified | **No known fixture.** Stays "not proven" unless one is found and verified |
  | `email.delivery_delayed` | None identified | **No known fixture.** As above |

- [ ] An event with no verified fixture is listed as unproven in the acceptance record. It is not inferred from another event's pass.
- [ ] Payload shapes for `suppressed`, `failed` and `delivery_delayed` are proven from observed receipts or stay unknown (7.3B §8).

### 3.7 Remaining plan gates (unchanged)

- [ ] Both 7.3C slices deployed: **met** (§1.3). The operator readbacks O-1..O-3 are still open.
- [ ] 7.3B operational items: O-4, O-5, the real `svix-id` and email-ID shapes, bounce strings, and the rotation rehearsal (plan §6.4).
- [ ] Domain status readback (read-only) and controlled-mailbox headers showing DKIM, SPF and DMARC passing (plan §12 item 5).
- [ ] Controlled-mailbox human check, the only proof of inbox arrival (plan §12 item 2).
- [ ] No suppression, automatic retry, Cron or resend transition (7.3E, 7.3F and 7.6 stay separate).

## 4. Next bounded implementation: 7.3D-1 (proposal for Codex)

**7.3D-1: restricted manual arm/disarm tooling and a controlled test harness.** Local and dormant. It adds the tooling that §3.2 and §3.5 require, and proves it locally with synthetic data. It performs **no** hosted action.

### 4.1 Scope

- **Arming audit.** One additive migration:
  - an append-only arming-event table (action, time, actor, reason), with an immutability guard and no client grants;
  - restricted arm and disarm functions. Each appends an event and sets or clears `email_evidence_config.armed_at` in the same transaction. Arming while armed, or disarming while disarmed, is refused;
  - a readback of the arming history.
- **Coverage labels.** Defined from the history (§3.5). Whether rule 9 stays on the single `armed_at` or moves to intervals is decision R3D-2.
- **Controlled test harness.** Sends one email per invocation to a **fixed, source-coded allowlist**: the four `resend.dev` test addresses and the controlled mailbox, read from an environment name. Fixed synthetic content; one idempotency key per probe. After sending, it reads back the expected receipt as §3.2 requires and reports *qualifying* or *not qualifying*, with the reason.
- **Tooling for §3.3 (a).** A local script that re-posts a captured signed request after more than 5 minutes and expects 400. It is labeled as evidence for (a) only.
- Tests, the 7.3D-1 record, and amendments to the plan and the [7.3B record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3B.md).

### 4.2 Out of scope

- **A public or arbitrary-recipient sending endpoint.** The recipient is never caller-supplied.
- Automatic retry: one invocation makes at most one provider request, and a failure is reported, not retried.
- Any hosted push, secret, webhook registration, arming, real send or DNS change.
- Suppression, Cron, booking, payments and profile work.

### 4.3 Local synthetic acceptance criteria

Local stack only, with a locally generated webhook secret, synthetic signed payloads and the Resend client stubbed. No network send.

1. **Restricted:** anon, authenticated non-operators and (unless R3D-1 says otherwise) the service role cannot arm, disarm or read the history. There is no new public route (a route-inventory test).
2. **Audited:** each arm and disarm appends exactly one event in the same transaction as the `armed_at` change. Update and delete of events are refused. Concurrent arm calls give one success and one refusal.
3. **History survives disarm:** after arm → disarm → arm, every event is still readable, and each test attempt gets the coverage label §3.5 defines for its claim time (before, inside, partial and gap cases).
4. **Cutoff:** a synthetic attempt claimed before `armed_at` is reported non-qualifying, even with a matching trusted receipt.
5. *(Corrected 2026-11-20, §6 item 1.)* **2xx is not a pass:** for each 200 path in plan §6.5 (`invalid_payload`, `other`, duplicate, content conflict), and for an unlinked or conflicted receipt, the harness reports *not qualifying*. Only an expected, trusted, linked receipt read back through the operator functions passes.
6. **Recipients:** a recipient outside the allowlist is impossible to express (type-level) and refused at run time. No input reaches the provider's `to` field.
7. **No retry:** a stubbed provider failure (error, 409, timeout) gives one request and a reported failure. Nothing is queued or retried.
8. **Freshness unchanged:** the verifier's 300 s constant and handling are byte-identical. The §3.3 (a) script gets 400 and is labeled (a) only.
9. **Expiry:** a disarm does not delete receipts. The operator purge still works afterwards, and the backlog readback reports the remainder.
10. **Unchanged:** every existing function hash not deliberately restated (7.3B six, 7.3C-1 ten, 7.3C-2 nine, ledgers), and the money fingerprint `58 | af0fae6e…`. Any deliberate restatement (R3D-2) is listed with old and new hashes.
11. SQL, unit and concurrency tests; lint, typecheck, secret scan and build pass; exact-head CI green.

### 4.4 Decisions for Codex before implementation

- **R3D-1, who may arm.** Proposal: operator-guarded SQL functions, as with `email_provider_events_purge`, with the actor taken from the session. No UI control in 7.3D-1; invoked deliberately by the owner. Alternative: service-role only, with the actor passed in.
- **R3D-2, coverage model.** (a) Restate the rule 9 check to use armed intervals from the history; this changes the 7.3C-1 summary hash deliberately. (b) Keep the single `armed_at` and give the history only to the labels. Proposal: (a), because (b) cannot represent a disarmed gap.
- **R3D-3, linking `resend.dev` probes.** Owner-email recipients are fixed owner contacts, so a ledger send cannot reach `bounced@resend.dev` without a new path. Options:
  - (a) a separate probe ledger with its own receipt link, a larger schema change;
  - (b) probes read back as **unlinked** receipts by provider email ID, with ledger-linked rules proven only through the controlled-mailbox sends of plan §12 item 2.
  The plan's §12 item 1 rule expectations assume (a).
- **R3D-4, where the harness runs.** (a) An operator-guarded server action with an enumerated recipient choice, behind an environment flag that is off by default. (b) A local CLI, which would need the production Resend key on a workstation. Proposal: (a).

## 5. Validation of this record

- Read-only commands only: `git fetch` and `log`; `gh pr view`, `gh api` (reviews, deployments, statuses) and `gh run view`/`list`; `vercel inspect`; the Vercel connector's `get_deployment`; `supabase migration list --linked`.
- No hosted write, deploy, secret, registration, arming, email or test rerun.
- Documentation checks: see the PR body.

## 6. Corrections (2026-11-20, 7.3D-1)

Codex review 5997315152 at `89e01fe` cleared §4 for local, dormant implementation and chose: R3D-1 operator-guarded SQL commands with the session actor; R3D-2 audited intervals; R3D-3 option (b), no fourth receipt-link ledger; R3D-4 option (a), a restricted server-side action, off by default. The [7.3D-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md) §3 shows how each is implemented. Corrections to the text above, which is kept as written:

1. **§4.3 criterion 5.** A duplicate HTTP response is not new proof, but an expected, trusted receipt **already stored** is still valid readback evidence. A check judges the expected run or attempt and its receipt identity from durable, operator-read state, never a response status alone. So: for each 200 path, nothing new qualifies; an earlier expected trusted receipt keeps qualifying (7.3D-1 SQL 125 §8, `qualifyLedgerAttempt`).
2. **§3.4 purge duty.** After disarm or rollback, purge duty continues while **any** receipt is retained, including unexpired ones. Zero expired backlog today does not mean every retained row has been deleted. Each rollback or disarm record states the total retained and expired counts, without content (`email_evidence_arming_readback().retention`).
3. **§3.5 retry horizon.** "About 32 h" was not verified. The official page (fetched 2026-11-20) gives waits of 5 s, 5 min, 30 min, 2 h, 5 h, 10 h and 10 h after an immediate attempt: 27 h 35 min 5 s. 7.3D-1 uses 28 h. It covers retries of an event raised at send time, not an event Resend raises later.
4. **§3.6 and plan §12 item 1.** `resend.dev` probes are untagged, so their receipts are unlinked transport evidence. They are never credited with rules 1, 4 or 5 or any ledger rule. Ledger linking and readback are proven separately by controlled-mailbox sends through the real ledger paths (plan §18.5).
5. **§3.5 coverage labels** are defined: `before_first_arm`, `collecting`, `complete`, `partial`, `gap` and `unknown` (7.3D-1 record §3).

EO-1..EO-8 remain proposals. Phase 7 and booking readiness remain unaccepted.

## 7. Corrections (2026-11-20, 7.3D-1 review fixes)

Under the owner's review-fix instruction (Codex's review of #184), recorded in the [review-fix record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1-REVIEW-FIXES.md). The text above is kept as written:

1. **§3.4, "Promoting an older deployment, removing the secret, deregistering the webhook or disarming stops new receipts."** *(Corrected again 2026-11-21, before merge; the 2026-11-20 wording of this item is kept in the [review-fix record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1-REVIEW-FIXES.md) §8.)* The sentence is wrong in two places, disarming and promotion. The receiver stores a verified report whenever a secret is deployed and the endpoint is registered; it never reads the arming record.
   - **A disarm** records the end of a coverage window and stops nothing.
   - **Promoting an earlier deployment** is an application rollback. It does not inherently stop ingestion: it changes neither the Resend registration nor the Production variables, and every deployment since 7.3B contains the receiver.
   - **Disabling receipt** is the shutdown procedure in review fixes §2.5. It takes two hosted actions, each separately authorized: (a) disable or delete the Resend endpoint; then (b) remove **both** `RESEND_WEBHOOK_SECRET` and `RESEND_WEBHOOK_SECRET_PREVIOUS` from Production and create a new Production deployment. Then read back a 503 and the retention counts.
   - **Purge duty** continues while any receipt remains, expired or not. Once receipt stops, purge-on-receipt stops too, so the operator purge carries the whole duty.
2. **§3.5, "The audit trail is the record of when reports were collected."** The audit trail records the **coverage windows** operators declared. A window labels emails; it does not show the receiver was available. Coverage labels say a window was recorded, never that reports were collected (review fixes §2.3). The 28 h horizon is how long a window must stay open under Resend's retry schedule, not proof of uninterrupted collection.
3. **§3.2 / plan §12 item 1, probes.** A provider ID with any current linked, tagged or conflicted receipt is excluded as a whole from probe evidence; expired receipts are ignored (review fixes §2.1–§2.2).

EO-1..EO-8 remain proposals. Nothing here authorizes arming, registration, probe enablement or email.
