-- TRACE-101 / DEC-2026-022: R0 request and checkout admission is closed by default.
-- A homeowner role or account does not grant transactional access. Admission is per
-- account, covered ZIP and service. Josh's operator identity is provisioned separately
-- after owner authorization; no operator is seeded into a new environment.
-- Revocation blocks new submissions (including replay) and every new checkout while
-- preserving existing request, invoice and payment history.

create table private.r0_lee_zips (
  zip_code text primary key check (zip_code ~ '^[0-9]{5}$')
);
-- Duplicated from the approved CFG-001 list only for the independent admission
-- boundary. Any Lee County boundary change must review both migrations.
insert into private.r0_lee_zips (zip_code) values
  ('33901'),
  ('33903'),
  ('33904'),
  ('33905'),
  ('33907'),
  ('33908'),
  ('33909'),
  ('33912'),
  ('33913'),
  ('33914'),
  ('33916'),
  ('33917'),
  ('33919'),
  ('33920'),
  ('33922'),
  ('33928'),
  ('33931'),
  ('33936'),
  ('33956'),
  ('33957'),
  ('33966'),
  ('33967'),
  ('33971'),
  ('33972'),
  ('33973'),
  ('33974'),
  ('33976'),
  ('33990'),
  ('33991'),
  ('33993'),
  ('34134'),
  ('34135'),
  ('33965'),
  ('33902'),
  ('33906'),
  ('33910'),
  ('33915'),
  ('33918'),
  ('33921'),
  ('33924'),
  ('33929'),
  ('33932'),
  ('33945'),
  ('33970'),
  ('33994'),
  ('34133'),
  ('34136');
alter table private.r0_lee_zips enable row level security;
revoke all on private.r0_lee_zips from public, anon, authenticated, service_role;

create table private.r0_trial_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled_at timestamptz not null default now(),
  enabled_by uuid references auth.users(id),
  reason text not null check (length(btrim(reason)) between 3 and 500)
);
create table private.r0_trial_admissions (
  homeowner_id uuid not null references auth.users(id) on delete cascade,
  zip_code text not null references public.coverage_areas(zip_code),
  service_id text not null references public.services_catalog(id),
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  granted_by uuid not null references auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (homeowner_id, zip_code, service_id),
  check ((is_active and revoked_at is null and revoked_by is null)
    or (not is_active and revoked_at is not null and revoked_by is not null))
);
create table private.r0_trial_admission_events (
  id bigint generated always as identity primary key,
  homeowner_id uuid not null references auth.users(id) on delete cascade,
  zip_code text not null,
  service_id text not null,
  allowed boolean not null,
  actor_id uuid not null references auth.users(id),
  reason text not null,
  recorded_at timestamptz not null default now()
);
create index r0_trial_admission_events_homeowner_time
  on private.r0_trial_admission_events (homeowner_id, recorded_at desc);
alter table private.r0_trial_operators enable row level security;
alter table private.r0_trial_admissions enable row level security;
alter table private.r0_trial_admission_events enable row level security;
revoke all on private.r0_trial_operators, private.r0_trial_admissions,
  private.r0_trial_admission_events from public, anon, authenticated, service_role;

-- This command is callable by authenticated operators, but an admin role alone
-- is insufficient. The initially empty operator roster requires a separate,
-- owner-authorized hosted provisioning step.
create function public.r0_set_trial_admission(
  p_homeowner uuid, p_zip text, p_service text, p_allowed boolean, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.has_role(actor, 'admin')
    or not exists (select 1 from private.r0_trial_operators where user_id = actor) then
    raise exception 'Trial admission operator required' using errcode = '42501';
  end if;
  if p_homeowner is null or not public.has_role(p_homeowner, 'homeowner')
    or p_zip !~ '^[0-9]{5}$' or p_service is null or p_allowed is null
    or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Invalid trial admission' using errcode = '22023';
  end if;
  if p_allowed and (
    not exists (select 1 from private.r0_lee_zips where zip_code = p_zip)
    or not exists (select 1 from public.coverage_areas
      where zip_code = p_zip and is_active = true)
    or not exists (select 1 from public.services_catalog
      where id = p_service and is_active = true)) then
    raise exception 'Covered, active service cell required' using errcode = '22023';
  end if;
  -- The unique cell row serializes grant/revoke with request and checkout reads.
  insert into private.r0_trial_admissions
    (homeowner_id, zip_code, service_id, is_active, granted_by,
     revoked_at, revoked_by)
  values (p_homeowner, p_zip, p_service, p_allowed, actor,
    case when p_allowed then null else now() end,
    case when p_allowed then null else actor end)
  on conflict (homeowner_id, zip_code, service_id) do update
    set is_active = excluded.is_active,
        granted_at = case when excluded.is_active then now()
          else private.r0_trial_admissions.granted_at end,
        granted_by = case when excluded.is_active then actor
          else private.r0_trial_admissions.granted_by end,
        revoked_at = excluded.revoked_at,
        revoked_by = excluded.revoked_by,
        updated_at = now();
  insert into private.r0_trial_admission_events
    (homeowner_id, zip_code, service_id, allowed, actor_id, reason)
  values (p_homeowner, p_zip, p_service, p_allowed, actor, btrim(p_reason));
end $$;
revoke all on function public.r0_set_trial_admission(uuid,text,text,boolean,text)
  from public, anon, service_role;
grant execute on function public.r0_set_trial_admission(uuid,text,text,boolean,text)
  to authenticated;

create function private.r0_trial_admitted(p_homeowner uuid, p_zip text, p_service text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allowed boolean;
begin
  if not exists (select 1 from private.r0_lee_zips where zip_code = p_zip) then
    return false;
  end if;
  select a.is_active into allowed
    from private.r0_trial_admissions a
    where a.homeowner_id = p_homeowner
      and a.zip_code = p_zip and a.service_id = p_service
    for share;
  return coalesce(allowed, false);
end $$;
revoke all on function private.r0_trial_admitted(uuid,text,text)
  from public, anon, authenticated, service_role;

create function private.r0_trial_admitted_for_payload(p_homeowner uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare zip text; selections jsonb; selection jsonb;
begin
  -- Leave malformed-input diagnostics to the existing submission command.
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return true; end if;
  zip := p_payload #>> '{location,zip_code}';
  selections := p_payload -> 'selections';
  if zip is null or zip !~ '^[0-9]{5}(-[0-9]{4})?$'
    or jsonb_typeof(selections) is distinct from 'array'
    or jsonb_array_length(selections) = 0 then return true; end if;
  zip := left(zip, 5);
  -- Unknown cells retain core diagnostics.
  if not exists (select 1 from public.coverage_areas
      where zip_code = zip) then return true; end if;
  if exists (select 1 from jsonb_array_elements(selections) item
      where jsonb_typeof(item) <> 'object'
        or not exists (select 1 from public.services_catalog s
          where s.id = item ->> 'service_id'))
    then return true; end if;
  for selection in select value from jsonb_array_elements(selections) loop
    if jsonb_typeof(selection) <> 'object' or selection ->> 'service_id' is null
      then return true; end if;
    -- An active cell always requires admission. An inactive cell also does once this
    -- homeowner has any grant or revocation for it: a replay can return before the core
    -- revalidates coverage or catalog state, so deactivation must not restore a revoked
    -- replay. An inactive cell without admission history keeps the core's waitlist or
    -- unavailable diagnostics, which cannot create a request.
    if (exists (select 1 from public.coverage_areas
          where zip_code = zip and is_active = true)
        and exists (select 1 from public.services_catalog
          where id = selection ->> 'service_id' and is_active = true))
      or exists (select 1 from private.r0_trial_admissions
          where homeowner_id = p_homeowner and zip_code = zip
            and service_id = selection ->> 'service_id') then
      if not private.r0_trial_admitted(p_homeowner, zip, selection ->> 'service_id')
        then return false; end if;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.r0_trial_admitted_for_payload(uuid,jsonb)
  from public, anon, authenticated, service_role;

-- Retain the TRACE-095 homeowner-role check, core and replay behavior.
alter function public.submit_service_requests(text,jsonb)
  rename to submit_service_requests_homeowner_checked;
alter function public.submit_service_requests_homeowner_checked(text,jsonb)
  set schema private;
revoke all on function private.submit_service_requests_homeowner_checked(text,jsonb)
  from public, anon, authenticated, service_role;
create function public.submit_service_requests(p_submission_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.has_role(actor, 'homeowner') then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  if not private.r0_trial_admitted_for_payload(actor, p_payload) then
    raise exception 'Trial invitation required for this service and area'
      using errcode = '42501';
  end if;
  return private.submit_service_requests_homeowner_checked(p_submission_key,p_payload);
end $$;
revoke all on function public.submit_service_requests(text,jsonb) from public, anon;
grant execute on function public.submit_service_requests(text,jsonb) to authenticated;

-- Preserve the source-bound money command and put a cohort check in front of it.
alter function public.money_prepare_checkout(uuid,text)
  rename to money_checkout_source_guarded;
alter function public.money_checkout_source_guarded(uuid,text)
  set schema private;
revoke all on function private.money_checkout_source_guarded(uuid,text)
  from public, anon, authenticated, service_role;
create function public.money_prepare_checkout(p_snapshot uuid,p_mode text)
returns public.money_checkout_attempts
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); source_request public.service_requests;
begin
  if actor is null then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  select r.* into source_request
    from public.money_snapshots s
    join public.money_obligations o on o.id = s.obligation_id
    join public.service_requests r on r.id = o.service_request_id
    where s.id = p_snapshot and o.customer_id = actor;
  if not found then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  if not private.r0_trial_admitted(
      actor, source_request.zip_code, source_request.service_catalog_id) then
    raise exception 'Trial invitation required for checkout'
      using errcode = '42501';
  end if;
  return private.money_checkout_source_guarded(p_snapshot,p_mode);
end $$;
revoke all on function public.money_prepare_checkout(uuid,text)
  from public, anon, service_role;
grant execute on function public.money_prepare_checkout(uuid,text)
  to authenticated;
