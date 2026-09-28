# Phase 6.1 decision review — 2026-09-27

Reviewed checkpoint: `0e4793b` on `codex/phase6-cleanup`, after PR #56 merged
at `b85c887`. Scope: TRACE-095 decisions D1–D7 and DEC-2026-021's two ZIP
boundary calls. This is a focused decision review, not full slice or phase acceptance.
Disposition: **changes required for D3**; remaining decisions have the qualifications below.

Authorities: MPS §§4/6.1/6.2/6.5; CFG-001–003/009; DEC-2026-015/020/021;
MDS §§5/8/9; MTS §§4/6/13. Read CLAUDE.md and installed Next.js
`01-app/01-getting-started/05-server-and-client-components.md` before reviewing the intake.

## D1–D7

| Decision | Disposition and implementation consequence |
|---|---|
| D1 — all-or-nothing plans; uncataloged services become explicit interest | Conforms to DEC-2026-020. SQL 063 proves rollback of the whole plan. In 6.2, show unavailable and Something Else outcomes before final submission, keep catalog services visible, and retain final authoritative validation. Interest requires a separate explicit action. |
| D2 — refuse an ineligible selected provider; clearing selection gives fallback consent | Conforms to MPS §6.2 and CFG-009. RPC filters selected-provider candidates; the intake's explicit fallback action clears the selection. Preserve consent and explain whether the provider or the chosen package is unavailable. Clearing consent must also clear incompatible package/tier and price state. No automatic fallback on lookup error. |
| D3 — every authenticated account may submit | **Changes required: P6-R1 below.** Default signup grants homeowner, so ordinary vendor/admin accounts may also act as homeowners. That does not justify omitting the role check for an identity without that grant. Keep dual-role accounts working; do not create an exclusive homeowner account model. |
| D4 — fixed requests wait for operator offers; quote requests start matching from intake | Preserve the existing operationally assisted dispatch boundary for this slice; MPS permits manual operations. This is not approval of a new automatic fixed dispatch rule or a passing 6.3 journey. 6.2 must say a fixed request is received/awaiting provider confirmation, never infer matching is running. Quote matching failures and exhausted outcomes need accurate readback; 6.3 owns offer/fallback/exclusivity repair. |
| D5 — unbound quote supply stores custom_quote without a package | Acceptable for an unselected offering: an eligible quote candidate does not constitute customer acceptance of that provider's deposit terms. SQL 063 proves custom_quote with no amount/package, and explicit deposit_quote retains its mode. Preserve the chosen offering when explicit; 6.2 must distinguish fixed price from quote required and must not imply a deposit is paid or a final amount approved. Later quote/commercial review remains authoritative. |
| D6 — contact for verification error is an explicit action | Conforms to MPS honesty and recovery requirements. Coverage failure remains an error with retry and optional contact, not uncovered, interest submitted or a quote. Preserve the existing contact route's abuse controls. |
| D7 — regenerated types include TRACE-097 completion evidence | Acceptable schema alignment. Generated job_completion_evidence describes the already migrated table; it is not a new completion workflow or permission change. Keep generation tied to the canonical local schema. |

## P6-R1 / P2 — Authenticated identity substitutes for homeowner authorization

`submit_service_requests` in migration `20260927000000_phase6_request_submission.sql`
checks `auth.uid()` and grants EXECUTE to `authenticated`, but never checks the
homeowner role. MPS §4 gives own-request creation to homeowners and requires role
checks at the server/database boundary; MTS §6 requires role-negative evidence.
The signup trigger's default grant is provisioning evidence, not an enforced invariant
that every authenticated identity always holds that role.

Confirmed locally: a synthetic vendor identity with its homeowner grant removed
successfully submits an eligible fixed request owned by itself. This does not allow
cross-account ownership or bypass the commercial checkout kernel, but it bypasses
the approved capability boundary. Existing SQL 063 vendor/admin fixtures retain
their default homeowner grant and cannot detect this case.

Reproduction: [trace-095-role-scope.sql](review-evidence/trace-095-role-scope.sql),
four characterization assertions, all rolled back. Passing these assertions proves
the defect; it does not prove correct authorization.

Required next bounded repair under TRACE-095: an additive forward migration enforces
the existing homeowner capability before submission or replay. Prove homeowner and
homeowner+vendor/admin success; anonymous, no-user, authenticated no-role, vendor-only
and admin-only denial; ownership isolation; and denial of replay after role removal.
Preserve the separately authorized operator workflow and trusted writers. Do not
change signup roles, data, dispatch or commercial semantics. Codex re-reviews the fix
before Claude begins 6.2 implementation. No application repair was performed in this review.

## ZIP boundary calls

The owner's current direction confirms DEC-2026-021, with no new geographic choice:

- **Covered in full:** 33917, 33921, 33936 and 34134. The backend checks the ZIP,
  without trimming addresses to a county polygon or adding a city-based restriction.
- **Excluded:** 33955, 34110 and 34119, including their Lee County portions.

The migration activates the approved 47 ZIPs. SQL 064 checks exact clean-database
coverage and all four included / three excluded boundaries. Coverage alone does not
make a service bookable; eligible service/provider supply is still required.

Important rollout limit: the migration deliberately preserves pre-existing other
coverage rows. It does not deactivate an excluded ZIP already active in a hosted
environment. Phase 8 must reconcile hosted coverage against the approved list and
prove these exclusions there before activation. No hosted data was inspected or changed.

## Evidence and limits

New checks on 2026-09-27 against local synthetic container
`supabase_db_vugqqyemuptlvcieihww`, verified migration head `20260927010000`:

```sh
docker exec -i supabase_db_vugqqyemuptlvcieihww psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/063_phase6_request_submission.sql
docker exec -i supabase_db_vugqqyemuptlvcieihww psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/064_cfg001_lee_county_coverage.sql
docker exec -i supabase_db_vugqqyemuptlvcieihww psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < governance/review-evidence/trace-095-role-scope.sql
```

Results: 65/65 submission assertions; 16/16 ZIP assertions; 4/4 defect
characterization assertions. No `not ok`; each script ends in ROLLBACK.
Earlier full reset, concurrency, unit, build and browser evidence remains historical
in [the slice report](PHASE-6-REQUEST-SUBMISSION.md); it was not rerun for this
documentation review. CI wiring, checkout integration, human accessibility and
hosted migration remain open. No merge, deployment or activation is implied.
