-- TRACE-074: CFG-011 retention for declined renewal documents. A declined TRACE-073
-- submission is kept 90 days from its decline, then an operator may move the file to a
-- private quarantine bucket; after 14 days in quarantine an operator may delete it
-- permanently, and until then may restore it. A provider-level legal hold stops new
-- quarantines and permanent deletion for that provider.
--
-- Owner decisions (2026-09-15): scope is declined renewal files only, clock starting at
-- the decline; an operator runs each step from a queue (no scheduler); holds are
-- provider-level with a reason; quarantine for 14 days before permanent deletion.
--
-- Storage refuses direct deletes from SQL (storage.protect_objects_delete), so files move
-- through the Storage API in the application route. The database decides whether a step
-- may start (prepare, writes nothing) and records a step only after reading
-- storage.objects to confirm it happened (record). An interrupted request therefore
-- leaves nothing recorded and is finished by retrying, never by guessing.
--
-- Nothing here changes a submission, decision, evidence, onboarding status, revision,
-- eligibility, role or listing. Accepted, undecided and application documents are
-- never in scope.

-- Private quarantine bucket. No storage policy names it, so only the service key reaches
-- it; the 2026-07-31 admin policies are scoped to vendor-documents.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vendor-documents-quarantine','vendor-documents-quarantine',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- The single definitions of the CFG-011 period and the owner's quarantine grace period.
create function private.vendor_document_retention_days() returns integer language sql immutable set search_path='' as $$ select 90 $$;
create function private.vendor_document_quarantine_days() returns integer language sql immutable set search_path='' as $$ select 14 $$;

-- Provider legal hold history. The latest event says whether a hold is in force.
create table public.vendor_retention_hold_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  action text not null check(action in ('placed','released')),
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index vendor_retention_hold_events_contractor on public.vendor_retention_hold_events(contractor_id,sequence desc);

-- Each confirmed retention step for a declined renewal document. under_hold records a
-- hold that was placed between prepare and record, so that race is visible, not hidden.
create table public.vendor_renewal_retention_actions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  document_id uuid not null references public.vendor_renewal_documents(id),
  action text not null check(action in ('quarantined','restored','deleted')),
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  under_hold boolean not null,
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index vendor_renewal_retention_actions_document on public.vendor_renewal_retention_actions(document_id,sequence desc);
create unique index vendor_renewal_retention_one_deletion on public.vendor_renewal_retention_actions(document_id) where action='deleted';

alter table public.vendor_retention_hold_events enable row level security;
alter table public.vendor_renewal_retention_actions enable row level security;
revoke all on public.vendor_retention_hold_events, public.vendor_renewal_retention_actions
  from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_retention_hold_events
  for each row execute function public.money_immutable();
create trigger immutable_evidence before update or delete on public.vendor_renewal_retention_actions
  for each row execute function public.money_immutable();

-- The hold in force for a provider, or no row.
create function private.vendor_retention_hold(p_contractor uuid)
returns table(reason text,placed_at timestamptz,actor uuid)
language sql stable security definer set search_path='' as $$
 select e.reason,e.created_at,e.actor from public.vendor_retention_hold_events e
 where e.contractor_id=p_contractor
   and e.sequence=(select max(l.sequence) from public.vendor_retention_hold_events l where l.contractor_id=p_contractor)
   and e.action='placed'
$$;

-- Where a renewal document's file is according to the ledger: retained (never moved or
-- restored), quarantined or deleted, and since when.
create function private.vendor_renewal_retention_state(p_document uuid)
returns table(state text,since timestamptz)
language sql stable security definer set search_path='' as $$
 select coalesce((select case a.action when 'restored' then 'retained' else a.action end
     from public.vendor_renewal_retention_actions a where a.document_id=p_document order by a.sequence desc limit 1),'retained'),
   (select a.created_at from public.vendor_renewal_retention_actions a where a.document_id=p_document order by a.sequence desc limit 1)
$$;

-- Where the file actually is, read from storage: documents, quarantine, both or missing.
-- Shown to operators so a file removed or moved outside this workflow is visible.
create function private.vendor_renewal_object_location(p_path text)
returns text language sql stable security definer set search_path='' as $$
 select case
   when exists(select 1 from storage.objects o where o.bucket_id='vendor-documents' and o.name=p_path)
     then case when exists(select 1 from storage.objects q where q.bucket_id='vendor-documents-quarantine' and q.name=p_path) then 'both' else 'documents' end
   when exists(select 1 from storage.objects q where q.bucket_id='vendor-documents-quarantine' and q.name=p_path) then 'quarantine'
   else 'missing' end
$$;

-- Ledger preconditions for one step, shared by prepare and record. Returns the refusal
-- message, or null when the step may proceed. Holds are checked by the callers.
create function private.vendor_renewal_retention_refusal(p_document uuid,p_action text)
returns text language plpgsql stable security definer set search_path='' as $$
declare x public.vendor_renewal_document_decisions; r record;
begin
 if not exists(select 1 from public.vendor_renewal_documents d where d.id=p_document) then return 'Renewal document not found'; end if;
 select * into x from public.vendor_renewal_document_decisions where document_id=p_document;
 if not found or x.outcome<>'declined' then return 'Only declined renewal documents are subject to retention'; end if;
 select * into strict r from private.vendor_renewal_retention_state(p_document);
 if r.state='deleted' then return 'Renewal document already deleted'; end if;
 if p_action='quarantined' then
   if r.state<>'retained' then return 'Renewal document already quarantined'; end if;
   if x.created_at>now()-make_interval(days=>private.vendor_document_retention_days()) then
     return 'Declined documents are kept for '||private.vendor_document_retention_days()||' days';
   end if;
 elsif p_action='restored' then
   if r.state<>'quarantined' then return 'Renewal document is not in quarantine'; end if;
 elsif p_action='deleted' then
   if r.state<>'quarantined' then return 'Renewal document must be quarantined before deletion'; end if;
   if r.since>now()-make_interval(days=>private.vendor_document_quarantine_days()) then
     return 'Quarantined documents are kept for '||private.vendor_document_quarantine_days()||' days before deletion';
   end if;
 else
   return 'Unknown retention action';
 end if;
 return null;
end $$;

-- Replay of a recorded step under the same key. Null when the key is unused; refuses a
-- key reused for anything else.
create function private.vendor_renewal_retention_replay(p_key text,p_document uuid,p_action text,p_reason text,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior public.vendor_renewal_retention_actions;
begin
 select * into prior from public.vendor_renewal_retention_actions where business_key=p_key;
 if not found then return null; end if;
 if prior.document_id<>p_document or prior.action<>p_action or prior.actor<>p_actor or prior.reason<>btrim(coalesce(p_reason,'')) then
   raise exception 'Retention idempotency conflict';
 end if;
 return jsonb_build_object('document_id',p_document,'action',p_action,'under_hold',prior.under_hold,'recorded',false);
end $$;

-- Pre-check for the retention route before it touches storage. Writes nothing. Refuses
-- a new quarantine or a deletion while the provider is on hold; restoring is always
-- allowed. A hold does not refuse a step storage already shows complete (a request
-- interrupted before recording), so the retry records what happened, marked under hold.
-- A key already recorded for this exact step returns replay=true so the route skips
-- storage and records nothing new.
create function public.vendor_prepare_renewal_retention(p_document uuid,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 return jsonb_build_object('document_id',d.id,'action',p_action,'replay',replay is not null,'storage_path',d.storage_path,
   'from_bucket',case when p_action='quarantined' then 'vendor-documents' else 'vendor-documents-quarantine' end,
   'to_bucket',case p_action when 'quarantined' then 'vendor-documents-quarantine' when 'restored' then 'vendor-documents' end);
end $$;

-- Records a retention step only when storage shows it happened: quarantined means the
-- file is in quarantine and gone from the documents bucket, with the submitted size;
-- restored is the reverse; deleted means it is in neither bucket. Takes the provider's
-- onboarding lock, so it serialises with holds and with other steps.
create function public.vendor_record_renewal_retention(p_document uuid,p_action text,p_reason text,p_key text)
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
   raise exception 'Storage still holds this document';
 end if;

 held:=exists(select 1 from private.vendor_retention_hold(d.contractor_id));
 begin
   insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor)
     values(p_document,p_action,btrim(p_reason),held,p_key,actor);
 exception when unique_violation then
   raise exception 'Retention idempotency conflict';
 end;
 return jsonb_build_object('document_id',p_document,'action',p_action,'under_hold',held,'recorded',true);
end $$;

-- Places or releases a provider's retention hold. Reason and key required; only the
-- exact request replays. Releasing requires a hold in force, placing requires none.
create function private.vendor_change_retention_hold(p_contractor uuid,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; prior public.vendor_retention_hold_events; held boolean;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 perform 1 from public.vendor_onboarding o where o.contractor_id=p_contractor for update;
 if not found then raise exception 'Onboarding review required'; end if;
 select * into prior from public.vendor_retention_hold_events where business_key=p_key;
 if found then
   if prior.contractor_id<>p_contractor or prior.action<>p_action or prior.actor<>actor or prior.reason<>btrim(coalesce(p_reason,'')) then
     raise exception 'Retention hold idempotency conflict';
   end if;
   return jsonb_build_object('contractor_id',p_contractor,'action',p_action,'recorded',false);
 end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 held:=exists(select 1 from private.vendor_retention_hold(p_contractor));
 if p_action='placed' and held then raise exception 'This provider is already on a retention hold'; end if;
 if p_action='released' and not held then raise exception 'This provider has no retention hold'; end if;
 insert into public.vendor_retention_hold_events(contractor_id,action,reason,business_key,actor)
   values(p_contractor,p_action,btrim(p_reason),p_key,actor);
 return jsonb_build_object('contractor_id',p_contractor,'action',p_action,'recorded',true);
end $$;

create function public.vendor_place_retention_hold(p_contractor uuid,p_reason text,p_key text)
returns jsonb language sql security definer set search_path='' as $$
 select private.vendor_change_retention_hold(p_contractor,'placed',p_reason,p_key) $$;
create function public.vendor_release_retention_hold(p_contractor uuid,p_reason text,p_key text)
returns jsonb language sql security definer set search_path='' as $$
 select private.vendor_change_retention_hold(p_contractor,'released',p_reason,p_key) $$;

-- Retention fields for one declined document, for operator readbacks only.
create function private.vendor_renewal_retention_json(d public.vendor_renewal_documents)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('retention_state',r.state,'retention_since',r.since,
   'object_location',private.vendor_renewal_object_location(d.storage_path),
   'quarantine_ends_at',case when r.state='quarantined' then r.since+make_interval(days=>private.vendor_document_quarantine_days()) end,
   'retention_ends_at',x.created_at+make_interval(days=>private.vendor_document_retention_days()))
 from private.vendor_renewal_retention_state(d.id) r
 join public.vendor_renewal_document_decisions x on x.document_id=d.id and x.outcome='declined'
$$;

-- Operator readback of retention work, oldest first. Writes nothing.
-- due: declined at least 90 days ago and still in the documents bucket (held providers
-- included, marked held); quarantined: in quarantine with the date deletion opens;
-- holds: providers with a hold in force.
create function public.vendor_document_retention_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'evaluated_at',now(),
  'retention_days',private.vendor_document_retention_days(),
  'quarantine_days',private.vendor_document_quarantine_days(),
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
  'holds',coalesce((select jsonb_agg(jsonb_build_object('contractor_id',o.contractor_id,'name',c.name,'reason',h.reason,'placed_at',h.placed_at)
      order by h.placed_at,o.contractor_id)
    from public.vendor_onboarding o
    join public.contractors c on c.id=o.contractor_id
    cross join lateral private.vendor_retention_hold(o.contractor_id) h),'[]'::jsonb));
end $$;

-- The TRACE-073 operator overview, plus the provider's hold and each declined document's
-- retention fields so the checklist stops offering Open for a file that has moved.
create or replace function public.vendor_renewal_document_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',(select o.status from public.vendor_onboarding o where o.contractor_id=p_contractor),
  'open_limit',private.vendor_renewal_open_limit(),
  'retention_hold',(select jsonb_build_object('reason',h.reason,'placed_at',h.placed_at) from private.vendor_retention_hold(p_contractor) h),
  'documents',coalesce((select jsonb_agg(private.vendor_renewal_document_json(d,true) || coalesce(private.vendor_renewal_retention_json(d),'{}'::jsonb)
      order by d.created_at desc,d.id)
    from public.vendor_renewal_documents d where d.contractor_id=p_contractor),'[]'::jsonb));
end $$;

revoke all on function private.vendor_document_retention_days(),
 private.vendor_document_quarantine_days(),
 private.vendor_retention_hold(uuid),
 private.vendor_renewal_retention_state(uuid),
 private.vendor_renewal_object_location(text),
 private.vendor_renewal_retention_refusal(uuid,text),
 private.vendor_renewal_retention_replay(text,uuid,text,text,uuid),
 private.vendor_change_retention_hold(uuid,text,text,text),
 private.vendor_renewal_retention_json(public.vendor_renewal_documents)
 from public,anon,authenticated,service_role;
revoke all on function public.vendor_prepare_renewal_retention(uuid,text,text,text),
 public.vendor_record_renewal_retention(uuid,text,text,text),
 public.vendor_place_retention_hold(uuid,text,text),
 public.vendor_release_retention_hold(uuid,text,text),
 public.vendor_document_retention_queue()
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_prepare_renewal_retention(uuid,text,text,text),
 public.vendor_record_renewal_retention(uuid,text,text,text),
 public.vendor_place_retention_hold(uuid,text,text),
 public.vendor_release_retention_hold(uuid,text,text),
 public.vendor_document_retention_queue()
 to authenticated;
-- create or replace keeps the TRACE-073 grants on vendor_renewal_document_overview.
