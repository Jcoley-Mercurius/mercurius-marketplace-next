-- TRACE-061: reviewed existing-provider cutover and category/jurisdiction requirements.
create table public.vendor_compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references public.services_catalog(id),
  zip_code text not null references public.coverage_areas(zip_code),
  kind text not null check(kind in ('license','insurance')),
  requirement_version text not null check(length(btrim(requirement_version))>0),
  description text not null check(length(btrim(description))>0),
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check(expires_at is null or expires_at>effective_at),
  unique(service_id,zip_code,kind,requirement_version)
);
create table public.vendor_requirement_evidence (
  requirement_id uuid not null references public.vendor_compliance_requirements(id),
  evidence_id uuid not null unique references public.vendor_compliance_evidence(id),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  bound_by uuid not null references auth.users(id),
  bound_at timestamptz not null default now(),
  primary key(requirement_id,contractor_id)
);
create table public.vendor_cutover_decisions (
  contractor_id uuid primary key references public.contractors(id),
  disposition text not null check(disposition in ('included','excluded')),
  onboarding_revision integer,
  reason text not null check(length(btrim(reason))>0),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  check((disposition='included')=(onboarding_revision is not null))
);
create table public.vendor_cutover_control (
  singleton boolean primary key default true check(singleton),
  enforced boolean not null default false,
  finalized_by uuid references auth.users(id),
  finalized_at timestamptz,
  reason text,
  check((not enforced and finalized_by is null and finalized_at is null and reason is null)
    or (enforced and finalized_by is not null and finalized_at is not null and length(btrim(reason))>0))
);
insert into public.vendor_cutover_control(singleton) values(true);

create function public.vendor_category_evidence_current(p_contractor uuid,p_at timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  with scopes as (
    select distinct package.service_id,service_zip.zip_code
    from public.vendor_packages package
    join public.contractor_service_zips service_zip on service_zip.contractor_id=package.contractor_id
    where package.contractor_id=p_contractor and package.is_active and package.needs_review is not true
  ), required as (
    select scope.service_id,scope.zip_code,kind
    from scopes scope cross join unnest(array['license','insurance']) kind
  )
  select exists(select 1 from scopes)
    and not exists (
      select 1 from required needed
      where not exists (
        select 1 from public.vendor_compliance_requirements requirement
        join public.vendor_requirement_evidence binding
          on binding.requirement_id=requirement.id and binding.contractor_id=p_contractor
        join public.vendor_compliance_evidence evidence on evidence.id=binding.evidence_id
        join public.vendor_onboarding onboarding on onboarding.contractor_id=p_contractor
        where requirement.service_id=needed.service_id and requirement.zip_code=needed.zip_code
          and requirement.kind=needed.kind and requirement.effective_at<=p_at
          and (requirement.expires_at is null or requirement.expires_at>p_at)
          and evidence.kind=needed.kind and evidence.contractor_id=p_contractor
          and evidence.application_version_id=onboarding.application_version_id
          and evidence.requirement_version=requirement.requirement_version
          and evidence.accepted_at<=p_at and (evidence.expires_at is null or evidence.expires_at>p_at)
          and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=evidence.id)
      )
    )
$$;

create function public.vendor_bind_requirement_evidence(p_contractor uuid,p_requirement uuid,p_evidence uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; requirement public.vendor_compliance_requirements; evidence public.vendor_compliance_evidence;
begin
  actor:=public.vendor_require_operator();
  select * into strict requirement from public.vendor_compliance_requirements where id=p_requirement;
  select * into strict evidence from public.vendor_compliance_evidence where id=p_evidence;
  if evidence.contractor_id<>p_contractor or evidence.kind<>requirement.kind
    or evidence.requirement_version<>requirement.requirement_version then
    raise exception 'Evidence does not satisfy requirement';
  end if;
  if evidence.application_version_id is distinct from
    (select application_version_id from public.vendor_onboarding where contractor_id=p_contractor)
    or evidence.accepted_at>now() or (evidence.expires_at is not null and evidence.expires_at<=now())
    or exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=evidence.id) then
    raise exception 'Current application evidence required';
  end if;
  if not exists(select 1 from public.vendor_packages package
      join public.contractor_service_zips service_zip on service_zip.contractor_id=package.contractor_id
      where package.contractor_id=p_contractor and package.service_id=requirement.service_id
        and service_zip.zip_code=requirement.zip_code and package.is_active and package.needs_review is not true) then
    raise exception 'Requirement is outside provider service area';
  end if;
  insert into public.vendor_requirement_evidence(requirement_id,evidence_id,contractor_id,bound_by)
    values(p_requirement,p_evidence,p_contractor,actor)
    on conflict(requirement_id,contractor_id) do nothing;
  if not exists(select 1 from public.vendor_requirement_evidence where requirement_id=p_requirement
      and contractor_id=p_contractor and evidence_id=p_evidence) then
    raise exception 'Requirement evidence conflict';
  end if;
end $$;

create function public.vendor_record_cutover_decision(p_contractor uuid,p_disposition text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; revision integer;
begin
  actor:=public.vendor_require_operator();
  if p_disposition not in ('included','excluded') or length(btrim(coalesce(p_reason,'')))=0 then
    raise exception 'Reviewed cutover decision and reason required';
  end if;
  if p_disposition='included' then
    select onboarding.revision into revision from public.vendor_onboarding onboarding
      where onboarding.contractor_id=p_contractor and onboarding.status='active';
    if revision is null or not public.vendor_is_eligible(p_contractor)
      or not public.vendor_category_evidence_current(p_contractor,now()) then
      raise exception 'Included provider requirements incomplete or expired';
    end if;
  end if;
  insert into public.vendor_cutover_decisions(contractor_id,disposition,onboarding_revision,reason,reviewed_by)
    values(p_contractor,p_disposition,revision,btrim(p_reason),actor)
    on conflict(contractor_id) do nothing;
  if not exists(select 1 from public.vendor_cutover_decisions where contractor_id=p_contractor
      and disposition=p_disposition and reason=btrim(p_reason) and reviewed_by=actor
      and onboarding_revision is not distinct from revision) then
    raise exception 'Cutover decision conflict';
  end if;
end $$;

create function public.vendor_finalize_cutover(p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=public.vendor_require_operator();
  if length(btrim(coalesce(p_reason,'')))=0 then raise exception 'Cutover reason required'; end if;
  if exists(select 1 from public.contractors contractor
    where contractor.is_active and contractor.marketing_enabled
      and not exists(select 1 from public.vendor_cutover_decisions decision where decision.contractor_id=contractor.id)) then
    raise exception 'Every participating provider requires a cutover decision';
  end if;
  if exists(select 1 from public.vendor_cutover_decisions decision
    where decision.disposition='included' and (not public.vendor_is_eligible(decision.contractor_id)
      or not public.vendor_category_evidence_current(decision.contractor_id,now()))) then
    raise exception 'Included provider requirements incomplete or expired';
  end if;
  update public.vendor_cutover_control set enforced=true,finalized_by=actor,finalized_at=now(),reason=btrim(p_reason)
    where singleton and not enforced;
end $$;

create or replace function private.vendor_matching_eligible(_contractor_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select case when (select enforced from public.vendor_cutover_control where singleton)
    then exists(select 1 from public.vendor_cutover_decisions decision
      where decision.contractor_id=_contractor_id and decision.disposition='included')
      and public.vendor_is_eligible(_contractor_id)
      and public.vendor_category_evidence_current(_contractor_id,now())
    when exists(select 1 from public.vendor_onboarding onboarding where onboarding.contractor_id=_contractor_id)
      then public.vendor_is_eligible(_contractor_id)
    else exists(select 1 from public.contractors contractor
      where contractor.id=_contractor_id and contractor.is_active is true)
  end
$$;

do $$ declare t text; begin
  foreach t in array array['vendor_compliance_requirements','vendor_requirement_evidence','vendor_cutover_decisions','vendor_cutover_control'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
  foreach t in array array['vendor_compliance_requirements','vendor_requirement_evidence','vendor_cutover_decisions'] loop
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;
revoke all on function public.vendor_category_evidence_current(uuid,timestamptz),
 public.vendor_bind_requirement_evidence(uuid,uuid,uuid),
 public.vendor_record_cutover_decision(uuid,text,text),
 public.vendor_finalize_cutover(text) from public,anon,authenticated,service_role;
grant execute on function public.vendor_bind_requirement_evidence(uuid,uuid,uuid),
 public.vendor_record_cutover_decision(uuid,text,text),public.vendor_finalize_cutover(text) to authenticated;
grant execute on function public.vendor_category_evidence_current(uuid,timestamptz) to service_role;
