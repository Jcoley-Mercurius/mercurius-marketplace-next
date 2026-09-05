-- TRACE-059: every recurring visit has a separate commercial/payment identity.
-- A provider subscription invoice is never proof that a particular visit was funded.
create table public.money_recurring_occurrence_identities (
  id uuid primary key default gen_random_uuid(),
  template_request_id uuid not null references public.service_requests(id),
  occurrence_request_id uuid not null unique references public.service_requests(id),
  occurrence_key uuid not null,
  scheduled_at timestamptz not null,
  obligation_id uuid not null unique references public.money_obligations(id),
  snapshot_id uuid not null unique references public.money_snapshots(id),
  source_hash text not null check(length(btrim(source_hash))>0),
  frequency text not null check(frequency in ('weekly','monthly','bi-monthly','quarterly')),
  created_at timestamptz not null default now(),
  unique(template_request_id,occurrence_key),
  check(template_request_id<>occurrence_request_id)
);
alter table public.money_recurring_occurrence_identities enable row level security;
revoke all on public.money_recurring_occurrence_identities from public,anon,authenticated,service_role;
grant select on public.money_recurring_occurrence_identities to service_role;
create trigger immutable_evidence before update or delete on public.money_recurring_occurrence_identities
  for each row execute function public.money_immutable();

create function private.money_bind_recurring_occurrence() returns trigger
language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; occurrence public.service_requests; template public.service_requests;
  prior public.money_recurring_occurrence_identities;
begin
  select * into strict o from public.money_obligations where current_snapshot_id=new.snapshot_id for update;
  select * into strict occurrence from public.service_requests where id=o.service_request_id for update;
  if occurrence.frequency is null or occurrence.frequency='one-time' then
    if occurrence.recurrence_parent_id is not null or occurrence.occurrence_key is not null then
      raise exception 'Recurring occurrence frequency required';
    end if;
    return new;
  end if;
  if occurrence.recurrence_parent_id is null or occurrence.occurrence_key is null
    or occurrence.scheduled_start_at is null then
    raise exception 'Recurring template cannot receive a commercial snapshot';
  end if;
  select * into strict template from public.service_requests where id=occurrence.recurrence_parent_id for share;
  if template.recurrence_parent_id is not null or template.occurrence_key is not null
    or template.frequency is distinct from occurrence.frequency
    or template.customer_id is distinct from occurrence.customer_id
    or template.service_catalog_id is distinct from occurrence.service_catalog_id
    or template.service_type is distinct from occurrence.service_type
    or template.address is distinct from occurrence.address
    or template.city is distinct from occurrence.city
    or template.state is distinct from occurrence.state
    or template.zip_code is distinct from occurrence.zip_code then
    raise exception 'Recurring occurrence does not match its template';
  end if;
  insert into public.money_recurring_occurrence_identities(
    template_request_id,occurrence_request_id,occurrence_key,scheduled_at,
    obligation_id,snapshot_id,source_hash,frequency)
  values(template.id,occurrence.id,occurrence.occurrence_key,occurrence.scheduled_start_at,
    o.id,new.snapshot_id,new.source_hash,occurrence.frequency)
  on conflict(occurrence_request_id) do nothing;
  select * into strict prior from public.money_recurring_occurrence_identities
    where occurrence_request_id=occurrence.id;
  if prior.template_request_id<>template.id or prior.occurrence_key<>occurrence.occurrence_key
    or prior.scheduled_at<>occurrence.scheduled_start_at or prior.obligation_id<>o.id
    or prior.snapshot_id<>new.snapshot_id or prior.source_hash<>new.source_hash
    or prior.frequency<>occurrence.frequency then
    raise exception 'Recurring occurrence commercial identity conflict';
  end if;
  return new;
end $$;
revoke all on function private.money_bind_recurring_occurrence() from public,anon,authenticated,service_role;
create trigger bind_recurring_occurrence after insert on public.money_commercial_sources
  for each row execute function private.money_bind_recurring_occurrence();

create function private.money_guard_recurring_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.service_requests;
begin
  select request.* into strict r from public.money_obligations o
    join public.service_requests request on request.id=o.service_request_id
    where o.id=new.obligation_id;
  if r.frequency is not null and r.frequency<>'one-time'
    and not exists(select 1 from public.money_recurring_occurrence_identities i
      where i.occurrence_request_id=r.id and i.obligation_id=new.obligation_id
        and i.snapshot_id=new.snapshot_id and i.occurrence_key=r.occurrence_key
        and i.scheduled_at=r.scheduled_start_at) then
    raise exception 'Recurring occurrence commercial identity required before checkout';
  end if;
  return new;
end $$;
revoke all on function private.money_guard_recurring_checkout() from public,anon,authenticated,service_role;
create trigger recurring_checkout_identity before insert on public.money_checkout_attempts
  for each row execute function private.money_guard_recurring_checkout();
