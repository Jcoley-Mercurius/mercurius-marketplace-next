# Phase 6 closure report and acceptance preparation (TRACE-137)

**Status:** PREPARED FOR CODEX REVIEW, 2026-11-03 (America/New_York). This is not Phase 6 acceptance. The owner accepts Phase 6 after Codex review (PHASE-6-SCOPE "Phase acceptance checkpoint"). Every disposition below is a **proposal**. None approves a deferral or a policy, and no PROPOSED decision becomes approved here.

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

"Review" means a Codex review recorded in the repository. A PR body saying "reviewed in #x" is noted but is not a review record.

| Slice | Approved requirement | Implementation / `main` | Review and verification | Remaining gap | Proposed disposition | Owner / acceptance condition | Class |
|---|---|---|---|---|---|---|---|
| 6.1 TRACE-095 | CFG-001/002; DEC-2026-020/021; scope §6.1 | `bb57a61`…`c2b9b81` (2026-09-26/27) | Codex D1–D7/ZIP review ([PHASE-6-DECISION-REVIEW](PHASE-6-DECISION-REVIEW.md)); SQL 063–065; J1 submit | none in the slice | accept on journey evidence | Codex journey review | D (pending §5 review) |
| 6.2 TRACE-098 | MDS intake; scope §6.2 | `ec65948`…`63f1537` | Codex review and re-review ([PHASE-6-INTAKE-REVIEW](PHASE-6-INTAKE-REVIEW.md)); SQL 066; browser `request` | human checks (§5.3) | — | as A2 | D (automated) |
| 6.3 TRACE-099 | CFG-009 | `be58eee`…`211a12e` | **Codex re-review recorded as open** ([PHASE-6-MATCHING](PHASE-6-MATCHING.md)); SQL 067; J1 offer | re-review | Codex re-review | Codex | A1 |
| 6.4 TRACE-119 | DEC-2026-045 G1–G6; CFG-015 | #106 `0675805` | no Codex review recorded; SQL 090; J2 | quote approval impossible while tax is pending (§4 Q-1) | see Q-1 | — | A1 + C (Q-1) |
| 6.5 TRACE-121 | MPS §6.3; scope §6.5 | #109 `404ea29` | none recorded; SQL 092; J1 appointment | MPS E1 open: appointments say "recorded" (§4 Q-2) | see Q-2 | — | A1 + B (Q-2) |
| 6.6a–c TRACE-123/124/125 | DEC-2026-049 items 1–6, 9 | #111 `61f0601`, #112 `5e6d6ce`, #113 `7502342` | none recorded; SQL 095–097; J3 | **6.6c merged without the two-person finance review that TRACE-125 required before merge**; items 7–8 blocked (§4 R-1, F-1) | see §4 | — | A1 + B |
| 6.7 TRACE-128 | scope §6.7, incl. "decide and test" unpaid start | #114 `afb7c83` | none recorded; SQL 098; J1/J3 | DEC-2026-050 PROPOSED (§4 P-1) | see P-1 | — | A1 + B |
| 6.8 TRACE-130 | DEC-2026-009/010; scope §6.8 | #116 `de8e802` | **none** (PHASE-6-REVIEWS §9: "Codex review of the merged diff open"); SQL 100; J1 review | DEC-2026-052 (§4 P-2) | Codex review | Codex | A1 + B |
| 6.9A/B TRACE-131/132 | CFG-006/007; DEC-2026-053 E1–E12 | #121 `2dd9bed` | PR body: "reviewed in #118/#119"; no record; SQL 101–102; J4/J5 | P-K1/P-K2, F-1/F-2/F-3 (§4 K-1…K-5) | see §4 | — | A1 + B/C |
| 6.10 TRACE-133 | CFG-008/010/011; DEC-2026-009 | #125 `ad4656b` | none recorded; SQL 103; J6 | DEC-2026-054 (§4 P-3) | see P-3 | — | A1 + B |
| 6.11A/B TRACE-134 | DEC-2026-055 items 1–2 | #126 `475f03d`, #128 `8bcbfbe` | PR body: "reviewed in #124"; no record; SQL 104–105 | signed-in SELECT on `contractors.special_offer` (§4 W-1) | CS-1 | — | A1 + A3 |
| 6.12A TRACE-135 | DEC-2026-056 items 7–8 | #128 `8bcbfbe` | PR body: "reviewed in #127"; no record; SQL 106 | — | — | — | A1 |
| 6.12B TRACE-135 | DEC-2026-056 items 1–6 | #129 `b1a8cc3` | **Codex review open** (handoff 6.12B "Next"); SQL 107; J1/J6 earnings | `/vendors` copy; legacy metrics grant (§4 W-2, W-3) | CS-1 | — | A1 + A3 |
| 6.13 TRACE-136 | DEC-2026-057 as amended | #132 `015f371`; forward fix #135 `85bb7c6` | Codex review of #132 recorded (brief §12.7, 7 findings delivered); **no Codex review of #135 recorded before merge**; SQL 108; J (operators) | retained restrictions §12.4 (§4 R-3); DEC-2026-058 (§4 P-4) | Codex review of #135 | Codex | A1 + B |
| Prepaid plans | DEC-2026-048 (approved, not implemented) | — | — | no implementation (§4 S-1) | see S-1 | owner | B |

**A1 (all slices):** Codex reviews the integrated journeys, plus each merged diff that has no recorded review: 6.3 re-review, 6.4–6.12 and #135. Acceptance condition: a recorded Codex review per slice, or one integrated review naming the diffs it covered.

## 4. Open items register

### 4.1 Pricing and accepted terms

| ID | Approved requirement / decision | Implementation / `main` | Evidence | Remaining gap | Proposed disposition and rationale | Owner / acceptance condition | Class |
|---|---|---|---|---|---|---|---|
| **T-1 TRACE-126** | DEC-2026-034 / 041 item 4: agreed request prices unchanged by later corrections | `private.money_source` one-time path (unchanged since 6.6c) | SQL 097 "KNOWN EXPOSURE (one-time)" | One-time fixed requests price from the *current* tier. An in-place correction changes an unpublished price, a package edit refuses checkout of a published snapshot, and the package→tier lock order can deadlock with a tier edit. | Owner chooses the agreed-price source for one-time requests (§7 D-1). Then a bounded corrective slice (CS-3) with the two-person finance review. Rationale: it contradicts an approved decision on a journey the gate covers, but it changes the money kernel, so it can't be fixed inside this audit. | Owner decision, then CS-3 merged with finance sign-off; or the owner records it as an explicit R1 money-gate blocker | **B** (then A or C as decided) |
| **T-2 TRACE-127** | DEC-2026-049 items 6/8; DEC-2026-042 | `vendor_accept_job`, `find_eligible_packages_core` | SQL 097 "existing rule (unchanged)" | After a price or add-on change, an already-offered add-on visit can't be accepted. It stays offered and unpaid; nothing is repriced. | Owner decides whether a visit offered at bound terms stays acceptable after a catalog change (§7 D-2), then a bounded slice (CS-4). Fails safe today. | Owner decision, then CS-4 | **B** |
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
| K-1 P-K1 open-session window | DEC-2026-053 correction 1: "payment-kernel changes are a separate finance-reviewed scope" | cancellation during open checkout creates a reconciliation state | SQL 101 | `money_attach_checkout` doesn't refuse a cancelled request; open Stripe sessions aren't expired | Proposal: carry to the R1 money gate (no session can open while payments are inactive). No cited authority names the phase, so this needs the owner. | Owner; then a finance-reviewed slice | **B** |
| K-2 P-K2 late capture | same | — (`money_process_payment_event` is fingerprinted) | — | capture after cancellation isn't held | as K-1 | as K-1 | **B** |
| K-3 F-1 $25 fee collection | DEC-2026-053 E2: "Until collection is active the fee is shown as assessed, not charged" | assessed only | SQL 101–102; J4 preview | no collection | carry to payment activation | owner / finance | **C** (E2) |
| K-4 F-2 supplemental refund | E11: "any additional refund requires separate authorization and duplicate protection" | readback names the amount; no command | SQL 102 | no execution path | Proposal: carry to the R1 money gate; owner confirms | owner / finance | **B** |
| K-5 F-3 retained proceeds | E4: "not payable during beta until finance approves a rule" | not payable | SQL 101 | rule absent | carry | finance | **C** (E4) |
| **P-3 DEC-2026-054** items 1, 3–8, 10 | PROPOSED; current behavior kept | 6.10 | SQL 103; J6 | open policy | Owner confirms the recommendations, which keep current behavior except item 5 (§7 D-6). | Owner | **B** |
| P-3b DEC-2026-054 items 2, 9 | PROPOSED; "both need the finance review" | none | — | dispute money outcomes, partial-work penalties | Proposal: keep "no money outcome" for beta and decide with finance before R1; owner confirms | Owner + finance | **B** |

### 4.4 Reviews, admin and vendor follow-ups

| ID | Requirement | Implementation | Evidence | Gap | Proposed disposition | Owner / condition | Class |
|---|---|---|---|---|---|---|---|
| **P-2 DEC-2026-052** items 1–5, 7, 8 | PROPOSED; scope §6.8 | 6.8 restrictive defaults | SQL 100; J1 review | open policy (item 6 approved via DEC-2026-057 item 4) | Owner confirms the recommendations (all keep current behavior; §7 D-5). | Owner | **B** |
| P-2b DEC-2026-052 item 9 | "owner/legal decide incentive and disclosure before Credits activate" | `award_review_points` unchanged | — | — | carry to the Credits gate | owner/legal | **C** (item 9 text) |
| **P-4 DEC-2026-058 Top Rated** | PROPOSED | badge still shown | — | "Top Rated" reads as a verified rating with no criterion | Owner approves the recommendation (hide until criteria exist) or an alternative (§7 D-7). If approved, a small UI slice (CS-2). | Owner | **B** |
| **R-3 6.13 retained restrictions** §12.4 items 1–3 | DEC-2026-057 correction 3 ("report, don't invent") | restrictions kept | SQL 108 | (1) no reviewed suspension for 13 legacy providers; (2) listing exclusion also removes matching; (3) no change workflow for bound requests | Owner decides whether each is an accepted beta restriction or needs a slice (§7 D-8). | Owner | **B** |
| R-3b §12.4 items 4–6 | — | — | — | (4) sourcing and applications queues not summarized; (5) = P-4; (6) owner dual-role messaging by design | (4): record as a known limitation; (6): no action | Codex confirms | **D** (as recorded) |
| **W-1** `contractors.special_offer` signed-in SELECT | DEC-2026-055 item 1 ("stored text kept for operator access"); 6.11B follow-up "revoke once no deployed client selects it" | grant still present (`has_column_privilege(authenticated…)` = true on the replayed schema) | no client selects it (only `admin_vendor_special_offer` RPC) | precondition met; still readable by any signed-in user | CS-1: additive revoke migration | owner authorizes the hosted push | **A** (A3) |
| W-2 `get_vendor_earnings_metrics` | DEC-2026-056 item 1 ("stays for clients deployed before 6.12B") | still granted to `authenticated`; owner-checked; legacy invoices only | no client calls it | precondition met; hygiene, no exposure | CS-1 revoke | as W-1 | **A** (A3) |
| W-3 `/vendors` copy | DEC-2026-056 items 1–2 (legacy "released" retired; no expected payout date) | `src/app/vendors/page.tsx:31`: "see invoice and payout status when Mercurius releases it. Eligible released work is intended to follow a weekly payout cycle…" | — | the wording still uses the retired legacy "released" model | CS-1: align with DEC-2026-056 item 2 wording | Codex review of the copy | **A** (A3) |

### 4.5 Human acceptance, reviews and authority conflicts

| ID | Requirement | Status | Proposed disposition | Class |
|---|---|---|---|---|
| **A1** Codex reviews | PHASE-6-SCOPE acceptance checkpoint | outstanding (§3) | Codex | **A** |
| **A2** Human checks | Roadmap Phase 6 gate; MDS blueprint accessibility and testing requirements (200% zoom and 320px reflow; manual screen-reader checks for request, checkout, vendor job, dispute and admin money actions; rendered review in light/dark, mobile/desktop, keyboard, zoom, screen readers) | **not performed**: screen reader, real devices, `@visual`, 200% zoom for every journey | perform with [the manual scripts](PHASE-6-MANUAL-ACCEPTANCE.md); record results there | **A** |
| **X-1** Light/dark gate vs. light-only R0 | Roadmap Phase 6 gate requires light/dark; DEC-2026-026 ships light only; TRACE-106 dark-mode repair PLANNED "before R1 gate" | **authority conflict**, recorded, not chosen | Owner decides: either Phase 6 accepts light-only with dark carried to TRACE-106 before R1, or TRACE-106 lands before acceptance (§7 D-9) | **B** |
| **X-2** `@visual` baselines | Gate requires visual evidence | committed baselines are `win32` PNGs only; CI (Linux) runs `--grep-invert @visual` | Run `@visual` on the owner's Windows machine (manual script V) or approve Linux baselines | **A** (part of A2) |
| Phase 7 items | PHASE-6-SCOPE "Dependencies" | communication delivery, analytics, alerts, SLA automation, runbooks | Phase 7 | **C** (PHASE-6-SCOPE) |
| Hosted Stripe/bank, finance provisioning (0 money authorities), compliance cutover | PHASE-6-SCOPE; DEC-2026-015 §1 | — | Phases 8–9 | **C** |

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

## 7. Owner decision sheet

Each item names the recommended answer first. None is approved by this document.

| # | Question | Options (recommended first) | Blocks |
|---|---|---|---|
| D-1 | TRACE-126: what is the agreed price of a one-time fixed request before its snapshot? | (a) the tier revision and price bound at submission (as visits do since 6.6c); (b) current tier until the snapshot, with homeowner re-confirmation on change | CS-3 |
| D-2 | TRACE-127: may a visit offered at bound terms be accepted after a catalog change? | (a) yes, at its bound terms (DEC-2026-049 item 6 already applies this to created visits); (b) no; operations re-offers | CS-4 |
| D-3 | MPS E1: what makes an appointment confirmed? | (a) for beta, "recorded by Mercurius with a reason" *is* confirmed, with copy unchanged; (b) the provider acknowledges; (c) both parties acknowledge | 6.5 |
| D-4 | DEC-2026-050 unpaid start | A (paid only, admin exception) / B (no prerequisite) / C (recurring only), as written in DEC-2026-050 | 6.7 |
| D-5 | DEC-2026-052 items 1–5, 7, 8 | confirm the recommendations as written | 6.8 |
| D-6 | DEC-2026-054 items 1, 3–8, 10; and items 2, 9 | confirm the recommendations; for 2 and 9, "no money outcome in beta; decide with finance before R1" | 6.10 |
| D-7 | DEC-2026-058 "Top Rated" | approve hiding until criteria exist / (a) relabel / (b) remove | CS-2 |
| D-8 | 6.13 §12.4 restrictions 1–3 | accept each as a beta restriction / commission a slice | 6.13 |
| D-9 | Light/dark gate vs. light-only | accept light-only for Phase 6, with dark carried to TRACE-106 before R1 / TRACE-106 first | gate |
| D-10 | 6.6c finance sign-off (missed before merge) | name two reviewers and review now / carry as an R1 blocker | 6.6 |
| D-11 | Payment-kernel scopes P-K1, P-K2, F-2 | carry to the R1 money gate as a finance-reviewed slice / build in Phase 6 | 6.9 |
| D-12 | Deferrals: DEC-2026-051 items 6–8; DEC-2026-049 items 7–8 kept blocked; prepaid outside Phase 6 | approve the deferrals / decide now | — |

## 8. Corrective slices (proposed, each a reviewed bounded plan)

| Slice | Contents | Size | Gate |
|---|---|---|---|
| **CS-1 post-deploy cleanup** (A3) | Additive migration revoking `authenticated` SELECT on `contractors.special_offer` and EXECUTE on `get_vendor_earnings_metrics(uuid)`; SQL assertions; `/vendors` copy aligned with DEC-2026-056 | small; no money function, no fingerprint change | Codex review; owner authorizes dry run and push before merge (DEC-2026-037) |
| CS-2 Top Rated | hide the badge on public, row and spotlight surfaces and in the editor; data preserved | small, UI | only if D-7 is approved |
| CS-3 TRACE-126 | one-time agreed-price source per D-1; lock-order fix | money path; fingerprint changes | D-1; two-person finance review |
| CS-4 TRACE-127 | acceptance at bound terms per D-2 | matching path | D-2 |
| CS-5 DEC-2026-050 | start gate per D-4 (if A or C) | start guard trigger | D-4 |

## 9. Next bounded repair recommendation

1. **Codex reviews this report and SQL 109** (A1 starts here), including which merged diffs need their own review.
2. **CS-1** is the only substantive repair that needs no owner policy answer. Implement it next as its own reviewed slice.
3. The **owner answers §7**: D-4, D-3, D-1, D-9 and D-10 have the widest acceptance effect.
4. **Human checks** (A2) on the final candidate, after CS-1 and any CS-2/CS-5 UI changes, so the evidence isn't invalidated.
5. Then CS-3/CS-4/CS-5 as the decisions dictate. **No money-kernel rewrite is proposed here**; CS-3 is bounded to the one-time source and is subject to finance review.
