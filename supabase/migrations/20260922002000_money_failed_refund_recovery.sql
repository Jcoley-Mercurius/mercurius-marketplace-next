-- TRACE-082: failed-refund recovery (MPS §§5.5/6.5/7; CFG-005/006/007; TRACE-056/076/077).
--
-- A reviewed refund that Stripe reports failed or canceled left its attempt 'failed'. It could not
-- be sent again (the TRACE-077 reissue covers only an uncertain 'reconcile' attempt), and because
-- authorizations are immutable its authorization stayed pending for ever: it held the payout,
-- blocked chargeback allocation and kept counting against the refund caps.
-- Owner decisions 2026-09-22:
--  * finance can resend the same reviewed refund under a new Stripe idempotency key, or release
--    the authorization so it stops holding the payout and frees its amount for a new request;
--  * a resend is one finance operator, the refund's author or approver (as the reissue); a release
--    drops the customer's refund from the books, so it is a reviewed request a second finance
--    operator approves;
--  * either needs the latest recorded Stripe readback of this refund to show it failed or
--    canceled, taken after the current send was prepared. The send response alone is not enough;
--  * a refund that fails after Stripe reported it succeeded (its journal is posted) is out of
--    scope and recorded as a finding.
-- A release is an immutable record. Every check that treated an unsettled authorization as
-- pending, and every refund cap, now skips a released one. Nothing is posted: a failed refund
-- never reached the ledger.

-- A failed refund taken off the books. The customer's refund, if still owed, is a new request.
create table public.money_refund_releases (
  authorization_id uuid primary key references public.money_refund_attempts(authorization_id),
  obligation_id uuid not null references public.money_obligations(id),
  amount bigint not null check (amount>0),
  failed_reference text not null check (failed_reference like 're\_%'),
  readback_id uuid not null unique references public.money_refund_readbacks(id),
  reason text not null check (length(trim(reason))>0),
  evidence text not null check (length(trim(evidence))>0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);
create index money_refund_releases_obligation on public.money_refund_releases(obligation_id);

do $$ declare t text; begin
  foreach t in array array['money_refund_releases'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;

-- A resend is a new send generation, numbered with the TRACE-077 reissues. It names the Stripe
-- refund that failed; a reissue (nothing found at Stripe) leaves it null.
alter table public.money_refund_reissues add column failed_reference text
  check (failed_reference is null or failed_reference like 're\_%');

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry','ach_withdrawal',
    'ach_late_settlement','payout_recovery','bank_statement_close','refund_release'));
-- The evidence shape is unchanged: refund_release is not in its no-evidence list, so it needs evidence.

-- The readback that proves this refund's current send failed at Stripe: the latest readback,
-- found, naming the refund the attempt recorded, failed or canceled, and taken no earlier than
-- the current generation was prepared. Null when there is none.
create function private.money_refund_failure_readback(p_authorization uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select b.id from public.money_refund_attempts a
    join lateral (select * from public.money_refund_readbacks x where x.authorization_id=a.authorization_id
      order by x.readback_sequence desc limit 1) b on true
  where a.authorization_id=p_authorization and b.found and b.provider_reference=a.provider_reference
    and b.provider_status in ('failed','canceled') and b.created_at>=coalesce(a.prepared_at,a.created_at)
$$;

-- Why a failed refund cannot be resent now, or null when it can. Also the release's checks.
create function private.money_failed_refund_blocker(p_authorization uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_refund_attempts;
begin
  select * into a from public.money_refund_attempts where authorization_id=p_authorization;
  if not found then return 'refund_not_sent'; end if;
  if exists(select 1 from public.money_refunds where authorization_id=a.authorization_id) then return 'refund_settled'; end if;
  if exists(select 1 from public.money_refund_releases where authorization_id=a.authorization_id) then return 'refund_released'; end if;
  if a.status<>'failed' then return 'refund_not_failed'; end if;
  if private.money_refund_failure_readback(a.authorization_id) is null then return 'readback_required'; end if;
  return null;
end $$;

-- The exact object the release kernel hashes. It names the Stripe refund that failed, so an
-- approval cannot apply after the refund was resent.
create function private.money_refund_release_command(p_authorization uuid,p_reference text,p_reason text,p_evidence text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','refund_release','authorization',p_authorization,'reference',p_reference,
    'reason',p_reason,'evidence',p_evidence)
$$;

-- Why this release cannot be recorded now. Mirrors money_release_refund.
create function private.money_refund_release_blocker(p_authorization uuid,p_reference text)
returns text language plpgsql stable security definer set search_path='' as $$
declare blocker text;
begin
  if not exists(select 1 from public.money_refund_authorizations where id=p_authorization) then return 'not_found'; end if;
  if exists(select 1 from public.money_refund_releases where authorization_id=p_authorization) then return 'completed'; end if;
  blocker:=private.money_failed_refund_blocker(p_authorization);
  if blocker is not null then return blocker; end if;
  if (select provider_reference from public.money_refund_attempts where authorization_id=p_authorization) is distinct from p_reference then
    return 'refund_changed';
  end if;
  return null;
end $$;

-- Kernel: take a failed refund off the books. Two finance operators, bound to the exact command.
-- Posts nothing; the authorization stops holding the payout and counting against the caps.
create function public.money_release_refund(p_authorization uuid,p_reference text,p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts; x public.money_refund_releases; readback uuid;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_refund_release_command(p_authorization,p_reference,p_reason,p_evidence));
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  -- The order money_prepare_refund and the reissue take: obligation, then attempt.
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  select * into a from public.money_refund_attempts where authorization_id=r.id for update;
  select * into x from public.money_refund_releases where authorization_id=r.id;
  if found then
    if x.failed_reference<>p_reference or x.requested_by<>p_actor or x.approved_by<>p_approver or x.reason<>p_reason or x.evidence<>p_evidence then
      raise exception 'Refund release idempotency conflict';
    end if;
    return r.id;
  end if;
  if a.authorization_id is null then raise exception 'Refund was not sent; nothing to release'; end if;
  if exists(select 1 from public.money_refunds where authorization_id=r.id) then raise exception 'A settled refund cannot be released'; end if;
  if a.status<>'failed' then raise exception 'Only a refund Stripe reported failed or canceled can be released'; end if;
  if a.provider_reference is distinct from p_reference then raise exception 'Refund changed since the release was requested'; end if;
  readback:=private.money_refund_failure_readback(r.id);
  if readback is null then raise exception 'A Stripe readback showing this refund failed or canceled is required'; end if;
  insert into public.money_refund_releases(authorization_id,obligation_id,amount,failed_reference,readback_id,reason,evidence,requested_by,approved_by)
    values(r.id,r.obligation_id,r.service+r.tax+r.tip,p_reference,readback,p_reason,p_evidence,p_actor,p_approver);
  return r.id;
end $$;

-- Gateway: a release is a reviewed request bound to the refund that failed.
create function public.money_operator_request_refund_release(p_authorization uuid,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.money_refund_authorizations; reason text; evidence text; reference text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then raise exception 'Refund authorization not found' using errcode='P0002'; end if;
  reason:=btrim(p_reason); evidence:=btrim(p_evidence);
  -- A replay keeps the refund it was first requested against.
  select q.command->>'reference' into reference from public.money_review_requests q where q.business_key=p_key and q.operation='refund_release';
  if reference is null then
    select provider_reference into reference from public.money_refund_attempts where authorization_id=r.id;
  end if;
  return private.money_store_review_request(actor,p_key,'refund_release',r.id::text,r.obligation_id,
    private.money_refund_release_command(r.id,reference,reason,evidence),reason,evidence,true,null::jsonb);
end $$;

-- The refund's author or approver sends the same reviewed refund again under a new Stripe
-- idempotency key, after Stripe showed the last send failed. It never changes the amount and
-- never marks a refund settled. The failed refund's reference is kept on the generation and
-- cleared from the attempt, so the new send's refund can be recorded.
create function public.money_operator_resend_refund(p_authorization uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.money_refund_authorizations; a public.money_refund_attempts;
  x public.money_refund_reissues; blocker text; readback uuid; next_generation integer; next_key text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_text(p_reason,'Reason');
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then raise exception 'Refund authorization not found' using errcode='P0002'; end if;
  if actor not in (r.created_by,r.approved_by) then
    raise exception 'Only the refund''s author or approver can resend it' using errcode='42501';
  end if;
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  select * into a from public.money_refund_attempts where authorization_id=r.id for update;
  -- A resend is keyed by the failure readback it relied on, which stays the latest until the
  -- next readback.
  select z.* into x from public.money_refund_reissues z
    where z.authorization_id=r.id and z.failed_reference is not null
      and z.readback_id=(select b.id from public.money_refund_readbacks b where b.authorization_id=r.id order by b.readback_sequence desc limit 1);
  if found then
    if x.actor=actor and x.reason=btrim(p_reason) then
      return jsonb_build_object('authorization_id',r.id,'generation',x.generation,'replay',true);
    end if;
    raise exception 'Refund resend idempotency conflict' using errcode='23505';
  end if;
  blocker:=private.money_failed_refund_blocker(r.id);
  if blocker is not null then raise exception 'Refund resend not allowed: %',blocker using errcode='55000'; end if;
  readback:=private.money_refund_failure_readback(r.id);
  next_generation:=coalesce((select max(generation) from public.money_refund_reissues where authorization_id=r.id),1)+1;
  next_key:='mercurius:refund-v1:'||r.id||':g'||next_generation;
  insert into public.money_refund_reissues(authorization_id,generation,readback_id,previous_key,idempotency_key,actor,reason,failed_reference)
    values(r.id,next_generation,readback,a.idempotency_key,next_key,actor,btrim(p_reason),a.provider_reference);
  update public.money_refund_attempts set status='prepared',idempotency_key=next_key,prepared_at=now(),provider_reference=null
    where authorization_id=r.id;
  return jsonb_build_object('authorization_id',r.id,'generation',next_generation,'replay',false);
end $$;

-- Every writer of refund attempts, including the unchanged kernels: a refund an earlier send
-- created and Stripe failed never becomes the current send's refund, and a released refund is
-- never prepared again.
create function private.money_refund_attempt_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.provider_reference is not null and new.provider_reference is distinct from old.provider_reference
    and exists(select 1 from public.money_refund_reissues x where x.authorization_id=new.authorization_id and x.failed_reference=new.provider_reference) then
    raise exception 'This Stripe refund failed on an earlier send of this refund; read back the current send' using errcode='55000';
  end if;
  if new.status='prepared' and old.status<>'prepared'
    and exists(select 1 from public.money_refund_releases z where z.authorization_id=new.authorization_id) then
    raise exception 'A released refund cannot be sent again' using errcode='55000';
  end if;
  return new;
end $$;
create trigger money_refund_attempt_guard before update on public.money_refund_attempts
  for each row execute function private.money_refund_attempt_guard();

-- The refund event kernel: a released refund never posts. Stripe's failed and canceled refunds are
-- final, so this should not happen; if it does, the event stays unprocessed, holds the payout and
-- is listed for reconciliation.
create function private.money_refund_release_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.money_refund_releases z where z.authorization_id=new.authorization_id) then
    raise exception 'Released refund requires reconciliation' using errcode='55000';
  end if;
  return new;
end $$;
create trigger money_refund_release_guard before insert on public.money_refunds
  for each row execute function private.money_refund_release_guard();

-- What a release request asks for, so the approver sees the exact refund.
create function private.money_refund_release_request_details(p_request public.money_review_requests)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('authorization_id',r.id,'payment_id',r.payment_id,'service',r.service,'tax',r.tax,'tip',r.tip,
    'amount',r.service+r.tax+r.tip,'provider_reference',p_request.command->>'reference',
    'provider_status',(select b.provider_status from public.money_refund_readbacks b where b.authorization_id=r.id
      order by b.readback_sequence desc limit 1),
    'refund_created_at',r.created_at)
  from public.money_refund_authorizations r where r.id=p_request.subject::uuid
$$;

-- Releases in the last 30 days, for the operator readback.
create function private.money_refund_release_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'authorization_id',z.authorization_id,'obligation_id',z.obligation_id,
      'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=z.obligation_id),
      'payment_id',r.payment_id,'amount',z.amount,'provider_reference',z.failed_reference,'reason',z.reason,'evidence',z.evidence,
      'by_me',p_me in (z.requested_by,z.approved_by),'created_at',z.created_at) order by z.created_at desc,z.authorization_id),'[]'::jsonb)
  from public.money_refund_releases z join public.money_refund_authorizations r on r.id=z.authorization_id
  where z.created_at>now()-interval '30 days'
$$;

-- Each body below is the latest definition, copied by a generator that asserts exactly one match per
-- substitution. Only the lines named in each note change.


-- public.money_authorize_refund: latest body from 20260905001000_money_contracts.sql; released authorizations leave both caps.
create or replace function public.money_authorize_refund(p_obligation uuid,p_payment text,p_service bigint,p_tax bigint,p_tip bigint,p_key text,p_actor uuid,p_approver uuid,p_policy text,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.money_obligations; s public.money_snapshots; existing public.money_refund_authorizations; result uuid;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','refund','obligation',p_obligation,'payment',p_payment,'service',p_service,'tax',p_tax,'tip',p_tip,'key',p_key,'policy',p_policy,'reason',p_reason));
  select * into strict o from public.money_obligations where id=p_obligation for update;
  select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
  select * into existing from public.money_refund_authorizations where business_key=p_key;
  if found then
    if existing.obligation_id<>p_obligation or existing.payment_id<>p_payment or existing.service<>p_service or existing.tax<>p_tax or existing.tip<>p_tip
      or existing.created_by<>p_actor or existing.approved_by<>p_approver or existing.policy_evidence<>p_policy or existing.reason<>p_reason then raise exception 'Refund idempotency conflict'; end if;
    return existing.id;
  end if;
  if o.captured<s.total and (p_tax<>0 or p_tip<>0) then raise exception 'Deposit refunds apply only to service advance'; end if;
  if not exists(select 1 from public.money_checkout_attempts where obligation_id=o.id and stripe_payment_id=p_payment and status='captured') then raise exception 'Captured payment required'; end if;
  -- Include pending authorizations: no concurrent oversubscription of refundable components.
  if (select coalesce(sum(service),0)+p_service>s.subtotal or coalesce(sum(tax),0)+p_tax>s.tax or coalesce(sum(tip),0)+p_tip>s.tip from public.money_refund_authorizations r where r.obligation_id=o.id and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id))
    then raise exception 'Refund exceeds remaining components'; end if;
  if (select coalesce(sum(service+tax+tip),0)+p_service+p_tax+p_tip from public.money_refund_authorizations r where r.payment_id=p_payment and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id))
    > (select amount from public.money_checkout_attempts where stripe_payment_id=p_payment) then raise exception 'Refund exceeds payment'; end if;
  insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,business_key,created_by,approved_by,policy_evidence,reason)
    values(o.id,p_payment,p_service,p_tax,p_tip,p_key,p_actor,p_approver,p_policy,p_reason) returning id into result;
  return result;
end $$;


-- private.money_refund_blocker: latest body from 20260921003000_money_payout_recovery.sql; released authorizations leave both caps.
create or replace function private.money_refund_blocker(p_obligation uuid,p_payment text,p_service bigint,p_tax bigint,p_tip bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare o public.money_obligations; s public.money_snapshots; a public.money_checkout_attempts;
begin
  select * into o from public.money_obligations where id=p_obligation;
  if not found then return 'not_found'; end if;
  select * into s from public.money_snapshots where id=o.current_snapshot_id;
  if not found then return 'not_found'; end if;
  if p_service is null or p_tax is null or p_tip is null or least(p_service,p_tax,p_tip)<0 or p_service+p_tax+p_tip=0 then return 'refund_amount_invalid'; end if;
  select * into a from public.money_checkout_attempts where obligation_id=o.id and stripe_payment_id=p_payment and status='captured';
  if not found then return 'payment_not_captured'; end if;
  if o.captured<s.total and (p_tax<>0 or p_tip<>0) then return 'deposit_service_only'; end if;
  if (select coalesce(sum(service),0)+p_service>s.subtotal or coalesce(sum(tax),0)+p_tax>s.tax or coalesce(sum(tip),0)+p_tip>s.tip
    from public.money_refund_authorizations r where r.obligation_id=o.id and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)) then return 'refund_exceeds_components'; end if;
  if (select coalesce(sum(service+tax+tip),0)+p_service+p_tax+p_tip from public.money_refund_authorizations r where r.payment_id=p_payment and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id))>a.amount then
    return 'refund_exceeds_payment';
  end if;
  if private.money_ach_unpaid_statement(o.id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=o.id and status in ('open','lost')) then return 'chargeback_open'; end if;
  return null;
end $$;


-- private.money_cancellation_refund_line: latest body from 20260905013000_provider_replacement_refunds.sql; released authorizations no longer count toward the policy target or reserve a payment.
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
    from public.money_refund_authorizations r where r.obligation_id=o.id and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)
      and not exists(select 1 from public.money_operation_refund_sources x
        where x.authorization_id=r.id and x.operation_id=p_operation);
  select coalesce(sum(greatest(a.amount-coalesce(r.reserved,0),0)),0)::bigint into prior_capacity
    from public.money_checkout_attempts a
    left join lateral (select sum(x.service+x.tax+x.tip)::bigint reserved
      from public.money_refund_authorizations x where x.payment_id=a.stripe_payment_id and not exists(select 1 from public.money_refund_releases z where z.authorization_id=x.id)
        and not exists(select 1 from public.money_operation_refund_sources z
          where z.authorization_id=x.id and z.operation_id=p_operation)) r on true
    where a.obligation_id=o.id and a.status='captured' and a.stripe_payment_id is not null
      and (coalesce(a.completed_at,a.created_at),a.id)<(coalesce(attempt.completed_at,attempt.created_at),attempt.id);
  line_start:=least(prior_capacity,target_service+target_tax+target_tip);
  line_total:=least(
    greatest(attempt.amount-coalesce((select sum(r.service+r.tax+r.tip)
      from public.money_refund_authorizations r where r.payment_id=p_payment and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)
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


-- private.money_payable: latest body from 20260913002000_vendor_payout_evidence_lapse.sql; a released refund does not hold the payout.
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
  if exists(select 1 from public.money_refund_authorizations r where obligation_id=o.id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)) then raise exception 'Pending refund hold'; end if;
  if not private.vendor_payout_eligible(payee) then raise exception 'Vendor onboarding hold'; end if;
  select * into strict retained from public.money_retained_parts(o.id);
  amount:=retained.service-round(retained.service::numeric*15/100)+retained.tip;
  if amount<=0 then raise exception 'No provider payable'; end if;
  return amount;
end $$;


-- private.money_ach_payable: latest body from 20260921003000_money_payout_recovery.sql; a released refund does not hold the payout.
create or replace function private.money_ach_payable(p_obligation uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.money_obligations; s public.money_snapshots; r public.service_requests;
  c public.money_lifecycle_confirmations; evidence public.money_completion_evidence;
  retained record; payee uuid; banks uuid[]; payable bigint;
begin
  select * into o from public.money_obligations where id=p_obligation;
  if not found then return jsonb_build_object('blocker','not_found'); end if;
  begin
    c:=private.money_completion_source(o.id);
  exception when others then
    return jsonb_build_object('blocker',case when sqlerrm like 'Replacement commercial reconciliation%'
      then 'replacement_reconciliation' else 'awaiting_confirmation' end);
  end;
  select * into strict r from public.service_requests where id=c.request_id;
  if r.disputed or r.status not in ('homeowner_confirmed','completed','review_requested','reviewed','closed','resolved')
    or exists(select 1 from public.disputes where job_id=r.id and status<>'resolved')
    or exists(select 1 from public.dispute_appeals a join public.disputes d on d.id=a.dispute_id
      left join public.support_tickets t on t.id=a.ticket_id where d.job_id=r.id and (t.id is null or t.status<>'resolved')) then
    return jsonb_build_object('blocker','dispute_hold');
  end if;
  -- money_record_completion refuses evidence that differs from the confirmation.
  select * into evidence from public.money_completion_evidence where obligation_id=o.id;
  if (evidence.obligation_id is not null and (evidence.homeowner_id,evidence.confirmed_at,evidence.source_ref)
      is distinct from (c.homeowner_id,c.confirmed_at,'phase4-confirmation:'||c.id))
    or exists(select 1 from public.money_completion_evidence x where x.source_ref='phase4-confirmation:'||c.id and x.obligation_id<>o.id) then
    return jsonb_build_object('blocker','confirmation_conflict');
  end if;
  select * into s from public.money_snapshots where id=o.current_snapshot_id;
  if s.id is null or o.captured<>s.total then return jsonb_build_object('blocker','payment_incomplete'); end if;
  if o.dispute_open then return jsonb_build_object('blocker','chargeback_hold'); end if;
  if o.reconciliation_open then return jsonb_build_object('blocker','reconciliation_hold'); end if;
  if private.money_unprocessed_events(o.id)>0 then return jsonb_build_object('blocker','provider_event_hold'); end if;
  if c.confirmed_at+interval '48 hours'>now() then return jsonb_build_object('blocker','confirmation_window'); end if;
  if exists(select 1 from public.money_holds h where h.obligation_id=o.id
    and not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)) then
    return jsonb_build_object('blocker','payout_hold');
  end if;
  if exists(select 1 from public.money_refund_authorizations a where a.obligation_id=o.id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id)) then
    return jsonb_build_object('blocker','refund_hold');
  end if;
  payee:=private.money_effective_contractor(o.id);
  if not private.vendor_payout_eligible(payee) then return jsonb_build_object('blocker','payout_onboarding'); end if;
  select * into strict retained from public.money_retained_parts(o.id);
  payable:=retained.service-round(retained.service::numeric*15/100)+retained.tip;
  if payable<=0 then return jsonb_build_object('blocker','no_payable'); end if;
  -- TRACE-080: never more than the proceeds in total; a paid payout is never paid again.
  if private.money_ach_exceeds_proceeds(o.id,payable) then return jsonb_build_object('blocker','already_paid'); end if;
  select array_agg(e.id order by e.id) into banks from public.vendor_compliance_evidence e
    where e.contractor_id=payee and e.kind='bank_authorization'
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  return jsonb_build_object('blocker',null,'amount',payable,'payee',payee,
    'bank_evidence',case when cardinality(banks)=1 then banks[1] end,'bank_count',coalesce(cardinality(banks),0),
    'eligible_at',c.confirmed_at+interval '48 hours');
end $$;


-- private.money_chargeback_state_blocker: latest body from 20260921003000_money_payout_recovery.sql; a released refund does not block chargeback allocation.
create or replace function private.money_chargeback_state_blocker(p_dispute text)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.money_disputes;
begin
  select * into d from public.money_disputes where provider_id=p_dispute;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_chargeback_resolutions where dispute_id=d.provider_id) then return 'completed'; end if;
  if d.status<>'lost' then return 'dispute_not_lost'; end if;
  if private.money_ach_unpaid_statement(d.obligation_id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_refund_authorizations r where r.obligation_id=d.obligation_id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)) then return 'refund_pending'; end if;
  return null;
end $$;


-- public.money_resolve_chargeback_loss: latest body from 20260921003000_money_payout_recovery.sql; a released refund does not block chargeback allocation.
create or replace function public.money_resolve_chargeback_loss(p_dispute text,p_service bigint,p_tax bigint,p_tip bigint,p_actor uuid,p_approver uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare d public.money_disputes; remaining record; old_fee bigint; new_fee bigint; provider bigint; lines jsonb;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','chargeback','dispute',p_dispute,'service',p_service,'tax',p_tax,'tip',p_tip,'reason',p_reason));
  select * into strict d from public.money_disputes where provider_id=p_dispute;
  perform 1 from public.money_obligations where id=d.obligation_id for update;
  select * into strict d from public.money_disputes where provider_id=p_dispute for update;
  if d.status<>'lost' then raise exception 'Confirmed chargeback loss required'; end if;
  if exists(select 1 from public.money_chargeback_resolutions where dispute_id=d.provider_id) then raise exception 'Chargeback already allocated'; end if;
  if private.money_ach_unpaid_statement(d.obligation_id) then raise exception 'Scheduled funds need their bank outcome or a withdrawal first; no automatic clawback'; end if;
  if exists(select 1 from public.money_refund_authorizations r where r.obligation_id=d.obligation_id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)) then raise exception 'Pending refund must reconcile before chargeback allocation'; end if;
  select * into strict remaining from public.money_retained_parts(d.obligation_id);
  if p_service is null or p_tax is null or p_tip is null or least(p_service,p_tax,p_tip)<0 or p_service+p_tax+p_tip<>d.amount
    or p_service>remaining.service or p_tax>remaining.tax or p_tip>remaining.tip then raise exception 'Chargeback allocation exceeds retained components'; end if;
  old_fee:=round(remaining.service::numeric*15/100); new_fee:=round((remaining.service-p_service)::numeric*15/100); provider:=p_service-(old_fee-new_fee)+p_tip;
  lines:=jsonb_build_array(jsonb_build_object('account','chargeback_suspense','debit',0,'credit',d.amount));
  if old_fee>new_fee then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',old_fee-new_fee,'credit',0)); end if;
  if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',provider,'credit',0)); end if;
  if p_tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',p_tax,'credit',0)); end if;
  insert into public.money_chargeback_resolutions(dispute_id,service,tax,tip,actor,approver,reason) values(d.provider_id,p_service,p_tax,p_tip,p_actor,p_approver,p_reason);
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(d.obligation_id,'chargeback-loss:'||d.provider_id,'chargeback_loss',lines,p_reason);
  update public.money_obligations set dispute_open=exists(select 1 from public.money_disputes x where x.obligation_id=d.obligation_id and
    (x.status='open' or (x.status='lost' and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=x.provider_id)))) where id=d.obligation_id;
end $$;


-- private.money_obligation_reconciliation: latest body from 20260921003000_money_payout_recovery.sql; a released refund is not pending and is counted as released.
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
  late bigint; repaid bigint; written_off bigint;
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
      and exists(select 1 from public.money_refunds f where f.authorization_id=a.id);
  refunds_settled:=settled.n;
  select count(*) into pending_refunds from public.money_refund_authorizations a where a.obligation_id=o.id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id);
  select count(*) into released_refunds from public.money_refund_releases z where z.obligation_id=o.id;
  select count(*),coalesce(sum(credit),0) into refund_journals,refund_clearing from (
    select j.id,sum((l->>'credit')::bigint) credit from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.obligation_id=o.id and j.kind='refund' and l->>'account'='stripe_clearing' group by j.id) x;
  if (settled.service,settled.tax,settled.tip)<>(o.refunded_service,o.refunded_tax,o.refunded_tip) then issues:=array_append(issues,'refund_counters'); end if;
  if refund_journals<>refunds_settled or refund_clearing<>o.refunded_service+o.refunded_tax+o.refunded_tip then issues:=array_append(issues,'refund_ledger'); end if;

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
  if -private.money_account_net(o.id,'provider_payable')<>proceeds-paid+returned+repaid+written_off then issues:=array_append(issues,'provider_payable'); end if;
  if private.money_account_net(o.id,'bank')<>returned-paid+repaid then issues:=array_append(issues,'bank_ledger'); end if;
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
  clearing_expected:=o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip-disputed-processor;
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
      'settled',refunds_settled,'pending',pending_refunds,'released',released_refunds),
    'earnings',jsonb_build_object('platform_fee',fee,'platform_fee_ledger',-private.money_account_net(o.id,'platform_revenue'),
      'tax',tax_expected,'tax_ledger',-private.money_account_net(o.id,'tax_liability'),'provider_proceeds',proceeds),
    'payout',jsonb_build_object('funds_state',funds,'not_eligible',to_jsonb(not_eligible),'held',to_jsonb(held),
      'eligible_at',case when item.id is null then eligible_at end,
      'paid',paid,'returned',returned,'payable',proceeds-paid+returned+repaid+written_off,
      'payable_ledger',-private.money_account_net(o.id,'provider_payable'),
      'recovery',jsonb_build_object('owed',private.money_payout_owed(o.id),'late_settled',late,'repaid',repaid,'written_off',written_off),
      'withdrawn_statements',(select count(*) from public.money_ach_withdrawals w join public.money_ach_items i on i.id=w.item_id where i.obligation_id=o.id),
      'statement',case when item.id is null then null else jsonb_build_object('amount',item.amount,
        'period_start',(select period_start from public.money_ach_batches where id=item.batch_id),
        'attempt_number',attempt.attempt_number,'bank_status',bank_status) end),
    'chargebacks',jsonb_build_object('suspense',suspense_expected,'suspense_ledger',private.money_account_net(o.id,'chargeback_suspense'),
      'lost',lost),
    'processor_costs',processor,
    'readback',case when readback.id is null then jsonb_build_object('state','none') else jsonb_build_object(
      'state',case when readback.observed<>readback.expected or readback.currency<>'usd' then 'mismatch'
        when readback.expected<>o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip then 'outdated' else 'matched' end,
      'observed',readback.observed,'expected',readback.expected,'recorded_at',readback.created_at) end,
    'reconciliation_open',o.reconciliation_open,
    'issues',to_jsonb(issues));
end $$;


-- private.money_request_blocker: latest body from 20260922001000_money_bank_statements.sql; adds refund_release.
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


-- public.money_operator_execute_review: latest body from 20260922001000_money_bank_statements.sql; adds refund_release, which takes the obligation lock like a refund.
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
  elsif q.operation='payout_recovery' then
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


-- public.money_finance_operations: latest body from 20260922001000_money_bank_statements.sql; release requests read back their details; the refund list drops released refunds and gains the resend and release state; the readback gains recent releases.
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
          when q.operation='refund_release' then private.money_refund_release_request_details(q) end,
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
        'net_collected',o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip,
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
    'statements',private.money_bank_statement_operations(me));
end $$;


-- public.money_finance_reconciliation: latest body from 20260922001000_money_bank_statements.sql; a released refund is not a pending refund exception.
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


-- public.money_refund_readback_target: latest body from 20260916002000_money_finance_commands.sql; returns the refunds earlier sends created that failed, which a readback must skip, and whether it was released.
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
    'failed_references',coalesce((select jsonb_agg(x.failed_reference order by x.generation) from public.money_refund_reissues x
      where x.authorization_id=r.id and x.failed_reference is not null),'[]'::jsonb));
end $$;


revoke all on function private.money_refund_failure_readback(uuid),
  private.money_failed_refund_blocker(uuid),
  private.money_refund_release_command(uuid,text,text,text),
  private.money_refund_release_blocker(uuid,text),
  private.money_refund_attempt_guard(),
  private.money_refund_release_guard(),
  private.money_refund_release_request_details(public.money_review_requests),
  private.money_refund_release_operations(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.money_release_refund(uuid,text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_release_refund(uuid,text,uuid,uuid,text,text) to service_role;
revoke all on function public.money_operator_request_refund_release(uuid,text,text,text),
  public.money_operator_resend_refund(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.money_operator_request_refund_release(uuid,text,text,text),
  public.money_operator_resend_refund(uuid,text) to authenticated;
