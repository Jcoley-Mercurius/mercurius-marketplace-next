# Phase 6 slice 6.3 — Matching and offers (TRACE-099)

Date: 2026-09-27. Branch `codex/phase6-matching-offers`, **stacked on `63f1537`**
(`codex/phase6-intake-repair`, PR #62, the P6-R2/P6-R3 repair). Merged `main` contains only 6.1;
the 6.2 stack (PR #63) and the repair (PR #62) are open. The owner said to start 6.3, so this
stacks on the repair, as 6.2 stacked on P6-R1. **The P6-R2/P6-R3 Codex re-review is still open.**

Brief: [PHASE-6-MATCHING-BRIEF.md](PHASE-6-MATCHING-BRIEF.md). Authorities: MPS §§4/5.2/6.2,
MDS §§4–5/8–9, MTS §§4/6/7/13, CFG-002/003/007/009, DEC-2026-007. Local synthetic data only.
No hosted migration, deployment, message, charge, payout or scheduler change.

## Characterization

Live definitions were read from the local database at migration head `20260928000000`, not from
original migration bodies. Baseline SQL (004/006/012/029/063/066): 186/186.

The commands already meet the matching contract. The browser surfaces and one trigger do not.

| # | Baseline | Now |
|---|---|---|
| B1 | `create_job_offer_internal` sets `contractor_id` when it **offers**. The homeowner list said “Provider assigned” and the job dialog loaded and showed the offered provider's card with “Message provider” while the offer was only pending. | `src/lib/offerStatus.ts` derives one status from stored state. A provider card appears only after acceptance (`matching_status='matched'`). A pending offer reads “Waiting for a provider to respond”, with its ET deadline. |
| B2 | Consent appeared only as a `matching_status` check; success was a toast whatever the database recorded. A lost response or a retry after consent reported a failure. | Consent sits in a provider-status section with the next action. Its outcome is read from `matching_fallback_consents`, so a lost response or duplicate submit is reported as saved, and an unrecorded consent stays recoverable inline. The copy states one provider at a time and the exhaustion outcome. |
| B3 | Saved intake confirmation said “A time is scheduled” for `scheduled`. Acceptance sets `scheduled` with no `scheduled_start_at` (DEC-2026-007). | “Scheduled with your provider. Any appointment time appears in your dashboard once it's recorded.” (distinct from the P6-R2 initial-acceptance sentence). |
| B4 | The homeowner dashboard never advanced lapsed offers. Without a scheduler, a closed window could show as open indefinitely. | The dashboard calls the existing `expire_stale_matches` first (permitted for the owner; best effort), as the vendor and admin pages already do. |
| B5 | Vendor accept was one click. Success was decided by `status='scheduled'` alone. A lost response or refusal became a toast. Accepted quote work was described as “confirms the assignment”. The deadline was browser-local with no timezone. | Accept and decline both confirm first (commitment tone; CFG-007 consequence). Every outcome is read back: accepted (quote: price not set; no appointment unless recorded), gone (expired, withdrawn or reassigned), still open (inline, recoverable; eligibility refusal explained) or unknown (“check again”, never guessed). Absolute deadline in ET plus time left, with no live countdown announcement. Offers re-read on focus/visibility; a failed silent refresh says so. |
| B6 | Decline copy promised “the request will return to Mercurius for another provider match”. | “Mercurius may offer it to another eligible provider, ask the homeowner how to proceed, or tell them it isn't available yet.” |
| B7 | **Trigger defect.** `enforce_vendor_update_scope` was `SECURITY DEFINER`, so `current_user` inside it was always the owner and its `current_user <> 'authenticated'` early return always fired. Any vendor on the request, **including one holding only a pending offer**, could rewrite the homeowner's address, city, state, ZIP, description, preferred date/time and notes by direct REST update. It was the only definer function testing `current_user`. | Migration `20260929000000` makes it `SECURITY INVOKER` (like the homeowner trigger) and refuses any direct vendor write before acceptance. After acceptance the original allowlist applies unchanged. No app path writes the request directly as a vendor; RPCs are unaffected. |

Kept unchanged: `start_request_matching`, `offer_next_for_request(_internal)`,
`create_job_offer(_internal)`, `consent_to_provider_fallback`, `vendor_accept_job`,
`vendor_decline_job`, `expire_stale_matches`, `release_job_match`, balanced-v1 ranking, the
one-pending-offer unique index, the advisory-lock → row-lock order, the D4 fixed/quote dispatch
boundary, commercial snapshots, and the 6.2 intake contract.

## Migration order and recovery

`20260929000000_trace099_vendor_request_write_scope.sql` follows `20260928000000`. It replaces
one trigger function body and its security mode; the trigger, RLS policies, grants and RPCs are
unchanged. It is forward-only; recovery is a later forward migration. Hosted state is unverified.
If the hosted function matches the recovered one, the write bypass exists in production. Hosted
reconciliation belongs to Phase 8 and needs owner authorization.

## Acceptance evidence

| ID | Evidence | Result |
|---|---|---|
| M1 | SQL 067: pool excludes inactive/uncovered; unselected request → first ranked (stable ID tie-break); selected eligible provider first; four-hour window. Script check 1. Existing 006/012/029 unchanged. | pass |
| M2 | Script (real REST/RPC, concurrent sessions): 6 parallel accepts → one schedule, one event, one notice; accept vs decline race → exactly one outcome; accepts racing expiry + restarts after deadline → no schedule, one expiry, one next offer; accept 3 s before deadline succeeds. SQL 067: refused at deadline, accepted 1 ms before. | 11/11, 4 consecutive runs |
| M3 | SQL 067 + script: selected-provider decline → `awaiting_consent`, no offer; other homeowner, vendor, admin, anonymous cannot consent; 6 parallel consents → one record, one audit, one offer; consent preserves preference; decline/expiry advance one at a time; exhaustion → `pending`/`exhausted`, admin review, no offer; restarts create nothing. UI copy “Not available yet in your area”, no sourcing promise (unit). | pass |
| M4 | Other vendor/homeowner/anonymous accept/decline refused (SQL + REST). Offered vendor: can read the request row; cannot read the homeowner profile; cannot write it (repair). Other vendor cannot read or write. After decline, access is lost. Accepted vendor: notes allowlist kept; address/ZIP refused. Red check: 067 against the pre-repair function fails exactly the 5 write-scope assertions. | pass |
| M5 | Browser (`tests/e2e/matching.spec.ts`): accepted quote read-back; lost response recovered with one call; expired → re-read; withdrawn → removed; ineligible inline and still actionable; unreadable result → check again; decline read-back; lapsed window disables; focus re-reads. Homeowner: pending offer ≠ assignment; exhaustion; consent from stored record on lost response; unrecorded consent recoverable. | 14/14 |
| M6 | axe (WCAG 2.2 AA tags) on vendor offers light 320 / dark 1440 with the confirm dialog open, homeowner dialog light/dark, consent dialog; 320px no horizontal scroll; keyboard focus return and alert focus; screenshots. | pass (automated) |

Other checks: unit 299/299 (13 new); typecheck; secret scan; full-repo ESLint (exit 0);
full SQL regression 3298 assertions / 58 files on the main local stack; **clean reset** of the
isolated stack from all migrations (synced into `.phase5-local`), then 3298 / 58 PASS; on the reset
stack, TRACE-099 script 11/11 and TRACE-097 completion script 62/62 (then reset again to remove its
fixtures); 6.1 submission script 32/32 against the repaired trigger. Synthetic build
(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831`, `MERCURIUS_BUILD_WORKERS=1`); whole browser
suite `--grep-invert @visual` 327/328, the failure being the Phase 4 fallback test. Its fixture
answers the new consent read-back with 503, which postgrest-js retries for about 7 s; the test now stubs
an unrecorded consent and passes (phase4.spec 5/5). Two matching tests are marked `test.slow()`
(two axe scans plus a screenshot exceeded 30 s on this machine).

**Not performed:** human screen-reader check, 200% browser-zoom pass beyond the 320px reflow
check, `@visual` baselines, hosted/CI runs.
No live scheduler, notification delivery or money integration is claimed.

## Decisions for Codex / owner

1. **Stack base** — stacked on the unreviewed P6-R2/P6-R3 repair on the owner's instruction.
2. **Write-scope repair (B7)** — reviewed as a narrow forward fix inside M4. Owner: consider
   prioritizing hosted verification of this trigger ahead of Phase 8.
3. **Offered-vendor read access** — before accepting, the offered vendor reads the street
   address, notes, answers and request photos (RLS follows `contractor_id`, which the offer sets).
   The homeowner's name/contact is never readable. MPS §6.2 forbids customer details “before the
   approved workflow point”, which no authority defines. Unchanged; needs a decision.
4. **Early consent** — `consent_to_provider_fallback` accepts consent while the selected provider
   still holds the offer (the offer is untouched). The UI offers consent only when it's needed.
   Keep, or restrict the command to `awaiting_consent`.
5. **Ineligible holder** — a vendor who becomes ineligible keeps the pending offer until expiry;
   accept is refused (Phase 5 contract, SQL 029). Without a scheduler, expiry advances only on
   vendor/admin/homeowner page reads. Decline does not check expiry. Unchanged.
6. **Homeowner-read expiry (B4)** — side effect on read via an existing permitted command.
7. **Acceptance notice text** — the database notice says “Your service is scheduled. Review the
   appointment details…” even with no appointment. Notification content is Phase 7; unchanged.

Carry forward: 6.2 merge/final-head CI and integration gates; promotion refusal and intake
orphan retention; script CI wiring; the shared Status badge's `capitalize` class (renders “New
Offer”, not sentence case) for the MDS pass.
