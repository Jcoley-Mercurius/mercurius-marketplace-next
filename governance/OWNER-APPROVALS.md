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
