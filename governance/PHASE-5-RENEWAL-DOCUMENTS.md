# Phase 5 — Renewal documents bound to the provider (TRACE-073)

**Status:** IMPLEMENTED on branch `codex/phase5-renewal-documents`, based on `main`
`0d761f3` (PR #27 merged). Awaiting Codex code review. Merging is not phase acceptance or
production activation.

**Authorization (2026-09-15):** the owner directed this slice, the one TRACE-072 named as
next, and answered its four open semantics before implementation (below).

## Gap

TRACE-072 shows operators and providers which evidence is expiring or lapsed, but a
renewed certificate had no way in. Documents reached Mercurius only through the public
application upload. Changing an application creates a new application version, and
`vendor_begin_review` then returns an active provider to `review`, so recording a renewed
document meant re-vetting the provider. The vendor portal had no upload, and the notice
told providers to contact Mercurius.

## Owner decisions (2026-09-15)

1. **Provider and operator may submit.** A provider uploads in the vendor portal; an
   operator uploads a file the provider sent Mercurius directly, on the provider's behalf.
2. **A decline carries a note the provider sees.** The note is required; the provider
   sees Submitted / Accepted / Declined and any decline note.
3. **A provider submission sends the owner notification** already used for new vendor
   applications. Operator uploads and replays do not.
4. **The legacy anonymous upload policy is removed in this slice** (see below).

## Characterized before change

- `vendor-documents` is a private bucket (10 MB, PDF/JPEG/PNG/WebP/HEIC/HEIF). The
  application form issues signed upload URLs from the server at `<application id>/<kind>/...`
  and finalizes them by path into `vendor_applications.document_urls`.
- **Anonymous upload was still open.** The 2026-07-31 policy
  `Applicants can upload application documents` granted `INSERT` on the bucket's
  `applications/` folder to `anon` and `authenticated`. No later migration dropped it and
  the current form does not use that folder, so anyone could store files in the private
  bucket. Confirmed live on the isolated stack before the change.
- Operators read the bucket through the bucket-wide admin `SELECT` policy and short-lived
  signed links. Admin `UPDATE`/`DELETE` policies also exist (unchanged, see open items).
- License and insurance evidence must reference a document in the reviewed application
  (TRACE-069 checklist command and TRACE-062 requirement document command). Evidence is
  always recorded on the provider's reviewed application version.
- Binding existing evidence to a service/ZIP requirement (`vendor_bind_requirement_evidence`,
  the workbench's "Reuse current evidence") has no application-document rule; it requires
  the same kind and requirement version, current evidence on the reviewed version and a
  covered package.

## Contract

Migration `20260915001000_vendor_renewal_documents.sql`:

1. **Drops** the anonymous `applications/` upload policy.
2. **`vendor_renewal_documents`** — immutable, private. Provider (`vendor_onboarding`),
   kind (`license`/`insurance`), unique storage path, file name, type, size, submitter and
   whether the submitter was the provider or an operator. A check constraint requires the
   path `renewals/<provider>/<kind>/<uuid>-<safe name>.<ext>`.
3. **`vendor_renewal_document_decisions`** — immutable, private, one per document.
   `accepted` names the evidence it became; `declined` carries a required note (≤ 1000).
4. **`vendor_authorize_renewal_upload(kind, contractor?)`** — read-only pre-check for the
   upload route. An operator names the provider; a vendor gets only the provider linked to
   its own account. The provider must be `active` or `suspended`, and have fewer than five
   undecided submissions for that item.
5. **`vendor_submit_renewal_document(path, contractor?)`** — same authorization, under the
   provider's onboarding lock. The path must be under the authorized provider and a
   license/insurance folder; existence, size and type are read from `storage.objects`, not
   the caller. The path is the idempotency key: the same submitter replays, anyone else is
   refused. Writes a submission only.
6. **`vendor_decline_renewal_document(document, note, key)`** — operator, note and key
   required, refuses a decided document, exact replay only. Takes the same onboarding lock.
7. **`vendor_record_checklist_evidence`** is replaced with the TRACE-069 body plus one rule:
   license and insurance may also reference one of this provider's **undecided** renewal
   submissions for the same item. Recording the evidence inserts the `accepted` decision in
   the same transaction under the request key. Refusals: another provider's submission
   (the existing "Document must belong to the current provider application"), a different
   item, a decided submission. An expiry is still operator-entered with no default.
8. Readbacks, all writing nothing: operator `vendor_renewal_document_overview(contractor)`
   and `vendor_renewal_document_queue()` (undecided across providers); vendor
   `vendor_own_renewal_documents()` with item, file name, times, submitter type, state and
   note only, plus whether uploads are open and the limit.

Nothing in the slice changes onboarding status or revision, creates an application
version, grants a role, changes eligibility except through recorded evidence, or lists
anything. Grants: the tables and private helpers have no client access; the six public
functions are `authenticated` only.

## Routes and interface

- **`POST /api/renewal-documents`** validates item, name, type and size, asks the database
  through the caller's own session, then issues one signed upload URL with the service
  client at a server-built path. **`POST /api/renewal-documents/submit`** records the upload
  through the caller's session and, for a new provider submission, sends the owner
  notification after the response (`after`). Database refusals authored in the migration
  are returned (400/403); anything else is generic. The browser flow is shared by both
  surfaces (`src/lib/renewalDocumentUpload.ts`).
- **Vendor portal → Compliance Documents** (`/vendor/compliance`, new sidebar entry): upload
  form (item, file, client-side type/size check), the open-limit message, submissions with
  state badges and decline notes; permission state with Contact when uploads are closed;
  loading and error-with-retry states. The TRACE-072 notice links here when license or
  insurance is due, and keeps "Send your renewed documents to Mercurius" for other items.
- **Activation checklist → Renewal documents** section: list with Open (10-minute signed
  link), Decline (ConfirmAction with a required "Note to the provider") and an operator
  upload for active or suspended providers. The Licensing/Insurance document select now
  groups application documents and renewal documents awaiting review; the confirmation
  states that recording accepts the renewal document, and success requires the checklist
  and the renewal overview to agree.
- **Compliance Expiry** gains "Renewal documents awaiting review", loaded independently of
  the expiry queue, linking each provider.
- `ConfirmAction` accepts an optional reason label and help; defaults are unchanged.

## Decisions taken during implementation

1. **Accept through the checklist command, not a separate accept command,** so evidence and
   acceptance cannot diverge and the TRACE-069 replay, lock and supersede guard apply.
2. **Active and suspended providers only,** matching the TRACE-072 queue. Providers under
   review use the application; rejected providers take no evidence.
3. **Five undecided submissions per item.** No rate-limit infrastructure exists in the app,
   so the database caps what one account can queue. Declines and acceptances free places.
4. **The database reads size and type from Storage metadata** rather than trusting the
   client or an HMAC grant; the unique path doubles as the idempotency key, so no grant
   token is needed.
5. **The route uses the caller's session for every database command**; the service key only
   issues upload URLs and reads the provider name for the email.
6. **Notification text carries business name, item and time only** — no path, file name or
   contact details.
7. **Strict matching:** no workbench change. After cutover, enter the requirement's version
   in the checklist and use "Reuse current evidence" in Provider compliance to bind it.

## Open items

- **Orphaned uploads.** An upload that is never submitted, and declined files, stay in the
  bucket. CFG-011 sets 90 days for rejected or abandoned vendor documents; retention jobs
  remain a Phase 5 gate, and no purge was built here.
- **Malware scanning** is still an MTS §15 ADR; renewal uploads share the application path's
  gap.
- **Admin `UPDATE`/`DELETE` on the bucket** (2026-07-31 policies) would let an operator
  client overwrite or remove an accepted file. Pre-existing; not changed without a decision.
- **Operator path claim.** An operator could submit a provider's uploaded path before the
  provider does; paths are random and operators are trusted, so it was left.
- Owner email delivery was not exercised (no Resend key locally); the route attempted it once
  for the provider submission and logged the configuration error.
- Codex code review; CI on the final head; hosted round-trip.
- Standing: document sufficiency by category/jurisdiction; TRACE-065 dark-theme contrast
  defect in the Applications table.
