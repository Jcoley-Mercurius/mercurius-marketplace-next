# Phase 7.3D controlled activation checklist (TRACE-155)

**Status: DOCUMENTATION ONLY. NOT AN AUTHORIZATION. NOT PHASE 7 ACCEPTANCE.** This record orders the controlled 7.3D activation and lists what must be decided first. It authorizes no hosted action: no secret, webhook registration, endpoint enablement or disablement, coverage-window start, probe enablement, email, synthetic record, replay, purge, suppression, retry, Cron, booking or payment. It is not a feature slice and adds no code.
**Authority:** the owner's 2026-11-21 instructions; the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §6.4, §8.4, §11.4, §12 and §15.1; the [readiness record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) §2–§3 with its corrections in §6–§7; the [7.3D-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md); the [7.3D-1 review fixes](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1-REVIEW-FIXES.md), whose §2.5 is the shutdown procedure; Codex's review of #186 (findings R-1..R-5, resolved in §6).
**Base:** `main` `96c8149dfe4ba80484ad3e65efffb2ab39011fee` (the #185 merge). Branch `claude/phase7-3d-activation-checklist`; PR #186 retargeted to `main` on 2026-11-21. Where this record and the plan differ, the readiness corrections and this record govern until the plan is amended under review. One conflict with the plan is recorded, not resolved (§6, PG-3).

## 1. State at revision (read-only, 2026-11-21)

| Item | Observed |
|---|---|
| `main` | `96c8149dfe4ba80484ad3e65efffb2ab39011fee`. #185 merged 13:16:28 UTC |
| Main CI | Run 44908032730 (push, `main`, `96c8149`): **success** |
| Production | `dpl_EL8f5rwKCkqD69kyGNXZXEUQvU3N` READY, target production, `meta.githubCommitSha` `96c8149…`, ref `main`. `vercel inspect www.mercuriusmarketplace.com` resolves to it |
| Hosted migrations | Last read 2026-11-21 before the merge: local = remote through `20261129001000`. Not re-read for this revision (step 2 re-reads) |
| Hosted readback | Last read 13:16:54 UTC (one privileged read-only `supabase db query --linked`, no row content): probe readback md5 `bd5da284bbd54764df0986ac1153e529`; execute `authenticated` yes, `anon` no; **0** arming events; **0** rows with `armed_at`; **0** receipts. Not re-read for this revision |
| Receiver | Dormant by design: no `RESEND_WEBHOOK_SECRET`, no registration (per the records; Production variables were not listed in this session) |
| Probe harness | Off: no `EMAIL_EVIDENCE_PROBES_ENABLED`; the route opens only in `VERCEL_ENV=production` |

## 2. Owner decisions, presented together

None is approved by this record, by Codex's reviews or by any merge. Arming needs **EO-1, EO-2, EO-3, EO-6 and EO-7** (plan §13.3). Codex's recommendations are carried below as **PROPOSALS**. They become decisions only when the owner records them.

### EO-2: retention, deletion deadline, weekly operator purge (PROPOSAL)

- **Implemented now** (`20261124001000`): expiry is set once, at receipt. Linked receipts get **90 days**; unlinked, `other` and `invalid_payload` receipts get **30 days**. Logical exclusion takes effect at `expires_at`. Physical deletion happens by purge-on-receipt (at most 100 per call) and by the operator purge `email_provider_events_purge(p_limit)` (1–1,000 per call, operator-guarded, executable by `authenticated` only).
- **Proposal:**
  - Intervals **90 / 30 days** as implemented (other values need a forward migration).
  - Deletion policy **P-2** with a maximum deletion lag of **D = 14 days**: no receipt may remain more than 14 days past its `expires_at`.
  - A **weekly manual operator purge** (H-9). No `pg_cron` job; a scheduler would be a separate approval.
  - **Accountable: Josh (owner), Monday mornings ET** (complete by 12:00 ET). The first run is the first Monday after H-4.
  - **Run procedure:** in the operator session, call `email_provider_events_purge(1000)` until a call deletes fewer than 1,000 rows, at most 10 calls (10,000 rows) per run. Then read `/admin/email-evidence`.
  - **Run record** (no content): date and time ET; calls made; rows deleted; expired remaining, or "over 10,000"; oldest `expires_at` among the expired rows that remain; total retained.
  - **Capacity, documented:** 10,000 rows per weekly run, plus purge-on-receipt. Expected inflow is unknown before H-4. After the first full week, record that week's receipt count (privileged count only) and the margin, 10,000 minus the weekly receipt count. If the weekly receipt count exceeds 5,000, that is a finding for Codex (capacity or scheduler change).
  - **Missed-run escalation:** weekly runs leave 7 days of slack under D = 14. A run not completed by Monday 23:59 ET is a missed run. Record it and complete it by Wednesday 12:00 ET. A second consecutive miss, or any expired row older than `expires_at` + 14 days at any readback, is a finding. The owner records it the same day and chooses catch-up runs or the shutdown procedure (§3 step 31). There is no backup operator under DEC-2026-025, so an absence longer than 7 days must be decided in advance: shutdown, or a named backup by separate decision.
- The duty lasts **while any receipt remains, expired or not**, including after a coverage-window end, an application rollback or a shutdown (review fixes §2.5).
- **Provisioning gap PG-2: no app control runs the purge.** `/admin/email-evidence` shows purge duty and the last run but has no purge action. A privileged `supabase db query` cannot run it either, because the operator guard refuses a caller with no session, and it must not be used to bypass that guard. The EO-2 approval must name the method: (i) a reviewed operator purge control (a separate code slice), or (ii) a documented way to call the function from the operator's signed-in session. Until one is approved, H-9 and step 30 cannot run. The first expiry falls 30 days after the first receipt.

### EO-3: subscribed events (PROPOSAL)

- Exactly the seven operational types: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`.
- **Excluded:** `email.opened`, `email.clicked`, and every other type Resend offers.
- A type outside the list is stored as `other` and counted, never interpreted. Under this subscription an `other` receipt should never occur; if one does, the run stops (§3).

### EO-7: minimal unmatched receipts (PROPOSAL)

- Keep minimal, address-free receipts for mail without a Mercurius ledger link (Auth SMTP, legacy paths, probes). They are held **30 days** and never linked or rematched.
- The alternative, dropping them, would need a code change before arming, because the receiver stores them today.

### EO-1: specific hosted actions

- **Form of approval.** Each action must be named by its number in a dated, written owner approval. One written response may approve several actions if it names each one, for example "approve H-1, H-2 and H-3". An action not named is not approved. An approval covers one execution as described here; a repeat needs a new approval.
- **Deployments.** The deployments listed are production releases outside the merge flow. Under AGENTS.md they need the owner's instruction, and naming the action gives it for those deployments only.
- **Secret values** are never printed, logged, committed or pasted into chat. Readbacks list variable names only.

| # | Hosted action | Where | New Production deployments | Reverse action |
|---|---|---|---|---|
| H-1 | Read-only readbacks: domain (domain, status, region), webhook list (count, URL, status), and a dated public DNS lookup | Resend; public DNS | 0 | n/a |
| H-2 | `POST /api/webhooks/resend` with no signature, expecting **503** (O-4). Repeated after any removal of the secret | Production | 0 | n/a |
| H-3 | **Create** the endpoint `https://www.mercuriusmarketplace.com/api/webhooks/resend` for the EO-3 events. Created enabled unless Resend then offers a disabled-at-creation option (PG-1) | Resend | 0 | H-3d, or delete |
| H-3d | **Disable** the endpoint. Used in the shutdown procedure, or during provisioning only if the owner chooses to (not recommended, PG-1) | Resend | 0 | H-3e |
| H-3e | **Enable** the endpoint. Needed only after an H-3d | Resend | 0 | H-3d |
| H-4 | Set `RESEND_WEBHOOK_SECRET` (the endpoint's signing secret) in Vercel **Production only**, with `RESEND_WEBHOOK_SECRET_PREVIOUS` unset; deploy | Vercel | 1 | Shutdown procedure |
| H-5 | Record the **coverage-window start** (arm) with the EO-1 attestation on `/admin/email-evidence` | Production, operator session | 0 | Record the window end (labels only) |
| H-6 | Set `EMAIL_EVIDENCE_PROBES_ENABLED=true` in Production and deploy; later remove it and deploy | Vercel | 2 | Remove and deploy |
| H-7 | One Resend dashboard **replay** of one event of an approved probe (T-1..T-4), created more than 5 minutes earlier: fact (b) | Resend | 0 | n/a |
| H-8 | Secret **rotation rehearsal**, sub-steps H-8a..H-8e (§3 G), each named separately: H-8a rotate; H-8b both slots; H-8c previous-slot drill; H-8d remove the previous slot; H-8e one replay after removal. H-8a, H-8b, H-8c and H-8e each include one approved-probe replay | Resend, Vercel | H-8b 1, H-8c 2, H-8d 1 | Plan §6.4; shutdown procedure |
| H-9 | Weekly operator purge runs under EO-2 (needs PG-2 resolved) | Production, operator session | 0 | n/a |
| H-10 | **Automatic-retry re-signing test:** remove the secret and deploy; send T-1 once; restore the same secret and deploy, within 15 minutes (§3 step 11) | Vercel; probe route | 2 | Restore the secret (part of the action) |
| H-11 | One **stale unsigned request**: `POST` with a `svix-timestamp` 10 minutes old, a well-formed arbitrary signature and a placeholder body, expecting 400 and nothing stored: fact (a-2) | Production | 0 | n/a |

### EO-6: exact test sends and the controlled mailbox (PROPOSAL: T-1..T-6; T-7 deferred)

- **Controlled mailbox:** the owner's own mailbox, the Production owner-notification recipient. It is the only address a human checks, and its address is not repeated here.
- Each send is made **once**, after H-5, and must have its ledger `claimed_at` at or after the window start. The probe harness keys each probe per address per UTC day and never retries, so a repeated invocation on the same day replays the first response instead of sending.

| # | Send | Path | Recipient | Evidence it can give |
|---|---|---|---|---|
| T-1 | Probe `delivered`, sent inside H-10 if H-10 is approved | `POST /api/admin/email-evidence-probe` | `delivered@resend.dev` | Transport only (unlinked); with H-10, fact (c) |
| T-2 | Probe `bounced` | as T-1 | `bounced@resend.dev` | Transport; the observed `bounce.type` strings |
| T-3 | Probe `complained` | as T-1 | `complained@resend.dev` | Transport |
| T-4 | Probe `suppressed`, **observational** | as T-1 | `suppressed@resend.dev` | What Resend does for this address. The expected behaviour is not established (§3 step 13) |
| T-5 | One synthetic contact submission (record below) | Real contact form, 7.2C-1 owner-email ledger | Controlled mailbox | Ledger-linked, rule 4; human inbox check; headers |
| T-6 | One synthetic provider renewal (record below), **conditional** | Real renewal path, 7.2C-2 ledger | Controlled mailbox | As T-5 |
| T-7 | *Deferred.* Application email and price-draft notice | 7.3C-2 tagged senders | n/a | Not in this activation |

**T-5 proposed record.** Nothing is created by this record.

- **Path:** the public `/contact` form in Production (`POST /api/contact-submissions`), from an ordinary browser session, not signed in.
- **Fields:** first name `Synthetic`; last name `Test 7.3D-T5`; email: a plus-address on the controlled mailbox with tag `+e73d-t5`, not written in this repository; phone empty; subject `SYNTHETIC 7.3D T-5`; message `SYNTHETIC 7.3D T-5 delivery-evidence test. No reply or action needed.`
- **Rows it creates:** one `contact_submissions` row; its owner-email ledger row and events (trigger); the receipts that link to it; one email to the Production owner-notification recipient. No customer data, and no vendor touched.
- **Cleanup, proposed** (a separately authorized production data change, only after the acceptance record is written): delete that one submission by ID. Its ledger row, ledger events and linked receipts cascade with it (`on delete cascade`), so the readbacks must be recorded first. The alternative is to keep it, identified as synthetic, under existing contact-submission handling.

**T-6 proposed record.** Conditional; nothing is created by this record.

- **Path:** a provider renewal upload and submit (`/api/renewal-documents/submit`), signed in as the provider account bound to the synthetic contractor. Only `submitted_as = 'provider'` creates the ledger row (trigger condition). An operator upload creates none and cannot stand in.
- **Proposed contractor:** `R0 Access Test Provider` (`65cce2d9…`) and its bound provider account, the `+r0access2` plus-address ([R0 record](R0-RELEASE-CANDIDATE.md)).
- **Document:** kind `insurance`; one single-page PDF named `synthetic-7-3d-t6.pdf` reading "SYNTHETIC TEST DOCUMENT. Mercurius 7.3D T-6. Not a certificate of insurance."
- **Effect:** a submission is "a file only: no evidence, status, revision, role or listing" (`vendor_submit_renewal_document`). No real vendor's compliance or eligibility changes, and neither does the synthetic contractor's.
- **Preconditions,** each checked by a privileged read-only readback at approval time. None is verified now.
  1. The contractor and its bound account exist, and the account holds the vendor role.
  2. Its onboarding status is **`suspended`**. `vendor_renewal_submitter` accepts provider submissions only for `active` or `suspended` providers.
  3. It is on the public-listing exclusion list.
  4. It has no open `insurance` renewal document at the open limit.
- **Expected blocker:** the R0 record last showed this contractor "inactive and not onboarded", and `suspended` is reachable only from `active`. If precondition 2 fails, **T-6 is blocked**: it is recorded as not run and ledger-linked renewal evidence stays unproven. Making a synthetic provider active, even briefly, could make it eligible under the launch configuration. That is not proposed here and would need its own owner decision and Codex review.
- **Cleanup, proposed:** record **no** review decision. A decision would change the synthetic contractor's evidence, and whether it sends email is unverified. The document stays in Compliance Expiry, identified as synthetic, until a separately authorized cleanup. It cannot simply be deleted: the owner-email ledger references it without cascade, and the renewal retention rules govern its file. The cleanup method goes to Codex.

`email.failed` and `email.delivery_delayed` have **no known fixture**. They stay "not proven" (§3 step 13).

### Unresolved and not approved: EO-4, EO-5, EO-8

- **EO-4** (whether a bounce or complaint changes later sends), **EO-5** (who removes suppression-list entries) and **EO-8** (all current email is transactional or operational) stay **open**.
- No suppression, automatic retry or send-blocking is enabled in 7.3D, whatever these say.
- They are recorded as unresolved in the acceptance record unless the owner records an explicit approval.

## 3. Activation sequence

Steps run in order. Each step names the authorization it needs and the evidence it must leave.

- **Stop:** halt the sequence. Record the finding, take no further activation step, and return to Codex. The owner then chooses between holding the current state and the shutdown procedure (step 31).
- **Finding:** record it. The affected item cannot be accepted; the sequence may continue.
- **Unproven:** record what was observed. Acceptance lists the item as not proven. It is not a finding.

Evidence markers (§4): **[P]** privileged read; **[O]** operator session; **[L]** Vercel operational-log readback; **[R]** Resend attempt metadata (status codes, times and counts only, never payloads or recipients); **[I]** human inbox check.

### A. Release and read-only baseline (before any hosted action)

1. **#185 released: done.** Merged 2026-11-21; main CI 44908032730 green; Production `dpl_EL8f5rwKCkqD69kyGNXZXEUQvU3N` READY on `96c8149` through `meta.githubCommitSha`; `www.mercuriusmarketplace.com` resolves to it (§1). At run time, if `main` or Production has moved, repeat these readbacks for the new head.
2. **[P] Privileged read-only readback** (Claude, `supabase db query --linked`):
   - the probe readback `bd5da284…`;
   - the other eight 7.3D-1 functions `8 | 8fbc18c0…`, and the summary `8eadddd6…`;
   - the 7.3B six, 7.3C-1 ten and 7.3C-2 nine hashes, and money `58 | af0fae6e…`;
   - grants;
   - 0 arming events, no `armed_at`, 0 receipts (O-6).
3. **[O] Operator-session checks** (owner, signed in, O-1..O-3):
   - the counts functions return zeros with `receiver_armed` false;
   - Owner Emails, Recruiting and price drafts show the delivery-evidence card;
   - `/admin/email-evidence` shows "No coverage window has ever been recorded".

   This is operator evidence, not a privileged read. Record it separately from step 2.
4. H-1 (domain status, webhook list showing no Mercurius endpoint, DNS) and H-2 (503).
5. **EO-1 (naming each action), EO-2 (naming the PG-2 method), EO-3, EO-6 and EO-7 approved and recorded.** If not: stop.

### B. Receipt enabled (no coverage window yet)

6. **H-3: create the endpoint** for the EO-3 events. Record the UTC creation time, the endpoint ID and the status Resend shows.
   - **PG-1:** the API's create call takes no status, and whether the dashboard can create an endpoint disabled is unverified. If it can, record that, and enable it with H-3e after step 7.
   - **Gap G-1, expected:** from creation until H-4's deployment is READY, Resend delivers to a receiver with no secret, which answers 503. Record G-1's start and end and **[R]** the number of attempts answered non-2xx in G-1.
   - Holding the endpoint disabled through G-1 (H-3d, then H-3e) is **not recommended**. What Resend does with events raised while an endpoint is disabled is unverified; they may be dropped rather than queued. If the owner chooses it, record that, and claim nothing about those events.
7. **H-4:** deploy the current secret only. Read back the variable names (no values), the deployment's READY state, and the endpoint status `enabled`.
8. **Readback.** Receipts may now arrive from ordinary production mail. Their attempts were claimed before any window, so their coverage is `before_first_arm`, and they never qualify.
   - **[P]** counts by event type, processing state and `secret_slot` (all `current` expected).
   - **Stop:** a provider-originated delivery refused with 400 `webhook_signature_invalid` (**[L]** the code, **[R]** the 400 on the same attempt).
   - **Stop:** any `invalid_payload` receipt (the normaliser cannot read a real payload) or any `other` receipt (a type outside EO-3 should never arrive).
   - **Observation only:** whether G-1's events were later delivered by automatic retry and stored (**[P]** count of receipts with `received_at − provider_created_at` > 300 s). This is uncontrolled ordinary mail. It never closes fact (c).

### C. Coverage window start (the cutoff)

9. **H-5:** record the window start with a reason, giving the EO-1 attestation. The `armed_at` written here is the **cutoff**. A send claimed before it never qualifies, whatever arrives later (readiness §3.2).

### D. Transport probes and the automatic-retry test (unlinked; never ledger evidence)

10. **H-6:** enable probes (deployment 1 of 2).
11. **H-10, fact (c), automatic-retry re-signing** (if approved; otherwise send T-1 normally and see step 21):
    1. Remove `RESEND_WEBHOOK_SECRET` from Production (the previous slot is unset) and deploy, keeping the probe flag. H-2 must answer 503.
    2. Send **T-1** once. **[R]** Its events' first attempts are answered 503.
    3. Restore the same secret value and deploy. Step 1's deployment READY to step 3's deployment READY must take **at most 15 minutes**. If it takes longer: stop, but still complete step 3, because restoring receipt is the reverse action.
    4. Wait for Resend's automatic retries (5 s, 5 min, 30 min, 2 h, …).
    - **Pass** needs one T-1 event with all three:
      - **[R]** at least one attempt answered 503, followed by an **automatic** attempt (not a manual replay) answered 200 at least 5 minutes after the event's creation;
      - **[P]** that receipt's `received_at − provider_created_at` > 300 s, with `secret_slot = 'current'`;
      - the probe readback shows it unlinked and not excluded.
    - **Stop:** the automatic retry is refused with 400 `webhook_signature_invalid`. Automatic retries are then not re-signed, and the design returns to Codex (plan §12 item 3). The ±300 s check is never relaxed.
    - **Stop:** no automatic attempt reaches the receiver within 3 hours of the send. Fact (c) cannot be shown.
    - **Record the side effect:** ordinary production mail events raised in the window are answered 503 and fall to Resend's retry schedule. **[R]** the count of 503 attempts in the window; **[P]** how many were later stored.
12. Send **T-2, T-3 and T-4**, once each.
13. **Read back each probe** through `email_evidence_probe_readback` at +10 and +60 minutes.
    - **T-1..T-3:** a probe **passes** only when its expected event arrives as an **unlinked** receipt and the ID is not excluded. A missing or unexpected event at +60 minutes is a **finding**, never a pass. A probe is never credited with rules 1, 4, 5 or any ledger rule.
    - **T-4 is observational.** It neither passes nor fails, because Resend's behaviour for `suppressed@resend.dev` is not established. Record the send result (provider ID, or the refusal code with no retry), every event type, and any bounce strings.
    - **Stop, for any probe including T-4:**
      - a provider-originated delivery refused with 400 `webhook_signature_invalid`;
      - `not_probe = true` for a probe ID (a probe linked, tagged or conflicted);
      - any `invalid_payload` or `other` receipt;
      - a receiver 5xx on a provider delivery outside H-10's window;
      - a probe sent to any other address, or sent more than once.
    - **Unproven, documented without stopping:**
      - T-4 sent but no event arrives by +60 minutes;
      - T-4's events do not include `email.suppressed` (for example only `email.sent`, `email.bounced` or `email.failed`). The observed types are recorded as provider behaviour, and `email.suppressed` stays unproven;
      - the T-4 send is refused by the API;
      - T-2's bounce strings differ from the 7.3B assumptions (also a carried 7.3B item).
    - **`email.failed` and `email.delivery_delayed`** stay unproven unless suitable evidence arrives: a trusted receipt of that type **for an approved send**, read back through the probe readback or the operator functions. Such types seen only in **[P]** aggregate counts from ordinary mail are observations, never proof. Neither is ever inferred from another event.
14. Remove the probe flag and deploy (H-6, deployment 2 of 2). Confirm the route answers 404.

### E. Ledger-linked controlled sends (trusted evidence)

15. Send **T-5**, and **T-6** only if its preconditions held at approval time, through the real paths, after the cutoff. If T-6 is blocked, record it as not run.
16. **Provider delivery [O]:** each ledger attempt is `sent`, with a **trusted** `email.delivered` receipt with identity `tag_and_id`, read back through the operator functions as rule 4. A bare 2xx, a dashboard "succeeded" or a log line is not proof.
17. **Human inbox confirmation [I], recorded separately:** the owner sees each email in the controlled mailbox, and its headers show DKIM, SPF and DMARC passing. A provider `delivered` event never stands in for this, and this never stands in for the receipt.

### F. Freshness and re-signing (three separate facts)

Each fact proves something different, and none stands in for another. The ±300 s check stays unchanged throughout.

18. **(a) Stale-request rejection.**
    - **(a-1) automated:** unit tests S-15 and S-15a (`tests/unit/resend-webhook.test.ts`) run the real verifier. A validly signed request 400 s old is refused, and a timestamp failure is final, so the previous secret is never tried.
    - **(a-2) production, H-11:** one stale request with an arbitrary signature. Expect 400 `invalid_signature`, **[L]** `email_webhook.refused` with `webhook_signature_invalid`, and an unchanged **[P]** receipt count.
    - (a-2) shows only that the deployed receiver refuses a stale request and stores nothing. The HTTP answer cannot show the cause; that the timestamp is checked first comes from (a-1).
    - A validly signed stale production request is **not proposed**: producing one would take the signing secret outside Vercel.
19. **(b) Provider dashboard replay, H-7.** Replay one event of an approved probe created more than 5 minutes earlier.
    - **Pass:** **[R]** the replay answered 200, and **[L]** `email_webhook.duplicate`. The svix-id is unchanged, so the first receipt is kept unchanged and nothing new is stored. If the replay instead carries a new svix-id and is stored, record that from **[P]**.
    - **Proves:** a manual replay is signed when it is delivered.
    - **Does not prove** that automatic retries are re-signed. A manual replay schedules no automatic retries (as the Resend connector states it).
    - **Stop:** the replay is refused with 400.
20. **(c) Delayed automatic-retry re-signing** is closed **only** by step 11 (H-10).
21. **If H-10 is not approved, or step 11 cannot show it, fact (c) is BLOCKED.** 7.3D acceptance cannot be recorded and plan §12 item 3 returns to Codex. Fact (c) is never inferred from (a), (b) or the G-1 observations.

### G. Rotation rehearsal (both slots, approved traffic only)

- **Approved traffic only.** Every step uses replays of events from the approved probes T-1..T-4 (`resend.dev` recipients, no customer data). No step sends email, and no ordinary-mail event is ever replayed.
- **A replay never records a slot.** It reuses the svix-id, so the first receipt and its slot are kept. Slot evidence therefore comes from the deployed configuration plus **[R]** 200 and **[L]** `email_webhook.duplicate`.
- **[P] Slot counts are a privileged read**, counts only:
  `select secret_slot, count(*) from private.email_provider_events where received_at >= $from and received_at < $to group by 1`.
  No operator function, page or log line exposes `secret_slot`; plan §6.4 deliberately keeps it off logs. The operator session cannot produce slot counts (PG-3).
- **Resend behaviour assumed but unverified.** The Resend connector states that after a rotation both secrets sign every payload for 24 hours. Steps 23–25 test this.

22. **Before rotation:** **[P]** slot counts for [H-4 READY, now): `previous` = 0. Variable names: `RESEND_WEBHOOK_SECRET` only.
23. **H-8a:** rotate in Resend; the old secret is A, the new secret is B. Record the UTC time. Then one approved replay, still with current = A:
    - **[R]** 200 is expected if both secrets sign.
    - A 400 is a **finding**: dual signing was not observed. Go to step 24 at once; deliveries refused until then fall to Resend's retry schedule (**[R]** count). Step 25 is then not run, and the previous slot is **unproven**.
24. **H-8b:** set current = B and previous = A in Production; deploy. One approved replay: **[R]** 200, **[L]** duplicate. **[P]** receipts since this deployment: `current` only is expected, because the current slot is tried first and B signs every payload.
25. **H-8c, previous-slot drill** (within 24 hours of H-8a, while A still signs):
    1. Set current = X and keep previous = A, where X is a fresh `whsec_` value generated for the drill, never registered with Resend and discarded afterwards. Deploy.
    2. Make one approved replay. **Pass:** **[R]** 200 and **[L]** `email_webhook.duplicate`. With X in the current slot, only A in the previous slot can have verified it.
    3. Restore H-8b's configuration and deploy.
    - The drill deployment READY to the restore READY must take **at most 30 minutes**.
    - **Stop:** any 400 during the drill. Restore at once; the previous-slot proof is a finding.
    - **Side effect:** ordinary mail stored during the drill records `secret_slot = 'previous'` (**[P]** count).
    - **If H-8c is not approved,** the previous slot's production behaviour is **unproven**, and unit test S-15 is its only evidence. While Resend signs with both secrets, provider traffic cannot reach the previous slot, because the current slot verifies first.
26. **Evidence before removing the previous secret:** **[P]** slot counts for each interval: [H-4, H-8b), [H-8b, H-8c), [H-8c, restore), [restore, H-8d). Record each deployment ID and UTC time.
27. **H-8d:** at least 28 hours after H-8b's READY, and so after the 24-hour dual signing ends, remove `RESEND_WEBHOOK_SECRET_PREVIOUS` and deploy.
28. **H-8e, evidence after removal:**
    - Variable names: current only.
    - One approved replay: **[R]** 200, **[L]** duplicate (only the current slot exists).
    - **[P]** slot counts for [H-8d READY, +24 h): `previous` = 0.
    - **Stop:** any provider-originated 400 after H-8d.
29. **Compromise rotation** (plan §6.4: rotate with no overlap) is not rehearsed.

### H. Retention

30. **H-9:** run one operator purge under EO-2. It needs PG-2 resolved.
    - **[O]** readback: rows deleted, expired remaining, oldest `expires_at` and total retained.
    - Under P-2, no row may be more than 14 days past `expires_at`. Record the first dated purge.
    - The expiry readback is part of acceptance and of every rollback or shutdown record.

### I. Acceptance record, next state and shutdown

31. **One dated record**, keeping apart operator-session evidence and privileged reads, transport probes and ledger-linked evidence, and provider delivery and human inbox confirmation. It lists:
    - each step's evidence;
    - facts (a), (b) and (c) separately;
    - every unproven event (`failed`, `delivery_delayed`, and `suppressed` unless T-4 showed it);
    - T-6 if blocked, and the previous slot if H-8c was not run;
    - G-1;
    - EO-4, EO-5 and EO-8 as unresolved, unless approved.

    The owner then chooses **continue** (the window stays open and the weekly purge runs) or **shut down**. Shutdown follows review fixes §2.5, and each hosted step is separately authorized:
    1. **[O]** Record the coverage-window end with a reason. This labels emails; it stops nothing.
    2. **H-3d:** disable the Resend endpoint, or delete it. Nothing is claimed about events raised while it is disabled; whether they are queued, retried or dropped is unverified. If it is ever re-enabled, read back what arrives.
    3. Remove **both** `RESEND_WEBHOOK_SECRET` and `RESEND_WEBHOOK_SECRET_PREVIOUS` from Production, and the probe flag if it is set. Deploy.
    4. H-2 answers 503, and the probe route answers 404.
    5. **[P]** arming state and retention (total, expired, oldest `expires_at`); **[O]** the page shows purge duty.
    6. Purge duty continues weekly under EO-2 while any receipt remains.

    **Not a shutdown:** `vercel promote` (an application rollback), recording a window end alone, or removing only one secret slot.
32. Phase 7 acceptance is a separate review. This checklist passing is not acceptance.

## 4. Evidence classes (kept apart in every record)

| Class | Counts as | Never counts as |
|---|---|---|
| Transport probe (unlinked, `resend.dev`) | Provider transport and event behaviour | Ledger linking, any summary rule, inbox arrival |
| Ledger-linked trusted receipt | Provider report for that attempt (rules 1–8) | Inbox arrival |
| Human inbox check plus headers [I] | Arrival and authentication of that email | A provider report |
| Operator-session readback [O] | What an operator sees through the guarded functions | A privileged database read; a secret slot (not exposed) |
| Privileged `supabase db query --linked` [P] | Definitions, hashes, counts including slot counts (no content) | Operator-path behaviour |
| Vercel operational-log readback [L] | The event name and error code of a handled request | A receipt, a slot, or a cause beyond the code |
| Resend attempt metadata [R] | Which attempts the provider made, when, and the status each received | A receipt, a slot, inbox arrival |
| HTTP 2xx or a dashboard status | That a request was authenticated and handled | Any of the above |

## 5. Carried and still open

- O-1..O-9 (readiness §2), including the O-5 push provenance gap for `20261124001000` and the push provenance of `20261128001000`.
- 7.3B items: the real `svix-id` and email-ID shapes, and the bounce strings.
- CFG-011; A2; the retrospective 7.2B review; real-email verification for 7.2C-1 and 7.2C-2; final booking-readiness checks; `request.spec.ts:837`.
- PG-1, PG-2 and PG-3 (§6); the T-6 preconditions; the T-5 and T-6 cleanup method; fact (c) blocked unless H-10 is approved and shown.
- Resend behaviour relied on but unverified, each tested where the sequence says so:
  - both secrets sign for 24 hours after rotation;
  - manual replays are re-signed;
  - automatic retries are re-signed;
  - events raised while an endpoint is disabled are handled in an unknown way;
  - `suppressed@resend.dev` behaves in an unknown way;
  - disabled-at-creation is not known to be supported.
- **Not in 7.3D:** suppression, automatic retries, Cron, resend transitions (7.3E, 7.3F, 7.6), booking and payments.

## 6. Review findings resolved (Codex review of #186, 2026-11-21)

| # | Finding | Resolution here |
|---|---|---|
| R-1 | Stale rejection, dashboard replay and automatic-retry re-signing were conflated | §3 F: three facts. (a) uses S-15/S-15a and H-11; (b) uses H-7; (c) is closed only by H-10, or is **blocked**. ±300 s unchanged |
| R-2 | Rotation did not exercise both slots | §3 G: approved-probe replays only. The previous slot is shown by construction (H-8c). Evidence before (step 26) and after (step 28) removal. Slot counts are privileged reads, kept apart from operator evidence. No extra email |
| R-3 | The suppressed probe was treated as a pass/fail test | §3 step 13: T-4 is observational. Exact stop list and exact unproven list. `failed` and `delivery_delayed` stay unproven without a trusted receipt for an approved send |
| R-4 | Endpoint states were implicit | H-3, H-3d and H-3e are separate authorized actions. Disabled-at-creation is unverified (PG-1), and G-1 is recorded. Nothing is claimed about events raised while disabled |
| R-5 | T-5/T-6 records were unspecified | §2 EO-6: exact proposed records and cleanup. T-6 is conditional on a `suspended`, excluded synthetic provider, and blocked otherwise. No real vendor is touched. Nothing is created |

**Provisioning gaps** (for Codex; not resolved here):

- **PG-1:** creating an endpoint disabled is unverified, so gap G-1 is expected.
- **PG-2:** no operator purge control exists (§2 EO-2).
- **PG-3:** plan §6.4 step 3 says slot counts come "through the operator readback", but no operator function exposes `secret_slot`. This record uses the privileged count. Codex chooses between amending the plan and a later reviewed operator slot-count function.

## 7. Owner decision card

One written, dated response may approve any of the lines below. Each must be named; an unnamed item is not approved.

**Decisions (PROPOSALS):**

- **EO-2:** 90 / 30 days; P-2 with D = 14 days; a weekly manual purge with Josh accountable on Monday mornings ET; run procedure, record, capacity (10,000 per run; finding above 5,000 receipts a week) and escalation as in §2. The approval must also name the **PG-2 method**.
- **EO-3:** the seven types; no opens or clicks.
- **EO-7:** keep minimal, address-free unmatched receipts for 30 days.
- **EO-6:** T-1..T-6 as specified (T-6 conditional); T-7 deferred.
- **EO-4, EO-5 and EO-8:** stay unresolved.

**Hosted actions (EO-1)**, each approved by name:

| Actions | Production deployments |
|---|---|
| H-1, H-2, H-3 (H-3d and H-3e only if chosen), H-4, H-5 | H-4: 1 |
| H-6 | 2 |
| H-10 (fact (c); without it 7.3D cannot be accepted) | 2 |
| H-7, H-11 | 0 |
| H-8a, H-8b, H-8c, H-8d, H-8e | H-8b 1, H-8c 2, H-8d 1 |
| H-9 (weekly) | 0 |

Plus the privileged read-only readbacks in steps 2, 8, 11, 22–28, 30 and 31.

**Test sends:**

| Send | Recipient | Note |
|---|---|---|
| T-1 | `delivered@resend.dev` | Inside H-10 if approved |
| T-2 | `bounced@resend.dev` | |
| T-3 | `complained@resend.dev` | |
| T-4 | `suppressed@resend.dev` | Observational |
| T-5 | Controlled mailbox | Synthetic contact submission |
| T-6 | Controlled mailbox | Synthetic `R0 Access Test Provider` renewal, only if it is `suspended` and excluded; otherwise blocked |

Each is sent once, after H-5. T-5 and T-6 cleanup are separate later approvals.

**Stop conditions:**

- a provider-originated 400 `webhook_signature_invalid`;
- an `invalid_payload` or `other` receipt;
- a probe linked or excluded (`not_probe`);
- a receiver 5xx outside H-10;
- a probe sent to another address or twice;
- an automatic retry refused, or none within 3 hours (fact (c));
- a replay refused (fact (b));
- any 400 in the H-8c drill;
- any 400 after H-8d;
- H-10 or H-8c bounds exceeded (still restore);
- EO approvals missing at step 5.

On a stop, no further activation step is taken. The owner holds the current state or shuts down.

**Shutdown procedure** (step 31):

1. Record the window end.
2. H-3d: disable or delete the endpoint.
3. Remove both secret slots and the probe flag, then deploy.
4. Read back 503 and 404.
5. Read back retention.
6. Weekly purges continue while any receipt remains.

`vercel promote` is never the shutdown.
