# R0 onboarding standard v1 (TRACE-105)

**Status:** working standard for the operator, 2026-10-01. The rules marked **Approved** come from existing authorities. The rules marked **Owner decision** are not yet defined anywhere; until Josh decides them, the operator records what was actually checked and does not invent a threshold.
**Use:** type `R0 onboarding v1` in the checklist's *Requirement version* field for every item except the agreement item, which uses the agreement's own version. When any rule below changes, publish `v2` and re-review vendors recorded under `v1`.
**Sources:** MPS §8 (activation checklist); CFG-001, CFG-003, CFG-007, CFG-008, CFG-009, CFG-010; DEC-2026-015 (licensing, insurance and ACH rules); DEC-2026-024 (setup access is not approval).

## General rules for every item (Approved)

- Record only evidence you actually reviewed. *Reviewed at* is when you reviewed it, never in the future.
- The *Evidence reference* says where the proof is kept (email thread, Drive file, uploaded document). It never contains bank details, ID numbers or passwords.
- Uploading a file or accepting an invitation is not activation. Account access is not approval or listing.
- Public wording ("licensed", "insured", "vetted") is used only when current evidence meets an approved definition (MPS §6.7).
- Activation needs all nine items current and an operator decision with a reason.

## Checklist

| # | Item | Rule | Collect | Record |
|---|---|---|---|---|
| 1 | Identity and business contact verified | **Approved:** verified identity and business contact (MPS §8). **Owner decision O1:** what counts as verification | Owner name, business legal name, business email and phone confirmed by a call to the listed number and a reply from the business email; Florida business registration (sunbiz.org) where the business is registered | Version `R0 onboarding v1`; reference e.g. "Call 2026-10-01 + Gmail thread '<business> onboarding'; Sunbiz <document number>" |
| 2 | Terms and marketplace agreement accepted | **Approved:** accepted with version and time (MPS §8). **Owner decision O2:** no separate vendor/marketplace agreement exists; `/terms` (last updated August 5, 2026) is the general Terms of Service | Until O2: the vendor's written acceptance (reply email) of the Terms of Service and of the R0 participation terms (no subscription during soft launch, 15% platform fee on the final service subtotal excluding tax and tips) | Version `Terms of Service — August 5, 2026`; reference to the acceptance email; reviewed at = when you read the acceptance |
| 3 | Service categories and coverage approved | **Approved:** Lee County ZIPs only (CFG-001, 47 ZIPs); every catalog service stays visible; supply is per service and ZIP | The services the vendor will actually perform and the Lee County ZIPs/areas they serve | Version `R0 onboarding v1`; reference to your note of the approved services and ZIPs |
| 4 | Licensing reviewed | **Approved:** every vendor needs reviewed, current licensing evidence; no arbitrary exemption (DEC-2026-015). **Owner decision O3:** which license each category needs | Until O3: the license the trade legally requires (for example a Florida DBPR or Lee County contractor license for electrical, plumbing, HVAC, roofing, pool or general construction), and for trades without a state license, the local business tax receipt | Select the uploaded document; version `R0 onboarding v1`; **Expires** = the document's expiry date |
| 5 | Insurance reviewed | **Approved:** every vendor needs reviewed, current insurance evidence; no insurance limit is inferred (DEC-2026-015). **Owner decision O4:** required coverage types and minimum limits | Until O4: a certificate of insurance naming the business, showing general liability and the policy dates; note any workers' compensation coverage or exemption | Select the uploaded document; version `R0 onboarding v1`; **Expires** = the policy end date |
| 6 | Payout onboarding complete | **Approved:** weekly direct ACH from Mercurius; the owner collects the ACH authorization form during onboarding; store only a private reference, never bank credentials or full account details (CFG-008, DEC-2026-015). **Owner decision O5:** the form and where it is stored privately | The signed ACH authorization form, through a private channel (not plain email or text), kept outside Mercurius | Version `R0 onboarding v1`; reference = the private storage location only. Do not record this item until O5 is decided |
| 7 | Profile and pricing claims reviewed | **Approved:** show only claims supported by real data; no mock prices as live offers (MPS customer promise, layered-launch R0) | Check the business description, credentials claimed and any prices against the evidence above | Version `R0 onboarding v1`; reference to your review note |
| 8 | Availability and response expectations accepted | **Approved:** one provider holds an exclusive **four-hour** offer at a time (CFG-009); provider cancellation or no-show is a quality event, rematch first, otherwise the homeowner gets a full refund; documented emergencies may be excused (CFG-007) | The vendor's written acceptance of the four-hour offer window and the cancellation/no-show rule, plus their usual working days and hours | Version `R0 onboarding v1`; reference to the acceptance email |
| 9 | Test notification received | **Approved:** a test notification is received (MPS §8). Channel is the confirmed business email | Send a test email to the confirmed business email and get a reply confirming receipt | Version `R0 onboarding v1`; reference to the reply |

## Owner decisions needed

| ID | Decision | Why it matters |
|---|---|---|
| O1 | What verifies identity (call + business email + Sunbiz, or something stronger) | Defines item 1 for every vendor |
| O2 | A vendor/marketplace agreement, or confirmation that the Terms of Service plus the written R0 participation terms are enough for R0 | Item 2 currently relies on the general Terms; consider legal review |
| O3 | Required license per service category, and what counts for trades without a state license | Item 4; DEC-2026-015 forbids inferring exemptions |
| O4 | Required insurance types and minimum limits (and workers' compensation expectations) | Item 5; DEC-2026-015 forbids inferring limits |
| O5 | The ACH authorization form and its private storage location | Item 6; until decided, no new applicant can be activated |

Activation is not needed for R0 recruiting: booking stays closed and nothing is paid. New applicants reach the vendor portal only at activation, while existing providers get setup access first (DEC-2026-024); whether new applicants should also get setup access before approval is an open product question.
