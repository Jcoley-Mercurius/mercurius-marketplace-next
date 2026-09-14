-- TRACE-072: compliance expiry queue (MPS §9) for live providers' checklist evidence.
--
-- Owner decisions (2026-09-13):
--  * Evidence is "expiring" from 30 days before its expiry.
--  * Lapsed evidence is flagged only. Nothing here suspends a provider or changes an
--    onboarding status or revision. Matching eligibility already follows current
--    evidence (vendor_is_eligible, TRACE-053/060), as MPS §8 requires; that is unchanged.
--  * Renewed documents arriving outside the application are a separate follow-up slice.
--    Renewal is recorded through the existing TRACE-069 checklist command.
--
-- Read-only: no table, command, grant on a write path or scheduler is added.

create function private.vendor_renewal_notice() returns interval
language sql immutable set search_path='' as $$ select interval '30 days' $$;

-- The current evidence that needs renewal: the latest evidence per item, on the
-- reviewed application version, with an expiry inside the notice window or already
-- past. Live providers only; review and rejected providers are handled by onboarding.
create function private.vendor_renewal_items(p_contractor uuid,p_at timestamptz)
returns table(contractor_id uuid,onboarding_status text,onboarding_revision integer,kind text,evidence_id uuid,
  requirement_version text,accepted_at timestamptz,expires_at timestamptz,state text)
language sql stable set search_path='' as $$
  select o.contractor_id,o.status,o.revision,e.kind,e.id,e.requirement_version,e.accepted_at,e.expires_at,
    case when e.expires_at<=p_at then 'lapsed' else 'expiring' end
  from public.vendor_onboarding o
  join public.vendor_compliance_evidence e on e.contractor_id=o.contractor_id
    and e.application_version_id=o.application_version_id
  where o.status in ('active','suspended')
    and (p_contractor is null or o.contractor_id=p_contractor)
    and e.expires_at is not null and e.expires_at<=p_at+private.vendor_renewal_notice()
    and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=e.id)
$$;

-- Operator queue. Evidence references are omitted; the checklist panel shows them.
create function public.vendor_evidence_renewal_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now();
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'evaluated_at',at_value,
  'notice_days',extract(day from private.vendor_renewal_notice())::integer,
  'cutover_enforced',coalesce((select enforced from public.vendor_cutover_control where singleton),false),
  'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'contractor_id',i.contractor_id,
      'name',c.name,
      'onboarding_status',i.onboarding_status,
      'onboarding_revision',i.onboarding_revision,
      'eligible',public.vendor_is_eligible(i.contractor_id),
      'scoped_compliance_current',public.vendor_category_evidence_current(i.contractor_id,at_value),
      'kind',i.kind,
      'evidence_id',i.evidence_id,
      'requirement_version',i.requirement_version,
      'accepted_at',i.accepted_at,
      'expires_at',i.expires_at,
      'state',i.state
    ) order by i.expires_at,c.name,i.kind)
    from private.vendor_renewal_items(null,at_value) i
    join public.contractors c on c.id=i.contractor_id),'[]'::jsonb));
end $$;

-- The signed-in vendor's own renewal notices. Only the item, its expiry and state are
-- returned: no reference, requirement version, reviewer or other provider.
create function public.vendor_own_evidence_renewal()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now(); contractor uuid;
begin
 if auth.uid() is null or not public.has_role(auth.uid(),'vendor') then
   raise exception 'Vendor account required' using errcode='42501';
 end if;
 select id into contractor from public.contractors where user_id=auth.uid();
 return jsonb_build_object(
  'evaluated_at',at_value,
  'notice_days',extract(day from private.vendor_renewal_notice())::integer,
  'items',coalesce((select jsonb_agg(jsonb_build_object('kind',i.kind,'expires_at',i.expires_at,'state',i.state)
      order by i.expires_at,i.kind)
    from private.vendor_renewal_items(contractor,at_value) i where contractor is not null),'[]'::jsonb));
end $$;

-- TRACE-069 readback, unchanged except for the renewal notice: each item reports
-- renewal_due while it is current and inside the notice window.
create or replace function public.vendor_onboarding_checklist(p_contractor uuid)
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
  'renewal_notice_days',extract(day from private.vendor_renewal_notice())::integer,
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
        else 'current' end,
      'renewal_due',e.id is not null and e.application_version_id=o.application_version_id
        and e.expires_at is not null and e.expires_at>now()
        and e.expires_at<=now()+private.vendor_renewal_notice()
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

revoke all on function private.vendor_renewal_notice(),
 private.vendor_renewal_items(uuid,timestamptz),
 public.vendor_evidence_renewal_queue(),
 public.vendor_own_evidence_renewal()
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_evidence_renewal_queue(),
 public.vendor_own_evidence_renewal() to authenticated;
