-- TRACE-058: preserve the paid customer agreement while assigning provider proceeds
-- to a canonically accepted replacement. This records evidence only; no transfer.
create table public.money_replacement_reconciliations (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  operation_id uuid not null unique references public.job_operations(id),
  replacement_decision_id uuid not null unique references public.money_provider_replacement_decisions(id),
  snapshot_id uuid not null references public.money_snapshots(id),
  original_contractor_id uuid not null references public.contractors(id),
  replacement_contractor_id uuid not null references public.contractors(id),
  captured bigint not null check(captured>0),
  source_hash text not null check(length(btrim(source_hash))>0),
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  reason text not null check(length(btrim(reason))>0),
  created_at timestamptz not null default now(),
  check(created_by<>approved_by),
  check(original_contractor_id<>replacement_contractor_id)
);
create unique index money_replacement_payee_chain
  on public.money_replacement_reconciliations(obligation_id,original_contractor_id,replacement_contractor_id);
alter table public.money_replacement_reconciliations enable row level security;
revoke all on public.money_replacement_reconciliations from public,anon,authenticated,service_role;
grant select on public.money_replacement_reconciliations to service_role;
create trigger immutable_evidence before update or delete on public.money_replacement_reconciliations
  for each row execute function public.money_immutable();

create function private.money_effective_contractor(p_obligation uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select replacement_contractor_id from public.money_replacement_reconciliations
      where obligation_id=p_obligation order by created_at desc,id desc limit 1),
    (select contractor_id from public.money_obligations where id=p_obligation)
  )
$$;
revoke all on function private.money_effective_contractor(uuid) from public,anon,authenticated,service_role;

create function public.money_reconcile_replacement(
  p_operation uuid,p_decision uuid,p_actor uuid,p_approver uuid,p_reason text
) returns public.money_replacement_reconciliations
language plpgsql security definer set search_path='' as $$
declare op public.job_operations; decision public.money_provider_replacement_decisions;
  o public.money_obligations; r public.service_requests; binding public.money_commercial_sources;
  prior public.money_replacement_reconciliations; result public.money_replacement_reconciliations;
  source_hash text; command jsonb; current_payee uuid;
begin
  perform public.money_require_finance(p_actor);
  perform public.money_require_finance(p_approver);
  select * into strict op from public.job_operations where id=p_operation;
  perform pg_advisory_xact_lock(hashtextextended(op.job_id::text,0));
  select * into strict r from public.service_requests where id=op.job_id for update;
  select * into strict o from public.money_obligations where service_request_id=r.id for update;
  select * into strict decision from public.money_provider_replacement_decisions where id=p_decision;
  select * into binding from public.money_commercial_sources where snapshot_id=o.current_snapshot_id;
  source_hash:=coalesce(binding.source_hash,'legacy-snapshot:'||o.current_snapshot_id);
  select * into prior from public.money_replacement_reconciliations where operation_id=p_operation;
  current_payee:=case when prior.id is not null then prior.original_contractor_id
    else private.money_effective_contractor(o.id) end;
  command:=jsonb_build_object('operation','replacement_reconciliation','provider_operation',p_operation,
    'replacement_decision',p_decision,'obligation',o.id,'snapshot',o.current_snapshot_id,
    'captured',o.captured,'original_contractor',current_payee,
    'replacement_contractor',r.contractor_id,'source_hash',source_hash,'reason',btrim(p_reason));
  perform public.money_require_review(p_actor,p_approver,command);
  if prior.id is not null then
    if prior.replacement_decision_id<>p_decision or prior.created_by<>p_actor
      or prior.approved_by<>p_approver or prior.reason<>btrim(p_reason)
      or prior.replacement_contractor_id is distinct from r.contractor_id
      or prior.snapshot_id<>o.current_snapshot_id or prior.captured<>o.captured
      or prior.source_hash<>source_hash then
      raise exception 'Replacement reconciliation idempotency conflict';
    end if;
    return prior;
  end if;
  if op.kind not in ('provider_cancel','no_show') or op.job_id<>r.id
    or op.policy_assessment->>'next_action' is distinct from 'rematch_first' then
    raise exception 'Approved provider replacement operation required';
  end if;
  if decision.operation_id<>op.id or decision.outcome<>'replacement_active' then
    raise exception 'Active replacement decision required';
  end if;
  if r.contractor_id is null or r.contractor_id=current_payee
    or not exists(select 1 from public.job_match_attempts a where a.service_request_id=r.id
      and a.contractor_id=r.contractor_id and a.outcome='accepted') then
    raise exception 'Canonically accepted replacement required';
  end if;
  if o.current_snapshot_id is null or o.captured<=0 then raise exception 'Paid agreement required'; end if;
  if exists(select 1 from public.money_checkout_attempts a where a.obligation_id=o.id
      and a.status not in ('captured','expired')) then raise exception 'Uncertain checkout requires reconciliation'; end if;
  if exists(select 1 from public.money_refund_authorizations where obligation_id=o.id)
    or o.refunded_service+o.refunded_tax+o.refunded_tip>0 then
    raise exception 'Refunded agreement cannot be reassigned';
  end if;
  if exists(select 1 from public.money_ach_items where obligation_id=o.id) then
    raise exception 'Existing ACH statement cannot be reassigned';
  end if;
  if not public.vendor_is_eligible(r.contractor_id) then raise exception 'Replacement vendor onboarding hold'; end if;
  insert into public.money_replacement_reconciliations(
    obligation_id,operation_id,replacement_decision_id,snapshot_id,original_contractor_id,
    replacement_contractor_id,captured,source_hash,created_by,approved_by,reason)
  values(o.id,op.id,decision.id,o.current_snapshot_id,current_payee,r.contractor_id,
    o.captured,source_hash,p_actor,p_approver,btrim(p_reason)) returning * into result;
  return result;
end $$;
revoke all on function public.money_reconcile_replacement(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.money_reconcile_replacement(uuid,uuid,uuid,uuid,text) to service_role;

-- Provider cancellation remains a checkout stop. A paid agreement is preserved;
-- repricing or collecting another balance needs a separate approved policy.

create or replace function private.money_completion_source(p_obligation uuid)
returns public.money_lifecycle_confirmations
language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; r public.service_requests; c public.money_lifecycle_confirmations; payee uuid;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict r from public.service_requests where id=o.service_request_id;
  payee:=private.money_effective_contractor(o.id);
  if exists(select 1 from public.job_operations j where j.job_id=r.id and j.kind in ('provider_cancel','no_show'))
    and not exists(select 1 from public.money_replacement_reconciliations x
      where x.obligation_id=o.id and x.replacement_contractor_id=r.contractor_id
        and x.snapshot_id=o.current_snapshot_id and x.captured=o.captured) then
    raise exception 'Replacement commercial reconciliation required before payout';
  end if;
  select * into c from public.money_lifecycle_confirmations where request_id=r.id order by confirmed_at desc limit 1;
  if c.id is null or c.homeowner_id is distinct from o.customer_id or c.contractor_id is distinct from payee
    or r.customer_id is distinct from c.homeowner_id or r.contractor_id is distinct from c.contractor_id
    or r.homeowner_confirmed_at is distinct from c.confirmed_at or c.confirmed_at>now() then
    raise exception 'Verified lifecycle confirmation required';
  end if;
  return c;
end $$;

create or replace function private.money_payable(p_obligation uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; s public.money_snapshots; amount bigint; retained record; payee uuid;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
  payee:=private.money_effective_contractor(o.id);
  if o.captured<>s.total or o.dispute_open or o.reconciliation_open then raise exception 'Payment or dispute hold'; end if;
  if exists(select 1 from public.money_webhook_events e where e.status<>'processed'
    and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
    and (e.event_type='reconciliation_required' or e.payload->>'attempt_id' in(select id::text from public.money_checkout_attempts where obligation_id=o.id)
      or e.payload->>'payment_id' in(select stripe_payment_id from public.money_checkout_attempts where obligation_id=o.id))) then raise exception 'Unreconciled provider event hold'; end if;
  if not exists(select 1 from public.money_completion_evidence where obligation_id=o.id and homeowner_id=o.customer_id and confirmed_at+interval '48 hours'<=now()) then raise exception '48 hours after homeowner confirmation required'; end if;
  if exists(select 1 from public.money_holds h where obligation_id=o.id and not exists(select 1 from public.money_hold_resolutions r where r.hold_id=h.id)) then raise exception 'Unresolved payout hold'; end if;
  if exists(select 1 from public.money_refund_authorizations r where obligation_id=o.id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then raise exception 'Pending refund hold'; end if;
  if not public.vendor_is_eligible(payee) then raise exception 'Vendor onboarding hold'; end if;
  select * into strict retained from public.money_retained_parts(o.id);
  amount:=retained.service-round(retained.service::numeric*15/100)+retained.tip;
  if amount<=0 then raise exception 'No provider payable'; end if;
  return amount;
end $$;

create or replace function private.money_prepare_ach(p_period date,p_obligations uuid[],p_actor uuid,p_approver uuid,p_bank_ref text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; obligation uuid; o public.money_obligations; s public.money_snapshots; item uuid;
  bank_evidence uuid; amount bigint; retained record; payee uuid;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','ach','period',p_period,'obligations',p_obligations,'bank_ref',p_bank_ref,'reason',p_reason));
  if cardinality(p_obligations) is null or cardinality(p_obligations) not between 1 and 500 then raise exception 'Bounded batch required'; end if;
  perform 1 from public.vendor_onboarding where contractor_id in(
    select private.money_effective_contractor(id) from public.money_obligations where id=any(p_obligations)
  ) order by contractor_id for share;
  perform 1 from public.money_obligations where id=any(p_obligations) order by id for update;
  insert into public.money_ach_batches(period_start,period_end,created_by,approved_by,bank_authorization_ref,reason)
    values(p_period,p_period+7,p_actor,p_approver,p_bank_ref,p_reason) returning id into batch;
  for obligation in select distinct unnest(p_obligations) order by 1 loop
    select * into strict o from public.money_obligations where id=obligation;
    select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
    payee:=private.money_effective_contractor(o.id);
    amount:=public.money_payable(o.id);
    select * into strict retained from public.money_retained_parts(o.id);
    select e.id into strict bank_evidence from public.vendor_compliance_evidence e where contractor_id=payee and kind='bank_authorization'
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
    insert into public.money_ach_items(batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,amount,confirmation_ref,bank_evidence_id)
      values(batch,o.id,payee,s.id,retained.service,retained.tip,round(retained.service::numeric*15/100),amount,
        (select source_ref from public.money_completion_evidence where obligation_id=o.id),bank_evidence) returning id into item;
    insert into public.money_ach_attempts(item_id,attempt_number,created_by,approved_by) values(item,1,p_actor,p_approver);
  end loop;
  return batch;
end $$;
