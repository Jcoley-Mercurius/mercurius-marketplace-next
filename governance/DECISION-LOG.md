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

### DEC-2026-029 — Provider invitations default to 7 days; Auth email link 24 hours

**Status:** APPROVED owner instruction. **Date:** 2026-10-13 (America/New_York).

**Decision:** Provider invitations default to **7 days** on both operator forms. The Supabase Auth email link ("Set up your Mercurius provider account") lasts **24 hours** (`otp_expiry = 86400`), up from 3 hours; this supersedes the 3-hour lifetime decided 2026-09-13 (TRACE-071). The operator queues flag a lapsed link after 24 hours. The owner's goal is one lifetime: the email link should stay usable for the whole invitation. Hosted Auth refuses an email link expiry above 86400 seconds ("Must be no more than 86400", observed in the dashboard 2026-10-13), so the owner chose a Mercurius-owned invitation link that stays valid until the invitation expires and creates a fresh Auth session when used. That link is TRACE-107 ([PHASE-5-INVITATION-OPEN-LINK.md](PHASE-5-INVITATION-OPEN-LINK.md)); until it is deployed, an invitation outlives its email link after 24 hours and the existing recovery (revoke, prepare a new attempt) applies.

**Context:** Invitations were prepared with a 7-day expiry, but the emailed link expired after 3 hours, so a provider who opened the email later had a dead link inside a live invitation.

**Alternatives considered:** A 7-day Auth link (refused by hosted Auth); a "send me a new link" page on an expired link (rejected by the owner in favor of the Mercurius-owned link); shortening invitations to 24 hours (rejected: too little time for providers).

**MPS impact:** None. **MDS impact:** The application invitation form now prefills a 7-day expiry; expiry help text names the 24-hour email link; lapsed-link labels name 24 hours. **MTS impact:** Auth email link lifetime 86400 s (local config and hosted Auth settings); migration `20261013001000` adds `private.provider_invitation_link_lifetime()` and points `r0_invitation_attention` and `r0_provider_access_queue` at it. **Data/payment/security impact:** A leaked or forwarded invitation email is usable for 24 hours instead of 3. The link stays single-use, scanner-safe (`token_hash` on `/set-password`) and bound to one attempt.

**Required evidence:** SQL 076; unit `invitation-link-lifetime`; browser `invitation-operations`; owner sets the hosted Auth email link expiry to 86400 and applies the migration (owner-authorized hosted actions).

### DEC-2026-030 — Operator document upload for providers under review

**Status:** APPROVED owner instruction. **Date:** 2026-10-14 (America/New_York).

**Decision:** An operator can upload a license or insurance document on the provider's behalf while the provider is in onboarding review, as already allowed for active and suspended providers and the eight legacy reviews (DEC-2026-027). The upload awaits review. Checklist item 4 or 5 is satisfied only when an operator selects the document, with an expiry, through the unchanged checklist command. The provider itself still submits only while active or suspended. The License document type is labeled "License or business tax receipt", matching R0 onboarding standard v1 item 4 (a local business tax receipt is the licensing evidence for trades without a state license). No new document type is added.

**Context:** `/vendors/apply` accepts an application with no documents, and applicants reach the vendor portal only at activation. Documents a vendor sends Mercurius directly during review had no path into the checklist.

**Alternatives considered:** Require documents on the application (owner: applicants may not have them yet; the application slice that follows makes more fields required but keeps documents optional); a separate tax-receipt document type (larger change; no rule yet for which checklist item it satisfies).

**MPS impact:** None to the §8 checklist. **MDS impact:** The vendor page's document section covers review as well as renewal. **MTS impact:** Migration `20261015001000` (`private.vendor_renewal_submitter` status guard and `vendor_renewal_document_overview.operator_upload`). **Data/payment/security impact:** Operator-only; the same private bucket, path, verification and retention rules.

**Required evidence:** SQL 078 and updated 040/074; browser `renewal-documents`/`onboarding-checklist`; hosted migration push by the owner.

### DEC-2026-032 — Closed applications leave the default applications view

**Status:** APPROVED owner instruction. **Date:** 2026-10-15 (America/New_York).

**Decision:** `/admin/applications` opens on "Open applications", which hides every application whose queue state is Rejected or Abandoned. Closed applications are not deleted. "All, including closed", "Rejected" and "Abandoned" in the status filter still show them, and a line above the table says how many are hidden, with a "Show closed applications" link. An application rejected or abandoned in the dialog stays open in the dialog and leaves the default view once the dialog closes. A `/admin/recruiting` link to a closed application still opens it.

**Context:** The queue showed every rejected application indefinitely. Only their documents are on a timer (CFG-011: 90 days, then quarantine and deletion). The owner asked for rejected applicants to come off the list.

**Alternatives considered:** Deleting rejected application rows. Not chosen: the row carries the closure outcome, date and reason, holds, and each document retention step, which CFG-011 retention depends on, and deleting production data needs a separate owner decision. How long the record itself is kept is proposed in DEC-2026-033.

**MPS impact:** None. **MDS impact:** The applications queue defaults to open applications and states how many closed ones are hidden. **MTS impact:** Client filter only (`matchesApplicationQueueFilter` in `src/lib/applicationQueueState.ts`); no schema, data or route change. **Data/payment/security impact:** None; nothing is deleted.

**Required evidence:** Unit `application-queue-state`; browser `application-retention` (hidden by default, shown on request, leaves the view after rejection).

### DEC-2026-033 — How long a closed application's record is kept

**Status:** PROPOSED for owner review. Drafted by Claude at the owner's request on 2026-10-15. Not legal advice; confirm with counsel before approving. Nothing is implemented or deleted under it.

**Decision (proposed):** For a vendor application closed as rejected or abandoned that never became a provider:

1. **Applicant details, 3 years after closure.** Names, email, phone, address, business name and description, website, license and insurance numbers, credentials, service areas, notes, the closure reason text and document file names are kept for 3 years from the closure date. After that they are erased from the application and its retention records.
2. **De-identified closure record, 7 years after closure.** The application id, outcome (rejected or abandoned), application and closure dates, closure source, and the dates and outcomes of each document retention step (quarantine, deletion, hold placed or released) are kept for 7 years from closure, then deleted.
3. **Holds pause both clocks.** An active investigation or legal hold (CFG-011) stops erasure and deletion until it is released.
4. **Not covered.** An application whose applicant became a provider (including one rejected through onboarding review) follows the provider's records, not this rule. CFG-011's 90-day document rule is unchanged.

**Context:** CFG-011 sets 90 days for rejected or abandoned vendor documents but says nothing about the application record or its closure and retention audit. DEC-2026-032 hides closed applications from the default view; this decides when they actually go.

**Rationale:** Three years matches CFG-011's support-ticket retention, covers a disputed rejection or a complaint, and lets operators recognise a repeat applicant. The de-identified record proves that documents were deleted on schedule, and 7 years matches the longest CFG-011 period, while holding no personal data.

**Alternatives considered:** Keep everything indefinitely (current behavior; holds personal data with no purpose limit). Delete the whole record with the documents at 90 days (loses the record of why and when someone was rejected, and the proof of deletion). One period for everything (either keeps personal data too long or drops the audit too early).

**MPS impact:** None. **MDS impact:** None until implemented; an erased application would show as "Details erased under retention". **MTS impact:** A later slice: an additive migration with an observable, held-aware erasure and deletion job, as CFG-011 requires of retention jobs. **Data/payment/security impact:** Reduces personal data kept. Running it on production data needs owner authorization.

**Required evidence (when implemented):** SQL suite for erasure, deletion and holds; job observability; owner authorization before the first hosted run.
### DEC-2026-031 — Required vendor application fields; insurance and documents stay optional

**Status:** APPROVED owner instruction. **Date:** 2026-10-14 (America/New_York).

**Decision:** `/vendors/apply` requires, in addition to the existing required fields, the applicant's last name, a business address, at least one Lee County service area and a license or business tax receipt number. The form and `/api/vendor-applications` both enforce them. The insurance policy number and all documents stay optional at submission, so a vendor without insurance yet can apply and obtain it during review; Mercurius collects the documents during review (DEC-2026-030) and activation still requires reviewed, current license and insurance evidence (MPS §8).

**Context:** Applications arrived with skipped fields and no documents. The form had no address field at all and sent an empty address.

**Alternatives considered:** Also require license and insurance documents (owner: applicants may not have them yet and need to obtain them); require the insurance policy number (owner, same day: a vendor without insurance must still be able to apply); keep the application lenient.

**MPS impact:** None to the §8 checklist. **MDS impact:** Required markers and step messages on the application; new business address field. **MTS impact:** Route validation only; no migration (columns unchanged and nullable for earlier and operator-created applications). **Data/payment/security impact:** None.

**Required evidence:** unit `vendor-readiness`; browser `vendor-service-areas`.

### DEC-2026-034 — Operators correct vendor package prices with a reason

**Status:** APPROVED owner instruction. **Date:** 2026-10-15 (America/New_York).

**Decision:** An operator can see every vendor's package prices in one place (`/admin/vendor-prices`) and correct the prices of any package, managed-template or custom: tier prices, add-on prices and the quote deposit. Corrections are also offered on the admin vendor page and in the Package Reviews queue. Every correction requires a reason, records the old and new values, the reason and the operator, and notifies the linked vendor account. The vendor sees what changed and why, not which operator. The vendor does not have to accept; the corrected price applies to the package as saved, and whether it is customer-facing still depends on the package, review flag and provider eligibility. A correction is not an approval: a price still outside the soft-launch guardrail band stays in Package Reviews until approved there. Package name, tiers offered, cadence, mode and active state are unchanged. Prices already agreed on requests, quotes and checkout snapshots are unchanged. On the admin vendor page the managed-template editor no longer saves prices directly; activation and availability are unchanged.

**Context:** Operators could change prices only by direct table writes for managed-template packages, with no reason or history, could not edit vendors' custom packages, and the guardrail queue could approve or pause but not correct. MPS §4 gives the admin "supervised" offering configuration and "send/correct with reason" for prices.

**Alternatives considered:** Approval of every price change before it is customer-facing (not chosen; the existing out-of-band guardrail stays the only gate); vendor acceptance of operator prices (not chosen: vendor is notified only); corrections without a reason (not chosen).

**MPS impact:** Implements the §4 admin price/offering row; no change to fees, payout or price display rules. **MDS impact:** New admin Vendor Prices page; correction dialog; vendor "Price changes by Mercurius" panel on Pricing & Packages and Managed Pricing. **MTS impact:** Migration `20261016001000` (`private.vendor_package_price_corrections`, `admin_correct_package_prices`, `admin_package_price_corrections`, `vendor_my_package_price_corrections`). **Data/payment/security impact:** Operator-only command (`vendor_require_operator`), all or nothing, refused on a stale package or price read; the history table is private; the vendor read omits operator identity. Direct admin table writes remain possible through existing RLS (not removed in this slice).

**Required evidence:** SQL 079; unit `package-price-corrections`; browser `vendor-prices`; hosted migration push by the owner.

### DEC-2026-038 — Promotional commission: 7.5% on any qualifying promotion

**Status:** APPROVED owner decision (Josh), recorded in the pricing review of 2026-10-18 ("Josh approved early promotions and directed that Mercurius cut its commission in half on any promotion"). **Date:** 2026-10-18 (America/New_York).

**Decision:** Ordinary commission stays 15% of the final service subtotal (CFG-005). A booking with one valid applied promotion pays 7.5% on its qualifying commissionable service amount, whether a first or a repeat booking; relief is automatic for a valid applied promotion, never discretionary, and never applied twice. Vendor-funded discount: commission is 7.5% of the discounted eligible amount (e.g. $100 − $10 = $90 paid, $6.75 commission, $83.25 to the vendor). Mercurius-funded discount: commission is 7.5% of the eligible amount before the discount and the discount is a platform subsidy kept apart from commission revenue (e.g. $90 paid, $7.50 commission, $92.50 to the vendor, $10 subsidy). Promotional package: 7.5% of its actual approved price; no invented regular price. One promotion per booking, no stacking with Credits initially; Credits never offset commission. A vendor-funded offer needs the vendor's approval of the offer revision; a Mercurius-funded offer needs admin authorization (with a budget). Changes to amount, scope or funding need approval again. The rate applies only while the booking or occurrence qualifies; a later non-promotional visit pays 15%. Accepted bookings are not repriced when a campaign changes or ends. Taxes, tips and unrelated charges keep their treatment. This replaces the review's proposed 10% rate and first-booking-only restriction.

**Context:** MPS §7.6 requires promotion funder, limits, stacking, refund allocation, expiry timezone and display to be defined; DEC-2026-015 §3 refuses every promotion at checkout until funding, limits and allocation are approved.

**Still open (blocks checkout use):** ~~refund allocation; restoration; the money path carrying the rate and subsidy~~ — answered by DEC-2026-041 items 1–3 (2026-10-18). DEC-2026-015 §3 stays in force for checkout until DEC-2026-041 is implemented and passes the two-person finance review.

**Alternatives considered:** 10% promotional rate and first-booking-only relief (the review's proposal; superseded by the owner); relief only for vendor-funded offers (not chosen).

**MPS impact:** Amends §7.2 for qualifying promotions and answers §7.6 funder, limits, stacking and display. **MDS impact:** Operator Promotions page and vendor offer approval show the rate and a worked split. **MTS impact:** Migration `20261018003000` (offers, redemptions, economics, reservation; not wired to checkout). **Data/payment/security impact:** No charge, refund or payout changes; subsidy and relief are tracked separately in redemption snapshots.

**Required evidence:** SQL 084; unit `promotion-offers`; browser `pricing-approval`; `scripts/pricing-concurrency.mjs`. **Supersedes:** the general 15% statement in CFG-005 and MPS §7.2 for qualifying promotions only.

### DEC-2026-039 — Vendors approve the exact revision of an operator-prepared price; price meaning and add-ons are priced end to end

**Status:** APPROVED owner instruction (implementation task 2026-10-18). Items marked "owner to confirm" are implementation choices for review. **Date:** 2026-10-18 (America/New_York).

**Decision:** (1) A package an operator prepares for a vendor is a private draft and is published only after the authenticated account bound to that vendor approves its exact revision; approval never publishes by itself; any change to price, scope, rule, cadence, add-on, vendor, service or replaced package needs approval again; operators cannot approve for vendors; a notice is not consent. (2) Several named packages may share a vendor, service and cadence; a second active package with the same name for the same vendor and service is refused; a replacement is a new revision of the package's lineage and pauses the previous one, so the approved live revision stays live until replaced and earlier bookings keep theirs. (3) A price is exact, starting at, a range, or quote after walkthrough; only exact prices can be booked as a fixed price; estimates are shown as estimates and need the provider's quote. (4) Add-ons are priced per unit with quantities, required or optional, by cadence, and reach the request amount; a range add-on makes the selection an estimate; included scope cannot be charged again. (5) When several rule-based levels match the same answers, or none does, there is no exact price (previously the cheapest matching level was used). (6) Provider notes are shown for information and are not enforced.

**Amended:** DEC-2026-046 (2026-10-24) removes the vendor's approval as a condition of publication (item 1); approval stays available and recorded.

**Context:** Operator drafts (DEC-2026-035) and corrections (DEC-2026-034) took effect with a vendor notice only. The review asked for revision-bound vendor approval and truthful price meaning end to end.

**Owner to confirm:** ~~DEC-2026-034 corrections; the "first booking" definition~~ — answered by DEC-2026-041 items 3 and 4 (2026-10-18).

**Alternatives considered:** Approval that publishes automatically (not chosen: approval and publication stay separate); operator checkbox as consent (not chosen); in-place edits of live packages for replacements (not chosen: would change rows that requests reference).

**MPS impact:** Implements §4 "approve price/quote: vendor propose; admin send/correct" for prepared prices and §5.3 snapshot content for offerings. **MDS impact:** Draft package editor with homeowner preview; approval state, delivery and history; vendor approval panel; "From", "Set by your answers", estimate and walkthrough wording; required add-ons in the shown price; corrected Managed Pricing copy; Vendor Prices vendor filter. **MTS impact:** Migrations `20261018001000` and `20261018002000`. **Data/payment/security impact:** Restated request preview, submission, finder and checkout source; checkout refuses add-on requests until the money snapshot verifies add-ons; no hosted change until pushed by the owner.

**Required evidence:** SQL 082, 083, 080 (updated), 066 (updated); unit `pricing-content`, `package-drafts`; browser `pricing-approval`, `vendor-prices`; `scripts/pricing-concurrency.mjs`. **Supersedes:** DEC-2026-035's "publishing is not gated by the vendor" and its same-cadence refusal.

### DEC-2026-040 — Legacy live packages without vendor approval evidence

**Status:** APPROVED, option (a), by DEC-2026-041 item 5 (2026-10-18). **Date:** 2026-10-18.

**Context:** Hosted read-only aggregate (2026-10-18): 14 active packages; 6 published from operator drafts without vendor approval (DEC-2026-035), 8 from the vendor's own editor; none carries a recorded vendor approval. Nothing was changed, marked approved or taken offline.

**Options:** (a) Leave them live; vendor-authored packages count as the vendor's own prices, and send the 6 operator-published ones to their vendors for approval as replacement drafts (recommended). (b) Pause the 6 until approved. (c) Treat all 14 as needing approval before R1.

**Required evidence for any option:** the approval inventory (`admin_pricing_approval_inventory`) after the hosted push.

### DEC-2026-041 — Pricing owner decisions: promotion refunds, add-on checkout, first booking, corrections, legacy packages, unlinked vendors, unmatched levels

**Status:** APPROVED owner decisions (Josh), answers to the open questions of the pricing slice (TRACE-112–114). **Date:** 2026-10-18 (America/New_York).

**Decision:**

1. **Promotion refunds and restoration.** Refunds are calculated from the original accepted snapshot: the homeowner's refundable actual payment is refunded, and the corresponding vendor proceeds, Mercurius commission and platform subsidy are reversed proportionally. A vendor-funded discount is not cash and creates no further refund entitlement. Existing approved cancellation charges and fee treatment are preserved; no new fees. A promotion reservation is released after a failed checkout or an expired unpaid request. After cancellation before service, redemption eligibility is restored only when the homeowner receives a full refund and no charge is retained; never automatically after a partial refund, a retained charge or delivered service, except by a documented admin exception. Restoration never extends campaign dates or overrides eligibility. Refunds, releases and restorations are idempotent.
2. **Checkout with add-ons: yes.** The authoritative money snapshot includes required and selected optional add-ons, quantities, the applicable promotion, its funding and the commission, all validated server-side, and preserves the accepted breakdown. Homeowners can select optional add-ons in the intake. These changes go through the existing two-person finance review (`money_publish_snapshot` actor and approver); nothing bypasses it.
3. **First booking.** Eligible when the homeowner has no previous completed Marketplace service; pending, declined, expired or cancelled requests do not consume eligibility. At most one active first-booking reservation per homeowner, revalidated when the booking is committed. The restriction applies only to offers marked first-booking; every other qualifying promotion, including repeat-booking offers, still receives 7.5% (DEC-2026-038).
4. **Operator price corrections.** A material change (price, included scope, quantities, cadence or material terms) requires the vendor's approval of the replacement revision; notification alone is insufficient. Spelling or formatting corrections stay operator-managed. Operators may suspend an incorrect listing while approval is obtained. Accepted bookings keep their original terms. Supersedes DEC-2026-034 for material changes.
5. **The 14 live packages (DEC-2026-040 option a).** They stay live unless a known error warrants suspension. The six operator-published packages get replacement drafts sent for vendor approval; the live revision stays live until its approved replacement is published. Legacy approval status is recorded accurately; the approval evidence for the other eight is verified; no historical approval is fabricated.
6. **Unlinked-vendor notice: email on file.** When the vendor account is not linked, the notice goes to the existing vendor contact email through the existing notification system, and explains that account linking and authenticated approval are required. Email delivery is not approval; replying cannot approve. Missing or failed delivery stays visible to the operator. The notice carries no sensitive information.
7. **No matching level: no exact price.** The homeowner sees "Price requires confirmation" and which answer prevented an exact match. The next level is never chosen automatically and the lowest level's price is never shown as applicable. A "Starting at" amount is shown only when the vendor has explicitly approved an applicable fallback rule.

**Order:** the four decision-free fixes from the source comparison; these decisions; two-person finance review and end-to-end verification; then the migrations prepared for review (owner dry run and push before merge, DEC-2026-037).

**MPS impact:** Answers §7.6 refund allocation and restoration; amends §4 for corrections. **MDS impact:** optional add-on picker; "Price requires confirmation" with the blocking answer; operator delivery status including email. **MTS impact:** money source and snapshot carry add-ons and promotion economics; promotion release/restore paths; email notice through the existing notification system. **Data/payment/security impact:** reviewed money code changes (R1); no hosted change until pushed by the owner.

**Amended:** DEC-2026-046 (2026-10-24): items 4 and 5 no longer require the vendor's approval before an operator publishes.

**Supersedes:** DEC-2026-034 for material corrections; DEC-2026-039 "owner to confirm"; the first-booking definition implemented in `20261018003000`; DEC-2026-040 (decided).

### DEC-2026-042 — How a homeowner applies an offer; matching keeps the priced selection

**Status:** APPROVED owner directions (Josh), "Continue the existing Mercurius pricing implementation", 2026-10-20 (America/New_York). Items marked "implementation choice" are for review.

**Decision:**

1. **Explicit selection.** A homeowner selects an eligible displayed public offer or enters a promotion code. Nothing is applied, replaced or switched automatically. Code-only offers are never listed publicly. When several offers qualify, each shows its actual saving on the same service and selected add-ons; the greatest is labelled "Best savings" and is not selected. One promotion per booking; no Credits stacking. Where Credits are eligible the homeowner compares and chooses between Credits and a promotion (no Credits ledger exists yet, so nothing to compare). Applying another offer replaces the previous one and updates the total.
2. **Server-side validation and confirmation.** Eligibility, dates, redemption limits and campaign budget are checked on the server before the booking is committed. If an offer becomes unavailable or the total changes, the homeowner is told and must confirm; another offer is never substituted and the undiscounted amount is never charged without confirmation. The selected offer revision, funding, discount, commission base and 7.5% promotional commission are snapshotted with the booking. Commission stays 15% on ordinary bookings and 7.5% on any qualifying applied promotion, repeat bookings included; Credits never offset commission (DEC-2026-038).
3. **Automatic matching.** Unsupported add-on combinations are refused explicitly: add-ons are never silently removed, the total never misstated, and a request is never accepted for a provider who cannot fulfill it; supported add-on flows are preserved.
4. **Deferred.** Vendor-approved "Starting at" fallback pricing and operator typo-only edits; price confirmation and vendor approval stay in use where those are absent.
5. **Gates and rollout.** The promotions gate stays closed until the required two-person finance review passes. The unpaid-reservation cleanup schedule is prepared for Josh's authorization, not activated. Production migrations, real vendor notifications and the gate each need their own authorization; after the migrations are applied and the replacement-draft workflow is verified, the six operator-published packages get replacement drafts and approval requests, without duplicates and without fabricated historical approval.

**Implementation choices (TRACE-116, for review):** the offer is chosen on the final review for each exactly priced service and reserved in the same transaction as the request; until checkout starts the homeowner can replace or remove it from the request; a request whose offer was released by cleanup, or whose confirmed price changed, cannot reach checkout until the homeowner chooses again (`private.promotion_selections`). A request carrying add-ons or an offer is matched only to the package, price level and revision it was priced from; when that provider cannot take it, matching stops for operator review. Add-ons without a chosen offering are refused at submission. Recurring visits of a request with add-ons carry its priced selection. Code lookups: 10 unknown codes per homeowner per hour. Cleanup also releases unpaid reservations whose offer ended, changed or was retired, since such a reservation can no longer reach checkout and would otherwise hold a first-booking slot and campaign limits.

**Context:** PRICING-IMPROVEMENTS §5.2 left offer application open; nothing reserved an offer for a request.

**MPS impact:** Answers the remaining §7.6 display question (how a promotion is applied). **MDS impact:** "Offers" on the request review (choice list, "Best savings" label, code entry, totals after offers); "Offer" section on the homeowner's request; gate and cleanup state on the operator Promotions page. **MTS impact:** Migration `20261018006000`; `scripts/install-promotion-sweep.sql` (inactive schedule template). **Data/payment/security impact:** restated `money_source`, `promotion_reserve`, `promotion_release_unpaid`, `submit_service_requests`, `find_eligible_packages_core`, `create_service_occurrence`, `admin_send_package_draft`; all money behavior stays behind the closed gate and is part of the finance review.

**Required evidence:** SQL 087; `scripts/pricing-concurrency.mjs`; unit `promotion-selection`; browser `request` (offers), `promotion-selection`, `pricing-approval`. **Supersedes:** PRICING-IMPROVEMENTS §5.2 (open question).

### DEC-2026-051 — Vendor-based pricing; catalog prices are reference defaults; services saved without publishing

**Status:** Items 1–5 APPROVED owner task instruction (2026-10-29, vendor onboarding of pest and other service vendors); items 6–8 PROPOSED, need the owner's decision. **Date:** 2026-10-29 (America/New_York).

**Decision:** (1) A vendor's price, price type and cadences for a service are its own package, independent of every other vendor and of the catalog. Catalog pricing mode and prices are reference defaults: they never price a vendor and changing them changes no vendor price. This was already how pricing worked (characterized in TRACE-129); the admin catalog now says so. (2) A vendor with no price for a service is not priced from the catalog. An operator may offer it as that vendor's Custom Quote from the vendor record. The quote is published through the existing draft-and-publish command with a reason (DEC-2026-046): it is never sent for approval and no email is sent; a linked vendor gets the usual inbox notice. It is never automatic. (3) "Save services" on the vendor record saves Services Offered and service ZIP codes only, without publishing and without changing visibility, Marketing or other profile fields. (4) Termite Control, Rodent Control, Mosquito Control and Flea & Tick Control are added to Specialty as shown Custom Quote services with $0 reference prices, offering monthly, quarterly and one-time (default one-time). (5) A service named on a vendor's application with no catalog match can be added to the catalog from the vendor record (Custom Quote, shown), under DEC-2026-044.

**Proposed (not implemented):** (6) A "twice a year" cadence (asked for as "bi-annual"); cadences are a fixed list shared with recurring visits (DEC-2026-049), so a new one is its own slice. (7) Whether a vendor may price cadences the catalog does not offer for the service; today the catalog's cadence list limits every vendor's cadences (an operator can add a cadence to the service, which changes no vendor's price). (8) Whether the catalog reference prices should keep setting the custom-price guardrail band (an out-of-band custom price waits in Package Reviews, including an operator's publication).

**Context:** Onboarding Walter Salazar Pest Control (hidden, Marketing off) needed per-vendor quote-only pricing, pest services missing from the catalog, and a way to save services on a hidden record without Publish. Hosted read-only 2026-10-29: 28 vendors, 23 list at least one service with no package. An automatic quote fallback would have made those 23 quote-matchable at once, so the fallback is an explicit operator action. Found while testing: `admin_publish_package_draft` refused any quote with no price levels (its price-history row required a level change), so no operator could publish a pure Custom Quote.

**Alternatives considered:** Treating every listed service without a package as Custom Quote in matching (not chosen: changes what 23 existing vendors offer). Copying catalog prices into vendor packages (not needed: no displayed or charged price comes from the catalog). Changing Pest Control's catalog row (not requested; it prices no vendor).

**MPS impact:** None to fees, payout, matching or availability rules. **MDS impact:** "Save services" and "Offer as Custom Quote" on the vendor record; "Add to catalog" in the application banner; catalog columns read "Default mode" and "Reference" prices; price history reads "Offered as Custom Quote". **MTS impact:** Migration `20261030001000` (catalog rows; `admin_publish_package_draft` restated with one addition: a quote entry in the price history when no level is published). **Data/payment/security impact:** Catalog rows only; no vendor's services, prices, visibility or Marketing changes until an operator acts. No money function changed.

**Required evidence:** SQL 099, 081; unit `vendor-services`, `package-price-corrections`.

### DEC-2026-049 — Recurring visit operating rules and charge timing

**Status:** Items 1–4 and 9 **APPROVED** owner decision with clarifications (Josh, 2026-10-26; recorded below and implemented by 6.6b / TRACE-124). Items 5 and 6 (existing visits) **APPROVED** owner decision (Josh, 2026-10-27; recorded below and implemented by 6.6c / TRACE-125, not released: the two-person finance review must finish before merge). Items 7 and 8 stay **PROPOSED**: the owner confirmed only that quote-priced, promotional and replacement-provider visits stay unpayable; the proposed first-visit promotion, per-plan quote and replacement rules are not approved. 6.6a (TRACE-123) builds only what does not depend on these rules: visit identities, operator-created visits on the accepted plan terms, history and guards. **Date:** 2026-10-25, amended 2026-10-26 and 2026-10-27 (America/New_York).

**Owner decision, 2026-10-26 (items 1–4 and 9; supersedes the bracketed defaults for those items where they differ):**

1. **Anchor and cadence.** An explicitly recorded Eastern date and time, with operator, reason, the basis for the agreed time and append-only history. Recording an anchor does not supply any separate appointment confirmation policy still requires. Weekly / every two weeks: calendar-day increments. Monthly / every two months / quarterly: always from the original anchor; a shorter month clamps to its last day and later dates return to the anchor's day (31 Jan → 28/29 Feb → 31 Mar). Monthly is a day of the month, not a weekday pattern; weekends are not shifted. Re-anchoring with a reason changes future proposals only and preserves existing visits, earlier anchors and earlier decisions. A cadence date can be explicitly skipped, or replaced by a visit of the same plan, with a reason; one visit satisfies at most one cadence date; linking does not change the visit's appointment, provider, price or commercial identity; these mappings stay visible across re-anchoring and are not silently reinterpreted.
2. **Horizon and lead time.** Proposals run through today + 60 Eastern calendar days, inclusive, and only enough to bring future non-cancelled visits (off-cadence included) plus proposals up to two; with two or more future visits nothing more is proposed and existing visits are not altered. A cadence date holding a visit is handled whatever the visit's status; cancelled visits do not use the two-visit capacity. The empty state shows the next cadence date and when it enters the horizon. A proposal is at least 24 hours away (resolved appointment instant against the current instant), rechecked on the server at creation. Neither the horizon nor the 24-hour rule restricts the existing manual creation command, which is distinguished from creating a proposal.
3. **Daylight saving: explicit resolution (option A).** Visits keep the Eastern wall time across normal changes. A nonexistent or ambiguous time requires an operator choice before creation; the selected time and offset are shown in the confirmation and history; the exception does not change the anchor. No overnight-anchor ban.
4. **Missed visits and lifecycle.** No automatic make-up visit and no anchor movement for cancelled, declined, missed or skipped dates; a manual make-up visit is reconciled explicitly where it replaces a cadence date. Pause, resume and "Stop future visits" are operations-only in 6.6b. Pause stops all new visit creation, including direct calls to the manual command, with recorded `series_paused` outcomes; existing visits and offers are unchanged. Resume is immediate, keeps the anchor and proposes only eligible future cadence times; dates that passed while paused are not backfilled. Stopping future visits is final, blocks every creation path with recorded `series_ended` outcomes and does not change the plan request's status. The confirmation says existing visits and open offers remain in place and need individual handling, and those visits are shown afterwards. These controls only add restrictions: resuming never reactivates a cancelled plan, restores admission or bypasses provider, terms or other eligibility checks. Cancellation and refund workflows are not expanded here, and the existing per-visit path is not claimed to meet the remaining 6.9 requirements.
9. **Identity.** One visit per plan per Eastern date, cancelled dates keeping their identity. The legacy `job_visits` generator stays stopped; its rows and functions are kept.

**Owner decision, 2026-10-27 (items 5–8, given with the Codex architecture requirements for 6.6c; supersedes the bracketed defaults for items 5 and 6 where they differ):**

5. **When a visit is payable.** Commercial review is eligible only after that visit's own provider acceptance. The existing two-person snapshot publication is unchanged and nothing publishes automatically. Operations sees "review missing" and "ready but unpaid" for an accepted, unpaid visit from its appointment minus 24 hours, or at once when it is accepted after that point. The existing confirmed-failure and unknown-outcome classifications and recovery (DEC-2026-045 G6) are kept. No automatic cancellation and no new homeowner notification. Unpaid-start behavior is unchanged in 6.6c: whether work may start before payment is an explicit 6.7 acceptance item, not a permanent rule set here. Payment is only the homeowner's explicit checkout of the reviewed snapshot: no stored card, automatic charge or new payment activation.
6. **Price change during a plan (existing visits).** A created visit keeps the service price and add-ons of the exact immutable plan terms bound to that visit's creation, never the plan's latest acceptance, checked against the visit's own accepted offer. Later package or tier edits neither change the amount nor force a review at a new price. Applicable live eligibility refusals stay (provider, service, coverage, provider ZIP, package offered and not under review), without substitution or repricing, and name the exception and its recovery. New visits keep the existing changed-terms safeguards (`terms_changed`).
7. **Quote-priced plans and promotions.** Kept blocked: visits of quote-priced or promotional plans are neither created nor payable. The proposed per-plan quote and first-visit promotion rules are **not** approved.
8. **Replacement provider.** Kept blocked: only the plan provider's own acceptance of a visit is payable. The proposed per-visit replacement rule is **not** approved.

**Implementation (6.6c / TRACE-125, migration `20261027001000`):** see [PHASE-6-RECURRING-PAYMENTS-BRIEF.md](PHASE-6-RECURRING-PAYMENTS-BRIEF.md) §9. The same accepted-price exposure on **one-time** requests (DEC-2026-034 "prices already agreed on requests … unchanged") is not changed here; it is tracked as the separate corrective issue TRACE-126 with a characterization case in SQL 097.

**Context:** No approved rule says how recurring visits follow a cadence or when each becomes payable (roadmap Phase 6 carry-in; PHASE-5-CLOSURE-READINESS). Each item needs an answer before its sub-slice; the recommended default is in brackets. See [PHASE-6-RECURRING-VISITS.md](PHASE-6-RECURRING-VISITS.md) §4.

1. **Anchoring.** [The first visit's Eastern date and time, agreed when the plan starts, is the anchor. Weekly and every two weeks: same weekday and time, +7/+14 days. Monthly, every two months, quarterly: the anchor's day of month, or the month's last day when shorter (31 Jan → 28/29 Feb → 31 Mar), always computed from the anchor so it never drifts.]
2. **Horizon.** [Keep the next two visits created, never more than 60 days ahead; operators confirm each proposed visit until scheduled generation is approved separately.]
3. **Daylight saving.** [Visits keep their Eastern wall time. A time that does not exist on a spring-forward date moves to the same minutes after 3:00 AM; a repeated fall-back time uses the first (EDT).] Implemented today: explicit times only; nonexistent times refused; the operator chooses EDT or EST.
4. **Missed visits; pause, resume, end.** [A cancelled, declined, no-show or skipped visit does not move the cadence and creates no automatic make-up visit. Homeowner or operations may pause (no new visits), resume (next visit from the anchor on or after the resume date) or end the plan; ending cancels each remaining scheduled visit individually under CFG-006, never as one charge.]
5. **When a visit is payable.** [Each visit's commercial snapshot is published after its provider accepts that visit; the homeowner receives a payment link through the existing checkout; no stored card and no automatic charge. An unpaid visit 24 hours before its appointment enters an operator queue (no automatic cancellation). Payout unchanged: 48 hours after that visit's homeowner-confirmed completion, held on dispute.] Requires the finance review gate before release.
6. **Price change during a plan.** [Visits keep the accepted plan terms. A provider price change or new revision blocks new visits (as implemented) until the homeowner accepts the new terms through a new plan acceptance; operations is notified through the history.]
7. **Quote-priced plans; promotions on plans.** [Quote-priced plans need a per-plan accepted quote that sets the visit price before visits are created. A promotion applies to the first visit only (one promotion per booking, DEC-2026-038), not to later visits.] Implemented today: both block visit creation.
8. **Replacement provider for one visit.** [When the plan provider declines or lets a visit's offer expire, the existing fallback consent applies per visit; a replacement must accept the plan's visit price; the plan's provider is unchanged.]
9. **Implementation choices to confirm.** One visit per plan per Eastern date (a cancelled visit keeps its date; a replacement on the same date is a 6.9 reschedule). The legacy `job_visits` generator is stopped (0 hosted rows); existing rows and functions are kept.

**MPS impact:** §6.4 gains the approved recurring operating rules (items 1–4, 9) and, with §6.5, the payment timing and accepted-price rules (items 5–6, 2026-10-27); §6.6 recurring cancellation stays with 6.9; items 7–8 stay open. **MDS impact:** proposed visits, pause/resume/"Stop future visits" (6.6b) and unpaid visit states (6.6c). **MTS impact:** cadence and charge-timing commands (6.6b/6.6c); scheduler only with separate activation approval. **Data/payment/security impact:** item 5 touches the money path and needs the two-person finance review; nothing activates payments, Cron or messages.

### DEC-2026-048 — Prepaid plans for recurring cadences

**Status:** APPROVED owner answers (Josh, 2026-10-24, vendor onboarding review item 4) and APPROVED owner rules for the open items (Josh, 2026-10-25, Codex review of PR #110); **not implemented**. Implementation is its own slice ([brief](PHASE-6-PREPAID-PLANS-BRIEF.md)) because it changes checkout, scheduling, payout and refunds, and the money path needs finance review. **Date:** 2026-10-24, amended 2026-10-25 (America/New_York).

**Decision:** A price level can be billed "per visit" (current behavior) or as a "prepaid bundle": a total price and the number of visits it covers (e.g. Quarterly: $135 per quarter, 4 cleanings). Public profile and booking show the total. (1) Checkout charges the full prepaid amount up front and schedules the covered visits with no per-visit charge. (2) Add-ons chosen for a prepaid plan are multiplied by the visits covered and added to the up-front total; no per-visit charges. (3) Renewal: before the period ends the homeowner receives a payment link for the next period through the existing checkout; no card is stored and nothing is charged automatically. (4) Payout: each visit's share (total ÷ visits) becomes eligible 48 hours after that visit's homeowner-confirmed completion, held on dispute as usual; on cancellation, unused visits are refunded at their share under the approved cancellation policy.

**Context:** Spiffy Clean Canz's quarterly plan ($135 prepaid for 4 cleanings) can only be entered as $33.75 per cleaning today. No saved-card or off-session charging exists, which is why renewal is a payment link.

**Owner rules, 2026-10-25 (resolve the earlier open items; they refine items 1–4 above):**

1. **Fee base.** The platform fee is assessed once, at purchase, on the approved bundle service subtotal: the bundle price plus prepaid add-ons, after applicable discounts, excluding tax and tips. The applicable commission rule is snapshotted once with the purchase: 15% ordinarily, 7.5% for a bundle with one valid applied promotion (DEC-2026-038), so ordinary and promotional economics are unchanged. Commission is never assessed again on each visit.
2. **Cancellation.** The CFG-006 windows apply separately to each scheduled visit's allocated share: 72 or more hours before the visit, full refund; 24 to under 72 hours, 50%; under 24 hours, none. The approved weather/emergency waivers (CFG-006) still apply. An unused visit that is not yet scheduled is refunded its full allocated share. Cancelling the plan evaluates each remaining visit individually by these rules.
3. **Rounding.** Whole-cent shares are allocated once, at purchase, in stable visit order: the amount is divided evenly and remainder cents go to the earliest visits. Service amount, add-ons, discounts, commission and any Mercurius subsidy are allocated the same way, so each component's visit shares sum exactly to its bundle total. Shares are never recalculated from the visits remaining.
4. **Renewal.** An unpaid renewal does not activate the next term and authorizes no new-term work; nothing is charged automatically. A provisional schedule for the next term is shown as unpaid. The current paid term and its unused visits are preserved. Paying late requires fresh availability and terms checks before the new term starts. Each renewal creates a new term and a new payment obligation, with protection against duplicate payment and duplicate visits.
5. **Payout.** Payment is collected up front; each visit's vendor proceeds become eligible 48 hours after that visit's homeowner-confirmed completion, subject to existing holds (CFG-008).
6. **Ending.** Ending or not renewing a plan never silently forfeits paid unused visits: they stay schedulable or are refunded under rule 2.
7. **Provider cancellation.** A provider's cancellation of a visit follows the existing replacement/refund policy (CFG-007), with no homeowner cancellation penalty.

**Still required before release:** two-person finance review of the snapshot, allocation, ledger, refund and payout changes (the same gate as DEC-2026-038); the MPS §7 amendment for the prepaid billing mode at implementation.

**MPS impact:** §7 commercial rules gain a prepaid-bundle billing mode (amendment needed at implementation); §6.6/CFG-006 windows apply per visit share as above. **MDS impact:** price-level billing mode in the operator and vendor editors; bundle totals on the public profile and booking; unpaid provisional renewal state. **MTS impact:** none yet (the slice brief lists the expected records). **Data/payment/security impact:** money path, per-visit allocation, payout eligibility per visit share, refunds and renewal obligations; requires finance review before release. Nothing in PR #110 builds or activates a prepaid checkout, entitlement, payout, refund or renewal path.

### DEC-2026-047 — Vendor onboarding review: internal notes, size guide, archive, checklist exception

**Status:** APPROVED owner instruction (Josh, 2026-10-24, vendor onboarding review items 1, 2, 3, 5 and 6) and owner answer to item 5 (exception counts as current until the follow-up date). **Date:** 2026-10-24 (America/New_York).

**Decision:** (1) A package's notes are Mercurius-internal ("Internal notes (not shown to homeowners)"): never rendered on the public profile, kept outside the revision content and edited without a new version, republishing or vendor notice. They belong to the package across its versions. (2) The bedroom-to-size guide is shown once on the public profile ("How we size your home", in Pricing Overview) when a live fixed package is priced by number of bedrooms; package descriptions say only what the service includes. (3) An operator archives a paused or replaced package with a reason: removed from Vendor Prices and its counts, kept under "Archived prices" with the archive record, never turned back on, no vendor notice. A live package must be suspended first; an open replacement draft must be published or discarded first. (4) An operator marks licensing or insurance current without a document by an exception: reason, approver and follow-up due date are required. It is evidence that expires at the end of the follow-up date (America/New_York), so it counts toward activation and matching until then and lapses on its own; it is shown as "Exception: document pending" until a document is recorded over it, and every exception stays in the exception history. It never replaces a current document. Scoped (category/ZIP) compliance is unchanged. (5) "Experience 1 year" is pluralized correctly.

**Context:** Owner review of vendor onboarding, 2026-10-24. Package notes were part of the revision hash that submitted requests are bound to, so a notes edit needed a replacement version; descriptions repeated the size guide on every card; paused and superseded versions had no discard action; licensing could not be current while its document was pending.

**Alternatives considered:** Editing `policy_notes` on live revisions (not chosen: it changes the revision hash and invalidates bound requests); stripping the guide text from descriptions when displayed (not chosen: descriptions are vendor content; an operator replaces them through a draft); an exception without expiry (not chosen by the owner; MPS §8 requires an expiry).

**MPS impact:** §8 activation checklist note: licensing/insurance may be current by a recorded, expiring exception. §6.7 badges unchanged (badges are operator-managed and not derived from this evidence). **MDS impact:** internal notes field and dialog; "How we size your home"; Archive action and Archived prices; exception form, badge and history. **MTS impact:** migration `20261024003000` (new private tables, guards and commands; `operator_package_draft_json`, `pricing_draft_content_from_package`, `admin_package_contents` restated). **Data/payment/security impact:** existing notes copied to the internal table; the legacy column keeps its values for existing revisions (their hashes) and stays readable through the API until those revisions are replaced; an exception can make a provider eligible for matching without a licensing document until its follow-up date. No money-path change.

**Required evidence:** SQL 093; unit `home-size-guide`, `pricing-content`; browser `vendor-prices`, `pricing-approval`, `onboarding-checklist`.

**Amended 2026-10-25 (owner-approved Codex review of PR #110; migration `20261025001000`, SQL 094):** (a) Legacy `vendor_packages.policy_notes` values are Mercurius-internal: anonymous users, homeowners and vendors can no longer read them through the table (column-level SELECT without that column), filters or `select *`, nor write them; the vendor's draft/approval readback omits them from legacy draft content. Values, accepted requests and revision hashes are unchanged; operators read them through the admin readbacks. This replaces the earlier note that the column "stays readable through the API". (b) An archived package is read-only history on every write path (its row, levels, questions and add-ons); the vendor sees it as "Archived" with no publish, edit or delete action and outside paused counts and coverage suggestions. (c) The size guide follows the price levels' rule conditions: "Prices are set by the number of bedrooms" only when bedrooms alone set the price; multi-factor pricing names every factor; square-footage pricing that also asks bedrooms shows no guide. (d) An exception's follow-up due date is after today and at most 14 calendar days after today (America/New_York); expiry stays the end of that date; no automatic renewal: a further exception is a fresh review with its own reason, approver and record, supersedes the current one explicitly, and is shown as a repeat. An exception records documentation pending only and claims no verification, license or insurance. **Rollout:** `20261025001000` is pushed after the PR #110 deploy lands (the narrowed privileges break the client deployed before PR #110; the PR #110 client works on either schema); until then the legacy notes stay readable as before.

### DEC-2026-046 — Operators publish prices without the vendor's approval

**Status:** APPROVED owner instruction (Josh, 2026-10-24: "The admin should be able to publish pricing without the approval of the vendor"). **Date:** 2026-10-24 (America/New_York).

**Decision:** An operator publishes any open draft price, a new package or a replacement (correction) of a live package, with a reason the vendor reads, whether or not the vendor approved it. Sending a draft to the vendor for approval stays available and optional: the vendor can still approve the exact revision or ask for changes, and both are recorded. Publication records and reports whether the vendor had approved the published revision; the vendor is told in their inbox ("Mercurius published a price for you", or "Your approved price is live" when they had approved it). Unchanged: only operators publish; a reason is required; a stale read is refused; distinct package names; the guardrail band still sends an out-of-band price to Package Reviews; accepted bookings and quotes keep their terms; package approval evidence never claims an approval that was not given (`operator_published`). Vendor-funded promotion offers still need the vendor's approval (DEC-2026-038), because the vendor funds the discount.

**Context:** DEC-2026-039 item 1 and DEC-2026-041 item 4 made the vendor's approval of the exact revision a condition of publication. While onboarding vendors the owner needs to set prices without waiting for each vendor account to be linked and to answer; all 14 live production vendors were unlinked at the 2026-10-20 audit, so no operator price could be published at all.

**Alternatives considered:** An approval override with a separate reason (not chosen: the publish reason already records why, and the owner asked for publication without approval, not an exception path). Removing the send-for-approval flow (not chosen: not requested, and it remains useful when an operator wants the vendor's agreement first).

**MPS impact:** §4 offering prices note amended: publication no longer waits for the vendor's approval. **MDS impact:** Publish is available on every open draft; the publish dialog says whether the vendor approved the version and shows a pending change request; admin, vendor and email copy no longer says a price waits for approval. **MTS impact:** `admin_publish_package_draft` restated (`20261024001000`); no schema or data change. **Data/payment/security impact:** Vendors' live prices can change without their consent; the vendor is notified with the reason, and the event history records it. Fees, payout and checkout are unchanged.

**Supersedes:** The publication condition of DEC-2026-039 item 1 ("published only after ... approves its exact revision") and DEC-2026-041 item 4 ("requires the vendor's approval of the replacement revision"); DEC-2026-041 item 5's replacement drafts no longer need approval before publication.

**Required evidence:** SQL 091 (and 080/083/085 updated); browser `vendor-prices`, `pricing-approval`; unit `draft-email-notices`.

### DEC-2026-045 — Phase 6.4 quote policy: itemization, deposits, accepted terms, aging, suspended providers, payment failure

**Status:** APPROVED owner decisions G1–G6 (2026-10-22, America/New_York); implementation choices recorded for Codex review. **Date:** 2026-10-22.

**Decision:**

- **G1 Itemized quotes.** Quotes list service, labor, materials and add-on lines with quantities, discounts and the service subtotal, reusing the existing pricing components. Unresolved tax reads "Tax pending confirmation", never $0 or tax-exempt. Preliminary proposals stay drafts or clearly identified estimates. Final quote acceptance and checkout require a complete reviewed breakdown, applicable tax treatment, payment terms and policy version. No tax rule is invented and no taxable transaction is activated without the existing release evidence (DEC-2026-015 §4).
- **G2 Deposits.** The initial beta quote deposit is $0; payment uses the existing reviewed invoice and checkout under its approved timing. No new full-payment deadline. Existing deposit records, accepted terms and recovery paths are preserved and historical agreements are not reinterpreted. Vendors or jobs that require a deposit are flagged for operator review before commitment. Configurable materials deposits, percentages, due dates and refund rules are a separate future policy.
- **G3 Changes after acceptance.** An accepted quote cannot be overwritten or materially replaced through any path, including the older operator send command. The accepted revision, scope, amounts, acceptance evidence and history are preserved. A required material change creates an operator exception; an admin reason alone never authorizes a higher customer charge; no added scope or increased charge without homeowner authorization. No change-order system in this slice; an agreement that cannot be fulfilled follows the approved resolution or cancellation process without new fees or refund rules.
- **G4 Aging.** Queue thresholds: provider proposal missing 24 hours after a quote becomes required from the assigned provider; submitted proposal awaiting operator review or send 4 hours after submission; sent quote awaiting the homeowner 12 hours after sending. The 24-hour quote expiry (DEC-2026-008) is unchanged. Aging creates a queue item only — never acceptance, cancellation, reassignment or extension. Timestamps and history are preserved; ordinary edits do not reset aging; a replacement quote has its own revision and deadline. Queue visibility may ship; reminders and external delivery keep their activation gates.
- **G5 Suspended providers.** A suspended provider cannot submit or revise a proposal and an operator cannot send its pending proposal. Current eligibility is rechecked at proposal, operator send and homeowner acceptance. Historical records, support participation and evidence stay available. Assigned jobs are flagged for operator review; suspension never deletes assignments, cancels jobs or issues refunds by itself.
- **G6 Payment failure.** The accepted quote and request are preserved after a payment failure, reusing the existing obligation, invoice, checkout and idempotent recovery. Confirmed failure is distinct from processing or unknown results; a browser return is not payment confirmation. Duplicate charges and competing active checkout attempts are prevented. No silent repricing, offer removal or current-catalog substitution; changed payable terms need fresh homeowner review. An operator payment-exception item appears immediately for a confirmed failure or an unresolved outcome needing investigation; a confirmed failure unresolved for 24 hours is aged. Failure never automatically cancels, charges again, starts service or releases provider funds.

**Implementation choices (TRACE-119, migration `20261022001000`):** (1) Tax: no command records a confirmed tax treatment, because no approved tax rule exists; every quote sent now shows tax pending and cannot be approved. Approval therefore waits on the tax authority (activation dependency). (2) "Complete reviewed breakdown" is the immutable `request_quote_terms` row of the quote revision; a legacy single-amount quote has none and cannot be approved; nothing is backfilled. (3) A quote amount for a tax-pending revision records the service subtotal; a confirmed revision records subtotal plus tax, the total the money source already requires. (4) Lines are whole cents; quantity times unit price must be whole cents (no rounding rule is introduced). (5) "Before commitment" for a deposit flag means before the quote is sent; an operator records a deposit review first. (6) Eligibility is `private.vendor_matching_eligible`, the existing matching rule (suspension, exclusions, evidence lapse, cutover). (7) G3 is enforced by retiring `admin_send_quote` (it now refuses) and by triggers that refuse any change to a decided quote or to the request fields of an accepted quote, including direct operator writes allowed by RLS. (8) Queue items are computed from recorded events (offer acceptance, decline, expiry, return, proposal and quote times, checkout attempts and webhook receipts), not stored, so they cannot be skipped or reset. Unknown outcome = an attempt in `reconcile`, an open reconciliation flag, or a session past its expiry with no recorded result; confirmed failure = a checkout the payment webhook recorded as expired unpaid.

**Context:** Phase 6.4 first sub-slice left gaps G1–G6 open for owner decision (governance/PHASE-6-QUOTES.md).

**MPS impact:** §6.3 quote rules and §7.5 deposit-plus-quote now have the beta values above; §9 quote-aging and payment-exception queues have thresholds. **MDS impact:** itemized quote editor and breakdown; "Tax pending confirmation"; exception queue; payment return notice no longer reads as confirmation. **MTS impact:** additive tables `request_quote_proposals`, `request_quote_terms`, `request_quote_exceptions`; restated `homeowner_respond_to_quote` and `admin_send_quote`; new guard triggers. **Data/payment/security impact:** no money kernel changed; quote discounts are not promotions, and how a quote discount line maps to a snapshot (which records any discount with promotion terms) is open for finance review.

**Required evidence:** SQL 090 and updated 005/007/023; unit `quote-proposals`; browser `quote-proposals`, `portals`.

### DEC-2026-044 — Operators add services to the catalog; taking one away hides it

**Status:** APPROVED owner instruction. **Date:** 2026-10-21 (America/New_York).

**Decision:** The catalog must grow as vendors are onboarded. Operators add a service from Service Catalog with a name, category, description, icon, search tags, reference prices, the cadences it offers and its pricing mode. Its id is derived from the name, can be changed before it is added, and is fixed afterwards. A new service is shown on the site at once; until an eligible vendor offers it, homeowners see "Not available yet in your area" (CFG-002), and vendors and operators can price it immediately. Taking a service away hides it: the row, its history and vendor prices are kept, and showing it again restores it. Services are not deleted from the operator UI (TRACE-118).

**Context:** While building vendor profiles the owner could not add roof replacement, roof repair, pool construction, pool resurfacing or AC repair: the catalog editor only edited and hid the 45 seeded services.

**Alternatives considered:** A migration seeding the five requested services (not chosen as the fix: the next request would need another migration; the owner can still ask for one). Deleting services (not chosen: `vendor_packages`, `pricing_templates` and operator drafts cascade on delete, and requests and compliance rows refer to the id). Categories added the same way (not requested; the six categories cover the requested services).

**MPS impact:** None to fees, payout, matching or availability rules; a new service follows the existing rules. **MDS impact:** "Add service" dialog sharing the edit form; icon and tags editable; "Shown" switch. **MTS impact:** None to schema; the existing admin-only insert/update policies are the boundary (SQL 089). **Data/payment/security impact:** Catalog rows only; no customer, vendor or price data changes until an operator acts.

**Required evidence:** Unit `service-catalog`; SQL 089; browser `catalog-cadences`.

### DEC-2026-043 — Accepting a provider invitation binds the account automatically

**Status:** APPROVED owner instruction. **Date:** 2026-10-20 (America/New_York).

**Decision:** When the verified recipient accepts an application-based provider invitation, the accepted account is bound to the provider in the same transaction, without a separate operator binding step (TRACE-117). The automatic binding proves everything the operator command (`vendor_bind_invited_account`, TRACE-070) proves: the provider is in review, the receipt answers the current application version, the Auth dispatch and receipt name the same confirmed account, that account's address is the reviewed application recipient, the provider has no account, the account belongs to no other provider and no other invitation is live. If any of these does not hold, acceptance still succeeds and nothing is bound; the operator command stays available as the fallback and reports the specific reason. Binding still grants no role, accepts no evidence, activates nothing and publishes no listing; the vendor role still follows only from a reviewed activation (TRACE-068).

**Context:** Two applicants (2026-10-14 and 2026-10-16) were in review with no invitation sent. The operator binding step re-checked only conditions the database can prove at acceptance, and added a manual step between the vendor accepting and the operator approving.

**Alternatives considered:** Keep the reviewed operator binding (not chosen: the review it added was mechanical). Also auto-bind existing-provider access invitations (not chosen: that binding grants the vendor role under DEC-2026-024, so it keeps its operator review).

**MPS impact:** None to roles or approval; operator review stays at activation. **MDS impact:** Admin account panel copy names manual binding as the fallback. **MTS impact:** Migration `20261020001000`; `vendor_accept_invitation` replaced with the same signature. **Data/payment/security impact:** The link decision records the recipient as actor and the receipt it relied on; release and the reviewed-link predicate are unchanged. Supersedes TRACE-070's requirement that an operator decide the binding, for application-based invitations only.

**Required evidence:** SQL 088; updated SQL 031/033/037/075; hosted migration push before merge.

### DEC-2026-037 — Merges to main deploy to production automatically

**Status:** APPROVED owner instruction. **Date:** 2026-10-16 (America/New_York).

**Decision:** The Vercel project (already connected to `Jcoley-Mercurius/mercurius-marketplace-next`, production branch `main`) deploys every commit on `main` to production automatically. Other branches do not deploy. Merging a reviewed PR with green CI is the release approval. A PR that carries a migration has it pushed to hosted before merge, with the owner's authorization; a missed migration is pushed as soon as it is noticed. Rollback is promoting the previous production deployment. A PR template records the migration and post-deploy steps.

**Context:** `vercel.json` had set `git.deploymentEnabled: false` since 2026-09-04 as a release gate, so merges never deployed, and production ran 2026-10-05 code until a manual deploy of `a245a99` (`dpl_AZEyDTVU95PoyFyzdKRbaTyRHYfS`) on 2026-10-16, eleven days and every merge since PR #88 behind.

**Alternatives considered:** Keep manual deploys (not chosen: production drifted behind). Build on merge but promote by hand (not chosen: the same gap reappears when a promote is forgotten). Preview deployments for every PR (not chosen yet: the Preview environment holds the production Supabase URL, service-role key and email key, so a preview would act on live data and send real email; revisit with a separate preview database).

**MPS impact:** None. **MDS impact:** None. **MTS impact:** `vercel.json` `git.deploymentEnabled` = `{ "main": true, "**": false }`; AGENTS.md release rule; `.github/pull_request_template.md`. **Data/payment/security impact:** Code reaches production on merge; migrations remain an explicit, owner-authorized step before merge and stay additive. This supersedes the manual-promote expectation in older rollout notes for routine releases; `HOSTED-MIGRATION-ROLLOUT.md` still governs coordinated launch releases.

**Required evidence:** The merge of this change deploys itself; its production deployment is recorded in the handoff.

### DEC-2026-036 — Recurring cadences offered on routine-maintenance services

**Status:** APPROVED owner instruction (choice of services delegated to the implementer). **Date:** 2026-10-16 (America/New_York).

**Decision:** Vendors should be able to price weekly, every two weeks, monthly and every two months where those make sense. The catalog adds, without removing anything: every two weeks to House Cleaning, Lawn Care, Pool Service and Dumpster Cleaning; every two months to House Cleaning, Dumpster Cleaning, Trash Can Cleaning, Pest Control, Floor Cleaning, Shrub & Hedge Trimming, Window Cleaning, Irrigation Maintenance, Mulching & Bed Care and Lawn Fertilization; monthly to Window Cleaning, Irrigation Maintenance and Mulching & Bed Care. Weekly stays on House Cleaning, Lawn Care and Pool Service. Project work, repairs and seasonal or annual services (roofing, painting, HVAC, tree trimming, gutters, pressure washing and similar) are unchanged. Defaults, prices, pricing modes and existing vendor packages are unchanged; operators adjust any service later in the Service Catalog.

**Context:** Vendors and operators can price only the cadences a service offers (DEC-2026-035). In production, weekly was on 3 of 45 services, every two weeks on 1, and every two months on none.

**Alternatives considered:** All four cadences on every service (not chosen: weekly roofing or every-two-months HVAC is not a real offering); leaving it to manual catalog edits (not chosen at the owner's request).

**MPS impact:** None to fees, payout or per-visit charging. **MDS impact:** More cadence choices in the vendor and operator price editors for the listed services; catalog editor fields are now labelled. **MTS impact:** Migration `20261016003000` (catalog rows only, additive, idempotent); `seed.sql` matches. **Data/payment/security impact:** Updates `services_catalog.available_frequencies` on 12 rows in hosted when pushed; no customer, vendor or price data.

**Required evidence:** SQL 081; browser `catalog-cadences`; hosted migration push by the owner.

### DEC-2026-035 — Operators draft a price for a specific vendor; "every two months" cadence

**Status:** APPROVED owner instruction. **Date:** 2026-10-16 (America/New_York).

**Decision:** An operator can add a price for a specific vendor from `/admin/vendor-prices` ("Add a price", choosing the vendor) or the admin vendor page. It is saved first as a private draft: a vendor, a catalog service, a package name and description, and one price per visit for each cadence the vendor offers, limited to the cadences the catalog offers for that service. Drafts are visible only to operators and can be edited (refused on a stale read) or discarded. Only an operator publishes a draft, with a reason the vendor reads. Publishing creates the vendor's ordinary custom fixed package (active, one price level per cadence named by the cadence), records the new prices in the DEC-2026-034 price history with the reason, and notifies the linked vendor; the vendor manages it from then on. Publishing is not an approval: a price outside the soft-launch guardrail band waits in Package Reviews. Publishing is refused while the vendor already has an active package for the same service with a price at one of the same cadences; the operator corrects that package instead. "Every two months" (`every-two-months`) is added as a cadence alongside the existing ones, priced and charged per visit like every other cadence. `bi-monthly` keeps its meaning, every two weeks; the `/services` and `/pricing` labels that read it as two months or "bi-monthly" now say every two weeks. Operators choose the cadences a service offers in the Service Catalog editor.

**Context:** Operators could correct an existing package's prices (DEC-2026-034) but not add a price for a vendor. Every cadence code except "every two months" existed; `bi-monthly` was labeled "Every two weeks" on the vendor editor, plan builder, provider pages and admin reviews, but "every 2 months" on `/services`. No production vendor package, tier or request used `bi-monthly` (read-only aggregate count, 2026-10-16), and only one catalog service listed it. The catalog editor could not change a service's cadence list.

**Alternatives considered:** Redefine `bi-monthly` as every two months (not chosen: changes the meaning of an existing code that most screens and the guardrail treat as every two weeks). The vendor publishes Mercurius's draft, or either party does (not chosen: the operator publishes; the vendor is notified, as in DEC-2026-034). Drafts as inactive vendor packages (not chosen: vendors and the vendor editor would see and could publish them).

**MPS impact:** Implements more of the §4 admin "configure provider offerings: supervised" row; no change to fees, payout, per-visit charging or price display rules. **MDS impact:** "Add a price" and Draft prices on Vendor Prices and the vendor page; Publish price dialog; "Cadences offered" in the catalog editor; "Every two months" label and "/2 mo" suffix wherever cadences show. **MTS impact:** Migration `20261016002000` (cadence constraints widened; guardrail, request preview and submission accept `every-two-months`; `private.operator_package_drafts`; `admin_save_package_draft`, `admin_package_drafts`, `admin_discard_package_draft`, `admin_publish_package_draft`). **Data/payment/security impact:** Operator-only commands (`vendor_require_operator`); drafts private; stale reads refused; publish serialized per vendor; existing packages, requests, quotes and checkout snapshots unchanged. The legacy visit generator still schedules only weekly and monthly (unchanged; already true for every two weeks and quarterly).

**Required evidence:** SQL 080; unit `package-drafts`; browser `vendor-prices`; hosted migration push by the owner.

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
