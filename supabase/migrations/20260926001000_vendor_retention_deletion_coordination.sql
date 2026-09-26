-- TRACE-093: a retention hold and a permanent deletion can no longer both take effect
-- (Codex Phase 5 closure review P1, 2026-09-26; CFG-011; TRACE-074, TRACE-084, TRACE-090,
-- TRACE-091).
--
-- Before this, prepare checked for a hold and wrote nothing, and the route then removed the
-- file from quarantine with the service key. A hold committed between those two calls did
-- not stop the removal; record saw the file gone and wrote the deletion with under_hold, but
-- the file could not be recovered.
--
-- The protocol now:
-- 1. Prepare of a deletion records a durable deletion request (actor, path, reason, key) in
--    addition to its existing checks. A request authorises nothing by itself.
-- 2. The route removes the file with the operator's own session, not the service key. The
--    Storage API deletes the storage.objects row and then the stored bytes inside one
--    database transaction, under the caller's role, so row-level security applies.
-- 3. The delete policy on the quarantine bucket takes the same locks hold placement takes
--    (the provider's onboarding row; for an application, its providers' rows and then the
--    application row), re-runs the step's refusal, and allows the delete only when no hold
--    is in force. In the same transaction it writes a storage deletion row naming the
--    request.
-- 4. Record accepts the deletion only after storage shows the file gone, as before. A
--    deletion with a storage deletion row happened while no hold was in force, so it is
--    recorded with under_hold false even if a hold was placed afterwards.
--
-- When each takes effect: a hold when its event commits; a deletion when Storage's
-- transaction commits. Both hold the same row lock, so whichever commits first wins. A hold
-- that commits first makes the delete match no row and the file stays. A deletion that
-- commits first stays recordable after a later hold. An interrupted request is finished by
-- retrying: the storage deletion row survives a crash between Storage and record, and a
-- Storage call that failed rolled the row back with it.
--
-- Quarantine and restore still move files with the service key. A move can still land
-- after a hold; it is reversible, recorded under_hold and restorable. Deletion is the only
-- step that cannot be undone. The service key can still delete anything; the application
-- no longer does so for retention.

create table public.vendor_retention_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  scope text not null check(scope in ('renewal_document','application','renewal_upload')),
  subject_id uuid not null,
  storage_path text not null,
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  business_key text not null check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(scope,business_key)
);
create index vendor_retention_deletion_requests_path on public.vendor_retention_deletion_requests(storage_path,actor,sequence desc);

-- Written only inside the Storage API's delete transaction, by the quarantine delete policy.
-- A row means Storage removed the file while no hold was in force.
create table public.vendor_retention_storage_deletions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  request_id uuid not null unique references public.vendor_retention_deletion_requests(id),
  storage_path text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index vendor_retention_storage_deletions_path on public.vendor_retention_storage_deletions(storage_path);

alter table public.vendor_retention_deletion_requests enable row level security;
alter table public.vendor_retention_storage_deletions enable row level security;
revoke all on public.vendor_retention_deletion_requests, public.vendor_retention_storage_deletions
  from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_retention_deletion_requests
  for each row execute function public.money_immutable();
create trigger immutable_evidence before update or delete on public.vendor_retention_storage_deletions
  for each row execute function public.money_immutable();

-- Records the deletion request prepare has just allowed. The same key replays only for the
-- same subject, path, actor and reason.
create function private.vendor_retention_request_deletion(p_scope text,p_subject uuid,p_path text,p_reason text,p_key text,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare prior public.vendor_retention_deletion_requests;
begin
 select * into prior from public.vendor_retention_deletion_requests where scope=p_scope and business_key=p_key;
 if found then
   if prior.subject_id<>p_subject or prior.storage_path<>p_path or prior.actor<>p_actor or prior.reason<>btrim(p_reason) then
     raise exception 'Retention idempotency conflict';
   end if;
   return;
 end if;
 insert into public.vendor_retention_deletion_requests(scope,subject_id,storage_path,reason,business_key,actor)
   values(p_scope,p_subject,p_path,btrim(p_reason),p_key,p_actor)
 on conflict (scope,business_key) do nothing;
 if not found then raise exception 'Retention idempotency conflict'; end if;
end $$;

-- The caller's deletion request for a quarantined object that Storage has not yet removed.
create function private.vendor_retention_open_request(p_bucket text,p_name text)
returns public.vendor_retention_deletion_requests
language sql stable security definer set search_path='' as $$
 select r.* from public.vendor_retention_deletion_requests r
 where p_bucket='vendor-documents-quarantine' and r.storage_path=p_name and r.actor=auth.uid()
   and public.has_role(auth.uid(),'admin')
   and not exists(select 1 from public.vendor_retention_storage_deletions s where s.request_id=r.id)
 order by r.sequence desc limit 1
$$;

-- The quarantine select policy: only an object the caller has an open deletion request for.
create function public.vendor_retention_deletion_requested(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select (private.vendor_retention_open_request(p_bucket,p_name)).id is not null
$$;

-- The quarantine delete policy. Volatile, so each statement after a lock reads what committed
-- while it waited. Answers only inside a Storage API delete (the flag Storage sets for
-- storage.protect_delete), so calling it directly records nothing. Takes the locks hold
-- placement and record take, in record's order; re-runs the step's refusal; refuses while
-- a hold is in force; otherwise writes the storage deletion row in the Storage transaction
-- and allows the delete.
create function public.vendor_retention_storage_delete_allowed(p_bucket text,p_name text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare req public.vendor_retention_deletion_requests; contractor uuid; held boolean;
begin
 if coalesce(current_setting('storage.allow_delete_query',true),'')<>'true' then return false; end if;
 select * into req from private.vendor_retention_open_request(p_bucket,p_name);
 if req.id is null then return false; end if;
 if req.scope='renewal_document' then
   select d.contractor_id into contractor from public.vendor_renewal_documents d where d.id=req.subject_id and d.storage_path=p_name;
   if contractor is null then return false; end if;
   perform 1 from public.vendor_onboarding o where o.contractor_id=contractor for share;
   if private.vendor_renewal_retention_refusal(req.subject_id,'deleted') is not null then return false; end if;
   held:=exists(select 1 from private.vendor_retention_hold(contractor));
 elsif req.scope='application' then
   perform 1 from public.vendor_onboarding o where o.contractor_id in (select private.vendor_application_contractors(req.subject_id))
     order by o.contractor_id for share;
   perform 1 from public.vendor_applications a where a.id=req.subject_id for share;
   if private.vendor_application_retention_refusal(req.subject_id,p_name,'deleted') is not null then return false; end if;
   held:=private.vendor_application_held(req.subject_id);
 else
   contractor:=private.vendor_renewal_upload_contractor(p_name);
   if contractor is null or contractor<>req.subject_id then return false; end if;
   perform 1 from public.vendor_onboarding o where o.contractor_id=contractor for share;
   if private.vendor_renewal_upload_retention_refusal(p_name,'deleted') is not null then return false; end if;
   held:=exists(select 1 from private.vendor_retention_hold(contractor));
 end if;
 if held then return false; end if;
 insert into public.vendor_retention_storage_deletions(request_id,storage_path) values(req.id,p_name)
   on conflict (request_id) do nothing;
 return true;
end $$;

-- Whether a quarantined object's removal is on record as done while no hold was in force.
create function private.vendor_retention_storage_deleted(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vendor_retention_storage_deletions s where s.storage_path=p_path)
$$;

-- The Storage API deletes with DELETE ... RETURNING, which needs the row visible to the
-- caller. Only the object an operator has an open deletion request for is visible.
create policy "Retention operators can see requested quarantine deletions" on storage.objects
  for select to authenticated
  using (bucket_id='vendor-documents-quarantine' and public.vendor_retention_deletion_requested(bucket_id,name));
create policy "Retention operators can delete when no hold is in force" on storage.objects
  for delete to authenticated
  using (bucket_id='vendor-documents-quarantine' and public.vendor_retention_storage_delete_allowed(bucket_id,name));

-- TRACE-074 prepare, unchanged except that an allowed deletion records its request. No longer
-- read-only.
create or replace function public.vendor_prepare_renewal_retention(p_document uuid,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; d public.vendor_renewal_documents; replay jsonb; refusal text;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 if length(p_reason)>1000 then raise exception 'Reason must be 1000 characters or fewer'; end if;
 replay:=private.vendor_renewal_retention_replay(p_key,p_document,p_action,p_reason,actor);
 refusal:=case when replay is null then private.vendor_renewal_retention_refusal(p_document,p_action) end;
 if refusal is not null then raise exception '%',refusal; end if;
 select * into strict d from public.vendor_renewal_documents where id=p_document;
 if replay is null and exists(select 1 from private.vendor_retention_hold(d.contractor_id))
   and ((p_action='quarantined' and private.vendor_renewal_object_location(d.storage_path)<>'quarantine')
     or (p_action='deleted' and private.vendor_renewal_object_location(d.storage_path)<>'missing')) then
   raise exception 'This provider is on a retention hold';
 end if;
 if replay is null and p_action='deleted' then
   perform private.vendor_retention_request_deletion('renewal_document',d.id,d.storage_path,p_reason,p_key,actor);
 end if;
 return jsonb_build_object('document_id',d.id,'action',p_action,'replay',replay is not null,'storage_path',d.storage_path,
   'from_bucket',case when p_action='quarantined' then 'vendor-documents' else 'vendor-documents-quarantine' end,
   'to_bucket',case p_action when 'quarantined' then 'vendor-documents-quarantine' when 'restored' then 'vendor-documents' end);
end $$;

-- TRACE-084 prepare, unchanged except that an allowed deletion records its request.
create or replace function public.vendor_application_retention_prepare(p_application uuid,p_path text,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; replay jsonb; refusal text; location text;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 if length(p_reason)>1000 then raise exception 'Reason must be 1000 characters or fewer'; end if;
 replay:=private.vendor_application_retention_replay(p_key,p_application,p_path,p_action,p_reason,actor);
 refusal:=case when replay is null then private.vendor_application_retention_refusal(p_application,p_path,p_action) end;
 if refusal is not null then raise exception '%',refusal; end if;
 location:=private.vendor_renewal_object_location(p_path);
 if replay is null and private.vendor_application_held(p_application)
   and ((p_action='quarantined' and location<>'quarantine') or (p_action='deleted' and location<>'missing')) then
   raise exception 'This application is on a retention hold';
 end if;
 if replay is null and p_action='deleted' then
   perform private.vendor_retention_request_deletion('application',p_application,p_path,p_reason,p_key,actor);
 end if;
 return jsonb_build_object('application_id',p_application,'action',p_action,'replay',replay is not null,'storage_path',p_path,
   'from_bucket',case when p_action='quarantined' then 'vendor-documents' else 'vendor-documents-quarantine' end,
   'to_bucket',case p_action when 'quarantined' then 'vendor-documents-quarantine' when 'restored' then 'vendor-documents' end);
end $$;

-- TRACE-091 prepare, unchanged except that an allowed deletion records its request.
create or replace function public.vendor_renewal_upload_retention_prepare(p_path text,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; replay jsonb; refusal text; location text; contractor uuid;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 if length(p_reason)>1000 then raise exception 'Reason must be 1000 characters or fewer'; end if;
 replay:=private.vendor_renewal_upload_retention_replay(p_key,p_path,p_action,p_reason,actor);
 refusal:=case when replay is null then private.vendor_renewal_upload_retention_refusal(p_path,p_action) end;
 if refusal is not null then raise exception '%',refusal; end if;
 contractor:=private.vendor_renewal_upload_contractor(p_path);
 location:=private.vendor_renewal_object_location(p_path);
 if replay is null and exists(select 1 from private.vendor_retention_hold(contractor))
   and ((p_action='quarantined' and location<>'quarantine') or (p_action='deleted' and location<>'missing')) then
   raise exception 'This provider is on a retention hold';
 end if;
 if replay is null and p_action='deleted' then
   perform private.vendor_retention_request_deletion('renewal_upload',contractor,p_path,p_reason,p_key,actor);
 end if;
 return jsonb_build_object('contractor_id',contractor,'action',p_action,'replay',replay is not null,'storage_path',p_path,
   'from_bucket',case when p_action='quarantined' then 'vendor-documents' else 'vendor-documents-quarantine' end,
   'to_bucket',case p_action when 'quarantined' then 'vendor-documents-quarantine' when 'restored' then 'vendor-documents' end);
end $$;

-- TRACE-074 record. Changes: a deletion Storage made under the policy is recorded with
-- under_hold false, since no hold was in force when it took effect; a file still in storage
-- while a hold is in force is refused as held.
create or replace function public.vendor_record_renewal_retention(p_document uuid,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; d public.vendor_renewal_documents; replay jsonb; refusal text; location text; held boolean; size_value text;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 select * into d from public.vendor_renewal_documents where id=p_document;
 if not found then raise exception 'Renewal document not found'; end if;
 perform 1 from public.vendor_onboarding o where o.contractor_id=d.contractor_id for update;
 replay:=private.vendor_renewal_retention_replay(p_key,p_document,p_action,p_reason,actor);
 if replay is not null then return replay; end if;
 refusal:=private.vendor_renewal_retention_refusal(p_document,p_action);
 if refusal is not null then raise exception '%',refusal; end if;

 held:=exists(select 1 from private.vendor_retention_hold(d.contractor_id));
 location:=private.vendor_renewal_object_location(d.storage_path);
 if p_action='quarantined' then
   select q.metadata->>'size' into size_value from storage.objects q where q.bucket_id='vendor-documents-quarantine' and q.name=d.storage_path;
   if location<>'quarantine' or size_value is distinct from d.size_bytes::text then
     raise exception 'Storage does not show this document in quarantine';
   end if;
 elsif p_action='restored' then
   select o.metadata->>'size' into size_value from storage.objects o where o.bucket_id='vendor-documents' and o.name=d.storage_path;
   if location<>'documents' or size_value is distinct from d.size_bytes::text then
     raise exception 'Storage does not show this document restored';
   end if;
 elsif location<>'missing' then
   if held then raise exception 'This provider is on a retention hold'; end if;
   raise exception 'Storage still holds this document';
 elsif private.vendor_retention_storage_deleted(d.storage_path) then
   held:=false;
 end if;

 begin
   insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor)
     values(p_document,p_action,btrim(p_reason),held,p_key,actor);
 exception when unique_violation then
   raise exception 'Retention idempotency conflict';
 end;
 return jsonb_build_object('document_id',p_document,'action',p_action,'under_hold',held,'recorded',true);
end $$;

-- TRACE-084/090 record, with the same two changes.
create or replace function public.vendor_application_retention_record(p_application uuid,p_path text,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; refusal text; location text; held boolean; size_value text; recorded_size bigint; r record;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 perform 1 from public.vendor_onboarding o where o.contractor_id in (select private.vendor_application_contractors(p_application))
   order by o.contractor_id for update;
 perform 1 from public.vendor_applications a where a.id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 replay:=private.vendor_application_retention_replay(p_key,p_application,p_path,p_action,p_reason,actor);
 if replay is not null then return replay; end if;
 refusal:=private.vendor_application_retention_refusal(p_application,p_path,p_action);
 if refusal is not null then raise exception '%',refusal; end if;

 held:=private.vendor_application_held(p_application);
 location:=private.vendor_renewal_object_location(p_path);
 if p_action='quarantined' then
   select q.metadata->>'size' into size_value from storage.objects q where q.bucket_id='vendor-documents-quarantine' and q.name=p_path;
   if location<>'quarantine' or coalesce(size_value,'') !~ '^[1-9][0-9]{0,11}$' then
     raise exception 'Storage does not show this document in quarantine';
   end if;
   recorded_size:=size_value::bigint;
 elsif p_action='restored' then
   select * into strict r from private.vendor_application_retention_state(p_path);
   select o.metadata->>'size' into size_value from storage.objects o where o.bucket_id='vendor-documents' and o.name=p_path;
   if location<>'documents' or size_value is distinct from r.size_bytes::text then
     raise exception 'Storage does not show this document restored';
   end if;
 elsif location<>'missing' then
   if held then raise exception 'This application is on a retention hold'; end if;
   raise exception 'Storage still holds this document';
 elsif private.vendor_retention_storage_deleted(p_path) then
   held:=false;
 end if;

 begin
   insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor)
     values(p_application,p_path,p_action,recorded_size,btrim(p_reason),held,p_key,actor);
 exception when unique_violation then
   raise exception 'Retention idempotency conflict';
 end;
 return jsonb_build_object('application_id',p_application,'storage_path',p_path,'action',p_action,'under_hold',held,'recorded',true);
end $$;

-- TRACE-091 record, with the same two changes.
create or replace function public.vendor_renewal_upload_retention_record(p_path text,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; refusal text; location text; held boolean; size_value text; recorded_size bigint;
  contractor uuid; r record;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 contractor:=private.vendor_renewal_upload_contractor(p_path);
 if contractor is null then raise exception 'Renewal upload not found'; end if;
 perform 1 from public.vendor_onboarding o where o.contractor_id=contractor for update;
 replay:=private.vendor_renewal_upload_retention_replay(p_key,p_path,p_action,p_reason,actor);
 if replay is not null then return replay; end if;
 refusal:=private.vendor_renewal_upload_retention_refusal(p_path,p_action);
 if refusal is not null then raise exception '%',refusal; end if;

 held:=exists(select 1 from private.vendor_retention_hold(contractor));
 location:=private.vendor_renewal_object_location(p_path);
 if p_action='quarantined' then
   select q.metadata->>'size' into size_value from storage.objects q where q.bucket_id='vendor-documents-quarantine' and q.name=p_path;
   if location<>'quarantine' or coalesce(size_value,'') !~ '^[1-9][0-9]{0,11}$' then
     raise exception 'Storage does not show this document in quarantine';
   end if;
   recorded_size:=size_value::bigint;
 elsif p_action='restored' then
   select * into strict r from private.vendor_renewal_upload_retention_state(p_path);
   select o.metadata->>'size' into size_value from storage.objects o where o.bucket_id='vendor-documents' and o.name=p_path;
   if location<>'documents' or size_value is distinct from r.size_bytes::text then
     raise exception 'Storage does not show this document restored';
   end if;
 elsif location<>'missing' then
   if held then raise exception 'This provider is on a retention hold'; end if;
   raise exception 'Storage still holds this document';
 elsif private.vendor_retention_storage_deleted(p_path) then
   held:=false;
 end if;

 begin
   insert into public.vendor_renewal_upload_retention_actions(contractor_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor)
     values(contractor,p_path,p_action,recorded_size,btrim(p_reason),held,p_key,actor);
 exception when unique_violation then
   raise exception 'Retention idempotency conflict';
 end;
 return jsonb_build_object('contractor_id',contractor,'storage_path',p_path,'action',p_action,'under_hold',held,'recorded',true);
end $$;

-- The policy functions run as the caller's role inside Storage's query, so authenticated
-- executes the two public entry points; everything else stays private.
revoke all on function private.vendor_retention_request_deletion(text,uuid,text,text,text,uuid),
 private.vendor_retention_open_request(text,text),
 private.vendor_retention_storage_deleted(text)
 from public,anon,authenticated,service_role;
revoke all on function public.vendor_retention_deletion_requested(text,text),
 public.vendor_retention_storage_delete_allowed(text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_retention_deletion_requested(text,text),
 public.vendor_retention_storage_delete_allowed(text,text)
 to authenticated;
-- create or replace keeps the grants on the three prepare and three record functions.
