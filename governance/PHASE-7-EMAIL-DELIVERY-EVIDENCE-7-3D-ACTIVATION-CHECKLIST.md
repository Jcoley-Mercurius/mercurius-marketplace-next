# Phase 7.3D controlled activation checklist (TRACE-155)

**Status: DOCUMENTATION ONLY. NOT AN AUTHORIZATION. NOT PHASE 7 ACCEPTANCE.** This record orders the controlled 7.3D activation and lists what must be decided first. It authorizes no hosted action: no secret, webhook registration, coverage-window start, probe enablement, email, suppression, retry, Cron, booking or payment. It is not a feature slice and adds no code.
**Authority:** the owner's 2026-11-21 instruction; the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §6.4, §8.4, §11.4, §12 and §15.1; the [readiness record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) §2–§3 with its corrections in §6–§7; the [7.3D-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md); the [7.3D-1 review fixes](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1-REVIEW-FIXES.md), whose §2.5 is the shutdown procedure.
**Base:** #185 head `6823599544d24d596cc4bc9df490770fd7dc7c5c`, on `main` `8a40fa4`. Branch `claude/phase7-3d-activation-checklist`. Where this record and the plan differ, the readiness corrections and this record govern until the plan is amended under review.

## 1. State at preparation (read-only, 2026-11-21)

| Item | Observed |
|---|---|
| `main` | `8a40fa46e7752ae5d6625287fb684a941978ced4` |
| #185 | Open; head `6823599`, which corrects the shutdown wording. Codex's source review accepts F-1..F-6 with no blocking code finding. That is not activation or acceptance. **Not merged**: owner release approval is pending |
| Hosted migrations | `supabase migration list --linked`: local = remote through `20261129001000`; nothing local-only or remote-only |
| Hosted readback (13:16:54 UTC, one privileged read-only `supabase db query --linked`, no row content) | `email_evidence_probe_readback` md5 `bd5da284bbd54764df0986ac1153e529`; execute `authenticated` yes, `anon` no; **0** arming events; **0** rows with `armed_at`; **0** receipts |
| Receiver | Dormant by design: no `RESEND_WEBHOOK_SECRET`, no registration (per the records; Production variables were not listed in this session) |
| Probe harness | Off: no `EMAIL_EVIDENCE_PROBES_ENABLED`, and the route opens only in `VERCEL_ENV=production` |

## 2. Owner decisions, presented together

None is approved by this record, by Codex's reviews or by any merge. Arming needs **EO-1, EO-2, EO-3, EO-6 and EO-7** (plan §13.3). Each line under "To approve" is what the approval must state.

### EO-2: retention, deletion deadline, weekly operator purge, accountable owner

- **Implemented now** (`20261124001000`): expiry is set once, at receipt. Linked receipts get **90 days**, unlinked, `other` and `invalid_payload` receipts get **30 days**. Logical exclusion takes effect at `expires_at`. Physical deletion happens by purge-on-receipt (at most 100 per call) and by the operator purge `email_provider_events_purge(p_limit)` (1–1,000 per call).
- **Proposal:** **P-2 with D = 14 days**, through an evidenced **weekly** operator purge with a backlog readback. No `pg_cron` job (that would be a separate scheduler approval).
- **To approve:**
  - the intervals (90 / 30, or other values, which would need a forward migration);
  - P-1 or P-2, and D;
  - the **named accountable person** and a weekday;
  - the record format for each run: date, rows deleted, expired remaining, oldest `expires_at`, total retained, no content;
  - the capacity check: weekly throughput of at least 1,000 rows per run, plus receipt-time purges, must exceed expected expiry inflow, with the margin recorded;
  - what happens if a run is missed: any expired row older than `expires_at` + D is a finding.
- The duty lasts **while any receipt remains, expired or not**, including after a coverage-window end, an application rollback or a shutdown (review fixes §2.5).

### EO-3: subscribed events

- **Proposal:** exactly the seven operational types: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`. No opens or clicks.
- **To approve:** that list, or a subset. Any type outside the list is stored as `other` and counted, never interpreted.

### EO-7: minimal unmatched receipts

- **Proposal:** keep minimal, address-free receipts for mail without a Mercurius ledger link (Auth SMTP, legacy paths, probes). They are held **30 days** and never linked or rematched.
- **To approve:** keep (30 days), or drop. Dropping would need a code change before arming, because the receiver stores them today.

### EO-1: specific hosted actions

Each action below needs its own dated authorization. Approving one approves none of the others. Section 3 gives the order.

| # | Hosted action | Where | Reverse action |
|---|---|---|---|
| H-1 | Read-only domain status readback (domain, status, region only) and a dated DNS lookup | Resend `GET /domains`; public DNS | n/a |
| H-2 | Post-deploy `POST /api/webhooks/resend` expecting **503** (O-4) | Production | n/a |
| H-3 | Create the webhook endpoint for the EO-3 events at `https://www.mercuriusmarketplace.com/api/webhooks/resend` | Resend | Disable or delete the endpoint |
| H-4 | Set `RESEND_WEBHOOK_SECRET` (the endpoint's signing secret) in Vercel **Production only**, with `RESEND_WEBHOOK_SECRET_PREVIOUS` unset, then create a new Production deployment | Vercel | Review fixes §2.5 3(b) |
| H-5 | Record the **coverage-window start** (arm), with the EO-1 attestation, on `/admin/email-evidence` | Production, operator session | Record the window end (labels only) |
| H-6 | Set `EMAIL_EVIDENCE_PROBES_ENABLED=true` in Production and redeploy; later remove it and redeploy | Vercel | Remove and redeploy |
| H-7 | A Resend dashboard **replay** of a message older than 5 minutes (re-signing proof) | Resend | n/a |
| H-8 | Secret **rotation rehearsal**: new signing secret, both slots, redeploys | Resend, Vercel | Plan §6.4 |
| H-9 | Operator purge runs under EO-2 | Production, operator session | n/a |

Every redeployment in H-4, H-6 and H-8 is a production release outside the merge flow. Under AGENTS.md, that needs the owner's instruction.

### EO-6: exact test sends and the controlled mailbox

- **Controlled mailbox:** the owner's own mailbox, the Production owner-notification recipient. It is the only address a human checks. Its address is not repeated here.
- **Proposed sends:** one per row, sent only after H-5. Each must have its ledger `claimed_at` at or after the window start.

| # | Send | Path | Recipient | Evidence it can give |
|---|---|---|---|---|
| T-1 | Probe `delivered` | `POST /api/admin/email-evidence-probe` | `delivered@resend.dev` | Transport only (unlinked) |
| T-2 | Probe `bounced` | as T-1 | `bounced@resend.dev` | Transport; the observed `bounce.type` strings |
| T-3 | Probe `complained` | as T-1 | `complained@resend.dev` | Transport |
| T-4 | Probe `suppressed` | as T-1 | `suppressed@resend.dev` | Transport; **which event and payload is unverified** |
| T-5 | One synthetic contact submission | Real owner-email ledger (7.2C-1) | Controlled mailbox | Ledger-linked, rule 4; human inbox check; headers |
| T-6 | One synthetic provider renewal | Real renewal ledger (7.2C-2) | Controlled mailbox | As T-5 |
| T-7 *(optional, O-7)* | One application email and one price-draft notice | 7.3C-2 tagged senders | A plus-address on the controlled mailbox, with a synthetic record | Tags present; ledger-linked |

- **To approve:**
  - T-1..T-6, plus T-7 if wanted;
  - the controlled mailbox;
  - the synthetic records used (no customer data);
  - that each probe runs **once**. The harness keys probes per day and never retries.
- `email.failed` and `email.delivery_delayed` have **no known fixture**. They stay "not proven" and are not inferred from another event.

### Unresolved and not approved: EO-4, EO-5, EO-8

- **EO-4** (whether a bounce or complaint changes later sends), **EO-5** (who removes suppression-list entries) and **EO-8** (all current email is transactional or operational) stay **open**.
- No suppression, automatic retry or send-blocking is enabled in 7.3D, whatever these say.
- They are recorded as unresolved in the acceptance record unless the owner records an explicit approval.

## 3. Activation sequence

Steps run in order. Each step names the authorization it needs and the evidence it must leave. **Stop** means: record the finding, take no further step, return to Codex.

### A. Release and read-only baseline (before any hosted action)

1. **#185 merged** on owner release approval. Then read back, for the merge commit:
   - main CI green;
   - the Vercel Production deployment READY, linked through `meta.githubCommitSha`;
   - `vercel inspect www.mercuriusmarketplace.com` resolving to it.
2. **Privileged read-only readback** (Claude, `supabase db query --linked`):
   - the probe readback `bd5da284…`;
   - the other eight 7.3D-1 functions `8 | 8fbc18c0…`, and the summary `8eadddd6…`;
   - the 7.3B six, 7.3C-1 ten and 7.3C-2 nine hashes, and money `58 | af0fae6e…`;
   - grants;
   - 0 arming events, no `armed_at`, 0 receipts (O-6).
3. **Operator-session checks** (owner, signed in, O-1..O-3):
   - the counts functions return zeros with `receiver_armed` false;
   - Owner Emails, Recruiting and price drafts show the delivery-evidence card;
   - `/admin/email-evidence` shows "No coverage window has ever been recorded".

   This is operator evidence, not a privileged read. Record it separately from step 2.
4. H-1 (domain status, DNS) and H-2 (503), each with the owner's word.
5. **EO-1, EO-2, EO-3, EO-6 and EO-7 approved and recorded.** If not: stop.

### B. Receipt enabled (no coverage window yet)

6. H-3: create the endpoint for the EO-3 events.
   - If Resend can create it **disabled**, do so, and enable it after step 7.
   - Otherwise, production mail sent between H-3 and step 7 gets 503s and Resend retries. Record that gap.
   - Whether Resend supports creating a disabled endpoint is **unverified**.
7. H-4: deploy the current secret only, through a new Production deployment. Then:
   - read back the variable names (no values) and the deployment's READY state;
   - confirm the endpoint is enabled.
8. Readback: receipts may now arrive from ordinary production mail. Their attempts were claimed before any window, so their coverage is `before_first_arm`, and they never qualify.
   - Any `invalid_payload` or `other` receipt is a finding.
   - If the Resend endpoint shows a **provider-originated** delivery that the receiver rejected (`webhook_signature_invalid` in the operational log): stop.

### C. Coverage window start (the cutoff)

9. H-5: record the window start with a reason, giving the EO-1 attestation. The `armed_at` written here is the **cutoff**. A send claimed before it never qualifies, whatever arrives later (readiness §3.2).

### D. Transport probes (unlinked; never ledger evidence)

10. H-6: enable probes, then run T-1..T-4, once each.
11. Read back each probe through `email_evidence_probe_readback`. A probe **passes** only when its expected event arrives as an **unlinked** receipt and the ID is not excluded.
    - A missing, unexpected, excluded, `other` or `invalid_payload` result is a finding, never a pass.
    - A probe is never credited with rules 1, 4, 5 or any ledger rule.
12. Remove the probe flag and redeploy (H-6 reverse). Confirm the route answers 404.

### E. Ledger-linked controlled sends (trusted evidence)

13. Send T-5, T-6 (and T-7 if approved) through the real paths, after the cutoff.
14. **Provider delivery:** each ledger attempt `sent`, and a **trusted** `email.delivered` receipt with identity `tag_and_id`. It must be read back through the operator functions as rule 4. A bare 2xx, a dashboard "succeeded" or a log line is not proof.
15. **Human inbox confirmation, recorded separately:** the owner sees each email in the controlled mailbox, and its headers show DKIM, SPF and DMARC passing. A provider `delivered` event never stands in for this, and this never stands in for the receipt.

### F. Freshness and re-signing (two separate facts)

16. **(a)** Re-post a captured signed request more than 5 minutes later and expect 400 `webhook_signature_invalid`. This proves the check only.
17. **(b)** H-7: a provider-originated delivery made more than 5 minutes after its event is verified and stored under the **unchanged** ±300 s check.
    - (a) never counts as (b).
    - If (b) fails, or cannot be shown: stop. The design returns to Codex (plan §12 item 3). Never relax the check.

### G. Rotation rehearsal (both slots)

18. H-8, following plan §6.4 with the 28 h horizon (readiness §6 item 3):
    1. create a new secret;
    2. set `…_PREVIOUS` to the old value and the current slot to the new one; redeploy;
    3. confirm new receipts record `secret_slot = 'current'` (counts by slot, no values);
    4. after 28 h, remove `…_PREVIOUS` and redeploy.

    Record each step's deployment ID.

### H. Retention

19. H-9: run one operator purge under EO-2. Record the readback: deleted, expired remaining, oldest `expires_at` and total retained.
    - Under P-2, no row may be more than D past `expires_at`. Record the first dated purge.
    - The expiry readback is part of acceptance and of every rollback or shutdown record.

### I. Acceptance record and next state

20. One dated record, kept apart in these classes: operator-session evidence and privileged reads; transport probes and ledger-linked evidence; provider delivery and human inbox confirmation. It lists:
    - each step's evidence;
    - every unproven event (`failed`, `delivery_delayed`, possibly `suppressed`);
    - EO-4, EO-5 and EO-8 as unresolved, unless approved.
21. The owner then chooses: **continue** (the window stays open; the weekly purge runs) or **shut down** (review fixes §2.5: record the window end; disable the endpoint; remove **both** secret slots and redeploy; read back 503; purge duty continues while any receipt remains).
    - An application rollback (`vercel promote`) is never the shutdown.
22. Phase 7 acceptance is a separate review. This checklist passing is not acceptance.

## 4. Evidence classes (kept apart in every record)

| Class | Counts as | Never counts as |
|---|---|---|
| Transport probe (unlinked, `resend.dev`) | Provider transport and event behaviour | Ledger linking, any summary rule, inbox arrival |
| Ledger-linked trusted receipt | Provider report for that attempt (rules 1–8) | Inbox arrival |
| Human inbox check plus headers | Arrival and authentication of that email | A provider report |
| Operator-session readback | What an operator sees through the guarded functions | A privileged database read |
| Privileged `supabase db query --linked` | Definitions, hashes, counts (no content) | Operator-path behaviour |
| HTTP 2xx or a dashboard status | That a request was authenticated and handled | Any of the above |

## 5. Carried and still open

- O-1..O-9 (readiness §2), including the O-5 push provenance gap for `20261124001000` and the push provenance of `20261128001000`.
- 7.3B items: the real `svix-id` and email-ID shapes, and the bounce strings.
- CFG-011; A2; the retrospective 7.2B review; real-email verification for 7.2C-1 and 7.2C-2; final booking-readiness checks; `request.spec.ts:837`.
- **Not in 7.3D:** suppression, automatic retries, Cron, resend transitions (7.3E, 7.3F, 7.6), booking and payments.
