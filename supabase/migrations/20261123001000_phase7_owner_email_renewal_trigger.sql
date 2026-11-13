-- TRACE-154 (Phase 7.2C-2): owner-email ledger rows for provider renewal-document submissions.
--
-- Plan: governance/PHASE-7-OWNER-EMAIL-LEDGER-PLAN.md §3.3; slice record
-- governance/PHASE-7-OWNER-EMAIL-LEDGER-7-2C-2.md.
--
-- A provider's renewal-document submission gets its pending owner-email record in the same
-- transaction as the document row (AFTER INSERT trigger). Operator uploads notify nobody
-- (owner decision 2026-09-15), so the trigger fires only for submitted_as = 'provider'. A
-- replay of an already-recorded path inserts nothing, so it never fires.
--
-- This is the only object added. vendor_submit_renewal_document, the shared ledger tables
-- and functions from 20261122001000 and every money-fingerprinted function are unchanged.
-- No row is backfilled: documents saved before this migration stay untracked and cannot be
-- sent through the owner-email functions.

create function private.owner_email_renewal_create() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n uuid;
begin
  insert into private.owner_email_notifications(source_kind, renewal_document_id)
    values ('renewal_document', new.id)
  on conflict (renewal_document_id) do nothing
  returning id into n;
  if n is not null then
    perform private.owner_email_log(n, 'renewal_document', new.id, null, 'pending', 0, null, null, null, null);
  end if;
  return new;
end $$;

create trigger owner_email_renewal_create
  after insert on public.vendor_renewal_documents
  for each row when (new.submitted_as = 'provider')
  execute function private.owner_email_renewal_create();

revoke all on function private.owner_email_renewal_create() from public, anon, authenticated, service_role;
