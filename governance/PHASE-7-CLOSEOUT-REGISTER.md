# Phase 7 closeout register (TRACE-162)

**Status:** DOCUMENTATION ONLY. **NOT PHASE 7 ACCEPTANCE.** This register approves no policy, records no deferral the owner has not approved, and authorizes nothing: no code, migration, hosted query or action, merge, deployment, automation, email activation, booking or payment change.
**Checkpoint:** `main` `41d34ec` (#220 merge, 2026-11-28 18:01:53 UTC), fetched 2026-11-28 (America/New_York).
**Open PR at checkpoint:** #221 (documentation only, 7.5G-2 post-merge record). It is not on `main`. Evidence that exists only there is labelled "#221 only".
**Method:** `git` and `gh` only, plus reading every Phase 7 record on `main`. No hosted, Vercel, Supabase, Resend or PostHog call. Each status below comes from the merge history and the latest dated note in each record, **not** from a record's header line. Many header lines were written before their PR merged and are stale (§2.2).
**Authority:** the owner's closeout-register instruction (2026-11-28 ET). Roadmap Phase 7 scope and gate ([roadmap](../roadmap/MERCURIUS-REBUILD-ROADMAP.md) §4). MPS §8–§13, MTS §5, §7, §10, §11, §14, §15, CFG-006/009/010/011/015, the decision log, and the Phase 7 contracts: [notification](PHASE-7-NOTIFICATION-CONTRACT.md) (NM-1), [analytics](PHASE-7-ANALYTICS-COVERAGE-CONTRACT.md) (AC-1), [operations queues](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1), [email activation checklist](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-ACTIVATION-CHECKLIST.md).

---

## 0. Summary

1. **The Phase 7 gate is not met.** The gate requires that "staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication". Queue items and audit records exist and are tested locally. No alert exists, for any scenario. Two required communications are missing (exhaustion and support acknowledgement). SLA breaches are recorded only when an operator runs a manual scan, and no breach raises an alert. The only staged-failure test file (SQL 128) is characterization: it pins these gaps (§5).
2. **Every Phase 7 code PR through #220 is merged and therefore deployed** (DEC-2026-037). Merging is not review. **Fifteen merged code slices have no recorded Codex review outcome for their final code**, including the 7.5G-2 sourcing queue (§2.1, track V-1). Most post-merge READY readbacks and the owner's HQ-1 checks are outstanding.
3. **Of the six roadmap work lines, none is complete.** Notifications, events and queues are substantially built. Observability (error reporting, uptime, log retention) is mostly missing. Email delivery evidence is built but dormant: none of the activation decisions EO-1..EO-8 is approved. No operator runbook exists (§3).
4. **Remaining work, bounded: 16 implementation slices, plus at most 4 conditional ones (≤ 20)** (§7):
   - 6 slices need no owner decision;
   - 2 need a Codex technical ruling first;
   - 8 are blocked on owner decisions.

   Separately, four non-code tracks cover reviews, release verification, the email activation run and the owner decision card.
5. **Next implementation slice: P7-01, structured-log coverage.** Eleven of eighteen API routes log raw error objects with `console.*`, outside the allowlisted `mercurius.oplog.v1` logger. CFG-011 prohibits secrets and unnecessary personal data in logs, and the roadmap requires PII-safe structured logs with correlation IDs. P7-01 needs no owner decision, no migration and no hosted action, and it is a precondition for the CFG-011 retention slice (§7.2).
6. **Critical-path owner decisions** (§6):
   - **OD-5 external channel** and **MTS §15 item 6** (error/uptime provider): every alert, and so the gate.
   - **G3-01** (MPS §10 channel and fallback): the missing user communications.
   - **EO-1/2/3/6/7:** email activation and domain-authentication evidence.
   - **CR-1** (new, §6.1): what evidence closes the gate.
   - **CR-2** (new): what CFG-011's 90 days means for logs.
   - **OD-3:** the eligible-pool definition.
7. **Explicitly approved deferrals are few** (§4). "Later slice", "7.6", "Category 4" and "deferred" labels in records are scheduling notes or Codex technical directions. They are not owner deferrals, and this register does not treat them as such.

---

## 1. Baseline verified

| Item | Observation (2026-11-28 ET) |
|---|---|
| `origin/main` | `41d34ec`: #220 (7.5G-2 sourcing queue) merge |
| Open PRs | #221 only (documentation; 7.5G-2 post-merge record; head on `claude/phase7-5g2-post-merge-record`) |
| Phase 7 authorization | Owner, 2026-11-10 ([PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md)). Engineering only: booking, private beta, payments and feature switches are not authorized |
| Phase 7 migrations on `main` | `20261122001000`, `20261123001000`, `20261124001000`, `20261125002000`, `20261127001000`, `20261128001000`, `20261129001000`, `20261130001000`, `20261202001000`, `20261203001000`, `20261204001000`, `20261205001000`, `20261206001000` (13). `20261201001000` is TRACE-160 (commission) and `20261125001000` / `20261126001000` are TRACE-156; they are outside Phase 7 |
| Hosted | Not queried by this register. Hosted facts below are cited from the dated records that observed them |
| Feature gates | `offer_terms` and `promotions_checkout` off per the latest records; R0 admission default-closed. Request, quote, payment, fulfillment and payout queues should therefore receive no Production items (OQ-1 X-7). Not queried |

---

## 2. Release and review ledger

### 2.1 Per slice

"Review" means a recorded Codex review **outcome** for the merged code, found in a record, TRACEABILITY or HANDOFF on `main`. "Not recorded" means none was found by search. It does not mean that no review happened.

| Slice (TRACE) | PR → `main` | Migration and hosted state (as recorded) | Codex review on record | Release verification outstanding |
|---|---|---|---|---|
| 7.1 tracing and oplog (151) | #162 → `11c05b0` | none | Earlier head reviewed; follow-up addressed. **Re-review of final head not recorded** | Preview/production log readback never done |
| 7.2A notification contract (152) | #163 → `f205b59` | docs | Earlier-head findings addressed (contract §14). Final review not recorded | — |
| 7.2B vendor readback (153) | #164 → `3eb8ff4` | none | **Not recorded** (the "retrospective 7.2B review" is carried in every later record) | No hosted readback; A2 human checks |
| 7.2C plan (154) | #165 → `9b487bf` | docs | Reviewed: C-1..C-8; O-1 → DEC-2026-066 | — |
| 7.2C-1 contact ledger (154) | #166 → `24dd455` | `20261122001000` pushed | Reviewed ([release checkpoint](PHASE-7-OWNER-EMAIL-LEDGER-CODEX-REVIEW.md)) | Production READY recorded. Real-email verification open |
| 7.2C-2 renewal ledger (154) | #167 → `8a9603b` | `20261123001000` pushed 2026-11-13 | **Not recorded** (readiness O-9) | READY and renewal-window reconciliation (O-9); real email |
| 7.3A plan (155) | #168 → `bc51c3d` | docs | Reviewed (5891386779, 5891897514) | — |
| 7.3B dormant receiver (155) | #169 → `e25e7f8` | `20261124001000` on hosted; push provenance missing (O-5) | Retrospective 5926513941, no blocking finding | O-4 503 probe; O-6 |
| 7.3C-1 owner-email tags (155) | #180 → `9e7fd39` | `20261125002000` pushed 2026-11-19 | 5985392153, no blocking finding | READY done (O-8). O-1, O-3 operator-session checks |
| 7.3C-2 application and price-draft tags (155) | #181 → `d44342b` | `20261127001000` pushed before green CI and review | 5995373396, no blocking finding | READY done (O-8). O-2, O-3 |
| 7.3D-1 arming and probes (155) | #184 → `8a40fa4` | `20261128001000`; push provenance open | Readiness review 5997315152 | — |
| 7.3D-1 review fixes (155) | #185 → `96c8149` | `20261129001000` pushed 2026-11-21 | F-1..F-6 accepted | READY read 2026-11-21 |
| 7.3D checklist revisions (155) | #186, #188, #189 | docs | Reviewed (R-1..R-5; third-revision corrections) | Step-3 operator evidence pending; owner card unanswered |
| 7.3D-2 purge control (155) | #187 → `ffd8bfb` | none | D-1, D-2, D-4, D-5 accepted. **Re-review of the D-3 correction not recorded** | READY read 2026-11-21 (checklist §1.1) |
| 7.4A analytics contract (158) | #190 → `0f48cff` | docs | Not recorded | — |
| 7.4B trigger tests (158) | #191 → `aab602b`; #193 docs | tests | Retrospective, no blocking issue | — |
| 7.4C once per draft (158) | #194 → `83c8fea` | none | **Not recorded** (R-1..R-9) | — |
| PostHog analytics (157) | #182 → `c5e24cf` | none | **Not recorded** | Browser acceptance and activation tracked in PR #182 and Vercel history |
| Web Analytics redaction (139) | #138 → `b7b0d08` | none | **Not recorded** | Hosted readback; owner decisions (purge collected events, re-issue invitations) |
| 7.5A queues contract (159) | #196 → `ebc7de5` | docs | Reviewed (RV-1..RV-5 applied) | — |
| 7.5B summary truth (159) | #197 → `126c85f` | `20261130001000`; push recorded on #197, not re-verified | **Not recorded** (R-1..R-7) | READY for `126c85f` not verified; HQ-1/HQ-2 at that commit not done (CR-4) |
| 7.5C staged-failure characterization (159) | #199 → `aeb20e4` | tests | **Not recorded** (R-1..R-6) | — |
| 7.5D support first reply (159) | #201 → `dcc62e1` | `20261202001000` found on hosted by the 7.5F-1 dry run; applier unrecorded | **Not recorded** (D-1..D-4) | READY |
| 7.5E admin readback (159) | #202 → `afa0be8`; repair #203 → `01a5dd1`; #204 → `846dd34` | none | D-1..D-7 accepted subject to F-1/F-2. **Re-review of the #203 repair not recorded** | READY for `01a5dd1`, `846dd34` |
| 7.5F plan (159) | #207 → `80100d3` | docs | Technically clear (revision 4) | — |
| 7.5F-1 SLA ledger (159) | #208 → `89973fa`; repair #211 → `5cfe5b0`; #212 docs | `20261203001000` pushed 2026-11-26; `20261204001000` found on hosted (applier unrecorded), readback matched | F208-1 found and repaired. **Review of I-1..I-15 and of the repair (R-1, O-1) not recorded** | READY. First hosted scan and purge not authorized |
| 7.5F-2 SLA page (159) | #213 → `e3a12a1` | none | **Not recorded** (I-1..I-13, G-1..G-4, D-1..D-3) | — |
| 7.5G plan (159) | #214 → `294eb22` | docs | R-1..R-5 accepted (conversation) | — |
| 7.5G-1 applications queue (159) | #215 → stacked base; released by #217 → `1e97f95`; #216 docs | `20261205001000` pushed 2026-11-27 (recorded, not re-verified) | **Not recorded** (I-1..I-6) | READY, HQ-1, HQ-2 for `1e97f95` not observed and probably no longer observable (CR-4) |
| 7.5G-2 plan (159) | #218, #219 | docs | Revision 2 technically clear; SG-9 accepted | — |
| 7.5G-2 sourcing queue (159) | #220 → `41d34ec`, merged **before** Codex review and before any recorded push | #221 only: `20261206001000` found on hosted, readback matched, applier unrecorded | **Not recorded** (I-1..I-10) | #221 only: HQ-2 pass (eleven rows, sourcing had zero items); READY observed but not independently verified; HQ-1 and manual `/admin/sourcing` pending the owner; AG-1 open |

### 2.2 Stale header lines

These records' **Status** lines still say "not merged" or "draft". Each merged as shown in §2.1. Records are left unchanged here; the dated notes and this ledger govern.

7.1 tracing; 7.2B vendor readback; 7.2C-2; 7.3B; 7.3C-1; 7.3C-2; 7.3D-1; 7.3D-1 review fixes; 7.3D-2; 7.4C; 7.5B (§8 reconciles); 7.5C; 7.5D; 7.5E (line 6 reconciles); 7.5F-1 (line 4 reconciles); 7.5F-2; 7.5G-2 (on `main`; #221 corrects it). The AC-1 statement that SLA breach (O-2) is "MISSING — DEFERRED" is superseded by 7.5F (§3.2 E-8).

---

## 3. Requirement register

Columns:
- **Evidence on `main`:** what is built, and the test that proves it.
- **Review / verification outstanding:** work that needs no new code.
- **Missing implementation:** code that does not exist.
- **Owner decision:** an open decision that blocks the item.
- **Approved deferral:** only with a cited approval. "—" means none exists.

### 3.1 Roadmap line 1: "Implement the approved notification matrix and consent distinctions"

Governing: MPS §10 ("Define a required channel and fallback for" eleven groups; idempotent, auditable, privacy-safe, consent-governed), MPS §5.6, MTS §5, §6. Matrix: NM-1 (TRACE-152).

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| N-1 | The approved matrix itself | NM-1 characterizes 33 in-app producers and 6 email/Auth paths. **It is a characterization, not an approved matrix** | Final Codex review of NM-1 | The approved channel and fallback per MPS §10 group | **G3-01** | — |
| N-2 | Vendors can read their notices (G1-01) | 7.2B `/vendor/notifications`; SQL 119 part A; `vendor-notifications.spec.ts`; unit presentation, keyset and destination tests. DEC-2026-065 | Retrospective 7.2B review; A2; hosted readback | — | — | — |
| N-3 | DEC-2026-063 producer evidence (G2-01) | SQL 119 part B, including gate-off semantics; `offer-terms-concurrency.mjs` C16, C17 | As N-2 | — | — | — |
| N-4 | Admin notices readable (G3-03 in part) | 7.5E `/admin/notifications`; SQL 130; `admin-notifications.spec.ts`; DEC-2026-068 | #203 re-review; READY | — | Whether to stop any admin producer (rest of G3-03) | — |
| N-5 | Durable owner-email attempts (G1-02) | 7.2C-1/2 ledger; SQL 120; `owner-email-concurrency.mjs`; `owner-emails.spec.ts`; DEC-2026-066 | #167 review (O-9); real-email verification (needs V-3 T-5; T-6 is blocked) | — | — | — |
| N-6 | Producer assertions for untested events (G2-02): N-FUL-01/03/04, N-FUL-09/10, N-QTE-02/06, N-CXL-03/05/06, N-REC-02/03, N-SUP-03, N-APT-02/03 | Producers exist; several have count-only or no assertions | — | Acceptance tests (P7-02) | — | — |
| N-7 | Homeowner bell and `/notifications` UI (G2-04) | Page has loading, empty, error/retry, mark read, mark all and realtime notice. **No browser test** | — | Browser acceptance tests (P7-03) | — | — |
| N-8 | CFG-006 boundary and waiver notices agree with the policy outcome (G2-03) | Notices are silent on refund outcome | — | Consistency tests or copy (P7-13) | G3-04, G3-05 copy policy | — |
| N-9 | Conflicting acceptance copy (N-REQ-03, G2-05) | Copy names appointment details that may not exist. Function is in the money fingerprint | — | Reviewed restatement (P7-13) | Approved wording | — |
| N-10 | Absent events: exhaustion/consent (N-REQ-04), submission and coverage message (N-REQ-06), support acknowledgement, quote accepted (N-QTE-08) | Screen-only or none | — | Producers (P7-12) | G3-01 | — |
| N-11 | Reminders: offer expiry, quote expiring, confirmation reminder (N-REQ-02, N-FUL-05) | N-FUL-05 producer exists in the batch, inactive. Others absent | — | Producers and scheduler, if approved | G3-02; scheduler activation (DEC-2026-003 sequence) | DEC-2026-010: reminder timing stays inactive until separately configured. This is an approved inactive state, **not** a deferral of MPS §10 |
| N-12 | Payment, refund and payout notices (N-CXL-07/08) | Absent | Hosted evidence can only come at R1 (Phase 9) | Producers (P7-14) | G3-01 | — (payments are inactive; no owner deferral of these notices exists) |
| N-13 | Credits notices (N-CRD-01) | Absent; no Credits authority artifacts | — | — | — | Credits are R1-gated (DEC-2026-022 R1 gate); no notice can exist before Credits do |
| N-14 | Hosted parity of the notification table (G2-06): grants, policies, realtime publication, whether `record_match_offer` has a trigger | Local only | Owner-authorized read-only readback (V-2) | — | — | — |
| N-15 | Notification table integrity: recipients may UPDATE any column, admins may INSERT any row without audit, no dedupe key (NM-1 §7.4) | RLS as characterized | — | Hardening migration (P7-08) | — | — |
| N-16 | Free text shown to homeowners (G3-05, homeowner side) | Operator and actor reasons go verbatim into homeowner notices | — | Depends on decision | G3-05 (homeowner) | — (vendor side answered by DEC-2026-065) |
| N-17 | Reply notice on provider- or operator-filed work items links the homeowner to a ticket they cannot open (7.5D F-1) | Recorded, not repaired | — | Repair (P7-13) | Recipient and destination | — |
| N-18 | Transactional vs marketing classification and consent | All current mail is transactional or operational. The R0 marketing choice is captured, but no marketing sender exists. The suppression ledger is not wired | — | Nothing until a marketing or status-email sender exists (P7-C1) | **EO-8** (confirm all current email is transactional); EO-4, EO-5 | — |
| N-19 | Notification retention class (G3-06) | No purge; recipients may delete their own rows | — | Depends on decision | G3-06 (is a notice a CFG-011 "platform message", kept 3 years?) | — |
| N-20 | MPS §8 "Test notification received" (G3-08) | Attestation only; nothing sends a test notice | — | Depends on decision | G3-08 | — |
| N-21 | Legacy `vendor-application-notify` Edge function (N-APP-06, G3-09) | No caller in `src/`. It accepts any valid project JWT and mails the team inbox | Deployed state unknown (V-2) | — | G3-09 (decommission is a hosted action) | — |

### 3.2 Roadmap line 2: funnel, liquidity, quote, checkout, fulfillment, dispute, refund, payout, quality and admin-override events

Governing: MPS §11 (families and dimensions), MPS §5.2, §6.2, DEC-2026-059, TRACE-157 approvals. Matrix: AC-1 (TRACE-158). Layer A is optional PostHog; layer B is the operational records.

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| E-1 | Layer A discovery, account and intake events (13 custom events, `$identify`, `$pageview`) | TRACE-157 consent-gated release; 7.4B call-site tests; 7.4C once per draft (D-2) | 7.4C review; PostHog production traffic never read | — | — | — |
| E-2 | Intake auth handoff (A-16) | Absent | — | One event, if approved (P7-C4) | **D-3** (does the 2026-11-19 approval cover it?) | — |
| E-3 | Layer split: lifecycle families measured from records, none sent to PostHog | Every later contract relies on it | — | — | **D-1** (owner confirmation) | — |
| E-4 | Eligible pool count (L-1) | **None.** The live matcher computes no count; only the superseded Phase 1 matcher did (OQ-1 §6.2) | — | Pool record (P7-15) | **OD-3** (definition) | — |
| E-5 | Exhausted (L-4) | State column and `needs_admin_review` only; no append-only event | — | Exhaustion audit event (P7-07) | — (needs a Codex ruling) | — |
| E-6 | Sourced (L-5) | No outcome. CFG-009 forbids claiming active sourcing | — | Depends on decision | **OD-4b** (proposal (a): none in beta, unapproved) | — |
| E-7 | Commercial, fulfillment, money and quality outcomes (C-2..C-6, F-01..F-05, M-1..M-6, Q-1..Q-5) | Recorded in layer B by Phase 4–6 commands. Partial: M-1 authorization is not a distinct record; M-5 eligibility is derived; C-6 Stripe-hosted card declines are not recorded locally | None reachable in Production before R1 | No slice proposed | Codex to confirm the partial rows are acceptable for layer B | — |
| E-8 | Operations: admin override (O-1), SLA breach (O-2), manual correction (O-3) | O-1 and O-3 recorded for the listed actions. **O-2 now recorded by 7.5F** (manual scans, five rules; SQL 131/132) | 7.5F-1/7.5F-2 reviews; first hosted scan | O-1: MPS §9 field completeness not characterized (P7-04) | — | DEC-2026-069 P-4: derived first-response lateness reporting **deferred**. P-5: no backfill |
| E-9 | MPS §11 dimensions: lifecycle, matching and policy versions | Not characterized. No matching version exists | — | With P7-15 | With OD-3 | — |
| E-10 | Operator measurement surface (MPS "proposed dashboards") | `/admin` overview and queue pages only | — | Depends on decision | **D-6** | — |
| E-11 | Web Analytics URL redaction (TRACE-139) | #138 merged | Codex review not recorded; hosted readback | — | Purge already-collected events; re-issue invitations opened since 2026-11-02 | — |

### 3.3 Roadmap line 3: "Create owned operational queues with age, priority, SLA, alert, and next action"

Governing: MPS §9, CFG-009/010/015, DEC-2026-045, DEC-2026-063, DEC-2026-069, DEC-2026-070. Matrix: OQ-1 (TRACE-159).

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| Q-1 | Server reader for all 14 families | Q-01..Q-13 each have a server reader (Q-09 through the support reader); Q-14 is an aggregate. Q-01 sourcing (7.5G-2, SQL 134) and Q-12 applications (7.5G-1, SQL 133) were added in Phase 7 | 7.5G-1 and 7.5G-2 reviews; HQ-1 (owner) | — | — | — |
| Q-2 | Overview summary truthful (TRACE-136 A8) | DF-1, DF-2 repaired (7.5B, SQL 127). Applications and sourcing rows added. HQ-2 pass at `41d34ec` (#221 only) | 7.5B review; HQ-1 | Owner-email queue (Q-13) has no summary row (P7-06) | — | — |
| Q-3 | Age and SLA | T-1..T-11 is the complete list of approved timing rules (OQ-1 §4). Aging is computed on read (DEC-2026-045 choice 8) | — | — | **OD-6** (thresholds for queues with none) | MPS §2: targets follow an instrumented pilot baseline (authority statement; OD-6 itself is undecided). DEC-2026-054 items 3–4 (DEC-2026-060 D-6a): dispute resolution target after pilot data; no provider response deadline |
| Q-4 | SLA breach recorded | 7.5F: append-only observations; detector over T-3, T-4 failure aging, T-5, T-8, T-10; 90-day logical retention; operator page `/admin/sla-observations` (DEC-2026-069) | 7.5F-1, F208-1 repair and 7.5F-2 reviews; first hosted scan and purge (separate authorizations) | Page gaps G-1..G-4, if not accepted as limits (P7-C2) | 7.5F-2 D-1 (accept G-1..G-4 as known limits?) | DEC-2026-069 OD-2: manual scans only, **no scheduler**; P-6: no cadence |
| Q-5 | Priority | Only CFG-010 same-day support routing and aged-first ordering | — | — | **CR-3** (new): no other priority rule is approved, but the roadmap requires one | — |
| Q-6 | Alert | **None.** No external channel and no error or uptime provider. Admin in-app readback exists (DEC-2026-068) but is not an alert | — | Alert producers (P7-11) | **OD-5** external channel and named recipient; MTS §15 item 6 | — (DEC-2026-068 explicitly does **not** approve external alerts) |
| Q-7 | Next action | Each queue has a command or follow-up path (OQ-1 §5.2) | — | — | — | — |
| Q-8 | Ownership | Project owner accountable (CFG-010). Only support stores an owner and assignee. Josh sole admin in R0 (DEC-2026-025) | **AG-1**: two hosted admin users against DEC-2026-025 (#221 only) | — | AG-1; **OD-7** delegated owner for R1 | DEC-2026-025 is an R0 exception, not carried to R1 |
| Q-9 | Sourcing deadline (MPS §9 "close transparently by deadline") | None. DEC-2026-070 description states "No sourcing deadline is set" | 7.5G-2 review | — | **OD-6** (sourcing deadline) | — |
| Q-10 | Unpaid scheduled one-time job (OQ-1 G-4) | In no queue; the start guard blocks unpaid starts | — | Queue item, if ruled in scope (P7-C3) | Definition (Codex/owner) | — |
| Q-11 | Staged-failure discrepancies SD-1 (exhaustion also listed as `blocked_inactive` while the gate is off) and SD-2 (same-day support branch reads `now()`) | Recorded in 7.5C, not repaired | Codex ruling | — | — | — |

### 3.4 Roadmap line 4: "Add error reporting, uptime/synthetic checks, PII-safe structured logs, and correlation IDs"

Governing: MTS §11 detective controls, MTS §14, MTS §15 item 6, CFG-011.

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| O-1 | Error reporting | None. No provider in `package.json` | — | Provider integration (P7-09) | **MTS §15 item 6** (error-monitoring and uptime provider ADR) | — |
| O-2 | Uptime and synthetic checks (marketing, login, API health, webhook health) | None | — | P7-09 | As O-1; MTS §14 objectives need owner approval | — |
| O-3 | PII-safe structured logs | `mercurius.oplog.v1` allowlisted logger (7.1) in **7 of 18** API routes (application notifications, email-evidence probe, owner emails, contact submissions, renewal submit, vendor applications, Resend webhook). Redaction unit tests cover those paths | 7.1 final-head re-review; preview/production log readback | **11 routes** and two helpers (`draftEmailNotices.ts`, `earlyAccess.ts`) log raw error objects with `console.*` (P7-01) | — | — |
| O-4 | Correlation IDs | Server correlation ID per request in the same 7 routes | — | Same 11 routes (P7-01) | — | — |
| O-5 | CFG-011 operational-log retention, 90 days | **Not met.** Logs go to host runtime output; no drain or exporter; host retention unverified | — | Retention mechanism (P7-10) | **CR-2** (new): minimum, maximum or both; mechanism | — ("assigned to 7.6" in the 7.1 record is a schedule note, not a deferral) |
| O-6 | Webhook lag, failure and dead-letter alerts (MTS §10 step 7, §11; OQ-1 G-5) | Finance exceptions queue only | — | P7-11 | OD-5 | — |

### 3.5 Roadmap line 5: "Implement email delivery/retry evidence and domain authentication"

Governing: MTS §5 (durable attempts), MTS §7 (Resend timeout, failure logging, delivery monitoring; SPF/DKIM/DMARC). Plan, readiness and checklist: TRACE-155.

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| M-1 | Durable attempt for every Mercurius-sent email | Application ledger (TRACE-104), price-draft ledger (DEC-2026-041 item 6), contact and renewal ledger (7.2C). Concurrency scripts in CI | #167 review | — | — | — |
| M-2 | Provider delivery evidence | Built and **dormant**: receiver with no secret (503), correlation tags, readbacks, audited arming, Production-only probe harness, operator purge control. SQL 121–126; unit and browser tests | O-1..O-6 operator and post-deploy checks; checklist step 3 | — | **EO-1, EO-2, EO-3, EO-6, EO-7** (all unapproved) | — |
| M-3 | Retry evidence | Facts (b) manual replay re-signed and (c) automatic retry re-signed are proven only by H-7 and H-10 | Not run (V-3) | — | EO-1 naming H-7, H-10 | — |
| M-4 | Domain authentication | Historical only: R0 inbox test 2026-09-30 showed DKIM and SPF passing ([R0-RELEASE-CANDIDATE](R0-RELEASE-CANDIDATE.md)) | H-1 domain readback and inbox header check (DKIM, SPF, DMARC) for the controlled sends | — | EO-1 (H-1), EO-6 | — |
| M-5 | Real inbox delivery in Phase 7 | **Never evidenced** | T-5 (contact), T-6 (renewal: **blocked**, preconditions fail at the §1.1 read) | — | EO-6 | Owner instruction 2026-11-21: T-6 stays blocked unless its preconditions already hold |
| M-6 | Receipt retention | 90/30-day expiry implemented; purge-on-receipt and operator purge | Weekly purge duty starts at the first receipt | — | EO-2 (intervals, D = 14 days, Josh accountable); a **backup operator** for absences over 14 days (none under DEC-2026-025) | — |
| M-7 | Bounce, complaint and suppression | Resend's account suppression only | — | 7.3E wiring, only if needed (P7-C1) | **EO-4, EO-5, EO-8** | — |
| M-8 | Resend after proven non-delivery (7.3F) | None | — | — | — | Not an owner deferral. Codex direction EC-10 defers new resend transitions until 7.3D evidence exists. Not a roadmap requirement (§8) |
| M-9 | Auth SMTP (verification, recovery, invitations) | Auth-owned; invitation reservations (Phase 5) | Hosted SMTP and template delivery unproven (N-APP-03) | — | — | — |

### 3.6 Roadmap line 6: "Create operator runbooks and audit logs"

Governing: roadmap Phase 7; MPS §9 override record fields; MPS release checklist "Operational queues have owners, hours, SLAs, alerts, and runbooks" ([PROPOSED-MPS.md:362](../mps/PROPOSED-MPS.md#L362)); MTS §11.

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| R-1 | Operator runbooks | **None as runbooks.** Procedures are scattered in records: owner-email recovery (7.2C plan), email-evidence recovery (7.3A plan §9.2), activation and shutdown (checklist §3, step 31), SLA scan and purge (7.5F-2), Cron activation ([SUPABASE-CRON-SETUP](SUPABASE-CRON-SETUP.md)) | — | Runbook set (P7-05) | Owner adoption after review; backup operator; OD-7 | — |
| R-2 | Audit records for overrides | Per-command records: `admin_request_actions`, waiver adjustments, `review_history`, role decisions, catalog visibility events, gate events, two-person money reviews, support and dispute events, SLA detector runs, email arming events | — | MPS §9 completeness (reason code, before/after, affected communication, linked financial event) not characterized (P7-04) | — | — |
| R-3 | Admin direct notification INSERT is unaudited | RLS policy "Admins can insert notifications" | — | P7-08 | — | — |
| R-4 | Incident runbooks (payment drift, auth outage, data exposure, lost storage, bad migration, email/domain, secret compromise) | None | — | — | CR-5 (phase boundary) | Classified as Phase 8 by this register (§8), subject to Codex |

### 3.7 Gate: "staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication"

| ID | Item | Evidence on `main` | Review / verification outstanding | Missing implementation | Owner decision | Approved deferral |
|---|---|---|---|---|---|---|
| G-1 | Local staged failures SF-1..SF-12 | SQL 128: queue item and audit asserted. **Alert: none** asserted for every scenario. Communication missing for SF-7 (exhaustion) and SF-8 (support acknowledgement). Characterization only (OQ-1 §7.1, RV-4) | 7.5C review | Alert producers (P7-11); communications (P7-12); acceptance rewrite (P7-16) | OD-5; G3-01 | Where CFG-015 or N-REC-04 forbid a message, "communication: none" is already correct. Those scenarios still lack the alert outcome |
| G-2 | SLA breaches | Recorded by manual scan (SQL 131/132, local). No hosted scan has run. No alert on a breach | First hosted scan (authorization) | P7-11 | OD-5 | OD-2: no scheduler |
| G-3 | Hosted staged checks HQ-3..HQ-6 | Not authorized. Preview builds share the production database (DEC-2026-037), so a hosted staged failure writes to Production | — | P7-16 | **CR-1** (new): what evidence closes the gate, and whether scheduler activation (HQ-3, HQ-4) is inside Phase 7 | — |

---

## 4. Explicitly approved deferrals and approved "no action" rules

Only these have a recorded approval. Nothing else in Phase 7 is deferred.

| Approval | What it defers or sets to none | Affects |
|---|---|---|
| DEC-2026-069 P-4 | Derived first-response lateness reporting is **deferred** | E-8 |
| DEC-2026-069 OD-2, P-5, P-6 | Manual SLA scans only: no scheduler, no historical backfill, no cadence | Q-4, G-2 |
| DEC-2026-054 items 3–4 (approved by DEC-2026-060 D-6a) | Dispute resolution target set after pilot data; no provider response deadline | Q-3 |
| DEC-2026-010 | Email and reminder timing inactive until separately configured; no real messages | N-11 |
| CFG-015 | Quote aging and payment exceptions are queue items only; no reminders or external messages | G-1 (SF-1..SF-4) |
| DEC-2026-049, per NM-1 N-REC-04 | No notice for an unpaid recurring visit | G-1 (SF-5) |
| DEC-2026-063 | No automatic response timeout for offer terms; in-app notices for that slice | N-3 |
| Owner decisions 2026-09-13, item 4 ([PHASE-5-EVIDENCE-RENEWAL](PHASE-5-EVIDENCE-RENEWAL.md)) | No automated compliance-renewal notice; Mercurius contacts the provider | OQ-1 Q-11 |
| DEC-2026-026 | Dark mode deferred to TRACE-106; Phase 7 UI acceptance is light-only | N-2, N-4, N-7 |
| DEC-2026-022 (R1 gate) | Credits, and with them any Credits notice, arrive at R1 | N-13 |
| Owner instruction 2026-11-21 (checklist §2 EO-6) | T-6 stays blocked unless its preconditions already hold; nothing changes the synthetic provider to make them hold | M-5 |

**Not deferrals** (listed so they are not read as such):
- DEC-2026-068 approves the admin in-app readback and **declines to approve** external alerts. Alerts remain required by the gate.
- MPS §2 ("targets after an instrumented pilot baseline") is an authority statement. OD-6 is still undecided.
- NM-1 §7.4 "Category 4 — later slices", the 7.1 record's "assigned to 7.6", the EO-6 proposal's "T-7 deferred" (unapproved) and Codex direction EC-10 are scheduling or technical notes.

---

## 5. Characterization tests versus acceptance tests

**Characterization** pins current behavior, including a gap, so that closing the gap has to change the test on purpose. It never proves a requirement is met. **Acceptance** asserts behavior an approved authority requires. All acceptance below is local or CI only, unless marked hosted.

### 5.1 Characterization (demonstrates missing behavior)

| Test | What it pins | Requirement it does **not** prove |
|---|---|---|
| SQL 128 SF-1..SF-11, "alert" column | No alert for any staged failure | Gate: correct alert |
| SQL 128 SF-7 | No homeowner message. Its "queue item: none" predates the sourcing reader: SQL 128 does not call `admin_sourcing_queue()`, which SQL 134 covers separately. SD-1: the case also appears as `blocked_inactive` | Gate: user communication (N-REQ-04); a gate rewrite (P7-16) must assert the sourcing item |
| SQL 128 SF-8 | No support acknowledgement message | Gate: user communication; MPS §10 support acknowledgement |
| SQL 128 SF-8c | Same-day support branch depends on wall-clock time (SD-2) | Deterministic coverage of CFG-010 same-day priority |
| SQL 128 SF-11 | Stripe dead-letter creates a finance exception and **no alert** | MTS §10 step 7 |
| SQL 128 SF-6b | Batch escalation (DEC-2026-006) runs only when invoked; no scheduler | Scheduled escalation (HQ-3, HQ-4) |
| NM-1 count-only assertions (SQL 053, 074, 095) | Rows are written | Recipient, isolation, single-row and replay behavior (N-6) |

### 5.2 Acceptance (proves required behavior)

| Requirement | Tests |
|---|---|
| Summary truth (TRACE-136 A8; DF-1, DF-2) | SQL 127; `admin-operations.spec.ts`; SQL 128 SF-12 (now pins the repair) |
| Support first reply (CFG-010 as directed by CD-1; DF-3) | SQL 129; SQL 128 SF-9 (changed on purpose by 7.5D); `support.spec.ts` |
| Vendor readback and DEC-2026-063 producers (DEC-2026-065, DEC-2026-063) | SQL 119; `vendor-notifications.spec.ts`; offer-terms concurrency C16, C17; SQL 116 gate-off rows |
| Admin readback (DEC-2026-068) | SQL 130; `admin-notifications.spec.ts`; unit `own-notifications-controller`, `admin-notification-readback` |
| Owner-email ledger (MTS §5; DEC-2026-066) | SQL 120; `owner-email-concurrency.mjs`; `owner-emails.spec.ts`; unit `owner-email-ledger` |
| Application email tracing and redacted logs (7.1) | Unit `application-notification-tracing` (45); `application-notification-concurrency.mjs` |
| Email evidence, dormant (TRACE-155) | SQL 121–126; `email-evidence-arming-concurrency.mjs`; `email-evidence-*.spec.ts`; unit `email-evidence-*`. **No hosted receipt, delivery, bounce or inbox evidence exists** |
| SLA observation (DEC-2026-069) | SQL 131, 132; `sla-detector-concurrency.mjs`, `sla-replay-purge-concurrency.mjs`; `admin-sla-observations.spec.ts`; unit `sla-observations*`. **No hosted scan** |
| Applications and sourcing queues (Q-12, Q-01; DEC-2026-070) | SQL 133, 134; `admin-sourcing.spec.ts`; unit `application-queue-state`, `sourcing-queue` |
| Approved PostHog trigger contract (TRACE-157; D-2) | 7.4B call-site tests; 7.4C browser and unit tests; `tests/analytics/posthog.pw.ts`; unit `analytics-redaction` |
| Queue readers Q-02..Q-11 (Phase 6 contracts) | SQL 090, 097, 098, 101, 103, 108, 116, 117, 039–050 (as cited in OQ-1) |
| **Hosted acceptance in Phase 7** | HQ-2 at `41d34ec`, single read-only snapshot, eleven rows in parity (#221 only; sourcing had zero items). Nothing else |

### 5.3 No test of either kind exists for

The homeowner notification UI (N-7); the untested producer titles (N-6); any alert; uptime or error reporting; log retention; redaction in the 11 routes outside the logger; and the gate's four outcomes together, as acceptance.

---

## 6. Open decisions

### 6.1 New, raised by this register (proposals only)

| ID | Decision | Owner / advisor | Blocks |
|---|---|---|---|
| CR-1 | What evidence closes the Phase 7 gate: (a) local acceptance tests only; (b) local acceptance plus named hosted staged failures under HQ-3..HQ-6 rules; and whether lifecycle scheduler activation (DEC-2026-003 sequence; HQ-3, HQ-4) belongs to Phase 7 or to booking activation | Owner; Codex advises | P7-16 |
| CR-2 | CFG-011 "operational application logs: 90 days": a minimum retained period, a maximum, or both; and the mechanism (host plan retention or a drain to a provider). "Retention jobs must be observable" applies | Owner; Codex advises | P7-10 |
| CR-3 | Queue priority beyond CFG-010 same-day support. The roadmap names "priority", but no rule is approved. Could be "aged first, then age" as built, or none until the pilot baseline | Owner | Q-5 |
| CR-4 | Superseded release checks. Every `main` merge deploys, so READY, HQ-1 and HQ-2 for older commits (`126c85f`, `dcc62e1`, `01a5dd1`, `846dd34`, `89973fa`, `5cfe5b0`, `e3a12a1`, `1e97f95`) can no longer be observed. Are they satisfied by the checks at the current `main` commit, or recorded as not done? | Codex, then owner | V-2 |
| CR-5 | Phase boundary for the items §8 classifies: notification table hardening (Phase 7 here), public-form abuse and auth-failure alerts (Phase 8 here), incident runbooks (Phase 8 here) | Codex | P7-08, P7-11, R-4 |
| CR-6 | Retention class for tracked contact submissions and their owner-email ledger rows (DEC-2026-066 left it undecided) | Owner | §6.4 |

### 6.2 Existing and still open

| ID | Decision | Source | Blocks |
|---|---|---|---|
| G3-01 | Channel and fallback per MPS §10 group | NM-1 | P7-12, P7-14, N-1 |
| G3-02 | Reminders and quiet hours | NM-1 | N-11 |
| G3-03 (rest) | Stop any admin producer? | NM-1; DEC-2026-068 | — |
| G3-04, G3-05 (homeowner) | Duplicate cancellation notices; free text to homeowners | NM-1 | P7-13 |
| G3-06 | Notification retention class | NM-1 | N-19 |
| G3-08 | What the MPS §8 test notification is | NM-1 | N-20 |
| G3-09 | Decommission the legacy Edge function | NM-1 | N-21 |
| D-1 | Confirm the analytics layer split | AC-1 | E-3 |
| D-3 | Auth handoff event covered by the 2026-11-19 approval? | AC-1 | P7-C4 |
| D-6 | Operator measurement surface | AC-1 | E-10 |
| OD-3 | Eligible-pool record definition (when a pool is "created", before or after excluding earlier attempts, gate-blocked counted separately, matching version stored) | OQ-1 §6.2 | P7-15 |
| OD-4b | "Sourced" outcome | OQ-1 §6.3; DEC-2026-070 | E-6 |
| OD-5 (external) | Alert channel beyond in-app, and the named recipient (HQ-6) | OQ-1; DEC-2026-068 | P7-11, gate |
| OD-6 | Thresholds and sourcing deadline for queues with none | OQ-1 | Q-3, Q-9 |
| OD-7 | Delegated operations owner for R1 | OQ-1 | R1 gate |
| AG-1 | Two hosted admin users against DEC-2026-025 | 7.5G-2 record (#221 only) | Q-8 |
| EO-1..EO-8 | Email activation decisions and named hosted actions | Checklist §2, §7 | V-3, M-2..M-7 |
| Backup operator | Needed for any absence over 14 days once receipts exist (EO-2) | Checklist §2 | V-3 |
| MTS §15 item 6 | Error-monitoring and uptime provider ADR | MTS | P7-09, P7-11 |
| MTS §14 | Approve the proposed service objectives | MTS | P7-09 |
| 7.5F-2 D-1 | Accept page gaps G-1..G-4 as known limits? | 7.5F-2 record | P7-C2 |
| 7.5D F-1 | Recipient and destination for a reply notice on provider- or operator-filed work items | 7.5D record §4 | P7-13 |
| TRACE-139 | Purge already-collected Web Analytics events; re-issue invitations opened since 2026-11-02 | TRACE-139 | E-11 |

### 6.3 Eligible-pool definitions (focus)

- **Requirement.** MPS §11 liquidity "eligible pool count", MPS §5.2 `eligible_pool_created` and MPS §6.2 "ranking … logged with a version".
- **Current state.** Nothing is recorded. The live matcher `private.offer_next_for_request_internal` computes no count. AC-1 L-1 cited a superseded body (OQ-1 §6.2). The only persisted candidate list is `private.offer_terms_blocks.candidates`, for gate-blocked one-time exhaustion. No matching or eligibility version exists.
- **Open decisions.** OD-3 has four parts: when a pool is created, before or after excluding earlier attempts, whether gate-blocked candidates count, and whether a version is stored. AC-1 D-4 was split into OD-3 and OD-4b; both are open. 7.5G-2 left C-3 (eligible-provider definitions) open.
- **Proposal on record (unapproved).** Count at each matching run, after excluding earlier attempts, with gate-blocked candidates counted separately. Counts only; no provider list beyond `offer_terms_blocks`.
- **Effect.** P7-15 restates the matcher, so it needs the money and matching fingerprint checks and its own Codex review. Until OD-3 is decided, no liquidity measure of pool size is possible.

### 6.4 CFG-011 retention as it touches Phase 7 (focus)

CFG-011 (approved 2026-08-29) sets the classes. "Retention jobs must be observable and reversible where appropriate."

| Record | CFG-011 class | State on `main` | Open |
|---|---|---|---|
| Operational application logs (`mercurius.oplog.v1` and raw `console.*`) | 90 days; no secrets or unnecessary personal data | **Not met.** No drain or exporter; host retention unverified; 11 routes outside the logger | CR-2; P7-01, P7-10 |
| SLA observations, detector runs, purge logs | Operational records, 90 days (DEC-2026-069 P-2) | 90-day logical retention; physical deletion only by the manual purge; no hosted purge has run | First hosted purge (separate authorization) |
| Email provider receipts | Not classed by CFG-011 directly; EO-2 proposes 90 days linked, 30 days unlinked | Implemented; no receipt exists yet | EO-2; backup operator |
| In-app notifications | "Platform messages: 3 years"? Not decided | No purge; recipients may delete their own rows, which a 3-year class would contradict | G3-06 |
| Owner-email ledger and contact submissions | Not decided (DEC-2026-066: no retention class for contact submissions) | No purge | CR-6 |
| Support tickets | 3 years | No purge job; not characterized by any Phase 7 record | Outside the Phase 7 records; listed for completeness |

---

## 7. Remaining slices

### 7.1 Bounded count

| Group | Slices | Count |
|---|---|---|
| No owner decision needed | P7-01 … P7-06 | 6 |
| Codex technical ruling first | P7-07, P7-08 | 2 |
| Owner decision first | P7-09 … P7-16 | 8 |
| **Implementation total** | | **16** |
| Conditional (exist only if a decision requires them) | P7-C1 … P7-C4 | ≤ 4 |
| **Upper bound** | | **≤ 20** |
| Non-code tracks | V-1 reviews, V-2 release verification, V-3 email activation run, V-4 owner decision card | 4 |

The bound assumes G3-01 is answered once, for all MPS §10 groups. If the owner answers it group by group, P7-12 and P7-14 may split, but only along MPS §10's eleven groups, of which pre-R1 work reaches at most four.

### 7.2 Next implementation slice: P7-01

**Why first:**
- It closes an approved requirement: CFG-011's "secrets and unnecessary personal data prohibited", and the roadmap's PII-safe structured logs and correlation IDs. The gap is evidenced: 11 routes pass raw `error` objects to `console.*`, and whether those objects can carry personal data has not been established.
- It needs no owner decision, migration, hosted action or new dependency.
- P7-10 (retention) needs one log format first.

P7-02 (notification producer tests) is equally decision-free, but it adds evidence for behavior that already works rather than closing a privacy requirement.

### 7.3 Slices

Each slice is one PR from a fresh `main`. Each follows DEC-2026-037: a migration is pushed before merge, with the owner's authorization. None activates anything.

| ID | Slice | Scope (exact) | Depends on | Acceptance criteria |
|---|---|---|---|---|
| **P7-01** | 7.6A structured-log coverage | Move every `console.*` call in `src/app/api/**/route.ts` (11 routes: package-draft emails, early-access ×3, invitations/open, renewal-documents ×3, request-coverage, vendor-application documents and retention) and in `draftEmailNotices.ts` and `earlyAccess.ts` onto `mercurius.oplog.v1`, with a per-request server correlation ID. Response status and body unchanged. Inventory every other server-side `console.*` (provider profile reads, `requestPhotos.ts`) and convert it or record why not | — | (1) Per route: a thrown error whose message and details hold a synthetic email, phone, token and storage path produces a log line with none of them; only allowlisted event names and fields. (2) The correlation ID is present and differs per request. (3) A repository test fails on any direct `console.*` in `src/app/api`. (4) Mutation: restoring a raw `error` log fails a named test. (5) Existing route tests unchanged and passing; typecheck, lint, secret scan, build. (6) No migration, no change to Edge functions |
| P7-02 | 7.2D notification producer acceptance (G2-02) | SQL tests through the real commands for N-FUL-01/03/04, N-FUL-09/10, N-QTE-02/06, N-CXL-03/05/06, N-REC-02/03, N-SUP-03, N-APT-02/03 | — | For each event: one row per intended recipient, none to any other account, a replayed key writes none, `anon` and other users cannot read it. Current text is pinned as characterization of G3-05, not as approved copy. Mutations on recipient and title are caught. No producer change |
| P7-03 | 7.2E homeowner notification UI acceptance (G2-04) | Browser tests for the bell and `/notifications` | — | Loading, empty, error with retry, mark read, mark all, realtime-unavailable notice, keyboard order and focus, axe clean at 320 px and 1440 px, no horizontal scroll at 320 px, light mode (DEC-2026-026). A defect found is reported, not fixed in this slice. A2 stays carried |
| P7-04 | 7.5H audit-record completeness characterization | For every admin override path (AC-1 O-1; DEC-2026-057), tabulate MPS §9 fields: actor, timestamp, reason code, free-text detail, before/after values, affected user communication, related financial event. Characterization SQL tests pin what is recorded | — | Every path listed with each field present, absent or not applicable, with source references. Tests pin the current fields. Gaps listed for a decision; no record change |
| P7-05 | 7.7A operator runbooks (documentation) | One runbook per OQ-1 queue (Q-01..Q-14), plus owner-email recovery, email-evidence recovery and shutdown (marked conditional on EO-2), SLA scan and purge, and Cron activation (marked inactive) | Optional: P7-04 findings | Each runbook gives entry condition, where to look, the command or control, who acts (CFG-010; DEC-2026-025), the audit evidence to check afterward and what not to do. Every step cites an authority, and none adds policy. Unassigned roles (backup operator, OD-7) are marked open. Links resolve. Codex review; owner adoption is recorded separately |
| P7-06 | 7.5I owner-email queue in the overview | Function-only restatement of `admin_operations_summary` adding the Q-13 row from `owner_email_overview` attention counts; `SUMMARY_QUEUES` entry | Hosted push authorization | Count parity with the Q-13 reader in one snapshot (SQL); no `aged` (the 10-minute window is not an SLA); old client drops the unknown row (mixed-version test); money fingerprint unchanged; HQ-2 rerun after release |
| P7-07 | Exhaustion audit event (AC-1 L-4; MPS §5.6) | Append-only event when a request becomes `exhausted` or `awaiting_consent` | **Codex ruling** on event shape and matcher restatement; hosted push authorization | One event per transition; none on replay or a concurrent re-run; no customer copy, message or state change; matching fingerprint changes only by the event write; full SQL and concurrency suites pass |
| P7-08 | Notification table hardening (N-15, R-3) | Recipient UPDATE limited to `read_at`; admin direct INSERT removed or audited; optional dedupe key | **Characterization of current callers**; Codex ruling (and CR-5); hosted push authorization | Recipients cannot change any other column (SQL); no client path breaks (browser suites for the homeowner, vendor and admin readbacks); admin INSERT behaves as ruled; producers unchanged |
| P7-09 | Error reporting and uptime checks | Provider integration chosen by ADR; uptime checks for marketing, login, API health, webhook health (MTS §11) | **MTS §15 item 6**; MTS §14 objectives; P7-01 | A staged server error reaches the provider with no personal data (redaction test); each uptime check reports; the provider configuration is recorded without secrets; no paid tier without owner approval |
| P7-10 | CFG-011 log retention | Retention mechanism per CR-2 | **CR-2**; P7-01 | Configured retention read back and recorded; deletion behavior matches CR-2; retention is observable (a dated readback procedure in P7-05) |
| P7-11 | Operator alerts | Alerts for finance dead-letter and webhook failure (MTS §10 step 7), SLA breach observations and email-evidence gaps, to the approved channel and recipient | **OD-5 external**, named recipient; P7-09 if it uses the same provider | Each SF scenario's alert column flips from "none" to the approved alert in a deliberate test change; no alert for scenarios the authority exempts; no customer message; HQ-6 procedure written |
| P7-12 | Pre-R1 user communications | N-REQ-04 (exhaustion and consent needed), N-REQ-06 (submission and coverage outcome) and support acknowledgement, on the approved channels | **G3-01** (and G3-02 if reminders are included) | SF-7 and SF-8 communication columns flip deliberately; idempotent per business event (replay writes none); CFG-009 copy (never claims active sourcing); consent classification per EO-8 |
| P7-13 | Notification copy corrections | N-REQ-03 (money-fingerprinted; its own reviewed restatement), G3-04 duplicate cancellation notices, G3-05 homeowner free text, G2-03 CFG-006 consistency, 7.5D F-1 destination | Approved wording; G3-04, G3-05; the F-1 decision | Each corrected notice matches approved text; boundary and waiver tests agree with the policy outcome; money fingerprint change limited and explained |
| P7-14 | Payment, refund and payout notices | N-CXL-07/08 on the approved channels | **G3-01** | Local acceptance through the real money commands with synthetic data; hosted evidence recorded as an R1 (Phase 9) item, not claimed |
| P7-15 | Eligible-pool record | Pool record per OD-3 (§6.3) | **OD-3** | Counts only, at the defined point; gate-blocked candidates as decided; idempotent per matching run; matching fingerprint review |
| P7-16 | Phase 7 gate acceptance | Rewrite SQL 128's expectations as acceptance against the approved outcomes; run the hosted staged checks CR-1 requires | P7-11, P7-12; **CR-1**; any scheduler activation CR-1 places in Phase 7 | Every SF scenario asserts the correct alert, queue item, audit event and communication per its authority. Hosted checks (if CR-1 requires them) run with named synthetic records, exact cleanup and a stop list. The gate evidence is recorded for the owner's acceptance decision. This slice does not accept Phase 7 |
| P7-C1 | 7.3E suppression wiring | Only if a status-email or marketing sender is approved | EO-4, EO-5, EO-8 | Per the 7.3A plan §10 (address hashed in the receiver, never stored) |
| P7-C2 | SLA page gaps | G-1..G-4, only if 7.5F-2 D-1 does not accept them as limits | 7.5F-2 D-1 | As the 7.5F-2 record specifies |
| P7-C3 | Unpaid scheduled one-time job queue item | Only if ruled part of Q-04 | Definition (OQ-1 G-4) | Parity with the start guard; no threshold unless approved |
| P7-C4 | Intake auth handoff event (A-16) | Only if D-3 is answered yes | D-3 | One event on `/request` only, with no properties beyond `page`; consent-gated as TRACE-157 |

### 7.4 Non-code tracks

| Track | Content | Who |
|---|---|---|
| V-1 Codex review backlog | Final-head re-review of 7.1; retrospective 7.2B; #167 (7.2C-2); 7.3D-2 D-3 correction; 7.4C (#194); 7.5B (#197); 7.5C (#199); 7.5D (#201); 7.5E repair (#203); 7.5F-1 (I-1..I-15) and F208-1 repair (#211); 7.5F-2 (#213); 7.5G-1 (I-1..I-6); **7.5G-2 (I-1..I-10), the outstanding sourcing review**; TRACE-139 (#138); TRACE-157 (#182). Those are the fifteen code slices. Documentation: NM-1 final; 7.4A. Findings are fixed forward | Codex |
| V-2 Release and hosted verification (read-only, each owner-authorized) | READY for the current `main` commit; HQ-1 signed in as the owner; manual `/admin/sourcing`; CR-4 ruling on superseded checks; 7.3D step-3 operator checks and readiness O-1..O-3; O-4 (503 probe, an outward request); notification hosted parity (G2-06), including the legacy trigger and Edge function; record the unrecorded appliers of `20261202001000`, `20261204001000`, `20261206001000` and `20261128001000` as gaps, not reconstructed | Owner; Claude for privileged reads |
| V-3 Email activation run | After EO-1/2/3/6/7: checklist §3 steps A–I, including H-1 domain readback, the H-10 automatic-retry test, T-1..T-5 and inbox header checks for DKIM, SPF and DMARC. T-6 stays blocked unless its preconditions hold | Owner, with the checklist |
| V-4 Owner decision card | §6.1 and §6.2 in one dated response, each item named | Owner |

### 7.5 Dependency order

```text
Now, in parallel:  P7-01 → P7-02, P7-03, P7-04, P7-05, P7-06    V-1, V-2, V-4
Codex rulings:     P7-07; P7-08 (after caller characterization)
After decisions:   MTS §15.6 → P7-09 → P7-11 (with OD-5)    CR-2 + P7-01 → P7-10
                   G3-01 → P7-12, P7-14    copy decisions → P7-13    OD-3 → P7-15
                   EO-1/2/3/6/7 → V-3
Gate:              P7-11 + P7-12 + CR-1 → P7-16 → owner's Phase 7 acceptance decision
```

---

## 8. Phase 7, Phase 8 and later or optional work

| Item | Classification | Basis |
|---|---|---|
| Every row of §3 not listed below | **Phase 7** | Roadmap Phase 7 work lines and gate |
| Notification table hardening (P7-08) | Phase 7 (CR-5) | MPS §10 "idempotent … auditable". A security reading would place it in Phase 8 |
| Public-form abuse alerts, auth-failure metrics | **Phase 8** (CR-5) | Roadmap Phase 8 abuse protection and security suite; MTS §11 lists them as detective controls |
| Security headers, CSP, CI gates (axe, visual, drift), preview data isolation, restore drills, RPO/RTO record, payment replay, rollback drill, alert drill, incident runbooks, secret-rotation runbook | **Phase 8** | Roadmap Phase 8. The alert drill needs Phase 7's alerts. The Resend secret-rotation rehearsal (H-8) stays in V-3 |
| Intermittent browser failures (`mds.spec.ts:50`, `mds.spec.ts:108`, `request.spec.ts:837`) | Phase 8 (CI gates) | Undiagnosed; carried in every Phase 7 record |
| Hosted payment, payout and Credits notice evidence; daily funnel and liquidity review | **Phase 9** | Roadmap Phase 9; DEC-2026-022 R1 gate |
| Numeric SLA targets where none exist; dispute resolution target | After pilot baseline | MPS §2; DEC-2026-054 (approved) |
| Derived first-response lateness reporting | Optional / later | DEC-2026-069 P-4 (approved deferral) |
| Scheduler for SLA scans; historical backfill | Optional / later | DEC-2026-069 OD-2, P-5 (approved "none") |
| 7.3F resend after proven non-delivery | Optional / later | Codex EC-10; not a roadmap requirement |
| T-7 controlled sends of application and price-draft email | Optional within V-3 | EO-6 proposal (unapproved) |
| "Sourced" outcome, if OD-4b chooses option (a) | None in beta | OQ-1 §6.3 proposal (unapproved) |
| Dark-mode acceptance of Phase 7 pages | TRACE-106 | DEC-2026-026 (approved deferral) |

---

## 9. Carried unchanged

- A2 human verification (screen reader, real devices, keyboard, 200% zoom, 320 px reflow, `@visual` on Windows): not performed for any Phase 7 page.
- The final booking-candidate schema, grants, money fingerprint and completion-integrity checks (booking-readiness register).
- `offer_terms` and promotions gates off. No booking, payment, scheduler, email activation or feature switch is authorized.
- The Phase 6 verification exceptions ([PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md)).

## 10. Validation of this register

| Check | Result |
|---|---|
| Diff | Documentation only: this file, the TRACE-162 row in [TRACEABILITY](TRACEABILITY.md) and a [HANDOFF](../docs/agent/HANDOFF.md) entry |
| Sources | Every PR, merge commit and migration in §1–§2 was read from `git log origin/main` and `gh pr list`; review outcomes were searched in all Phase 7 records, TRACEABILITY and HANDOFF on `main`; API-route logging was counted from source at `41d34ec` |
| Not performed | Any hosted, Vercel, Supabase, Resend or PostHog read; any test run (no code changed) |
| Secret scan | See the PR body |
