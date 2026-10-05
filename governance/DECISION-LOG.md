# Mercurius Decision Log

Use this log for material decisions made after the approved MPS, MDS, MTS, and configuration baseline. Do not duplicate decisions already recorded in `OWNER-APPROVALS.md` or `CONFIGURATION-DECISIONS.md`.

## Decision template

```text
Decision ID: DEC-YYYY-NNN
Status: PROPOSED | APPROVED | SUPERSEDED | DEPRECATED
Date:
Decision:
Context:
Alternatives considered:
Rationale:
MPS impact:
MDS impact:
MTS impact:
Data/payment/security impact:
Implementation owner:
Required evidence:
Supersedes:
```

## Decisions

### DEC-2026-024 — Existing-provider profile-setup access; vendor role at reviewed binding

**Status:** APPROVED owner decision. **Date:** 2026-09-30 (America/New_York).

**Decision:** Existing providers created before the rebuilt onboarding, which have no application, may be given access to set up their existing profile through a bounded path (TRACE-105): an auditable owner-confirmed contact for the exact contractor; an access invitation with the TRACE-063 reservation, dispatch, expiry, refusal, reconciliation, acceptance and receipt protections; an operator-reviewed binding of the accepted account; and, at that binding, the `vendor` role for portal access. This changes TRACE-068's role timing for this path only. Application-based onboarding is unchanged.

**Context:** None of the eight owner-confirmed real vendors has an application; TRACE-065 refuses application review for an existing provider and the canonical invitation reads its recipient from an application snapshot. Fabricating applications, consent or evidence was ruled out.

**Rationale and limits:** The `vendor` role gates only the `/vendor` routes; data rights come from `contractors.user_id`. Profile edits are column-restricted, job actions need an assigned request or an eligible live offer, and no money command is vendor-callable. The one gap was TRACE-060 compatibility (legacy `is_active` made a provider matching-eligible and therefore listable), so an access-managed provider no longer counts as eligible on that flag. Setup access is not compliance approval, listing, matching, activation or permission to transact.

**MPS impact:** R0 profile preparation reaches existing providers without an application; invited, bound (setup), approved/activated and listed stay distinct. **MDS impact:** email, acceptance, vendor card and operator panels say setup is separate from approval and listing; no promise of jobs, booking, listing, Founding Vendor or Credits. **MTS impact:** private append-only records, operator commands with reasons and idempotency, service-only receipt writers, onboarding interlock; migration `20260930001000`. **Data/payment/security impact:** identity is proven by exact account ID against the confirmed contact; no new money capability; no production data in source.

**Required evidence:** SQL 072, `vendor-invite` runtime tests, local end-to-end, hosted owner-mailbox test before real invitations. **Open:** the compliance path for access-managed providers is a separate slice.

### DEC-2026-025 — Owner-only operational coverage for R0 (backup-administrator exception)

**Status:** Owner instruction recorded as a requested exception. **Date:** 2026-09-30 (America/New_York).

Josh is the sole administrator and operational contact for R0; there is no independent backup administrator. The layered-launch R0 contract requires a named least-privilege backup admin. Josh requested an exception. No duplicate account is created to imply backup coverage, and Josh is not described as his own backup.

Compensating arrangements (not a substitute): MFA and stored recovery codes for Supabase, Vercel, GoDaddy, Resend and Google Workspace; admin sign-in on the controlled `mercuriusmarketplace.com` mailbox; a daily `/admin/recruiting` check; honest response expectations under CFG-010; an incident note that nothing transactional is live in R0, so unavailability delays recruiting responses rather than harming bookings or payments.

Acceptance of this exception is part of Josh's dated R0 go/no-go (TRACE-105) and must be restated there. It does not carry to R1. Two production admin accounts on `@mercurius.com` (domain ownership unconfirmed) are not trusted coverage and stay unchanged until their identities and dependencies are resolved.

**Update 2026-09-30:** Josh confirmed sole-admin coverage under this exception for R0.5. Verified read-only the same day: both `@mercurius.com` accounts have been removed from production (see [R0 release report](R0-RELEASE-CANDIDATE.md#production-state-verified-2026-09-30)); the two remaining admin accounts are Josh's.

### DEC-2026-026 — Light-only R0 recruiting launch; dark-mode repair deferred

**Status:** APPROVED owner instruction; temporary exception to the MDS dark-mode requirement. **Date:** 2026-09-30 (America/New_York).

**Decision:** The R0 recruiting release renders light mode only on every public, homeowner, vendor and admin route. The theme control is removed; saved `dark`/`system` preferences and the OS dark preference are ignored (the saved value is not erased); the pre-hydration theme script forces `light`, so no dark first paint; `<meta name="color-scheme" content="light">` and `color-scheme: light` keep native controls light. The `.dark` tokens and `dark:` styles stay in the codebase unchanged. One constant, `LIGHT_ONLY_LAUNCH` in `src/components/theme/themeMode.ts`, holds the decision.

**Context:** Josh directed a light-only recruiting launch with dark mode repaired later. Existing browser evidence records dark-theme contrast failures (for example the invitation queue's fixed light palette). The MDS blueprint and roadmap (Phase 2 gate, R0.3) require light/dark support, so this is a recorded, time-bound deviation, not a change to the MDS.

**Alternatives considered:** Fix dark mode first (delays recruiting); default to light but keep the toggle (exposes the known dark defects); remove dark styles (loses work the repair needs).

**MPS impact:** None. **MDS impact:** Temporary exception to theme support; light-mode contrast remains a hard gate (two homeowner-page light-contrast failures found by the new check were fixed with existing tokens). **MTS impact:** None beyond the client theme provider. **Data/payment/security impact:** None.

**Required evidence:** `tests/e2e/light-only.spec.ts` (fresh, saved dark, saved system with OS dark; 320/1440 px; public, homeowner, vendor, admin; navigation/reload; mobile menu; form errors) and the hosted light-only check in TRACE-105.

**Follow-up (TRACE-106):** Dark-mode repair release — fix dark contrast defects, re-run light/dark axe, `@visual` and manual checks, then set `LIGHT_ONLY_LAUNCH` to `false`. Required before any release that shows a theme choice, and before the R1 gate unless Josh records otherwise.

### DEC-2026-027 — Legacy providers start onboarding review without an application

**Status:** APPROVED owner instruction; a closed exception to application intake. **Date:** 2026-10-04 (America/New_York).

**Decision:** The eight providers listed before the rebuilt onboarding, and only these eight, start onboarding review without submitting `/vendors/apply`: All Surface Pressure Cleaning & Sealing; Flash Handyman Service; Garden of Eden Lawn Service; Maritzas Cleaning Services; P & P Cleaning Solutions; Sparkling Squeegees Window Cleaning; Spiffy Clean Canz; TDJ Construction. Josh confirmed this is the full list; every other provider applies. An operator starts review from the provider's vendor page; the system writes an operator application record from the existing profile and confirmed contact (marked as not submitted by the provider) and opens review at revision 1. The MPS §8 activation checklist, evidence, activation and listing rules are unchanged: Josh holds each provider's identity, agreement, license, insurance and ACH authorization outside the platform, uploads the license and insurance documents through the existing operator upload, records every checklist item and activates.

**Context:** Supersedes, for these eight only, the 2026-10-03 choice to close the access-managed compliance path with a real application (`20261003001000`, which stays in place). The providers already set up their profiles through Existing Provider Access (DEC-2026-024) and their documents were collected manually before the checklist existed in the platform.

**Alternatives considered:** Require the application (rejected by Josh: the providers are already onboarded in substance); mark them listable without a checklist (rejected: no license/insurance expiry, renewal or suspension control).

**MPS impact:** None to the §8 checklist; intake exception for eight named legacy providers. **MDS impact:** One operator panel on the vendor page. **MTS impact:** Migration `20261004001000` (closed list recorded once by exact name for access-managed providers without onboarding; `r0_start_legacy_provider_review`; `r0_legacy_review_status`; operator document upload while a legacy review is open; no new-application notice for the operator record). **Data/payment/security impact:** Operator-only commands; no email, role, listing or payment change at the start.

**Required evidence:** SQL 074; browser `legacy-provider-review`; after the hosted push, the migration notice reports 8 of 8 providers recorded.

### DEC-2026-028 — Bind a provider's account while it is suspended

**Status:** APPROVED owner instruction. **Date:** 2026-10-05 (America/New_York).

**Decision:** An operator can bind a provider's account (accepted invitation or stated account ID) while the provider is in onboarding review **or suspended**. A provider activated with no bound account is repaired by Suspend → bind → Activate: activation from suspension re-checks the MPS §8 checklist and grants the vendor role through the unchanged TRACE-068 path. An account is never bound to an active provider (the command says to suspend first, as release already does), and a rejected provider is still refused.

**Context:** TRACE-068 lets activation proceed with no bound account (recorded `no_account`, no role), and no transition returns an active provider to review, so such a provider could never receive portal access. A live invitation-onboarded provider was activated before its accepted account was bound; Josh expects the same mistake as more operators onboard providers.

**Alternatives considered:** Bind and grant the role on an active provider in place (rejected: the role would no longer follow only from a reviewed activation); a transition from active back to review (rejected: larger state-machine change, re-opens vetting).

**MPS impact:** None to the §8 checklist or role semantics. **MDS impact:** The provider account panel explains the repair on an active provider and offers binding on a suspended one. **MTS impact:** Migration `20261005001000` (`vendor_link_existing_account` and `vendor_bind_invited_account` status guard only). **Data/payment/security impact:** Operator-only commands; no role is granted by binding.

**Required evidence:** SQL 075 and updated 034/037; browser `invitation-binding`; hosted migration push by the owner.

### DEC-2026-021 — Private-beta ZIP allowlist: every Lee County ZIP

**Status:** APPROVED owner decision. **Date:** 2026-09-27 UTC.

Closing TRACE-095's open allowlist item, the owner decided that every Lee County, Florida ZIP
code is covered (CFG-001) and that the list comes from public ZIP-to-county data, not an export
of existing backend rows.

1. **The allowlist is the 47 ZIPs the USPS assigns to Lee County:** 33 standard, 1 unique
   (33965) and 13 PO box. Each was cross-checked against the Census 2020 ZCTA-to-county
   relationship file (county 12071).
2. **Split ZIPs assigned to Lee County are covered whole** (33917, 33921, 33936, 34134), because
   enforcement is ZIP-level.
3. **Neighboring-county ZIPs with Lee County slivers are not covered:** 33955 (Charlotte, 1.5% of
   land in Lee), 34110 (5.2%) and 34119 (1.8%, both Collier).

Committed as migration `20260927010000_cfg001_lee_county_coverage.sql` (additive; activates the
47 ZIPs and changes no other rows). Evidence: SQL 064. Sources: Census
`tab20_zcta520_county20_natl.txt`; USPS county listing via zip-codes.com (`county/fl-lee.asp`).
Reconciling hosted `coverage_areas` rows against this list is part of the reviewed hosted migration
(Phase 8). This authorizes no hosted migration or production change.

### DEC-2026-020 — Request submission: all-or-nothing plans and uncataloged services

**Status:** APPROVED owner decision. **Date:** 2026-09-26 UTC.

Asked during TRACE-095 (slice 6.1), the owner chose:

1. **Mixed plans are refused whole.** If any selected service is unavailable, invalid, stale or
   priced differently from what was shown, no request is created. The homeowner sees each
   service's outcome, may register interest in unavailable ones, removes or fixes them and
   submits again. No partial success.
2. **Uncataloged services are unavailable.** "Something Else" and provider-page service names
   that are not active catalog services create no active request (CFG-002, MPS §6.1). The
   homeowner may send the description as explicit interest instead.

Alternatives declined: creating the eligible subset; keeping free-form requests as
admin-sourcing quote requests. Evidence: SQL 063 and PHASE-6-REQUEST-SUBMISSION.md. This
authorizes no external activation.

### DEC-2026-019 — Accept Phase 4 and release the Phase 6 hold

**Status:** APPROVED owner decision. **Date:** 2026-09-26 UTC.

After Claude's completion-integrity repair (TRACE-097, PR #55, answering review findings
P4-R1/P4-R2 from PHASE-4-CODE-REVIEW.md), the owner reported that Codex's re-review found it
ready, and:

1. **Accepts Phase 4** (canonical product lifecycle) on its roadmap gate: the transition matrix
   and cross-role acceptance tests pass and no record can be stranded in an unmapped state.
   This covers the P4-1–P4-7 dispositions in PHASE-4-CODE-REVIEW.md and the TRACE-097 repair,
   including its design choices D1–D4 as implemented (PHASE-4-COMPLETION-INTEGRITY.md).
2. **Releases the DEC-2026-018 review-before-start hold.** Phase 6 implementation may begin with
   slice 6.1 (TRACE-095) under PHASE-6-SCOPE.md and the roadmap order and gate.

Record limits: Codex's re-review was relayed by the owner and is not yet written into the
repository. The accepted repair is on PR #55, stacked on PR #54; neither is merged, and CI has
not run on #55. Adding `scripts/phase4-completion-integrity.mjs` to CI remains an open owner
decision. Carried-forward gates keep their phases: email/SMS and reminder timing (Phase 7),
hosted migration and Storage checks (Phase 8), scheduler activation, and the Phase 3 manual
screen-reader, zoom and brand follow-ups.

This decision authorizes no hosted migration, deployment, production change, charge, refund,
payout, email, scheduler activation or deletion.

### DEC-2026-018 — Review Phase 4 before beginning Phase 6

**Status:** APPROVED owner direction. **Date:** 2026-09-26 UTC.

The owner requested Codex's P4-1–P4-7 review before any Phase 6 implementation,
then authorized committing/pushing the review and planning documents and opening a PR.
This adds a review-before-start hold to DEC-2026-017's Phase 6 authorization;
it does not accept Phase 4 or change product policy.

Codex completed the review on main `1baf270`: PHASE-4-CODE-REVIEW.md (TRACE-096)
records P4-R1, completion evidence bypass, and P4-R2, completion lock inversion.
Disposition: changes required. Phase 4 remains unaccepted and Phase 6 remains held
pending disposition. Recommendation: Claude repairs the bounded completion command,
Codex re-reviews, then the owner decides acceptance and releases the hold.
That recommendation is not recorded as an owner acceptance or risk waiver.

No hosted change, deployment, scheduler, email or money activation is authorized.

### DEC-2026-017 — Close Phase 5 and authorize Phase 6; Phase 4 stays open

**Status:** APPROVED owner decision. **Date:** 2026-09-26 UTC.
**Supersedes:** DEC-2026-016's single decision for both phases. Its review scope is kept.

After the Codex closure review (PHASE-5-CODE-REVIEW.md) and its fixes (TRACE-093, TRACE-094;
PR #52, merged at `417e642`), the owner:

1. **Closes Phase 5** on the DEC-2026-015 basis: the roadmap gate's synthetic tests, the Codex
   review with P1, P2 and the closure-package finding fixed, and the activation gates carried to
   the later phases named in PHASE-5-CLOSURE-READINESS.md. Post-merge `main` CI:
   run 36256537232 passed backend, lifecycle and application.
2. **Authorizes Phase 6** implementation (customer, vendor and admin workflow rebuild) in bounded
   slices under the roadmap's order and gate.
3. **Does not accept Phase 4.** Phase 4 stays IN PROGRESS: owner acceptance and the Phase 4
   review questions (P4-1–P4-7) remain open. It will be accepted in a separate decision,
   no longer bundled with Phase 5.

Context: Phase 6 steps 2–5 (matching, offers, quotes, scheduling, completion, cancellation,
dispute) build on Phase 4's lifecycle contracts. That work proceeds on contracts not yet
owner-accepted. A Phase 4 finding may require changes to Phase 6 work already built on them.

Alternatives considered: holding Phase 6 until Phase 4 is accepted; accepting Phase 4 with
Phase 5 as DEC-2026-016 planned.

This decision authorizes no hosted migration, deployment, production change, charge, refund,
payout, email, scheduler activation or deletion. The carried-forward gates keep their phases.

### DEC-2026-016 — Phase 4 acceptance through the combined Phase 5 closure review

**Status:** APPROVED owner direction. **Date:** 2026-09-25 UTC.

Phase 4 (PR #5, merged 2026-09-04 at `735df91`) was never owner-accepted. Its two acceptance
gates were final-head CI and owner/code review. The owner chose to have Codex review Phase 4 in
the same pass as the Phase 5 closure review, because Phase 5's payout holds, matching
eligibility and recurring identities build on Phase 4, and then to accept both phases in one
decision once findings are fixed or recorded.

- **CI gate:** every check the Phase 4 gate names is now a standing CI step and passes on
  `main` (run 36138739942). Counts differ from the Phase 4 report because later work added tests.
- **Review gate:** Codex reviews Phase 4 as it stands on `main`, including later Phase 5 changes
  to its matching and recurring-visit contracts (PHASE-5-CLOSURE-READINESS.md, "Phase 4 review").

Alternatives considered: accepting Phase 4 now on CI and the CodeRabbit review alone; closing
Phase 5 with Phase 4 acceptance recorded as an exception.

This direction does not accept either phase and authorizes no scheduler, email, production
change or activation.

### DEC-2026-015 — Phase 5 closure basis, never-submitted renewal uploads, promotions and tax

**Status:** APPROVED owner decisions (2026-09-25); implementation choices recorded for Codex review.
**Date:** 2026-09-25 UTC.

1. **Closure basis.** Phase 5 is assessed against its roadmap gate: concurrent checkout,
   duplicate webhook, partial and full refund, dispute, chargeback, payout and invite tests
   pass in non-production environments, followed by Codex review. As with Phase 3
   (DEC-2026-005), the activation gates that need production, external accounts or people
   are carried forward to named later phases rather than holding Phase 5 open: hosted
   migration and rollout, authorized Stripe and bank tests, finance operator provisioning,
   legacy cutover, real licensing and insurance requirements, and manual accessibility and
   brand acceptance. Codex review is not phase acceptance; the owner closes the phase.
2. **Never-submitted renewal uploads** (TRACE-091) follow TRACE-090's rule: due 7 days after
   the 2-hour upload link expires, measured from the object's `created_at`, then TRACE-074's
   operator-run quarantine, 14-day wait and deletion, with provider holds and the evidence
   exemption. Implementation choice: because a renewal upload can be submitted with the
   provider's session at any time (application uploads need a 110-minute finalize token),
   a submission is refused once the object is 7 days old, 2 hours before quarantine opens,
   so a submission never races a quarantine. The owner accepted this provider-visible refusal
   on 2026-09-25.
3. **Promotions.** None at private beta. Checkout must refuse any promotion or discount until
   the owner approves promotion terms (funding, limits, allocation).
4. **Sales tax.** Carried to the private-beta gate: the owner confirms taxability by service
   category with an accountant before private beta, and checkout must not charge a category
   without an approved tax rule. Test fixtures remain non-policy (DEC-2026-011).

Alternatives considered: holding Phase 5 open until every activation gate passes (1);
deferring renewal uploads (2); defining promotion terms now (3); a zero-tax rule now, or
Stripe Tax (4).

MPS/MDS/MTS impact: none. Items 3 and 4 fix beta configuration within CFG-005 and DEC-2026-011.

This decision does not authorize a hosted migration, deployment, charge, deletion or activation.

### DEC-2026-014 — Per-IP intake limit: client-IP source and implementation choices

**Status:** APPROVED owner fact; implementation choices recorded for Codex review.
**Date:** 2026-09-24 UTC.

Settles DEC-2026-013 item 2 (TRACE-089):

1. **Path (owner, 2026-09-24).** `mercuriusmarketplace.com` is registered with GoDaddy and
   its DNS points straight at Vercel; there is no proxy or CDN in between. A read-only
   check the same day confirmed GoDaddy nameservers, an apex record at a Vercel address and
   a `www` CNAME to Vercel DNS.
2. **Client IP** is Vercel's `x-real-ip` header, trusted only when the route runs on Vercel
   (`VERCEL=1`). Vercel's edge replaces any value the client sent. Elsewhere the header is
   ignored.
3. **Network, not address, for IPv6:** an IPv6 client is counted by its /64 prefix. An
   IPv4-mapped address counts as the IPv4 address.
4. **Unknown IP:** the network limit is skipped and the per-email limit still applies.
5. **Stored key:** SHA-256 of the network, unkeyed, like the email key.
6. **The limit** is DEC-2026-012's 5 accepted submissions per hour per form, checked after
   the per-email limit, with the same 429.

Alternatives considered: `x-forwarded-for` (2); `@vercel/functions` `ipAddress()` for the
same header (2); counting single IPv6 addresses (3); one shared bucket when the IP is
unknown (4); a keyed hash (5).

MTS impact: the MTS §4 anonymous row's launch note now includes the per-IP limit. With the
per-IP limit in place, DEC-2026-013 item 1's "per-IP limit still deferred at launch"
condition for revisiting Turnstile no longer applies.

This decision does not authorize a hosted migration, deployment, domain change or activation.

### DEC-2026-013 — Intake abuse protection: Turnstile, the per-IP limit and implementation choices

**Status:** APPROVED owner decisions. **Date:** 2026-09-24 UTC.

Settles how DEC-2026-012 item 1 is implemented (TRACE-088):

1. **No Turnstile at launch.** DEC-2026-012 rejected Turnstile but recorded no MTS impact.
   The owner left the call to the implementer, who kept the owner's decision. **MTS
   impact:** the Turnstile requirement in MTS §4 (Anonymous role) and §11 (public writes and
   upload grants), and in the roadmap's Phase 5 abuse-protection item, is replaced at launch
   by the honeypot, the minimum fill time and the per-email limit. The `TURNSTILE_*`
   variables in MTS §12 are not used. Revisit Turnstile if intake spam is observed, or before
   launch if the per-IP limit (item 2) is still deferred then.
2. **The per-IP limit is deferred.** The production domain will reach the Vercel-hosted app
   through a path that does not go through Vercel's own domain handling, so which request
   header carries the real client IP is not yet known. Counting a proxy's address would make
   every visitor share one limit. The per-IP limit of 5 per hour is added once that path is
   known. Until then a sender who changes email address is limited only by the honeypot and
   fill time; this risk is accepted.
3. **Old counter rows** are deleted by the recording function each time it runs; no
   scheduled job.
4. **Only accepted submissions count** toward the per-email limit. Refused and invalid
   attempts are not recorded.
5. **Stored keys** are SHA-256 hashes of the normalized email address, not the address.
6. **Fill time** is measured by the browser and trusted, like the honeypot, as a basic
   filter. The browser sends how long the form was open, not a timestamp, so clock
   differences between browser and server do not matter.
7. **Every refusal** (honeypot, fill time, limit) returns the same HTTP 429 "Please try
   again later."

Alternatives considered: adding Turnstile now (1); the first `x-forwarded-for` entry, or one
shared bucket when the IP is unknown (2); `pg_cron` or an operator-run cleanup (3); counting
every attempt (4); a keyed hash with a new secret (5); a server-signed form token (6); a
fake success for honeypot and fill-time refusals (7).

These decisions do not authorize a hosted migration, deployment or activation.

### DEC-2026-012 — Public intake hardening and application record lifecycle

**Status:** APPROVED owner decisions. **Date:** 2026-09-24 UTC.

Answers the open items left by TRACE-084, TRACE-085 and TRACE-086:

1. **Abuse protection.** The vendor application and contact routes each get a hidden
   honeypot field, a minimum fill time of 3 seconds, and submission limits of 5 per hour
   per client IP and 3 per day per email address, counted separately for each form. The
   counters live in a private Postgres table that only the service-key routes can use. A
   refused submission gets a generic "try again later" (HTTP 429). No third-party bot
   check (such as Turnstile) is added.
2. **Contact form writes.** The contact route inserts with the service key, as the
   application route does. The anonymous `contact_submissions` insert policy is dropped
   and `INSERT` is revoked from `anon` and `authenticated`.
3. **Application rows are never deleted.** A spam or duplicate application is closed as
   abandoned with a reason (TRACE-084); its documents follow CFG-011 retention and the
   row stays as the record. No deletion or anonymization command is added.
4. **Duplicate read policy.** The identical `Admins can review vendor application
   documents` `SELECT` policy on `vendor-documents` is dropped; `Admins can read vendor
   documents` stays. Admin access does not change.
5. **Never-submitted uploads.** A file in `vendor-documents` under an application's upload
   path becomes due 7 days after its signed upload grant expires, when neither the
   application's `document_urls` nor any compliance evidence references it. It then
   follows the existing operator-run quarantine, 14-day wait and permanent deletion,
   with application and provider holds respected. Orphaned renewal uploads are not part
   of this decision.

Alternatives considered: Turnstile, a honeypot alone, or deferring (1); keeping the
length-checked anonymous policy (2); a reviewed purge or anonymization after retention
(3); keeping both policies (4); the 90-day clock from upload, or no retention (5).

These decisions do not authorize a hosted migration, deployment or activation.

### DEC-2026-011 — Phase 5 independent contracts and bank-operated ACH

**Status:** APPROVED owner direction; implementation choices below use the owner's delegated chargeback discretion.
**Date:** 2026-09-04 UTC.

The owner authorized a clean Phase 5 branch from current remote main in a separate
worktree, without taking unmerged PR #4 code. Main was fetched at d8cceee; PR #4
was OPEN and unmerged at 91bc94f. Phase 4 schema integration and owner acceptance
remain dependencies, not assumptions or duplicated implementations.

The owner will initiate weekly ACH directly from Mercurius's bank account and
collect the relevant authorization forms during onboarding. There is no ACH API
processor selection to make and no Stripe Connect integration. Store private
form/evidence references, statements and bank outcomes; never bank credentials or
full account details in events, fixtures, logs or exports. Weekly reporting
periods span seven days and do not overlap; no bank submission weekday is invented.

Every vendor must have reviewed, current licensing and insurance evidence.
Category/jurisdiction-specific document sufficiency is reviewed against an explicit
requirement version; uploading a file or accepting an invitation is not activation.
No arbitrary licence exemption, insurance limit or bank-form expiry is inferred.

The owner delegated chargeback treatment. Selected policy: hold disputed funds;
Mercurius absorbs processor and dispute fees; allocate lost unpaid principal to
reviewed service/tax/tip components and recompute the fee on retained service.
Scheduled or already-paid funds require a separate recovery review. No automatic
vendor bank debit, clawback, or netting of future unrelated earnings is authorized.
Chargebacks are not labelled customer refunds. Fee rounding follows the recovered
nearest-cent convention; provider proceeds receive the remainder so totals balance.

MPS §6.5 second-person review is enforced for the new reviewed financial commands
by a separately authenticated approval of the exact command. No finance members
or real approvals are seeded. Release must establish the two authorized operators.

Tax calculation/remittance evidence and complete promotion terms remain required
configuration. Test fixtures are not approved real tax or promotion policy.
No live charges/refunds/payouts/emails, production changes, deployment, merge,
Cron activation, or Homeschool Haven changes are authorized.

### September 4 repository merge authorization

After the independent checkpoints above, the owner authorized merging PRs #4 and
#5, then resolving PR #6's conflicts, requesting CodeRabbit review and merging its
repository checkpoint. This later instruction supersedes earlier no-merge wording
for these PRs only. Production changes, deployment, money/email execution and Cron
activation remain outside that authorization. See PR-6-MERGE-RECONCILIATION.md.

### DEC-2026-004 — Approve Phase 2 checkpoint and defer lifecycle activation

**Status:** APPROVED

**Date:** 2026-09-03

**Decision:** The owner approved the documented live-versus-local differences
for the Phase 2 reconstruction checkpoint and authorized commit, push, and a
pull request. This includes the local grant hardening and preservation of local
checkout/refund validation and payment-to-matching behavior described in the
Phase 2 validation and Edge recovery reports. This is not approval to deploy
those differences to production or to merge the PR automatically.

**Follow-up ownership:** Remaining lifecycle and scheduler implementation,
authenticated gateway integration, concurrency/failure tests, and activation
planning move to Phase 4 (TRACE-010). Payment and payout integrity remain Phase 5.
Supabase Cron is installed and selected, but no worker job is activated.

**Completion policy:** Unconfirmed completion must escalate to admin review,
not automatically become homeowner-confirmed. The escalation deadline remains
to be defined in Phase 4. The existing four-hour vendor offer acceptance window
is a separate matching deadline, not a completion confirmation deadline. Preserve
the recovered worker as reconstruction evidence until the Phase 4 forward change
and tests replace its inherited 72-hour automatic confirmation.

**Closeout:** Phase 2 reconstruction is accepted with these explicit follow-ups.
Phase 3 may begin from the reviewed checkpoint; production activation remains
subject to its own gates. Homeschool Haven must remain untouched.

### DEC-2026-003 — Select Supabase Cron for lifecycle scheduling

**Status:** APPROVED (scheduler provider selection; activation gates remain)

**Date:** 2026-09-03

**Decision:** The owner selected Supabase Cron rather than an external scheduler.
The conversational phrase “Supabase clone” is interpreted as Supabase Cron,
the option under discussion, not a request to clone production data.

**Implementation boundary:** Prepare scheduling within Supabase, with credentials
kept in approved server-side stores. No production job was created or enabled in
this checkpoint. Provider selection does not resolve the inherited worker's
unreviewed lifecycle semantics or approve a change to homeowner confirmation and
payout eligibility. See `SUPABASE-CRON-SETUP.md` for the activation requirements.

**Required evidence:** Duplicate-scheduler check, authenticated gateway/worker
integration against synthetic fixtures, concurrency and failure tests, lifecycle
policy reconciliation, secret-safe configuration, and reviewed activation/stop
procedure. These remaining implementation gates move to TRACE-010 / Phase 4
under DEC-2026-004; they are not claimed as passing at Phase 2 closeout.

### DEC-2026-002 — Authorize deployed Edge Function source inventory

**Status:** APPROVED

**Date:** 2026-09-03

**Decision:** The owner authorized read-only export of deployed Edge Function source and JWT verification settings for Phase 2. Customer data and secret/environment values remain excluded.

**Context:** Eight deployed functions have no local source, including four invoked by the application.

**Security boundary:** Export into ignored local staging, inspect for embedded credentials before adding source to the repository, and preserve existing local implementations until drift is reviewed. No function invocation, deployment, deletion, production database mutation, or secret-store export is authorized.

**Required evidence:** Source/JWT inventory, credential scan, implementation drift review, local reconstruction tests, and confirmation that production remains unchanged.

**Supersedes:** Nothing; extends DEC-2026-001 to deployed function code and non-secret JWT settings.

### DEC-2026-001 — Authorize sanitized live-schema inventory

**Status:** APPROVED

**Date:** 2026-08-29

**Decision:** The repository owner confirmed that the linked Supabase project has a current backup and authorized a read-only, schema-only export for Phase 2. Customer data and secrets must not be exported.

**Context:** Roadmap Phase 2 requires the live backend boundary to be inventoried before the repository can become the canonical reconstructible backend definition.

**Alternatives considered:** Reconstruct from code references alone; defer the inventory.

**Rationale:** Code references and committed migrations are known to omit pre-existing live objects. A sanitized schema inventory is necessary to reconcile that drift without guessing or mutating production.

**MPS impact:** None; this records implementation evidence only.

**MDS impact:** None.

**MTS impact:** Unblocks Roadmap Phase 2 / MTS Slice 3.

**Data/payment/security impact:** Read-only metadata access only. No rows, storage objects, credentials, secret values, production migrations, or other external mutations are authorized.

**Implementation owner:** Codex implementation agent under repository-owner review.

**Required evidence:** Sanitized schema artifact; object inventory; live-to-repository drift report; secret scan; confirmation that no customer rows were committed.

**Supersedes:** Nothing.

### DEC-2026-005 — Accept Phase 3 and authorize Phase 4

**Status:** APPROVED. **Date:** 2026-09-03.

The owner accepted Phase 3 as closed at PR #3 and authorized lifecycle/scheduler
reconciliation, tests, governance updates and a draft PR. Phase 3 manual
accessibility, brand and cross-platform follow-ups remain recorded separately.
PR #3 was verified open/unmerged at 91379e9; Phase 4 initially branched from that
head. Its later merge at db3f406 was independently verified as tree-identical;
the Phase 4 branch was rebased onto that merged main without changing Phase 3.
No merge, deploy, production change, Cron activation or Homeschool Haven operation
is authorized. Heavy checks remain sequential, with MERCURIUS_BUILD_WORKERS=1.

### DEC-2026-006 — Completion escalation deadline

**Status:** APPROVED. **Date:** 2026-09-03.

Asked how long after the homeowner completion-confirmation notice an unanswered
job should escalate to admin review, the owner answered: “72 hours is approved.”
The clock begins with the recorded notice, not provider offer creation. At 72h
the job stays completion-pending and gains an auditable admin-review flag. Silence
never creates homeowner confirmation or payout eligibility. The four-hour vendor
offer deadline is separate. No other inherited reminder/quiet-hour timer is
approved by this decision. Required evidence: boundary, retry, cross-role, failure
and concurrency tests; no confirmation or financial effects on escalation.

### DEC-2026-007 — Vendor acceptance schedules service

**Status:** APPROVED. **Date:** 2026-09-03.

The owner clarified that the four-hour window is the vendor's time to accept the
homeowner's offer, not a quote-validity period. A request becomes scheduled
immediately when the vendor accepts. Do not add payment, separate homeowner quote
approval or mutual appointment confirmation as prerequisites to that scheduling
transition. The four-hour quote-expiry interpretation was discarded before any
quote-expiry migration was applied. Quote validity/revision remains an open
specification, separate from the approved offer window and 72-hour completion review.

### DEC-2026-008 — Homeowner quote approval window

**Status:** APPROVED. **Date:** 2026-09-03.

Asked how long a price quote remains valid for homeowner approval, the owner
answered “24 hour for approval.” New quote revisions therefore expire 24 hours
after being sent. This is separate from the four-hour vendor offer and 72-hour
completion escalation. Replacing or extending a quote creates a new revision;
previous revisions and decisions remain in history. No expiry is retroactively
inferred for a legacy quote that has no recorded notice/deadline.

### DEC-2026-009 — Disputes and rating-neutral reviews

**Status:** APPROVED. **Date:** 2026-09-03.

The owner approved a 48-hour dispute filing window beginning when the vendor
marks the work complete. Homeowners may appeal admin resolutions through the
ticket system. No appeal deadline was specified; none is imposed by this slice.
Every star rating uses the same moderation rules. A separate review-management
system is future work. Previously private feedback is not retroactively published.

### DEC-2026-010 — Operational defaults for Phase 4

**Status:** APPROVED. **Date:** 2026-09-03.

The owner approved at least one completion photo per visit unless a category rule
requires more; separate jobs for recurring visits; cancellations affecting one
visit; and moderation for spam, personal information, threats/abuse, or content
unrelated to the service, never for a low rating alone. Email/reminder timing
stays inactive until separately configured. These decisions do not authorize
Cron activation, real messages, charges, refunds, payouts, merge or deployment.


### DEC-2026-022 — Stage public recruiting before transactional beta

**Status:** APPROVED founder decision. **Date:** 2026-09-28 (America/New_York).

The founder approved R0 public recruiting in the rebuilt app, R1 invited transactions and R2 evidence-led wider opening. [The decision record](LAYERED-LAUNCH-DECISION.md) is the complete scoped contract; CFG-014 records the launch configuration. This is a staged release of the existing MPS product, not acceptance of unfinished Phases 6–10.

**MPS impact:** R0 adds honest exploration, interest, optional verified accounts and vendor preparation before homeowner transactions. An account or homeowner role alone does not authorize a new request. R1 starts the beta and Founding Vendor 90-day clocks.

**MDS impact:** During R0, public request and signup entry points lead to early access; the normal “Request service” commitment CTA is reserved for an admitted homeowner. All waiting, invitation, closed and error states need responsive and accessible designs.

**MTS impact:** Admission must be enforced by authoritative request and checkout boundaries with audited service/area grants and safe revocation. Recruiting records, consent, suppression, retention, hosted delivery, monitoring and rollback are R0 release concerns. R0 cannot inherit the full transactional production gate as though all Phase 6–10 functionality were active, and cannot waive it for R1.

**Implementation:** R0 slices and acceptance are TRACE-100–105. Production schema, email, deployment, domain and transaction activation remain separate owner decisions. The [homeowner early-access design](HOMEOWNER-EARLY-ACCESS-EXPERIENCE.md) was supplied with Josh's 2026-09-28 approval and its [route/state reconciliation](HOMEOWNER-EARLY-ACCESS-RECONCILIATION.md) is recorded under TRACE-100/103. Credits and Founding Vendor authority artifacts remain absent and must be reconciled before accepting those detailed implementations.

### DEC-2026-023 — Revocation blocks all new checkout

**Status:** APPROVED owner clarification. **Date:** 2026-09-28 (America/New_York).

For R0/R1 cohort access, revoking a homeowner's trial admission blocks every new checkout, including checkout for a request created before revocation. Historical request, payment and support records remain available. TRACE-101 enforces this at `money_prepare_checkout` as well as new request submission. An already-issued external Stripe session cannot be expired by a database check alone; session expiration and hosted verification remain an R1 activation gate.
