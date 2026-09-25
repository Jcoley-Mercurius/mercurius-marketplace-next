-- TRACE-091: retention for renewal uploads that were never submitted (DEC-2026-015, owner
-- 2026-09-25: the same rule as TRACE-090's application uploads).
--
-- The renewal route issues one signed upload URL per request under
-- renewals/<provider>/<license|insurance>/<uuid>-<name>.<ext>; the browser uploads the file and
-- then asks the submit route to record it. A file whose upload succeeded but was never
-- submitted has no vendor_renewal_documents row, so TRACE-074's ledger (keyed by document)
-- cannot hold it and it stayed in vendor-documents indefinitely.
--
-- Owner decision: such a file becomes due 7 days after its 2-hour signed upload URL expires,
-- measured from the object's created_at as TRACE-090 does, unless compliance evidence
-- references it. It then follows the TRACE-074 operator-run quarantine, 14-day wait and
-- permanent deletion, with the provider's TRACE-074 retention hold respected.
--
-- Unlike an application upload, which must be finalized with a 110-minute token, a renewal
-- upload can be submitted with the provider's session at any time. So that a submission can
-- never race a quarantine, a submission is refused once its object is 7 days old; quarantine
-- opens 2 hours later. Both use the database clock and the provider's onboarding lock.
--
-- Nothing here changes a submission, decision, evidence, onboarding status, revision,
-- eligibility, role or listing. TRACE-074's buckets, periods, holds and storage checks are
-- reused unchanged; the 2-hour grant and 7-day periods are TRACE-090's single definitions.

-- The renewal upload layout. Group 1 is the provider, group 2 the item.
create function private.vendor_renewal_upload_pattern() returns text
  language sql immutable set search_path='' as $$
 select '^renewals/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(license|insurance)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif)$'
$$;

-- The provider a renewal upload path belongs to, or null outside the layout.
create function private.vendor_renewal_upload_contractor(p_path text) returns uuid
  language sql immutable set search_path='' as $$
 select (regexp_match(coalesce(p_path,''),private.vendor_renewal_upload_pattern()))[1]::uuid
$$;

-- Each confirmed retention step for one never-submitted renewal upload. There is no
-- document row, so the path is the key; a quarantine records the size storage shows and a
-- restore must bring back a file of that size (TRACE-084's application ledger shape).
create table public.vendor_renewal_upload_retention_actions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  contractor_id uuid not null references public.contractors(id),
  storage_path text not null,
  action text not null check(action in ('quarantined','restored','deleted')),
  size_bytes bigint check(size_bytes>0),
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  under_hold boolean not null,
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (storage_path like 'renewals/'||contractor_id::text||'/%'),
  check ((action='quarantined')=(size_bytes is not null))
);
create index vendor_renewal_upload_retention_actions_path on public.vendor_renewal_upload_retention_actions(storage_path,sequence desc);
create unique index vendor_renewal_upload_retention_one_deletion on public.vendor_renewal_upload_retention_actions(storage_path) where action='deleted';

alter table public.vendor_renewal_upload_retention_actions enable row level security;
revoke all on public.vendor_renewal_upload_retention_actions from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_renewal_upload_retention_actions
  for each row execute function public.money_immutable();

-- Renewal uploads no submission lists: objects in either bucket plus paths the ledger has
-- already moved or deleted, for existing providers, optionally one provider. uploaded_at is
-- the earliest created_at storage shows, or null once the file is gone.
create function private.vendor_renewal_unattached_uploads(p_contractor uuid default null)
returns table(path text,contractor_id uuid,uploaded_at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.path,private.vendor_renewal_upload_contractor(c.path),min(c.created_at) from (
   select o.name as path,o.created_at from storage.objects o
    where o.bucket_id in ('vendor-documents','vendor-documents-quarantine')
      and o.name like 'renewals/'||coalesce(p_contractor::text,'')||'%'
   union all
   select a.storage_path,null::timestamptz from public.vendor_renewal_upload_retention_actions a
    where p_contractor is null or a.contractor_id=p_contractor
 ) c
 where c.path ~ private.vendor_renewal_upload_pattern()
   and exists(select 1 from public.contractors p where p.id=private.vendor_renewal_upload_contractor(c.path))
   and not exists(select 1 from public.vendor_renewal_documents d where d.storage_path=c.path)
 group by c.path
$$;

-- Where an upload is according to the ledger, since when, and the size recorded when it was
-- last quarantined.
create function private.vendor_renewal_upload_retention_state(p_path text)
returns table(state text,since timestamptz,size_bytes bigint)
language sql stable security definer set search_path='' as $$
 select coalesce((select case a.action when 'restored' then 'retained' else a.action end
     from public.vendor_renewal_upload_retention_actions a where a.storage_path=p_path order by a.sequence desc limit 1),'retained'),
   (select a.created_at from public.vendor_renewal_upload_retention_actions a where a.storage_path=p_path order by a.sequence desc limit 1),
   (select a.size_bytes from public.vendor_renewal_upload_retention_actions a where a.storage_path=p_path and a.action='quarantined' order by a.sequence desc limit 1)
$$;

-- Ledger preconditions for one step, shared by prepare and record. Returns the refusal
-- message, or null when the step may proceed. Holds are checked by the callers. A deletion
-- is recorded after storage no longer holds the file; its clock was checked at quarantine.
create function private.vendor_renewal_upload_retention_refusal(p_path text,p_action text)
returns text language plpgsql stable security definer set search_path='' as $$
declare r record; uploaded timestamptz;
begin
 if exists(select 1 from public.vendor_renewal_documents d where d.storage_path=p_path) then
   return 'This upload was submitted; declined submissions follow the renewal document rules';
 end if;
 select u.uploaded_at into uploaded from private.vendor_renewal_unattached_uploads(private.vendor_renewal_upload_contractor(p_path)) u
  where u.path=p_path;
 if p_path is null or not found then return 'Renewal upload not found'; end if;
 select * into strict r from private.vendor_renewal_upload_retention_state(p_path);
 if r.state='deleted' then return 'Renewal upload already deleted'; end if;
 if p_action not in ('quarantined','restored','deleted') then return 'Unknown retention action'; end if;
 if p_action='restored' then
   if r.state<>'quarantined' then return 'Renewal upload is not in quarantine'; end if;
   return null;
 end if;
 if p_action='quarantined' and r.state<>'retained' then return 'Renewal upload already quarantined'; end if;
 if p_action='deleted' and r.state<>'quarantined' then return 'Renewal upload must be quarantined before deletion'; end if;
 if private.vendor_application_file_bound(p_path) then return 'Documents bound to compliance evidence are kept'; end if;
 if (uploaded is null and p_action<>'deleted') or private.vendor_application_unattached_due_at(uploaded)>now() then
   return 'Renewal uploads never submitted are kept for '||private.vendor_unattached_upload_days()
     ||' days after their upload link expires';
 end if;
 if p_action='deleted' and r.since>now()-make_interval(days=>private.vendor_document_quarantine_days()) then
   return 'Quarantined documents are kept for '||private.vendor_document_quarantine_days()||' days before deletion';
 end if;
 return null;
end $$;

-- Replay of a recorded step under the same key. Null when the key is unused; refuses a key
-- reused for anything else.
create function private.vendor_renewal_upload_retention_replay(p_key text,p_path text,p_action text,p_reason text,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior public.vendor_renewal_upload_retention_actions;
begin
 select * into prior from public.vendor_renewal_upload_retention_actions where business_key=p_key;
 if not found then return null; end if;
 if prior.storage_path is distinct from p_path or prior.action<>p_action
   or prior.actor<>p_actor or prior.reason<>btrim(coalesce(p_reason,'')) then
   raise exception 'Retention idempotency conflict';
 end if;
 return jsonb_build_object('contractor_id',prior.contractor_id,'storage_path',p_path,'action',p_action,'under_hold',prior.under_hold,'recorded',false);
end $$;

-- Pre-check for the retention route before it touches storage. Writes nothing. A provider
-- hold refuses a new quarantine or a deletion unless storage already shows that step
-- complete, so the retry records what happened, marked under hold. Restoring is always
-- allowed. A key already recorded for this exact step returns replay=true.
create function public.vendor_renewal_upload_retention_prepare(p_path text,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 return jsonb_build_object('contractor_id',contractor,'action',p_action,'replay',replay is not null,'storage_path',p_path,
   'from_bucket',case when p_action='quarantined' then 'vendor-documents' else 'vendor-documents-quarantine' end,
   'to_bucket',case p_action when 'quarantined' then 'vendor-documents-quarantine' when 'restored' then 'vendor-documents' end);
end $$;

-- Records a retention step only when storage shows it happened. Takes the provider's
-- onboarding lock, the one submissions and holds take, so it serialises with both.
create function public.vendor_renewal_upload_retention_record(p_path text,p_action text,p_reason text,p_key text)
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
   raise exception 'Storage still holds this document';
 end if;

 held:=exists(select 1 from private.vendor_retention_hold(contractor));
 begin
   insert into public.vendor_renewal_upload_retention_actions(contractor_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor)
     values(contractor,p_path,p_action,recorded_size,btrim(p_reason),held,p_key,actor);
 exception when unique_violation then
   raise exception 'Retention idempotency conflict';
 end;
 return jsonb_build_object('contractor_id',contractor,'storage_path',p_path,'action',p_action,'under_hold',held,'recorded',true);
end $$;

-- A renewal upload out of document storage by retention cannot become evidence, whichever
-- command records the evidence. Shares the provider lock the retention record takes.
create function private.vendor_evidence_renewal_upload_retention_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare contractor uuid;
begin
 contractor:=private.vendor_renewal_upload_contractor(new.evidence_ref);
 if contractor is not null then
   perform 1 from public.vendor_onboarding o where o.contractor_id=contractor for share;
   if exists(select 1 from private.vendor_renewal_upload_retention_state(new.evidence_ref) s where s.state<>'retained') then
     raise exception 'A document in retention quarantine cannot become evidence';
   end if;
 end if;
 return new;
end $$;
create trigger vendor_evidence_renewal_upload_retention before insert on public.vendor_compliance_evidence
  for each row execute function private.vendor_evidence_renewal_upload_retention_guard();

-- Retention fields for one never-submitted upload, for operator readbacks only.
create function private.vendor_renewal_upload_json(p_path text,p_contractor uuid,p_uploaded_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('contractor_id',p_contractor,'name',c.name,
   'path',p_path,'kind',split_part(p_path,'/',3),
   'file_name',regexp_replace(split_part(p_path,'/',4),'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-',''),
   'uploaded_at',p_uploaded_at,
   'retention_ends_at',private.vendor_application_unattached_due_at(p_uploaded_at),
   'retention_state',s.state,'retention_since',s.since,
   'quarantine_ends_at',case when s.state='quarantined' then s.since+make_interval(days=>private.vendor_document_quarantine_days()) end,
   'object_location',private.vendor_renewal_object_location(p_path),
   'bound_to_evidence',private.vendor_application_file_bound(p_path),
   'held',exists(select 1 from private.vendor_retention_hold(p_contractor)))
 from public.contractors c
 cross join lateral private.vendor_renewal_upload_retention_state(p_path) s
 where c.id=p_contractor
$$;

-- TRACE-074's queue with three added lists and the two clock values. unattached_due:
-- never-submitted uploads past their clock, still retained and not bound to evidence (held
-- providers included, marked held); unattached_quarantined: those in quarantine;
-- unattached_kept: those bound to evidence. due, quarantined and holds are unchanged.
create or replace function public.vendor_document_retention_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'evaluated_at',now(),
  'retention_days',private.vendor_document_retention_days(),
  'quarantine_days',private.vendor_document_quarantine_days(),
  'unattached_days',private.vendor_unattached_upload_days(),
  'upload_grant_hours',private.vendor_application_upload_grant_hours(),
  'due',coalesce((select jsonb_agg(e.value order by e.value->>'decided_at',e.value->>'id') from (
      select private.vendor_renewal_document_json(d,true) || private.vendor_renewal_retention_json(d)
        || jsonb_build_object('name',c.name,'held',exists(select 1 from private.vendor_retention_hold(d.contractor_id))) as value
      from public.vendor_renewal_documents d
      join public.vendor_renewal_document_decisions x on x.document_id=d.id and x.outcome='declined'
      join public.contractors c on c.id=d.contractor_id
      where x.created_at<=now()-make_interval(days=>private.vendor_document_retention_days())
    ) e where e.value->>'retention_state'='retained'),'[]'::jsonb),
  'quarantined',coalesce((select jsonb_agg(e.value order by e.value->>'retention_since',e.value->>'id') from (
      select private.vendor_renewal_document_json(d,true) || private.vendor_renewal_retention_json(d)
        || jsonb_build_object('name',c.name,'held',exists(select 1 from private.vendor_retention_hold(d.contractor_id))) as value
      from public.vendor_renewal_documents d
      join public.vendor_renewal_document_decisions x on x.document_id=d.id and x.outcome='declined'
      join public.contractors c on c.id=d.contractor_id
    ) e where e.value->>'retention_state'='quarantined'),'[]'::jsonb),
  'unattached_due',coalesce((select jsonb_agg(e.value order by e.value->>'uploaded_at',e.value->>'path') from (
      select private.vendor_renewal_upload_json(u.path,u.contractor_id,u.uploaded_at) as value
      from private.vendor_renewal_unattached_uploads() u
      where private.vendor_application_unattached_due_at(u.uploaded_at)<=now()
    ) e where e.value->>'retention_state'='retained' and not (e.value->>'bound_to_evidence')::boolean),'[]'::jsonb),
  'unattached_quarantined',coalesce((select jsonb_agg(e.value order by e.value->>'retention_since',e.value->>'path') from (
      select private.vendor_renewal_upload_json(u.path,u.contractor_id,u.uploaded_at) as value
      from private.vendor_renewal_unattached_uploads() u
    ) e where e.value->>'retention_state'='quarantined'),'[]'::jsonb),
  'unattached_kept',coalesce((select jsonb_agg(e.value order by e.value->>'uploaded_at',e.value->>'path') from (
      select private.vendor_renewal_upload_json(u.path,u.contractor_id,u.uploaded_at) as value
      from private.vendor_renewal_unattached_uploads() u
      where private.vendor_application_file_bound(u.path)
    ) e),'[]'::jsonb),
  'holds',coalesce((select jsonb_agg(jsonb_build_object('contractor_id',o.contractor_id,'name',c.name,'reason',h.reason,'placed_at',h.placed_at)
      order by h.placed_at,o.contractor_id)
    from public.vendor_onboarding o
    join public.contractors c on c.id=o.contractor_id
    cross join lateral private.vendor_retention_hold(o.contractor_id) h),'[]'::jsonb));
end $$;

-- TRACE-073's submission, unchanged except that an upload 7 days old or older is refused,
-- 2 hours before retention may quarantine it, so a submission never races a quarantine.
-- Replays of a recorded submission are unaffected.
create or replace function public.vendor_submit_renewal_document(p_path text,p_contractor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record; prior public.vendor_renewal_documents; parts text[]; object_metadata jsonb; object_created timestamptz;
  size_value bigint; mime_value text; result uuid;
begin
 select * into strict s from private.vendor_renewal_submitter(p_contractor);
 -- Serialises submissions per provider so the open limit is exact.
 perform 1 from public.vendor_onboarding o where o.contractor_id=s.contractor_id for update;
 select * into prior from public.vendor_renewal_documents d where d.storage_path=p_path;
 if found then
   if prior.contractor_id<>s.contractor_id or prior.submitted_by<>s.actor then raise exception 'Renewal document already submitted'; end if;
   return jsonb_build_object('document_id',prior.id,'contractor_id',prior.contractor_id,'kind',prior.kind,'submitted_as',prior.submitted_as,'recorded',false);
 end if;
 parts:=regexp_match(coalesce(p_path,''),'^renewals/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(license|insurance)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif))$');
 if parts is null or parts[1]<>s.contractor_id::text then raise exception 'Document path does not belong to this provider'; end if;
 select o.metadata,o.created_at into object_metadata,object_created from storage.objects o where o.bucket_id='vendor-documents' and o.name=p_path;
 if not found then raise exception 'Uploaded document not found'; end if;
 if object_created<=now()-make_interval(days=>private.vendor_unattached_upload_days()) then
   raise exception 'This upload has expired; upload the document again';
 end if;
 size_value:=case when coalesce(object_metadata->>'size','') ~ '^[0-9]{1,12}$' then (object_metadata->>'size')::bigint end;
 mime_value:=lower(coalesce(object_metadata->>'mimetype',''));
 if size_value is null or size_value<=0 or size_value>10485760
   or mime_value not in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif') then
   raise exception 'Uploaded document failed verification';
 end if;
 if (select count(*) from public.vendor_renewal_documents d where d.contractor_id=s.contractor_id and d.kind=parts[2]
     and not exists(select 1 from public.vendor_renewal_document_decisions x where x.document_id=d.id))>=private.vendor_renewal_open_limit() then
   raise exception 'Too many renewal documents are awaiting review';
 end if;
 insert into public.vendor_renewal_documents(contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
   values(s.contractor_id,parts[2],p_path,parts[3],mime_value,size_value,s.actor,s.submitted_as) returning id into result;
 -- A submission is a file only: no evidence, status, revision, role or listing.
 return jsonb_build_object('document_id',result,'contractor_id',s.contractor_id,'kind',parts[2],'submitted_as',s.submitted_as,'recorded',true);
end $$;

revoke all on function private.vendor_renewal_upload_pattern(),
 private.vendor_renewal_upload_contractor(text),
 private.vendor_renewal_unattached_uploads(uuid),
 private.vendor_renewal_upload_retention_state(text),
 private.vendor_renewal_upload_retention_refusal(text,text),
 private.vendor_renewal_upload_retention_replay(text,text,text,text,uuid),
 private.vendor_evidence_renewal_upload_retention_guard(),
 private.vendor_renewal_upload_json(text,uuid,timestamptz)
 from public,anon,authenticated,service_role;
revoke all on function public.vendor_renewal_upload_retention_prepare(text,text,text,text),
 public.vendor_renewal_upload_retention_record(text,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_renewal_upload_retention_prepare(text,text,text,text),
 public.vendor_renewal_upload_retention_record(text,text,text,text)
 to authenticated;
-- create or replace keeps the grants on vendor_document_retention_queue and
-- vendor_submit_renewal_document.
