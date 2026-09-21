-- TRACE-079: withdrawing a transfer from a weekly ACH statement, and replacement statements
-- (MPS §§5.5/6.5/7; CFG-008; TRACE-054/055/075/076/077/078).
--
-- A statement item is immutable and was unique per payout, and nothing could take a payout off a
-- statement. A prepared transfer whose amount or bank authorization changed, or a failed transfer
-- after the provider changed banks, stayed blocked for good, and so did every refund, chargeback
-- allocation, hold and payee reassignment on that payout. This migration:
--  * adds a reviewed withdrawal of a transfer the bank does not hold: prepared (never sent), failed
--    or returned. Owner decisions 2026-09-21: two operators, those three states. The withdrawal is
--    evidence, not an edit: an immutable withdrawal row, a `withdrawn` bank event and attempt
--    status, and no journal (prepared and failed transfers posted none; a return reversed its
--    settlement);
--  * lets a withdrawn statement be replaced. The next weekly batch prepares the payout again
--    through the unchanged kernel, which re-proves eligibility, amount and bank authorization.
--    Each replacement names the withdrawn item it replaces; a trigger allows a new item only when
--    the payout's newest item was withdrawn, so a payout is on at most one live statement;
--  * makes the refund, chargeback, hold and batch guards mean a live statement, so a withdrawn
--    payout can be refunded, held, allocated a chargeback or batched again. Payee reassignment and
--    commercial source changes still refuse a payout that ever had a statement: they happen before
--    completion, so a replacement never needs them, and they stay closed.
-- A submitted, unknown or settled transfer cannot be withdrawn: the bank may have paid it.
-- Recovering funds already paid remains a separate gate.

alter table public.money_ach_attempts drop constraint money_ach_attempts_status_check;
alter table public.money_ach_attempts add constraint money_ach_attempts_status_check
  check (status in ('prepared','submitted','unknown','settled','failed','returned','withdrawn'));

-- Replacement chain: each later statement item for a payout names the withdrawn item it replaces.
alter table public.money_ach_items add column replaces_item_id uuid unique references public.money_ach_items(id);
alter table public.money_ach_items drop constraint money_ach_items_obligation_id_key;
create unique index money_ach_items_one_first_statement on public.money_ach_items(obligation_id) where replaces_item_id is null;
create index money_ach_items_obligation on public.money_ach_items(obligation_id);

create table public.money_ach_withdrawals (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.money_ach_items(id),
  attempt_id uuid not null unique references public.money_ach_attempts(id),
  previous_status text not null check (previous_status in ('prepared','failed','returned')),
  reason text not null check (length(trim(reason))>0),
  evidence text not null check (length(trim(evidence))>0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);
alter table public.money_ach_withdrawals enable row level security;
revoke all on public.money_ach_withdrawals from public,anon,authenticated,service_role;
grant select on public.money_ach_withdrawals to service_role;
create trigger immutable_evidence before update or delete on public.money_ach_withdrawals
  for each row execute function public.money_immutable();

-- The statement item a payout is on now, or null. Only the newest item of a payout can lack a
-- withdrawal (the chain trigger below), so at most one item qualifies.
create function private.money_ach_live_item(p_obligation uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select i.id from public.money_ach_items i
  where i.obligation_id=p_obligation and not exists(select 1 from public.money_ach_withdrawals w where w.item_id=i.id)
$$;
create function private.money_ach_on_statement(p_obligation uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.money_ach_live_item(p_obligation) is not null
$$;
-- The payout's most recent withdrawn statement, for the batch form and the approver.
create function private.money_ach_withdrawn_summary(p_obligation uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('item_id',i.id,'period_start',to_char(b.period_start,'YYYY-MM-DD'),'amount',i.amount,
      'previous_status',w.previous_status,'withdrawn_at',w.created_at)
  from public.money_ach_items i join public.money_ach_withdrawals w on w.item_id=i.id join public.money_ach_batches b on b.id=i.batch_id
  where i.obligation_id=p_obligation and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id)
$$;

-- Any writer of statement items, including the unchanged preparation kernel: a payout gets a new
-- item only when its newest one was withdrawn, and the new item records which one it replaces.
create function private.money_ach_item_chain() returns trigger
language plpgsql security definer set search_path='' as $$
declare head uuid;
begin
  select i.id into head from public.money_ach_items i where i.obligation_id=new.obligation_id
    and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id);
  if head is not null and not exists(select 1 from public.money_ach_withdrawals w where w.item_id=head) then
    raise exception 'Payout already on an ACH statement; withdraw its transfer before a replacement';
  end if;
  if new.replaces_item_id is not null and new.replaces_item_id is distinct from head then
    raise exception 'A replacement statement must replace the payout''s withdrawn statement';
  end if;
  new.replaces_item_id:=head;
  return new;
end $$;
create trigger money_ach_item_chain before insert on public.money_ach_items
  for each row execute function private.money_ach_item_chain();

-- The exact object money_withdraw_ach hashes. It names the bank status being withdrawn so an
-- approval cannot apply to a transfer whose status has since changed.
create function private.money_ach_withdrawal_command(p_attempt uuid,p_status text,p_reason text,p_evidence text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','ach_withdrawal','attempt',p_attempt,'status',p_status,'reason',p_reason,'evidence',p_evidence)
$$;

-- Why this transfer cannot be withdrawn now, expecting it to be in p_status. Mirrors
-- money_withdraw_ach.
create function private.money_ach_withdrawal_blocker(p_attempt uuid,p_status text)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_ach_attempts;
begin
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
  if a.status='withdrawn' or exists(select 1 from public.money_ach_attempts x where x.item_id=a.item_id and x.attempt_number>a.attempt_number) then
    return 'completed';
  end if;
  if a.status is distinct from p_status then return 'status_changed'; end if;
  if a.status in ('submitted','unknown') then return 'bank_outcome_open'; end if;
  if a.status='settled' then return 'paid'; end if;
  if a.status in ('failed','returned') and not exists(select 1 from public.money_ach_events e where e.attempt_id=a.id and e.status=a.status) then
    return 'failure_evidence_missing';
  end if;
  return null;
end $$;

-- Kernel: withdraw the latest transfer of a statement item while the bank does not hold it. Two
-- finance operators, bound to the exact command. Records evidence only; posts no journal.
create function public.money_withdraw_ach(p_attempt uuid,p_status text,p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.money_ach_items; a public.money_ach_attempts; w public.money_ach_withdrawals;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_ach_withdrawal_command(p_attempt,p_status,p_reason,p_evidence));
  select item.* into strict i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id where attempt.id=p_attempt;
  -- The other ACH kernels' order: lifecycle, provider onboarding, obligation, attempt.
  perform private.money_lock_lifecycle(array[i.obligation_id]);
  perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
  perform 1 from public.money_obligations where id=i.obligation_id for update;
  select * into strict a from public.money_ach_attempts where id=p_attempt for update;
  select * into w from public.money_ach_withdrawals where attempt_id=a.id;
  if found then
    if w.previous_status<>p_status or w.requested_by<>p_actor or w.approved_by<>p_approver or w.reason<>p_reason or w.evidence<>p_evidence then
      raise exception 'ACH withdrawal idempotency conflict';
    end if;
    return w.id;
  end if;
  if exists(select 1 from public.money_ach_attempts x where x.item_id=a.item_id and x.attempt_number>a.attempt_number) then
    raise exception 'Only the latest transfer of a statement can be withdrawn';
  end if;
  if a.status is distinct from p_status then raise exception 'Bank status changed since the withdrawal was requested'; end if;
  if a.status not in ('prepared','failed','returned') then
    raise exception 'Only an unsent, failed or returned transfer can be withdrawn; the bank may hold this one';
  end if;
  if a.status in ('failed','returned') and not exists(select 1 from public.money_ach_events e where e.attempt_id=a.id and e.status=a.status) then
    raise exception 'Bank failure evidence required';
  end if;
  insert into public.money_ach_withdrawals(item_id,attempt_id,previous_status,reason,evidence,requested_by,approved_by)
    values(i.id,a.id,a.status,p_reason,p_evidence,p_actor,p_approver) returning * into w;
  insert into public.money_ach_events(attempt_id,previous_status,status,actor,evidence,business_key)
    values(a.id,a.status,'withdrawn',p_actor,p_evidence,'ach-withdrawal:'||a.id);
  update public.money_ach_attempts set status='withdrawn' where id=a.id;
  return w.id;
end $$;

-- Gateway: withdrawing one transfer is a reviewed request. The evidence says what the bank shows:
-- for a prepared transfer, that nothing was sent; for a failed or returned one, the failure.
create function public.money_operator_request_ach_withdrawal(p_attempt uuid,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); i public.money_ach_items; a public.money_ach_attempts; reason text; evidence text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then raise exception 'Bank attempt not found' using errcode='P0002'; end if;
  select * into strict i from public.money_ach_items where id=a.item_id;
  reason:=btrim(p_reason); evidence:=btrim(p_evidence);
  return private.money_store_review_request(actor,p_key,'ach_withdrawal',a.id::text,i.obligation_id,
    private.money_ach_withdrawal_command(a.id,a.status,reason,evidence),reason,evidence,true,null::jsonb);
end $$;

-- What an ACH request asks for, so the approver sees the exact payouts and amounts. Adds the
-- transfer a withdrawal takes off its statement.
create or replace function private.money_ach_request_details(p_request public.money_review_requests,p_live boolean)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_request.operation='ach_preparation' then jsonb_build_object(
      'period_start',p_request.subject,'period_end',to_char(p_request.subject::date+7,'YYYY-MM-DD'),
      'bank_ref',p_request.command->>'bank_ref',
      'total',(select sum((t->>'amount')::bigint) from jsonb_array_elements(p_request.terms) t),
      'items',(select jsonb_agg(jsonb_build_object(
          'obligation_id',t->>'obligation','amount',(t->>'amount')::bigint,
          'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=(t->>'obligation')::uuid),
          'payee_name',(select c.name from public.contractors c where c.id=(t->>'payee')::uuid),
          'replaces',private.money_ach_withdrawn_summary((t->>'obligation')::uuid),
          'blocker',case when p_live then private.money_ach_term_blocker(t) end) order by e.n)
        from jsonb_array_elements(p_request.terms) with ordinality e(t,n)))
    when p_request.operation='ach_retry' then (select jsonb_build_object(
      'item_id',i.id,'attempt_number',a.attempt_number,'status',a.status,'amount',i.amount,
      'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id),
      'period_start',to_char(b.period_start,'YYYY-MM-DD'))
      from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id join public.money_ach_batches b on b.id=i.batch_id
      where a.id=p_request.subject::uuid)
    when p_request.operation='ach_withdrawal' then (select jsonb_build_object(
      'item_id',i.id,'attempt_number',a.attempt_number,'status',p_request.command->>'status','current_status',a.status,'amount',i.amount,
      'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id),
      'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=i.snapshot_id),
      'period_start',to_char(b.period_start,'YYYY-MM-DD'),'bank_reference_hint',right(a.bank_reference,4),
      'bank_evidence',(select e.evidence from public.money_ach_events e where e.attempt_id=a.id and e.status=p_request.command->>'status'
        order by e.created_at desc,e.id desc limit 1))
      from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id join public.money_ach_batches b on b.id=i.batch_id
      where a.id=p_request.subject::uuid) end
$$;

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry','ach_withdrawal'));
-- The evidence shape is unchanged: ach_withdrawal is not in its no-evidence list, so it needs evidence.

-- Refund, chargeback, hold and batch guards: "already on a statement" now means a live statement.
-- Each body below is the latest definition, copied unchanged except for the statement test.

-- public.money_refund_bank_guard: latest body from 20260905005000_chargeback_allocation.sql; only the statement test changes.
create or replace function public.money_refund_bank_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if private.money_ach_on_statement(new.obligation_id) then raise exception 'Bank statement reconciliation required before refund'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=new.obligation_id and status in ('open','lost')) then raise exception 'Chargeback reconciliation required before refund'; end if;
  return new;
end $$;

-- public.money_resolve_chargeback_loss: latest body from 20260905005000_chargeback_allocation.sql; only the statement test changes.
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
  if private.money_ach_on_statement(d.obligation_id) then raise exception 'Scheduled or paid funds require manual recovery review; no automatic clawback'; end if;
  if exists(select 1 from public.money_refund_authorizations r where r.obligation_id=d.obligation_id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then raise exception 'Pending refund must reconcile before chargeback allocation'; end if;
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

-- public.money_operator_place_hold: latest body from 20260916002000_money_finance_commands.sql; only the statement test changes.
create or replace function public.money_operator_place_hold(p_obligation uuid,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h public.money_holds;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  perform 1 from public.money_obligations where id=p_obligation for update;
  if not found then raise exception 'Finance obligation not found' using errcode='P0002'; end if;
  select * into h from public.money_holds where business_key=p_key;
  if found then
    if h.obligation_id<>p_obligation or h.actor<>actor or h.reason<>p_reason or h.evidence<>p_evidence then
      raise exception 'Hold idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('hold_id',h.id,'replay',true);
  end if;
  if private.money_ach_on_statement(p_obligation) then
    raise exception 'Payout already on an ACH statement; a hold cannot stop it' using errcode='55000';
  end if;
  return jsonb_build_object('hold_id',public.money_place_hold(p_obligation,p_key,actor,p_reason,p_evidence),'replay',false);
end $$;

-- private.money_refund_blocker: latest body from 20260917001000_money_finance_refunds.sql; only the statement test changes.
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
    from public.money_refund_authorizations where obligation_id=o.id) then return 'refund_exceeds_components'; end if;
  if (select coalesce(sum(service+tax+tip),0)+p_service+p_tax+p_tip from public.money_refund_authorizations where payment_id=p_payment)>a.amount then
    return 'refund_exceeds_payment';
  end if;
  if private.money_ach_on_statement(o.id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=o.id and status in ('open','lost')) then return 'chargeback_open'; end if;
  return null;
end $$;

-- private.money_chargeback_state_blocker: latest body from 20260917001000_money_finance_refunds.sql; only the statement test changes.
create or replace function private.money_chargeback_state_blocker(p_dispute text)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.money_disputes;
begin
  select * into d from public.money_disputes where provider_id=p_dispute;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_chargeback_resolutions where dispute_id=d.provider_id) then return 'completed'; end if;
  if d.status<>'lost' then return 'dispute_not_lost'; end if;
  if private.money_ach_on_statement(d.obligation_id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_refund_authorizations r where r.obligation_id=d.obligation_id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then return 'refund_pending'; end if;
  return null;
end $$;

-- private.money_ach_term_blocker: latest body from 20260921001000_money_finance_ach.sql; only the statement test changes.
create or replace function private.money_ach_term_blocker(p_term jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare p jsonb;
begin
  if private.money_ach_on_statement((p_term->>'obligation')::uuid) then return 'on_ach_statement'; end if;
  p:=private.money_ach_payable((p_term->>'obligation')::uuid);
  if p->>'blocker' is not null then return p->>'blocker'; end if;
  -- The kernel's strict lookup refuses a payee with more than one current bank authorization.
  if (p->>'bank_count')::integer<>1 then return 'bank_authorization_ambiguous'; end if;
  if (p->>'amount')::bigint is distinct from (p_term->>'amount')::bigint then return 'payable_changed'; end if;
  if p->>'payee' is distinct from p_term->>'payee' then return 'payee_changed'; end if;
  if p->>'bank_evidence' is distinct from p_term->>'bank_evidence' then return 'bank_authorization_changed'; end if;
  return null;
end $$;

-- Readbacks and the review gateway learn the withdrawal.

-- private.money_ach_record_blocker: latest body from 20260921001000_money_finance_ach.sql; withdrawn attempts take no bank outcome.
create or replace function private.money_ach_record_blocker(p_attempt uuid,p_status text,p_bank_ref text)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_ach_attempts;
begin
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
  if a.status='withdrawn' then return 'withdrawn'; end if;
  if not ((a.status='prepared' and p_status='submitted')
    or (a.status in ('submitted','unknown') and p_status in ('unknown','settled','failed'))
    or (a.status='settled' and p_status='returned')) then
    return 'transition_invalid';
  end if;
  if p_bank_ref is null or length(trim(p_bank_ref))=0 then return 'bank_reference_required'; end if;
  if a.bank_reference is not null and a.bank_reference<>p_bank_ref then return 'bank_reference_conflict'; end if;
  if exists(select 1 from public.money_ach_attempts x where x.bank_reference=p_bank_ref and x.id<>a.id) then return 'bank_reference_used'; end if;
  if p_status='submitted' then return private.money_ach_item_blocker(a.item_id); end if;
  return null;
end $$;

-- private.money_ach_retry_blocker: latest body from 20260921001000_money_finance_ach.sql; withdrawn attempts are not retried. A retry after a bank authorization change stays refused: the failed transfer is withdrawn instead and the payout goes on a replacement statement.
create or replace function private.money_ach_retry_blocker(p_attempt uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_ach_attempts;
begin
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_ach_attempts x where x.item_id=a.item_id and x.attempt_number>a.attempt_number) then return 'completed'; end if;
  if a.status='withdrawn' then return 'withdrawn'; end if;
  if a.status not in ('failed','returned') then return 'bank_outcome_open'; end if;
  if not exists(select 1 from public.money_ach_events e where e.attempt_id=a.id and e.status=a.status) then return 'failure_evidence_missing'; end if;
  return private.money_ach_item_blocker(a.item_id);
end $$;

-- private.money_request_blocker: latest body from 20260921001000_money_finance_ach.sql; adds ach_withdrawal.
create or replace function private.money_request_blocker(p_operation text,p_subject text,p_command jsonb,p_terms jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if p_operation='ach_preparation' then
    return private.money_ach_preparation_blocker(p_subject::date,p_terms);
  elsif p_operation='ach_retry' then
    return private.money_ach_retry_blocker(p_subject::uuid);
  elsif p_operation='ach_withdrawal' then
    return private.money_ach_withdrawal_blocker(p_subject::uuid,p_command->>'status');
  end if;
  return private.money_command_blocker(p_operation,p_subject,p_command);
end $$;

-- public.money_operator_execute_review: latest body from 20260921001000_money_finance_ach.sql; adds ach_withdrawal with the retry's lock order.
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
  elsif q.operation in ('ach_retry','ach_withdrawal') then
    select item.* into strict i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id
      where attempt.id=q.subject::uuid;
    perform private.money_lock_lifecycle(array[i.obligation_id]);
    perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
    perform 1 from public.money_obligations where id=i.obligation_id for update;
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
  else
    raise exception 'Unsupported finance review' using errcode='22023';
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;

-- public.money_finance_operations: latest body from 20260921001000_money_finance_ach.sql; withdrawal requests read back their details.
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
          when q.operation in ('ach_preparation','ach_retry','ach_withdrawal') then private.money_ach_request_details(q,l.live) end,
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
        and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=d.provider_id)),'[]'::jsonb),
    'ach',private.money_ach_operations(me));
end $$;

-- private.money_obligation_reconciliation: latest body from 20260916001000_money_finance_reconciliation.sql; reads the live statement, not any statement, and counts withdrawn ones.
create or replace function private.money_obligation_reconciliation(p_obligation uuid,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  o public.money_obligations; s public.money_snapshots; r public.service_requests; ret record;
  c public.money_lifecycle_confirmations; item public.money_ach_items; attempt public.money_ach_attempts;
  readback public.money_reconciliation; payee uuid; payee_name text; full_capture boolean;
  attempts_captured bigint; ledger_captured bigint; settled record; refunds_settled integer; refund_journals integer;
  refund_clearing bigint; pending_refunds integer; earnings integer; fee bigint:=0; tax_expected bigint:=0;
  proceeds bigint:=0; advance_expected bigint; paid bigint; returned bigint; suspense_expected bigint;
  clearing_expected bigint; processor bigint; disputed bigint; lost bigint; bank_status text; funds text;
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
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id);
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
  if -private.money_account_net(o.id,'provider_payable')<>proceeds-paid+returned then issues:=array_append(issues,'provider_payable'); end if;
  if private.money_account_net(o.id,'bank')<>returned-paid then issues:=array_append(issues,'bank_ledger'); end if;
  select * into item from public.money_ach_items where id=private.money_ach_live_item(o.id);
  if item.id is not null then
    select * into attempt from public.money_ach_attempts where item_id=item.id order by attempt_number desc limit 1;
    bank_status:=attempt.status;
    if s.id is null then
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
      'settled',refunds_settled,'pending',pending_refunds),
    'earnings',jsonb_build_object('platform_fee',fee,'platform_fee_ledger',-private.money_account_net(o.id,'platform_revenue'),
      'tax',tax_expected,'tax_ledger',-private.money_account_net(o.id,'tax_liability'),'provider_proceeds',proceeds),
    'payout',jsonb_build_object('funds_state',funds,'not_eligible',to_jsonb(not_eligible),'held',to_jsonb(held),
      'eligible_at',case when item.id is null then eligible_at end,
      'paid',paid,'returned',returned,'payable',proceeds-paid+returned,
      'payable_ledger',-private.money_account_net(o.id,'provider_payable'),
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

-- private.money_ach_operations: latest body from 20260921001000_money_finance_ach.sql; live statements only; withdrawals, replacements and the withdrawal path per transfer.
create or replace function private.money_ach_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'next_period_start',(select to_char(max(period_end),'YYYY-MM-DD') from public.money_ach_batches),
    'ready',coalesce((select jsonb_agg(r.item order by r.eligible_at,r.id) from (
      select o.id,(y.p->>'eligible_at')::timestamptz eligible_at,jsonb_build_object(
        'obligation_id',o.id,'invoice_number',s.invoice_number,
        'payee_id',y.p->>'payee','payee_name',(select c.name from public.contractors c where c.id=(y.p->>'payee')::uuid),
        'amount',(y.p->>'amount')::bigint,'eligible_at',y.p->>'eligible_at',
        'replaces',private.money_ach_withdrawn_summary(o.id),
        'blocker',case when (y.p->>'bank_count')::integer<>1 then 'bank_authorization_ambiguous' end,
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='ach_preparation'
          and q.terms @> jsonb_build_array(jsonb_build_object('obligation',o.id))
          and now()<private.money_review_expires_at(q.created_at)
          and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1)) item
      from public.money_obligations o
      left join public.money_snapshots s on s.id=o.current_snapshot_id
      cross join lateral (select private.money_ach_payable(o.id) p) y
      where not private.money_ach_on_statement(o.id) and y.p->>'blocker' is null
      order by 2,o.id limit 500) r),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(b.item order by b.period_start desc) from (
      select x.period_start,jsonb_build_object(
        'batch_id',x.id,'period_start',to_char(x.period_start,'YYYY-MM-DD'),'period_end',to_char(x.period_end,'YYYY-MM-DD'),
        'created_by_me',x.created_by=p_me,'approved_by_me',x.approved_by=p_me,'created_at',x.created_at,
        'total',(select sum(i.amount) from public.money_ach_items i where i.batch_id=x.id),
        'withdrawn_total',(select coalesce(sum(i.amount),0) from public.money_ach_items i join public.money_ach_withdrawals w on w.item_id=i.id where i.batch_id=x.id),
        'items',(select jsonb_agg(jsonb_build_object(
            'item_id',i.id,'obligation_id',i.obligation_id,
            'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=i.snapshot_id),
            'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id),
            'amount',i.amount,'attempt_id',a.id,'attempt_number',a.attempt_number,'status',a.status,
            'bank_reference_hint',right(a.bank_reference,4),
            'last_event',(select jsonb_build_object('status',e.status,'evidence',e.evidence,'by_me',e.actor=p_me,'created_at',e.created_at)
              from public.money_ach_events e where e.attempt_id=a.id order by e.created_at desc,e.id desc limit 1),
            'submit_blocker',case when a.status='prepared' then private.money_ach_item_blocker(i.id) end,
            'retry_blocker',case when a.status in ('failed','returned') then private.money_ach_retry_blocker(a.id) end,
            'withdraw_blocker',case when a.status in ('prepared','failed','returned') then private.money_ach_withdrawal_blocker(a.id,a.status) end,
            'open_withdrawal_request_id',(select q.id from public.money_review_requests q where q.operation='ach_withdrawal' and q.subject=a.id::text
              and now()<private.money_review_expires_at(q.created_at)
              and not exists(select 1 from public.money_review_executions z where z.request_id=q.id)
              order by q.created_at desc limit 1),
            'withdrawal',(select jsonb_build_object('previous_status',w.previous_status,'reason',w.reason,'evidence',w.evidence,
                'by_me',p_me in (w.requested_by,w.approved_by),'created_at',w.created_at)
              from public.money_ach_withdrawals w where w.item_id=i.id),
            'replaced_in',(select to_char(r.period_start,'YYYY-MM-DD') from public.money_ach_items n join public.money_ach_batches r on r.id=n.batch_id where n.replaces_item_id=i.id),
            'replaces_period',(select to_char(r.period_start,'YYYY-MM-DD') from public.money_ach_items p join public.money_ach_batches r on r.id=p.batch_id where p.id=i.replaces_item_id),
            'open_retry_request_id',(select q.id from public.money_review_requests q where q.operation='ach_retry' and q.subject=a.id::text
              and now()<private.money_review_expires_at(q.created_at)
              and not exists(select 1 from public.money_review_executions z where z.request_id=q.id)
              order by q.created_at desc limit 1))
            order by i.created_at,i.id)
          from public.money_ach_items i
          cross join lateral (select * from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a
          where i.batch_id=x.id)) item
      from public.money_ach_batches x
      where x.created_at>now()-interval '30 days'
        or exists(select 1 from public.money_ach_items i
          cross join lateral (select t.status from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a
          where i.batch_id=x.id and (a.status not in ('settled','withdrawn')
            or (a.status='withdrawn' and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id))))
      order by x.period_start desc limit 50) b),'[]'::jsonb))
$$;


revoke all on function private.money_ach_live_item(uuid),
  private.money_ach_on_statement(uuid),
  private.money_ach_withdrawn_summary(uuid),
  private.money_ach_item_chain(),
  private.money_ach_withdrawal_command(uuid,text,text,text),
  private.money_ach_withdrawal_blocker(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.money_withdraw_ach(uuid,text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_withdraw_ach(uuid,text,uuid,uuid,text,text) to service_role;
revoke all on function public.money_operator_request_ach_withdrawal(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_operator_request_ach_withdrawal(uuid,text,text,text) to authenticated;
