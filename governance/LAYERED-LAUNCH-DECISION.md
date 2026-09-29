# Layered launch decision — 2026-09-28

**Status:** Founder approved for planning and implementation. External activation remains gated.
**Source:** Founder-approved “Mercurius Marketplace — layered launch approved decisions and VS Code handoff v1.0,” supplied 2026-09-28 (America/New_York).
**Authority:** This decision stages the approved MPS, MDS and MTS; it does not replace their product, design or technology rules.

## Release boundaries

| Release | Permitted public behavior | Activation evidence |
|---|---|---|
| R0 — rebuilt-app public recruiting | Publicly expose the rebuilt Marketplace app. Visitors explore real services and approved, eligible providers. Homeowners join early access and may create verified accounts. Vendors submit real applications; reviewed, approved vendors may be invited to prepare truthful profiles, coverage, availability and offers. Non-invited homeowners cannot request service or check out. | Hosted app/database/auth, application and private documents, admin review, Resend notification, separate Auth invitation, vendor portal, homeowner interest/account, backend booking refusal, accessibility, support, monitoring and rollback checks; owner R0 go/no-go. |
| R1 — invited transactional beta | Owner admits selected homeowners in covered service/ZIP cells for real service and payment flows under approved controls. | Phase 9 end-to-end booking, dispatch, completion, support/refund and payout; approved both-role Credits C0–C4 earning/correction/finance; owner R1 activation. |
| R2 — wider homeowner opening | Expand booking and marketing by service and Lee County coverage based on real outcomes. | Match, response, paid-completion, support and incident evidence; owner expansion decision. |

R0 is live recruiting, not transactional acceptance. The 90-day beta Day 1 and Founding Vendor qualifying window begin at the actual R1 opening. Day 30/60/90 plans must be rebased from that event; no calendar date or elapsed time unlocks R1 or R2. Phase 6–10 development continues while R0 recruits, and later deployments must preserve recruiting records and controls. Merging code does not authorize a production migration, email, deployment, domain move, transaction or payout.

## R0 homeowner contract

- Early-access interest collects email, Lee County ZIP and service interests or “still exploring”; first name is optional. It does not collect phone, street address, photos, payment data or SMS consent. An out-of-area ZIP gets the honest Lee County boundary and a separate expansion-interest option with no trial eligibility claim.
- Joining requests early-access status and possible-invitation email. An independent, unchecked choice covers Mercurius news, offers and product updates. Every early-access email includes withdrawal; promotional mail has its own unsubscribe and suppression. Joining, account creation and marketing opt-in award no Credits.
- A confirmed save offers optional account creation with existing email verification. List-only participation remains valid. A verified account is a candidate, not a promise of invitation, queue position, booking or Credits. Link verified accounts to interests securely and without duplicate identities.
- The waiting home shows status, ZIP/interests, edit, exploration and account controls without unusable request/payment/empty-job promises. Existing legitimate account history and support remain accessible.
- Josh initially grants/revokes audited trial access by service and area; a separately authorized admin may later do so. Revocation blocks new requests, not legitimate existing transactions. Manual admission begins with interested account holders matching approved supply/capacity; list-only people may be invited as capacity permits.
- Remove or de-identify list-only interest 90 days after the recorded R2 broad-booking opening, or sooner on verified withdrawal/deletion, subject to legitimate holds. Marketing preference persists separately while opted in. Account holders can edit interests and use privacy requests. The R2 event and retention job must be observable.

## R0 vendor and operator contract

- Preserve the existing application, private-document and admin-review system. Application saved, reviewed, approved, account invited/activated, profile ready and public listing are distinct states. Only approved, eligible providers with real content appear publicly; booking says “Opening by invitation.” Mock prices must never appear as live offers.
- Verify hosted application, private attachment, Josh's admin readback and owner notification from a verified Resend sender. A failed email cannot hide a saved application; operators need missed-email detection and recovery. Auth invitation has a separate delivery, identity-binding and login test.
- Approved vendors may prepare profile, service area, availability and actual offers. Their portal shows an honest no-jobs-yet state while homeowner transactions are closed.
- Name a least-privilege backup admin for applications, missed email, privacy requests and urgent support before R0. Confirm participant-facing support and privacy contacts.
- Founding Vendor recognition follows its separate approved policy: beta participation only, with no endorsement, ranking priority, lower fee or extra Credits. Its 90-day clock begins at R1; show no badge before terms, implementation and hosted acceptance.

## R1 and other boundaries

Both-role Credits C0–C4 belong to R1, not R0. No signup, referral or review Credits. Homeowner vested Credits first apply to an eligible second booking or later only after offer admission and mixed-funding acceptance. Vendor Credits are future noncash Commercial purchasing value, not cash-out or fee offset. Quote Tool, Route Tool, My Home and Commercial pilot retain separate R1-relative roadmap gates; recruiting copy must not present them as live.

CFG-001–013, the approved Lee County allowlist, provider eligibility and compliance, 15% fee, customer-payment model, weekly direct ACH, privacy, terms and existing account history remain in force. The companion 90-day roadmap, early-access experience, Founding Vendor and Credits authority files named in the founder handoff were not present in this checkout on 2026-09-28; reconcile their exact copy, state designs and C0–C4 mechanics before those respective slices are accepted. This is a source-artifact gate, not permission to invent missing terms.

## Observed state and external-action gates

Read-only recheck on 2026-09-28: remote `main` `37d212e`; open Phase 6 PR #64 carries the TRACE-098 repair and TRACE-099 vendor write-scope repair; Vercel project's latest recorded production deployment is `735df91` from 2026-09-04; hosted Mercurius Supabase migration history ends `20260731172714` (83 entries), while rebuilt migrations are pending. `vercel.json` disables Git deployment. The older [hosted rollout plan](HOSTED-MIGRATION-ROLLOUT.md) has stale migration counts and a deploy/migrate ordering conflict; it must be recalculated and rehearsed against the fixed R0 commit. Domain routing, current sender delivery and backup admin were not freshly verified.

Do not mutate hosted schema/data, send real invitations, deploy/promote, move the domain, or activate booking, money or schedulers without the specific external-action authorization and release evidence in AGENTS.md and the roadmap.
