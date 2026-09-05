-- TRACE-057: CFG-007 replacement evidence precedes reviewed refunds.
create table public.money_provider_replacement_decisions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.job_operations(id),
  decision_key uuid not null,
  actor_id uuid not null references auth.users(id),
  reason text not null check(length(btrim(reason))>0),
  outcome text not null check(outcome in ('replacement_active','awaiting_consent','no_replacement')),
  matching_evidence jsonb not null,
  created_at timestamptz not null default now(),
  unique(operation_id,decision_key)
);
create unique index provider_replacement_final on public.money_provider_replacement_decisions(operation_id)
  where outcome='no_replacement';
alter table public.money_provider_replacement_decisions enable row level security;
revoke all on public.money_provider_replacement_decisions from public,anon,authenticated,service_role;
grant select on public.money_provider_replacement_decisions to authenticated,service_role;
create policy operations_read on public.money_provider_replacement_decisions for select to authenticated
  using(public.has_role(auth.uid(),'admin'));
create trigger immutable_evidence before update or delete on public.money_provider_replacement_decisions
  for each row execute function public.money_immutable();

-- An authenticated operator asks the canonical engine to try remaining supply.
-- No client-supplied outcome, amount or actor is accepted.
create function public.record_provider_replacement_decision(
  p_operation uuid,p_key uuid,p_reason text
) returns public.money_provider_replacement_decisions
language plpgsql security definer set search_path='' as $$
declare op public.job_operations; r public.service_requests;
  prior public.money_provider_replacement_decisions; result public.money_provider_replacement_decisions;
  offer uuid; decision_outcome text; evidence jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'Operations authority required' using errcode='42501';
  end if;
  if p_key is null or nullif(btrim(p_reason),'') is null then
    raise exception 'Decision key and reason required';
  end if;
  select * into strict op from public.job_operations where id=p_operation;
  if op.kind not in ('provider_cancel','no_show') then raise exception 'Provider cancellation or no-show required'; end if;
  if op.policy_assessment->>'next_action' is distinct from 'rematch_first'
    or op.policy_assessment->>'refund_if_no_acceptable_replacement' is distinct from '100' then
    raise exception 'Approved provider assessment required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(op.job_id::text,0));
  select * into strict r from public.service_requests where id=op.job_id for update;
  select * into prior from public.money_provider_replacement_decisions
    where operation_id=p_operation and decision_key=p_key;
  if found then
    if prior.actor_id<>auth.uid() or prior.reason<>btrim(p_reason) then
      raise exception 'Replacement decision idempotency conflict';
    end if;
    return prior;
  end if;
  -- The canonical admin no-show operation releases the original assignment.
  -- A participant report alone must not refund an assigned, unfinished job.
  if op.kind='no_show' and not coalesce(public.has_role(op.actor_id,'admin'),false) then
    raise exception 'Operations-confirmed no-show required';
  end if;
  if r.status not in ('pending','matched','quoted','scheduled') then
    raise exception 'Service no longer accepts replacement decisions';
  end if;
  if r.status='pending' and r.contractor_id is null then
    offer:=private.offer_next_for_request_internal(r.id);
    select * into strict r from public.service_requests where id=op.job_id;
  end if;
  if r.contractor_id is not null or exists(select 1 from public.job_match_attempts
      where service_request_id=r.id and outcome='pending') then
    decision_outcome:='replacement_active';
  elsif r.status='pending' and r.matching_status='awaiting_consent' then
    decision_outcome:='awaiting_consent';
  elsif r.status='pending' and r.matching_status='exhausted' then
    decision_outcome:='no_replacement';
  else
    raise exception 'Canonical replacement outcome required';
  end if;
  select jsonb_build_object('status',r.status,'matching_status',r.matching_status,
    'contractor_id',r.contractor_id,'offer_id',offer,'attempts',coalesce(jsonb_agg(
      jsonb_build_object('id',a.id,'contractor_id',a.contractor_id,'outcome',a.outcome,
        'offered_at',a.offered_at,'responded_at',a.responded_at) order by a.offered_at,a.id)
      filter(where a.id is not null),'[]'::jsonb)) into evidence
    from public.job_match_attempts a where a.service_request_id=r.id;
  insert into public.money_provider_replacement_decisions(operation_id,decision_key,actor_id,reason,outcome,matching_evidence)
    values(op.id,p_key,auth.uid(),btrim(p_reason),decision_outcome,evidence) returning * into result;
  if decision_outcome='no_replacement' then
    perform public.transition_job_status(r.id,'cancelled',btrim(p_reason),
      jsonb_build_object('replacement_decision_id',result.id,'operation_id',op.id,'policy','CFG-007'));
  end if;
  perform public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object(
    'action','replacement_decision','decision_id',result.id,'outcome',decision_outcome,'reason',btrim(p_reason)));
  return result;
end $$;
revoke all on function public.record_provider_replacement_decision(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.record_provider_replacement_decision(uuid,uuid,text) to authenticated;

create or replace function private.money_cancellation_refund_line(p_operation uuid,p_payment text)
returns table(
  obligation_id uuid, refund_percent integer, assessment_hash text,
  target_service bigint,target_tax bigint,target_tip bigint,
  service bigint,tax bigint,tip bigint,policy_evidence text,business_key text
) language plpgsql stable security definer set search_path='' as $$
declare op public.job_operations; o public.money_obligations; s public.money_snapshots;
  decision public.money_provider_replacement_decisions; attempt public.money_checkout_attempts; pct integer; prior_capacity bigint; line_total bigint;
  line_start bigint; line_end bigint; allocated_service bigint; allocated_tax bigint; allocated_tip bigint;
begin
  select j.* into strict op from public.job_operations j where j.id=p_operation;
  if op.kind in ('provider_cancel','no_show') then
    select * into decision from public.money_provider_replacement_decisions where operation_id=op.id and outcome='no_replacement';
    if decision.id is null then
      raise exception 'Recorded no-replacement decision required for provider cancellation';
    end if;
    op.policy_assessment:=op.policy_assessment || jsonb_build_object('refund_percent',100,'replacement_decision',to_jsonb(decision));
  elsif op.kind<>'customer_cancel' then
    raise exception 'Recorded no-replacement decision required for provider cancellation';
  end if;
  if op.policy_assessment->>'policy'<>'CFG-006/007'
    or coalesce(op.policy_assessment->>'refund_percent','') !~ '^(0|50|100)$' then
    raise exception 'Approved cancellation assessment required';
  end if;
  select x.* into strict o from public.money_obligations x where x.service_request_id=op.job_id;
  select x.* into strict s from public.money_snapshots x where x.id=o.current_snapshot_id;
  select a.* into strict attempt from public.money_checkout_attempts a
    where a.obligation_id=o.id and a.stripe_payment_id=p_payment and a.status='captured';
  if not exists(select 1 from public.service_requests r where r.id=op.job_id and r.status='cancelled') then
    raise exception 'Canonical cancelled service required';
  end if;
  pct:=(op.policy_assessment->>'refund_percent')::integer;
  assessment_hash:=encode(sha256(convert_to(
    jsonb_build_object('operation_id',op.id,'job_id',op.job_id,'actor_id',op.actor_id,
      'kind',op.kind,'reason',op.reason,'before',op.before_value,'assessment',op.policy_assessment,
      'created_at',op.created_at)::text,'UTF8')),'hex');
  refund_percent:=pct;
  obligation_id:=o.id;
  if o.captured>=s.total then
    target_service:=round(s.subtotal::numeric*pct/100)::bigint;
    target_tax:=round(s.tax::numeric*pct/100)::bigint;
    target_tip:=round(s.tip::numeric*pct/100)::bigint;
  else
    target_service:=round(o.captured::numeric*pct/100)::bigint;
    target_tax:=0; target_tip:=0;
  end if;
  -- Earlier adjustments and pending authorizations count toward the policy target.
  select greatest(target_service-coalesce(sum(r.service),0),0),
    greatest(target_tax-coalesce(sum(r.tax),0),0),
    greatest(target_tip-coalesce(sum(r.tip),0),0)
    into target_service,target_tax,target_tip
    from public.money_refund_authorizations r where r.obligation_id=o.id
      and not exists(select 1 from public.money_operation_refund_sources x
        where x.authorization_id=r.id and x.operation_id=p_operation);
  select coalesce(sum(greatest(a.amount-coalesce(r.reserved,0),0)),0)::bigint into prior_capacity
    from public.money_checkout_attempts a
    left join lateral (select sum(x.service+x.tax+x.tip)::bigint reserved
      from public.money_refund_authorizations x where x.payment_id=a.stripe_payment_id
        and not exists(select 1 from public.money_operation_refund_sources z
          where z.authorization_id=x.id and z.operation_id=p_operation)) r on true
    where a.obligation_id=o.id and a.status='captured' and a.stripe_payment_id is not null
      and (coalesce(a.completed_at,a.created_at),a.id)<(coalesce(attempt.completed_at,attempt.created_at),attempt.id);
  line_start:=least(prior_capacity,target_service+target_tax+target_tip);
  line_total:=least(
    greatest(attempt.amount-coalesce((select sum(r.service+r.tax+r.tip)
      from public.money_refund_authorizations r where r.payment_id=p_payment
        and not exists(select 1 from public.money_operation_refund_sources z
          where z.authorization_id=r.id and z.operation_id=p_operation)),0),0),
    greatest(target_service+target_tax+target_tip-line_start,0));
  line_end:=line_start+line_total;
  service:=greatest(least(line_end,target_service)-greatest(line_start,0),0);
  tax:=greatest(least(line_end,target_service+target_tax)-greatest(line_start,target_service),0);
  tip:=greatest(least(line_end,target_service+target_tax+target_tip)-greatest(line_start,target_service+target_tax),0);
  policy_evidence:='phase4-operation:'||op.id||':'||assessment_hash;
  business_key:='phase4-cancel:'||op.id||':'||p_payment;
  return next;
end $$;


-- Paid provider cancellation may release/rematch operational assignments, while
-- the captured agreement and original payee stay immutable. Uncertain checkout
-- and existing bank statements still require reconciliation before reassignment.
create or replace function private.money_guard_request_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (private.money_source_context(new) is distinct from private.money_source_context(old)
      or jsonb_build_array(new.current_quote_id,new.quote_revision,new.quote_status) is distinct from jsonb_build_array(old.current_quote_id,old.quote_revision,old.quote_status))
    and exists(select 1 from public.money_obligations o join public.money_checkout_attempts a on a.obligation_id=o.id
      where o.service_request_id=old.id and a.status<>'expired') then
    if exists(select 1 from public.job_operations j where j.job_id=old.id and j.kind in ('provider_cancel','no_show')
        and j.policy_assessment->>'next_action'='rematch_first')
      and new.status in ('pending','matched','quoted','scheduled')
      and (private.money_source_context(new)-array['contractor','package','tier','promotion','pricing_mode','quote_only'])
        = (private.money_source_context(old)-array['contractor','package','tier','promotion','pricing_mode','quote_only'])
      and jsonb_build_array(new.current_quote_id,new.quote_revision,new.quote_status)
        = jsonb_build_array(old.current_quote_id,old.quote_revision,old.quote_status)
      and not exists(select 1 from public.money_obligations o join public.money_checkout_attempts a on a.obligation_id=o.id
        where o.service_request_id=old.id and a.status not in ('captured','expired'))
      and not exists(select 1 from public.money_obligations o join public.money_ach_items i on i.obligation_id=o.id where o.service_request_id=old.id) then
      return new;
    end if;
    raise exception 'Commercial checkout must be reconciled before changing source';
  end if;
  return new;
end $$;

create function private.money_replacement_checkout_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.money_obligations o join public.job_operations j on j.job_id=o.service_request_id
      where o.id=new.obligation_id and o.captured>0 and j.kind in ('provider_cancel','no_show')) then
    raise exception 'Replacement commercial reconciliation required before checkout';
  end if;
  return new;
end $$;
revoke all on function private.money_replacement_checkout_guard() from public,anon,authenticated,service_role;
create trigger replacement_checkout_guard before insert on public.money_checkout_attempts
  for each row execute function private.money_replacement_checkout_guard();
create or replace function private.money_completion_source(p_obligation uuid) returns public.money_lifecycle_confirmations
language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; r public.service_requests; c public.money_lifecycle_confirmations;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict r from public.service_requests where id=o.service_request_id;
  if exists(select 1 from public.job_operations j where j.job_id=r.id and j.kind in ('provider_cancel','no_show')) then
    raise exception 'Replacement commercial reconciliation required before payout';
  end if;
  select * into c from public.money_lifecycle_confirmations where request_id=r.id order by confirmed_at desc limit 1;
  if c.id is null or c.homeowner_id is distinct from o.customer_id or c.contractor_id is distinct from o.contractor_id
    or r.customer_id is distinct from c.homeowner_id or r.contractor_id is distinct from c.contractor_id
    or r.homeowner_confirmed_at is distinct from c.confirmed_at or c.confirmed_at>now() then
    raise exception 'Verified lifecycle confirmation required';
  end if;
  return c;
end $$;
