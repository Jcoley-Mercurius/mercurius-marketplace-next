-- TRACE-083: late reversals (MPS §§5.5/6.5/7; CFG-005/008; TRACE-077/080/081/082).
--
-- Two findings were left open. TRACE-082: a refund Stripe fails after reporting it succeeded was a
-- no-effect observation, so the ledger showed the customer refunded while Stripe returned the money
-- to Mercurius. TRACE-080: a bank return recorded after the provider repaid part of the payout left
-- Mercurius holding that repayment with no reviewed way to pay it back.
-- Owner decisions 2026-09-23:
--  * a refund that fails after it succeeded stands: its fee, tax and provider share stay posted, and
--    what Stripe returned is held as owed to the customer, until a resend reaches them or a release
--    reverses the refund and restores the provider's share;
--  * each step takes two finance operators: recording the failure, the resend and the release;
--  * a return after a repayment reverses the repayment. Mercurius sends it back by manual ACH and two
--    operators record that separately; the replacement statement still pays only the proceeds.
-- The evidence of a late failure is a Stripe readback of the settled refund, as TRACE-082 decided
-- for a failure before settlement. The webhook's no-effect observation of Stripe's refund.updated
-- is listed as a signal to read it back.

-- A settled refund Stripe later failed. The amount is held as owed to the customer.
create table public.money_refund_late_failures (
  failed_reference text primary key check (failed_reference like 're\_%'),
  authorization_id uuid not null references public.money_refund_attempts(authorization_id),
  obligation_id uuid not null references public.money_obligations(id),
  amount bigint not null check (amount>0),
  readback_id uuid not null unique references public.money_refund_readbacks(id),
  reason text not null check (length(trim(reason))>0),
  evidence text not null check (length(trim(evidence))>0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);
create index money_refund_late_failures_authorization on public.money_refund_late_failures(authorization_id);
create index money_refund_late_failures_obligation on public.money_refund_late_failures(obligation_id);

-- A resend's Stripe refund event that settled it. It pays what the late failure held.
create table public.money_refund_resettlements (
  provider_ref text primary key check (provider_ref like 're\_%'),
  authorization_id uuid not null references public.money_refund_attempts(authorization_id),
  failed_reference text not null unique references public.money_refund_late_failures(failed_reference),
  event_id text not null unique references public.money_webhook_events(event_id),
  created_at timestamptz not null default now()
);
create index money_refund_resettlements_authorization on public.money_refund_resettlements(authorization_id);

-- Part of a provider's repayment Mercurius sent back once the provider no longer owed it.
create table public.money_repayment_reversals (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  contractor_id uuid not null references public.contractors(id),
  amount bigint not null check (amount>0),
  returnable_before bigint not null check (returnable_before>=amount),
  business_key text not null unique check (length(business_key) between 1 and 200),
  reason text not null check (length(trim(reason))>0),
  evidence text not null check (length(trim(evidence))>0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);
create index money_repayment_reversals_obligation on public.money_repayment_reversals(obligation_id);

do $$ declare t text; begin
  foreach t in array array['money_refund_late_failures','money_refund_resettlements','money_repayment_reversals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;

-- A resend after a late failure is a reviewed send generation: it names its approver. TRACE-077
-- reissues and TRACE-082 resends are one operator and leave it null.
alter table public.money_refund_reissues add column approved_by uuid references auth.users(id);
alter table public.money_refund_reissues add constraint money_refund_reissues_second_operator
  check (approved_by is null or approved_by<>actor);

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry','ach_withdrawal',
    'ach_late_settlement','payout_recovery','bank_statement_close','refund_release',
    'refund_late_failure','refund_late_resend','refund_late_release','repayment_reversal'));
-- A resend moves no money by itself and takes a reason only, like the TRACE-082 resend.
alter table public.money_review_requests drop constraint money_review_requests_evidence_shape;
alter table public.money_review_requests add constraint money_review_requests_evidence_shape
  check ((operation in ('reconciliation_resolution','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry',
    'bank_statement_close','refund_late_resend'))=(evidence is null));

-- A repayment reversal is a bank debit to the provider. Like a repayment it carries no bank
-- reference, so a statement line pairs with it by hand.
alter table public.money_bank_line_matches drop constraint money_bank_line_matches_movement_check;
alter table public.money_bank_line_matches add constraint money_bank_line_matches_movement_check
  check (movement ~ '^(settled|returned|late|repayment|reversal):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- This refund's late failure that no resend has settled, while the refund is not released. There
-- is at most one: a failure is recorded only against the refund that delivered it.
create function private.money_refund_open_late_failure(p_authorization uuid)
returns public.money_refund_late_failures language sql stable security definer set search_path='' as $$
  select f.* from public.money_refund_late_failures f
  where f.authorization_id=p_authorization
    and not exists(select 1 from public.money_refund_resettlements x where x.failed_reference=f.failed_reference)
    and not exists(select 1 from public.money_refund_releases z where z.authorization_id=f.authorization_id)
  order by f.created_at desc limit 1
$$;

-- Whether the customer has this refund: Stripe settled it, it is not released, and no later
-- failure is open. Every check that means "the refund reached the customer" reads this.
create function private.money_refund_delivered(p_authorization uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.money_refunds where authorization_id=p_authorization)
    and not exists(select 1 from public.money_refund_releases where authorization_id=p_authorization)
    and (private.money_refund_open_late_failure(p_authorization)).failed_reference is null
$$;

-- The Stripe refund that delivered it: the latest resend that settled, or the first settlement.
-- Null when it is not delivered.
create function private.money_refund_delivered_reference(p_authorization uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when private.money_refund_delivered(p_authorization) then coalesce(
    (select x.provider_ref from public.money_refund_resettlements x where x.authorization_id=p_authorization order by x.created_at desc,x.provider_ref limit 1),
    (select f.provider_ref from public.money_refunds f where f.authorization_id=p_authorization)) end
$$;

-- The readback proving a delivered refund failed at Stripe: the latest readback of this refund,
-- naming the Stripe refund that delivered it, failed or canceled. Stripe's failed and canceled are
-- final for a refund, so a readback taken before its settlement event was processed proves it too.
-- Null when there is none.
create function private.money_refund_late_failure_readback(p_authorization uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select b.id from (select * from public.money_refund_readbacks x where x.authorization_id=p_authorization
      order by x.readback_sequence desc limit 1) b
  where b.found and b.provider_status in ('failed','canceled') and b.provider_reference=private.money_refund_delivered_reference(p_authorization)
$$;

-- What Mercurius holds for customers on this payout: open late failures.
create function private.money_customer_refund_owed(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select coalesce(sum(f.amount),0)::bigint from public.money_refund_late_failures f
  where f.obligation_id=p_obligation
    and not exists(select 1 from public.money_refund_resettlements x where x.failed_reference=f.failed_reference)
    and not exists(select 1 from public.money_refund_releases z where z.authorization_id=f.authorization_id)
$$;

-- Stripe's own word that a delivered refund failed, from the webhook's no-effect observation of
-- refund.updated. A signal to read it back, not evidence.
create function private.money_refund_late_signal(p_authorization uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('event_id',e.event_id,'status',e.payload->>'status','received_at',e.received_at)
  from public.money_webhook_events e
  where e.event_type='observation' and e.payload->>'object_id'=private.money_refund_delivered_reference(p_authorization)
    and e.payload->>'source_type' in ('refund.updated','refund.created') and e.payload->>'status' in ('failed','canceled')
  order by e.received_at desc,e.event_id limit 1
$$;

-- The exact object each late refund kernel hashes. It names the Stripe refund that failed and the
-- send's idempotency key, so an approval cannot apply after the refund was resent.
create function private.money_refund_late_command(p_operation text,p_authorization uuid,p_reference text,p_key text,p_reason text,p_evidence text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation',p_operation,'authorization',p_authorization,'reference',p_reference,'key',p_key,
    'reason',p_reason,'evidence',p_evidence)
$$;

-- Why this refund's late failure cannot be recorded now. Mirrors money_record_refund_late_failure.
create function private.money_refund_late_failure_blocker(p_authorization uuid,p_reference text,p_key text)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.money_refund_authorizations where id=p_authorization) then return 'not_found'; end if;
  if exists(select 1 from public.money_refund_late_failures where authorization_id=p_authorization and failed_reference=p_reference) then return 'completed'; end if;
  if exists(select 1 from public.money_refund_releases where authorization_id=p_authorization) then return 'refund_released'; end if;
  if not exists(select 1 from public.money_refunds where authorization_id=p_authorization) then return 'refund_not_settled'; end if;
  if (private.money_refund_open_late_failure(p_authorization)).failed_reference is not null then return 'late_failure_open'; end if;
  if private.money_refund_delivered_reference(p_authorization) is distinct from p_reference
    or (select idempotency_key from public.money_refund_attempts where authorization_id=p_authorization) is distinct from p_key then
    return 'refund_changed';
  end if;
  if private.money_refund_late_failure_readback(p_authorization) is null then return 'readback_required'; end if;
  return null;
end $$;

-- Kernel: record that a settled refund failed at Stripe. Two finance operators, bound to the exact
-- command. The refund stands; what Stripe returned is held as owed to the customer.
create function public.money_record_refund_late_failure(p_authorization uuid,p_reference text,p_key text,
  p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns text language plpgsql security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts; f public.money_refund_late_failures;
  blocker text; readback uuid; amount bigint;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_refund_late_command('refund_late_failure',p_authorization,p_reference,p_key,p_reason,p_evidence));
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  -- The order money_prepare_refund and the refund event take: obligation, then attempt.
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  select * into a from public.money_refund_attempts where authorization_id=r.id for update;
  select * into f from public.money_refund_late_failures where failed_reference=p_reference;
  if found then
    if f.authorization_id<>r.id or f.requested_by<>p_actor or f.approved_by<>p_approver or f.reason<>p_reason or f.evidence<>p_evidence then
      raise exception 'Refund late failure idempotency conflict';
    end if;
    return f.failed_reference;
  end if;
  blocker:=private.money_refund_late_failure_blocker(r.id,p_reference,p_key);
  if blocker is not null then raise exception 'Refund late failure not allowed: %',blocker using errcode='55000'; end if;
  readback:=private.money_refund_late_failure_readback(r.id);
  amount:=r.service+r.tax+r.tip;
  insert into public.money_refund_late_failures(failed_reference,authorization_id,obligation_id,amount,readback_id,reason,evidence,requested_by,approved_by)
    values(p_reference,r.id,r.obligation_id,amount,readback,p_reason,p_evidence,p_actor,p_approver);
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(r.obligation_id,'refund-late-failure:'||p_reference,'refund_late_failure',
    jsonb_build_array(jsonb_build_object('account','stripe_clearing','debit',amount,'credit',0),
      jsonb_build_object('account','customer_refund_payable','debit',0,'credit',amount)),p_evidence);
  -- The attempt shows what Stripe shows: the current refund failed.
  update public.money_refund_attempts set status='failed' where authorization_id=r.id;
  return p_reference;
end $$;

-- Why a late-failed refund's current send is not known to have failed, or null when it is: the
-- late failure itself, a failed resend a readback proved (TRACE-082 F1), or an uncertain resend
-- Stripe has no refund for a day later (TRACE-077). Shared by the resend and the release.
create function private.money_refund_late_send_blocker(p_authorization uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_refund_attempts; f public.money_refund_late_failures; b public.money_refund_readbacks;
begin
  select * into a from public.money_refund_attempts where authorization_id=p_authorization;
  f:=private.money_refund_open_late_failure(p_authorization);
  if a.status='failed' then
    if a.provider_reference=f.failed_reference or private.money_refund_failure_readback(p_authorization) is not null then return null; end if;
    return 'readback_required';
  elsif a.status='reconcile' then
    if a.provider_reference is not null then return 'refund_found_at_stripe'; end if;
    select * into b from public.money_refund_readbacks where authorization_id=a.authorization_id order by readback_sequence desc limit 1;
    if not found or b.found then return 'readback_required'; end if;
    if b.created_at<coalesce(a.prepared_at,a.created_at)+interval '24 hours' then return 'readback_too_early'; end if;
    return null;
  end if;
  return 'refund_in_flight';
end $$;

-- The readback the next resend or release relies on. Call only when the send blocker is null.
create function private.money_refund_late_send_evidence(p_authorization uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select case
    when a.status='failed' and a.provider_reference=f.failed_reference then f.readback_id
    when a.status='failed' then private.money_refund_failure_readback(a.authorization_id)
    else (select b.id from public.money_refund_readbacks b where b.authorization_id=a.authorization_id order by b.readback_sequence desc limit 1) end
  from public.money_refund_attempts a cross join private.money_refund_open_late_failure(p_authorization) f
  where a.authorization_id=p_authorization
$$;

-- Why the customer's late-failed refund cannot be resent now. Mirrors money_resend_late_refund.
create function private.money_refund_late_resend_blocker(p_authorization uuid,p_reference text,p_key text)
returns text language plpgsql stable security definer set search_path='' as $$
declare f public.money_refund_late_failures;
begin
  if not exists(select 1 from public.money_refund_authorizations where id=p_authorization) then return 'not_found'; end if;
  if exists(select 1 from public.money_refund_reissues where authorization_id=p_authorization and previous_key=p_key and approved_by is not null) then return 'completed'; end if;
  if exists(select 1 from public.money_refund_releases where authorization_id=p_authorization) then return 'refund_released'; end if;
  f:=private.money_refund_open_late_failure(p_authorization);
  if f.failed_reference is null then return 'no_late_failure'; end if;
  if f.failed_reference is distinct from p_reference
    or (select idempotency_key from public.money_refund_attempts where authorization_id=p_authorization) is distinct from p_key then
    return 'refund_changed';
  end if;
  -- A customer who disputed the payment may be repaid by the chargeback; refunding again could pay twice.
  if exists(select 1 from public.money_disputes d where d.obligation_id=f.obligation_id and d.status in ('open','lost')) then return 'chargeback_open'; end if;
  return private.money_refund_late_send_blocker(p_authorization);
end $$;

-- Kernel: send the same reviewed refund again after it failed late. Two finance operators, bound
-- to the exact command. A new send generation under a new Stripe idempotency key; the Stripe refund
-- that failed is kept on the generation, so no readback can record it again (TRACE-082 F3).
create function public.money_resend_late_refund(p_authorization uuid,p_reference text,p_key text,p_actor uuid,p_approver uuid,p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts; x public.money_refund_reissues;
  blocker text; next_generation integer; next_key text;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_refund_late_command('refund_late_resend',p_authorization,p_reference,p_key,p_reason,null));
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  select * into a from public.money_refund_attempts where authorization_id=r.id for update;
  select * into x from public.money_refund_reissues where authorization_id=r.id and previous_key=p_key and approved_by is not null;
  if found then
    if x.actor<>p_actor or x.approved_by<>p_approver or x.reason<>p_reason then raise exception 'Refund resend idempotency conflict'; end if;
    return x.generation;
  end if;
  blocker:=private.money_refund_late_resend_blocker(r.id,p_reference,p_key);
  if blocker is not null then raise exception 'Refund resend not allowed: %',blocker using errcode='55000'; end if;
  next_generation:=coalesce((select max(generation) from public.money_refund_reissues where authorization_id=r.id),1)+1;
  next_key:='mercurius:refund-v1:'||r.id||':g'||next_generation;
  insert into public.money_refund_reissues(authorization_id,generation,readback_id,previous_key,idempotency_key,actor,reason,failed_reference,approved_by)
    values(r.id,next_generation,private.money_refund_late_send_evidence(r.id),a.idempotency_key,next_key,p_actor,p_reason,a.provider_reference,p_approver);
  update public.money_refund_attempts set status='prepared',idempotency_key=next_key,prepared_at=now(),provider_reference=null
    where authorization_id=r.id;
  return next_generation;
end $$;

-- The journal lines that reverse this refund now against the customer refund payable, and the
-- provider share they restore. An advance refund returns to the advance. Otherwise the 15% fee is
-- computed again on the retained service, as a refund and a chargeback compute it, so the fee and
-- the provider's proceeds match what reconciliation expects after the counters are restored.
create function private.money_refund_reversal(p_authorization uuid)
returns table(lines jsonb,provider bigint,advance boolean) language plpgsql stable security definer set search_path='' as $$
declare r public.money_refund_authorizations; ret record; old_fee bigint; new_fee bigint; amount bigint;
begin
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  amount:=r.service+r.tax+r.tip;
  advance:=exists(select 1 from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.business_key='refund:'||r.id and l->>'account'='customer_advance');
  lines:=jsonb_build_array(jsonb_build_object('account','customer_refund_payable','debit',amount,'credit',0));
  if advance then
    provider:=0;
    lines:=lines||jsonb_build_array(jsonb_build_object('account','customer_advance','debit',0,'credit',amount));
  else
    select * into strict ret from public.money_retained_parts(r.obligation_id);
    old_fee:=round(ret.service::numeric*15/100); new_fee:=round((ret.service+r.service)::numeric*15/100);
    provider:=r.service-(new_fee-old_fee)+r.tip;
    if new_fee>old_fee then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',0,'credit',new_fee-old_fee)); end if;
    if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',0,'credit',provider)); end if;
    if r.tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',0,'credit',r.tax)); end if;
  end if;
  return next;
end $$;

-- What the bank has paid on this payout and kept: settled less returned transfers, plus late
-- payments. Repayments are not netted here.
create function private.money_payout_gross_paid(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select ((select coalesce(sum(i.amount) filter (where e.status='settled'),0)-coalesce(sum(i.amount) filter (where e.status='returned'),0)
      from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id join public.money_ach_events e on e.attempt_id=a.id
      where i.obligation_id=p_obligation)
    +(select coalesce(sum(amount),0) from public.money_ach_late_settlements where obligation_id=p_obligation))::bigint
$$;

-- The payout's provider proceeds from its retained amounts: money_payable's amount.
create function private.money_payout_proceeds(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select coalesce((select r.service-round(r.service::numeric*15/100)+r.tip from public.money_retained_parts(p_obligation) r),0)::bigint
$$;

-- Why the customer's late-failed refund cannot be released now. Mirrors money_release_late_refund.
create function private.money_refund_late_release_blocker(p_authorization uuid,p_reference text,p_key text)
returns text language plpgsql stable security definer set search_path='' as $$
declare r public.money_refund_authorizations; f public.money_refund_late_failures; blocker text; rev record; gross bigint;
begin
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_refund_releases where authorization_id=r.id) then return 'completed'; end if;
  f:=private.money_refund_open_late_failure(r.id);
  if f.failed_reference is null then return 'no_late_failure'; end if;
  if f.failed_reference is distinct from p_reference
    or (select idempotency_key from public.money_refund_attempts where authorization_id=r.id) is distinct from p_key then
    return 'refund_changed';
  end if;
  blocker:=private.money_refund_late_send_blocker(r.id);
  if blocker is not null then return blocker; end if;
  -- Restoring the provider's share changes the proceeds: wait for the bank, as a refund does (TRACE-080 R2).
  if private.money_ach_unpaid_statement(r.obligation_id) then return 'on_ach_statement'; end if;
  select * into strict rev from private.money_refund_reversal(r.id);
  if rev.advance and exists(select 1 from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id
    where o.id=r.obligation_id and o.captured=s.total) then
    return 'advance_captured';
  end if;
  -- A paid payout is never paid again, so restoring the share must not leave the provider short of
  -- proceeds the bank already paid. What they repaid comes back through a repayment reversal.
  gross:=private.money_payout_gross_paid(r.obligation_id);
  if gross>0 and private.money_payout_proceeds(r.obligation_id)+rev.provider>gross then return 'payout_paid'; end if;
  return null;
end $$;

-- Kernel: release a late-failed refund. Two finance operators, bound to the exact command. The
-- refund is reversed against what was held for the customer: the fee, tax and provider share are
-- restored and the invoice's refund counters drop by its amount. The authorization is released
-- (TRACE-082), so it no longer counts against the refund caps and is never sent again.
create function public.money_release_late_refund(p_authorization uuid,p_reference text,p_key text,
  p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts; z public.money_refund_releases;
  blocker text; rev record;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_refund_late_command('refund_late_release',p_authorization,p_reference,p_key,p_reason,p_evidence));
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  -- Lifecycle, then obligation, then attempt: the order refunds, recoveries and ACH take.
  perform private.money_lock_lifecycle(array[r.obligation_id]);
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  select * into a from public.money_refund_attempts where authorization_id=r.id for update;
  select * into z from public.money_refund_releases where authorization_id=r.id;
  if found then
    if z.requested_by<>p_actor or z.approved_by<>p_approver or z.reason<>p_reason or z.evidence<>p_evidence then
      raise exception 'Refund release idempotency conflict';
    end if;
    return r.id;
  end if;
  blocker:=private.money_refund_late_release_blocker(r.id,p_reference,p_key);
  if blocker is not null then raise exception 'Refund release not allowed: %',blocker using errcode='55000'; end if;
  select * into strict rev from private.money_refund_reversal(r.id);
  insert into public.money_refund_releases(authorization_id,obligation_id,amount,failed_reference,readback_id,reason,evidence,requested_by,approved_by)
    values(r.id,r.obligation_id,r.service+r.tax+r.tip,coalesce(a.provider_reference,p_reference),private.money_refund_late_send_evidence(r.id),
      p_reason,p_evidence,p_actor,p_approver);
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence)
    values(r.obligation_id,'refund-reversal:'||r.id,'refund_reversal',rev.lines,p_evidence);
  update public.money_obligations set refunded_service=refunded_service-r.service,refunded_tax=refunded_tax-r.tax,refunded_tip=refunded_tip-r.tip
    where id=r.obligation_id;
  return r.id;
end $$;

-- Whether a refund event is a resend's settlement: the event names a refund other than the one that
-- first settled its authorization. The unchanged payment kernel would refuse it as a conflict.
create function private.money_refund_event_resettles(p_event public.money_webhook_events)
returns boolean language sql stable security definer set search_path='' as $$
  select p_event.event_type='refund' and exists(select 1 from public.money_refunds f
    where f.authorization_id::text=p_event.payload->>'authorization_id' and f.provider_ref is distinct from p_event.payload->>'refund_id')
$$;

-- A resend's Stripe refund event. It settles what the open late failure held for the customer.
-- Receipt and retry follow money_process_payment_event: a failure keeps the event for reconciliation.
create function private.money_process_refund_resettlement(p_event text)
returns text language plpgsql security definer set search_path='' as $$
declare e public.money_webhook_events; r public.money_refund_authorizations; a public.money_refund_attempts;
  f public.money_refund_late_failures; x public.money_refund_resettlements; currency text; code text;
begin
  select * into strict e from public.money_webhook_events where event_id=p_event for update;
  if e.status in ('processed','dead_letter') then return e.status; end if;
  update public.money_webhook_events set status='processing',attempt_count=attempt_count+1 where event_id=p_event;
  begin
    select * into strict r from public.money_refund_authorizations where id=(e.payload->>'authorization_id')::uuid;
    perform 1 from public.money_obligations where id=r.obligation_id for update;
    select * into strict a from public.money_refund_attempts where authorization_id=r.id for update;
    select s.currency into strict currency from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=r.obligation_id;
    if r.service+r.tax+r.tip is distinct from (e.payload->>'amount')::bigint or e.payload->>'currency' is distinct from currency
      or e.payload->>'payment_id' is distinct from r.payment_id or coalesce(e.payload->>'refund_id','') not like 're_%' then raise exception 'Refund mismatch'; end if;
    select * into x from public.money_refund_resettlements where provider_ref=e.payload->>'refund_id';
    if found then
      if x.authorization_id<>r.id then raise exception 'Refund identity conflict'; end if;
    else
      f:=private.money_refund_open_late_failure(r.id);
      if f.failed_reference is null then raise exception 'Refund identity conflict'; end if;
      if a.provider_reference is not null and a.provider_reference<>e.payload->>'refund_id' then raise exception 'Refund identity conflict'; end if;
      insert into public.money_refund_resettlements(provider_ref,authorization_id,failed_reference,event_id)
        values(e.payload->>'refund_id',r.id,f.failed_reference,e.event_id);
      insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(r.obligation_id,'refund-resettlement:'||(e.payload->>'refund_id'),
        'refund_resettlement',jsonb_build_array(jsonb_build_object('account','customer_refund_payable','debit',f.amount,'credit',0),
          jsonb_build_object('account','stripe_clearing','debit',0,'credit',f.amount)),e.event_id);
      update public.money_refund_attempts set status='succeeded',provider_reference=e.payload->>'refund_id' where authorization_id=r.id;
    end if;
    update public.money_webhook_events set status='processed',processed_at=now(),last_error=null,next_retry_at=null where event_id=p_event;
    return 'processed';
  exception when others then
    get stacked diagnostics code=returned_sqlstate;
    update public.money_webhook_events set status=case when attempt_count>=5 then 'dead_letter' else 'failed' end,
      last_error=code,next_retry_at=now()+interval '5 minutes' where event_id=p_event;
    return 'failed';
  end;
end $$;

-- What the provider repaid that Mercurius now owes back: repayments not yet returned, less what the
-- bank's payments still exceed the proceeds by. It is positive once a return, or a released refund,
-- leaves a repayment covering an amount the provider no longer owes.
create function private.money_repayment_returnable(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select greatest(
    (select coalesce(sum(amount),0) from public.money_payout_recoveries where obligation_id=p_obligation and kind='repayment')
    -(select coalesce(sum(amount),0) from public.money_repayment_reversals where obligation_id=p_obligation)
    -greatest(private.money_payout_gross_paid(p_obligation)-private.money_payout_proceeds(p_obligation),0),0)::bigint
$$;

-- The exact object money_record_repayment_reversal hashes. It names the amount returnable when it
-- was requested, so two approved reversals of the same repayment cannot both run.
create function private.money_repayment_reversal_command(p_obligation uuid,p_amount bigint,p_returnable bigint,p_reason text,p_evidence text,p_key text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','repayment_reversal','obligation',p_obligation,'amount',p_amount,'returnable',p_returnable,
    'reason',p_reason,'evidence',p_evidence,'key',p_key)
$$;

-- Why this repayment reversal cannot be recorded now. Mirrors money_record_repayment_reversal.
create function private.money_repayment_reversal_blocker(p_obligation uuid,p_amount bigint,p_returnable bigint,p_key text)
returns text language plpgsql stable security definer set search_path='' as $$
declare returnable bigint;
begin
  if not exists(select 1 from public.money_obligations where id=p_obligation) then return 'not_found'; end if;
  if exists(select 1 from public.money_repayment_reversals where business_key=p_key) then return 'completed'; end if;
  if p_amount is null or p_amount<=0 then return 'reversal_invalid'; end if;
  returnable:=private.money_repayment_returnable(p_obligation);
  if returnable=0 then return 'nothing_returnable'; end if;
  if returnable is distinct from p_returnable then return 'returnable_changed'; end if;
  if p_amount>returnable then return 'exceeds_returnable'; end if;
  return null;
end $$;

-- Kernel: record that Mercurius sent part of a provider's repayment back. Two finance operators,
-- bound to the amount returnable when requested. Record it once the bank shows the debit.
create function public.money_record_repayment_reversal(p_obligation uuid,p_amount bigint,p_returnable bigint,p_key text,
  p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.money_repayment_reversals; blocker text;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_repayment_reversal_command(p_obligation,p_amount,p_returnable,p_reason,p_evidence,p_key));
  -- Lifecycle, then obligation: the order recoveries, refunds and ACH take.
  perform private.money_lock_lifecycle(array[p_obligation]);
  perform 1 from public.money_obligations where id=p_obligation for update;
  if not found then raise exception 'Finance obligation not found'; end if;
  select * into v from public.money_repayment_reversals where business_key=p_key;
  if found then
    if v.obligation_id<>p_obligation or v.amount<>p_amount or v.returnable_before<>p_returnable or v.requested_by<>p_actor
      or v.approved_by<>p_approver or v.reason<>p_reason or v.evidence<>p_evidence then
      raise exception 'Repayment reversal idempotency conflict';
    end if;
    return v.id;
  end if;
  blocker:=private.money_repayment_reversal_blocker(p_obligation,p_amount,p_returnable,p_key);
  if blocker is not null then raise exception 'Repayment reversal not allowed: %',blocker using errcode='55000'; end if;
  insert into public.money_repayment_reversals(obligation_id,contractor_id,amount,returnable_before,business_key,reason,evidence,requested_by,approved_by)
    values(p_obligation,private.money_effective_contractor(p_obligation),p_amount,p_returnable,p_key,p_reason,p_evidence,p_actor,p_approver)
    returning * into v;
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(p_obligation,'repayment-reversal:'||v.id,'payout_repayment_reversal',
    jsonb_build_array(jsonb_build_object('account','provider_payable','debit',p_amount,'credit',0),
      jsonb_build_object('account','bank','debit',0,'credit',p_amount)),p_evidence);
  return v.id;
end $$;

-- Gateway: one reviewed request for each late refund step. 'failure' names the Stripe refund that
-- delivered it; 'resend' and 'release' name the late failure they act on. Each also names the send's
-- idempotency key, so any resend makes an older request stale. A replay keeps what it first named.
create function public.money_operator_request_late_refund(p_action text,p_authorization uuid,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.money_refund_authorizations; step text; reason text; evidence text;
  prior jsonb; reference text; send_key text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  if p_action is null or p_action not in ('failure','resend','release') then
    raise exception 'Late refund step must be failure, resend or release' using errcode='22023';
  end if;
  step:='refund_late_'||p_action;
  if p_action<>'resend' then perform private.money_require_text(p_evidence,'Evidence'); evidence:=btrim(p_evidence); end if;
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then raise exception 'Refund authorization not found' using errcode='P0002'; end if;
  reason:=btrim(p_reason);
  select q.command into prior from public.money_review_requests q where q.business_key=p_key and q.operation=step;
  if prior is not null then
    reference:=prior->>'reference'; send_key:=prior->>'key';
  else
    reference:=case when p_action='failure' then private.money_refund_delivered_reference(r.id)
      else (private.money_refund_open_late_failure(r.id)).failed_reference end;
    select idempotency_key into send_key from public.money_refund_attempts where authorization_id=r.id;
  end if;
  return private.money_store_review_request(actor,p_key,step,r.id::text,r.obligation_id,
    private.money_refund_late_command(step,r.id,reference,send_key,reason,evidence),reason,evidence,true,null::jsonb);
end $$;

-- Gateway: a repayment reversal is a reviewed request bound to the amount returnable now.
create function public.money_operator_request_repayment_reversal(p_obligation uuid,p_amount bigint,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reason text; evidence text; returnable bigint;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  if p_amount is null or p_amount<=0 then raise exception 'Reversal amount in cents required' using errcode='22023'; end if;
  if not exists(select 1 from public.money_obligations where id=p_obligation) then
    raise exception 'Finance obligation not found' using errcode='P0002';
  end if;
  reason:=btrim(p_reason); evidence:=btrim(p_evidence);
  select (q.command->>'returnable')::bigint into returnable from public.money_review_requests q where q.business_key=p_key and q.operation='repayment_reversal';
  if returnable is null then returnable:=private.money_repayment_returnable(p_obligation); end if;
  return private.money_store_review_request(actor,p_key,'repayment_reversal',p_obligation::text,p_obligation,
    private.money_repayment_reversal_command(p_obligation,p_amount,returnable,reason,evidence,p_key),reason,evidence,true,null::jsonb);
end $$;

-- What a late refund request asks for, so the approver sees the exact refund and its state.
create function private.money_refund_late_request_details(p_request public.money_review_requests)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('authorization_id',r.id,'payment_id',r.payment_id,'service',r.service,'tax',r.tax,'tip',r.tip,
    'amount',r.service+r.tax+r.tip,'provider_reference',p_request.command->>'reference',
    'attempt_status',(select a.status from public.money_refund_attempts a where a.authorization_id=r.id),
    'provider_status',(select b.provider_status from public.money_refund_readbacks b where b.authorization_id=r.id
      order by b.readback_sequence desc limit 1),
    'restores_provider',case when p_request.operation='refund_late_release' then (select v.provider from private.money_refund_reversal(r.id) v) end)
  from public.money_refund_authorizations r where r.id=p_request.subject::uuid
$$;

-- What a repayment reversal request asks for.
create function private.money_repayment_reversal_request_details(p_request public.money_review_requests)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('amount',(p_request.command->>'amount')::bigint,'returnable',(p_request.command->>'returnable')::bigint,
    'returnable_now',private.money_repayment_returnable(p_request.obligation_id),
    'payee_name',(select c.name from public.contractors c where c.id=private.money_effective_contractor(p_request.obligation_id)))
$$;

-- The latest open request of an operation on a subject.
create function private.money_open_request(p_operation text,p_subject text)
returns uuid language sql stable security definer set search_path='' as $$
  select q.id from public.money_review_requests q where q.operation=p_operation and q.subject=p_subject
    and now()<private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
  order by q.created_at desc limit 1
$$;

-- Settled refunds that failed or may have failed at Stripe, for the operator readback: refunds
-- with an open late failure, delivered refunds a readback or Stripe event shows failed, and late
-- failures resettled or released in the last 30 days.
create function private.money_late_refund_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(t.item order by t.created_at desc,t.id),'[]'::jsonb) from (
    select r.id,r.created_at,jsonb_build_object(
      'authorization_id',r.id,'obligation_id',r.obligation_id,
      'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=r.obligation_id),
      'payment_id',r.payment_id,'amount',r.service+r.tax+r.tip,
      'state',case when z.authorization_id is not null then 'released'
        when f.failed_reference is not null then 'customer_owed'
        when last_failure.failed_reference is not null then 'redelivered'
        else 'failure_signal' end,
      'delivered_reference',d.provider_ref,
      'attempt_status',t.status,'provider_reference',t.provider_reference,
      'generation',1+(select count(*) from public.money_refund_reissues x where x.authorization_id=r.id),
      'signal',private.money_refund_late_signal(r.id),
      'last_readback',(select jsonb_build_object('found',b.found,'provider_reference',b.provider_reference,'provider_status',b.provider_status,
          'by_me',b.actor=p_me,'created_at',b.created_at)
        from public.money_refund_readbacks b where b.authorization_id=r.id order by b.readback_sequence desc limit 1),
      'late_failure',case when coalesce(f.failed_reference,last_failure.failed_reference) is not null then (select jsonb_build_object(
          'failed_reference',x.failed_reference,'reason',x.reason,'evidence',x.evidence,'by_me',p_me in (x.requested_by,x.approved_by),'created_at',x.created_at)
        from public.money_refund_late_failures x where x.failed_reference=coalesce(f.failed_reference,last_failure.failed_reference)) end,
      'can_send',p_me in (r.created_by,r.approved_by),
      'failure_blocker',case when d.provider_ref is not null then private.money_refund_late_failure_blocker(r.id,d.provider_ref,t.idempotency_key) end,
      'resend_blocker',case when f.failed_reference is not null then private.money_refund_late_resend_blocker(r.id,f.failed_reference,t.idempotency_key) end,
      'release_blocker',case when f.failed_reference is not null then private.money_refund_late_release_blocker(r.id,f.failed_reference,t.idempotency_key) end,
      'open_failure_request_id',private.money_open_request('refund_late_failure',r.id::text),
      'open_resend_request_id',private.money_open_request('refund_late_resend',r.id::text),
      'open_release_request_id',private.money_open_request('refund_late_release',r.id::text),
      'created_at',r.created_at) item
    from public.money_refund_authorizations r
    join public.money_refund_attempts t on t.authorization_id=r.id
    left join lateral (select * from private.money_refund_open_late_failure(r.id) x where x.failed_reference is not null) f on true
    left join lateral (select x.failed_reference from public.money_refund_late_failures x where x.authorization_id=r.id
      order by x.created_at desc limit 1) last_failure on true
    left join public.money_refund_releases z on z.authorization_id=r.id
      and exists(select 1 from public.money_refunds x where x.authorization_id=r.id)
    cross join lateral (select private.money_refund_delivered_reference(r.id) provider_ref) d
    where exists(select 1 from public.money_refunds x where x.authorization_id=r.id)
      and (f.failed_reference is not null
        or (d.provider_ref is not null and (private.money_refund_late_failure_readback(r.id) is not null or private.money_refund_late_signal(r.id) is not null))
        or exists(select 1 from public.money_refund_late_failures x where x.authorization_id=r.id and x.created_at>now()-interval '30 days')
        or exists(select 1 from public.money_refund_resettlements x where x.authorization_id=r.id and x.created_at>now()-interval '30 days')
        or (z.authorization_id is not null and z.created_at>now()-interval '30 days'))
    order by r.created_at desc,r.id limit 200) t
$$;

-- Repayments Mercurius owes back, and reversals in the last 30 days, for the operator readback.
create function private.money_repayment_return_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'returnable_total',(select coalesce(sum(private.money_repayment_returnable(o.id)),0) from public.money_obligations o
      where exists(select 1 from public.money_payout_recoveries x where x.obligation_id=o.id and x.kind='repayment')),
    'payouts',coalesce((select jsonb_agg(p.item order by p.returnable desc,p.id) from (
      select o.id,private.money_repayment_returnable(o.id) returnable,jsonb_build_object(
        'obligation_id',o.id,
        'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=o.current_snapshot_id),
        'payee_name',(select c.name from public.contractors c where c.id=private.money_effective_contractor(o.id)),
        'returnable',private.money_repayment_returnable(o.id),
        'repaid',(select coalesce(sum(amount),0) from public.money_payout_recoveries where obligation_id=o.id and kind='repayment'),
        'reversed',(select coalesce(sum(amount),0) from public.money_repayment_reversals where obligation_id=o.id),
        'paid',private.money_payout_gross_paid(o.id),
        'proceeds',private.money_payout_proceeds(o.id),
        'reversals',coalesce((select jsonb_agg(jsonb_build_object('amount',v.amount,'returnable_before',v.returnable_before,'reason',v.reason,
            'evidence',v.evidence,'by_me',p_me in (v.requested_by,v.approved_by),'created_at',v.created_at) order by v.created_at,v.id)
          from public.money_repayment_reversals v where v.obligation_id=o.id),'[]'::jsonb),
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='repayment_reversal' and q.obligation_id=o.id
          and now()<private.money_review_expires_at(q.created_at)
          and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1)) item
      from public.money_obligations o
      where exists(select 1 from public.money_payout_recoveries x where x.obligation_id=o.id and x.kind='repayment')
        and (private.money_repayment_returnable(o.id)>0
          or exists(select 1 from public.money_repayment_reversals v where v.obligation_id=o.id and v.created_at>now()-interval '30 days'))
      order by 2 desc,o.id limit 200) p),'[]'::jsonb))
$$;

-- Each body below is the latest definition, copied by a generator that asserts exactly one match per
-- substitution. Only the lines named in each note change.

-- public.money_check_journal: latest body from 20260921003000_money_payout_recovery.sql; adds the customer_refund_payable account.
create or replace function public.money_check_journal() returns trigger language plpgsql set search_path = '' as $$
declare line jsonb; debit numeric; credit numeric; balance numeric := 0;
begin
  if jsonb_typeof(new.lines) <> 'array' or jsonb_array_length(new.lines) < 2 then raise exception 'Invalid journal'; end if;
  for line in select * from jsonb_array_elements(new.lines) loop
    debit := (line->>'debit')::numeric; credit := (line->>'credit')::numeric;
    if debit is null or credit is null or debit < 0 or credit < 0 or trunc(debit) <> debit or trunc(credit) <> credit
      or (debit > 0) = (credit > 0) or greatest(debit,credit) > 9007199254740991
      or coalesce(line->>'account','') not in ('stripe_clearing','customer_advance','platform_revenue','tax_liability','provider_payable','processor_expense','chargeback_suspense','bank','provider_recovery_loss','customer_refund_payable')
      then raise exception 'Invalid posting'; end if;
    balance := balance + debit - credit;
  end loop;
  if balance <> 0 then raise exception 'Unbalanced journal'; end if;
  return new;
end $$;


-- public.money_process_event: latest body from 20260905004000_money_reconciliation.sql; a refund event that settles a resend goes to the resettlement handler; the payment kernel is unchanged.
create or replace function public.money_process_event(p_event text) returns text language plpgsql security definer set search_path='' as $$
declare e public.money_webhook_events; a public.money_checkout_attempts; o public.money_obligations; d public.money_disputes; state text; code text;
begin
  select * into strict e from public.money_webhook_events where event_id=p_event for update;
  if exists(select 1 from public.money_event_exclusions where event_id=p_event) then return 'reviewed_no_effect'; end if;
  if private.money_refund_event_resettles(e) then return private.money_process_refund_resettlement(p_event); end if;
  if e.event_type in ('capture','refund') then return public.money_process_payment_event(p_event); end if;
  if e.status in ('processed','dead_letter') then return e.status; end if;
  update public.money_webhook_events set status='processing',attempt_count=attempt_count+1 where event_id=p_event;
  begin
    if e.event_type='observation' then
      -- Retained, nonfinancial observations do not regress successful payment/job state.
      null;
    elsif e.event_type='checkout_expired' then
      select * into strict a from public.money_checkout_attempts where id=(e.payload->>'attempt_id')::uuid;
      perform 1 from public.money_obligations where id=a.obligation_id for update;
      select * into strict a from public.money_checkout_attempts where id=a.id for update;
      if coalesce(e.payload->>'session_id','') not like 'cs_%' or (a.stripe_session_id is not null and a.stripe_session_id<>e.payload->>'session_id') then raise exception 'Expired session identity mismatch'; end if;
      if a.status='captured' then raise exception 'Paid session cannot expire'; end if;
      update public.money_checkout_attempts set status='expired',stripe_session_id=e.payload->>'session_id' where id=a.id;
    elsif e.event_type='dispute' then
      select * into strict a from public.money_checkout_attempts where stripe_payment_id=e.payload->>'payment_id' and status='captured';
      select * into strict o from public.money_obligations where id=a.obligation_id for update;
      state:=e.payload->>'state';
      if state is null or state not in ('open','won','lost') or e.payload->>'currency' is distinct from 'usd'
        or (e.payload->>'amount')::bigint is null or (e.payload->>'amount')::bigint>a.amount then raise exception 'Dispute mismatch'; end if;
      select * into d from public.money_disputes where provider_id=e.payload->>'dispute_id' for update;
      if not found then
        insert into public.money_disputes(provider_id,obligation_id,payment_id,amount,status)
          values(e.payload->>'dispute_id',o.id,a.stripe_payment_id,(e.payload->>'amount')::bigint,'open') returning * into d;
        insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'dispute-open:'||d.provider_id,'chargeback_suspense',jsonb_build_array(
          jsonb_build_object('account','chargeback_suspense','debit',d.amount,'credit',0),jsonb_build_object('account','stripe_clearing','debit',0,'credit',d.amount)),e.event_id);
      elsif d.obligation_id<>o.id or d.payment_id<>a.stripe_payment_id or d.amount<>(e.payload->>'amount')::bigint then raise exception 'Dispute identity conflict'; end if;
      if d.status<>'open' and state<>'open' and d.status<>state then raise exception 'Conflicting dispute outcomes'; end if;
      if d.status='open' and state in ('won','lost') then
        update public.money_disputes set status=state where provider_id=d.provider_id;
        if state='won' then
          insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'dispute-won:'||d.provider_id,'chargeback_won',jsonb_build_array(
            jsonb_build_object('account','stripe_clearing','debit',d.amount,'credit',0),jsonb_build_object('account','chargeback_suspense','debit',0,'credit',d.amount)),e.event_id);
        end if;
      end if;
      insert into public.money_dispute_events(event_id,dispute_id,state) values(e.event_id,d.provider_id,state);
      update public.money_obligations set dispute_open=exists(select 1 from public.money_disputes x where x.obligation_id=o.id and
        (x.status='open' or (x.status='lost' and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=x.provider_id)))) where id=o.id;
    else raise exception 'Provider reconciliation required'; end if;
    update public.money_webhook_events set status='processed',processed_at=now(),last_error=null,next_retry_at=null where event_id=p_event;
    return 'processed';
  exception when others then
    get stacked diagnostics code=returned_sqlstate;
    update public.money_webhook_events set status=case when attempt_count>=5 then 'dead_letter' else 'failed' end,last_error=code,next_retry_at=now()+interval '5 minutes' where event_id=p_event;
    return 'failed';
  end;
end $$;


-- public.money_prepare_refund: latest body from 20260917001000_money_finance_refunds.sql; a refund whose late failure is open, or that was released, is not reported succeeded.
create or replace function public.money_prepare_refund(p_authorization uuid,p_actor uuid) returns public.money_refund_attempts language plpgsql security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts;
begin
  perform public.money_require_finance(p_actor);
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  if p_actor not in (r.created_by,r.approved_by) then raise exception 'Refund actor not authorized' using errcode='42501'; end if;
  insert into public.money_refund_attempts(authorization_id,payment_id,amount,idempotency_key)
    values(r.id,r.payment_id,r.service+r.tax+r.tip,'mercurius:refund-v1:'||r.id) on conflict do nothing;
  select * into strict a from public.money_refund_attempts where authorization_id=r.id for update;
  if private.money_refund_delivered(r.id) then
    update public.money_refund_attempts set status='succeeded' where authorization_id=r.id returning * into a;
  elsif a.status='prepared' and coalesce(a.prepared_at,a.created_at)<=now()-interval '23 hours' then
    update public.money_refund_attempts set status='reconcile' where authorization_id=r.id returning * into a;
  end if;
  return a;
end $$;


-- public.money_record_refund_result: latest body from 20260905006000_refund_attempts.sql; the attempt reads succeeded only while the customer has the refund.
create or replace function public.money_record_refund_result(p_authorization uuid,p_reference text,p_status text,p_amount bigint) returns void language plpgsql security definer set search_path='' as $$
declare a public.money_refund_attempts;
begin
  select * into strict a from public.money_refund_attempts where authorization_id=p_authorization for update;
  if a.amount is distinct from p_amount or coalesce(p_reference,'') not like 're_%' or p_status is null or p_status not in ('succeeded','pending','failed','canceled','requires_action') then raise exception 'Refund provider mismatch'; end if;
  if a.provider_reference is not null and a.provider_reference<>p_reference then raise exception 'Refund reference conflict'; end if;
  insert into public.money_refund_attempt_events(authorization_id,provider_reference,status,amount) values(a.authorization_id,p_reference,p_status,p_amount);
  update public.money_refund_attempts set provider_reference=p_reference,status=case
    when private.money_refund_delivered(a.authorization_id) then 'succeeded'
    when p_status in ('failed','canceled') then 'failed' else 'pending' end where authorization_id=a.authorization_id;
end $$;


-- public.money_refund_readback_target: latest body from 20260922002000_money_failed_refund_recovery.sql; adds whether the refund is delivered and whether a late failure is open.
create or replace function public.money_refund_readback_target(p_authorization uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts;
begin
  perform public.money_require_finance(p_actor);
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then raise exception 'Refund authorization not found' using errcode='P0002'; end if;
  select * into a from public.money_refund_attempts where authorization_id=r.id;
  return jsonb_build_object('authorization_id',r.id,'payment_id',r.payment_id,'amount',r.service+r.tax+r.tip,
    'attempt_status',coalesce(a.status,'not_started'),'provider_reference',a.provider_reference,
    'settled',exists(select 1 from public.money_refunds where authorization_id=r.id),
    'released',exists(select 1 from public.money_refund_releases where authorization_id=r.id),
    'delivered',private.money_refund_delivered(r.id),
    'late_failure_open',(private.money_refund_open_late_failure(r.id)).failed_reference is not null,
    'failed_references',coalesce((select jsonb_agg(x.failed_reference order by x.generation) from public.money_refund_reissues x
      where x.authorization_id=r.id and x.failed_reference is not null),'[]'::jsonb));
end $$;


-- public.money_record_reconciliation: latest body from 20260905004000_money_reconciliation.sql; Stripe's net for the payment includes what a late failure returned.
create or replace function public.money_record_reconciliation(p_obligation uuid,p_key text,p_observed bigint,p_currency text,p_evidence text)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; expected bigint; existing public.money_reconciliation;
begin
  select * into strict o from public.money_obligations where id=p_obligation for update;
  expected:=o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip+private.money_customer_refund_owed(o.id);
  select * into existing from public.money_reconciliation where observation_key=p_key;
  if found then
    if existing.obligation_id<>o.id or existing.observed<>p_observed or existing.currency<>p_currency or existing.evidence<>p_evidence then raise exception 'Reconciliation identity conflict'; end if;
    return existing.expected=existing.observed and existing.currency='usd';
  end if;
  insert into public.money_reconciliation(obligation_id,observation_key,expected,observed,currency,evidence) values(o.id,p_key,expected,p_observed,p_currency,p_evidence);
  if p_observed is distinct from expected or p_currency is distinct from 'usd' then
    update public.money_obligations set reconciliation_open=true where id=o.id;
    return false;
  end if;
  -- Matching one observation never automatically clears another unresolved exception.
  return true;
end $$;


-- private.money_payout_received: latest body from 20260921003000_money_payout_recovery.sql; a repayment sent back counts as received again.
create or replace function private.money_payout_received(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select ((select coalesce(sum(i.amount) filter (where e.status='settled'),0)-coalesce(sum(i.amount) filter (where e.status='returned'),0)
      from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id join public.money_ach_events e on e.attempt_id=a.id
      where i.obligation_id=p_obligation)
    +(select coalesce(sum(amount),0) from public.money_ach_late_settlements where obligation_id=p_obligation)
    -(select coalesce(sum(amount),0) from public.money_payout_recoveries where obligation_id=p_obligation and kind='repayment')
    +(select coalesce(sum(amount),0) from public.money_repayment_reversals where obligation_id=p_obligation))::bigint
$$;


-- private.money_obligation_reconciliation: latest body from 20260922002000_money_failed_refund_recovery.sql; released refunds leave the settled counters; late failures, resettlements and reversals reconcile against the customer refund payable, Stripe clearing and the readback; repayment reversals against the provider payable and bank.
create or replace function private.money_obligation_reconciliation(p_obligation uuid,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  o public.money_obligations; s public.money_snapshots; r public.service_requests; ret record;
  c public.money_lifecycle_confirmations; item public.money_ach_items; attempt public.money_ach_attempts;
  readback public.money_reconciliation; payee uuid; payee_name text; full_capture boolean;
  attempts_captured bigint; ledger_captured bigint; settled record; refunds_settled integer; refund_journals integer;
  refund_clearing bigint; pending_refunds integer; released_refunds integer; earnings integer; fee bigint:=0; tax_expected bigint:=0;
  proceeds bigint:=0; advance_expected bigint; paid bigint; returned bigint; suspense_expected bigint;
  clearing_expected bigint; processor bigint; disputed bigint; lost bigint; bank_status text; funds text;
  late bigint; repaid bigint; written_off bigint; reversed_repaid bigint; customer_owed bigint; late_failed integer;
  reversed_refunds integer; reversed_amount bigint;
  not_eligible text[]:='{}'; held text[]:='{}'; issues text[]:='{}'; eligible_at timestamptz;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into s from public.money_snapshots where id=o.current_snapshot_id;
  select * into strict r from public.service_requests where id=o.service_request_id;
  payee:=private.money_effective_contractor(o.id);
  select name into payee_name from public.contractors where id=payee;
  full_capture:=s.id is not null and o.captured=s.total;

  -- Charges: counter, captured attempts and capture journals must agree.
  select coalesce(sum(amount),0) into attempts_captured from public.money_checkout_attempts
    where obligation_id=o.id and status='captured';
  select coalesce(sum((l->>'debit')::bigint),0) into ledger_captured
    from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.obligation_id=o.id and j.kind='capture' and l->>'account'='stripe_clearing';
  if attempts_captured<>o.captured then issues:=array_append(issues,'charge_attempts'); end if;
  if ledger_captured<>o.captured then issues:=array_append(issues,'charge_ledger'); end if;

  -- Refunds: counters equal provider-settled authorizations, each posted once.
  select coalesce(sum(a.service),0) service,coalesce(sum(a.tax),0) tax,coalesce(sum(a.tip),0) tip,count(*) n into settled
    from public.money_refund_authorizations a where a.obligation_id=o.id
      and exists(select 1 from public.money_refunds f where f.authorization_id=a.id)
      and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id);
  refunds_settled:=settled.n;
  select count(*) into pending_refunds from public.money_refund_authorizations a where a.obligation_id=o.id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id);
  select count(*) into released_refunds from public.money_refund_releases z where z.obligation_id=o.id;
  select count(*),coalesce(sum(credit),0) into refund_journals,refund_clearing from (
    select j.id,sum((l->>'credit')::bigint) credit from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.obligation_id=o.id and j.kind='refund' and l->>'account'='stripe_clearing' group by j.id) x;
  if (settled.service,settled.tax,settled.tip)<>(o.refunded_service,o.refunded_tax,o.refunded_tip) then issues:=array_append(issues,'refund_counters'); end if;
  -- A late refund released after it settled keeps its refund journal and is reversed against the
  -- customer refund payable; its amount leaves the counters.
  select count(*),coalesce(sum(z.amount),0) into reversed_refunds,reversed_amount from public.money_refund_releases z
    where z.obligation_id=o.id and exists(select 1 from public.money_refunds f where f.authorization_id=z.authorization_id);
  if refund_journals<>refunds_settled+reversed_refunds or refund_clearing<>o.refunded_service+o.refunded_tax+o.refunded_tip+reversed_amount then issues:=array_append(issues,'refund_ledger'); end if;
  if (select count(*) from public.money_journals where obligation_id=o.id and kind='refund_reversal')<>reversed_refunds then issues:=array_append(issues,'refund_ledger'); end if;
  -- Late failures: what Stripe returned is owed to the customer until a resend settles or a release reverses it.
  select count(*) into late_failed from public.money_refund_late_failures where obligation_id=o.id;
  customer_owed:=private.money_customer_refund_owed(o.id);
  if -private.money_account_net(o.id,'customer_refund_payable')<>customer_owed then issues:=array_append(issues,'customer_refund_payable'); end if;

  -- Earnings: one allocation once the full total is captured, none before.
  select count(*) into earnings from public.money_journals where obligation_id=o.id and kind='earnings';
  if earnings<>(case when full_capture then 1 else 0 end) then issues:=array_append(issues,'earnings_posting'); end if;
  if s.id is not null then
    select * into strict ret from public.money_retained_parts(o.id);
    if full_capture then
      fee:=round(ret.service::numeric*15/100)::bigint;
      tax_expected:=ret.tax;
      proceeds:=ret.service-fee+ret.tip;
    end if;
  end if;
  advance_expected:=case when full_capture then 0 else o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip end;
  if -private.money_account_net(o.id,'platform_revenue')<>fee then issues:=array_append(issues,'platform_fee'); end if;
  if -private.money_account_net(o.id,'tax_liability')<>tax_expected then issues:=array_append(issues,'tax_liability'); end if;
  if -private.money_account_net(o.id,'customer_advance')<>advance_expected then issues:=array_append(issues,'customer_advance'); end if;

  -- Payouts: recorded bank outcomes against the provider payable and bank accounts.
  select coalesce(sum(i.amount) filter (where e.status='settled'),0),coalesce(sum(i.amount) filter (where e.status='returned'),0)
    into paid,returned
    from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id join public.money_ach_events e on e.attempt_id=a.id
    where i.obligation_id=o.id;
  -- A late payment of a withdrawn transfer counts as paid; repayments and write-offs reduce what
  -- the provider owes.
  select coalesce(sum(amount),0) into late from public.money_ach_late_settlements where obligation_id=o.id;
  paid:=paid+late;
  select coalesce(sum(amount) filter (where kind='repayment'),0),coalesce(sum(amount) filter (where kind='write_off'),0)
    into repaid,written_off from public.money_payout_recoveries where obligation_id=o.id;
  select coalesce(sum(amount),0) into reversed_repaid from public.money_repayment_reversals where obligation_id=o.id;
  if -private.money_account_net(o.id,'provider_payable')<>proceeds-paid+returned+repaid+written_off-reversed_repaid then issues:=array_append(issues,'provider_payable'); end if;
  if private.money_account_net(o.id,'bank')<>returned-paid+repaid-reversed_repaid then issues:=array_append(issues,'bank_ledger'); end if;
  if private.money_account_net(o.id,'provider_recovery_loss')<>written_off then issues:=array_append(issues,'recovery_ledger'); end if;
  select * into item from public.money_ach_items where id=private.money_ach_live_item(o.id);
  if item.id is not null then
    select * into attempt from public.money_ach_attempts where item_id=item.id order by attempt_number desc limit 1;
    bank_status:=attempt.status;
    -- A settled statement records what was paid; a later refund or chargeback shows as an amount owed.
    if bank_status='settled' then
      null;
    elsif s.id is null then
      issues:=array_append(issues,'statement_stale');
    elsif item.snapshot_id<>s.id or item.service_retained<>ret.service or item.tip_retained<>ret.tip or item.contractor_id<>payee then
      issues:=array_append(issues,'statement_stale');
    end if;
  end if;

  -- Chargebacks and processor costs against Stripe clearing.
  select coalesce(sum(amount) filter (where status='open' or (status='lost' and not exists(
      select 1 from public.money_chargeback_resolutions x where x.dispute_id=d.provider_id))),0),
    coalesce(sum(amount) filter (where status in ('open','lost')),0),coalesce(sum(amount) filter (where status='lost'),0)
    into suspense_expected,disputed,lost from public.money_disputes d where d.obligation_id=o.id;
  processor:=private.money_account_net(o.id,'processor_expense');
  clearing_expected:=o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip+customer_owed-disputed-processor;
  if private.money_account_net(o.id,'chargeback_suspense')<>suspense_expected then issues:=array_append(issues,'chargeback_suspense'); end if;
  if private.money_account_net(o.id,'stripe_clearing')<>clearing_expected then issues:=array_append(issues,'stripe_clearing'); end if;

  select * into readback from public.money_reconciliation where obligation_id=o.id order by observation_sequence desc limit 1;

  -- Funds state. The predicates mirror public.money_payable without writing completion evidence.
  if item.id is not null then
    funds:=case when bank_status in ('prepared','submitted','unknown') then 'scheduled'
      when bank_status='settled' then 'paid' else 'payout_failed' end;
  elsif late>0 then
    -- No live statement, but the bank paid a withdrawn transfer: the payout is paid.
    funds:='paid';
  else
    if not full_capture then not_eligible:=array_append(not_eligible,'payment_incomplete'); end if;
    begin
      c:=private.money_completion_source(o.id);
      eligible_at:=c.confirmed_at+interval '48 hours';
      if eligible_at>p_at then not_eligible:=array_append(not_eligible,'confirmation_window'); end if;
    exception when others then
      not_eligible:=array_append(not_eligible,case when sqlerrm like 'Replacement commercial reconciliation%'
        then 'replacement_reconciliation' else 'awaiting_confirmation' end);
    end;
    if r.status not in ('homeowner_confirmed','completed','review_requested','reviewed','closed','resolved')
      and not 'awaiting_confirmation'=any(not_eligible) then not_eligible:=array_append(not_eligible,'awaiting_confirmation'); end if;
    if full_capture and proceeds<=0 then not_eligible:=array_append(not_eligible,'no_payable'); end if;
    if r.disputed or exists(select 1 from public.disputes where job_id=r.id and status<>'resolved')
      or exists(select 1 from public.dispute_appeals a join public.disputes d on d.id=a.dispute_id
        left join public.support_tickets t on t.id=a.ticket_id where d.job_id=r.id and (t.id is null or t.status<>'resolved'))
      then held:=array_append(held,'dispute'); end if;
    if o.dispute_open then held:=array_append(held,'chargeback'); end if;
    if o.reconciliation_open then held:=array_append(held,'reconciliation'); end if;
    if private.money_unprocessed_events(o.id)>0 then held:=array_append(held,'provider_event'); end if;
    if exists(select 1 from public.money_holds h where h.obligation_id=o.id
      and not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)) then held:=array_append(held,'payout_hold'); end if;
    if pending_refunds>0 then held:=array_append(held,'pending_refund'); end if;
    if not private.vendor_payout_eligible(payee,p_at) then held:=array_append(held,'payout_onboarding'); end if;
    funds:=case when cardinality(not_eligible)>0 then 'not_eligible' when cardinality(held)>0 then 'held' else 'eligible' end;
  end if;

  return jsonb_build_object(
    'obligation_id',o.id,
    'service_request_id',o.service_request_id,
    'invoice_number',s.invoice_number,
    'created_at',o.created_at,
    'payee',jsonb_build_object('contractor_id',payee,'name',payee_name,'reassigned',payee<>o.contractor_id),
    'terms',case when s.id is null then null else jsonb_build_object('subtotal',s.subtotal,'tax',s.tax,'tip',s.tip,'deposit',s.deposit,'total',s.total) end,
    'charges',jsonb_build_object('captured',o.captured,'attempts_captured',attempts_captured,'ledger_captured',ledger_captured,'fully_captured',full_capture,
      'payments',coalesce((select jsonb_agg(jsonb_build_object('payment_id',a.stripe_payment_id,'mode',a.mode,'amount',a.amount) order by a.completed_at,a.id)
        from public.money_checkout_attempts a where a.obligation_id=o.id and a.status='captured'),'[]'::jsonb)),
    'refunds',jsonb_build_object('service',o.refunded_service,'tax',o.refunded_tax,'tip',o.refunded_tip,
      'settled',refunds_settled,'pending',pending_refunds,'released',released_refunds,
      'late_failed',late_failed,'reversed',reversed_refunds,'customer_owed',customer_owed),
    'earnings',jsonb_build_object('platform_fee',fee,'platform_fee_ledger',-private.money_account_net(o.id,'platform_revenue'),
      'tax',tax_expected,'tax_ledger',-private.money_account_net(o.id,'tax_liability'),'provider_proceeds',proceeds),
    'payout',jsonb_build_object('funds_state',funds,'not_eligible',to_jsonb(not_eligible),'held',to_jsonb(held),
      'eligible_at',case when item.id is null then eligible_at end,
      'paid',paid,'returned',returned,'payable',proceeds-paid+returned+repaid+written_off-reversed_repaid,
      'payable_ledger',-private.money_account_net(o.id,'provider_payable'),
      'recovery',jsonb_build_object('owed',private.money_payout_owed(o.id),'late_settled',late,'repaid',repaid,'written_off',written_off,
        'repayment_reversed',reversed_repaid,'repayment_returnable',private.money_repayment_returnable(o.id)),
      'withdrawn_statements',(select count(*) from public.money_ach_withdrawals w join public.money_ach_items i on i.id=w.item_id where i.obligation_id=o.id),
      'statement',case when item.id is null then null else jsonb_build_object('amount',item.amount,
        'period_start',(select period_start from public.money_ach_batches where id=item.batch_id),
        'attempt_number',attempt.attempt_number,'bank_status',bank_status) end),
    'chargebacks',jsonb_build_object('suspense',suspense_expected,'suspense_ledger',private.money_account_net(o.id,'chargeback_suspense'),
      'lost',lost),
    'processor_costs',processor,
    'readback',case when readback.id is null then jsonb_build_object('state','none') else jsonb_build_object(
      'state',case when readback.observed<>readback.expected or readback.currency<>'usd' then 'mismatch'
        when readback.expected<>o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip+customer_owed then 'outdated' else 'matched' end,
      'observed',readback.observed,'expected',readback.expected,'recorded_at',readback.created_at) end,
    'reconciliation_open',o.reconciliation_open,
    'issues',to_jsonb(issues));
end $$;


-- private.money_request_blocker: latest body from 20260922002000_money_failed_refund_recovery.sql; adds the late refund steps and the repayment reversal.
create or replace function private.money_request_blocker(p_operation text,p_subject text,p_command jsonb,p_terms jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if p_operation='ach_preparation' then
    return private.money_ach_preparation_blocker(p_subject::date,p_terms);
  elsif p_operation='ach_retry' then
    return private.money_ach_retry_blocker(p_subject::uuid);
  elsif p_operation='ach_withdrawal' then
    return private.money_ach_withdrawal_blocker(p_subject::uuid,p_command->>'status');
  elsif p_operation='ach_late_settlement' then
    return private.money_ach_late_settlement_blocker(p_subject::uuid,p_command->>'bank_ref');
  elsif p_operation='refund_late_failure' then
    return private.money_refund_late_failure_blocker(p_subject::uuid,p_command->>'reference',p_command->>'key');
  elsif p_operation='refund_late_resend' then
    return private.money_refund_late_resend_blocker(p_subject::uuid,p_command->>'reference',p_command->>'key');
  elsif p_operation='refund_late_release' then
    return private.money_refund_late_release_blocker(p_subject::uuid,p_command->>'reference',p_command->>'key');
  elsif p_operation='repayment_reversal' then
    return private.money_repayment_reversal_blocker(p_subject::uuid,(p_command->>'amount')::bigint,(p_command->>'returnable')::bigint,p_command->>'key');
  elsif p_operation='refund_release' then
    return private.money_refund_release_blocker(p_subject::uuid,p_command->>'reference');
  elsif p_operation='payout_recovery' then
    return private.money_payout_recovery_blocker(p_subject::uuid,p_command->>'kind',(p_command->>'amount')::bigint,
      (p_command->>'owed')::bigint,p_command->>'key');
  elsif p_operation='bank_statement_close' then
    return private.money_bank_statement_close_blocker(p_subject::uuid,(p_command->>'lines')::integer,(p_command->>'debits')::bigint,
      (p_command->>'credits')::bigint);
  end if;
  return private.money_command_blocker(p_operation,p_subject,p_command);
end $$;


-- public.money_operator_execute_review: latest body from 20260922002000_money_failed_refund_recovery.sql; adds the late refund steps and the repayment reversal; a late release and a reversal take the lifecycle lock like a recovery, the others the obligation lock like a refund.
create or replace function public.money_operator_execute_review(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.money_review_requests; approver uuid; blocker text; job uuid;
  payouts uuid[]; i public.money_ach_items;
begin
  perform public.money_require_finance(actor);
  select * into q from public.money_review_requests where id=p_request for update;
  if not found then raise exception 'Finance review request not found' using errcode='P0002'; end if;
  if q.requested_by<>actor then raise exception 'Only the requesting finance operator can execute this command' using errcode='42501'; end if;
  if exists(select 1 from public.money_review_executions where request_id=q.id) then
    return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',true);
  end if;
  if now()>=private.money_review_expires_at(q.created_at) then
    raise exception 'Finance review request expired; request it again' using errcode='55000';
  end if;
  -- Two requests for the same subject serialize here; the second then sees it completed. Batches
  -- share one lock because weeks of different requests may overlap.
  perform pg_advisory_xact_lock(hashtextextended('money_review_subject:'||q.operation||':'
    ||case when q.operation='ach_preparation' then 'all' else q.subject end,0));
  -- Take the rows the kernel will lock, in the kernel's order, before checking.
  if q.operation='event_exclusion' then
    perform 1 from public.money_webhook_events where event_id=q.subject for update;
  elsif q.operation='cancellation_refund' then
    select job_id into strict job from public.job_operations where id=split_part(q.subject,':',1)::uuid;
    perform pg_advisory_xact_lock(hashtextextended(job::text,0));
    perform 1 from public.service_requests where id=job for update;
    perform 1 from public.money_obligations where service_request_id=job for update;
  elsif q.operation='ach_preparation' then
    payouts:=array(select x.v::uuid from jsonb_array_elements_text(q.command->'obligations') with ordinality x(v,n) order by x.n);
    perform private.money_lock_lifecycle(payouts);
    perform 1 from public.vendor_onboarding where contractor_id in(
      select private.money_effective_contractor(id) from public.money_obligations where id=any(payouts)
    ) order by contractor_id for share;
    perform 1 from public.money_obligations where id=any(payouts) order by id for update;
  elsif q.operation in ('ach_retry','ach_withdrawal','ach_late_settlement') then
    select item.* into strict i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id
      where attempt.id=q.subject::uuid;
    perform private.money_lock_lifecycle(array[i.obligation_id]);
    perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
    perform 1 from public.money_obligations where id=i.obligation_id for update;
  elsif q.operation in ('payout_recovery','repayment_reversal','refund_late_release') then
    perform private.money_lock_lifecycle(array[q.obligation_id]);
    perform 1 from public.money_obligations where id=q.obligation_id for update;
  elsif q.operation='bank_statement_close' then
    perform private.money_lock_bank_statements();
    perform 1 from public.money_bank_statements where id=q.subject::uuid for update;
  else
    perform 1 from public.money_obligations where id=q.obligation_id for update;
  end if;
  approver:=private.money_review_approver(q.id);
  if approver is null then
    raise exception 'Separate authenticated approval of exact financial command required' using errcode='42501';
  end if;
  blocker:=private.money_request_blocker(q.operation,q.subject,q.command,q.terms);
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  if q.operation='event_exclusion' then
    perform public.money_exclude_event(q.subject,actor,approver,q.reason,q.evidence);
  elsif q.operation='reconciliation_resolution' then
    perform public.money_resolve_reconciliation(q.subject::uuid,actor,approver,q.reason);
  elsif q.operation='hold_resolution' then
    -- Requests made before owner decision G3 run as approved until they expire.
    perform public.money_require_finance(approver);
    perform public.money_require_review(actor,approver,q.command);
    perform public.money_resolve_hold(q.subject::uuid,actor,q.reason,q.evidence);
  elsif q.operation='refund_authorization' then
    perform public.money_authorize_refund(q.obligation_id,q.command->>'payment',(q.command->>'service')::bigint,(q.command->>'tax')::bigint,
      (q.command->>'tip')::bigint,q.command->>'key',actor,approver,q.command->>'policy',q.command->>'reason');
  elsif q.operation='cancellation_refund' then
    perform public.money_authorize_cancellation_refund(split_part(q.subject,':',1)::uuid,q.command->>'payment',actor,approver,q.reason);
  elsif q.operation='chargeback_allocation' then
    perform public.money_resolve_chargeback_loss(q.subject,(q.command->>'service')::bigint,(q.command->>'tax')::bigint,
      (q.command->>'tip')::bigint,actor,approver,q.reason);
  elsif q.operation='ach_preparation' then
    perform public.money_prepare_ach(q.subject::date,payouts,actor,approver,q.command->>'bank_ref',q.command->>'reason');
  elsif q.operation='ach_retry' then
    perform public.money_retry_ach(i.id,actor,approver);
  elsif q.operation='ach_withdrawal' then
    perform public.money_withdraw_ach(q.subject::uuid,q.command->>'status',actor,approver,q.reason,q.evidence);
  elsif q.operation='ach_late_settlement' then
    perform public.money_record_ach_late_settlement(q.subject::uuid,q.command->>'bank_ref',actor,approver,q.reason,q.evidence);
  elsif q.operation='refund_late_failure' then
    perform public.money_record_refund_late_failure(q.subject::uuid,q.command->>'reference',q.command->>'key',actor,approver,q.reason,q.evidence);
  elsif q.operation='refund_late_resend' then
    perform public.money_resend_late_refund(q.subject::uuid,q.command->>'reference',q.command->>'key',actor,approver,q.reason);
  elsif q.operation='refund_late_release' then
    perform public.money_release_late_refund(q.subject::uuid,q.command->>'reference',q.command->>'key',actor,approver,q.reason,q.evidence);
  elsif q.operation='repayment_reversal' then
    perform public.money_record_repayment_reversal(q.obligation_id,(q.command->>'amount')::bigint,(q.command->>'returnable')::bigint,
      q.command->>'key',actor,approver,q.reason,q.evidence);
  elsif q.operation='refund_release' then
    perform public.money_release_refund(q.subject::uuid,q.command->>'reference',actor,approver,q.reason,q.evidence);
  elsif q.operation='payout_recovery' then
    perform public.money_record_payout_recovery(q.obligation_id,q.command->>'kind',(q.command->>'amount')::bigint,
      (q.command->>'owed')::bigint,q.command->>'key',actor,approver,q.reason,q.evidence);
  elsif q.operation='bank_statement_close' then
    perform public.money_close_bank_statement(q.subject::uuid,(q.command->>'lines')::integer,(q.command->>'debits')::bigint,
      (q.command->>'credits')::bigint,actor,approver,q.reason);
  else
    raise exception 'Unsupported finance review' using errcode='22023';
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;


-- public.money_finance_operations: latest body from 20260922002000_money_failed_refund_recovery.sql; late refund and reversal requests read back their details; adds late refunds and repayments owed back; net collected includes what a late failure returned.
create or replace function public.money_finance_operations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
  perform public.money_require_finance(me);
  return jsonb_build_object(
    'evaluated_at',now(),
    'requests',coalesce((select jsonb_agg(t.item order by t.created_at desc,t.id) from (
      select q.id,q.created_at,jsonb_build_object(
        'request_id',q.id,'operation',q.operation,'subject',q.subject,'obligation_id',q.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=q.obligation_id),
        'reason',q.reason,'evidence',q.evidence,
        'details',case when q.operation in ('refund_authorization','cancellation_refund') then jsonb_build_object(
            'payment_id',q.command->>'payment','service',(q.command->>'service')::bigint,'tax',(q.command->>'tax')::bigint,'tip',(q.command->>'tip')::bigint)
          when q.operation='chargeback_allocation' then jsonb_build_object(
            'dispute_id',q.subject,'service',(q.command->>'service')::bigint,'tax',(q.command->>'tax')::bigint,'tip',(q.command->>'tip')::bigint)
          when q.operation in ('ach_preparation','ach_retry','ach_withdrawal') then private.money_ach_request_details(q,l.live)
          when q.operation in ('ach_late_settlement','payout_recovery') then private.money_recovery_request_details(q)
          when q.operation='bank_statement_close' then private.money_bank_close_request_details(q)
          when q.operation='refund_release' then private.money_refund_release_request_details(q)
          when q.operation in ('refund_late_failure','refund_late_resend','refund_late_release') then private.money_refund_late_request_details(q)
          when q.operation='repayment_reversal' then private.money_repayment_reversal_request_details(q) end,
        'requested_by_me',q.requested_by=me,
        'approved_by_me',exists(select 1 from public.money_review_request_approvals a where a.request_id=q.id and a.approved_by=me),
        'recorded_by_me',q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries e where e.observation_id::text=q.subject and e.actor=me),
        'state',case when x.request_id is not null then 'executed'
          when not l.live then 'expired'
          when b.blocker is not null then 'stale'
          when private.money_review_approver(q.id) is not null then 'approved' else 'awaiting_approval' end,
        'blocker',b.blocker,
        'created_at',q.created_at,'expires_at',private.money_review_expires_at(q.created_at),'executed_at',x.created_at) item
      from public.money_review_requests q left join public.money_review_executions x on x.request_id=q.id
      cross join lateral (select x.request_id is null and now()<private.money_review_expires_at(q.created_at) live) l
      cross join lateral (select case when l.live then private.money_request_blocker(q.operation,q.subject,q.command,q.terms) end blocker) b
      where coalesce(x.created_at,q.created_at)>now()-interval '30 days'
      order by q.created_at desc limit 200) t),'[]'::jsonb),
    'holds',coalesce((select jsonb_agg(jsonb_build_object(
        'hold_id',h.id,'obligation_id',h.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=h.obligation_id),
        'reason',h.reason,'evidence',h.evidence,'placed_by_me',h.actor=me,'created_at',h.created_at) order by h.created_at,h.id)
      from public.money_holds h where not exists(select 1 from public.money_hold_resolutions r where r.hold_id=h.id)),'[]'::jsonb),
    'readbacks',coalesce((select jsonb_agg(jsonb_build_object(
        'obligation_id',o.id,'invoice_number',s.invoice_number,'reconciliation_open',o.reconciliation_open,
        'net_collected',o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip+private.money_customer_refund_owed(o.id),
        'observation_id',r.id,'observed',r.observed,'expected',r.expected,'currency',r.currency,'evidence',r.evidence,
        'attributed',e.actor is not null,'recorded_by_me',e.actor=me,'recorded_at',r.created_at,
        'resolution_blocker',case when r.id is null then 'not_found' else private.money_review_blocker('reconciliation_resolution',r.id::text) end)
        order by o.created_at,o.id)
      from public.money_obligations o
      left join public.money_snapshots s on s.id=o.current_snapshot_id
      left join lateral (select * from public.money_reconciliation x where x.obligation_id=o.id order by x.observation_sequence desc limit 1) r on true
      left join public.money_readback_entries e on e.observation_id=r.id
      where o.reconciliation_open or (r.id is not null and (r.observed<>r.expected or r.currency<>'usd'))),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
        'event_id',e.event_id,'event_type',e.event_type,'status',e.status,'attempts',e.attempt_count,
        'holds_all_payouts',e.event_type='reconciliation_required',
        'exclusion_blocker',private.money_review_blocker('event_exclusion',e.event_id),'received_at',e.received_at)
        order by e.received_at,e.event_id)
      from public.money_webhook_events e where e.status<>'processed'
        and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)),'[]'::jsonb),
    'refunds',coalesce((select jsonb_agg(jsonb_build_object(
        'authorization_id',a.id,'obligation_id',a.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=a.obligation_id),
        'payment_id',a.payment_id,'amount',a.service+a.tax+a.tip,
        'attempt_status',coalesce(t.status,'not_started'),'provider_reference',t.provider_reference,
        'can_send',me in (a.created_by,a.approved_by),
        'generation',1+(select count(*) from public.money_refund_reissues z where z.authorization_id=a.id),
        'reissue_blocker',case when t.authorization_id is not null and t.status='reconcile' then private.money_reissue_blocker(a.id) end,
        'resend_blocker',case when t.status='failed' then private.money_failed_refund_blocker(a.id) end,
        'release_blocker',case when t.status='failed' then private.money_refund_release_blocker(a.id,t.provider_reference) end,
        'open_release_request_id',(select q.id from public.money_review_requests q where q.operation='refund_release' and q.subject=a.id::text
          and now()<private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1),
        'last_readback',(select jsonb_build_object('found',b.found,'provider_status',b.provider_status,'by_me',b.actor=me,'created_at',b.created_at)
          from public.money_refund_readbacks b where b.authorization_id=a.id order by b.readback_sequence desc limit 1),
        'created_at',a.created_at) order by a.created_at,a.id)
      from public.money_refund_authorizations a left join public.money_refund_attempts t on t.authorization_id=a.id
      where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id)),'[]'::jsonb),
    'refund_releases',private.money_refund_release_operations(me),
    'late_refunds',private.money_late_refund_operations(me),
    'cancellations',coalesce((select jsonb_agg(c.item order by c.created_at desc,c.operation_id,c.payment_id) from (
      select j.created_at,j.id operation_id,p.payment_id,jsonb_build_object(
        'operation_id',j.id,'kind',j.kind,'payment_id',p.payment_id,'obligation_id',o.id,'invoice_number',s.invoice_number,
        'refund_percent',(p.preview->>'refund_percent')::integer,
        'service',(p.preview->>'service')::bigint,'tax',(p.preview->>'tax')::bigint,'tip',(p.preview->>'tip')::bigint,
        'blocker',private.money_refund_blocker(o.id,p.payment_id,(p.preview->>'service')::bigint,(p.preview->>'tax')::bigint,(p.preview->>'tip')::bigint),
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='cancellation_refund' and q.subject=j.id||':'||p.payment_id
          and now()<private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1),
        'cancelled_at',j.created_at) item
      from public.job_operations j
      join public.money_obligations o on o.service_request_id=j.job_id
      left join public.money_snapshots s on s.id=o.current_snapshot_id
      cross join lateral (select a.stripe_payment_id payment_id,private.money_cancellation_preview(j.id,a.stripe_payment_id) preview
        from public.money_checkout_attempts a where a.obligation_id=o.id and a.status='captured' and a.stripe_payment_id is not null) p
      where j.kind in ('customer_cancel','provider_cancel','no_show')
        and not exists(select 1 from public.money_operation_refund_sources x where x.operation_id=j.id and x.payment_id=p.payment_id)
        and p.preview is not null and (p.preview->>'service')::bigint+(p.preview->>'tax')::bigint+(p.preview->>'tip')::bigint>0
      order by j.created_at desc limit 200) c),'[]'::jsonb),
    'chargebacks',coalesce((select jsonb_agg(jsonb_build_object(
        'dispute_id',d.provider_id,'obligation_id',d.obligation_id,'payment_id',d.payment_id,'amount',d.amount,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=d.obligation_id),
        'retained',(select jsonb_build_object('service',p.service,'tax',p.tax,'tip',p.tip) from public.money_retained_parts(d.obligation_id) p),
        'blocker',private.money_chargeback_state_blocker(d.provider_id),
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='chargeback_allocation' and q.subject=d.provider_id
          and now()<private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1),
        'created_at',d.created_at) order by d.created_at,d.provider_id)
      from public.money_disputes d where d.status='lost'
        and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=d.provider_id)),'[]'::jsonb),
    'ach',private.money_ach_operations(me),
    'recoveries',private.money_recovery_operations(me),
    'repayment_returns',private.money_repayment_return_operations(me),
    'statements',private.money_bank_statement_operations(me));
end $$;


-- public.money_finance_reconciliation: latest body from 20260922002000_money_failed_refund_recovery.sql; adds refunds owed to customers, late failures not yet recorded and repayments owed back to the totals and exceptions.
create or replace function public.money_finance_reconciliation()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now(); rows jsonb; listed integer:=200;
begin
  perform public.money_require_finance(auth.uid());
  select coalesce(jsonb_agg(x.row order by jsonb_array_length(x.row->'issues')>0 desc,(x.row->>'created_at')::timestamptz desc,x.id),'[]'::jsonb)
    into rows from (select o.id,private.money_obligation_reconciliation(o.id,at_value) row from public.money_obligations o) x;
  return jsonb_build_object(
    'evaluated_at',at_value,
    'fee_percent',15,
    'obligation_count',jsonb_array_length(rows),
    'listed_limit',listed,
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('account',a.account,'debit',a.debit,'credit',a.credit) order by a.account)
      from (select l->>'account' account,sum((l->>'debit')::bigint)::bigint debit,sum((l->>'credit')::bigint)::bigint credit
        from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l group by 1) a),'[]'::jsonb),
    'totals',jsonb_build_object(
      'captured',(select coalesce(sum((v->'charges'->>'captured')::bigint),0) from jsonb_array_elements(rows) v),
      'refunded',(select coalesce(sum((v->'refunds'->>'service')::bigint+(v->'refunds'->>'tax')::bigint+(v->'refunds'->>'tip')::bigint),0) from jsonb_array_elements(rows) v),
      'platform_fee',(select coalesce(sum((v->'earnings'->>'platform_fee_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'tax',(select coalesce(sum((v->'earnings'->>'tax_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'provider_payable',(select coalesce(sum((v->'payout'->>'payable_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'paid_out',(select coalesce(sum((v->'payout'->>'paid')::bigint-(v->'payout'->>'returned')::bigint),0) from jsonb_array_elements(rows) v),
      'processor_costs',(select coalesce(sum((v->>'processor_costs')::bigint),0) from jsonb_array_elements(rows) v),
      'chargeback_suspense',(select coalesce(sum((v->'chargebacks'->>'suspense_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'provider_owed',(select coalesce(sum((v->'payout'->'recovery'->>'owed')::bigint),0) from jsonb_array_elements(rows) v),
      'customer_refunds_owed',(select coalesce(sum((v->'refunds'->>'customer_owed')::bigint),0) from jsonb_array_elements(rows) v),
      'repayments_returnable',(select coalesce(sum((v->'payout'->'recovery'->>'repayment_returnable')::bigint),0) from jsonb_array_elements(rows) v),
      'with_issues',(select count(*) from jsonb_array_elements(rows) v where jsonb_array_length(v->'issues')>0)),
    'global_event_holds',private.money_unprocessed_events(null),
    'exceptions',coalesce((select jsonb_agg(e.item order by e.since,e.kind,e.reference) from (
      select 'ledger_mismatch' kind,v->>'obligation_id' reference,(v->>'created_at')::timestamptz since,
        jsonb_build_object('kind','ledger_mismatch','obligation_id',v->>'obligation_id','invoice_number',v->>'invoice_number','codes',v->'issues','since',v->>'created_at') item
        from jsonb_array_elements(rows) v where jsonb_array_length(v->'issues')>0
      union all
      select 'provider_event',e.event_id,e.received_at,jsonb_build_object('kind','provider_event','event_id',e.event_id,'event_type',e.event_type,
        'status',e.status,'attempts',e.attempt_count,'error_code',e.last_error,'holds_all_payouts',e.event_type='reconciliation_required',
        'obligation_id',(select a.obligation_id from public.money_checkout_attempts a
          where a.id::text=e.payload->>'attempt_id' or a.stripe_payment_id=e.payload->>'payment_id' limit 1),
        'since',e.received_at)
        from public.money_webhook_events e where e.status<>'processed'
          and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
      union all
      select 'checkout_reconcile',a.id::text,a.created_at,jsonb_build_object('kind','checkout_reconcile','obligation_id',a.obligation_id,
        'attempt_id',a.id,'mode',a.mode,'amount',a.amount,'error_code',a.failure_code,'since',a.created_at)
        from public.money_checkout_attempts a where a.status='reconcile'
      union all
      select 'refund_pending',a.id::text,a.created_at,jsonb_build_object('kind','refund_pending','obligation_id',a.obligation_id,
        'authorization_id',a.id,'payment_id',a.payment_id,'amount',a.service+a.tax+a.tip,
        'attempt_status',coalesce((select t.status from public.money_refund_attempts t where t.authorization_id=a.id),'not_started'),'since',a.created_at)
        from public.money_refund_authorizations a where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)
          and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id)
      union all
      select 'reconciliation_open',o.id::text,coalesce((select max(created_at) from public.money_reconciliation where obligation_id=o.id),o.created_at),
        jsonb_build_object('kind','reconciliation_open','obligation_id',o.id,
          'since',coalesce((select max(created_at) from public.money_reconciliation where obligation_id=o.id),o.created_at))
        from public.money_obligations o where o.reconciliation_open
      union all
      select 'chargeback',d.provider_id,d.created_at,jsonb_build_object('kind','chargeback','obligation_id',d.obligation_id,'dispute_id',d.provider_id,
        'payment_id',d.payment_id,'amount',d.amount,'status',d.status,'since',d.created_at)
        from public.money_disputes d where d.status='open' or (d.status='lost'
          and not exists(select 1 from public.money_chargeback_resolutions x where x.dispute_id=d.provider_id))
      union all
      select 'payout_hold',h.id::text,h.created_at,jsonb_build_object('kind','payout_hold','obligation_id',h.obligation_id,'hold_id',h.id,'since',h.created_at)
        from public.money_holds h where not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)
      union all
      select 'provider_owes',x.obligation_id,x.since,jsonb_build_object('kind','provider_owes','obligation_id',x.obligation_id,
        'invoice_number',x.invoice_number,'payee_name',x.payee_name,'amount',x.owed,'since',x.since)
        from (select v->>'obligation_id' obligation_id,v->>'invoice_number' invoice_number,v->'payee'->>'name' payee_name,
            (v->'payout'->'recovery'->>'owed')::bigint owed,
            (select max(j.created_at) from public.money_journals j where j.obligation_id=(v->>'obligation_id')::uuid) since
          from jsonb_array_elements(rows) v) x where x.owed>0
      union all
      select 'customer_refund_owed',f.failed_reference,f.created_at,jsonb_build_object('kind','customer_refund_owed','obligation_id',f.obligation_id,
        'authorization_id',f.authorization_id,'failed_reference',f.failed_reference,'amount',f.amount,'since',f.created_at)
        from public.money_refund_late_failures f
        where not exists(select 1 from public.money_refund_resettlements x where x.failed_reference=f.failed_reference)
          and not exists(select 1 from public.money_refund_releases z where z.authorization_id=f.authorization_id)
      union all
      -- A delivered refund that a readback or Stripe event shows failed, not yet recorded.
      select 'refund_failed_late',a.id::text,a.created_at,jsonb_build_object('kind','refund_failed_late','obligation_id',a.obligation_id,
        'authorization_id',a.id,'amount',a.service+a.tax+a.tip,
        'source',case when private.money_refund_late_failure_readback(a.id) is not null then 'readback' else 'stripe_event' end,'since',a.created_at)
        from public.money_refund_authorizations a
        where exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and private.money_refund_delivered(a.id)
          and (private.money_refund_late_failure_readback(a.id) is not null or private.money_refund_late_signal(a.id) is not null)
      union all
      select 'repayment_returnable',x.obligation_id,x.since,jsonb_build_object('kind','repayment_returnable','obligation_id',x.obligation_id,
        'invoice_number',x.invoice_number,'payee_name',x.payee_name,'amount',x.returnable,'since',x.since)
        from (select v->>'obligation_id' obligation_id,v->>'invoice_number' invoice_number,v->'payee'->>'name' payee_name,
            (v->'payout'->'recovery'->>'repayment_returnable')::bigint returnable,
            (select max(j.created_at) from public.money_journals j where j.obligation_id=(v->>'obligation_id')::uuid) since
          from jsonb_array_elements(rows) v) x where x.returnable>0
      union all
      select 'bank_outcome',a.id::text,a.created_at,jsonb_build_object('kind','bank_outcome','obligation_id',i.obligation_id,'item_id',i.id,
        'attempt_number',a.attempt_number,'amount',i.amount,'status',a.status,'since',a.created_at)
        from public.money_ach_items i join lateral (select * from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a on true
        where a.status in ('unknown','failed','returned')
      union all
      select 'bank_line',s.line_id::text,l.created_at,jsonb_build_object('kind','bank_line','line_id',s.line_id,'statement_id',l.statement_id,
        'period_start',to_char(b.period_start,'YYYY-MM-DD'),'period_end',to_char(b.period_end,'YYYY-MM-DD'),'line_number',l.line_number,
        'direction',l.direction,'amount',l.amount,'state',s.state,
        'obligation_id',(select m.obligation_id from private.money_bank_movements() m where m.movement=s.movement),'since',l.created_at)
        from private.money_bank_line_states() s join public.money_bank_statement_lines l on l.id=s.line_id
        join public.money_bank_statements b on b.id=l.statement_id
        where s.state in ('unmatched','amount_mismatch')
      union all
      -- A recorded movement with no line, on a business day some imported statement period covers or
      -- that falls between two of them. Later movements wait for the next statement.
      select 'bank_unevidenced',u.movement,u.recorded_at,jsonb_build_object('kind','bank_unevidenced','movement',u.movement,
        'movement_kind',u.kind,'obligation_id',u.obligation_id,'direction',u.direction,'amount',u.amount,'since',u.recorded_at)
        from private.money_bank_unevidenced() u
        where private.money_bank_day(u.recorded_at) between (select min(period_start) from public.money_bank_statements)
          and (select max(period_end) from public.money_bank_statements)
    ) e),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(l.v order by l.n) from (select v,n from jsonb_array_elements(rows) with ordinality x(v,n) order by n limit listed) l),'[]'::jsonb));
end $$;


-- private.money_bank_movements: latest body from 20260922001000_money_bank_statements.sql; adds repayment reversals: a debit to the provider with no bank reference.
create or replace function private.money_bank_movements()
returns table(movement text,kind text,direction text,amount bigint,bank_reference text,obligation_id uuid,attempt_id uuid,recorded_at timestamptz)
language sql stable security definer set search_path='' as $$
  select e.status||':'||e.id,e.status,case when e.status='settled' then 'debit' else 'credit' end,i.amount,a.bank_reference,i.obligation_id,a.id,e.created_at
    from public.money_ach_events e join public.money_ach_attempts a on a.id=e.attempt_id join public.money_ach_items i on i.id=a.item_id
    where e.status in ('settled','returned')
  union all
  select 'late:'||s.id,'late','debit',s.amount,s.bank_reference,s.obligation_id,s.attempt_id,s.created_at
    from public.money_ach_late_settlements s
  union all
  select 'repayment:'||r.id,'repayment','credit',r.amount,null,r.obligation_id,null,r.created_at
    from public.money_payout_recoveries r where r.kind='repayment'
  union all
  select 'reversal:'||v.id,'reversal','debit',v.amount,null,v.obligation_id,null,v.created_at
    from public.money_repayment_reversals v
$$;


-- private.money_bank_line_suggestion: latest body from 20260922001000_money_bank_statements.sql; a debit with no transfer suggests a repayment reversal of that amount no line evidences.
create or replace function private.money_bank_line_suggestion(p_line uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.money_bank_statement_lines; a public.money_ach_attempts; i public.money_ach_items; action text;
begin
  select * into l from public.money_bank_statement_lines where id=p_line;
  if not found then return null; end if;
  select * into a from public.money_ach_attempts where bank_reference=l.bank_reference;
  if not found then
    if exists(select 1 from public.money_ach_late_settlements where bank_reference=l.bank_reference) then
      return jsonb_build_object('action',case when l.direction='debit' then 'already_evidenced' else 'outcome_conflict' end);
    end if;
    if l.direction='credit' and exists(select 1 from private.money_bank_unevidenced() u where u.kind='repayment' and u.amount=l.amount) then
      return jsonb_build_object('action','match_repayment');
    end if;
    if l.direction='debit' and exists(select 1 from private.money_bank_unevidenced() u where u.kind='reversal' and u.amount=l.amount) then
      return jsonb_build_object('action','match_reversal');
    end if;
    return jsonb_build_object('action','no_transfer');
  end if;
  select * into strict i from public.money_ach_items where id=a.item_id;
  if l.direction='debit' then
    action:=case
      when a.status in ('submitted','unknown') then 'record_settled'
      when a.status='withdrawn' and not exists(select 1 from public.money_ach_late_settlements s where s.attempt_id=a.id) then 'request_late_settlement'
      when a.status in ('settled','returned','withdrawn') then 'already_evidenced'
      else 'outcome_conflict' end;
  else
    action:=case
      when a.status='settled' then 'record_returned'
      when a.status='returned' then 'already_evidenced'
      else 'outcome_conflict' end;
  end if;
  if action in ('record_settled','record_returned','request_late_settlement') and i.amount<>l.amount then action:='amount_mismatch'; end if;
  return jsonb_build_object('action',action,'attempt_id',a.id,'status',a.status,'obligation_id',i.obligation_id,'amount',i.amount,
    'attempt_number',a.attempt_number,
    'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=i.snapshot_id),
    'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id));
end $$;


-- private.money_refund_release_operations: latest body from 20260922002000_money_failed_refund_recovery.sql; marks a release that reversed a settled refund.
create or replace function private.money_refund_release_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'authorization_id',z.authorization_id,'obligation_id',z.obligation_id,
      'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=z.obligation_id),
      'payment_id',r.payment_id,'amount',z.amount,'provider_reference',z.failed_reference,'reason',z.reason,'evidence',z.evidence,
      'by_me',p_me in (z.requested_by,z.approved_by),
      'reversed',exists(select 1 from public.money_refunds x where x.authorization_id=z.authorization_id),'created_at',z.created_at) order by z.created_at desc,z.authorization_id),'[]'::jsonb)
  from public.money_refund_releases z join public.money_refund_authorizations r on r.id=z.authorization_id
  where z.created_at>now()-interval '30 days'
$$;


revoke all on function private.money_refund_open_late_failure(uuid),
  private.money_refund_delivered(uuid),
  private.money_refund_delivered_reference(uuid),
  private.money_refund_late_failure_readback(uuid),
  private.money_customer_refund_owed(uuid),
  private.money_refund_late_signal(uuid),
  private.money_refund_late_command(text,uuid,text,text,text,text),
  private.money_refund_late_failure_blocker(uuid,text,text),
  private.money_refund_late_send_blocker(uuid),
  private.money_refund_late_send_evidence(uuid),
  private.money_refund_late_resend_blocker(uuid,text,text),
  private.money_refund_reversal(uuid),
  private.money_payout_gross_paid(uuid),
  private.money_payout_proceeds(uuid),
  private.money_refund_late_release_blocker(uuid,text,text),
  private.money_refund_event_resettles(public.money_webhook_events),
  private.money_process_refund_resettlement(text),
  private.money_repayment_returnable(uuid),
  private.money_repayment_reversal_command(uuid,bigint,bigint,text,text,text),
  private.money_repayment_reversal_blocker(uuid,bigint,bigint,text),
  private.money_refund_late_request_details(public.money_review_requests),
  private.money_repayment_reversal_request_details(public.money_review_requests),
  private.money_open_request(text,text),
  private.money_late_refund_operations(uuid),
  private.money_repayment_return_operations(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.money_record_refund_late_failure(uuid,text,text,uuid,uuid,text,text),
  public.money_resend_late_refund(uuid,text,text,uuid,uuid,text),
  public.money_release_late_refund(uuid,text,text,uuid,uuid,text,text),
  public.money_record_repayment_reversal(uuid,bigint,bigint,text,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.money_record_refund_late_failure(uuid,text,text,uuid,uuid,text,text),
  public.money_resend_late_refund(uuid,text,text,uuid,uuid,text),
  public.money_release_late_refund(uuid,text,text,uuid,uuid,text,text),
  public.money_record_repayment_reversal(uuid,bigint,bigint,text,uuid,uuid,text,text)
  to service_role;
revoke all on function public.money_operator_request_late_refund(text,uuid,text,text,text),
  public.money_operator_request_repayment_reversal(uuid,bigint,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.money_operator_request_late_refund(text,uuid,text,text,text),
  public.money_operator_request_repayment_reversal(uuid,bigint,text,text,text)
  to authenticated;
