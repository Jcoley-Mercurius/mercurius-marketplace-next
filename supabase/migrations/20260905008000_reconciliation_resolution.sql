create table public.money_reconciliation_resolutions (
  id uuid primary key default gen_random_uuid(), observation_id uuid not null unique references public.money_reconciliation(id),
  actor uuid not null references auth.users(id), approver uuid not null references auth.users(id),
  reason text not null check(length(trim(reason))>0), created_at timestamptz not null default now(),check(actor<>approver)
);
alter table public.money_reconciliation_resolutions enable row level security;
revoke all on public.money_reconciliation_resolutions from public,anon,authenticated,service_role;
grant select on public.money_reconciliation_resolutions to service_role;
create trigger immutable_evidence before update or delete on public.money_reconciliation_resolutions for each row execute function public.money_immutable();
create function public.money_resolve_reconciliation(p_observation uuid,p_actor uuid,p_approver uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.money_reconciliation; o public.money_obligations;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','reconciliation_resolution','observation',p_observation,'reason',p_reason));
  select * into strict r from public.money_reconciliation where id=p_observation;
  select * into strict o from public.money_obligations where id=r.obligation_id for update;
  if r.currency<>'usd' or r.expected<>r.observed or r.expected<>o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip
    or exists(select 1 from public.money_reconciliation where obligation_id=o.id and observation_sequence>r.observation_sequence)
    then raise exception 'Current matching provider readback required'; end if;
  insert into public.money_reconciliation_resolutions(observation_id,actor,approver,reason) values(r.id,p_actor,p_approver,p_reason);
  update public.money_obligations set reconciliation_open=false where id=o.id;
  -- Other holds and unreconciled event receipts still block money_payable independently.
end $$;
revoke all on function public.money_resolve_reconciliation(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.money_resolve_reconciliation(uuid,uuid,uuid,text) to service_role;
