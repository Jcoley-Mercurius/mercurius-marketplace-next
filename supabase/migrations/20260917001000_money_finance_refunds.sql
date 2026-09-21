-- TRACE-077: finance operator commands, part 2A (MPS §§6.5/7; CFG-005/006/007; TRACE-056/057/076).
--
-- Owner decisions 2026-09-17:
--  * G3: one finance operator releases a payout hold. money_operator_release_hold replaces the
--    two-person hold release request, which the gateway no longer accepts.
--  * G9: a reviewed request expires 24 hours after it is created. Only an approval given to that
--    request inside its window counts, and nothing is approved or run after it.
--  * Refund authorization keeps its existing dual review (TRACE-056) as is: the requester is the
--    refund's author and the approving operator its approver. No further review is layered on.
-- Adds reviewed requests for a refund, a policy cancellation refund and a lost-chargeback
-- allocation, each run through its unchanged kernel; and the reissue of a refund whose Stripe
-- outcome was uncertain, once a Stripe readback taken after the idempotency window finds none.
-- The only kernel change is money_prepare_refund reading the reissue time for its 23-hour rule.

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation'));
-- Evidence is the refund's policy reference; the other new commands carry none.
alter table public.money_review_requests drop constraint money_review_requests_check;
alter table public.money_review_requests add constraint money_review_requests_evidence_shape
  check ((operation in ('reconciliation_resolution','cancellation_refund','chargeback_allocation'))=(evidence is null));

-- The approval a request received. The kernel approval is keyed by command hash only, so an old
-- approval of identical text would otherwise carry over to a new request.
create table public.money_review_request_approvals (
  request_id uuid not null references public.money_review_requests(id),
  approval_id uuid not null references public.money_review_approvals(id),
  approved_by uuid not null references auth.users(id),
  reason text not null check (length(trim(reason))>0 and length(reason)<=1000),
  created_at timestamptz not null default now(),
  primary key (request_id,approved_by)
);

-- A refund's current send generation starts here; null means the attempt's created_at.
alter table public.money_refund_attempts add column prepared_at timestamptz;

create table public.money_refund_reissues (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.money_refund_attempts(authorization_id),
  generation integer not null check (generation>=2),
  readback_id uuid not null unique references public.money_refund_readbacks(id),
  previous_key text not null,
  idempotency_key text not null unique,
  actor uuid not null references auth.users(id),
  reason text not null check (length(trim(reason))>0 and length(reason)<=1000),
  created_at timestamptz not null default now(),
  unique (authorization_id,generation)
);

do $$ declare t text; begin
  foreach t in array array['money_review_request_approvals','money_refund_reissues'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;

-- Kernel: identical except that a reissued refund's 23-hour window starts at its reissue.
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
  if exists(select 1 from public.money_refunds where authorization_id=r.id) then
    update public.money_refund_attempts set status='succeeded' where authorization_id=r.id returning * into a;
  elsif a.status='prepared' and coalesce(a.prepared_at,a.created_at)<=now()-interval '23 hours' then
    update public.money_refund_attempts set status='reconcile' where authorization_id=r.id returning * into a;
  end if;
  return a;
end $$;

create function private.money_review_expires_at(p_created timestamptz) returns timestamptz
language sql stable set search_path='' as $$ select p_created+interval '24 hours' $$;

-- The exact objects money_authorize_refund and money_resolve_chargeback_loss hash.
create function private.money_refund_command(p_obligation uuid,p_payment text,p_service bigint,p_tax bigint,p_tip bigint,p_key text,p_policy text,p_reason text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','refund','obligation',p_obligation,'payment',p_payment,'service',p_service,'tax',p_tax,'tip',p_tip,'key',p_key,'policy',p_policy,'reason',p_reason)
$$;
create function private.money_chargeback_command(p_dispute text,p_service bigint,p_tax bigint,p_tip bigint,p_reason text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','chargeback','dispute',p_dispute,'service',p_service,'tax',p_tax,'tip',p_tip,'reason',p_reason)
$$;

-- Why a refund of these amounts cannot be authorized now. Mirrors money_authorize_refund and the
-- refund bank guard so operators see the reason before anyone approves.
create function private.money_refund_blocker(p_obligation uuid,p_payment text,p_service bigint,p_tax bigint,p_tip bigint)
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
    from public.money_refund_authorizations where obligation_id=o.id) then return 'refund_exceeds_components'; end if;
  if (select coalesce(sum(service+tax+tip),0)+p_service+p_tax+p_tip from public.money_refund_authorizations where payment_id=p_payment)>a.amount then
    return 'refund_exceeds_payment';
  end if;
  if exists(select 1 from public.money_ach_items where obligation_id=o.id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=o.id and status in ('open','lost')) then return 'chargeback_open'; end if;
  return null;
end $$;

-- The policy refund a cancellation produces for one payment, or null when it produces none that
-- can be computed (not cancelled, no approved assessment, no no-replacement decision, ...).
create function private.money_cancellation_preview(p_operation uuid,p_payment text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return (select to_jsonb(p) from private.money_cancellation_refund_line(p_operation,p_payment) p);
exception when others then
  return null;
end $$;

-- Why a lost chargeback cannot be allocated now, before the amounts are considered.
create function private.money_chargeback_state_blocker(p_dispute text)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.money_disputes;
begin
  select * into d from public.money_disputes where provider_id=p_dispute;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_chargeback_resolutions where dispute_id=d.provider_id) then return 'completed'; end if;
  if d.status<>'lost' then return 'dispute_not_lost'; end if;
  if exists(select 1 from public.money_ach_items where obligation_id=d.obligation_id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_refund_authorizations r where r.obligation_id=d.obligation_id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then return 'refund_pending'; end if;
  return null;
end $$;

create function private.money_chargeback_blocker(p_dispute text,p_service bigint,p_tax bigint,p_tip bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.money_disputes; remaining record; blocker text;
begin
  blocker:=private.money_chargeback_state_blocker(p_dispute);
  if blocker is not null then return blocker; end if;
  select * into strict d from public.money_disputes where provider_id=p_dispute;
  select * into strict remaining from public.money_retained_parts(d.obligation_id);
  if p_service is null or p_tax is null or p_tip is null or least(p_service,p_tax,p_tip)<0 or p_service+p_tax+p_tip<>d.amount
    or p_service>remaining.service or p_tax>remaining.tax or p_tip>remaining.tip then return 'allocation_invalid'; end if;
  return null;
end $$;

-- Why a stored command cannot run now, or null when it can.
create function private.money_command_blocker(p_operation text,p_subject text,p_command jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare op uuid; payment text; preview jsonb;
begin
  if p_operation in ('event_exclusion','reconciliation_resolution','hold_resolution') then
    return private.money_review_blocker(p_operation,p_subject);
  elsif p_operation='refund_authorization' then
    if exists(select 1 from public.money_refund_authorizations where business_key=p_command->>'key') then return 'completed'; end if;
    return private.money_refund_blocker((p_command->>'obligation')::uuid,p_command->>'payment',
      (p_command->>'service')::bigint,(p_command->>'tax')::bigint,(p_command->>'tip')::bigint);
  elsif p_operation='cancellation_refund' then
    op:=split_part(p_subject,':',1)::uuid;
    payment:=substr(p_subject,length(split_part(p_subject,':',1))+2);
    if exists(select 1 from public.money_operation_refund_sources where operation_id=op and payment_id=payment) then return 'completed'; end if;
    preview:=private.money_cancellation_preview(op,payment);
    if preview is null then return 'not_eligible'; end if;
    if (preview->>'service')::bigint+(preview->>'tax')::bigint+(preview->>'tip')::bigint=0 then return 'no_refund_due'; end if;
    if private.money_refund_command((preview->>'obligation_id')::uuid,payment,(preview->>'service')::bigint,(preview->>'tax')::bigint,
      (preview->>'tip')::bigint,preview->>'business_key',preview->>'policy_evidence',p_command->>'reason')<>p_command then
      return 'amount_changed';
    end if;
    return private.money_refund_blocker((preview->>'obligation_id')::uuid,payment,
      (preview->>'service')::bigint,(preview->>'tax')::bigint,(preview->>'tip')::bigint);
  elsif p_operation='chargeback_allocation' then
    return private.money_chargeback_blocker(p_subject,(p_command->>'service')::bigint,(p_command->>'tax')::bigint,(p_command->>'tip')::bigint);
  end if;
  return 'not_found';
end $$;

-- The approver execution will use: a different operator who approved this request inside its
-- window, still holds finance authority and, for a readback resolution, did not record it.
create or replace function private.money_review_approver(p_request uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select ra.approved_by from public.money_review_requests q
  join public.money_review_request_approvals ra on ra.request_id=q.id
  join public.money_review_approvals a on a.id=ra.approval_id and a.approved_by=ra.approved_by
    and a.requested_by=q.requested_by and a.command_hash=q.command_hash
  where q.id=p_request and ra.approved_by<>q.requested_by
    and ra.created_at<private.money_review_expires_at(q.created_at)
    and public.has_role(ra.approved_by,'admin') and exists(select 1 from public.money_authorities m where m.user_id=ra.approved_by)
    and not (q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries x
      where x.observation_id::text=q.subject and x.actor=ra.approved_by))
  order by ra.created_at,ra.approved_by limit 1
$$;

-- Stores a new request, or replays one with the same key. Callers validate their inputs first.
-- p_command is null when the command cannot be built (a cancellation with no computable refund).
create function private.money_store_review_request(p_actor uuid,p_key text,p_operation text,p_subject text,
  p_obligation uuid,p_command jsonb,p_reason text,p_evidence text,p_replay_compares_command boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.money_review_requests; blocker text;
begin
  perform pg_advisory_xact_lock(hashtextextended('money_review_request:'||p_key,0));
  select * into q from public.money_review_requests where business_key=p_key;
  if found then
    if q.operation<>p_operation or q.subject<>p_subject or q.requested_by<>p_actor or q.reason<>p_reason
      or q.evidence is distinct from p_evidence or (p_replay_compares_command and q.command is distinct from p_command) then
      raise exception 'Review request idempotency conflict' using errcode='23505';
    end if;
    if now()>=private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions where request_id=q.id) then
      raise exception 'Finance review request expired; request it again' using errcode='55000';
    end if;
    return jsonb_build_object('request_id',q.id,'replay',true);
  end if;
  blocker:=case when p_command is null then 'not_eligible' else private.money_command_blocker(p_operation,p_subject,p_command) end;
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  insert into public.money_review_requests(business_key,operation,subject,obligation_id,command,command_hash,requested_by,reason,evidence)
    values(p_key,p_operation,p_subject,p_obligation,p_command,private.money_command_hash(p_command),p_actor,p_reason,p_evidence)
    returning * into q;
  return jsonb_build_object('request_id',q.id,'replay',false);
end $$;

create function private.money_require_cents(p_service bigint,p_tax bigint,p_tip bigint) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_service is null or p_tax is null or p_tip is null or least(p_service,p_tax,p_tip)<0 or p_service+p_tax+p_tip=0 then
    raise exception 'Service, tax and tip amounts in cents required' using errcode='22023';
  end if;
end $$;

-- Owner decision G3: one finance operator releases a payout hold.
create function public.money_operator_release_hold(p_hold uuid,p_reason text,p_evidence text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h public.money_holds; r public.money_hold_resolutions;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  select * into h from public.money_holds where id=p_hold;
  if not found then raise exception 'Payout hold not found' using errcode='P0002'; end if;
  perform 1 from public.money_obligations where id=h.obligation_id for update;
  select * into r from public.money_hold_resolutions where hold_id=h.id;
  if found then
    if r.actor=actor and r.reason=p_reason and r.evidence=p_evidence then
      return jsonb_build_object('hold_id',h.id,'replay',true);
    end if;
    raise exception 'Payout hold already released' using errcode='55000';
  end if;
  perform public.money_resolve_hold(h.id,actor,p_reason,p_evidence);
  return jsonb_build_object('hold_id',h.id,'replay',false);
end $$;

-- Step 1 for event exclusion and readback resolution; hold release is no longer reviewed.
create or replace function public.money_operator_request_review(p_operation text,p_subject text,p_reason text,p_key text,p_evidence text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject text; command jsonb; obligation uuid;
begin
  perform public.money_require_finance(actor);
  if p_operation='hold_resolution' then
    raise exception 'A payout hold is released by one finance operator; release it directly' using errcode='22023';
  end if;
  if p_operation is null or p_operation not in ('event_exclusion','reconciliation_resolution') then
    raise exception 'Unsupported finance review' using errcode='22023';
  end if;
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  if p_operation='reconciliation_resolution' then
    if p_evidence is not null then raise exception 'A readback resolution takes no separate evidence' using errcode='22023'; end if;
  else
    perform private.money_require_text(p_evidence,'Evidence');
  end if;
  if p_operation='event_exclusion' then
    subject:=p_subject;
  elsif private.money_is_uuid(p_subject) then
    subject:=p_subject::uuid::text;
  else
    raise exception 'Finance review subject not found' using errcode='P0002';
  end if;
  if private.money_review_blocker(p_operation,subject)='not_found' then
    raise exception 'Finance review subject not found' using errcode='P0002';
  end if;
  command:=private.money_review_command(p_operation,subject,p_reason,p_evidence);
  if p_operation='event_exclusion' then
    select a.obligation_id into obligation from public.money_webhook_events e join public.money_checkout_attempts a
      on a.id::text=e.payload->>'attempt_id' or a.stripe_payment_id=e.payload->>'payment_id' where e.event_id=subject order by a.created_at limit 1;
  else
    select obligation_id into obligation from public.money_reconciliation where id::text=subject;
  end if;
  return private.money_store_review_request(actor,p_key,p_operation,subject,obligation,command,p_reason,p_evidence,true);
end $$;

-- A reviewed refund of exact service, tax and tip on one captured payment. The policy reference
-- is the decision it implements (dispute outcome, rework agreement, ...).
create function public.money_operator_request_refund(p_obligation uuid,p_payment text,p_service bigint,p_tax bigint,p_tip bigint,p_policy text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reason text; policy text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_policy,'Policy reference');
  perform private.money_require_cents(p_service,p_tax,p_tip);
  if p_payment is null or length(p_payment) not between 1 and 255 then raise exception 'Stripe payment required' using errcode='22023'; end if;
  if not exists(select 1 from public.money_obligations where id=p_obligation) then
    raise exception 'Finance obligation not found' using errcode='P0002';
  end if;
  reason:=btrim(p_reason); policy:=btrim(p_policy);
  return private.money_store_review_request(actor,p_key,'refund_authorization',p_obligation::text,p_obligation,
    private.money_refund_command(p_obligation,p_payment,p_service,p_tax,p_tip,'finance-request:'||p_key,policy,reason),reason,policy,true);
end $$;

-- The refund a recorded cancellation produces under CFG-006/007 for one payment. Amounts come
-- from the policy line, never the caller; a later change in them makes the request stale.
create function public.money_operator_request_cancellation_refund(p_operation uuid,p_payment text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reason text; preview jsonb;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  if p_payment is null or length(p_payment) not between 1 and 255 or position(':' in p_payment)>0 then
    raise exception 'Stripe payment required' using errcode='22023';
  end if;
  if not exists(select 1 from public.job_operations where id=p_operation) then
    raise exception 'Cancellation not found' using errcode='P0002';
  end if;
  reason:=btrim(p_reason);
  preview:=private.money_cancellation_preview(p_operation,p_payment);
  return private.money_store_review_request(actor,p_key,'cancellation_refund',p_operation||':'||p_payment,
    (preview->>'obligation_id')::uuid,
    case when preview is not null then private.money_refund_command((preview->>'obligation_id')::uuid,p_payment,(preview->>'service')::bigint,
      (preview->>'tax')::bigint,(preview->>'tip')::bigint,preview->>'business_key',preview->>'policy_evidence',reason) end,
    reason,null,false);
end $$;

-- Allocation of a lost chargeback's principal to retained service, tax and tip.
create function public.money_operator_request_chargeback(p_dispute text,p_service bigint,p_tax bigint,p_tip bigint,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reason text; obligation uuid;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_cents(p_service,p_tax,p_tip);
  select obligation_id into obligation from public.money_disputes where provider_id=p_dispute;
  if not found then raise exception 'Chargeback not found' using errcode='P0002'; end if;
  reason:=btrim(p_reason);
  return private.money_store_review_request(actor,p_key,'chargeback_allocation',p_dispute,obligation,
    private.money_chargeback_command(p_dispute,p_service,p_tax,p_tip,reason),reason,null,true);
end $$;

-- Step 2: a different finance operator approves the stored exact command inside its window.
create or replace function public.money_operator_approve_review(p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare approver uuid:=auth.uid(); q public.money_review_requests; blocker text; approval uuid;
begin
  perform public.money_require_finance(approver);
  perform private.money_require_text(p_reason,'Reason');
  select * into q from public.money_review_requests where id=p_request;
  if not found then raise exception 'Finance review request not found' using errcode='P0002'; end if;
  if q.requested_by=approver then raise exception 'A different finance operator must approve this command' using errcode='42501'; end if;
  if q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries
    where observation_id::text=q.subject and actor=approver) then
    raise exception 'The operator who recorded this readback cannot approve its resolution' using errcode='42501';
  end if;
  if exists(select 1 from public.money_review_executions where request_id=q.id) then
    raise exception 'Finance review already executed' using errcode='55000';
  end if;
  if now()>=private.money_review_expires_at(q.created_at) then
    raise exception 'Finance review request expired; request it again' using errcode='55000';
  end if;
  blocker:=private.money_command_blocker(q.operation,q.subject,q.command);
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  approval:=public.money_approve_review(q.requested_by,q.command,p_reason);
  insert into public.money_review_request_approvals(request_id,approval_id,approved_by,reason)
    values(q.id,approval,approver,p_reason) on conflict (request_id,approved_by) do nothing;
  return jsonb_build_object('request_id',q.id,'approval_id',approval);
end $$;

-- Step 3: the requester runs the approved command through its unchanged kernel.
create or replace function public.money_operator_execute_review(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.money_review_requests; approver uuid; blocker text; job uuid;
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
  -- Two requests for the same subject serialize here; the second then sees it completed.
  perform pg_advisory_xact_lock(hashtextextended('money_review_subject:'||q.operation||':'||q.subject,0));
  -- Take the rows the kernel will lock, in the kernel's order, before checking.
  if q.operation='event_exclusion' then
    perform 1 from public.money_webhook_events where event_id=q.subject for update;
  elsif q.operation='cancellation_refund' then
    select job_id into strict job from public.job_operations where id=split_part(q.subject,':',1)::uuid;
    perform pg_advisory_xact_lock(hashtextextended(job::text,0));
    perform 1 from public.service_requests where id=job for update;
    perform 1 from public.money_obligations where service_request_id=job for update;
  else
    perform 1 from public.money_obligations where id=q.obligation_id for update;
  end if;
  approver:=private.money_review_approver(q.id);
  if approver is null then
    raise exception 'Separate authenticated approval of exact financial command required' using errcode='42501';
  end if;
  blocker:=private.money_command_blocker(q.operation,q.subject,q.command);
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
  else
    perform public.money_resolve_chargeback_loss(q.subject,(q.command->>'service')::bigint,(q.command->>'tax')::bigint,
      (q.command->>'tip')::bigint,actor,approver,q.reason);
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;

-- Why an uncertain refund cannot be reissued now, or null when it can. Stripe keeps an
-- idempotency key for 24 hours and a send starts only inside the 23-hour window, so a readback
-- taken 24 hours after the generation was prepared that finds no refund proves none was made.
create function private.money_reissue_blocker(p_authorization uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_refund_attempts; b public.money_refund_readbacks;
begin
  select * into a from public.money_refund_attempts where authorization_id=p_authorization;
  if not found then return 'refund_not_sent'; end if;
  if exists(select 1 from public.money_refunds where authorization_id=a.authorization_id) then return 'refund_settled'; end if;
  if a.status<>'reconcile' then return 'refund_not_uncertain'; end if;
  if a.provider_reference is not null then return 'refund_found_at_stripe'; end if;
  select * into b from public.money_refund_readbacks where authorization_id=a.authorization_id order by readback_sequence desc limit 1;
  if not found or b.found then return 'readback_required'; end if;
  if b.created_at<coalesce(a.prepared_at,a.created_at)+interval '24 hours' then return 'readback_too_early'; end if;
  return null;
end $$;

-- The refund's author or approver sends the same reviewed refund again under a new Stripe
-- idempotency key. It never changes the amount and never marks a refund settled.
create function public.money_operator_reissue_refund(p_authorization uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.money_refund_authorizations; a public.money_refund_attempts;
  b public.money_refund_readbacks; x public.money_refund_reissues; blocker text; next_generation integer; next_key text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_text(p_reason,'Reason');
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then raise exception 'Refund authorization not found' using errcode='P0002'; end if;
  if actor not in (r.created_by,r.approved_by) then
    raise exception 'Only the refund''s author or approver can reissue it' using errcode='42501';
  end if;
  perform 1 from public.money_obligations where id=r.obligation_id for update;
  select * into a from public.money_refund_attempts where authorization_id=r.id for update;
  select * into b from public.money_refund_readbacks where authorization_id=r.id order by readback_sequence desc limit 1;
  if b.id is not null then
    select * into x from public.money_refund_reissues where readback_id=b.id;
    if found then
      if x.actor=actor and x.reason=btrim(p_reason) then
        return jsonb_build_object('authorization_id',r.id,'generation',x.generation,'replay',true);
      end if;
      raise exception 'Refund reissue idempotency conflict' using errcode='23505';
    end if;
  end if;
  blocker:=private.money_reissue_blocker(r.id);
  if blocker is not null then raise exception 'Refund reissue not allowed: %',blocker using errcode='55000'; end if;
  next_generation:=coalesce((select max(generation) from public.money_refund_reissues where authorization_id=r.id),1)+1;
  next_key:='mercurius:refund-v1:'||r.id||':g'||next_generation;
  insert into public.money_refund_reissues(authorization_id,generation,readback_id,previous_key,idempotency_key,actor,reason)
    values(r.id,next_generation,b.id,a.idempotency_key,next_key,actor,btrim(p_reason));
  update public.money_refund_attempts set status='prepared',idempotency_key=next_key,prepared_at=now() where authorization_id=r.id;
  return jsonb_build_object('authorization_id',r.id,'generation',next_generation,'replay',false);
end $$;

-- Operator readback for the commands. Reasons, evidence and amounts are returned because an
-- approver must see exactly what they approve; bank references and customer identities are not.
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
            'dispute_id',q.subject,'service',(q.command->>'service')::bigint,'tax',(q.command->>'tax')::bigint,'tip',(q.command->>'tip')::bigint) end,
        'requested_by_me',q.requested_by=me,
        'approved_by_me',exists(select 1 from public.money_review_request_approvals a where a.request_id=q.id and a.approved_by=me),
        'recorded_by_me',q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries e where e.observation_id::text=q.subject and e.actor=me),
        'state',case when x.request_id is not null then 'executed'
          when now()>=private.money_review_expires_at(q.created_at) then 'expired'
          when private.money_command_blocker(q.operation,q.subject,q.command) is not null then 'stale'
          when private.money_review_approver(q.id) is not null then 'approved' else 'awaiting_approval' end,
        'blocker',case when x.request_id is null and now()<private.money_review_expires_at(q.created_at)
          then private.money_command_blocker(q.operation,q.subject,q.command) end,
        'created_at',q.created_at,'expires_at',private.money_review_expires_at(q.created_at),'executed_at',x.created_at) item
      from public.money_review_requests q left join public.money_review_executions x on x.request_id=q.id
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
        'last_readback',(select jsonb_build_object('found',b.found,'provider_status',b.provider_status,'by_me',b.actor=me,'created_at',b.created_at)
          from public.money_refund_readbacks b where b.authorization_id=a.id order by b.readback_sequence desc limit 1),
        'created_at',a.created_at) order by a.created_at,a.id)
      from public.money_refund_authorizations a left join public.money_refund_attempts t on t.authorization_id=a.id
      where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)),'[]'::jsonb),
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
        and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=d.provider_id)),'[]'::jsonb));
end $$;

revoke all on function private.money_review_expires_at(timestamptz),
  private.money_refund_command(uuid,text,bigint,bigint,bigint,text,text,text),
  private.money_chargeback_command(text,bigint,bigint,bigint,text),
  private.money_refund_blocker(uuid,text,bigint,bigint,bigint),
  private.money_cancellation_preview(uuid,text),
  private.money_chargeback_state_blocker(text),
  private.money_chargeback_blocker(text,bigint,bigint,bigint),
  private.money_command_blocker(text,text,jsonb),
  private.money_store_review_request(uuid,text,text,text,uuid,jsonb,text,text,boolean),
  private.money_require_cents(bigint,bigint,bigint),
  private.money_reissue_blocker(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.money_operator_release_hold(uuid,text,text),
  public.money_operator_request_refund(uuid,text,bigint,bigint,bigint,text,text,text),
  public.money_operator_request_cancellation_refund(uuid,text,text,text),
  public.money_operator_request_chargeback(text,bigint,bigint,bigint,text,text),
  public.money_operator_reissue_refund(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.money_operator_release_hold(uuid,text,text),
  public.money_operator_request_refund(uuid,text,bigint,bigint,bigint,text,text,text),
  public.money_operator_request_cancellation_refund(uuid,text,text,text),
  public.money_operator_request_chargeback(text,bigint,bigint,bigint,text,text),
  public.money_operator_reissue_refund(uuid,text)
  to authenticated;
