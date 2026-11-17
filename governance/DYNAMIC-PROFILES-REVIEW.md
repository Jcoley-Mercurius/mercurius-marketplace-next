# Dynamic profiles — retrospective engineering review

Date: 2026-11-17 ET. Traceability: TRACE-156.
Scope: the local review gallery introduced by PR #171; no live-route integration.

## Owner update — initial design approved 2026-11-17

After the retrospective review below, Josh approved the initial gallery layout/design and authorized reasonable refinement and profile implementation alongside Phase 7. See the [canonical approval record](OWNER-APPROVALS.md#initial-profile-gallery-layout-and-design--2026-11-17). This resolves the initial-layout approval hold; it does not claim manual QA or acceptance of a live-route candidate. Keep the directed prototype defaults and implementation choices under that delegation. [P2A is now scoped for implementation](DYNAMIC-PROFILES-INTEGRATION.md), with P2B next. The review below records the earlier engineering checkpoint; read its open-owner statements in light of this subsequent approval.

## Reviewed revision and result

- Initial reviewed head: `4622a8068f519ccf6a7f2bc4ec236cc8c65fdf0c`.
- Revised PR head: `b4eb80008d8eddff52f57b32d6ed972f515937a9`; code/tests: `99e77aa`.
- Merged as: `a44a0626b9627709411a0e5e2472f2d45b427cc3`, 2026-11-17.
- [Retrospective Codex review on #171](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/171#pullrequestreview-5941302731).
- Result: no new blocking code findings in the revised scope. Both earlier P2 findings are resolved. This is engineering review of the gallery, not owner visual acceptance or clearance for live integration.

The comparison from the revised head to merged main changes only the separately merged Phase 7 documentation and its existing TRACE-155 row; the profile sources are unchanged. The PR adds no live provider-route, schema, database policy, dependency, email, finance or release-setting change.

## Findings closed

| Finding | Resolution | Evidence |
|---|---|---|
| URL-selected inherited catalog member | `catalogServiceName` requires an own, non-empty string entry. Unknown/inherited IDs render the normal fallback. | Model regression tests and browser cases for `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`; independent focused checks. |
| Optional-extra minimum quantity ignored | Shared normalization governs controls, stored selections and local previews. A selection is zero or within its minimum/maximum. First increment starts at the minimum; stepping below removes it. | Minimum-two fixture; model and browser regression coverage; independent stepping, normalization, reconciliation and preview checks. |

Prototype directions are implemented: dropdown below 1024px, chips at and above 1024px, one selection across resizing; service changes replace history while retaining unrelated query spelling/order and hash; ZIP input and checked result persist across service views; business-wide reviews retain one pool and the explanatory sentence. Source and regression tests were inspected. Catalog-disabled request/browser tests cover the gallery index, scenario routes and parent catalog.

## Verification and its limits

- Exact-head [CI run 44007255413](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/44007255413): backend, lifecycle and application SUCCESS.
- Application log: 68 unit files, 1,021 tests passed; 793 non-visual browser tests passed, including the new gallery and gate-off regressions.
- Independently ran 78 focused assertions against the fetched revision's actual model and fictional fixtures using Node v24.22.1 with built-in TypeScript transformation: PASS. Coverage: all five scenarios, inherited-name lookup, optional-extra bounds/stepping/reconciliation/preview, service URL/query/hash preservation.
- No independent full dependency install, application rebuild, full browser rerun, rendered screenshot/reference comparison, real-phone or screen-reader pass was performed here. The repository's installed Next.js documentation was unavailable in this fetched source snapshot; history behavior was checked through the source and exact-head browser evidence, not an independently installed framework.
- Owner desktop/phone visual acceptance and canonical visual baselines remain open. A passing automated accessibility scan does not substitute for manual acceptance.
- No hosted, deployment or production-configuration readback was performed. The #171 merge is observed; deployment completion is not newly verified by this review.

## Disposition of outstanding questions

| Question | Disposition and authority |
|---|---|
| Remember package/cadence/extras per service? | Retain reset on service change for the gallery and recommend it for the first integration. Keep the ZIP. Visit-scoped per-service memory is a later behavior change; no persistence added. Owner production-interaction acceptance remains open. |
| No-context directory lead offer? | Retain the first eligible published offer in existing sort order as a temporary fallback; label its service, scope and billing basis. A provider-selected lead service needs a separately specified editing/publishing contract. Integration must make tie ordering deterministic. Owner production-interaction acceptance remains open. |
| Button capitalization? | Sentence case, already governed by approved MDS §9. Existing live title case does not supersede it. CTA action/wording must also match actual access behavior at integration. |
| Restored quantity below minimum? | Keep removing that extra, rather than increasing quantity or price. This resolves the gallery's technical handling. If restoration is introduced, explain that an invalid choice was removed and require renewed selection; do not silently increase quantities. Above-maximum values may be reduced to the maximum and must be disclosed in a restoration flow. |

The first two are Codex recommendations, not newly recorded owner decisions. The November 5 reference approvals are transcribed separately in [OWNER-APPROVALS](OWNER-APPROVALS.md#provider-profile-reference-approvals--2026-11-05-recorded-2026-11-17).

The presentation-model boundary is acceptable for this exploration, subject to the price boundary below. Proposed service-media/question types remain experimental inputs, not a declaration that production fields exist. The separate Playwright configuration and its owned, gate-off subprocess are acceptable for the bounded local lane.

## Before live integration

1. Initial gallery layout/design acceptance was received from Josh on 2026-11-17. Capture and review the integrated candidate's desktop/mobile rendering; manual screen-reader and real-phone evidence are still not claimed.
2. Follow the bounded defaults in the integration handoff under Josh's delegated refinement instruction. Do not make Josh reapprove the initial layout or sentence case already set by MDS.
3. Reconcile traceability/approval documentation through its documentation-only PR. These records preserve historic approval scope; they do not grant visual acceptance.
4. Define and review the bounded integration slice: current public readers, true access states and next actions, authoritative server price preview or no calculated subtotal, content/media/FAQ fallbacks, directory search/filter/list-position return, representative eligible-provider audit, and release/rollback evidence.
5. Missing service-media and FAQ sources may be handled with explicitly approved general-media/omitted-section fallbacks; do not invent a database association or publish fixture content. The actual editing/publication path is required before adding service-linked content.
6. Keep Phase 7 work separate. This review accepts no Phase 7 gate and activates no booking, payment, email, scheduler or external service.
