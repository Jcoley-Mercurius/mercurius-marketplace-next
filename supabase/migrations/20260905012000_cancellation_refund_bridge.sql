-- Bind approved Phase 4 customer-cancellation assessments to exact reviewed
-- Phase 5 refund authorizations. Provider cancellations remain blocked until
-- acceptable-replacement exhaustion has its own immutable operations evidence.
create table public.money_operation_refund_sources (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.job_operations(id),
  obligation_id uuid not null references public.money_obligations(id),
  payment_id text not null,
  authorization_id uuid not null unique references public.money_refund_authorizations(id),
  assessment_hash text not null,
  refund_percent integer not null check(refund_percent in (50,100)),
  target_service bigint not null check(target_service>=0),
  target_tax bigint not null check(target_tax>=0),
  target_tip bigint not null check(target_tip>=0),
  service bigint not null check(service>=0),
  tax bigint not null check(tax>=0),
  tip bigint not null check(tip>=0),
  created_at timestamptz not null default now(),
  unique(operation_id,payment_id),
  check(service+tax+tip>0)
);
alter table public.money_operation_refund_sources enable row level security;
revoke all on public.money_operation_refund_sources from public,anon,authenticated,service_role;
grant select on public.money_operation_refund_sources to service_role;
create trigger immutable_evidence before update or delete on public.money_operation_refund_sources
  for each row execute function public.money_immutable();
-- The Phase 4 record is now financial source evidence. Corrections are new
-- operations with new keys; the assessed source itself cannot be rewritten.
create trigger immutable_money_source before update or delete on public.job_operations
  for each row execute function public.money_immutable();

create function private.money_cancellation_refund_line(p_operation uuid,p_payment text)
returns table(
  obligation_id uuid, refund_percent integer, assessment_hash text,
  target_service bigint,target_tax bigint,target_tip bigint,
  service bigint,tax bigint,tip bigint,policy_evidence text,business_key text
) language plpgsql stable security definer set search_path='' as $$
declare op public.job_operations; o public.money_obligations; s public.money_snapshots;
  attempt public.money_checkout_attempts; pct integer; prior_capacity bigint; line_total bigint;
  line_start bigint; line_end bigint; allocated_service bigint; allocated_tax bigint; allocated_tip bigint;
begin
  select j.* into strict op from public.job_operations j where j.id=p_operation;
  if op.kind<>'customer_cancel' then
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

create function public.money_preview_cancellation_refund(p_operation uuid,p_payment text,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p record;
begin
  perform public.money_require_finance(p_actor);
  select * into strict p from private.money_cancellation_refund_line(p_operation,p_payment);
  return to_jsonb(p);
end $$;

create function public.money_authorize_cancellation_refund(
  p_operation uuid,p_payment text,p_actor uuid,p_approver uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare op public.job_operations; p record; existing public.money_operation_refund_sources;
  result_id uuid; prior_authorization public.money_refund_authorizations;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  if nullif(btrim(p_reason),'') is null then raise exception 'Refund reason required'; end if;
  select * into strict op from public.job_operations where id=p_operation;
  perform pg_advisory_xact_lock(hashtextextended(op.job_id::text,0));
  perform 1 from public.service_requests where id=op.job_id for update;
  select * into existing from public.money_operation_refund_sources
    where operation_id=p_operation and payment_id=p_payment;
  if found then
    select * into strict prior_authorization from public.money_refund_authorizations where id=existing.authorization_id;
    if prior_authorization.created_by<>p_actor or prior_authorization.approved_by<>p_approver or prior_authorization.reason<>btrim(p_reason) then
      raise exception 'Cancellation refund idempotency conflict';
    end if;
    return existing.authorization_id;
  end if;
  select * into strict p from private.money_cancellation_refund_line(p_operation,p_payment);
  if p.service+p.tax+p.tip=0 then raise exception 'Cancellation policy produces no refund for this payment'; end if;
  result_id:=public.money_authorize_refund(p.obligation_id,p_payment,p.service,p.tax,p.tip,
    p.business_key,p_actor,p_approver,p.policy_evidence,btrim(p_reason));
  insert into public.money_operation_refund_sources(operation_id,obligation_id,payment_id,authorization_id,
    assessment_hash,refund_percent,target_service,target_tax,target_tip,service,tax,tip)
    values(p_operation,p.obligation_id,p_payment,result_id,p.assessment_hash,p.refund_percent,
      p.target_service,p.target_tax,p.target_tip,p.service,p.tax,p.tip);
  return result_id;
end $$;

revoke all on function private.money_cancellation_refund_line(uuid,text),
  public.money_preview_cancellation_refund(uuid,text,uuid),
  public.money_authorize_cancellation_refund(uuid,text,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.money_preview_cancellation_refund(uuid,text,uuid),
  public.money_authorize_cancellation_refund(uuid,text,uuid,uuid,text) to service_role;
