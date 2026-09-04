-- Independent versioned onboarding. No email, Auth provisioning, role grant or legacy activation.
create table public.vendor_application_versions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.vendor_applications(id),
  revision integer not null,
  application jsonb not null,
  created_at timestamptz not null default now(),
  unique(application_id,revision)
);
create table public.vendor_onboarding (
  contractor_id uuid primary key references public.contractors(id),
  application_version_id uuid not null references public.vendor_application_versions(id),
  revision integer not null default 1,
  status text not null default 'review' check(status in ('review','active','suspended','rejected')),
  created_at timestamptz not null default now()
);
create table public.vendor_compliance_evidence (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  application_version_id uuid not null references public.vendor_application_versions(id),
  kind text not null check(kind in ('identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification')),
  requirement_version text not null check(length(trim(requirement_version))>0),
  evidence_ref text not null check(length(trim(evidence_ref))>0),
  expires_at timestamptz,
  accepted_at timestamptz not null,
  reviewed_by uuid not null references auth.users(id),
  supersedes uuid unique references public.vendor_compliance_evidence(id),
  created_at timestamptz not null default now(),
  check (kind not in ('license','insurance') or expires_at is not null),
  check (expires_at is null or expires_at>accepted_at)
);
create table public.vendor_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  revision integer not null,
  action text not null,
  before_status text not null,
  after_status text not null,
  actor uuid not null references auth.users(id),
  reason text not null check(length(trim(reason))>0),
  business_key text not null unique,
  evidence_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(contractor_id,revision)
);
create table public.vendor_invitation_attempts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  application_version_id uuid not null references public.vendor_application_versions(id),
  business_key text not null unique,
  status text not null default 'prepared' check(status in ('prepared','submitted','unknown','delivered','accepted','failed','expired','revoked')),
  provider_reference text unique,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index vendor_one_live_invitation on public.vendor_invitation_attempts(contractor_id)
  where status in ('prepared','submitted','unknown','delivered');
create table public.vendor_invitation_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.vendor_invitation_attempts(id),
  previous_status text not null,
  status text not null,
  evidence text not null check(length(trim(evidence))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create function public.vendor_record_application_version() returns trigger language plpgsql security definer set search_path='' as $$
declare document jsonb;
begin
  -- Intake terms are preserved privately. Operational invite/status fields do not create new applications.
  document:=to_jsonb(new)-array['status','contractor_id','invited_user_id','invite_status','invited_at','invite_expires_at','activated_at','invite_error','updated_at'];
  if tg_op='INSERT' or document is distinct from (to_jsonb(old)-array['status','contractor_id','invited_user_id','invite_status','invited_at','invite_expires_at','activated_at','invite_error','updated_at']) then
    insert into public.vendor_application_versions(application_id,revision,application)
      select new.id,coalesce(max(revision),0)+1,document from public.vendor_application_versions where application_id=new.id;
  end if;
  return new;
end $$;
create trigger vendor_version_intake after insert or update on public.vendor_applications
  for each row execute function public.vendor_record_application_version();

create function public.vendor_require_operator() returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(),'admin') then raise exception 'Onboarding operator required' using errcode='42501'; end if;
  return auth.uid();
end $$;
create function public.vendor_begin_review(p_contractor uuid,p_version uuid) returns void language plpgsql security definer set search_path='' as $$
declare application_id_value uuid; v public.vendor_onboarding; actor uuid;
begin
  actor:=public.vendor_require_operator();
  select application_id into strict application_id_value from public.vendor_application_versions where id=p_version;
  if not exists(select 1 from public.vendor_applications where id=application_id_value and contractor_id=p_contractor) then raise exception 'Application contractor link required'; end if;
  insert into public.vendor_onboarding(contractor_id,application_version_id) values(p_contractor,p_version) on conflict do nothing;
  select * into strict v from public.vendor_onboarding where contractor_id=p_contractor for update;
  if v.application_version_id<>p_version then
    if exists(select 1 from public.vendor_application_versions where application_id=application_id_value and revision>(select revision from public.vendor_application_versions where id=p_version)) then raise exception 'Latest application version required'; end if;
    insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key)
      values(p_contractor,v.revision+1,'application_revision',v.status,'review',actor,'New application revision requires vetting','application-revision:'||p_version);
    update public.vendor_onboarding set application_version_id=p_version,revision=revision+1,status='review' where contractor_id=p_contractor;
  end if;
end $$;

create function public.vendor_record_evidence(p_contractor uuid,p_kind text,p_requirement text,p_ref text,p_accepted timestamptz,p_expires timestamptz,p_supersedes uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result uuid; previous public.vendor_compliance_evidence;
begin
  actor:=public.vendor_require_operator();
  perform 1 from public.vendor_onboarding where contractor_id=p_contractor for update;
  if not found then raise exception 'Onboarding review required'; end if;
  if p_accepted>now() or (p_expires is not null and p_expires<=now()) then raise exception 'Current evidence required'; end if;
  select * into previous from public.vendor_compliance_evidence e where contractor_id=p_contractor and kind=p_kind
    and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  if previous.id is distinct from p_supersedes then raise exception 'Stale evidence version'; end if;
  insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by,supersedes)
    values(p_contractor,(select application_version_id from public.vendor_onboarding where contractor_id=p_contractor),p_kind,p_requirement,p_ref,p_accepted,p_expires,actor,p_supersedes) returning id into result;
  return result;
end $$;

create function public.vendor_evidence_current(p_contractor uuid,p_at timestamptz) returns boolean language sql stable security definer set search_path='' as $$
  select p_at is not null and exists(select 1 from public.vendor_onboarding o
    join public.vendor_application_versions v on v.id=o.application_version_id
    join public.vendor_applications a on a.id=v.application_id
    where o.contractor_id=p_contractor and a.contractor_id=p_contractor and a.status not in ('rejected','abandoned')
      and not exists(select 1 from public.vendor_application_versions n where n.application_id=v.application_id and n.revision>v.revision))
  and not exists (
    select 1 from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) requirement
    where not exists(select 1 from public.vendor_compliance_evidence e where e.contractor_id=p_contractor and e.kind=requirement
      and e.application_version_id=(select application_version_id from public.vendor_onboarding where contractor_id=p_contractor)
      and e.accepted_at<=p_at and (e.expires_at is null or e.expires_at>p_at)
      and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=e.id))
  )
$$;
create function public.vendor_is_eligible(p_contractor uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.vendor_onboarding where contractor_id=p_contractor and status='active')
    and public.vendor_evidence_current(p_contractor,now())
$$;

create function public.vendor_decide_onboarding(p_contractor uuid,p_expected_revision integer,p_action text,p_reason text,p_key text)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid; v public.vendor_onboarding; prior public.vendor_onboarding_events; next_status text; ids uuid[];
begin
  actor:=public.vendor_require_operator();
  select * into strict v from public.vendor_onboarding where contractor_id=p_contractor for update;
  select * into prior from public.vendor_onboarding_events where business_key=p_key;
  if found then
    if prior.contractor_id<>p_contractor or prior.actor<>actor or prior.reason<>p_reason or prior.action<>p_action then raise exception 'Onboarding idempotency conflict'; end if;
    return prior.revision;
  end if;
  if v.revision<>p_expected_revision then raise exception 'Stale onboarding revision'; end if;
  if p_action='activate' and v.status in ('review','suspended') then
    if not public.vendor_evidence_current(p_contractor,now()) then raise exception 'Activation checklist incomplete or expired'; end if;
    next_status:='active';
  elsif p_action='suspend' and v.status='active' then next_status:='suspended';
  elsif p_action='reject' and v.status='review' then next_status:='rejected';
  elsif p_action='renew' and v.status in ('active','suspended') then
    if not public.vendor_evidence_current(p_contractor,now()) then raise exception 'Renewal checklist incomplete or expired'; end if;
    next_status:=v.status; -- Renewal does not silently lift an operator suspension.
  else raise exception 'Invalid onboarding transition'; end if;
  select coalesce(array_agg(e.id order by e.kind),'{}') into ids from public.vendor_compliance_evidence e where e.contractor_id=p_contractor
    and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key,evidence_ids)
    values(p_contractor,v.revision+1,p_action,v.status,next_status,actor,p_reason,p_key,ids);
  update public.vendor_onboarding set status=next_status,revision=revision+1 where contractor_id=p_contractor;
  return v.revision+1;
end $$;

create function public.vendor_prepare_invitation(p_contractor uuid,p_key text,p_expires timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; v public.vendor_onboarding; a public.vendor_invitation_attempts;
begin
  actor:=public.vendor_require_operator();
  select * into strict v from public.vendor_onboarding where contractor_id=p_contractor for update;
  if v.status in ('suspended','rejected') then raise exception 'Invitation not permitted'; end if;
  select * into a from public.vendor_invitation_attempts where business_key=p_key;
  if found then
    if a.contractor_id<>p_contractor or a.application_version_id<>v.application_version_id or a.expires_at<>p_expires then raise exception 'Invitation idempotency conflict'; end if;
    return a.id;
  end if;
  if p_expires is null or p_expires<=now() then raise exception 'Provider-configured invitation expiry required'; end if;
  insert into public.vendor_invitation_attempts(contractor_id,application_version_id,business_key,expires_at,created_by)
    values(p_contractor,v.application_version_id,p_key,p_expires,actor) returning * into a;
  return a.id;
end $$;
create function public.vendor_record_invitation(p_attempt uuid,p_status text,p_ref text,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts;
begin
  actor:=public.vendor_require_operator();
  select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
  if not ((a.status='prepared' and p_status in ('submitted','revoked'))
    or (a.status in ('submitted','unknown') and p_status in ('unknown','delivered','failed','revoked'))
    or (a.status='delivered' and p_status in ('accepted','expired','revoked')))
    then raise exception 'Invalid invitation transition'; end if;
  if p_status='accepted' and a.expires_at<=now() then raise exception 'Invitation expired'; end if;
  if p_status='expired' and a.expires_at>now() then raise exception 'Invitation not expired'; end if;
  if p_ref is null or length(trim(p_ref))=0 then raise exception 'Invitation provider reference required'; end if;
  if a.provider_reference is not null and a.provider_reference<>p_ref then raise exception 'Invitation reference conflict'; end if;
  insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor) values(a.id,a.status,p_status,p_evidence,actor);
  update public.vendor_invitation_attempts set status=p_status,provider_reference=p_ref where id=a.id;
  -- Accepted invite is identity delivery evidence, not vendor activation or a role grant.
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['vendor_application_versions','vendor_onboarding','vendor_compliance_evidence','vendor_onboarding_events','vendor_invitation_attempts','vendor_invitation_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  foreach t in array array['vendor_application_versions','vendor_compliance_evidence','vendor_onboarding_events','vendor_invitation_events'] loop
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
  for f in select oid::regprocedure signature from pg_proc where proname in ('vendor_record_application_version','vendor_require_operator','vendor_begin_review','vendor_record_evidence','vendor_evidence_current','vendor_is_eligible','vendor_decide_onboarding','vendor_prepare_invitation','vendor_record_invitation') and pronamespace='public'::regnamespace loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.vendor_begin_review(uuid,uuid),public.vendor_record_evidence(uuid,text,text,text,timestamptz,timestamptz,uuid),public.vendor_decide_onboarding(uuid,integer,text,text,text),public.vendor_prepare_invitation(uuid,text,timestamptz),public.vendor_record_invitation(uuid,text,text,text) to authenticated;
grant execute on function public.vendor_is_eligible(uuid) to service_role;
