# Phase 6 closure report and acceptance preparation (TRACE-137)

**Status:** PREPARED FOR CODEX REVIEW, 2026-11-03 (America/New_York). This is not Phase 6 acceptance. The owner accepts Phase 6 after Codex review (PHASE-6-SCOPE "Phase acceptance checkpoint"). Every disposition below is a **proposal**. None approves a deferral or a policy, and no PROPOSED decision becomes approved here.

**Revised 2026-11-03 (second pass, on review direction):** review evidence gaps stated as gaps (§3); a deferral register naming each deferred item's release gate, acceptance condition and owner (§4.6); general support after 48 hours separated from a new formal-dispute override (P-3, D-6); human checks placed after every acceptance-affecting repair (A2, §9); decision sheet statuses (§7); CS-1 implemented as its own PR (TRACE-138, §4.4, §8) and the findings it surfaced (W-4–W-6).

**Owner answers 2026-11-03 (TRACE-140, [DEC-2026-060](DECISION-LOG.md)):** the owner accepted every recommended option in §7 ("Accept all recommended"), except D-10. D-10's recommendation needs two named finance reviewers, so the owner chose its alternative ("Not named yet; carry"). The status column in §7 and the "Answered" notes below record this. **The deferrals in §4.6 are now approved** where the answers select them, and Phase 6 is still not accepted. CS-1 (#137, `d7f073d`) and TRACE-139 (#138, `b7b0d08`) are merged; neither PR has a Codex review recorded in the repository.

**Finance reviewers (owner, later 2026-11-03, DEC-2026-060):** Josh (owner) and the accountant, who is not yet engaged. Every row below that says "finance reviewers (not named)" or "two finance reviewers (not named)" now means these two. A two-person review can't be completed until the accountant is engaged.

**Base:** `main` `85bb7c6` (PR #135 merge, 2026-11-03 18:19 UTC). `git log 85bb7c6..origin/main` was empty when this audit started. Branch `claude/phase6-closeout-audit`.

**Not done here:** no payment, automation or promotion activation; no financial operation; no hosted change (hosted was only read); no merge.

## 1. Verified state

| Check | Result | Evidence |
|---|---|---|
| Every numbered slice 6.1–6.13 reached `main` | **Yes.** All 25 Phase 6 PR heads (#106–#135, stacked ones included) are ancestors of `85bb7c6` | `git merge-base --is-ancestor <head> origin/main` for each PR head, 2026-11-03 |
| `main` CI at `85bb7c6` | **Green**: backend (full SQL, every concurrency script incl. admin operations, clean replay, Edge), lifecycle, application (lint, secrets, types, unit, build, full non-visual browser suite) | run 41692704323 |
| Hosted migration history | 214 local migrations, each paired with a remote one, ending at `20261109001000` | `supabase migration list --linked` (read-only) |
| `20261108001000` on `main` equals what hosted applied | **Yes.** Hosted's stored statements match `85bb7c6` and `015f371` byte for byte after whitespace and terminator normalization. They don't match the `b5629a6` rewrite. | read-only `supabase_migrations.schema_migrations.statements`, compared in a scratch script |
| `20261109001000` on `main` equals hosted | **Yes** (same comparison) | as above |
| Clean replay of `main` + this branch | 214 migrations; full SQL suite **100 files, 6,386 tests, PASS** (SQL 109 included) | isolated stack `scripts/phase5-db.sh reset` then `test`, 2026-11-03 |
| Money fingerprint | `45 \| 34c51131e2ca18f65d3b29afd8d12e11`, unchanged | `scripts/promotion-money-fingerprint.sql` |
| Secret scan | pass | `npm run scan:secrets` |

The PR #135 restoration of the applied `20261108001000` was correct, and a clean replay of `main` reproduces the recorded hosted state. No applied migration was edited.

## 2. Classification

- **A:** must fix (or perform) before Phase 6 acceptance.
- **B:** owner decision required before acceptance.
- **C:** later release or activation gate, with the authority cited.
- **D:** verified complete.

Where an item's later gate has no explicit authority, it is classed **B** with "carry to a later gate" as the proposal, never C.

## 3. Slice register

"Review" means a Codex code review recorded in the repository that names the diff or commits it covered. **"No review recorded" is an evidence gap.** It says nothing about whether the code is right or wrong, and this report does not fill it. None of these is treated as a code review record: a PR body saying "reviewed in #x", a decision review, a planning brief, or review or planning discussion held in chat. This audit's own reading of the diffs and the SQL 109 journeys aren't a code review either.

| Slice | Approved requirement | Implementation / `main` | Review and verification | Remaining gap | Proposed disposition | Owner / acceptance condition | Class |
|---|---|---|---|---|---|---|---|
| 6.1 TRACE-095 | CFG-001/002; DEC-2026-020/021; scope §6.1 | `bb57a61`…`c2b9b81` (2026-09-26/27) | Codex decision review of D1–D7 and the ZIP calls at `0e4793b` ([PHASE-6-DECISION-REVIEW](PHASE-6-DECISION-REVIEW.md)), which states it is "a focused decision review, not full slice or phase acceptance". **Evidence gap:** no code review of the slice diff recorded. SQL 063–065; J1 submit | review record | Codex review of the slice diff, or the integrated review (A1) | Codex | A1 |
| 6.2 TRACE-098 | MDS intake; scope §6.2 | `ec65948`…`63f1537` | Codex review of `c2b9b81..634837a` recorded, with changes required (P6-R2/P6-R3), and the P6-R1 re-review ([PHASE-6-INTAKE-REVIEW](PHASE-6-INTAKE-REVIEW.md)). **Evidence gap:** no re-review of the P6-R2/P6-R3 repair (`63f1537`) recorded; PHASE-6-MATCHING records it as open. SQL 066; browser `request` | re-review; human checks (§5.3) | Codex re-review of `63f1537` | Codex; A2 | A1 |
| 6.3 TRACE-099 | CFG-009 | `be58eee`…`211a12e` | **Evidence gap:** no Codex review of the 6.3 diff recorded; it stacked on the P6-R2/P6-R3 repair whose re-review is recorded as open ([PHASE-6-MATCHING](PHASE-6-MATCHING.md)). SQL 067; J1 offer | review record | Codex review | Codex | A1 |
| 6.4 TRACE-119 | DEC-2026-045 G1–G6; CFG-015 | #106 `0675805` | **Evidence gap:** no Codex review recorded. SQL 090; J2 | quote approval impossible while tax is pending (§4 Q-1) | see Q-1 | — | A1 + C (Q-1) |
| 6.5 TRACE-121 | MPS §6.3; scope §6.5 | #109 `404ea29` | **Evidence gap:** no Codex review recorded. SQL 092; J1 appointment | MPS E1 open: appointments say "recorded" (§4 Q-2) | see Q-2 | — | A1 + B (Q-2) |
| 6.6a–c TRACE-123/124/125 | DEC-2026-049 items 1–6, 9 | #111 `61f0601`, #112 `5e6d6ce`, #113 `7502342` | **Evidence gap:** no Codex review recorded. SQL 095–097; J3 | **6.6c merged without the two-person finance review that TRACE-125 required before merge**; items 7–8 blocked (§4 R-1, F-1) | see §4 | — | A1 + B |
| 6.7 TRACE-128 | scope §6.7, incl. "decide and test" unpaid start | #114 `afb7c83` | **Evidence gap:** no Codex review recorded. SQL 098; J1/J3 | DEC-2026-050 PROPOSED (§4 P-1) | see P-1 | — | A1 + B |
| 6.8 TRACE-130 | DEC-2026-009/010; scope §6.8 | #116 `de8e802` | **Evidence gap:** no Codex review recorded (PHASE-6-REVIEWS §9: "Codex review of the merged diff open"). SQL 100; J1 review | DEC-2026-052 (§4 P-2) | Codex review | Codex | A1 + B |
| 6.9A/B TRACE-131/132 | CFG-006/007; DEC-2026-053 E1–E12 | #121 `2dd9bed` | PR body says "reviewed in #118/#119". **Evidence gap:** no review record. SQL 101–102; J4/J5 | P-K1/P-K2, F-1/F-2/F-3 (§4 K-1…K-5) | see §4 | — | A1 + B/C |
| 6.10 TRACE-133 | CFG-008/010/011; DEC-2026-009 | #125 `ad4656b` | **Evidence gap:** no Codex review recorded. SQL 103; J6 | DEC-2026-054 (§4 P-3) | see P-3 | — | A1 + B |
| 6.11A/B TRACE-134 | DEC-2026-055 items 1–2 | #126 `475f03d`, #128 `8bcbfbe` | PR body says "reviewed in #124". **Evidence gap:** no review record. SQL 104–105 | signed-in SELECT on `contractors.special_offer` (§4 W-1), repaired for review in CS-1 (TRACE-138) | CS-1 | — | A1 + A3 |
| 6.12A TRACE-135 | DEC-2026-056 items 7–8 | #128 `8bcbfbe` | PR body says "reviewed in #127". **Evidence gap:** no review record. SQL 106 | — | — | — | A1 |
| 6.12B TRACE-135 | DEC-2026-056 items 1–6 | #129 `b1a8cc3` | **Evidence gap:** Codex review recorded as open (handoff 6.12B "Next"). SQL 107; J1/J6 earnings | `/vendors` copy; legacy metrics grant (§4 W-2, W-3), repaired for review in CS-1 (TRACE-138) | CS-1 | — | A1 + A3 |
| 6.13 TRACE-136 | DEC-2026-057 as amended | #132 `015f371`; forward fix #135 `85bb7c6` | Codex findings on #132 recorded with dispositions (brief §12.7, 7 findings); the record lists findings and doesn't state what the review covered. **Evidence gap:** no Codex review of #135 recorded, before or after its merge. SQL 108; J (operators) | retained restrictions §12.4 (§4 R-3); DEC-2026-058 (§4 P-4) | Codex review of #135 | Codex | A1 + B |
| Prepaid plans | DEC-2026-048 (approved, not implemented) | — | — | no implementation (§4 S-1) | see S-1 | owner | B |

**A1 (all slices):** each evidence gap above closes only with a Codex review recorded in the repository that names the diff or commit range it covered: one per slice, or one integrated review naming every diff. Gaps: 6.1 slice diff, 6.2 repair re-review, 6.3–6.12, #135, and CS-1. Until a gap closes, the slice stays A1. Nothing in this report, in SQL 109 or in earlier chat planning closes one.

## 4. Open items register

### 4.1 Pricing and accepted terms

| ID | Approved requirement / decision | Implementation / `main` | Evidence | Remaining gap | Proposed disposition and rationale | Owner / acceptance condition | Class |
|---|---|---|---|---|---|---|---|
| **T-1 TRACE-126** | DEC-2026-034 / 041 item 4: agreed request prices unchanged by later corrections | `private.money_source` one-time path (unchanged since 6.6c) | SQL 097 "KNOWN EXPOSURE (one-time)" | One-time fixed requests price from the *current* tier. An in-place correction changes an unpublished price, a package edit refuses checkout of a published snapshot, and the package→tier lock order can deadlock with a tier edit. | Owner chooses the agreed-price source for one-time requests (§7 D-1). Then a bounded corrective slice (CS-3) with the two-person finance review. Rationale: it contradicts an approved decision on a journey the gate covers, but it changes the money kernel, so it can't be fixed inside this audit. | Owner decision, then CS-3 merged with finance sign-off; or the owner records it as an explicit R1-gate blocker (§4.6). *2026-11-05: characterized again through the real vendor command. Since 6.11A every save of an in-use version, including a rename, pauses the bound row, so checkout is refused and an offered one-time request can't be accepted. Plan for Codex: [PHASE-6-BOUND-TERMS-PLAN](PHASE-6-BOUND-TERMS-PLAN.md) §4; §10 below* | **B** (then A or C as decided) |
| **T-2 TRACE-127** | DEC-2026-049 items 6/8; DEC-2026-042 | `vendor_accept_job`, `find_eligible_packages_core` | SQL 097 "existing rule (unchanged)" | After a price or add-on change, an already-offered add-on visit can't be accepted. It stays offered and unpaid; nothing is repriced. | Owner decides whether a visit offered at bound terms stays acceptable after a catalog change (§7 D-2), then a bounded slice (CS-4). Fails safe today. | Owner decision, then CS-4. *2026-11-05: wider than recorded. Visits without add-ons are refused too, and an accepted, unpaid visit becomes unpayable (`package_unavailable`), so acceptance alone doesn't deliver D-2. Plan for Codex, with the reading R-1 for owner confirmation: [PHASE-6-BOUND-TERMS-PLAN](PHASE-6-BOUND-TERMS-PLAN.md) §2–§3* | **B** |
| T-3 DEC-2026-051 items 6–8 | — (PROPOSED) | none | — | twice-a-year cadence; vendor cadences outside the catalog list; guardrail band source | Proposal: defer all three past Phase 6. Rationale: these are onboarding enhancements outside the critical journeys, and current behavior is safe. The deferral needs the owner's approval. | Owner | **B** |
| F613-18 | DEC-2026-057 Q6 | `admin_clear_package_review` (keyed, reason, history), `20261108001000` + `20261109001000` | SQL 108; concurrency A8 | none. It is still listed as carried in brief §11, which was stale | removed from the carried list (this PR) | — | **D** |

### 4.2 Quotes, appointments, recurring and fulfillment

| ID | Requirement | Implementation | Evidence | Gap | Proposed disposition | Owner / condition | Class |
|---|---|---|---|---|---|---|---|
| **Q-1 Quote tax** | DEC-2026-015 §4 (taxability confirmed with an accountant before private beta; no category charged without an approved tax rule); DEC-2026-045 G1 and implementation choice (1): "approval waits on the tax authority (activation dependency)" | `homeowner_respond_to_quote` refuses tax-pending; no tax-confirmation command | SQL 090; **J2**: approval refused `22023`, no obligation created | No quote can be approved, so the quote journey stops at "sent". | Carry to the private-beta gate, as both cited decisions already state. Phase 6 accepts the refusal as the correct beta behavior; the confirmed-tax path is tested only with a fixture (SQL 090 request 7). | Owner + accountant before R1 | **C** (DEC-2026-015 §4, DEC-2026-045) |
| **Q-2 Appointment confirmation (MPS E1)** | MPS checklist E1 (open); scope §6.5 "one-time appointment confirmation" | appointments are "recorded" by operations; no acknowledgement step | SQL 092; J1 | Nothing defines what makes an appointment confirmed, so scope §6.5's "confirmation" result is only partly delivered. | Owner defines E1 or accepts "recorded by Mercurius" as the beta meaning (§7 D-3). If an acknowledgement is required, that's a small slice on top of the existing record. | Owner | **B** |
| **P-1 DEC-2026-050 unpaid start** | Scope §6.7 names it the 6.7 acceptance item ("decide and test") | start ungated; payment state recorded at start | SQL 098; **J3**: an unpaid visit starts, recorded as not paid | open policy | Owner chooses A, B or C (§7 D-4). Recommendation in DEC-2026-050: A, gate in the start trigger, one-time jobs after TRACE-126. | Owner decision, then the test (option A or C needs a small slice) | **B** |
| R-1 DEC-2026-049 items 7–8 | PROPOSED; owner confirmed only "kept blocked" | visits of quote-priced or promotional plans, and replacement-provider visits, are neither created nor payable | SQL 095–097 | Those plan types can't run. | Proposal: keep blocked for beta, as the owner confirmed on 2026-10-27; decide the rules before they are offered. Making "keep blocked through Phase 6 acceptance" explicit needs the owner. | Owner | **B** |
| **F-1 6.6c two-person finance sign-off** | TRACE-125 / PHASE-6-RECURRING-VISITS §8: "two-person finance review before merge"; DEC-2026-049 item 5 | merged #113 `7502342` without it | CI green; no sign-off record | Process deviation: a required pre-merge review was never recorded. Payments aren't active, so nothing has moved. | Owner decides whether the review happens before Phase 6 acceptance (recommended: name the two reviewers and review `0ebc9ef`'s money path now, while the diff is small) or is carried as an R1 activation blocker. | Owner names reviewers; signed record | **B** |
| F-2 Promotions finance review | DEC-2026-038/041/042 item 5; DEC-2026-015 §3 | checkout refuses promotions; gate closed | SQL 084–087 | finance review not performed | Keep closed; carry to the promotions activation gate. | Owner + two finance reviewers, before the gate opens | **C** (DEC-2026-042 item 5) |
| S-1 Prepaid plans | DEC-2026-048 (approved); PHASE-6-SCOPE: "a separate slice after 6.6, with its own finance-review gate" | not built | brief only | none built | Owner states whether prepaid is inside Phase 6 acceptance. Proposal: outside it; a separate slice before R1 with its finance gate. | Owner | **B** |

### 4.3 Exceptions, payment kernel and support

| ID | Requirement | Implementation | Evidence | Gap | Proposed disposition | Owner / condition | Class |
|---|---|---|---|---|---|---|---|
| K-1 P-K1 open-session window | DEC-2026-053 correction 1: "payment-kernel changes are a separate finance-reviewed scope" | cancellation during open checkout creates a reconciliation state | SQL 101 | `money_attach_checkout` doesn't refuse a cancelled request; open Stripe sessions aren't expired | Proposal: carry to the R1 gate (no session can open while payments are inactive). No cited authority names the phase, so this needs the owner (D-11, §4.6). | Owner; then a finance-reviewed slice | **B** |
| K-2 P-K2 late capture | same | — (`money_process_payment_event` is fingerprinted) | — | capture after cancellation isn't held | as K-1 | as K-1 | **B** |
| K-3 F-1 $25 fee collection | DEC-2026-053 E2: "Until collection is active the fee is shown as assessed, not charged" | assessed only | SQL 101–102; J4 preview | no collection | carry to payment activation | owner / finance | **C** (E2) |
| K-4 F-2 supplemental refund | E11: "any additional refund requires separate authorization and duplicate protection" | readback names the amount; no command | SQL 102 | no execution path | Proposal: carry to the R1 gate; owner confirms (D-11, §4.6) | owner / finance | **B** |
| K-5 F-3 retained proceeds | E4: "not payable during beta until finance approves a rule" | not payable | SQL 101 | rule absent | carry | finance | **C** (E4) |
| **P-3 DEC-2026-054** items 3, 4, 6, 7, 8, 10 | PROPOSED; current behavior kept | 6.10 | SQL 103; J6 | open policy | Owner confirms the recommendations. Each keeps current behavior (§7 D-6a). | Owner | **B** |
| P-3c DEC-2026-054 item 1 | PROPOSED | free-text reason | SQL 103 | the recommendation (reason categories for reporting) is a change, not current behavior | Owner confirms or defers it (§7 D-6b). If confirmed, a small slice. | Owner | **B** |
| **P-3d DEC-2026-054 item 5, general support after 48 hours** (current behavior) | DEC-2026-009 (48-hour window from the provider's completion) | after the window the homeowner opens general support; no one can open a formal dispute. A general ticket opens no dispute, places no payout hold and changes no money | SQL 103; J6 general ticket | open policy only in that DEC-2026-054 hasn't been answered | Owner confirms "general support only after 48 hours" as the beta behavior (§7 D-6c). Confirming this does **not** approve P-3e. | Owner | **B** |
| **P-3e DEC-2026-054 item 5, formal-dispute override** (new capability) | DEC-2026-054 item 5 recommendation (PROPOSED) | **not built**: no path lets operations open a formal dispute after 48 hours | — | A dispute opened after the window can arrive after the payout became eligible (CFG-008: 48 hours after homeowner confirmation) or joined a weekly transfer, so it touches payout holds. The recommendation doesn't say what happens then. | Owner decides separately (§7 D-6d): (a) not in Phase 6; general support only (proposed); (b) approve it, with a rule for an eligible or transferred payout, then CS-6 with finance review of the hold behavior. | Owner; finance for the hold rule | **B** |
| P-3b DEC-2026-054 items 2, 9 | PROPOSED; "both need the finance review" | none | — | dispute money outcomes, partial-work penalties | Proposal: keep "no money outcome" for beta and decide with finance before the R1 gate; owner confirms (D-6e) | Owner + finance | **B** |

### 4.4 Reviews, admin and vendor follow-ups

| ID | Requirement | Implementation | Evidence | Gap | Proposed disposition | Owner / condition | Class |
|---|---|---|---|---|---|---|---|
| **P-2 DEC-2026-052** items 1–5, 7, 8 | PROPOSED; scope §6.8 | 6.8 restrictive defaults | SQL 100; J1 review | open policy (item 6 approved via DEC-2026-057 item 4) | Owner confirms the recommendations (all keep current behavior; §7 D-5). | Owner | **B** |
| P-2b DEC-2026-052 item 9 | "owner/legal decide incentive and disclosure before Credits activate" | `award_review_points` unchanged | — | — | carry to the Credits gate | owner/legal | **C** (item 9 text) |
| **P-4 DEC-2026-058 Top Rated** | PROPOSED | badge still shown | — | "Top Rated" reads as a verified rating with no criterion | Owner approves the recommendation (hide until criteria exist) or an alternative (§7 D-7). If approved, a small UI slice (CS-2). | Owner | **B** |
| **R-3 6.13 retained restrictions** §12.4 items 1–3 | DEC-2026-057 correction 3 ("report, don't invent") | restrictions kept | SQL 108 | (1) no reviewed suspension for 13 legacy providers; (2) listing exclusion also removes matching; (3) no change workflow for bound requests | Owner decides whether each is an accepted beta restriction or needs a slice (§7 D-8). | Owner | **B** |
| R-3b §12.4 items 4–6 | — | — | — | (4) sourcing and applications queues not summarized; (5) = P-4; (6) owner dual-role messaging by design | (4): record as a known limitation; (6): no action | Codex confirms | **D** (as recorded) |
| **W-1** `contractors.special_offer` signed-in SELECT | DEC-2026-055 item 1 ("stored text kept for operator access"); 6.11B follow-up "revoke once no deployed client selects it" | grant still present (`has_column_privilege(authenticated…)` = true on the replayed schema) | no client selects it (only `admin_vendor_special_offer` RPC) | precondition met; still readable by any signed-in user (hosted read 2026-11-03: grant present; 8 providers store text) | **CS-1 implemented for review** (TRACE-138, PR #137): migration `20261110001000` revokes it; operator readback kept; SQL 110. Not pushed, not merged. *2026-11-03: pushed and merged (#137 `d7f073d`); W-1–W-3 move to D once A1 records a review of #137* | Codex review; owner authorizes the dry run and push before merge (DEC-2026-037); then merged | **A** (A3) |
| W-2 `get_vendor_earnings_metrics` | DEC-2026-056 item 1 ("stays for clients deployed before 6.12B") | still granted to `authenticated`; owner-checked; legacy invoices only | no client calls it | precondition met; hygiene, no exposure | **CS-1 implemented for review**: same migration; function kept; `vendor_own_earnings` unchanged | as W-1 | **A** (A3) |
| W-3 `/vendors` copy | DEC-2026-056 items 1–2 (legacy "released" retired; no expected payout date) | `src/app/vendors/page.tsx:31`: "see invoice and payout status when Mercurius releases it. Eligible released work is intended to follow a weekly payout cycle…" | — | the wording still uses the retired legacy "released" model | **CS-1 implemented for review**: eligibility 48 hours after homeowner confirmation is not a set transfer date; failed and unconfirmed transfers aren't counted as paid (DEC-2026-056 items 2, 5; CFG-008); browser test | Codex review of the copy; merged | **A** (A3) |
| W-4 `contractors.payouts_paused_reason` readable | DEC-2026-056 item 3 (vendors never see the internal hold reason) | `payouts_paused`, `payouts_paused_reason`, `payouts_paused_at` are column-granted to `anon` and `authenticated` (20260903160000) | found during CS-1; hosted read 2026-11-03: 0 rows hold a reason; no client selects these columns | any visitor could read a hold reason once one is written | Proposal: a CS-1-style grant slice (CS-7), after a deployed-client check. *2026-11-03: CS-7 implemented for review (TRACE-142): migration `20261111001000` revokes client SELECT on all three columns; no client reads them; SQL 111. Not pushed to hosted* | Codex confirms; owner authorizes the push | **A** (proposed) |
| W-5 `/vendors` eyebrow contrast | MDS accessibility (WCAG 2.2 AA) | "For Service Providers" pill, `text-sage-dark` on `bg-sage-light` | axe in CS-1's browser run: 4.43:1, needs 4.5:1. Pre-existing; the pair may recur elsewhere | contrast shortfall | Proposal: a small token or class fix (CS-8) before the human checks. *2026-11-03: CS-8 implemented for review (TRACE-141): light `--color-sage-dark` 33% → 30% lightness, which fixes every use of the pair; axe on all of `/vendors` passes (fails on the old token)* | Codex | **A** (part of A2) |
| W-6 operator writes to `special_offer` | DEC-2026-055 item 1 restricts vendors; it says nothing about operators | admins can still overwrite the column directly (table UPDATE grant plus the admin bypass in the scope trigger); no client does | CS-1 characterization | stored text could be changed without a record | Proposal: close it with W-4 in CS-7, or record that operator edits are allowed. *2026-11-05: still open; `authenticated` holds column UPDATE on `special_offer` (clean replay of `cbd65a7`). Owner question O-3 in §10.5* | Codex; owner if it's policy | **B** |

### 4.5 Human acceptance, reviews and authority conflicts

| ID | Requirement | Status | Proposed disposition | Class |
|---|---|---|---|---|
| **A1** Codex reviews | PHASE-6-SCOPE acceptance checkpoint | outstanding (§3) | Codex | **A** |
| **A2** Human checks | Roadmap Phase 6 gate; MDS blueprint accessibility and testing requirements (200% zoom and 320px reflow; manual screen-reader checks for request, checkout, vendor job, dispute and admin money actions; rendered review in light/dark, mobile/desktop, keyboard, zoom, screen readers) | **not performed**: screen reader, real devices, `@visual`, 200% zoom for every journey | Performed **last**, on the final acceptance candidate: after every acceptance-affecting repair has merged. That includes CS-1, fixes from the A1 reviews, W-4/W-5, and whichever of CS-2–CS-6 the owner's answers place before acceptance. Each result records the candidate commit. A later change to a surface a script covers invalidates that script's result, and it is rerun on the new candidate. Use [the manual scripts](PHASE-6-MANUAL-ACCEPTANCE.md) and record results there | **A** |
| **X-1** Light/dark gate vs. light-only R0 | Roadmap Phase 6 gate requires light/dark; DEC-2026-026 ships light only; TRACE-106 dark-mode repair PLANNED "before R1 gate" | **authority conflict**, recorded, not chosen | Owner decides: either Phase 6 accepts light-only with dark carried to TRACE-106 before R1, or TRACE-106 lands before acceptance (§7 D-9) | **B** |
| **X-2** `@visual` baselines | Gate requires visual evidence | committed baselines are `win32` PNGs only; CI (Linux) runs `--grep-invert @visual` | Run `@visual` on the owner's Windows machine (manual script V) or approve Linux baselines | **A** (part of A2) |
| Phase 7 items | PHASE-6-SCOPE "Dependencies" | communication delivery, analytics, alerts, SLA automation, runbooks | Phase 7 | **C** (PHASE-6-SCOPE) |
| Hosted Stripe/bank, finance provisioning (0 money authorities), compliance cutover | PHASE-6-SCOPE; DEC-2026-015 §1 | — | Phases 8–9 | **C** |

### 4.6 Deferral register

Every item proposed to be carried past Phase 6 acceptance, or classed C. *2026-11-03: DEC-2026-060 approves the deferrals that D-6d, D-6e, D-8, D-9, D-10, D-11 and D-12 select, with the gate, condition and owner in each row. Rows that say "no authority names a gate" (P-3e, T-3, R-3) are approved as deferrals, but their gate is still unnamed. The owner names it before the item is planned.* The paragraph below is kept as written before the answers. **None of these deferrals is approved.** Each takes effect only when the owner approves it (§7 D-12 for the proposals, or the decision named in the row). "Owner" is the person accountable for the item at its gate. The owner is Josh (OWNER-APPROVALS). Where the row needs a finance reviewer, accountant or legal reviewer, that person hasn't been named; the owner names them. Gate names follow the roadmap. The "R1 gate" is the Phase 9 private-beta activation record ("owner signs the beta activation record after all critical evidence is green"). Where no authority names the gate, the row says so and the gate is a proposal.

| Item | Proposed release gate | Gate authority | Acceptance condition at that gate | Owner |
|---|---|---|---|---|
| Q-1 quote tax | R1 gate, before private beta | DEC-2026-015 §4; DEC-2026-045 G1 (activation dependency) | An accountant-confirmed tax rule is recorded for each quoted category, and a tax-confirmation path is built and tested so a confirmed quote can be approved (J2 extended past "sent") | Owner, with an accountant (not named) |
| F-1 6.6c two-person finance review (if D-10 carries it) | R1 gate, before recurring payments activate | TRACE-125 pre-merge condition (missed); DEC-2026-049 item 5 | A signed two-person finance review of the 6.6c money path (`0ebc9ef`…`7502342`), with any findings fixed | Owner; two finance reviewers (not named) |
| F-2 promotions finance review | Promotions activation (gate closed today) | DEC-2026-042 item 5; DEC-2026-038/041 | Two-person finance review recorded before the gate opens; checkout keeps refusing promotions until then | Owner; two finance reviewers (not named) |
| K-1 P-K1 open checkout during cancellation | Proposed: R1 gate, before any payment session can open. **No authority names the phase** (D-11) | DEC-2026-053 correction 1 (a separate finance-reviewed scope) | A finance-reviewed slice: attaching checkout to a cancelled request is refused and open sessions are expired; SQL and concurrency evidence; the fingerprint change is reviewed | Owner; finance reviewers (not named) |
| K-2 P-K2 capture after cancellation | As K-1 (D-11) | as K-1 | A capture after cancellation is held for reconciliation, never released as payout; same evidence | as K-1 |
| K-3 $25 reschedule fee collection | Payment activation (R1 gate) | DEC-2026-053 E2 | An operations-confirmed, two-person-reviewed separate charge path, never deducted from a refund; until then it's shown as assessed | Owner; finance |
| K-4 supplemental refund | Proposed: R1 gate (D-11) | DEC-2026-053 E11 | A separately authorized, duplicate-protected refund command with tests | Owner; finance |
| K-5 retained cancellation proceeds | Before any retained amount becomes payable | DEC-2026-053 E4 | A finance-approved rule recorded; not payable until then | Owner; finance (not named) |
| P-3b DEC-2026-054 items 2 and 9 | Proposed: R1 gate (D-6e) | DEC-2026-054 data-impact note ("both need the finance review") | Owner decision with finance review; until then a dispute decision records no money outcome | Owner; finance |
| P-3e formal-dispute override (if D-6d defers it) | **No authority names a gate**; owner names one (D-6d) | DEC-2026-054 item 5 (PROPOSED) | An approved rule for eligible or transferred payouts, then CS-6 with finance review of the hold | Owner |
| P-2b review incentives | Credits activation, inside the R1 gate (Credits C0–C4) | DEC-2026-052 item 9; roadmap R1 gate | Owner and legal decide incentive and disclosure; `award_review_points` stays inactive until then | Owner; legal (not named) |
| T-3 DEC-2026-051 items 6–8 | **No authority names a gate**; proposed after Phase 6, owner names it (D-12) | — | Owner decision on each item, then a slice | Owner |
| R-1 DEC-2026-049 items 7–8 (kept blocked) | Before quote-priced, promotional or replacement-provider plans are offered; proposed: the R1 gate if they are offered in beta (D-12) | Owner confirmation 2026-10-27 ("kept blocked") | Approved rules, implemented and tested | Owner |
| S-1 prepaid plans | A separate slice before the R1 gate (D-12) | PHASE-6-SCOPE; DEC-2026-048 "Still required before release" | Implemented, plus the two-person finance review and the MPS §7 amendment | Owner; finance |
| X-1 dark mode (if D-9 accepts light-only) | TRACE-106, before the R1 gate | TRACE-106 (PLANNED "before R1 gate"); DEC-2026-026 | The dark-mode repair merged, and light/dark human checks pass | Owner |
| R-3 §12.4 restrictions 1–3 (if D-8 accepts them as beta restrictions) | **No authority names a gate**; owner names one per restriction (D-8) | DEC-2026-057 correction 3 | Owner decision, then a slice for any restriction that is lifted | Owner |
| R-3b(4) sourcing and application queues not summarized | Phase 7 gate (owned operational queues) | Roadmap Phase 7 | Both queues appear in the operations summary with age and next action | Owner |
| Phase 7 items (delivery, analytics, alerts, SLA automation, runbooks) | Phase 7 gate | PHASE-6-SCOPE "Dependencies"; roadmap Phase 7 | Staged failures and SLA breaches create the right alert, queue item, audit event and communication | Owner |
| Hosted Stripe and bank, finance provisioning (0 money authorities), compliance cutover | Phase 8 gate, then the R1 gate | PHASE-6-SCOPE; DEC-2026-015 §1; roadmap Phases 8–9 | Phase 8 security, restore and rollback drills pass; the owner signs the beta activation record | Owner |

## 5. Integrated acceptance (synthetic, isolated)

### 5.1 New: SQL 109 integrated journeys

[`supabase/tests/109_phase6_integrated_journeys.sql`](../supabase/tests/109_phase6_integrated_journeys.sql), **98/98 PASS**, plus the full suite (100 files, 6,386 tests). It drives the real commands of each slice in sequence, with real role switching. Payments use synthetic webhook events only: nothing calls Stripe or a bank, and no refund or ACH runs. It is rolled back. CI runs it automatically (the backend job copies `supabase/tests`).

| Journey | Covers | Notable assertions |
|---|---|---|
| J1 one-time fixed | submit → exclusive offer → accept → appointment (ET) → two-person reviewed snapshot → checkout → capture → start → completion (two-photo rule) → confirmation → payout hold → earnings → verified review | same-key submit, checkout, start and confirmation retries replay; tampered total refused; duplicate webhook captures once; other homeowner, other provider and the homeowner refused at each command with exact SQLSTATEs; a photo from another job refused; the notes column stays closed to the owner; provider Q never sees P's earnings |
| J2 quote | custom-quote submit → accept → itemized proposal → operator send → approval | **approval refused while tax is pending (Q-1)**; no obligation created |
| J3 recurring | weekly plan → two visits → visit 1 paid, worked, confirmed | retried visit creation reuses the visit; only the plan provider accepts; visit 2's photos can't complete visit 1; confirming visit 1 leaves visit 2 scheduled with no receipt; visit 2 not queued before appointment − 24 h; **an unpaid visit can start (P-1, characterized as current, not approved)** |
| J4 cancellation / reschedule | ≥ 48 h reschedule free; ≥ 72 h cancel | stale preview refused `40001`; retry replays the same operation; 100% entitlement recorded; **refund authorization state `none`: nothing executed** |
| J5 provider withdrawal | provider cancel → quality event → homeowner cancels while replacement open | another provider refused; basis `provider_withdrawal_open`; 100% entitlement, no penalty (E12) |
| J6 support / dispute / appeal | completion → dispute within 48 h → evidence → decision → appeal; general ticket | payout held while disputed; dispute unreadable by others; submission and ticket retries replay; homeowner can't decide; unrelated provider can't appeal |
| Operators and money | — | admin without finance authority sees `finance_exceptions` as `restricted`; homeowner refused the summary; **no refund authorization or attempt, ACH item or transfer created by any journey**; J1 has one checkout attempt despite retries |

### 5.2 Reused evidence (unchanged code at `85bb7c6`)

These are valid because the application code and migrations are unchanged from `85bb7c6` (this PR adds only SQL 109 and documentation).

| Area | Evidence | Run |
|---|---|---|
| Per-slice SQL contracts | SQL 063–108 | this audit (clean replay) and CI 41692704323 |
| Concurrency and retry (submit, offers, quotes, visits, cadence, visit payment, fulfillment, exceptions, resolutions, support, offerings, admin) | `scripts/*-concurrency.mjs` | CI 41692704323 (each step green) |
| Browser, keyboard and axe (non-visual) | `npm run test:a11y` | CI 41692704323 |
| Lint, types, unit, build, secrets | — | CI 41692704323; secret scan rerun locally |

Not rerun locally: the full browser suite. CI's run at the same code is the evidence.

### 5.3 Not performed (not claimed)

Screen reader, real devices, `@visual` and 200% zoom have not been performed for any Phase 6 journey. Axe and keyboard tests don't prove them. The scripts are in [PHASE-6-MANUAL-ACCEPTANCE.md](PHASE-6-MANUAL-ACCEPTANCE.md); each line has an empty result column for the person who performs it.

## 6. Corrections made by this audit (documentation only, history preserved)

- Brief §11 closure checklist: 6.13 forward fix merged (#135, `85bb7c6`) and pushed; F613-18 moved out of "carried"; a dated note points here.
- Brief §12.5: dated annotation that steps 1–4 were completed on 2026-11-03.
- TRACEABILITY: TRACE-125 annotated (merged without the recorded finance review); TRACE-136 annotated (#135 merged); TRACE-137 added.
- PHASE-6-SCOPE, roadmap and HANDOFF: dated 2026-11-03 checkpoint lines. The earlier lines are kept.

- Second pass, 2026-11-03: review gaps restated as evidence gaps; 6.1 and 6.2 reclassified from D to A1 (the recorded reviews are a decision review and a review whose repair wasn't re-reviewed); P-3 split so the new formal-dispute override is a separate decision; deferral register §4.6; A2 timing; decision statuses; W-1–W-3 point to CS-1 (TRACE-138); W-4–W-6 added from the CS-1 characterization.

## 7. Owner decision sheet

*2026-11-03: every item is answered (DEC-2026-060). The status column records each answer; the text above the table is kept as written.* **Every item is OPEN, awaiting the owner's answer.** The recommended option is listed first. It is a proposal for Codex review, not an approval. No item is approved until the owner supplies the answer, and no item may be recorded as approved here, in DECISION-LOG or in TRACEABILITY before then. An answer is recorded with its date and the owner's words.

| # | Question | Options (recommended first) | Blocks | Status |
|---|---|---|---|---|
| D-1 | TRACE-126: what is the agreed price of a one-time fixed request before its snapshot? | (a) the tier revision and price bound at submission (as visits do since 6.6c); (b) current tier until the snapshot, with homeowner re-confirmation on change | CS-3 | **Answered (a)** 2026-11-03 |
| D-2 | TRACE-127: may a visit offered at bound terms be accepted after a catalog change? | (a) yes, at its bound terms (DEC-2026-049 item 6 already applies this to created visits); (b) no; operations re-offers | CS-4 | **Answered (a)** 2026-11-03 |
| D-3 | MPS E1: what makes an appointment confirmed? | (a) for beta, "recorded by Mercurius with a reason" *is* confirmed, with copy unchanged; (b) the provider acknowledges; (c) both parties acknowledge | 6.5 | **Answered (a)** 2026-11-03 |
| D-4 | DEC-2026-050 unpaid start | A (paid only, admin exception) / B (no prerequisite) / C (recurring only), as written in DEC-2026-050 | 6.7 | **Answered A** 2026-11-03 (CS-5) |
| D-5 | DEC-2026-052 items 1–5, 7, 8 | confirm the recommendations as written | 6.8 | **Answered: confirmed** 2026-11-03 |
| D-6a | DEC-2026-054 items 3, 4, 6, 7, 8, 10 | confirm the recommendations; each keeps current behavior | 6.10 | **Answered: confirmed** 2026-11-03 |
| D-6b | DEC-2026-054 item 1, reason categories | confirm (a small reporting slice) / defer | 6.10 | **Answered: confirm** 2026-11-03 (reporting slice) |
| D-6c | DEC-2026-054 item 5, first part: after 48 hours the homeowner uses general support only (current behavior; no dispute, hold or money change) | confirm as the beta behavior / change it | 6.10 | **Answered: confirmed** 2026-11-03 |
| D-6d | DEC-2026-054 item 5, second part: may operations open a formal dispute after 48 hours (new, not built)? | (a) not in Phase 6; general support only, with the gate named in §4.6 / (b) approve, with a rule for an already-eligible or transferred payout, then CS-6 with finance review | 6.10, CS-6 | **Answered (a)** 2026-11-03; gate not named; CS-6 not commissioned |
| D-6e | DEC-2026-054 items 2 and 9 | no money outcome in beta; decide with finance before the R1 gate (§4.6) | 6.10 | **Answered** 2026-11-03 |
| D-7 | DEC-2026-058 "Top Rated" | approve hiding until criteria exist / (a) relabel / (b) remove | CS-2 | **Answered: hide** 2026-11-03 |
| D-8 | 6.13 §12.4 restrictions 1–3 | accept each as a beta restriction / commission a slice | 6.13 | **Answered: accepted as beta restrictions** 2026-11-03; gates not named |
| D-9 | Light/dark gate vs. light-only | accept light-only for Phase 6, with dark carried to TRACE-106 before R1 / TRACE-106 first | gate | **Answered: light-only for Phase 6**, dark to TRACE-106 before R1, 2026-11-03 |
| D-10 | 6.6c finance sign-off (missed before merge) | name two reviewers and review now / carry as an R1 blocker | 6.6 | **Answered: carry as an R1 blocker** (alternative; no reviewers named) 2026-11-03 |
| D-11 | Payment-kernel scopes K-1 (P-K1), K-2 (P-K2) and K-4 (supplemental refund) | carry to the R1 gate as finance-reviewed slices, with the conditions in §4.6 / build in Phase 6 | 6.9 | **Answered: carry to the R1 gate** 2026-11-03 |
| D-12 | Deferrals in §4.6 that no other item decides: DEC-2026-051 items 6–8; DEC-2026-049 items 7–8 kept blocked; prepaid outside Phase 6 | approve each deferral with the gate, condition and owner in §4.6 / decide now | — | **Answered: deferrals approved** 2026-11-03 |

## 8. Corrective slices (proposed, each a reviewed bounded plan)

| Slice | Contents | Size | Gate |
|---|---|---|---|
| **CS-1 post-deploy cleanup** (A3), TRACE-138 | Additive migration `20261110001000` revoking `authenticated` SELECT on `contractors.special_offer` and client EXECUTE on `get_vendor_earnings_metrics(uuid)`; SQL 110; `/vendors` copy aligned with DEC-2026-056; browser test | small; no money function, no fingerprint change. **Implemented for review: PR #137.** Not pushed, not merged. *2026-11-03: `20261110001000` pushed to hosted with owner authorization, then #137 merged (`d7f073d`). No Codex review recorded.* | Codex review; owner authorizes dry run and push before merge (DEC-2026-037) |
| CS-2 Top Rated | hide the badge on public, row and spotlight surfaces and in the editor; data preserved | small, UI | only if D-7 is approved. *Approved 2026-11-03; before acceptance. Implemented for review (TRACE-143)* |
| CS-3 TRACE-126 | one-time agreed-price source per D-1; lock-order fix | money path; fingerprint changes | D-1; two-person finance review. *D-1 (a) 2026-11-03; before acceptance; reviewers Josh + the accountant; cannot merge until the accountant is engaged and both sign. 2026-11-05: plan prepared for Codex ([PHASE-6-BOUND-TERMS-PLAN](PHASE-6-BOUND-TERMS-PLAN.md) §4). Not built* |
| CS-4 TRACE-127 | acceptance at bound terms per D-2 | matching path | D-2. *D-2 (a) 2026-11-03; before acceptance. 2026-11-04: the refusal comes from `private.find_eligible_packages_core`, a fingerprinted money function, so CS-4 is a money-path change: planned with Codex first, two-person finance review (Josh + the accountant) before merge, like CS-3. Not built. 2026-11-05: plan prepared for Codex ([PHASE-6-BOUND-TERMS-PLAN](PHASE-6-BOUND-TERMS-PLAN.md) §3). It leaves `find_eligible_packages_core` unchanged and restates `recurring_visit_source_check` and `vendor_accept_job`. Not built* |
| CS-5 DEC-2026-050 | start gate per D-4 (if A or C) | start guard trigger | D-4. *A 2026-11-03; before acceptance; one-time jobs after CS-3. Recurring visits implemented for review (TRACE-145): migration `20261113001000`; not pushed to hosted* |
| CS-6 formal-dispute override | operator-opened dispute after 48 hours with a reason, and the approved rule for eligible or transferred payouts | dispute and payout-hold path | only if D-6d (b) is approved; finance review of the hold. *Not commissioned: D-6d (a) 2026-11-03* |
| CS-7 hold-reason grants (W-4, W-6) | revoke client SELECT on the `payouts_paused*` columns after a deployed-client check; close or record operator `special_offer` writes | small, privileges | Codex confirms; owner authorizes the push. *W-4 implemented for review (TRACE-142); W-6 is not included and stays an open owner question* |
| CS-8 contrast (W-5) | fix the eyebrow pair's contrast; check other uses of the pair | small, UI | Codex; before A2 |
| CS-9 dispute reason categories (D-6b) | the six DEC-2026-054 item 1 categories on dispute submission, for reporting only; no money or hold effect | small | D-6b confirmed 2026-11-03; before acceptance. *Implemented for review (TRACE-144): migration `20261112001000`, SQL 112; not pushed to hosted* |

## 9. Next bounded repair recommendation

*Updated 2026-11-03 after the owner's answers (DEC-2026-060).* Steps 2 and 3 below are done. The remaining order:

1. **A1:** Codex reviews this report, SQL 109, and every merged diff named in §3, plus #137 and #138, which also merged without a recorded review.
2. **No-decision repairs**, each its own PR: CS-8 (contrast), CS-7 (hold-reason grants; W-6 remains an open question), CS-2 (Top Rated), CS-9 (reason categories).
3. **Matching and start repairs:** CS-4 (D-2), then CS-5 (D-4, recurring visits now).
4. **CS-3** (D-1, the one-time agreed price): it is planned with Codex first and built for review. It can't merge until both finance reviewers, Josh and the accountant (not yet engaged), sign off. Then CS-5 extends the start gate to one-time jobs. **Phase 6 acceptance waits on this.**
5. **A2 human checks last**, on the candidate that contains steps 2–4, light mode only (D-9).
6. The owner decides acceptance after Codex review.

The original recommendation is kept below.

1. **Codex reviews this report, SQL 109 and the CS-1 PR** (#137). A1 starts here, including which merged diffs need their own review.
2. **CS-1:** after review, the owner authorizes the dry run and push of `20261110001000`, then the merge (DEC-2026-037).
3. The **owner answers §7**: D-4, D-3, D-1, D-9 and D-10 have the widest acceptance effect. Each answer is recorded with its date; until then every item stays open.
4. **Acceptance-affecting repairs**, in the order the answers set: the fixes from A1 reviews, CS-7 and CS-8, and whichever of CS-2–CS-6 the answers place before acceptance. **No money-kernel rewrite is proposed here.** CS-3 is bounded to the one-time source and needs finance review.
5. **Human checks (A2) last**, on the final acceptance candidate after step 4 has merged, with the candidate commit recorded on each result.
6. The owner decides acceptance after Codex review. This report and PR #136 are acceptance preparation, not Phase 6 acceptance.

## 10. Closeout packet, 2026-11-05 (TRACE-147)

**Status:** prepared for Codex review. It accepts nothing, approves no policy and closes no A1 gap. **Phase 6 is not accepted, and Phase 7 is not authorized.**

*2026-11-06 checkpoint (verified): #147 merged by the owner as `02e04a0` (2026-11-06 01:54 UTC); `main` CI run 42146902687 green. `main` and hosted now both end at `20261114001000`, so the "`main` lacks one migration" row below is resolved. No Codex review of #147 is recorded in the repository (manifest row 27 stays open). Codex cleared the CS-4/CS-3 plan architecture with five amendments ([plan](PHASE-6-BOUND-TERMS-PLAN.md) §7). The owner confirmed R-1 (DEC-2026-062), so O-1 is answered and O-8 is done. CS-4 is implemented for review (TRACE-148). The rows below are kept as written on 2026-11-05.*

### 10.1 Verified state

| Check | Result |
|---|---|
| `origin/main` | `cbd65a7` (#146), unchanged since the last independent check; CI push run 42043627700 green |
| Open PRs | #147 (TRACE-146) only; CI pull_request run 42052147727 at `bd40701` green |
| Hosted history (read-only) | all 219 local migrations paired, ending at `20261114001000` (#147's, pushed 2026-11-05 with owner authorization). So `main` lacks one migration that hosted has. Merging #147 reconciles that. |
| Hosted aggregates (read-only) | 0 open requests, 0 open visits, 0 obligations, 0 snapshots, 0 plan terms |
| Codex review records | none for any Phase 6 slice or for #136–#147 ([A1 manifest](PHASE-6-A1-REVIEW-MANIFEST.md)) |
| Clean replay `main` | 218 migrations; 103 files / 6,546 PASS; fingerprint `45 \| 34c51131…` |
| Clean replay #147 | 219 migrations; 104 files / 6,576 PASS; fingerprint unchanged |

### 10.2 Completed in this packet

- **CS-4/CS-3 characterization** through the real vendor command, synthetic and rolled back ([plan](PHASE-6-BOUND-TERMS-PLAN.md) §1). TRACE-127 is wider than recorded: no-add-on visits are refused, accepted visits become unpayable, and offered one-time requests can't be accepted. The checkout lock order deadlocks against `vendor_save_package` in a forced-order demonstration (§1.1 there).
- **CS-4/CS-3 technical plan** for Codex, with readings R-1 to R-5. **No money function was changed.** No Codex-reviewed plan existed, so implementation waits.
- **One-time CS-5 extension**: planned as a dependent slice ([plan](PHASE-6-BOUND-TERMS-PLAN.md) §5). Not built; it needs CS-3 merged first.
- **Reconciliation** of CS-1, CS-2, CS-7, CS-8, CS-9 and recurring CS-5 against their merged commits, migrations and tests: no regression found ([manifest](PHASE-6-A1-REVIEW-MANIFEST.md) §3).
- **#147 clean-replay evidence** and its baseline-against-changed comparison (manifest §3, §3.1). No production correction was repeated, and no reject or suspension policy was added.
- **[A1 review manifest](PHASE-6-A1-REVIEW-MANIFEST.md)**: 29 rows with exact ranges.

### 10.3 Finance and human-check requirements

- **Two-person finance review (Josh + the accountant)** before merge, for CS-4 and CS-3 (both change fingerprinted money functions). The accountant is **not engaged**, so neither can merge, and **Phase 6 acceptance is blocked on it** (D-1 and D-2 place both before acceptance). Separate and not to be confused: the carried 6.6c review (F-1, D-10) is an **R1 blocker**, not a Phase 6 gate. F-2 promotions stays at its activation gate.
- **A2 human checks** (light mode only, D-9) run **after** CS-4, CS-3, the one-time CS-5 extension and any A1 fixes have merged. Each runs on that exact candidate SHA, recording the device, browser, assistive technology, person and date in [the scripts](PHASE-6-MANUAL-ACCEPTANCE.md). None has been performed. A result recorded on an earlier candidate doesn't carry over to a surface a later change touches. The candidate isn't final yet: CS-4 changes `/vendor/jobs` acceptance, and CS-3 changes checkout.

### 10.4 Review packet for Codex

1. The CS-4/CS-3 plan, R-1 to R-5 included. **First:** no money function changes until it is cleared.
2. The A1 manifest rows 1–27 (merged slices and #147).
3. This packet's record changes (TRACE-147).

### 10.5 Owner decisions and actions

| # | Decision or action | Recommended | Depends on | Consequence if not done |
|---|---|---|---|---|
| O-1 | Confirm reading R-1 (plan §2) | *"A visit or request priced at bound terms stays acceptable and payable at those terms while its provider still offers that service at that cadence (a live, unreviewed revision of the same offering). Pausing, archiving or removing the offering, or holding it in Package Reviews, still blocks it."* | Codex clears the plan | Under the strict reading, any vendor save (a rename too) blocks every unpaid visit and one-time request on that offering, and CS-4/CS-3 deliver nothing on a real journey |
| O-2 | Engage the accountant (the second finance reviewer) | Engage before CS-4/CS-3 implementation completes, so the review can follow Codex's code review | — | CS-4 and CS-3 can't merge, so Phase 6 can't be accepted. The R1 blockers F-1 and F-2 also wait |
| O-3 | W-6: operator writes to `contractors.special_offer` | *"Operators don't change stored Special Offer text. It stays as stored for operator reading (DEC-2026-055 item 1). Any later need to edit or clear it goes through a recorded command with a reason."* Then a small privileges slice (CS-7 pattern: revoke client UPDATE; no client writes it) | Owner answer; Codex review; push authorization | Stays open; an admin session could change the text without a record. Not an acceptance blocker unless the owner makes it one |
| O-4 | Name the gate for D-6d (operations-opened formal dispute after 48 hours) | *"Decide at the R1 gate whether beta needs it; until then general support only."* | — | The deferral stays approved with no gate (§4.6) |
| O-5 | Name gates for D-8 restrictions | (1) legacy providers without a reviewed suspension: **R1 gate**; (2) listing exclusion also removes matching: **after R1, on pilot evidence**; (3) no change workflow for bound requests: **R1 gate** | — | As O-4 |
| O-6 | Name the gate for DEC-2026-051 items 6–8 (twice-a-year cadence, vendor cadences outside the catalog, guardrail band source) | *"After R1, at the first catalog review."* Current behavior is safe | — | As O-4 |
| O-7 | #147 follow-ups (DEC-2026-061) | Decide J & M All Purpose LLC's `is_active` (onboarding active, `is_active` false). Decide whether reject should change a legacy-listed provider's `is_active`. Neither is inferred here | — | J & M stays unlisted; reject behavior stays as is |
| O-8 | Authorize the #147 merge after Codex review | Merge (hosted already has its migration; the merge reconciles `main` and adds the record) | Codex review | `main` stays one migration behind hosted |
| O-9 | DEC-2026-059 open items (purge collected analytics events; re-issue invitations opened since 2026-11-02) | Kept recorded; nothing purged or re-issued here | Owner | Unchanged |

### 10.6 Checklist before the owner can accept Phase 6 and authorize Phase 7

- [ ] Codex clears the CS-4/CS-3 plan (R-1 to R-5); the owner confirms R-1 (O-1). *2026-11-06: CS-4 architecture cleared with amendments; R-1 confirmed (DEC-2026-062). CS-3's own plan items (R-2 to R-5 as they apply to one-time requests) still need review before CS-3.*
- [ ] Accountant engaged (O-2).
- [ ] CS-4 built, Codex code-reviewed, finance-signed (Josh + accountant), hosted push authorized and done, merged.
- [ ] CS-3 built, the same gates, merged.
- [ ] One-time CS-5 extension built, reviewed, pushed, merged.
- [ ] A1: a recorded Codex review for every manifest row 1–27 (or one integrated review naming every range), with findings fixed in bounded slices.
- [ ] #147 reviewed and merged (O-8). *2026-11-06: merged (`02e04a0`); Codex review still not recorded.*
- [ ] W-6 answered (O-3), and slice merged if "close" is chosen.
- [ ] Gates named for D-6d, D-8 and DEC-2026-051 items 6–8 (O-4 to O-6). These don't block acceptance under D-12, but §4.6 needs them before the items are planned.
- [ ] Final candidate SHA fixed; CI green on it; full SQL suite on a clean replay; fingerprint recorded with every change explained.
- [ ] A2 human checks performed and recorded on that SHA (screen reader, real devices, 200% zoom and 320 px reflow, keyboard, `@visual` on Windows or approved Linux baselines), light mode only.
- [ ] The owner records Phase 6 acceptance. Phase 7 is authorized only by that record.
