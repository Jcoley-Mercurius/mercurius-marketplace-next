-- TRACE-080: already-paid payout recovery (MPS §§5.5/6.5/7; CFG-005/008; DECISION-LOG chargeback
-- policy "scheduled or already-paid funds require a separate recovery review"; TRACE-075–079).
--
-- A provider can end up holding more than the ledger owes them: a customer refund or a lost
-- chargeback after their payout settled, or a transfer withdrawn from its statement (TRACE-079)
-- that the bank later shows as paid. Refunds and chargeback allocation were refused once a payout
-- was on a statement, and a late payment of a withdrawn transfer could not be recorded at all.
-- Owner decisions 2026-09-21:
--  * all three cases are recorded, and each leaves what the provider owes as a debit balance on the
--    payout's provider payable;
--  * a late payment of a withdrawn transfer is a separate reviewed event. The withdrawn attempt is
--    not changed;
--  * an amount owed is closed only by a reviewed repayment the provider sent, or a reviewed
--    write-off Mercurius absorbs. Part amounts are allowed. Two operators each time. There is no
--    automatic bank debit, clawback or netting against other earnings (DECISION-LOG);
--  * an amount owed does not hold the provider's other payouts. Operators can still place a hold.
-- One guard applies to every writer of statements and attempts: a transfer can be prepared,
-- retried or submitted only if what the provider has received and kept, plus the transfer, stays
-- within the payout's proceeds. A payout the bank has paid can therefore never be paid again.

-- Mercurius's loss when it absorbs an amount a provider owes.
create or replace function public.money_check_journal() returns trigger language plpgsql set search_path = '' as $$
declare line jsonb; debit numeric; credit numeric; balance numeric := 0;
begin
  if jsonb_typeof(new.lines) <> 'array' or jsonb_array_length(new.lines) < 2 then raise exception 'Invalid journal'; end if;
  for line in select * from jsonb_array_elements(new.lines) loop
    debit := (line->>'debit')::numeric; credit := (line->>'credit')::numeric;
    if debit is null or credit is null or debit < 0 or credit < 0 or trunc(debit) <> debit or trunc(credit) <> credit
      or (debit > 0) = (credit > 0) or greatest(debit,credit) > 9007199254740991
      or coalesce(line->>'account','') not in ('stripe_clearing','customer_advance','platform_revenue','tax_liability','provider_payable','processor_expense','chargeback_suspense','bank','provider_recovery_loss')
      then raise exception 'Invalid posting'; end if;
    balance := balance + debit - credit;
  end loop;
  if balance <> 0 then raise exception 'Unbalanced journal'; end if;
  return new;
end $$;

-- A payment of a withdrawn transfer that the bank shows after the withdrawal.
create table public.money_ach_late_settlements (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.money_ach_attempts(id),
  item_id uuid not null references public.money_ach_items(id),
  obligation_id uuid not null references public.money_obligations(id),
  amount bigint not null check (amount>0),
  bank_reference text not null unique check (length(trim(bank_reference))>0 and length(bank_reference)<=200),
  reason text not null check (length(trim(reason))>0),
  evidence text not null check (length(trim(evidence))>0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);
create index money_ach_late_settlements_obligation on public.money_ach_late_settlements(obligation_id);

-- A repayment the provider sent, or a loss Mercurius absorbs, against what the provider owes.
create table public.money_payout_recoveries (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  contractor_id uuid not null references public.contractors(id),
  kind text not null check (kind in ('repayment','write_off')),
  amount bigint not null check (amount>0),
  owed_before bigint not null check (owed_before>=amount),
  business_key text not null unique check (length(business_key) between 1 and 200),
  reason text not null check (length(trim(reason))>0),
  evidence text not null check (length(trim(evidence))>0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);
create index money_payout_recoveries_obligation on public.money_payout_recoveries(obligation_id);

do $$ declare t text; begin
  foreach t in array array['money_ach_late_settlements','money_payout_recoveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry','ach_withdrawal',
    'ach_late_settlement','payout_recovery'));
-- The evidence shape is unchanged: neither new operation is in its no-evidence list, so both need evidence.

-- What the provider owes on this payout: the debit balance of its provider payable, or zero.
create function private.money_payout_owed(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select greatest(private.money_account_net(p_obligation,'provider_payable'),0)::bigint
$$;

-- Whether the payout is on a live statement the bank has not paid: prepared, submitted, unknown,
-- failed or returned. A refund or chargeback allocation then waits for the bank outcome or a
-- withdrawal. On a settled statement they post, and any overpayment becomes an amount owed.
create function private.money_ach_unpaid_statement(p_obligation uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select a.status<>'settled' from public.money_ach_attempts a
    where a.item_id=private.money_ach_live_item(p_obligation) order by a.attempt_number desc limit 1),false)
$$;

-- What the provider has received for this payout and kept: settled transfers and late payments of
-- withdrawn ones, less returns and repayments. Read from the bank evidence, not the journals.
create function private.money_payout_received(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select ((select coalesce(sum(i.amount) filter (where e.status='settled'),0)-coalesce(sum(i.amount) filter (where e.status='returned'),0)
      from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id join public.money_ach_events e on e.attempt_id=a.id
      where i.obligation_id=p_obligation)
    +(select coalesce(sum(amount),0) from public.money_ach_late_settlements where obligation_id=p_obligation)
    -(select coalesce(sum(amount),0) from public.money_payout_recoveries where obligation_id=p_obligation and kind='repayment'))::bigint
$$;
-- Whether a transfer of this amount would pay the provider more than the payout's proceeds: the
-- retained service less the 15% fee, plus the retained tip (money_payable's amount).
create function private.money_ach_exceeds_proceeds(p_obligation uuid,p_amount bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select private.money_payout_received(p_obligation)+p_amount>(select r.service-round(r.service::numeric*15/100)+r.tip
    from public.money_retained_parts(p_obligation) r)
$$;

-- Every writer of statement items and attempts, including the unchanged kernels: a transfer is
-- prepared, retried or submitted only while it would not pay the provider more than the proceeds.
create function private.money_ach_proceeds_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare payout uuid; amount bigint;
begin
  if tg_table_name='money_ach_items' then
    payout:=new.obligation_id; amount:=new.amount;
  else
    if tg_op='UPDATE' then
      if not (old.status='prepared' and new.status='submitted') then return new; end if;
    end if;
    select i.obligation_id,i.amount into strict payout,amount from public.money_ach_items i where i.id=new.item_id;
  end if;
  if private.money_ach_exceeds_proceeds(payout,amount) then
    raise exception 'Transfer would pay the provider more than this payout''s proceeds; it may already be paid';
  end if;
  return new;
end $$;
create trigger money_ach_item_proceeds_guard before insert on public.money_ach_items
  for each row execute function private.money_ach_proceeds_guard();
create trigger money_ach_attempt_proceeds_guard before insert or update of status on public.money_ach_attempts
  for each row execute function private.money_ach_proceeds_guard();

-- The exact objects the two new kernels hash.
create function private.money_ach_late_settlement_command(p_attempt uuid,p_bank_ref text,p_reason text,p_evidence text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','ach_late_settlement','attempt',p_attempt,'bank_ref',p_bank_ref,'reason',p_reason,'evidence',p_evidence)
$$;
-- A recovery names the amount owed when it was requested, so an approval cannot apply after the
-- amount owed changed, and its key, so a reused approval replays instead of recording twice.
create function private.money_payout_recovery_command(p_obligation uuid,p_kind text,p_amount bigint,p_owed bigint,p_reason text,p_evidence text,p_key text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','payout_recovery','obligation',p_obligation,'kind',p_kind,'amount',p_amount,'owed',p_owed,
    'reason',p_reason,'evidence',p_evidence,'key',p_key)
$$;

-- Why this late payment cannot be recorded now. Mirrors money_record_ach_late_settlement.
create function private.money_ach_late_settlement_blocker(p_attempt uuid,p_bank_ref text)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_ach_attempts;
begin
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_ach_late_settlements where attempt_id=a.id) then return 'completed'; end if;
  if a.status<>'withdrawn' then return 'not_withdrawn'; end if;
  if p_bank_ref is null or length(trim(p_bank_ref))=0 then return 'bank_reference_required'; end if;
  if a.bank_reference is not null and a.bank_reference<>p_bank_ref then return 'bank_reference_conflict'; end if;
  if exists(select 1 from public.money_ach_attempts x where x.bank_reference=p_bank_ref and x.id<>a.id)
    or exists(select 1 from public.money_ach_late_settlements s where s.bank_reference=p_bank_ref) then
    return 'bank_reference_used';
  end if;
  return null;
end $$;

-- Why this recovery cannot be recorded now. Mirrors money_record_payout_recovery.
create function private.money_payout_recovery_blocker(p_obligation uuid,p_kind text,p_amount bigint,p_owed bigint,p_key text)
returns text language plpgsql stable security definer set search_path='' as $$
declare owed bigint;
begin
  if not exists(select 1 from public.money_obligations where id=p_obligation) then return 'not_found'; end if;
  if exists(select 1 from public.money_payout_recoveries where business_key=p_key) then return 'completed'; end if;
  if p_kind is null or p_kind not in ('repayment','write_off') or p_amount is null or p_amount<=0 then return 'recovery_invalid'; end if;
  owed:=private.money_payout_owed(p_obligation);
  if owed=0 then return 'nothing_owed'; end if;
  if owed is distinct from p_owed then return 'owed_changed'; end if;
  if p_amount>owed then return 'exceeds_owed'; end if;
  return null;
end $$;

-- Kernel: the bank shows a withdrawn transfer as paid. Two finance operators, bound to the exact
-- command. Records the payment and posts it; the withdrawn attempt is not changed. If a replacement
-- also settled, the provider now owes the duplicate; if none was prepared, the payout is paid and
-- the proceeds guard stops any replacement.
create function public.money_record_ach_late_settlement(p_attempt uuid,p_bank_ref text,p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.money_ach_items; a public.money_ach_attempts; s public.money_ach_late_settlements;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_ach_late_settlement_command(p_attempt,p_bank_ref,p_reason,p_evidence));
  select item.* into strict i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id where attempt.id=p_attempt;
  -- The other ACH kernels' order: lifecycle, provider onboarding, obligation, attempt.
  perform private.money_lock_lifecycle(array[i.obligation_id]);
  perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
  perform 1 from public.money_obligations where id=i.obligation_id for update;
  select * into strict a from public.money_ach_attempts where id=p_attempt for update;
  select * into s from public.money_ach_late_settlements where attempt_id=a.id;
  if found then
    if s.bank_reference<>p_bank_ref or s.requested_by<>p_actor or s.approved_by<>p_approver or s.reason<>p_reason or s.evidence<>p_evidence then
      raise exception 'ACH late settlement idempotency conflict';
    end if;
    return s.id;
  end if;
  if a.status<>'withdrawn' then raise exception 'Only a withdrawn transfer takes a late settlement; record other outcomes on the transfer'; end if;
  if p_bank_ref is null or length(trim(p_bank_ref))=0 then raise exception 'Bank reference required'; end if;
  if a.bank_reference is not null and a.bank_reference<>p_bank_ref then raise exception 'Bank reference conflict'; end if;
  if exists(select 1 from public.money_ach_attempts x where x.bank_reference=p_bank_ref and x.id<>a.id)
    or exists(select 1 from public.money_ach_late_settlements x where x.bank_reference=p_bank_ref) then
    raise exception 'Bank reference already recorded';
  end if;
  insert into public.money_ach_late_settlements(attempt_id,item_id,obligation_id,amount,bank_reference,reason,evidence,requested_by,approved_by)
    values(a.id,i.id,i.obligation_id,i.amount,p_bank_ref,p_reason,p_evidence,p_actor,p_approver) returning * into s;
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(i.obligation_id,'ach-late-settlement:'||a.id,'ach_late_settlement',
    jsonb_build_array(jsonb_build_object('account','provider_payable','debit',i.amount,'credit',0),
      jsonb_build_object('account','bank','debit',0,'credit',i.amount)),p_evidence);
  return s.id;
end $$;

-- Kernel: a repayment the provider sent, or a loss Mercurius absorbs, against what the provider
-- owes on this payout. Two finance operators, bound to the exact command and the amount owed.
create function public.money_record_payout_recovery(p_obligation uuid,p_kind text,p_amount bigint,p_owed bigint,p_key text,
  p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.money_payout_recoveries; owed bigint;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_payout_recovery_command(p_obligation,p_kind,p_amount,p_owed,p_reason,p_evidence,p_key));
  -- Lifecycle, then obligation: the order refunds, chargebacks and ACH take.
  perform private.money_lock_lifecycle(array[p_obligation]);
  perform 1 from public.money_obligations where id=p_obligation for update;
  if not found then raise exception 'Finance obligation not found'; end if;
  select * into r from public.money_payout_recoveries where business_key=p_key;
  if found then
    if r.obligation_id<>p_obligation or r.kind<>p_kind or r.amount<>p_amount or r.owed_before<>p_owed or r.requested_by<>p_actor
      or r.approved_by<>p_approver or r.reason<>p_reason or r.evidence<>p_evidence then
      raise exception 'Payout recovery idempotency conflict';
    end if;
    return r.id;
  end if;
  if p_kind is null or p_kind not in ('repayment','write_off') then raise exception 'Recovery must be a repayment or a write-off'; end if;
  owed:=private.money_payout_owed(p_obligation);
  if owed is distinct from p_owed then raise exception 'Amount owed changed since the recovery was requested'; end if;
  if p_amount is null or p_amount<=0 or p_amount>owed then raise exception 'Recovery must be more than zero and at most the amount owed'; end if;
  insert into public.money_payout_recoveries(obligation_id,contractor_id,kind,amount,owed_before,business_key,reason,evidence,requested_by,approved_by)
    values(p_obligation,private.money_effective_contractor(p_obligation),p_kind,p_amount,owed,p_key,p_reason,p_evidence,p_actor,p_approver)
    returning * into r;
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(p_obligation,'payout-recovery:'||r.id,'payout_'||p_kind,
    jsonb_build_array(jsonb_build_object('account',case when p_kind='repayment' then 'bank' else 'provider_recovery_loss' end,'debit',p_amount,'credit',0),
      jsonb_build_object('account','provider_payable','debit',0,'credit',p_amount)),p_evidence);
  return r.id;
end $$;

-- Gateway: a late payment of a withdrawn transfer is a reviewed request. The evidence says what
-- the bank shows; the reference is the one the bank paid it under.
create function public.money_operator_request_ach_late_settlement(p_attempt uuid,p_bank_ref text,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); i public.money_ach_items; a public.money_ach_attempts; reason text; evidence text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  if p_bank_ref is null or length(trim(p_bank_ref))=0 or length(p_bank_ref)>200 then
    raise exception 'Bank reference of up to 200 characters required' using errcode='22023';
  end if;
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then raise exception 'Bank attempt not found' using errcode='P0002'; end if;
  select * into strict i from public.money_ach_items where id=a.item_id;
  reason:=btrim(p_reason); evidence:=btrim(p_evidence);
  return private.money_store_review_request(actor,p_key,'ach_late_settlement',a.id::text,i.obligation_id,
    private.money_ach_late_settlement_command(a.id,btrim(p_bank_ref),reason,evidence),reason,evidence,true,null::jsonb);
end $$;

-- Gateway: a repayment or write-off is a reviewed request bound to the amount owed now. A replay of
-- the same key keeps the amount owed it was requested against.
create function public.money_operator_request_payout_recovery(p_obligation uuid,p_kind text,p_amount bigint,p_reason text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reason text; evidence text; owed bigint;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  perform private.money_require_text(p_evidence,'Evidence');
  if p_kind is null or p_kind not in ('repayment','write_off') then
    raise exception 'Recovery must be a repayment or a write-off' using errcode='22023';
  end if;
  if p_amount is null or p_amount<=0 then raise exception 'Recovery amount in cents required' using errcode='22023'; end if;
  if not exists(select 1 from public.money_obligations where id=p_obligation) then
    raise exception 'Finance obligation not found' using errcode='P0002';
  end if;
  reason:=btrim(p_reason); evidence:=btrim(p_evidence);
  select (q.command->>'owed')::bigint into owed from public.money_review_requests q where q.business_key=p_key and q.operation='payout_recovery';
  if owed is null then owed:=private.money_payout_owed(p_obligation); end if;
  return private.money_store_review_request(actor,p_key,'payout_recovery',p_obligation::text,p_obligation,
    private.money_payout_recovery_command(p_obligation,p_kind,p_amount,owed,reason,evidence,p_key),reason,evidence,true,null::jsonb);
end $$;

-- What a recovery request asks for, so the approver sees the exact transfer or amount.
create function private.money_recovery_request_details(p_request public.money_review_requests)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_request.operation='ach_late_settlement' then (select jsonb_build_object(
      'item_id',i.id,'attempt_number',a.attempt_number,'amount',i.amount,
      'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id),
      'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=i.snapshot_id),
      'period_start',to_char(b.period_start,'YYYY-MM-DD'),'previous_status',w.previous_status,'withdrawn_at',w.created_at,
      'bank_reference_hint',right(p_request.command->>'bank_ref',4),
      'replacement',(select jsonb_build_object('period_start',to_char(rb.period_start,'YYYY-MM-DD'),'amount',n.amount,
          'status',(select t.status from public.money_ach_attempts t where t.item_id=n.id order by t.attempt_number desc limit 1))
        from public.money_ach_items n join public.money_ach_batches rb on rb.id=n.batch_id
        where n.id=private.money_ach_live_item(i.obligation_id)))
      from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id join public.money_ach_batches b on b.id=i.batch_id
      left join public.money_ach_withdrawals w on w.attempt_id=a.id
      where a.id=p_request.subject::uuid)
    when p_request.operation='payout_recovery' then jsonb_build_object(
      'kind',p_request.command->>'kind','amount',(p_request.command->>'amount')::bigint,'owed',(p_request.command->>'owed')::bigint,
      'owed_now',private.money_payout_owed(p_request.obligation_id),
      'payee_name',(select c.name from public.contractors c where c.id=private.money_effective_contractor(p_request.obligation_id))) end
$$;

-- The recovery part of the operator readback: what providers owe, payouts with recent recoveries,
-- and withdrawn transfers a late payment could still be recorded against.
create function private.money_recovery_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with payable as (
    select j.obligation_id,sum((l->>'debit')::bigint-(l->>'credit')::bigint)::bigint net
    from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where l->>'account'='provider_payable' group by 1)
  select jsonb_build_object(
    'owed_total',(select coalesce(sum(net),0) from payable where net>0),
    'owed',coalesce((select jsonb_agg(r.item order by r.owed desc,r.id) from (
      select o.id,greatest(coalesce(p.net,0),0) owed,jsonb_build_object(
        'obligation_id',o.id,
        'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=o.current_snapshot_id),
        'payee_id',private.money_effective_contractor(o.id),
        'payee_name',(select c.name from public.contractors c where c.id=private.money_effective_contractor(o.id)),
        'owed',greatest(coalesce(p.net,0),0),
        'paid',(select coalesce(sum(i.amount),0) from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id
          join public.money_ach_events e on e.attempt_id=a.id where i.obligation_id=o.id and e.status='settled')
          +(select coalesce(sum(amount),0) from public.money_ach_late_settlements where obligation_id=o.id),
        'returned',(select coalesce(sum(i.amount),0) from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id
          join public.money_ach_events e on e.attempt_id=a.id where i.obligation_id=o.id and e.status='returned'),
        'late_settled',(select coalesce(sum(amount),0) from public.money_ach_late_settlements where obligation_id=o.id),
        'repaid',(select coalesce(sum(amount),0) from public.money_payout_recoveries where obligation_id=o.id and kind='repayment'),
        'written_off',(select coalesce(sum(amount),0) from public.money_payout_recoveries where obligation_id=o.id and kind='write_off'),
        'refunded',o.refunded_service+o.refunded_tax+o.refunded_tip,
        'chargebacks_lost',(select coalesce(sum(r.service+r.tax+r.tip),0) from public.money_chargeback_resolutions r
          join public.money_disputes d on d.provider_id=r.dispute_id where d.obligation_id=o.id),
        'recoveries',coalesce((select jsonb_agg(jsonb_build_object('kind',r.kind,'amount',r.amount,'owed_before',r.owed_before,
            'reason',r.reason,'evidence',r.evidence,'by_me',p_me in (r.requested_by,r.approved_by),'created_at',r.created_at) order by r.created_at,r.id)
          from public.money_payout_recoveries r where r.obligation_id=o.id),'[]'::jsonb),
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='payout_recovery' and q.obligation_id=o.id
          and now()<private.money_review_expires_at(q.created_at)
          and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1)) item
      from public.money_obligations o left join payable p on p.obligation_id=o.id
      where coalesce(p.net,0)>0
        or exists(select 1 from public.money_payout_recoveries r where r.obligation_id=o.id and r.created_at>now()-interval '30 days')
        or exists(select 1 from public.money_ach_late_settlements s where s.obligation_id=o.id and s.created_at>now()-interval '30 days')
      order by 2 desc,o.id limit 200) r),'[]'::jsonb),
    'withdrawn',coalesce((select jsonb_agg(t.item order by t.created_at desc,t.id) from (
      select w.created_at,a.id,jsonb_build_object(
        'attempt_id',a.id,'item_id',i.id,'obligation_id',i.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=i.snapshot_id),
        'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id),
        'amount',i.amount,'attempt_number',a.attempt_number,'previous_status',w.previous_status,
        'period_start',(select to_char(b.period_start,'YYYY-MM-DD') from public.money_ach_batches b where b.id=i.batch_id),
        'bank_reference_hint',right(a.bank_reference,4),'withdrawn_at',w.created_at,
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='ach_late_settlement' and q.subject=a.id::text
          and now()<private.money_review_expires_at(q.created_at)
          and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1)) item
      from public.money_ach_withdrawals w join public.money_ach_attempts a on a.id=w.attempt_id join public.money_ach_items i on i.id=w.item_id
      where not exists(select 1 from public.money_ach_late_settlements s where s.attempt_id=a.id)
      order by w.created_at desc,a.id limit 200) t),'[]'::jsonb),
    'late_settlements',coalesce((select jsonb_agg(jsonb_build_object(
        'attempt_id',s.attempt_id,'obligation_id',s.obligation_id,
        'invoice_number',(select x.invoice_number from public.money_snapshots x join public.money_ach_items i on i.snapshot_id=x.id where i.id=s.item_id),
        'amount',s.amount,'bank_reference_hint',right(s.bank_reference,4),'reason',s.reason,'evidence',s.evidence,
        'by_me',p_me in (s.requested_by,s.approved_by),'created_at',s.created_at) order by s.created_at desc,s.id)
      from public.money_ach_late_settlements s where s.created_at>now()-interval '30 days'),'[]'::jsonb))
$$;

-- Refunds and chargeback allocation wait only for a statement the bank has not paid. Each body
-- below is the latest definition, copied unchanged except for the statement test.


-- public.money_refund_bank_guard: latest body from 20260921002000_money_ach_replacement.sql; only the statement test changes.
create or replace function public.money_refund_bank_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if private.money_ach_unpaid_statement(new.obligation_id) then raise exception 'Bank statement reconciliation required before refund'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=new.obligation_id and status in ('open','lost')) then raise exception 'Chargeback reconciliation required before refund'; end if;
  return new;
end $$;


-- public.money_resolve_chargeback_loss: latest body from 20260921002000_money_ach_replacement.sql; only the statement test and its message change.
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


-- private.money_refund_blocker: latest body from 20260921002000_money_ach_replacement.sql; only the statement test changes.
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
  if private.money_ach_unpaid_statement(o.id) then return 'on_ach_statement'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=o.id and status in ('open','lost')) then return 'chargeback_open'; end if;
  return null;
end $$;


-- private.money_chargeback_state_blocker: latest body from 20260921002000_money_ach_replacement.sql; only the statement test changes.
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
    and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then return 'refund_pending'; end if;
  return null;
end $$;



-- ACH readbacks mirror the proceeds guard, and the review gateway learns the two new requests.


-- private.money_ach_payable: latest body from 20260921001000_money_finance_ach.sql; adds the proceeds check the triggers enforce.
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
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)) then
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


-- private.money_request_blocker: latest body from 20260921002000_money_ach_replacement.sql; adds ach_late_settlement and payout_recovery.
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
  elsif p_operation='payout_recovery' then
    return private.money_payout_recovery_blocker(p_subject::uuid,p_command->>'kind',(p_command->>'amount')::bigint,
      (p_command->>'owed')::bigint,p_command->>'key');
  end if;
  return private.money_command_blocker(p_operation,p_subject,p_command);
end $$;


-- public.money_operator_execute_review: latest body from 20260921002000_money_ach_replacement.sql; adds ach_late_settlement with the withdrawal's lock order and payout_recovery with lifecycle then obligation.
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
  elsif q.operation='payout_recovery' then
    perform public.money_record_payout_recovery(q.obligation_id,q.command->>'kind',(q.command->>'amount')::bigint,
      (q.command->>'owed')::bigint,q.command->>'key',actor,approver,q.reason,q.evidence);
  else
    raise exception 'Unsupported finance review' using errcode='22023';
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;


-- public.money_finance_operations: latest body from 20260921002000_money_ach_replacement.sql; recovery requests read back their details, and the readback gains recoveries.
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
          when q.operation in ('ach_late_settlement','payout_recovery') then private.money_recovery_request_details(q) end,
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
    'ach',private.money_ach_operations(me),
    'recoveries',private.money_recovery_operations(me));
end $$;


-- private.money_ach_operations: latest body from 20260921002000_money_ach_replacement.sql; withdrawn transfers show a late payment, and a batch whose withdrawn transfer was paid late is finished.
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
            'late_settlement',(select jsonb_build_object('bank_reference_hint',right(s.bank_reference,4),'by_me',p_me in (s.requested_by,s.approved_by),'created_at',s.created_at)
              from public.money_ach_late_settlements s where s.attempt_id=a.id),
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
          cross join lateral (select t.id,t.status from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a
          where i.batch_id=x.id and (a.status not in ('settled','withdrawn')
            or (a.status='withdrawn' and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id)
              and not exists(select 1 from public.money_ach_late_settlements s where s.attempt_id=a.id))))
      order by x.period_start desc limit 50) b),'[]'::jsonb))
$$;



-- Reconciliation counts late payments as paid, checks repayments and write-offs against the
-- ledger, reads what each provider owes and lists it as an exception.


-- private.money_obligation_reconciliation: latest body from 20260921002000_money_ach_replacement.sql; late payments, recoveries, the amount owed and settled statements.
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
      'settled',refunds_settled,'pending',pending_refunds),
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


-- public.money_finance_reconciliation: latest body from 20260916001000_money_finance_reconciliation.sql; adds what providers owe to the totals and the exceptions.
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
    ) e),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(l.v order by l.n) from (select v,n from jsonb_array_elements(rows) with ordinality x(v,n) order by n limit listed) l),'[]'::jsonb));
end $$;


revoke all on function private.money_payout_owed(uuid),
  private.money_payout_received(uuid),
  private.money_ach_exceeds_proceeds(uuid,bigint),
  private.money_ach_unpaid_statement(uuid),
  private.money_ach_proceeds_guard(),
  private.money_ach_late_settlement_command(uuid,text,text,text),
  private.money_payout_recovery_command(uuid,text,bigint,bigint,text,text,text),
  private.money_ach_late_settlement_blocker(uuid,text),
  private.money_payout_recovery_blocker(uuid,text,bigint,bigint,text),
  private.money_recovery_request_details(public.money_review_requests),
  private.money_recovery_operations(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.money_record_ach_late_settlement(uuid,text,uuid,uuid,text,text),
  public.money_record_payout_recovery(uuid,text,bigint,bigint,text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_record_ach_late_settlement(uuid,text,uuid,uuid,text,text),
  public.money_record_payout_recovery(uuid,text,bigint,bigint,text,uuid,uuid,text,text) to service_role;
revoke all on function public.money_operator_request_ach_late_settlement(uuid,text,text,text,text),
  public.money_operator_request_payout_recovery(uuid,text,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_operator_request_ach_late_settlement(uuid,text,text,text,text),
  public.money_operator_request_payout_recovery(uuid,text,bigint,text,text,text) to authenticated;
