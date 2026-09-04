-- TRACE-055: authoritative Phase 4 confirmation and live dispute gates for manual ACH.
-- No bank transfer, scheduler, legacy backfill or new lifecycle transition.
create table public.money_lifecycle_confirmations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id),
  homeowner_id uuid not null references auth.users(id),
  contractor_id uuid not null references public.contractors(id),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(request_id,confirmed_at)
);
alter table public.money_lifecycle_confirmations enable row level security;
revoke all on public.money_lifecycle_confirmations from public,anon,authenticated,service_role;
grant select on public.money_lifecycle_confirmations to service_role;
create trigger immutable_evidence before update or delete on public.money_lifecycle_confirmations
  for each row execute function public.money_immutable();

-- Keep the existing transition implementation and all of its checks in one place.
alter function public.transition_job_status(uuid,public.request_status,text,jsonb) set schema private;
revoke all on function private.transition_job_status(uuid,public.request_status,text,jsonb) from public,anon,authenticated,service_role;
create function public.transition_job_status(_job_id uuid,_to_status public.request_status,_reason text default null,_metadata jsonb default null)
returns public.request_status language plpgsql security definer set search_path='' as $$
declare result public.request_status; r public.service_requests;
begin
  result:=private.transition_job_status(_job_id,_to_status,_reason,_metadata);
  if _to_status='homeowner_confirmed' then
    select * into strict r from public.service_requests where id=_job_id;
    -- The canonical transition authenticates before changing state; never accept an actor parameter.
    if auth.uid() is distinct from r.customer_id or auth.role()<>'authenticated' then
      raise exception 'Only the homeowner can confirm completion' using errcode='42501';
    end if;
    insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
      values(r.id,r.customer_id,r.contractor_id,r.homeowner_confirmed_at);
  end if;
  return result;
end $$;
revoke all on function public.transition_job_status(uuid,public.request_status,text,jsonb) from public,anon;
grant execute on function public.transition_job_status(uuid,public.request_status,text,jsonb) to authenticated,service_role;

create function private.money_lock_lifecycle(p_obligations uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare request uuid;
begin
  if cardinality(p_obligations) is null or cardinality(p_obligations) not between 1 and 500 then raise exception 'Bounded batch required'; end if;
  -- Lifecycle -> vendor -> obligation, before existing ACH kernels take their locks.
  for request in select distinct service_request_id from public.money_obligations where id=any(p_obligations) order by service_request_id loop
    perform pg_advisory_xact_lock(hashtextextended(request::text,0));
    perform 1 from public.service_requests where id=request for update;
  end loop;
end $$;
revoke all on function private.money_lock_lifecycle(uuid[]) from public,anon,authenticated,service_role;

create function private.money_completion_source(p_obligation uuid) returns public.money_lifecycle_confirmations
language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; r public.service_requests; c public.money_lifecycle_confirmations;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict r from public.service_requests where id=o.service_request_id;
  select * into c from public.money_lifecycle_confirmations where request_id=r.id order by confirmed_at desc limit 1;
  if c.id is null or c.homeowner_id is distinct from o.customer_id or c.contractor_id is distinct from o.contractor_id
    or r.customer_id is distinct from c.homeowner_id or r.contractor_id is distinct from c.contractor_id
    or r.homeowner_confirmed_at is distinct from c.confirmed_at or c.confirmed_at>now() then
    raise exception 'Verified lifecycle confirmation required';
  end if;
  return c;
end $$;
revoke all on function private.money_completion_source(uuid) from public,anon,authenticated,service_role;

-- Preserve the service API, but a supplied label/time is no longer proof.
create or replace function public.money_record_completion(p_obligation uuid,p_homeowner uuid,p_confirmed timestamptz,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.money_lifecycle_confirmations;
begin
  perform private.money_lock_lifecycle(array[p_obligation]);
  c:=private.money_completion_source(p_obligation);
  if p_homeowner is distinct from c.homeowner_id or p_confirmed is distinct from c.confirmed_at
    or p_source is distinct from 'phase4-confirmation:'||c.id then raise exception 'Confirmation source mismatch'; end if;
  perform 1 from public.money_obligations where id=p_obligation for update;
  insert into public.money_completion_evidence(obligation_id,homeowner_id,confirmed_at,source_ref)
    values(p_obligation,c.homeowner_id,c.confirmed_at,p_source) on conflict do nothing;
  if not exists(select 1 from public.money_completion_evidence where obligation_id=p_obligation
    and homeowner_id=c.homeowner_id and confirmed_at=c.confirmed_at and source_ref=p_source) then
    raise exception 'Confirmation conflict; reconcile historical evidence';
  end if;
end $$;

alter function public.money_payable(uuid) set schema private;
revoke all on function private.money_payable(uuid) from public,anon,authenticated,service_role;
create function public.money_payable(p_obligation uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.money_lifecycle_confirmations; r public.service_requests;
begin
  perform private.money_lock_lifecycle(array[p_obligation]);
  c:=private.money_completion_source(p_obligation);
  select * into strict r from public.service_requests where id=c.request_id;
  if r.disputed or r.status not in ('homeowner_confirmed','completed','review_requested','reviewed','closed','resolved')
    or exists(select 1 from public.disputes where job_id=r.id and status<>'resolved')
    or exists(select 1 from public.dispute_appeals a join public.disputes d on d.id=a.dispute_id
      left join public.support_tickets t on t.id=a.ticket_id where d.job_id=r.id and (t.id is null or t.status<>'resolved')) then
    raise exception 'Lifecycle dispute or completion hold';
  end if;
  perform public.money_record_completion(p_obligation,c.homeowner_id,c.confirmed_at,'phase4-confirmation:'||c.id);
  return private.money_payable(p_obligation);
end $$;
revoke all on function public.money_payable(uuid) from public,anon,authenticated,service_role;

alter function public.money_prepare_ach(date,uuid[],uuid,uuid,text,text) set schema private;
alter function public.money_record_ach(uuid,text,text,uuid,text,text) set schema private;
alter function public.money_retry_ach(uuid,uuid,uuid) set schema private;
revoke all on function private.money_prepare_ach(date,uuid[],uuid,uuid,text,text),private.money_record_ach(uuid,text,text,uuid,text,text),private.money_retry_ach(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.money_prepare_ach(p_period date,p_obligations uuid[],p_actor uuid,p_approver uuid,p_bank_ref text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform public.money_require_finance(p_actor);
  perform private.money_lock_lifecycle(p_obligations);
  return private.money_prepare_ach(p_period,p_obligations,p_actor,p_approver,p_bank_ref,p_reason);
end $$;
create function public.money_record_ach(p_attempt uuid,p_status text,p_bank_ref text,p_actor uuid,p_evidence text,p_key text)
returns void language plpgsql security definer set search_path='' as $$
declare obligation uuid;
begin
  perform public.money_require_finance(p_actor);
  select i.obligation_id into strict obligation from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id where a.id=p_attempt;
  perform private.money_lock_lifecycle(array[obligation]);
  -- Submission rechecks eligibility. Later bank outcomes must still be recorded under a new hold.
  perform private.money_record_ach(p_attempt,p_status,p_bank_ref,p_actor,p_evidence,p_key);
end $$;
create function public.money_retry_ach(p_item uuid,p_actor uuid,p_approver uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare obligation uuid;
begin
  perform public.money_require_finance(p_actor);
  select obligation_id into strict obligation from public.money_ach_items where id=p_item;
  perform private.money_lock_lifecycle(array[obligation]);
  return private.money_retry_ach(p_item,p_actor,p_approver);
end $$;
revoke all on function public.money_prepare_ach(date,uuid[],uuid,uuid,text,text),public.money_record_ach(uuid,text,text,uuid,text,text),public.money_retry_ach(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.money_prepare_ach(date,uuid[],uuid,uuid,text,text),public.money_record_ach(uuid,text,text,uuid,text,text),public.money_retry_ach(uuid,uuid,uuid) to service_role;

-- Serialize even privileged evidence writes with the same lifecycle boundary.
-- Deadlocks from callers using an inverse order abort safely and must be retried.
create function private.money_lock_dispute_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare request uuid;
begin
  if tg_table_name='disputes' then request:=coalesce(new.job_id,old.job_id);
  elsif tg_table_name='dispute_appeals' then
    select job_id into request from public.disputes where id=coalesce(new.dispute_id,old.dispute_id);
  else
    select d.job_id into request from public.disputes d join public.dispute_appeals a on a.dispute_id=d.id where a.ticket_id=coalesce(new.id,old.id);
  end if;
  if request is not null then
    perform pg_advisory_xact_lock(hashtextextended(request::text,0));
    perform 1 from public.service_requests where id=request for update;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.money_lock_dispute_write() from public,anon,authenticated,service_role;
create trigger money_dispute_lock before insert or update or delete on public.disputes
  for each row execute function private.money_lock_dispute_write();
create trigger money_appeal_lock before insert or update or delete on public.dispute_appeals
  for each row execute function private.money_lock_dispute_write();
create trigger money_appeal_ticket_lock before update of status or delete on public.support_tickets
  for each row execute function private.money_lock_dispute_write();
