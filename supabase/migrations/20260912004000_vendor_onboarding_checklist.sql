-- TRACE-069: operator checklist evidence and onboarding decisions for a provider under
-- review. Before this, no interface recorded the MPS §8 checklist or called
-- vendor_decide_onboarding, so activation (and the TRACE-068 role grant) was reachable
-- only from SQL.
--
-- Owner decision (2026-09-12): license and insurance are recorded against a document in
-- the reviewed application with an operator-entered expiry. The compliance workbench
-- binds them to service/ZIP requirements once packages exist; vendors create packages
-- only after activation, so requiring that binding first would make activation
-- unreachable. Strict matching still requires the scoped binding (TRACE-061).

create table public.vendor_checklist_evidence_requests (
  business_key text primary key check(length(btrim(business_key))>0),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  evidence_id uuid not null unique references public.vendor_compliance_evidence(id),
  kind text not null,
  requirement_version text not null,
  evidence_ref text not null,
  accepted_at timestamptz not null,
  expires_at timestamptz,
  supersedes uuid,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.vendor_checklist_evidence_requests enable row level security;
revoke all on public.vendor_checklist_evidence_requests from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_checklist_evidence_requests
 for each row execute function public.money_immutable();

-- Only the exact creating request replays. Volatile so the re-check under the
-- onboarding lock reads a fresh snapshot.
create function private.vendor_checklist_evidence_replay(p_key text,p_contractor uuid,p_kind text,p_requirement text,
  p_reference text,p_accepted timestamptz,p_expires timestamptz,p_supersedes uuid,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare prior public.vendor_checklist_evidence_requests;
begin
 select * into prior from public.vendor_checklist_evidence_requests where business_key=p_key;
 if not found then return null; end if;
 if prior.contractor_id<>p_contractor or prior.kind<>p_kind or prior.actor<>p_actor
   or prior.requirement_version is distinct from btrim(p_requirement)
   or prior.evidence_ref is distinct from btrim(p_reference)
   or prior.accepted_at is distinct from p_accepted or prior.expires_at is distinct from p_expires
   or prior.supersedes is distinct from p_supersedes then
   raise exception 'Checklist evidence idempotency conflict';
 end if;
 return jsonb_build_object('contractor_id',prior.contractor_id,'evidence_id',prior.evidence_id,'kind',prior.kind,'recorded',false);
end $$;

-- Optional trailing arguments default to null so the API can omit an absent expiry or
-- supersession by name. The key defaults only to stay trailing; a blank key is refused.
create function public.vendor_record_checklist_evidence(p_contractor uuid,p_kind text,p_requirement text,
  p_reference text,p_accepted timestamptz,p_expires timestamptz default null,p_supersedes uuid default null,p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; o public.vendor_onboarding; v public.vendor_application_versions; result uuid;
begin
 actor:=public.vendor_require_operator();
 replay:=private.vendor_checklist_evidence_replay(p_key,p_contractor,p_kind,p_requirement,p_reference,p_accepted,p_expires,p_supersedes,actor);
 if replay is not null then return replay; end if;
 select * into o from public.vendor_onboarding where contractor_id=p_contractor for update;
 if not found then raise exception 'Onboarding review required'; end if;
 replay:=private.vendor_checklist_evidence_replay(p_key,p_contractor,p_kind,p_requirement,p_reference,p_accepted,p_expires,p_supersedes,actor);
 if replay is not null then return replay; end if;

 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if p_kind is null or p_kind not in ('identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification') then
   raise exception 'Unknown checklist item';
 end if;
 if length(btrim(coalesce(p_requirement,'')))=0 or length(btrim(coalesce(p_reference,'')))=0 then
   raise exception 'Requirement version and evidence reference required';
 end if;
 if p_accepted is null then raise exception 'Review time required'; end if;
 if o.status='rejected' then raise exception 'A rejected provider takes no further evidence'; end if;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 if exists(select 1 from public.vendor_application_versions newer where newer.application_id=v.application_id and newer.revision>v.revision)
   or not exists(select 1 from public.vendor_applications app where app.id=v.application_id
     and app.contractor_id=p_contractor and app.status not in ('rejected','abandoned')) then
   raise exception 'Current application version required';
 end if;
 if p_kind in ('license','insurance') then
   -- The TRACE-062 document rule without its service/ZIP scope.
   if not coalesce(v.application->'document_urls' ? btrim(p_reference),false) then
     raise exception 'Document must belong to the current provider application';
   end if;
   if p_expires is null then raise exception 'License and insurance evidence requires an expiry'; end if;
 end if;

 -- The kernel enforces operator, freshness, expiry and the stale-supersede guard.
 result:=public.vendor_record_evidence(p_contractor,p_kind,btrim(p_requirement),btrim(p_reference),p_accepted,p_expires,p_supersedes);
 begin
   insert into public.vendor_checklist_evidence_requests(business_key,contractor_id,evidence_id,kind,requirement_version,
     evidence_ref,accepted_at,expires_at,supersedes,actor)
     values(p_key,p_contractor,result,p_kind,btrim(p_requirement),btrim(p_reference),p_accepted,p_expires,p_supersedes,actor);
 exception when unique_violation then
   -- The same key concurrently recorded evidence for another provider.
   raise exception 'Checklist evidence idempotency conflict';
 end;
 -- Recording evidence activates nothing, grants no role and changes no revision.
 return jsonb_build_object('contractor_id',p_contractor,'evidence_id',result,'kind',p_kind,'recorded',true);
end $$;

-- Operator readback for the checklist panel. Facts only: activation, renewal and the
-- role grant stay inside vendor_decide_onboarding. It writes nothing.
create function public.vendor_onboarding_checklist(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.vendor_onboarding; c public.contractors; v public.vendor_application_versions; link public.vendor_account_link_decisions;
begin
 perform public.vendor_require_operator();
 select * into o from public.vendor_onboarding where contractor_id=p_contractor;
 if not found then raise exception 'Onboarding record not found'; end if;
 select * into strict c from public.contractors where id=p_contractor;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 link:=private.vendor_reviewed_link(p_contractor);
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',o.status,
  'onboarding_revision',o.revision,
  'application_version_id',o.application_version_id,
  'version_current',not exists(select 1 from public.vendor_application_versions newer
    where newer.application_id=v.application_id and newer.revision>v.revision),
  'application_open',exists(select 1 from public.vendor_applications app where app.id=v.application_id
    and app.contractor_id=p_contractor and app.status not in ('rejected','abandoned')),
  'documents',coalesce(nullif(v.application->'document_urls','null'::jsonb),'[]'::jsonb),
  'checklist_current',public.vendor_evidence_current(p_contractor,now()),
  'eligible',public.vendor_is_eligible(p_contractor),
  'scoped_compliance_current',public.vendor_category_evidence_current(p_contractor,now()),
  'cutover_enforced',coalesce((select enforced from public.vendor_cutover_control where singleton),false),
  'account_linked',c.user_id is not null,
  'account_reviewed',link.business_key is not null,
  'account_email',case when link.business_key is not null then (select lower(btrim(u.email)) from auth.users u where u.id=c.user_id) end,
  'vendor_role_held',c.user_id is not null and exists(select 1 from public.user_roles r where r.user_id=c.user_id and r.role='vendor'),
  'evaluated_at',now(),
  'items',(select jsonb_agg(jsonb_build_object(
      'kind',k.kind,
      'evidence_id',e.id,
      'requirement_version',e.requirement_version,
      'evidence_ref',e.evidence_ref,
      'accepted_at',e.accepted_at,
      'expires_at',e.expires_at,
      'state',case when e.id is null then 'missing'
        when e.application_version_id<>o.application_version_id then 'superseded_version'
        when e.expires_at is not null and e.expires_at<=now() then 'expired'
        else 'current' end
    ) order by k.position)
    from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'])
      with ordinality as k(kind,position)
    left join lateral (select * from public.vendor_compliance_evidence e where e.contractor_id=p_contractor and e.kind=k.kind
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id)) e on true),
  'events',(select coalesce(jsonb_agg(jsonb_build_object(
      'revision',ev.revision,'action',ev.action,'before_status',ev.before_status,'after_status',ev.after_status,
      'reason',ev.reason,'created_at',ev.created_at) order by ev.revision desc),'[]'::jsonb)
    from public.vendor_onboarding_events ev where ev.contractor_id=p_contractor),
  'last_role_decision',(select jsonb_build_object('action',d.action,'outcome',d.outcome,'onboarding_revision',d.onboarding_revision,'created_at',d.created_at)
    from public.vendor_role_decisions d where d.contractor_id=p_contractor order by d.id desc limit 1));
end $$;

-- The raw evidence kernel accepted license and insurance from any operator client
-- without the document rule above. Clients now reach it only through the reviewed
-- commands (this one and TRACE-062's requirement document binding), which call it as
-- the function owner.
revoke execute on function public.vendor_record_evidence(uuid,text,text,text,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;

revoke all on function private.vendor_checklist_evidence_replay(text,uuid,text,text,text,timestamptz,timestamptz,uuid,uuid),
 public.vendor_record_checklist_evidence(uuid,text,text,text,timestamptz,timestamptz,uuid,text),
 public.vendor_onboarding_checklist(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_record_checklist_evidence(uuid,text,text,text,timestamptz,timestamptz,uuid,text),
 public.vendor_onboarding_checklist(uuid) to authenticated;
