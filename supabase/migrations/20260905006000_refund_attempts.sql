create table public.money_refund_attempts (
  authorization_id uuid primary key references public.money_refund_authorizations(id),
  payment_id text not null, amount bigint not null check(amount>0), idempotency_key text not null unique,
  provider_reference text unique,
  status text not null default 'prepared' check(status in ('prepared','pending','succeeded','failed','reconcile')),
  created_at timestamptz not null default now()
);
create table public.money_refund_attempt_events (
  id uuid primary key default gen_random_uuid(), authorization_id uuid not null references public.money_refund_attempts(authorization_id),
  provider_reference text not null, status text not null, amount bigint not null, created_at timestamptz not null default now()
);
create function public.money_prepare_refund(p_authorization uuid,p_actor uuid) returns public.money_refund_attempts language plpgsql security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts;
begin
  perform public.money_require_finance(p_actor);
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  if p_actor not in (r.created_by,r.approved_by) then raise exception 'Refund actor not authorized' using errcode='42501'; end if;
  insert into public.money_refund_attempts(authorization_id,payment_id,amount,idempotency_key)
    values(r.id,r.payment_id,r.service+r.tax+r.tip,'mercurius:refund-v1:'||r.id) on conflict do nothing;
  select * into strict a from public.money_refund_attempts where authorization_id=r.id for update;
  if exists(select 1 from public.money_refunds where authorization_id=r.id) then
    update public.money_refund_attempts set status='succeeded' where authorization_id=r.id returning * into a;
  elsif a.status='prepared' and a.created_at<=now()-interval '23 hours' then
    update public.money_refund_attempts set status='reconcile' where authorization_id=r.id returning * into a;
  end if;
  return a;
end $$;
create function public.money_record_refund_result(p_authorization uuid,p_reference text,p_status text,p_amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare a public.money_refund_attempts;
begin
  select * into strict a from public.money_refund_attempts where authorization_id=p_authorization for update;
  if a.amount is distinct from p_amount or coalesce(p_reference,'') not like 're_%' or p_status is null or p_status not in ('succeeded','pending','failed','canceled','requires_action') then raise exception 'Refund provider mismatch'; end if;
  if a.provider_reference is not null and a.provider_reference<>p_reference then raise exception 'Refund reference conflict'; end if;
  insert into public.money_refund_attempt_events(authorization_id,provider_reference,status,amount) values(a.authorization_id,p_reference,p_status,p_amount);
  update public.money_refund_attempts set provider_reference=p_reference,status=case
    when status='succeeded' or exists(select 1 from public.money_refunds where authorization_id=a.authorization_id) then 'succeeded'
    when p_status in ('failed','canceled') then 'failed' else 'pending' end where authorization_id=a.authorization_id;
end $$;
do $$ declare t text; begin
  foreach t in array array['money_refund_attempts','money_refund_attempt_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
end $$;
create trigger immutable_evidence before update or delete on public.money_refund_attempt_events for each row execute function public.money_immutable();
revoke all on function public.money_prepare_refund(uuid,uuid),public.money_record_refund_result(uuid,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.money_prepare_refund(uuid,uuid),public.money_record_refund_result(uuid,text,text,bigint) to service_role;
