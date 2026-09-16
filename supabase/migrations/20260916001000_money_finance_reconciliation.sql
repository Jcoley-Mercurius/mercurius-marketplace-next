-- TRACE-075: finance reconciliation readback (MPS §§5.5/6.5/7; CFG-004/005/008).
--
-- Reconciles each obligation's charges, refunds, earnings and payouts against the
-- balanced journals, and lists the payment and payout exceptions finance operators must
-- act on. Read-only: no table, command, write grant, provider call or scheduler is added.
-- Every expected value is derived from the existing kernels; nothing here is a new policy:
--  * fee: round(retained service x 15%), which the capture/refund/chargeback journals
--    telescope to (CFG-005), and zero until the full snapshot total is captured;
--  * provider proceeds: retained service - fee + retained tip (CFG-008), less recorded
--    bank settlements plus recorded bank returns;
--  * funds state (MPS §5.5): scheduled/paid/payout_failed come from recorded bank attempts
--    only. Without a statement, the hold predicates mirror money_payable so operators see
--    every reason at once; ACH preparation still re-proves eligibility itself. "reversed"
--    is never reported: no already-paid recovery contract exists yet.
-- Restricted to finance authority (admin role plus money_authorities), as MPS §4 requires.

create function private.money_account_net(p_obligation uuid,p_account text)
returns bigint language sql stable security definer set search_path='' as $$
  select coalesce(sum((l->>'debit')::bigint-(l->>'credit')::bigint),0)::bigint
  from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
  where j.obligation_id=p_obligation and l->>'account'=p_account
$$;
revoke all on function private.money_account_net(uuid,text) from public,anon,authenticated,service_role;

-- Unprocessed provider events that money_payable treats as holds. A reconciliation_required
-- event names no obligation, so it holds every payout (p_obligation null counts only those).
create function private.money_unprocessed_events(p_obligation uuid)
returns bigint language sql stable security definer set search_path='' as $$
  select count(*) from public.money_webhook_events e
  where e.status<>'processed'
    and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
    and (e.event_type='reconciliation_required'
      or (p_obligation is not null and (
        e.payload->>'attempt_id' in(select id::text from public.money_checkout_attempts where obligation_id=p_obligation)
        or e.payload->>'payment_id' in(select stripe_payment_id from public.money_checkout_attempts where obligation_id=p_obligation))))
$$;
revoke all on function private.money_unprocessed_events(uuid) from public,anon,authenticated,service_role;

create function private.money_obligation_reconciliation(p_obligation uuid,p_at timestamptz)
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
  select * into item from public.money_ach_items where obligation_id=o.id;
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
revoke all on function private.money_obligation_reconciliation(uuid,timestamptz) from public,anon,authenticated,service_role;

-- Finance operator readback. Stripe payment/refund/dispute/event IDs are included so an
-- operator can find them at the provider; bank references, approval reasons, evidence text,
-- customer identities and tax evidence are not.
create function public.money_finance_reconciliation()
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
      select 'bank_outcome',a.id::text,a.created_at,jsonb_build_object('kind','bank_outcome','obligation_id',i.obligation_id,'item_id',i.id,
        'attempt_number',a.attempt_number,'amount',i.amount,'status',a.status,'since',a.created_at)
        from public.money_ach_items i join lateral (select * from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a on true
        where a.status in ('unknown','failed','returned')
    ) e),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(l.v order by l.n) from (select v,n from jsonb_array_elements(rows) with ordinality x(v,n) order by n limit listed) l),'[]'::jsonb));
end $$;
revoke all on function public.money_finance_reconciliation() from public,anon,authenticated,service_role;
grant execute on function public.money_finance_reconciliation() to authenticated;
