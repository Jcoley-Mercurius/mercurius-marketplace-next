-- TRACE-084: CFG-011 retention for the documents of rejected or abandoned vendor
-- applications. TRACE-074 covered declined renewal documents only; application files
-- stayed in the private bucket indefinitely, a rejection was a direct status update with
-- no time, actor or reason, and nothing set an application abandoned.
--
-- Owner decisions (2026-09-23):
-- 1. The 90 days start at a recorded rejection: a reviewed closure command records the
--    actor, reason and time and replaces the direct status update. A provider rejected
--    through onboarding review (vendor_decide_onboarding) also starts the clock for the
--    documents of the application under review. A legacy rejection with no record is
--    not due until an operator records it; nothing is backfilled.
-- 2. Abandoned is recorded by an operator with a reason; there is no inactivity timer.
-- 3. A file referenced by any compliance evidence is never quarantined or deleted.
-- 4. Holds may be placed on an application; a TRACE-074 provider hold also covers the
--    documents of that provider's applications.
--
-- The TRACE-074 mechanics are reused unchanged: the same quarantine bucket, 90-day and
-- 14-day definitions, operator queue with no scheduler, and prepare (writes nothing) /
-- Storage API step / record (only what storage.objects shows).
--
-- Nothing here changes an application version, evidence, onboarding status, revision,
-- role, eligibility or listing. A closure changes only vendor_applications.status, which
-- is not part of the versioned application.

-- One row per recorded closure. The latest closure is in force while the application's
-- status still equals its outcome, so a status changed afterwards removes the documents
-- from retention (fail closed) rather than leaving a stale clock.
create table public.vendor_application_closures (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  application_id uuid not null references public.vendor_applications(id),
  outcome text not null check(outcome in ('rejected','abandoned')),
  before_status text not null,
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index vendor_application_closures_application on public.vendor_application_closures(application_id,sequence desc);

-- Application-level legal hold history. The latest event says whether a hold is in force.
create table public.vendor_application_retention_hold_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  application_id uuid not null references public.vendor_applications(id),
  action text not null check(action in ('placed','released')),
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index vendor_application_retention_hold_events_application on public.vendor_application_retention_hold_events(application_id,sequence desc);

-- Each confirmed retention step for one application file. Application files have no
-- recorded size, so a quarantine records the size storage shows and a restore must
-- bring back a file of that size.
create table public.vendor_application_retention_actions (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  application_id uuid not null references public.vendor_applications(id),
  storage_path text not null,
  action text not null check(action in ('quarantined','restored','deleted')),
  size_bytes bigint check(size_bytes>0),
  reason text not null check(length(btrim(reason))>0 and length(reason)<=1000),
  under_hold boolean not null,
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (storage_path like application_id::text||'/%'),
  check ((action='quarantined')=(size_bytes is not null))
);
create index vendor_application_retention_actions_path on public.vendor_application_retention_actions(storage_path,sequence desc);
create unique index vendor_application_retention_one_deletion on public.vendor_application_retention_actions(storage_path) where action='deleted';

alter table public.vendor_application_closures enable row level security;
alter table public.vendor_application_retention_hold_events enable row level security;
alter table public.vendor_application_retention_actions enable row level security;
revoke all on public.vendor_application_closures, public.vendor_application_retention_hold_events,
  public.vendor_application_retention_actions from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_application_closures
  for each row execute function public.money_immutable();
create trigger immutable_evidence before update or delete on public.vendor_application_retention_hold_events
  for each row execute function public.money_immutable();
create trigger immutable_evidence before update or delete on public.vendor_application_retention_actions
  for each row execute function public.money_immutable();

-- The application's files: every path any version or the current row lists, limited to
-- the form's own upload layout under the application's folder. Anything else is never
-- touched by retention.
create function private.vendor_application_files(p_application uuid)
returns setof text language sql stable security definer set search_path='' as $$
 select f.path from (
   select jsonb_array_elements_text(case when jsonb_typeof(v.application->'document_urls')='array'
       then v.application->'document_urls' else '[]'::jsonb end) as path
     from public.vendor_application_versions v where v.application_id=p_application
   union
   select unnest(coalesce(a.document_urls,'{}'::text[])) from public.vendor_applications a where a.id=p_application
 ) f
 where f.path ~ ('^'||p_application::text||'/(license|insurance|other)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif)$')
$$;

-- Providers attached to an application: the legacy link and any onboarding reviewing one
-- of its versions.
create function private.vendor_application_contractors(p_application uuid)
returns setof uuid language sql stable security definer set search_path='' as $$
 select a.contractor_id from public.vendor_applications a where a.id=p_application and a.contractor_id is not null
 union
 select o.contractor_id from public.vendor_onboarding o
   join public.vendor_application_versions v on v.id=o.application_version_id
 where v.application_id=p_application
$$;

-- The closure in force and when its clock started, or no row. A recorded closure counts
-- while the status still equals its outcome; an onboarding rejection counts from its
-- event. When both exist the later one is used, so retention is never shortened.
create function private.vendor_application_closure(p_application uuid)
returns table(outcome text,closed_at timestamptz,source text,reason text)
language sql stable security definer set search_path='' as $$
 select x.outcome,x.closed_at,x.source,x.reason from (
   select c.outcome,c.created_at as closed_at,'closure'::text as source,c.reason
     from public.vendor_application_closures c
     join public.vendor_applications a on a.id=c.application_id and a.status=c.outcome
   where c.application_id=p_application
     and c.sequence=(select max(l.sequence) from public.vendor_application_closures l where l.application_id=p_application)
   union all
   select 'rejected',(select max(e.created_at) from public.vendor_onboarding_events e
       where e.contractor_id=o.contractor_id and e.after_status='rejected'),'onboarding',
     (select e.reason from public.vendor_onboarding_events e
       where e.contractor_id=o.contractor_id and e.after_status='rejected' order by e.created_at desc limit 1)
     from public.vendor_onboarding o
     join public.vendor_application_versions v on v.id=o.application_version_id
   where v.application_id=p_application and o.status='rejected'
 ) x order by x.closed_at desc nulls last limit 1
$$;

-- The application hold in force, or no row.
create function private.vendor_application_hold(p_application uuid)
returns table(reason text,placed_at timestamptz,actor uuid)
language sql stable security definer set search_path='' as $$
 select e.reason,e.created_at,e.actor from public.vendor_application_retention_hold_events e
 where e.application_id=p_application
   and e.sequence=(select max(l.sequence) from public.vendor_application_retention_hold_events l where l.application_id=p_application)
   and e.action='placed'
$$;

-- Held by its own hold or by a TRACE-074 hold on an attached provider.
create function private.vendor_application_held(p_application uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.vendor_application_hold(p_application))
   or exists(select 1 from private.vendor_application_contractors(p_application) c
     cross join lateral private.vendor_retention_hold(c) h)
$$;

-- Where a file is according to the ledger, since when, and the size recorded when it was
-- last quarantined.
create function private.vendor_application_retention_state(p_path text)
returns table(state text,since timestamptz,size_bytes bigint)
language sql stable security definer set search_path='' as $$
 select coalesce((select case a.action when 'restored' then 'retained' else a.action end
     from public.vendor_application_retention_actions a where a.storage_path=p_path order by a.sequence desc limit 1),'retained'),
   (select a.created_at from public.vendor_application_retention_actions a where a.storage_path=p_path order by a.sequence desc limit 1),
   (select a.size_bytes from public.vendor_application_retention_actions a where a.storage_path=p_path and a.action='quarantined' order by a.sequence desc limit 1)
$$;

create function private.vendor_application_file_bound(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vendor_compliance_evidence e where e.evidence_ref=p_path)
$$;

-- Ledger preconditions for one step, shared by prepare and record. Returns the refusal
-- message, or null when the step may proceed. Holds are checked by the callers.
-- Quarantine and deletion both need the closure in force and its 90 days passed, so a
-- reopened or newly closed application never loses a file early; restoring needs only
-- the file to be in quarantine.
create function private.vendor_application_retention_refusal(p_application uuid,p_path text,p_action text)
returns text language plpgsql stable security definer set search_path='' as $$
declare r record; c record;
begin
 if not exists(select 1 from public.vendor_applications a where a.id=p_application) then return 'Application not found'; end if;
 if p_path is null or not exists(select 1 from private.vendor_application_files(p_application) f where f=p_path) then
   return 'Document does not belong to this application';
 end if;
 select * into strict r from private.vendor_application_retention_state(p_path);
 if r.state='deleted' then return 'Application document already deleted'; end if;
 if p_action not in ('quarantined','restored','deleted') then return 'Unknown retention action'; end if;
 if p_action='restored' then
   if r.state<>'quarantined' then return 'Application document is not in quarantine'; end if;
   return null;
 end if;
 if p_action='quarantined' and r.state<>'retained' then return 'Application document already quarantined'; end if;
 if p_action='deleted' and r.state<>'quarantined' then return 'Application document must be quarantined before deletion'; end if;
 if private.vendor_application_file_bound(p_path) then return 'Documents bound to compliance evidence are kept'; end if;
 select * into c from private.vendor_application_closure(p_application);
 if not found then return 'Only documents of a rejected or abandoned application are subject to retention'; end if;
 if c.closed_at is null or c.closed_at>now()-make_interval(days=>private.vendor_document_retention_days()) then
   return 'Documents of a closed application are kept for '||private.vendor_document_retention_days()||' days';
 end if;
 if p_action='deleted' and r.since>now()-make_interval(days=>private.vendor_document_quarantine_days()) then
   return 'Quarantined documents are kept for '||private.vendor_document_quarantine_days()||' days before deletion';
 end if;
 return null;
end $$;

-- Replay of a recorded step under the same key. Null when the key is unused; refuses a
-- key reused for anything else.
create function private.vendor_application_retention_replay(p_key text,p_application uuid,p_path text,p_action text,p_reason text,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior public.vendor_application_retention_actions;
begin
 select * into prior from public.vendor_application_retention_actions where business_key=p_key;
 if not found then return null; end if;
 if prior.application_id<>p_application or prior.storage_path is distinct from p_path or prior.action<>p_action
   or prior.actor<>p_actor or prior.reason<>btrim(coalesce(p_reason,'')) then
   raise exception 'Retention idempotency conflict';
 end if;
 return jsonb_build_object('application_id',p_application,'storage_path',p_path,'action',p_action,'under_hold',prior.under_hold,'recorded',false);
end $$;

-- Records a rejection or abandonment. Replaces the direct status update for applications
-- with no provider; an application under onboarding review is decided there. A legacy
-- status with no record can be recorded with the same outcome, starting its clock now.
create function public.vendor_close_application(p_application uuid,p_outcome text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; app public.vendor_applications; prior public.vendor_application_closures; closure public.vendor_application_closures;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 select * into app from public.vendor_applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 select * into prior from public.vendor_application_closures where business_key=p_key;
 if found then
   if prior.application_id<>p_application or prior.outcome is distinct from p_outcome or prior.actor<>actor
     or prior.reason<>btrim(coalesce(p_reason,'')) then
     raise exception 'Closure idempotency conflict';
   end if;
   return jsonb_build_object('application_id',p_application,'outcome',prior.outcome,'closed_at',prior.created_at,'recorded',false);
 end if;
 if p_outcome is null or p_outcome not in ('rejected','abandoned') then raise exception 'Choose rejected or abandoned'; end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 if length(p_reason)>1000 then raise exception 'Reason must be 1000 characters or fewer'; end if;
 if exists(select 1 from private.vendor_application_contractors(p_application)) then
   raise exception 'This application has a provider record; decide it through onboarding review';
 end if;
 if exists(select 1 from private.vendor_application_closure(p_application)) then raise exception 'Application is already closed'; end if;
 if app.status not in ('pending','approved') and app.status<>p_outcome then
   raise exception 'Only a pending or approved application can be closed';
 end if;
 insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor)
   values(p_application,p_outcome,app.status,btrim(p_reason),p_key,actor) returning * into closure;
 update public.vendor_applications set status=p_outcome where id=p_application and status is distinct from p_outcome;
 return jsonb_build_object('application_id',p_application,'outcome',p_outcome,'closed_at',closure.created_at,'recorded',true);
end $$;

-- Pre-check for the retention route before it touches storage. Writes nothing. A hold
-- refuses a new quarantine or a deletion unless storage already shows that step
-- complete, so the retry records what happened, marked under hold. Restoring is always
-- allowed. A key already recorded for this exact step returns replay=true.
create function public.vendor_application_retention_prepare(p_application uuid,p_path text,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 return jsonb_build_object('application_id',p_application,'action',p_action,'replay',replay is not null,'storage_path',p_path,
   'from_bucket',case when p_action='quarantined' then 'vendor-documents' else 'vendor-documents-quarantine' end,
   'to_bucket',case p_action when 'quarantined' then 'vendor-documents-quarantine' when 'restored' then 'vendor-documents' end);
end $$;

-- Records a retention step only when storage shows it happened. Locks attached providers'
-- onboarding rows and then the application, the order evidence recording uses, so it
-- serialises with provider and application holds, closures and evidence.
create function public.vendor_application_retention_record(p_application uuid,p_path text,p_action text,p_reason text,p_key text)
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
   raise exception 'Storage still holds this document';
 end if;

 held:=private.vendor_application_held(p_application);
 begin
   insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor)
     values(p_application,p_path,p_action,recorded_size,btrim(p_reason),held,p_key,actor);
 exception when unique_violation then
   raise exception 'Retention idempotency conflict';
 end;
 return jsonb_build_object('application_id',p_application,'storage_path',p_path,'action',p_action,'under_hold',held,'recorded',true);
end $$;

-- Places or releases an application's retention hold. Reason and key required; only the
-- exact request replays. Releasing requires a hold in force, placing requires none.
create function private.vendor_change_application_retention_hold(p_application uuid,p_action text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; prior public.vendor_application_retention_hold_events; held boolean;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 perform 1 from public.vendor_applications a where a.id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 select * into prior from public.vendor_application_retention_hold_events where business_key=p_key;
 if found then
   if prior.application_id<>p_application or prior.action<>p_action or prior.actor<>actor or prior.reason<>btrim(coalesce(p_reason,'')) then
     raise exception 'Retention hold idempotency conflict';
   end if;
   return jsonb_build_object('application_id',p_application,'action',p_action,'recorded',false);
 end if;
 if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'A reason is required'; end if;
 if length(p_reason)>1000 then raise exception 'Reason must be 1000 characters or fewer'; end if;
 held:=exists(select 1 from private.vendor_application_hold(p_application));
 if p_action='placed' and held then raise exception 'This application is already on a retention hold'; end if;
 if p_action='released' and not held then raise exception 'This application has no retention hold'; end if;
 insert into public.vendor_application_retention_hold_events(application_id,action,reason,business_key,actor)
   values(p_application,p_action,btrim(p_reason),p_key,actor);
 return jsonb_build_object('application_id',p_application,'action',p_action,'recorded',true);
end $$;

create function public.vendor_place_application_retention_hold(p_application uuid,p_reason text,p_key text)
returns jsonb language sql security definer set search_path='' as $$
 select private.vendor_change_application_retention_hold(p_application,'placed',p_reason,p_key) $$;
create function public.vendor_release_application_retention_hold(p_application uuid,p_reason text,p_key text)
returns jsonb language sql security definer set search_path='' as $$
 select private.vendor_change_application_retention_hold(p_application,'released',p_reason,p_key) $$;

-- A file of a closed application, or one out of document storage by retention, cannot
-- become evidence. Freezes the evidence set a retention step checks, whichever command
-- records the evidence. Shares the application lock the retention record takes.
create function private.vendor_evidence_application_retention_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare application_id uuid;
begin
 if new.evidence_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
   application_id:=substr(new.evidence_ref,1,36)::uuid;
   perform 1 from public.vendor_applications a where a.id=application_id for share;
   if found and exists(select 1 from private.vendor_application_closure(application_id)) then
     raise exception 'Documents of a rejected or abandoned application cannot become evidence';
   end if;
   if exists(select 1 from private.vendor_application_retention_state(new.evidence_ref) s where s.state<>'retained') then
     raise exception 'A document in retention quarantine cannot become evidence';
   end if;
 end if;
 return new;
end $$;
create trigger vendor_evidence_application_retention before insert on public.vendor_compliance_evidence
  for each row execute function private.vendor_evidence_application_retention_guard();

-- Retention fields for one application file, for operator readbacks only.
create function private.vendor_application_file_json(p_application uuid,p_path text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('application_id',a.id,'business_name',a.business_name,'application_status',a.status,
   'path',p_path,'kind',split_part(p_path,'/',2),
   'file_name',regexp_replace(split_part(p_path,'/',3),'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-',''),
   'closure_outcome',c.outcome,'closed_at',c.closed_at,'closure_source',c.source,
   'retention_ends_at',c.closed_at+make_interval(days=>private.vendor_document_retention_days()),
   'retention_state',s.state,'retention_since',s.since,
   'quarantine_ends_at',case when s.state='quarantined' then s.since+make_interval(days=>private.vendor_document_quarantine_days()) end,
   'object_location',private.vendor_renewal_object_location(p_path),
   'bound_to_evidence',private.vendor_application_file_bound(p_path),
   'held',private.vendor_application_held(a.id))
 from public.vendor_applications a
 left join lateral private.vendor_application_closure(a.id) c on true
 cross join lateral private.vendor_application_retention_state(p_path) s
 where a.id=p_application
$$;

-- Operator readback of application retention work, oldest first. Writes nothing.
-- due: closed at least 90 days ago, still retained and not bound to evidence (held
-- applications included, marked held); quarantined: in quarantine; kept: files of closed
-- applications bound to evidence; unrecorded: rejected or abandoned statuses with no
-- closure in force, whose files are not due; holds: applications with a hold in force.
create function public.vendor_application_retention_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'evaluated_at',now(),
  'retention_days',private.vendor_document_retention_days(),
  'quarantine_days',private.vendor_document_quarantine_days(),
  'due',coalesce((select jsonb_agg(e.value order by e.value->>'closed_at',e.value->>'path') from (
      select private.vendor_application_file_json(a.id,f) as value
      from public.vendor_applications a
      cross join lateral private.vendor_application_closure(a.id) c
      cross join lateral private.vendor_application_files(a.id) f
      where c.closed_at<=now()-make_interval(days=>private.vendor_document_retention_days())
    ) e where e.value->>'retention_state'='retained' and not (e.value->>'bound_to_evidence')::boolean),'[]'::jsonb),
  'quarantined',coalesce((select jsonb_agg(e.value order by e.value->>'retention_since',e.value->>'path') from (
      select private.vendor_application_file_json(p.application_id,p.storage_path) as value
      from (select distinct application_id,storage_path from public.vendor_application_retention_actions) p
    ) e where e.value->>'retention_state'='quarantined'),'[]'::jsonb),
  'kept',coalesce((select jsonb_agg(e.value order by e.value->>'closed_at',e.value->>'path') from (
      select private.vendor_application_file_json(a.id,f) as value
      from public.vendor_applications a
      cross join lateral private.vendor_application_closure(a.id) c
      cross join lateral private.vendor_application_files(a.id) f
      where private.vendor_application_file_bound(f)
    ) e),'[]'::jsonb),
  'unrecorded',coalesce((select jsonb_agg(jsonb_build_object('application_id',a.id,'business_name',a.business_name,'status',a.status,
        'has_provider',exists(select 1 from private.vendor_application_contractors(a.id)))
      order by a.created_at,a.id)
    from public.vendor_applications a
    where a.status in ('rejected','abandoned') and not exists(select 1 from private.vendor_application_closure(a.id))),'[]'::jsonb),
  'holds',coalesce((select jsonb_agg(jsonb_build_object('application_id',a.id,'business_name',a.business_name,'reason',h.reason,'placed_at',h.placed_at)
      order by h.placed_at,a.id)
    from public.vendor_applications a
    cross join lateral private.vendor_application_hold(a.id) h),'[]'::jsonb));
end $$;

-- Operator readback for one application: its closure, whether it can be closed here,
-- its holds and each file's retention fields. Writes nothing.
create function public.vendor_application_retention_overview(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare app public.vendor_applications; has_provider boolean; closure jsonb;
begin
 perform public.vendor_require_operator();
 select * into app from public.vendor_applications where id=p_application;
 if not found then raise exception 'Application not found'; end if;
 has_provider:=exists(select 1 from private.vendor_application_contractors(p_application));
 select jsonb_build_object('outcome',c.outcome,'closed_at',c.closed_at,'source',c.source,'reason',c.reason) into closure
   from private.vendor_application_closure(p_application) c;
 return jsonb_build_object(
  'application_id',app.id,
  'application_status',app.status,
  'has_provider',has_provider,
  'closure',closure,
  'closable',not has_provider and closure is null,
  'close_outcomes',case when has_provider or closure is not null then '[]'::jsonb
    when app.status in ('pending','approved') then '["rejected","abandoned"]'::jsonb
    when app.status in ('rejected','abandoned') then jsonb_build_array(app.status)
    else '[]'::jsonb end,
  'retention_days',private.vendor_document_retention_days(),
  'quarantine_days',private.vendor_document_quarantine_days(),
  'hold',(select jsonb_build_object('reason',h.reason,'placed_at',h.placed_at) from private.vendor_application_hold(p_application) h),
  'provider_held',exists(select 1 from private.vendor_application_contractors(p_application) c cross join lateral private.vendor_retention_hold(c) h),
  'files',coalesce((select jsonb_agg(private.vendor_application_file_json(p_application,f) order by f)
    from private.vendor_application_files(p_application) f),'[]'::jsonb));
end $$;

revoke all on function private.vendor_application_files(uuid),
 private.vendor_application_contractors(uuid),
 private.vendor_application_closure(uuid),
 private.vendor_application_hold(uuid),
 private.vendor_application_held(uuid),
 private.vendor_application_retention_state(text),
 private.vendor_application_file_bound(text),
 private.vendor_application_retention_refusal(uuid,text,text),
 private.vendor_application_retention_replay(text,uuid,text,text,text,uuid),
 private.vendor_change_application_retention_hold(uuid,text,text,text),
 private.vendor_evidence_application_retention_guard(),
 private.vendor_application_file_json(uuid,text)
 from public,anon,authenticated,service_role;
revoke all on function public.vendor_close_application(uuid,text,text,text),
 public.vendor_application_retention_prepare(uuid,text,text,text,text),
 public.vendor_application_retention_record(uuid,text,text,text,text),
 public.vendor_place_application_retention_hold(uuid,text,text),
 public.vendor_release_application_retention_hold(uuid,text,text),
 public.vendor_application_retention_queue(),
 public.vendor_application_retention_overview(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_close_application(uuid,text,text,text),
 public.vendor_application_retention_prepare(uuid,text,text,text,text),
 public.vendor_application_retention_record(uuid,text,text,text,text),
 public.vendor_place_application_retention_hold(uuid,text,text),
 public.vendor_release_application_retention_hold(uuid,text,text),
 public.vendor_application_retention_queue(),
 public.vendor_application_retention_overview(uuid)
 to authenticated;
