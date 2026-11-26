# Mercurius Owner Approvals

**Owner:** Repository owner, as stated in the audit conversation
**Recorded:** 2026-08-29

| System | Disposition | Approved artifacts | Qualification |
|---|---|---|---|
| Mercurius Technology System (MTS) | **APPROVED** | `mts/MTS-AUDIT.md`, `mts/TECHNOLOGY-BLUEPRINT.md`, and the current technology roadmap direction | Approval establishes the audit and blueprint as governing inputs. It does not waive their release gates or turn unverified production behavior into evidence. |
| Mercurius Product System (MPS) | **APPROVED** | `mps/MPS-AUDIT.md` and `mps/PROPOSED-MPS.md` | The proposed MPS becomes the approved product baseline. Values that the document explicitly leaves for later configuration—such as metric thresholds, exact ZIPs, and operational SLAs—remain open implementation decisions. |
| Mercurius Design System (MDS) | **APPROVED** | `mds/MDS-AUDIT.md` and `mds/DESIGN-SYSTEM-BLUEPRINT.md` | The blueprint and its recommended defaults become the design authority. Runtime rendering remains a required implementation verification gate because it was unavailable during the audit. |

The owner has stated that no additional product-authority approval chain is required. Legal, financial, privacy, security, and platform-provider constraints may still require specialist validation where the approved systems identify it.

The approved authority chain is now **MPS → MDS → MTS → implementation evidence**. No additional system-level approval is outstanding.

## Homeowner early-access experience — 2026-09-28

Josh approved the [homeowner early-access experience v0.1](HOMEOWNER-EARLY-ACCESS-EXPERIENCE.md) on 2026-09-28 ET: public form composition, optional account step, signed-in waiting home, and route/state sweep. The [reconciliation](HOMEOWNER-EARLY-ACCESS-RECONCILIATION.md) records MDS/roadmap precedence and remaining R0 gates. Design approval does not activate live collection, booking, hosted email, deployment or domain changes.

## Phase 4 acceptance and Phase 6 start — 2026-09-26

The owner accepted Phase 4 and released the Phase 6 review-before-start hold (DEC-2026-019),
after the TRACE-097 repair of the Codex review findings and a Codex re-review the owner reported
as clear. This accepts the implementation checkpoint only; PR #54/#55 merge and CI, hosted
checks, Phase 7 communications and scheduler activation remain open, and no external activation
is authorized.

## Phase 5 closure — 2026-09-26

The owner closed Phase 5 and authorized Phase 6 implementation (DEC-2026-017) after the Codex
closure review and its fixes (PR #52). Phase 4 is **not** accepted and stays open. This closes the
synthetic implementation checkpoint only; the activation gates carried to Phases 6–10 in
PHASE-5-CLOSURE-READINESS.md remain open, and no external activation is authorized.

## Phase 3 acceptance — 2026-09-03

The owner accepted Phase 3 as closed and authorized Phase 4 implementation and
a draft PR (DEC-2026-005). This accepts the implementation checkpoint; human
screen-reader/zoom, brand review and cross-platform visual follow-ups remain
separate. No unperformed manual checks are claimed to have passed.

## Provider profile reference approvals — 2026-11-05 (recorded 2026-11-17)

These are existing owner decisions, transcribed from the approval pages of the three design references on 2026-11-17. They do not constitute acceptance of the rendered gallery or a new production-interaction approval.

| Reference and source page | Owner instruction | Approved scope |
|---|---|---|
| `Mercurius-Provider-Card-Redesign.pdf`, page 6 of 6 | “I want to lock that in on the design.” | Consumer card visual direction: identity-led cover, consistent service/business/location/offer/profile-link composition, typography and spacing. Public imagery, prices, coverage and claims must remain supported. |
| `Mercurius-Profile-Interior-Redesign.pdf`, page 7 of 7 | “I love it. That's approved as well.” | Interior visual direction: identity, gallery, service/package selection, coordinated price summary, hierarchy and the referenced mobile composition. Remaining sections and dynamic behavior were sent to a separate exploration. |
| `Mercurius-Complete-Profile-and-Dynamic-Concept.pdf`, page 7 of 7 | “Let's lock that in to explore the concept of dynamic profile.” | Further exploration of optional service focus over published work, offers and prices, with All services available. Specific interaction/content decisions and production integration are not approved by this record. |

The owner separately assigned the bounded local review gallery on 2026-11-16. PR #171's final revision was merged as `a44a062` on 2026-11-17 and retrospectively code-reviewed by Codex at `b4eb800`. Merge and engineering review do not establish owner visual acceptance. See [the review record](DYNAMIC-PROFILES-REVIEW.md), [the task checkpoint](../docs/agent/DYNAMIC-PROFILES-HANDOFF.md) and TRACE-156.

The dropdown/chips breakpoint, history replacement, retained ZIP and business-wide review sentence are implemented prototype directions, still requiring Josh's desktop/phone review before becoming production interaction authority. Sentence case already follows MDS §9. The proposed first integration retains reset-on-service-change and the first eligible published offer as its temporary no-context card lead; those recommendations are not new owner approvals.

## Initial profile gallery layout and design — 2026-11-17

Josh approved the initial layout/design shown at the local profile gallery and requested implementation of the design cards and profiles with reasonable refinements:

> I approve the initial layout and design ( We want implementation to make our design cards etc). So Please review and make any updates you see fit. Also can we go ahead and make the profile changes before finishing phase 7 or do them along side each other?

This establishes the initial gallery composition as the implementation baseline and authorizes profile presentation work alongside Phase 7 in separate worktrees/PRs. It is a bounded sequencing direction, not Phase 7 acceptance. Codex has scoped P2A (real directory cards) first and P2B (dynamic profile route) next in [the integration handoff](DYNAMIC-PROFILES-INTEGRATION.md).

Keep the directed prototype defaults and the bounded implementation choices described in that handoff. This record does not assert unperformed manual, screen-reader, real-phone or exact-build visual checks, expand pricing/access policy, or authorize a merge/deployment or hosted change. The owner's local serving commit was not independently verified. Acceptance of the integrated candidate still requires real-data-contract and rendering evidence.

## Dynamic profile P2B visual acceptance and P2C photos — 2026-11-18

Josh replied "approved" to the P2B comparison images and the P2C contact sheet, then confirmed the scope as "P2B and all P2C photos".

| Item | Approved scope | Not covered |
|---|---|---|
| P2B provider profile (PR #175, merged as `55e9667`) | Visual acceptance of the live-route composition shown in the desktop and phone comparison images, which use synthetic providers | Real phones, screen readers, forced colours, 200% browser zoom and inspection of the production site |
| P2C illustrative service photos (PR #176) | All 11 photos in [the manifest](../docs/imagery/service-imagery-manifest.json), for the labelled panel below a provider's own media, including the Interior Painting photo showing a worker from behind | Merge or release of PR #176, Codex review, any other placement, and any photo for pressure washing, window cleaning or tree trimming |

The photos remain illustrative. This approval does not allow them to be presented as a provider's team, completed work, customer results or before-and-after evidence.

## Gallery management implementation — 2026-11-19

Josh authorized Codex to handle the three proposed increments: recovery of #178 onto main,
bulk service editing with clear caption/save controls, and ordering plus explicit before/after
pairing: “Can you do that now for me handle 1-3?”

Scope and acceptance evidence: [TRACE-156 gallery management](../docs/agent/GALLERY-MANAGEMENT.md).
This is implementation authorization; it does not claim visual acceptance, a hosted migration
push, merge/deployment, provider-photo tagging or Phase 7 acceptance.

## Profile photo framing correction — 2026-11-24

Josh asked Codex to inspect and fix public profile pictures that did not fit their frames:
“Can you fix that, or do we need Claude to fix that?” This authorizes the bounded implementation
in [TRACE-156 photo framing](../docs/agent/PROFILE-IMAGE-FRAMING.md). It does not establish
owner visual acceptance of the resulting crop/viewer or authorize merge/deployment.

## Phase 7.5F SLA-breach observation — 2026-11-25

Josh approved the Phase 7.5F decisions and the 7.5F-1 database implementation (2026-11-25, America/New_York), recorded as [DEC-2026-069](DECISION-LOG.md). The instruction's approval text, verbatim:

> I approve:
> - OD-1: record the five proposed rules and their specified qualifying kinds: T-3, T-4 failure aging, T-5, T-8 and T-10.
> - OD-2: manual operator scans only; no scheduler.
> - P-1: include dispute and dispute-appeal tickets once under T-8.
> - P-2: classify observations, runs and purge logs as operational records, with 90-day logical retention and the reviewed manual purge mechanism. This does not approve a scheduler or assert automatic physical deletion at 90 days.
> - P-3: any authenticated admin may scan.
> - P-4: defer derived first-response lateness reporting.
> - P-5: no historical backfill.
> - P-6: no scan cadence established by this implementation.
> - P-7: any authenticated admin may use the manual purge control after separately authorized production activation.
>
> This approves implementation and local verification, including the planned concurrency CI step. It does not authorize hosted queries, migration pushes, release, production scans or purges.

The same instruction scoped the work to 7.5F-1 (database foundation) and excluded 7.5F-2, any hosted action, merge, deployment, production scan or purge, scheduler, notification, email activation, booking or payment change. Plan: [7.5F](PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md); record: [7.5F-1](PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md).
