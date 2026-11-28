# Phase 7 scope-freeze and closeout proposal (TRACE-162)

**Status:** **PROPOSAL FOR OWNER DECISION. DOCUMENTATION ONLY. NOT PHASE 7 ACCEPTANCE.**
- It approves no policy, deferral, package or slice.
- It authorizes no code, migration, hosted query or action, merge, deployment, automation, email activation, booking or payment change.
- It does not weaken the gate. Every gap the earlier register (PR #222, first revision) evidenced is kept; Appendix A maps each one to its place here.
- The work packages in §7 are a planning proposal, not an implementation commitment. Each needs its own owner instruction.

**Checkpoint:** `main` `41d34ec` (#220 merge, 2026-11-28 18:01:53 UTC), re-fetched 2026-11-28 ET with no change. Open PR #221 (documentation, 7.5G-2 post-merge record) is not on `main`; evidence only there is labelled "#221 only".
**Method:**
- `git` and `gh` only: merge history, every Phase 7 record on `main` and on #221, and every comment and review on PRs #162–#222.
- No hosted, Vercel, Supabase, Resend or PostHog call.
- Status comes from the latest dated note, not from header lines.

**Authority:**
- The owner's scope-freeze instruction (2026-11-28 ET), revising the closeout-register instruction of the same day.
- The roadmap Phase 7 scope and gate.
- MPS §2, §5, §8–§11; MTS §10, §11, §14, §15; CFG-010, CFG-011, CFG-015.
- DEC-2026-003, 006, 010, 022, 026, 049, 054, 063, 065–070.
- The Phase 7 contracts: [notification](PHASE-7-NOTIFICATION-CONTRACT.md) (NM-1), [analytics](PHASE-7-ANALYTICS-COVERAGE-CONTRACT.md) (AC-1), [operations queues](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1), [email activation checklist](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-ACTIVATION-CHECKLIST.md).

---

## 0. Summary

1. **The gate is not met.** The roadmap gate reads: "staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication."
   - Queue items and audit records exist and are tested locally.
   - Neither "correct alert" nor two of the required user communications is yet defined by an approved authority, and the producers they need do not exist.
   - The staged-failure test file (SQL 128) is characterization (§5).
2. **The alert outcome is defined here as a requirement, not a vendor** (§4). An external monitoring provider is one channel option, not a requirement. Only uptime checks need something running outside the application, because an application that is down cannot report itself.
3. **DEC-2026-069's manual-scan model is preserved.** SLA breaches are detected when an operator scans. Scheduler activation is proposed as a deferral to booking-activation readiness (PD-1), not as a Phase 7 requirement.
4. **Review evidence is reconciled into classes** (§2):
   - *Design rulings recorded* (Codex rulings relayed in conversation and written into the repository before implementation);
   - *Implementation review found*;
   - *No review found* (the repository holds no outcome; this does **not** mean the code was not reviewed).

   Of 24 merged Phase 7 code rows in the ledger:
   - 11 have **no implementation review found**; 8 of those have recorded design rulings;
   - 5 have a review found whose follow-up re-review is not found (7.1, 7.3D-2, the 7.5E repair, 7.5F-1 and its repair);
   - 8 have no gap;
   - 7.5G-1 is one of the 11. Codex's R-1..R-5 and C-1..C-3 are recorded, and its implementation choices I-1..I-6 have no recorded ruling.
5. **Superseded releases:** checks of deployments that have since been replaced are kept as **not performed**. In their place this proposes one current-release verification plus regression evidence. Checks that read persisted data remain possible and stay in scope (§2.4).
6. **Remaining work is grouped into five workstreams** (§7): communications, observability, measurement gaps, operational verification and final acceptance. There are 14 proposed packages; matcher and money-function changes stay in packages of their own.
7. **One decision card** (§9) states:
   - the proposed minimum exit scope (X-1..X-8);
   - eleven proposed deferrals (PD-1..PD-11), none approved;
   - the acceptance evidence;
   - the packages and dependencies;
   - the ten decisions that freeze the scope (FD-A..FD-J).

---

## 1. Baseline

| Item | Observation (2026-11-28 ET) |
|---|---|
| `origin/main` | `41d34ec` (#220), unchanged since the first revision |
| Open PRs | #221 (7.5G-2 post-merge record, documentation); #222 (this proposal) |
| Phase 7 authorization | Owner, 2026-11-10 ([PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md)); engineering only |
| Phase 7 migrations on `main` | 13: `20261122001000` through `20261206001000`, excluding `20261125001000`/`20261126001000` (TRACE-156) and `20261201001000` (TRACE-160) |
| Reachability | R0 admission default-closed; `offer_terms` and promotions gates off. Request, quote, payment, fulfillment and payout queues should receive no Production items (OQ-1 X-7). Not queried |
| PR comments | #162–#222 hold comments from the owner account (CI, hosted push and dry-run notes), CodeRabbit and Supabase bots. **None holds a Codex ruling** |

---

## 2. Review and release reconciliation

### 2.1 Evidence classes

| Class | Meaning | Example |
|---|---|---|
| **GH** | A GitHub review object by Codex | 5926513941 (#169) |
| **DR** | Design ruling recorded: Codex direction on a plan or contract, relayed by the owner and written into the repository before implementation. It reviews the design, not the merged code | 7.5G plan §9 R-1..R-5, C-1..C-3 |
| **IR** | Implementation review found: a Codex outcome on the implemented code (GitHub or relayed and recorded) | 7.5E D-1..D-7 with F-1/F-2 |
| **HV** | Codex hosted verification recorded | 7.5D migration readback, 2026-11-24 22:50:29 UTC |
| **No review found** | The repository, the PR comments and the PR reviews hold no Codex outcome for that code. **It does not mean "not reviewed".** A review given in conversation but never written down falls here until it is recorded (DR-2) | 7.5G-1 I-1..I-6 |

### 2.2 Merged code slices

| Slice (TRACE) | PR → `main` | Design rulings | Implementation review | Gap |
|---|---|---|---|---|
| 7.1 tracing, oplog (151) | #162 → `11c05b0` | — | IR: Codex review before merge (record §11) | Re-review of the follow-up: **no review found** |
| 7.2B vendor readback (153) | #164 → `3eb8ff4` | DR: B1, R1–R3 (record table; DEC-2026-065) | **No review found** | Retrospective review carried in every later record |
| 7.2C-1 contact ledger (154) | #166 → `24dd455` | DR: C-1..C-8 | IR ([release checkpoint](PHASE-7-OWNER-EMAIL-LEDGER-CODEX-REVIEW.md)) | — |
| 7.2C-2 renewal ledger (154) | #167 → `8a9603b` | DR: C-1..C-8; Codex issued the handoff | **No review found** (readiness O-9) | — |
| 7.3B receiver (155) | #169 → `e25e7f8` | DR: plan reviews 5891386779, 5891897514 | GH 5926513941 | — |
| 7.3C-1 (155) | #180 → `9e7fd39` | DR: 5926523770 | GH 5985392153 | — |
| 7.3C-2 (155) | #181 → `d44342b` | — | GH 5995373396 | — |
| 7.3D-1 (155) | #184 → `8a40fa4` | DR: 5997315152 (R3D-1..R3D-4) | IR: findings repaired in #185 | — |
| 7.3D-1 fixes (155) | #185 → `96c8149` | — | IR: F-1..F-6 accepted | — |
| 7.3D-2 purge control (155) | #187 → `ffd8bfb` | — | IR: D-1, D-2, D-4, D-5 accepted; D-3 correction required | Re-review of the D-3 correction: **no review found** |
| 7.4B trigger tests (158) | #191 → `aab602b` | — | IR: retrospective, no blocking issue (relayed) | — |
| 7.4C once per draft (158) | #194 → `83c8fea` | — (D-2 is an owner decision) | **No review found** (R-1..R-9) | — |
| PostHog (157) | #182 → `c5e24cf` | — | **No review found** | — |
| Web Analytics redaction (139) | #138 → `b7b0d08` | — | **No review found** | — |
| 7.5B summary truth (159) | #197 → `126c85f` | DR: OQ-1 RV-2 | **No review found** (R-1..R-7) | — |
| 7.5C staged failures (159) | #199 → `aeb20e4` | DR: OQ-1 RV-1, RV-4 | **No review found** (R-1..R-6) | — |
| 7.5D first reply (159) | #201 → `dcc62e1` | DR: R-1..R-7, CD-1 | **No review found** (D-1..D-4) | HV: hosted definitions matched at 2026-11-24 22:50:29 UTC; push time still unrecorded |
| 7.5E admin readback (159) | #202 → `afa0be8` | DR: OD-5 (DEC-2026-068) | IR: D-1..D-7 accepted subject to F-1, F-2 | — |
| 7.5E repair (159) | #203 → `01a5dd1`; #204 → `846dd34` | — | — | Re-review: **no review found** |
| 7.5F-1 SLA ledger (159) | #208 → `89973fa` | DR: 7.5F plan F-1..F-10, D-1..D-9 | IR: finding F208-1 | Disposition of I-1..I-15: **no review found** |
| 7.5F-1 repair (159) | #211 → `5cfe5b0` | — | — | Review of R-1, O-1: **no review found** |
| 7.5F-2 SLA page (159) | #213 → `e3a12a1` | DR: 7.5F plan | **No review found** (I-1..I-13, G-1..G-4, D-1..D-3) | — |
| 7.5G-1 applications queue (159) | #215 → stacked base; #217 → `1e97f95` | **DR: R-1..R-5, C-1..C-3** ([7.5G plan](PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md) §9) | **No review found for I-1..I-6** | §2.3 |
| 7.5G-2 sourcing queue (159) | #220 → `41d34ec`, merged before review | DR: SG-1..SG-9; revision 2 technically clear | **No review found** (I-1..I-10) | The outstanding sourcing review |

The 24 rows count as follows:
- 11 with **no implementation review found**: 7.2B, 7.2C-2, 7.4C, TRACE-157, TRACE-139, 7.5B, 7.5C, 7.5D, 7.5F-2, 7.5G-1, 7.5G-2. Eight of them have design rulings (all but 7.4C, TRACE-157 and TRACE-139).
- 5 with a review whose follow-up re-review is not found: 7.1, 7.3D-2, the 7.5E repair, 7.5F-1 and the 7.5F-1 repair.
- 8 with no gap: 7.2C-1, 7.3B, 7.3C-1, 7.3C-2, 7.3D-1, 7.3D-1 fixes, 7.4B, 7.5E.

### 2.3 7.5G-1 reconciliation

| Item | Recorded ruling | Where the implementation records it | Status |
|---|---|---|---|
| R-1 authority, R-2 summary-only scope, R-4 response shape, R-5 placement | Accepted (plan §9.1) | Built as ruled (7.5G-1 record §2) | Design ruling recorded; conformance not independently reviewed |
| R-3 timestamp = application received; revisions do not reset it | Accepted with wording (plan §9.1) | SQL 133 multi-revision fixture | As above; test evidence exists |
| C-1 real cross-layer parity | Required (plan §9.2) | Parity script from real SQL output through the real `applicationQueueState` | As above |
| C-2 parity limits | Required | Record states the `checking`/`unavailable` exclusion | As above |
| C-3 order `created_at, id`; fixtures | Required | SQL 133 tie, revisions, linked onboarding without review start | As above |
| I-1 execute grants (no `service_role`) | **None recorded** | Record §6 | **No review found** |
| I-2 guard `vendor_require_operator()` | **None recorded** | Record §6 | **No review found** |
| I-3 parity fixture projection | **None recorded**. C-1 covers parity method, not this projection | Record §6 | **No review found** |
| I-4 absolute fixture times | **None recorded** | Record §6 | **No review found** |
| I-5 replica-mode outcome writes | **None recorded** | Record §6 | **No review found** |
| I-6 R0 existing-provider start not exercised | **None recorded** | Record §6 | **No review found** |

If Codex ruled on I-1..I-6 in conversation, the ruling should be recorded verbatim (DR-2). It must not be inferred from the plan rulings.

### 2.4 Superseded releases

Every `main` merge deploys (DEC-2026-037). A check of an older deployment's state cannot be observed once a newer deployment serves `www`.

**Kept as "not performed"** (historical, never reconstructed):
- Production READY for `126c85f`, `dcc62e1`, `afa0be8`, `01a5dd1`, `846dd34`, `89973fa`, `5cfe5b0`, `e3a12a1` and `1e97f95`.
- HQ-1 and HQ-2 at `126c85f` and at `1e97f95`.
- The 7.2B hosted readback at `3eb8ff4`.
- 7.3B O-6 post-deploy readbacks.
- 7.1 preview log readback at `11c05b0`.
- READY for `41d34ec`: observed but not independently verified (#221 only).

**Recorded as not recorded** (push provenance):
- who pushed `20261124001000`, `20261128001000`, `20261204001000` and `20261206001000`, and when;
- when `20261202001000` was pushed. Its hosted state was verified by Codex (HV), but the push time is unrecorded.

**Still possible, so kept in scope:**
- checks that read persisted data: the 7.2C-2 renewal-window reconciliation (O-9);
- current hosted definitions.

**Proposed replacement (PD-7):** one current-release verification at the `main` commit then serving `www` (TV-5), plus regression evidence on the same commit (TV-6).
- This shows the current release carries every Phase 7 change correctly.
- It does not claim the older deployments were checked.

### 2.5 Stale header lines

The Status lines of these records predate their merges:
- 7.1; 7.2B; 7.2C-2;
- 7.3B; 7.3C-1; 7.3C-2; 7.3D-1; 7.3D-1 fixes; 7.3D-2;
- 7.4C;
- 7.5B; 7.5C; 7.5D; 7.5E; 7.5F-1; 7.5F-2;
- 7.5G-2 on `main` (#221 corrects it).

The ledger above governs. Reconciling the headers is DR-3.

---

## 3. Gap register in six categories

The earlier IDs are in Appendix A, so nothing is dropped. "Package" points to §7.

### 3.1 Missing required behavior

| ID | Gap | Authority | Evidence | Package |
|---|---|---|---|---|
| MR-1 | **No alert outcome** for any staged failure or SLA breach. That includes MTS §10 webhook step 7 ("Alert and expose replay for repeated failures") | Roadmap gate; MTS §10, §11 | SQL 128 pins "alert: none" for SF-1..SF-11 | O2 |
| MR-2 | **Gate communications undefined or missing:** exhaustion and consent needed (SF-7, N-REQ-04), support acknowledgement (SF-8) | Roadmap gate; MPS §10 | SQL 128 SF-7, SF-8 | C2, M2 |
| MR-3 | **No approved notification matrix:** no channel or fallback is defined for the eleven MPS §10 groups. NM-1 is a characterization | MPS §10; roadmap line 1 | NM-1 §6 | FD-C, then C2 |
| MR-4 | **11 of 18 API routes and two helpers log raw error objects** outside `mercurius.oplog.v1`, with no correlation ID | CFG-011 (no secrets or unnecessary personal data); MTS §11; roadmap line 4 | Source count at `41d34ec` | O1 |
| MR-5 | **No error reporting** | Roadmap line 4; MTS §15 item 6 | No provider or procedure | O3 (FD-D) |
| MR-6 | **No uptime or synthetic checks** (marketing, login, API health, webhook health) | Roadmap line 4; MTS §11 | None | O3 (FD-D) |
| MR-7 | **CFG-011 operational-log retention not met:** no drain or exporter; host retention unverified | CFG-011 | 7.1 record | O3 (FD-E) |
| MR-8 | **No append-only exhaustion event** (L-4) | MPS §5.6 (every transition has an audit event); MPS §11 liquidity | AC-1 L-4 | M2 |
| MR-9 | **No eligible-pool count or matching version** (L-1, E-9); the live matcher computes none | MPS §11, §5.2, §6.2 | OQ-1 §6.2 | M2 or PD-5 (OD-3) |
| MR-10 | **No operator runbooks**, a required deliverable | Roadmap line 6; [PROPOSED-MPS.md:362](../mps/PROPOSED-MPS.md#L362) | None exist | V2 |
| MR-11 | **Notification defects:** conflicting acceptance copy (N-REQ-03, money-fingerprinted); CFG-006 notice consistency (G2-03); duplicate cancellation notices (G3-04); operator and actor free text to homeowners (G3-05); reply notice linking to an inaccessible ticket (7.5D F-1) | MPS honest-outcome rule; CFG-006; MPS §10 privacy-safe | NM-1 §7; 7.5D §4 | C2; money-function part PD-4 |
| MR-12 | **No payment, refund or payout notices** (N-CXL-07/08) | MPS §10 | NM-1 | PD-3 |

### 3.2 Tests and verification

| ID | Item | Evidence or gap | Package |
|---|---|---|---|
| TV-1 | Producer acceptance for untested events (G2-02): N-FUL-01/03/04, N-FUL-09/10, N-QTE-02/06, N-CXL-03/05/06, N-REC-02/03, N-SUP-03, N-APT-02/03 | Count-only or none | C1 |
| TV-2 | Homeowner bell and `/notifications` browser acceptance (G2-04) | None | C1 |
| TV-3 | Gate acceptance tests replacing SQL 128's characterization. SF-7 must also assert the sourcing item: SQL 128 predates `admin_sourcing_queue()` and does not call it | Characterization only | F1 |
| TV-4 | Audit-record completeness against MPS §9 (actor, timestamp, reason code, detail, before/after, affected communication, financial event) | Not characterized (AC-1 O-1) | M1 |
| TV-5 | Current-release verification (read-only, owner-authorized): READY at the serving commit; migration-list parity; definition md5s for every Phase 7 function against a clean local replay; money fingerprint; HQ-1 (owner); HQ-2 (one snapshot); manual checks of each Phase 7 admin and vendor page; readiness O-1..O-4; notification hosted parity (G2-06, including the dormant `record_match_offer` trigger and the legacy `vendor-application-notify` deployment) | Pieces exist only at older commits or on #221 | V3 |
| TV-6 | Regression evidence on the TV-5 commit: `main` CI, full SQL suite on a clean replay, concurrency scripts, analytics privacy lane | CI per merge only | V3 |
| TV-7 | Email delivery, retry and domain evidence: the checklist §3 run after the EO approvals. H-1 domain readback; H-2/O-4 503; H-7 replay (fact b); H-10 automatic retry (fact c); T-1..T-5; DKIM, SPF and DMARC headers. T-6 blocked | Dormant; historical R0 DKIM/SPF only (2026-09-30) | V4 |
| TV-8 | First production SLA scan by an admin under DEC-2026-069, with readback. The purge runs only once rows have expired (P-7) | Never run on hosted | V5 |
| TV-9 | 7.2C-2 renewal-window reconciliation (O-9). It reads persisted rows, so it is still possible | Open | V3 |
| TV-10 | Production log readback of the structured logger, after O1 | Never done | V3 |
| TV-11 | Analytics production evidence: TRACE-157 activation (PR #182); TRACE-139 hosted readback | Open | V3 |
| TV-12 | Codex rulings on SD-1 and SD-2 (7.5C discrepancies) | Open | V1 |
| TV-13 | Auth SMTP and invitation delivery proof (N-APP-03, M-9) | Phase 5 carry; unproven | V3 or carried |
| TV-14 | A2 human checks on Phase 7 pages | Carried (booking-readiness register) | Carried |

### 3.3 Documentation and review reconciliation

| ID | Item | Package |
|---|---|---|
| DR-1 | Codex dispositions for the 11 rows with no implementation review found and the 5 missing re-reviews (§2.2), including **7.5G-2 I-1..I-10** and **7.5G-1 I-1..I-6** | V1 |
| DR-2 | Record verbatim any Codex conversation ruling not yet in the repository. Never infer one | V1 |
| DR-3 | Dated reconciliation notes on the 17 stale headers (§2.5), or a ruling that this ledger governs | V1 |
| DR-4 | Resolve #221 (review and merge, or fold into V1) | V1 |
| DR-5 | Contract reconciliation notes. AC-1 O-2 is superseded by 7.5F. OQ-1 X-4, Q-01 and Q-12 are updated by 7.5E and 7.5G. NM-1 G1-01, G1-02 and G2-01 are closed by 7.2B, 7.2C and SQL 119 | V1 |
| DR-6 | Push-provenance gaps recorded as not recorded (§2.4) | V1 |
| DR-7 | Historical release checks recorded as not performed (§2.4; PD-7) | V1 |
| DR-8 | Duplicate TRACE-159 rows (7.5E F-3) | V1 |
| DR-9 | Codex to confirm the partial layer-B rows are acceptable: M-1 no distinct authorization, M-5 derived eligibility, C-6 Stripe-hosted declines | V1 |

### 3.4 Owner decisions

The decisions that freeze the scope are in the card (§9.3, FD-A..FD-J). The full list:

| ID | Decision | Source |
|---|---|---|
| G3-01 | Channel and fallback per MPS §10 group | NM-1 (FD-C) |
| G3-02 | Reminders and quiet hours (DEC-2026-010 keeps timing inactive) | NM-1 |
| G3-03 (rest) | Stop any admin producer? | NM-1; DEC-2026-068 |
| G3-04, G3-05 (homeowner) | Cancellation notice duplication; free text to homeowners | NM-1 (FD-C) |
| G3-06 | Notification retention class | NM-1 |
| G3-08 | What the MPS §8 test notification is | NM-1 |
| G3-09 | Decommission the legacy Edge function | NM-1 |
| 7.5D F-1 | Recipient and destination of the reply notice | 7.5D §4 (FD-C) |
| D-1 | Confirm the analytics layer split | AC-1 |
| D-3 | Auth handoff covered by the 2026-11-19 approval? | AC-1 |
| D-6 | Operator measurement surface | AC-1 (PD-6) |
| OD-3 | Eligible-pool definition | OQ-1 §6.2 |
| OD-4b | "Sourced" outcome | OQ-1 §6.3 |
| OD-5 (external) | Alert channel and named recipient | OQ-1; DEC-2026-068 (FD-A) |
| OD-6, CR-3 | Thresholds, sourcing deadline, queue priority | OQ-1 (PD-11) |
| OD-7 | Delegated operations owner | OQ-1 (R1 gate, not Phase 7) |
| AG-1 | Two hosted admin users against DEC-2026-025 | #221 only |
| EO-1..EO-8; backup operator | Email activation | Checklist §2, §7 (FD-H) |
| MTS §15 item 6; MTS §14 | Error and uptime approach; service objectives | MTS (FD-D) |
| 7.5F-2 D-1 | Accept page gaps G-1..G-4 as known limits? | 7.5F-2 record |
| TRACE-139 | Purge already-collected events; re-issue invitations opened since 2026-11-02 | TRACE-139 |
| CR-1 | Gate evidence | This proposal (FD-F) |
| CR-2 | CFG-011 log meaning and mechanism | This proposal (FD-E) |
| CR-4 | Superseded checks | This proposal (PD-7) |
| CR-5 | Phase boundary | This proposal (PD-10) |
| CR-6 | Retention class for tracked contact submissions | This proposal; DEC-2026-066 left it open |

### 3.5 Conditional enhancements

These are built only if a decision requires them. None is part of the minimum exit scope.

| ID | Enhancement | Condition |
|---|---|---|
| CE-1 | Intake auth-handoff event (A-16) | D-3 = yes |
| CE-2 | Owner-email queue (Q-13) row in the overview | Codex rules it inside TRACE-136 A8 (then it becomes required), or the owner wants it |
| CE-3 | Unpaid scheduled one-time job queue item (OQ-1 G-4) | Ruled part of Q-04 before payments activate |
| CE-4 | SLA page gaps G-1..G-4 | 7.5F-2 D-1 not accepted |
| CE-5 | 7.3E suppression wiring | A status-email or marketing sender is approved (EO-4, EO-5, EO-8) |
| CE-6 | 7.3F resend after proven non-delivery | Codex EC-10 lifted after V4 evidence |
| CE-7 | T-7 controlled sends (application, price draft) | EO-6 extended |
| CE-8 | Derived first-response lateness reporting | DEC-2026-069 P-4 (approved deferral) lifted |
| CE-9 | SLA scan scheduler | DEC-2026-069 OD-2 revisited |
| CE-10 | "Sourced" outcome | OD-4b chooses (b) or (c) |
| CE-11 | Reminders | G3-02 approves any |

### 3.6 Phase 8 security work

| ID | Item | Note |
|---|---|---|
| P8-1 | Notification table hardening: recipients may UPDATE any column; admins may INSERT any row without audit; no dedupe key | MPS §10 says messages are "auditable", so the owner may keep this in Phase 7 (PD-10) |
| P8-2 | Decommission the legacy `vendor-application-notify` Edge function. It accepts any valid project JWT and mails the team inbox | Its deployed state is checked in TV-5. Decommissioning is a hosted action (G3-09) |
| P8-3 | Keep `record_match_offer` detached ("respond within 24 hours", conflicts with CFG-009) | Hosted trigger state checked in TV-5 |
| P8-4 | Public-form abuse and upload-volume alerts; auth-failure metrics | MTS §11 detective controls |
| P8-5 | Roadmap Phase 8: CSP and headers, CI gates (axe, visual, drift), preview data isolation, restore drills, RPO/RTO, payment replay, rollback drill, alert drill (needs Phase 7's alert outcome), incident runbooks, secret-rotation runbook | Roadmap Phase 8 |
| P8-6 | Intermittent browser failures `mds.spec.ts:50`, `mds.spec.ts:108`, `request.spec.ts:837` | CI gates |

---

## 4. Alert outcome and channel options

### 4.1 What authorities say

- **Roadmap gate:** the "correct alert".
- **MTS §10, webhook step 7:** "Alert and expose replay for repeated failures."
- **MTS §11:** lists webhook lag, failure and dead-letter alerts, and uptime checks, as detective controls.
- **MTS §14:** "page an accountable owner" for abuse, reconciliation drift and backup failure. These are proposed objectives that need owner approval.
- **CFG-010:** the project owner is the escalation owner.
- **CFG-015:** quote and payment thresholds produce "queue items only … no … reminder or external message".
- **DEC-2026-068:** approves only the readback of existing admin notices. It does not approve new producers or external alerts.
- **DEC-2026-069:** an observation is not an alert; scans are manual.

No authority names a vendor. An external provider is therefore one option, not a requirement.

### 4.2 Required alert outcome (proposed definition, AO-1..AO-5)

- **AO-1. Trigger.** Every failure an authority requires to alert produces an alert at detection:
  - repeated or dead-letter webhook failures (MTS §10, §11);
  - SLA breach observations, for the rules the owner places in scope (FD-G).
- **AO-2. Record.** The alert is a durable record:
  - addressed to the accountable role (CFG-010 project owner, or admins the owner names);
  - deduplicated per subject and rule;
  - linked to its queue item;
  - with acknowledgement recorded.
- **AO-3. No side effects.** An alert never changes business state. It is never a user communication.
- **AO-4. CFG-015 scope.** Failures governed by CFG-015 send no message outside the operations surface. FD-B decides whether the aged queue item is their correct alert.
- **AO-5. Manual scans.** Under DEC-2026-069, SLA breaches are detected when an operator scans. The alert is produced at scan time. Latency equals the scan interval, which no cadence sets (P-6). FD-G accepts that or sets a manual cadence in the runbook.

### 4.3 Classification of the staged failures

| SF | Failure | Alert required by | Proposed correct alert |
|---|---|---|---|
| SF-1, SF-2 | Quote thresholds | CFG-015 limits it | FD-B: (a) aged queue item; or (b) an internal alert record too |
| SF-3, SF-4 | Payment failure, unresolved outcome | CFG-015 limits it | FD-B |
| SF-5 | Unpaid recurring visit | DEC-2026-049 item 6 (visibility) | Queue item (no notice by decision); FD-B |
| SF-6 | Completion unanswered at 72 h | DEC-2026-006 escalation writes an admin notice when the batch runs. The batch is inactive (PD-1) | T-5 observation at scan (DEC-2026-069) plus the AO-1 alert, if T-5 is in scope under FD-G |
| SF-7 | Exhaustion | No threshold (OD-6) | Sourcing queue item; alert none until a deadline exists (PD-11) |
| SF-8, SF-9 | Support first reply (T-8) | DEC-2026-069 records T-8 | AO-1 alert at scan, if in scope under FD-G |
| SF-10 | Owner email `unknown` after 10 minutes | OQ-1: "the page is the alert" | Queue page attention count; AO-1 optional |
| SF-11 | Stripe dead-letter | **MTS §10 step 7** | **AO-1 alert required** |
| SF-12 | Summary | — | n/a |

### 4.4 Channel options (FD-A, owner decision)

| Option | What it is | New provider | Meets AO-1..AO-5 | Limits |
|---|---|---|---|---|
| 1 | In-app alert record (new admin notice producer, or a dedicated alerts table), shown on `/admin/notifications` and the overview | None | Yes, for business-queue failures | Needs DEC-2026-068 extended to new producers. The operator sees it only on opening the app. Nothing works if the app or database is down |
| 2 | Option 1, plus owner email for alerts marked urgent (SF-11 class), through the existing Resend sender with a durable ledger (7.2C pattern) | None (Resend in use) | Yes | Operational email (EO-8). Delivery evidence stays dormant until V4 activation |
| 3 | An external monitoring service (MTS §15 item 6) for platform failures (errors, uptime), plus Option 1 or 2 for business-queue alerts | Yes (ADR) | Yes | Cost and privacy review; the only option that alerts while the application is down |
| 4 (uptime only) | An off-app check without a monitoring vendor: a scheduled job on existing CI, or a manual daily check recorded in the runbook | None | Uptime only | A scheduled job is automation and needs approval. A manual check is not a synthetic check in the MTS §11 sense, so the owner must accept it explicitly |

**Proposal, unapproved:** Option 1 is the smallest that meets AO-1..AO-5 for business failures. MR-6 (uptime) needs Option 3 or 4 whatever FD-A chooses.

---

## 5. Approved deferrals and approved "no action" rules (unchanged)

Only these have a recorded approval.

| Approval | Effect |
|---|---|
| **DEC-2026-069 OD-2, P-5, P-6** | **Manual SLA scans by any admin; no scheduler, no backfill, no cadence. Preserved by this proposal** |
| DEC-2026-069 P-4 | Derived first-response lateness reporting deferred |
| DEC-2026-054 items 3–4 (DEC-2026-060 D-6a) | Dispute resolution target after pilot data; no provider response deadline |
| DEC-2026-010 | Email and reminder timing inactive until separately configured |
| CFG-015 | Quote and payment thresholds: queue items only; no reminder or external message |
| DEC-2026-049 (NM-1 N-REC-04) | No notice for an unpaid recurring visit |
| DEC-2026-063 | No automatic offer-terms timeout; in-app notices |
| 2026-09-13 item 4 ([PHASE-5-EVIDENCE-RENEWAL](PHASE-5-EVIDENCE-RENEWAL.md)) | No automated renewal notice |
| DEC-2026-026 | Dark mode deferred to TRACE-106 |
| DEC-2026-022 (R1 gate) | Credits, and any Credits notice, arrive at R1 |
| Owner instruction 2026-11-21 | T-6 blocked unless its preconditions already hold |

Not deferrals: DEC-2026-068's non-approval of external alerts; MPS §2's pilot-baseline statement (OD-6 is open); and the "later slice", "7.6", "Category 4", "T-7 deferred" and EC-10 notes. PD-1..PD-11 (§9.2) are **proposals** and are not in this table.

---

## 6. Characterization tests versus acceptance tests (unchanged)

### 6.1 Characterization (demonstrates missing behavior; proves nothing required)

| Test | Pins |
|---|---|
| SQL 128 SF-1..SF-11, alert column | No alert anywhere |
| SQL 128 SF-7 | No homeowner message. Its "queue item: none" predates the sourcing reader (not called). SD-1 overlap with `blocked_inactive` |
| SQL 128 SF-8 / SF-8c | No support acknowledgement; same-day branch reads wall-clock time (SD-2) |
| SQL 128 SF-11 | Dead-letter creates a finance exception and no alert |
| SQL 128 SF-6b | Escalation runs only when the batch is invoked |
| SQL 053, 074, 095 (count-only) | Rows written; recipient and isolation unasserted |

### 6.2 Acceptance (proves required behavior; local or CI unless marked)

| Requirement | Tests |
|---|---|
| Summary truth (TRACE-136 A8; DF-1, DF-2) | SQL 127; `admin-operations.spec.ts`; SQL 128 SF-12 |
| Support first reply (CD-1; DF-3) | SQL 129; SQL 128 SF-9; `support.spec.ts` |
| Vendor readback; DEC-2026-063 producers | SQL 119; `vendor-notifications.spec.ts`; offer-terms concurrency C16, C17; SQL 116 gate-off rows |
| Admin readback (DEC-2026-068) | SQL 130; `admin-notifications.spec.ts`; two unit suites |
| Owner-email ledger (MTS §5; DEC-2026-066) | SQL 120; `owner-email-concurrency.mjs`; `owner-emails.spec.ts`; unit |
| Application tracing and redaction (7.1 paths only) | Unit `application-notification-tracing`; `application-notification-concurrency.mjs` |
| Email evidence, dormant | SQL 121–126; arming concurrency; `email-evidence-*.spec.ts`; unit. **No hosted receipt or inbox evidence** |
| SLA observation (DEC-2026-069) | SQL 131, 132; two concurrency scripts; `admin-sla-observations.spec.ts`; unit. **No hosted scan** |
| Applications and sourcing queues | SQL 133, 134; parity script; `admin-sourcing.spec.ts`; unit |
| PostHog trigger contract | 7.4B and 7.4C tests; `posthog.pw.ts`; unit `analytics-redaction` |
| Queue readers Q-02..Q-11 | SQL 039–050, 090, 097, 098, 101, 103, 108, 116, 117 |
| **Hosted** | HQ-2 at `41d34ec`, single snapshot, eleven rows in parity; sourcing had zero items (#221 only). Codex HV of the 7.5D definitions (2026-11-24). Nothing else |

---

## 7. Five workstreams and proposed packages

**Planning proposal only.** Packages are not approved and are not commitments. Each needs its own owner instruction; one with a migration needs the hosted push before merge (DEC-2026-037). Related changes are consolidated where they share a lane and risk. **Matcher changes (M2) and money-fingerprinted functions (PD-4's package) stay in packages of their own.**

### 7.1 Communications

| Package | Content | Type | Depends on |
|---|---|---|---|
| **C1** Notification evidence | TV-1 producer assertions and TV-2 homeowner UI acceptance. Current text pinned as characterization of G3-05 | Tests only | — |
| **C2** Required communications and notice fixes | Producers for the pre-R1 groups where FD-C's channel needs one (support acknowledgement; submission and coverage outcome). G3-05 homeowner free text. 7.5D F-1. **Non-matcher, non-money functions only**: anything in either fingerprint moves to M2 or PD-4's package | Code, migration | FD-C |

### 7.2 Observability

| Package | Content | Type | Depends on |
|---|---|---|---|
| **O1** Structured-log coverage | MR-4: the 11 routes and two helpers on `mercurius.oplog.v1` with correlation IDs; repository check against direct `console.*` in `src/app/api` | Code, no migration | — |
| **O2** Alert outcome | MR-1: AO-1..AO-5 on the FD-A channel for SF-11 and the FD-G rules; FD-B outcome for CFG-015 scenarios | Code, migration | FD-A, FD-B, FD-G |
| **O3** Error reporting, uptime, log retention | MR-5..MR-7. One package if FD-D and FD-E pick one mechanism; split otherwise | Configuration, code or runbook | FD-D, FD-E, O1 |

### 7.3 Measurement gaps

| Package | Content | Type | Depends on |
|---|---|---|---|
| **M1** Audit completeness | TV-4: MPS §9 field table with characterization tests; gaps go to the owner | Documentation and tests | — |
| **M2** Matcher package (isolated) | MR-8 exhaustion event; the N-REQ-04 producer if FD-C requires one in the matcher; MR-9 pool record only if PD-5 is rejected. Matching and money fingerprint review | Code, migration | Codex ruling on event shape; FD-C; OD-3 if MR-9 is included |

### 7.4 Operational verification

| Package | Content | Type | Depends on |
|---|---|---|---|
| **V1** Review and record reconciliation | DR-1..DR-9, TV-12 | Review and documentation | Codex |
| **V2** Operator runbooks | MR-10: one per OQ-1 queue (Q-01..Q-14), owner-email and email-evidence recovery and shutdown, SLA scan and purge, the alert response (after O2). Every step cites an authority; no new policy | Documentation | Optional M1; O2 for the alert section |
| **V3** Current-release verification | TV-5, TV-6, TV-9, TV-10, TV-11, TV-13 | Hosted read-only, owner-authorized | V1 (so the dispositions are known); O1 for TV-10 |
| **V4** Email activation run | TV-7 | Hosted actions per checklist | FD-H |
| **V5** First production SLA scan | TV-8 | Hosted, owner-authorized | — |

### 7.5 Final acceptance

| Package | Content | Type | Depends on |
|---|---|---|---|
| **F1** Gate acceptance | TV-3: SF-1..SF-12 plus an SF-13 sourcing entry, asserted against the approved outcomes. Local/CI only, per FD-F | Tests | O2, C2, M2 (if it carries N-REQ-04), FD-B, FD-C |
| **F2** Closeout record | Evidence index for X-1..X-8, the approved deferrals as recorded, and the owner's acceptance card | Documentation | All of the above |

Total 14 packages:
- 6 code or test (C1, C2, O1, O2, M2, F1);
- 1 configuration or code (O3);
- 4 documentation (M1, V1, V2, F2);
- 3 hosted operations (V3, V4, V5).

PD-4's money-function package exists only if PD-4 is rejected. Conditional enhancements (§3.5) add packages only if their condition is met.

### 7.6 Dependency order

```text
Decision-free now:   O1   C1   M1   V1   V5
After FD-A/B/G:      O2 ──────────────┐
After FD-C:          C2   M2 (+ Codex ruling) ─┤
After FD-D/E + O1:   O3                ├─→ F1 ─→ F2 ─→ owner's Phase 7 acceptance decision
After FD-H:          V4                │
After V1 (+O1):      V3 ───────────────┘
After O2:            V2 (alert section; the rest can start now)
```

**Proposed first package (not authorized by this PR): O1.** It closes CFG-011's prohibition on personal data in logs for the 11 routes. It needs no decision and no migration, and O3 and TV-10 depend on it.

---

## 8. Phase classification

| Item | Classification | Basis |
|---|---|---|
| §3.1, §3.2, §3.3 rows | Phase 7 | Roadmap Phase 7 |
| §3.6 | Phase 8 (P8-1 may be kept in Phase 7: PD-10) | Roadmap Phase 8; MTS §11 |
| Scheduler activation; MTS §10 step 8 scheduled payment reconciliation | Booking-activation readiness (PD-1) | DEC-2026-003 sequence; payments inactive |
| Hosted payment, payout and Credits notice evidence; daily funnel and liquidity review | Phase 9 | Roadmap Phase 9; DEC-2026-022 |
| Numeric thresholds, sourcing deadline, extra priority rules | Pilot baseline (PD-11) | MPS §2 |
| §3.5 | Conditional | As stated |
| Dark mode on Phase 7 pages | TRACE-106 | DEC-2026-026 |

---

## 9. Scope-freeze decision card

**How to answer:** one dated response, naming each line with approve, reject or amend. An unnamed line is not decided. Approving the card freezes the scope. It does not authorize any package, hosted action, merge or activation, and it does not accept Phase 7.

### 9.1 Minimum required Phase 7 exit scope (proposed)

| Exit item | Content |
|---|---|
| **X-1 Gate** | Every staged failure SF-1..SF-12, plus SF-13 (sourcing entry), is asserted as acceptance against approved outcomes: correct alert (FD-A, FD-B, FD-G), queue item, audit event and user communication (FD-C). The evidence is local or CI tests, plus X-8's current-release verification, plus one admin-run production SLA scan under DEC-2026-069. **No scheduler** (PD-1). **No hosted staged failure that writes Production** (PD-2). The gate wording is unchanged |
| **X-2 Alerts** | AO-1..AO-5 implemented on the chosen channel for SF-11 and the FD-G rules. One owner-authorized test alert reaches the named recipient (HQ-6) |
| **X-3 Communications** | MPS §10 channel and fallback decided for all eleven groups (FD-C). Producers built for the pre-R1 groups where the chosen channel needs one. G3-05 (homeowner) and 7.5D F-1 resolved. TV-1 and TV-2 pass |
| **X-4 Observability** | O1 structured logs. Error reporting and uptime checks per FD-D. CFG-011 log retention per FD-E |
| **X-5 Email evidence** | V4 through H-1, H-2, H-7, H-10, T-1..T-5 and the header check. T-6 per PD-8 |
| **X-6 Measurement** | MR-8 exhaustion event (M2). D-1 confirmed. OD-3 and OD-4b decided. TV-4 done, with each MPS §9 gap fixed or explicitly decided |
| **X-7 Operations** | V2 runbooks adopted by the owner. AG-1 resolved |
| **X-8 Verification and records** | V3 current-release verification and regression evidence. Every merged Phase 7 code slice has a recorded Codex disposition (DR-1, DR-2). Historical checks recorded as not performed (DR-7). #221 resolved |

### 9.2 Proposed deferrals requiring owner approval (none approved)

| ID | Defer | To | Why | Risk accepted if approved |
|---|---|---|---|---|
| PD-1 | Lifecycle scheduler activation: `run_lifecycle_batch` (quote and offer expiry, completion notices, DEC-2026-006 escalation), HQ-3, HQ-4, and MTS §10 step 8 scheduled payment reconciliation | Booking-activation readiness (DEC-2026-003 sequence) | No Production traffic before R1. DEC-2026-069 manual scans cover breach observation | The T-5 escalation business action and the expiries run only on read or invocation until then |
| PD-2 | Hosted staged business failures and staged breaches that write Production (HQ-4, HQ-5 staged) | Phase 9 controlled beta | Preview and Production share one database (DEC-2026-037) | Phase 7's hosted evidence is read-only plus one scan and one test alert |
| PD-3 | Payment, refund and payout notice producers (MR-12); channels are still decided in FD-C | R1 readiness | Payments inactive; unreachable | Producers built later against a decided matrix |
| PD-4 | Money-fingerprinted and pre-R1-unreachable notice fixes: N-REQ-03 (`vendor_accept_job`), G3-04, G2-03. Wording decided now | R1 readiness, as one independently reviewed money-function package | Unreachable before R1; money-function risk | Conflicting copy stays in source until then |
| PD-5 | Eligible-pool record and matching version (MR-9); OD-3 is still decided now | R1 readiness, before the Phase 9 cohort | No Production matching before R1; matcher risk | No pool measure until then |
| PD-6 | Operator measurement dashboards (D-6; MPS "proposed dashboards") | Phase 9 setup | Phase 9 runs the daily reviews | The `/admin` overview and queues are the Phase 7 surface |
| PD-7 | Superseded release checks (§2.4): recorded as not performed and replaced by V3 | Disposition (not a deferral of verification) | Older deployments are unobservable | No claim about older deployments |
| PD-8 | T-6 renewal real email. Phase 7 relies on the renewal ledger acceptance (SQL 120) and T-5's shared-sender evidence | Until T-6's preconditions hold without changing the synthetic provider | Owner instruction 2026-11-21 | Renewal inbox delivery unproven |
| PD-9 | Notification retention purge job, if G3-06 classes notices as 3-year platform messages | When the first rows near expiry | No row could expire before 2029 | Recipient deletions continue under current RLS |
| PD-10 | Notification table hardening (P8-1) and legacy Edge decommission (P8-2) | Phase 8 security | Security suite | P8-1 leaves the MPS §10 "auditable" gap until then. The owner may keep it in Phase 7 |
| PD-11 | Thresholds for queues with none, the sourcing deadline (MPS §9 "by deadline") and queue priority beyond CFG-010 (OD-6, CR-3) | Pilot baseline (MPS §2) | No baseline data | Sourcing has no deadline; SF-7 has no alert |

### 9.3 Decisions that freeze the scope

| ID | Decision | Options |
|---|---|---|
| FD-A | Alert channel and named recipient; extend DEC-2026-068 to the new alert producer | Option 1, 2 or 3 (§4.4) |
| FD-B | CFG-015 scenarios SF-1..SF-5 | (a) the aged queue item is the correct alert; (b) an internal alert record as well |
| FD-C | MPS §10 matrix (G3-01) for all eleven groups; G3-04; G3-05 homeowner; 7.5D F-1 | Per group: on-screen state only, in-app notice, email, or several. Exhaustion and submission outcome may be "on-screen state", making C2 smaller |
| FD-D | Error reporting and uptime (MTS §15 item 6; MTS §14 objectives) | Option 3 provider; Option 4 off-app check; error reporting via structured logs and a runbook query |
| FD-E | CFG-011 logs (CR-2) | 90 days as a minimum, a maximum, or both; host retention or a drain |
| FD-F | Gate evidence (CR-1) | Accept X-1 as written, or name the hosted checks to add |
| FD-G | Which DEC-2026-069 rules alert (T-3, T-4, T-5, T-8, T-10), and the latency under manual scans | Any subset; scan-time alerting with no cadence, or a manual cadence in the runbook |
| FD-H | EO-1, EO-2 (with the backup operator), EO-3, EO-6, EO-7; confirm EO-8; EO-4/EO-5 stay open | Checklist §7 card |
| FD-I | D-1, OD-3, OD-4b, AG-1, CR-6, G3-06, G3-08, G3-09, D-3, 7.5F-2 D-1, TRACE-139 | As in §3.4 |
| FD-J | PD-1..PD-11, each individually | Approve, reject or amend |

### 9.4 Acceptance evidence

| Exit item | Evidence that closes it |
|---|---|
| X-1 | F1 passing in CI on the release commit; V3 on that commit; the V5 scan readback; each SF row cites its authority |
| X-2 | O2 tests (dedupe, addressing, acknowledgement, no side effects); the HQ-6 test-alert readback on the chosen channel |
| X-3 | The FD-C record; C1 and C2 tests; SF-7 and SF-8 communication columns flipped deliberately in F1 |
| X-4 | O1 redaction and repository tests; TV-10 log readback; O3 configuration readback and the runbook procedure |
| X-5 | Checklist §4 evidence classes [P], [O], [L], [R], [I] for each step; header check |
| X-6 | The M2 event test and fingerprint review; the M1 table; the decision records |
| X-7 | Runbooks merged; the owner's adoption recorded; the AG-1 decision |
| X-8 | The V3 record; the V1 disposition table; DR-7 notes |

### 9.5 Remaining packages and dependencies

§7: 14 proposed packages. Five need no policy decision: O1, C1, M1, V1, and V5 (which still needs hosted authorization). The money-function package exists only if PD-4 is rejected; conditional enhancements only if their condition is met.

---

## 10. Carried unchanged

- A2 human verification on every Phase 7 page.
- The final booking-candidate schema, grants, fingerprint and completion-integrity checks.
- Gates off.
- The Phase 6 verification exceptions.
- No booking, payment, scheduler, email activation or feature switch is authorized.

## 11. Validation

| Check | Result |
|---|---|
| Diff | Documentation only: this file (replacing the first revision's `PHASE-7-CLOSEOUT-REGISTER.md` on this unmerged branch), the TRACE-162 row and the HANDOFF entry |
| Sources | Merge history and `gh` PR lists; all Phase 7 records on `main` and #221; comments and reviews on PRs #162–#222; source at `41d34ec` for the logging count |
| Not performed | Any hosted, Vercel, Supabase, Resend or PostHog read; any test run |
| Secret scan | See the PR body |

---

## Appendix A. Crosswalk from the first revision

Every first-revision ID maps to a place here. None is dropped.

| First revision | Here |
|---|---|
| N-1 | MR-3, FD-C |
| N-2, N-3, N-4 | §6.2 evidence; DR-1 (7.2B, 7.5E repair); TV-5 |
| N-5 | §6.2; DR-1 (#167); TV-7 |
| N-6 | TV-1 |
| N-7 | TV-2 |
| N-8, N-9 | MR-11; PD-4 |
| N-10 | MR-2, MR-3 |
| N-11 | CE-11; DEC-2026-010 (§5) |
| N-12 | MR-12; PD-3 |
| N-13 | §5 (DEC-2026-022) |
| N-14 | TV-5 |
| N-15 | P8-1; PD-10 |
| N-16, N-17 | MR-11; FD-C |
| N-18 | FD-H (EO-8); CE-5 |
| N-19 | G3-06; PD-9 |
| N-20 | G3-08 |
| N-21 | TV-5; P8-2 |
| E-1 | §6.2; DR-1 (7.4C, #182); TV-11 |
| E-2 | CE-1 |
| E-3 | FD-I (D-1) |
| E-4, E-9 | MR-9; PD-5 |
| E-5 | MR-8 |
| E-6 | CE-10; FD-I (OD-4b) |
| E-7 | DR-9 |
| E-8 | TV-4 |
| E-10 | PD-6 |
| E-11 | TV-11; FD-I |
| Q-1, Q-2 | DR-1; TV-5; CE-2 |
| Q-3, Q-5, Q-9 | PD-11 |
| Q-4 | TV-8; CE-4 |
| Q-6 | MR-1; §4 |
| Q-7 | §6.2 evidence |
| Q-8 | FD-I (AG-1); OD-7 |
| Q-10 | CE-3 |
| Q-11 | TV-12 |
| O-1, O-2 | MR-5, MR-6 |
| O-3, O-4 | MR-4 |
| O-5 | MR-7 |
| O-6 | MR-1 |
| M-1 | DR-1 (#167) |
| M-2..M-5 | TV-7 |
| M-5 (T-6) | PD-8 |
| M-6 | FD-H |
| M-7 | CE-5 |
| M-8 | CE-6 |
| M-9 | TV-13 |
| R-1 | MR-10 |
| R-2 | TV-4 |
| R-3 | P8-1 |
| R-4 | P8-5 |
| G-1 | TV-3; MR-1; MR-2 |
| G-2 | TV-8; MR-1; FD-G |
| G-3 | PD-2; FD-F |
| CR-1 | FD-F |
| CR-2 | FD-E |
| CR-3 | PD-11 |
| CR-4 | PD-7 |
| CR-5 | PD-10 |
| CR-6 | FD-I |
| P7-01 … P7-16 | O1 (P7-01); C1 (P7-02, P7-03); M1 (P7-04); V2 (P7-05); CE-2 (P7-06); M2 (P7-07, P7-15 if PD-5 is rejected); P8-1 / PD-10 (P7-08); O3 (P7-09, P7-10); O2 (P7-11); C2 and M2 (P7-12); C2 and PD-4 (P7-13); PD-3 (P7-14); F1 (P7-16) |
| P7-C1 … P7-C4 | CE-5, CE-4, CE-3, CE-1 |
