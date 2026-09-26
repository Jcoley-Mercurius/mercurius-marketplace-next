# Phase 5 — Closure review fixes (TRACE-093, TRACE-094)

**Status:** IMPLEMENTED for Codex review, 2026-09-26, on branch `codex/phase5-review-fixes`
(from the closure-readiness head `b55fb1b`, which is `main` `6c41143` plus TRACE-092 and the
review record). Answers findings P1 and P2 of the [Phase 5 code review](PHASE-5-CODE-REVIEW.md).
This is not phase acceptance and authorizes no hosted migration, deployment or deletion.

## TRACE-093 — retention holds and permanent deletion (review P1)

**Problem.** Prepare checked for a hold and wrote nothing; the route then removed the file from
quarantine with the service key. A hold committed between the two did not stop the removal,
and record wrote the loss as `under_hold`. Affected all three retention routes (declined
renewal documents, application files, never-submitted renewal uploads).

**Protocol** (migration `20260926001000`):

1. Prepare of a deletion also records a durable **deletion request** (scope, subject, path,
   actor, reason, key). A request authorizes nothing by itself.
2. The route removes the file with the **operator's own session**. The Storage API deletes the
   `storage.objects` row and then the stored bytes inside one database transaction, as the
   caller's role, so row-level security applies (read from storage-api v1.70.3 `deleteObjects`).
3. The **quarantine delete policy** takes the locks hold placement takes (the provider's
   onboarding row; for an application, its providers' rows then the application row — record's
   order), re-runs the step's refusal and allows the delete only when no hold is in force. In
   the same transaction it writes a **storage deletion** row naming the request. A select
   policy exposes only an object the caller has an open request for, which `DELETE … RETURNING`
   needs.
4. Record accepts a deletion only when storage shows the file gone, as before. With a storage
   deletion row it records `under_hold = false`: no hold was in force when the deletion took
   effect. Without one (a file removed outside the workflow) it keeps TRACE-074's behavior.
   A file still stored while held is refused as held rather than "still holds this document".

**When each takes effect.** A hold, when its event commits. A deletion, when Storage's
transaction commits. Both need the same row lock, so whichever commits first wins:

| Ordering | Result |
|---|---|
| Hold commits before or while Storage's delete waits for the lock | The policy sees the hold; the delete matches no row; bytes stay; record refuses as held |
| Storage's delete is past the policy when the hold is requested | The hold waits for Storage's commit; the deletion stays recordable after the hold, `under_hold = false` |
| Crash after Storage, before record; then a hold; then retry (same or new key) | Prepare allows it (storage shows the step done); the retried remove is a no-op; record finds the storage deletion row, `under_hold = false` |
| Storage's delete fails after the row delete | The transaction rolls back row, bytes deletion and storage deletion row together; retry decides again |

**Design choices for review.**

- The two policy entry points are in `public` (execute: `authenticated` only), because a
  policy runs with the caller's privileges and `authenticated` has no `private` usage; granting
  it would have exposed two private functions still executable by `PUBLIC`. The delete function
  answers `false` unless Storage's own `storage.allow_delete_query` flag is set, so an RPC call
  records nothing (suite 060 and a mutation check).
- Operators can now read metadata of, and download, a quarantined object while their own
  deletion request is open. Operators already read the documents bucket.
- **Residual, not changed:** quarantine and restore still move files with the service key, so a
  quarantine can land after a hold. It is reversible, recorded `under_hold` and restorable.
  Moving under the operator's session would need insert/update policies on the documents
  bucket that TRACE-085 removed.
- **Residual, hosted:** the policy functions read `storage.objects` as their owner; locally that
  is a superuser. The hosted `postgres` role's RLS bypass and Storage's delete behavior on the
  hosted version belong to the Phase 8 hosted Storage checks. If the bypass is absent the
  deletion fails closed (nothing is deleted).
- The Storage race of a byte deletion that succeeded but whose commit failed leaves an
  orphaned row with no bytes; a retry removes the row if no hold is in force, otherwise the
  row stays and is visible in the queue's object location.

## TRACE-094 — atomic document finalization (review P2)

**Problem.** The finalize route read `document_urls`, merged in the route and wrote the whole
column back. Concurrent finalizations of different paths from one grant each answered success
while the last write dropped the others.

**Fix** (migration `20260926002000`): `vendor_application_attach_documents(application, paths)`,
executable only by `service_role`, locks the application row, refuses paths outside the
application's upload layout or with no stored object, appends each new path once in request
order and updates only when something was added (so a retry makes no version). The route keeps
its grant, application-id, prefix and stored size/type checks and calls the function instead of
reading and writing the row; its response shape is unchanged.

## Evidence (synthetic, isolated local stack)

| Check | Result |
|---|---|
| Suite 060 (retention coordination, real policies via `DELETE … RETURNING` as `authenticated` with Storage's flag) | 60 assertions pass |
| Suite 061 (attach function) | 16 assertions pass |
| Suites 001, 041, 052, 054 | Policy/table inventories updated for the two new policies and tables; intent unchanged (no client writes the documents bucket; one client read policy on it; quarantine names only the TRACE-093 policies) |
| Full database run on a clean reset | 3010 assertions across 52 suites pass on a clean reset, and again on the clean replay after the committed concurrency fixtures |
| `phase5-retention-hold-coordination.mjs` through the real Storage API (added to CI) | Hold-first in all four scopes (declined document, application hold, attached-provider hold, renewal upload); deletion-first with the hold observed waiting on Storage's lock; crash retry after a later hold; 3 × 8 simultaneous deletes/holds. Stable over 4 runs; both outcomes occurred |
| `phase5-document-attach-concurrency.mjs` (added to CI) | 12 concurrent single-path finalizations keep 12 paths once with one version each; 8 overlapping retries change nothing |
| `phase5-finalization-route-replay.mjs` (local; actual route, real client, barrier before the write) | `HEAD` route: 6 × HTTP 200, `attachedCount: 1`, **1** path stored (the review's lost update). Fixed route: 6 × 200, **6** paths stored |
| Route round trip on `next dev` with a signed-in operator (local, not committed) | Each of the three retention routes deletes through the operator session (storage deletion row written), replays, and a held upload is refused with the file kept |
| Mutation check, TRACE-093 | 5 of 5 detected: no hold check (060: 12 failures; script), no lock (script only, as expected), stable function (Storage 500), record ignoring the deletion row (060; script), no Storage-flag guard (060: 4) |
| Mutation check, TRACE-094 | 2 of 2 detected: no row lock (script: 5 of 12 kept), no de-duplication (061: 4; script) |
| All CI concurrency scripts, clean replay, lint, typecheck, unit tests, build, secret scan | All 24 CI concurrency scripts pass in CI order; clean replay passes; lint, typecheck, 204 unit tests, build, secret scan and `git diff --check` pass |

Not run: browser retention specs (no UI change; they stub the routes) and hosted checks.

## Open

- Codex review of both fixes and of the residuals above.
- CI on the pull request head and on `main` after merge, including suites 059–061 and both new
  scripts.
- Hosted migration and Storage checks remain Phase 8 gates with owner authorization.
