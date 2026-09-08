-- TRACE-062: operator-safe read model and private evidence binding workflow.
create function public.vendor_compliance_operations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=public.vendor_require_operator();
  return jsonb_build_object(
    'evaluated_at',now(),
    'control',(select to_jsonb(c) from public.vendor_cutover_control c where singleton),
    'providers',coalesce((select jsonb_agg(row_data order by row_data->>'name') from (
      select jsonb_build_object(
        'id',c.id,'name',c.name,'active',c.is_active,'marketing_enabled',c.marketing_enabled,
        'onboarding_status',o.status,'onboarding_revision',o.revision,
        'application_id',v.application_id,'documents',coalesce(nullif(v.application->'document_urls','null'::jsonb),'[]'::jsonb),
        'generic_current',public.vendor_is_eligible(c.id),
        'scoped_current',public.vendor_category_evidence_current(c.id,now()),
        'decision',d.disposition,'decision_reason',d.reason,
        'service_ids',coalesce((select array_agg(distinct p.service_id) from public.vendor_packages p
          where p.contractor_id=c.id and p.is_active and p.needs_review is not true),'{}'::text[]),
        'zip_codes',coalesce((select array_agg(distinct z.zip_code) from public.contractor_service_zips z
          where z.contractor_id=c.id),'{}'::text[])
      ) row_data
      from public.contractors c
      left join public.vendor_onboarding o on o.contractor_id=c.id
      left join public.vendor_application_versions v on v.id=o.application_version_id
      left join public.vendor_applications a on a.id=v.application_id
      left join public.vendor_cutover_decisions d on d.contractor_id=c.id
      where c.is_active or c.marketing_enabled or o.contractor_id is not null or d.contractor_id is not null
    ) rows),'[]'::jsonb),
    'requirements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'service_id',r.service_id,'service_name',s.name,'zip_code',r.zip_code,
      'kind',r.kind,'version',r.requirement_version,'description',r.description,
      'effective_at',r.effective_at,'expires_at',r.expires_at
    ) order by s.name,r.zip_code,r.kind,r.effective_at desc)
      from public.vendor_compliance_requirements r
      join public.services_catalog s on s.id=r.service_id),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
        'id',e.id,'contractor_id',e.contractor_id,'kind',e.kind,
        'requirement_version',e.requirement_version,'evidence_ref',e.evidence_ref,
        'accepted_at',e.accepted_at,'expires_at',e.expires_at,
        'current',e.application_version_id=o.application_version_id
          and e.accepted_at<=now() and (e.expires_at is null or e.expires_at>now())
      )) from public.vendor_compliance_evidence e
      join public.vendor_onboarding o on o.contractor_id=e.contractor_id
      where e.kind in ('license','insurance')
        and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=e.id)), '[]'::jsonb),
    'bindings',coalesce((select jsonb_agg(jsonb_build_object(
      'requirement_id',b.requirement_id,'contractor_id',b.contractor_id,'evidence_id',b.evidence_id,
      'evidence_ref',e.evidence_ref,'accepted_at',e.accepted_at,'expires_at',e.expires_at,
      'current',e.application_version_id=o.application_version_id
        and e.accepted_at<=now() and (e.expires_at is null or e.expires_at>now())
        and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=e.id)
    )) from public.vendor_requirement_evidence b
      join public.vendor_compliance_evidence e on e.id=b.evidence_id
      join public.vendor_onboarding o on o.contractor_id=b.contractor_id),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
      from public.services_catalog s where s.is_active),'[]'::jsonb),
    'areas',coalesce((select jsonb_agg(jsonb_build_object('zip_code',a.zip_code,'city',a.city) order by a.zip_code)
      from public.coverage_areas a where a.is_active),'[]'::jsonb)
  );
end $$;

create function public.vendor_record_requirement_document(
  p_contractor uuid,p_requirement uuid,p_document_path text,p_accepted timestamptz,
  p_expires timestamptz,p_supersedes uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; requirement public.vendor_compliance_requirements; application_snapshot jsonb; evidence_id uuid; current_evidence public.vendor_compliance_evidence;
begin
  actor:=public.vendor_require_operator();
  select r.* into strict requirement from public.vendor_compliance_requirements r where r.id=p_requirement;
  select v.application into strict application_snapshot from public.vendor_onboarding o
    join public.vendor_application_versions v on v.id=o.application_version_id
    where o.contractor_id=p_contractor for update of o;
  if length(btrim(coalesce(p_document_path,'')))=0 or not coalesce(application_snapshot->'document_urls' ? p_document_path,false) then raise exception 'Document must belong to the current provider application'; end if;
  select e.* into current_evidence from public.vendor_compliance_evidence e
    where e.contractor_id=p_contractor and e.kind=requirement.kind
      and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=e.id);
  if current_evidence.evidence_ref=p_document_path
    and current_evidence.requirement_version=requirement.requirement_version
    and current_evidence.accepted_at=p_accepted and current_evidence.expires_at=p_expires
    and current_evidence.application_version_id=(select application_version_id from public.vendor_onboarding where contractor_id=p_contractor) then
    perform public.vendor_bind_requirement_evidence(p_contractor,p_requirement,current_evidence.id);
    return current_evidence.id;
  end if;
  evidence_id:=public.vendor_record_evidence(p_contractor,requirement.kind,
    requirement.requirement_version,p_document_path,p_accepted,p_expires,p_supersedes);
  perform public.vendor_bind_requirement_evidence(p_contractor,p_requirement,evidence_id);
  return evidence_id;
end $$;

revoke all on function public.vendor_compliance_operations(),
 public.vendor_record_requirement_document(uuid,uuid,text,timestamptz,timestamptz,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_compliance_operations(),
 public.vendor_record_requirement_document(uuid,uuid,text,timestamptz,timestamptz,uuid)
 to authenticated;
