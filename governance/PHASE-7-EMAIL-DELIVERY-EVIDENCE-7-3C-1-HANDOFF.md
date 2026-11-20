# Phase 7.3C-1 — Owner Emails delivery evidence: implementation handoff (TRACE-155)

> **Correction (2026-11-19; the text below is kept as written on 2026-11-16):** two statements are stale.
> - The Codex implementation review of #169 now exists: retrospective source review [5926513941](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/169#pullrequestreview-5926513941), with no blocking finding (§1.2 and §6 item 1).
> - The "decisions needed" are settled. Codex review [5926523770](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/170#pullrequestreview-5926523770) cleared this handoff for local, dormant implementation and accepted C3C-1..C3C-6 with five integration requirements (§6 item 2, §7).
>
> The §3.3 amendment is now in the governing plan (§7.3, §7.5, §13.3, S-57 and §18.3). Implementation: [7.3C-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1.md), under the same TRACE-155. Push provenance, the preflight record, the 503 probe, EO-1..EO-8 and every carried item remain open.
>
> **Correction (2026-11-19 ET, later):** the "nothing here is implemented" status is superseded. 7.3C-1 was implemented in #180, which merged as `main` `9e7fd39` (PR CI 44628358534 and main CI 44638058722 succeeded), and Codex reviewed it retrospectively in [5985392153](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/180#pullrequestreview-5985392153) with no blocking finding. The deferred application and price-draft work is the [7.3C-2 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-2.md).

**Status: PROPOSED SLICE, documentation only.** Nothing here is implemented. It defines the smallest first 7.3C slice for Codex review. It is not a plan revision, an implementation authorization, a hosted action or an owner decision.
**Base:** `main` `e25e7f849a4c18f44e9a71e5bd5fb94ffaed631b` (#169 merged). Branch `claude/phase7-3c1-evidence-readback-handoff`.
**Governing:** [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §5, §7.1–§7.5, §8.3–§8.5, §9.1–§9.2, §11.4, §13.3 (7.3C), §14 (S-37–S-51, S-57); [7.3B record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3B.md) §4. Settled plan decisions are reused, not reopened.

## 1. Verified baseline (2026-11-16, read-only)

### 1.1 Verified release facts for #169

| Fact | Evidence |
|---|---|
| Merged | #169 merged 2026-11-16 16:38:18 UTC as `e25e7f8` (PR head `b0c7fa5`) |
| PR exact-head CI | Run 43888756983 on `b0c7fa5`: **success** (backend, lifecycle, application) |
| Main merge CI | Run 43909709363 (push) on `e25e7f8`: **success** |
| Production deployment | GitHub deployment 7830152319 for `e25e7f8`: Production, status `success` at 16:39:26 UTC. Its URL is Vercel `dpl_AiiAmRxcd3oXKgne2QbRzUHvBK9V`, which `vercel inspect` reads as **Ready**, target production, created 11:38:22 ET. This links the deployment to the commit through GitHub metadata; the Vercel commit-SHA field was not read |
| Hosted migrations | `supabase migration list --linked`, rerun for this handoff: local and remote match through **`20261124001000`**, which is the hosted head |
| Hosted object readback | Recorded on #169 (comment, 19:24 UTC): objects present; 0 receipts; ledger `provider_message_id` indexes valid; the six new functions' `md5(prosrc)`, security definer, `search_path` and grants match `b0c7fa5`. **Not re-run here** |
| Receiver state | No `RESEND_WEBHOOK_SECRET` set and no webhook registered, per #169's record and comment. Not re-verified here: reading the secret store or provider was out of scope |

### 1.2 Unfinished 7.3B acceptance checks (not claimed)

| Item | State |
|---|---|
| **Codex implementation review of #169** | **None recorded.** The GitHub reviews and review-comments APIs both return empty. A merge is not review acceptance. **This is a dependency (§6).** |
| Pre-push preflight and push provenance | The record's §7 preflight (`scripts/email-provider-events-preflight.sql`) is not recorded as run. The #169 comment says `20261124001000` "was already present when checked; it was not pushed from this session". Who pushed it, when, and whether that was before merge (DEC-2026-037) are **not recorded** |
| Post-deploy dormancy probe | Record §7 step 6: a read-only probe confirming `POST /api/webhooks/resend` → 503. **Not run** (not run here either) |
| 7.3B record status line and §5.6 | The status line said "not pushed, merged or deployed" and §5.6 held placeholders. This PR adds a dated factual status above it and does not rewrite the original |
| Carried items | EO-1..EO-8 (all unapproved); the 7.3D proofs in record §8; CFG-011; A2; the retrospective 7.2B review; the #167 review, READY readback and renewal-window reconciliation; real-email verification for 7.2C-1/7.2C-2; final booking-readiness checks; `request.spec.ts:837`. **All remain open.** |

## 2. Slice boundary: 7.3C-1 (owner-email ledger only)

The plan's 7.3C (§13.3) covers tags and readback for all three ledgers. The smallest reviewable first slice is the **owner-email ledger**, matching EC-9 (owner emails first):

| In 7.3C-1 | Deferred to 7.3C-2 |
|---|---|
| Opt-in `tags` on the shared sender; tags on `deliverOwnerEmail` (contact submission and renewal document) | Tags on the application ledger (`deliverApplicationNotification`) and price-draft notices |
| Ledger-independent read-time agreement and summary functions (they read all three ledgers for `I'`, as §7.3 requires) | The Recruiting and price-draft readbacks |
| The Owner Emails readback: per-row summary, history, conflict signal, additive counts, retention backlog | — |

**The arming gate is unchanged.** 7.3D arms only after **both** 7.3C slices are deployed and every ledger send is tagged (§13.3).

## 3. Scope

### 3.1 Opt-in correlation tags (plan §7.1, EC-5)

- `sendNotificationEmail` gains an optional `tags` field on its notification argument. When absent, the request body is **byte-identical** to today's. When present, it adds only `tags: [{name:"mm_ledger"},{name:"mm_ref"},{name:"mm_attempt"}]`. Recipient, `from`, subject, text, `reply_to`, `Idempotency-Key`, timeout and result classification are unchanged.
- A new `src/lib/emailEvidence/correlationTags.ts` builds and validates the set. It accepts only ledger ∈ {`application`,`owner_email`,`package_draft`}, a lowercase canonical UUID, and an integer attempt 1–10,000. It is a pure function of (ledger, row, attempt), so a given Idempotency-Key always carries the same tags. That keeps "one key per attempt, never a reused key with a different body".
- **The tag ref for `owner_email` is the ledger row `id`.** 7.3B resolves it against `private.owner_email_notifications.id` (migration `20261124001000` line 187), but `owner_email_claim` returns only `claim_id`, `attempt`, `kind` and `source`. **Proposed (C3C-1):** a new read-only `public.owner_email_correlation_ref(p_kind, p_source) returns uuid`, `stable`, service-role only, called after a successful claim. `owner_email_claim` is **not** restated, so the 7.2C-1 hash `12 | 016c0e68…` stays unchanged (plan §8.5).
- **If the ref lookup fails or returns null (C3C-2):** send **untagged** exactly as today, and log a new v2 code (for example `correlation_ref_unavailable`). An untagged send links `id_only` when its ID is recorded, and is `unmatched` otherwise. Claims, record arguments, attempt counts and attestations are unchanged either way.

### 3.2 Read-side evidence (plan §7.3, §8.3, §8.4, §11.4)

One additive migration with **functions only**: no table, column, constraint, trigger or grant change on any existing object, and no 7.2C, application, price-draft, 7.3B or money-fingerprinted function restated.

| Function | Access | Purpose |
|---|---|---|
| `private.email_evidence_trusted(receipt)` (or set-based equivalent) | Private | The §8.3 trust test: linked class, `recorded`, no `content_conflict`, `expires_at > now()`, and the §7.3 recheck (`I'` via the existing `private.email_provider_id_candidate`) |
| `private.email_evidence_summary(ledger, row, attempt)` | Private | Fact set F and the first-match rule 1–10, with `delivered_fact`, `non_delivery_proven`, `needs_review` and `has_conflict`. Rule 9 versus 10 uses `email_evidence_config.armed_at` against the attempt's `claimed_at` (§8.4). The config stays empty in 7.3C-1, so every row reads rule 10 |
| `public.owner_email_evidence(p_kind, p_sources uuid[])` | `vendor_require_operator()`; array bounded to the overview page limit | The visible page's per-row summary and per-attempt history: event type, provider time as received, bounce category, and an exclusion reason enum. **Never** IDs, tags, `svix-id`, email ID or slot |
| `public.owner_email_evidence_counts()` | Operator | The §9.1 additive counts: "Not delivered (Resend reported)", "Provider reports to review", "Conflicting provider reports" (per row plus global by `identity_class`), "Unmatched provider reports" (global, by type), and the retention backlog (expired count, oldest expiry) |

All four are `stable` and **perform no write**. There is no purge, flag, quarantine row or `armed_at` write on the read side. The existing `owner_email_overview` is unchanged, and the page calls the evidence function for its visible rows.

The summary derivation lives in SQL, as the single authority. `src/lib/emailEvidence/labels.ts` maps rule and enum values to the §8.3 labels (C3C-4).

### 3.3 Conflict exclusion: current snapshot (7.3B §4 option b) — proposed for Codex

This slice adopts **option (b), current-snapshot exclusion**. It adds no permanent quarantine and no hidden read-side writes. The two conflict kinds stay separate in code, labels and tests:

| Kind | Source | Durability | Operator wording (proposal) |
|---|---|---|---|
| **Stored conflict**: `conflict_disagree`, `conflict_id_ambiguous`, `conflict_tag_invalid`, `content_conflict` | Written once at receipt; guarded immutable by the 7.3B trigger | **Permanent for the receipt's stored life**; ends only at its own expiry. Deleting the row its `tag_ref` names does not make it trusted | "Conflicting provider report — excluded from this summary." |
| **Current conflict**: derived `id_conflict` (§7.3) | Recomputed at every read from the current ledger snapshot | **Not durable.** Excluded while another ledger row holds a conflicting `provider_message_id`. If that row is deleted (for example its source is deleted and the ledger row cascades), the receipt **can count again** at the next read | "Conflicting provider report — excluded while another email record holds the same provider ID. If that record is removed, this report can count again." |

**Plan amendment for Codex to accept:** S-57's "never restored to trusted" and §7.3's "can only remove trust" hold for **stored** conflicts only. A derived `id_conflict` is excluded on the current snapshot, and is restored if the conflicting row disappears. The summary, counts and history all use the same predicate, so no surface shows a different trust answer. The history marks an excluded receipt with its reason enum (`stored_conflict`, `current_conflict` or `content_conflict`).

### 3.4 Expiry, counts and history (plan §11.4, §9.1)

- Logical expiry uses the same predicate as 7.3B: a receipt with `expires_at <= now()` is excluded from the summary, history, every count and the conflict signal. Only the backlog count sees it, and only as a number and oldest expiry.
- **The readback never purges.** Physical deletion stays with receipt-time purge and the existing operator command (`email_provider_events_purge`). This slice adds **no purge control to the UI** (EO-2 is open).
- Per-row summary: the row's **current attempt** (`attempts`). History: per attempt, expandable. "Not delivered" counts only `sent` rows with `non_delivery_proven` on the sent attempt (S-47). Existing attention counts are unchanged.
- Labels follow §5: never "Delivered", "Received", "Read" or "Confirmed" alone. Rule 4 always carries "Not proof it reached the inbox or was read". "Also reported", never "later".

## 4. Affected files (expected)

| File | Change |
|---|---|
| `supabase/migrations/2026112500x000_phase7_email_evidence_readback.sql` | New, additive, functions and grants only |
| `src/lib/ownerNotifications.ts` | Optional `tags`; body unchanged when absent |
| `src/lib/emailEvidence/correlationTags.ts` | New builder and validator |
| `src/lib/emailEvidence/labels.ts` | New rule and enum → label mapping |
| `src/lib/ownerEmailNotifications.ts` | Ref lookup after claim; tags passed to `send`; untagged fallback |
| `src/lib/observability/operationalLog.ts` | v2 code addition only; v1 unchanged; still 16 keys |
| `src/lib/ownerEmails.ts`, `src/app/admin/owner-emails/page.tsx` | Evidence types; summary, history disclosure, conflict signal and counts (MDS components) |
| `supabase/tests/122_email_evidence_readback.sql` | New |
| `tests/unit/email-correlation-tags.test.ts`, `tests/unit/owner-email-ledger.test.ts` | New / extended |
| `tests/e2e/owner-emails.spec.ts` | Extended |
| `scripts/email-provider-events-concurrency.mjs` | S-37 race added |
| `governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1.md`, `TRACEABILITY.md`, `docs/agent/HANDOFF.md` | Record and evidence |

**Not touched:** the receiver route and its handling; the 7.3B migration and functions; every ledger table and function; application and price-draft senders; env and secrets; `vercel.json`; Cron; suppression.

## 5. Synthetic acceptance tests (all local, synthetic)

**SQL 122** (receipts inserted through `email_receive_provider_event` as service role, as in SQL 121):

| Case | Expected |
|---|---|
| **S-37 callback before outcome recording.** Claim attempt 1 (row `sending`); receive a tagged `email.delivered`; then (a) record `sent` with the same ID, (b) record `sent` with a different ID, (c) record `unknown` | Receipt `tag_only`, linked at receipt. (a) trusted, rule 4; (b) `current_conflict`, excluded, `has_conflict`; (c) trusted, rule 4 on an `unknown` row (S-38). The stored `identity_class` is unchanged in all three |
| **S-57 revised + conflicting-source deletion.** `tag_only` receipt on contact row X; renewal-row Y records the same ID → excluded; delete Y's source (or ledger row) | Before Y: trusted. After Y records: excluded as `current_conflict`. **After the deletion: trusted again, the summary returns, and the counts move back.** The `id_only` variant behaves the same |
| **Stored conflict is not restored.** `conflict_disagree` receipt naming X and Y; delete Y's source | Still excluded (`stored_conflict`) until its own expiry |
| **No hidden writes.** Run every readback and count function | Digests of `email_provider_events`, `email_provider_event_purges`, `email_evidence_config` and the three ledgers are identical before and after; expired rows are still stored; all functions are `stable` (`provolatile = 's'`) |
| **Expiry.** Receipts at `expires_at − 1 s` and `expires_at` (S-34 readback side) | Visible, then excluded from the summary, history, counts and conflict signal; counted only in the backlog |
| S-39–S-43, S-45–S-47 | As the plan states, including complaint ≠ not delivered, inconclusive bounces, rule 2 "also reported" with equal or missing timestamps, and a content-conflicted bounce excluded |
| **S-44** | All arrival permutations of fixed fact sets (plpgsql loop) give identical summaries and flags |
| **S-49** | `armed_at` after the claim → rule 10; before → rule 9 (config row inserted by the test owner only) |
| Access | Readback, counts: anon, authenticated, vendor and homeowner get 42501. The correlation ref is service role only. Output keys contain no ID, tag, `svix-id` or email ID. Oversized arrays are refused |
| Unchanged definitions | Fingerprint `58 \| af0fae6e…`; application `10 \| 5f14532a…`; 7.2C-1 `12 \| 016c0e68…`; renewal submit and trigger; price-draft `4 \| fddc8bb9…`; the six 7.3B functions' hashes as read back on #169 |

**Unit:** body byte-identical without tags; with tags, only the `tags` key is added; recipient and Idempotency-Key unchanged; tags deterministic per (ledger, row, attempt) and parse as `valid` through 7.3B's `correlationTags`; ref lookup error or null → untagged send with claim and record arguments unchanged; S-51 stale worker 40001 unchanged; label mapping (S-50) and the rule 4 disclaimer. Mutations: tag added when absent; tag attempt off by one; derived conflict treated as permanent; expired receipt counted.

**Concurrency (real database):** a tagged receive racing `owner_email_record` with a matching and a different ID. Never a link to the wrong row; the readback is trusted only when the IDs agree.

**Browser:** summary, disclaimer, history disclosure, both conflict wordings, counts, rule 10 while unarmed; axe; 320 px; keyboard.

## 6. Dependencies (before application or database implementation starts)

1. **Codex implementation review of #169 (7.3B)**, retrospective at `b0c7fa5` / `e25e7f8`. 7.3C-1 builds on its functions, so any finding is fixed forward first.
2. **Codex review of this handoff**: C3C-1..C3C-6 (§7), and the §3.3 amendment to S-57.
3. Freshly verified `main` and green main CI at branch time.

The 7.3B open items in §1.2 (push provenance, preflight record, dormancy probe) do not block local implementation, but they must not be described as done.

## 7. Decisions needed from Codex

| ID | Question | Proposal |
|---|---|---|
| C3C-1 | How does the sender learn the `owner_email` row `id`? | A new read-only service-role `owner_email_correlation_ref`; no restatement of `owner_email_claim` |
| C3C-2 | Ref lookup failure | Send untagged as today and log a code; never block or alter the send |
| C3C-3 | Conflict durability | Current-snapshot exclusion (§3.3) with the S-57 amendment |
| C3C-4 | Where the derivation lives | SQL is authoritative; TypeScript maps labels only |
| C3C-5 | Slice split | 7.3C-1 owner emails; 7.3C-2 application and price-draft; arming after both |
| C3C-6 | Row summary attempt | Current attempt for the row; counts on the sent attempt; history per attempt |

Owner decisions EO-1..EO-8 stay unresolved. 7.3C-1 needs none of them, because it neither arms nor collects.

## 8. Rollout boundary

1. Implementation PR → Codex review → green exact-head CI.
2. **Separate owner authorization:** dry run listing only the new migration, then `supabase db push --linked` **before merge** (DEC-2026-037), then a read-only readback (functions, grants, unchanged hashes and fingerprint). The migration adds functions only; no table lock beyond the catalog.
3. Merge = production deploy. Effects: production owner-email sends gain three opaque tags (no change to recipient, content, claims or keys), and Owner Emails shows "Delivery evidence not available" (rule 10) for every row, because the receiver is unarmed and stores nothing.
4. Rollback: promote the previous deployment; the functions stay unused; fix forward.

**Out of scope:** secrets, webhook registration, sends of any test email, receiver arming, `armed_at` writes, suppression, retries, Cron, resend after non-delivery (7.3F), booking, payments, mock booking, and any hosted change in this documentation PR.
