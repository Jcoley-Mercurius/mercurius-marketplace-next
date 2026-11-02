-- Phase 6.12B / TRACE-135 / DEC-2026-056: a provider's own earnings, payout states and weekly
-- statements.
--
-- Read-only and additive. Requires the money kernel through 20261018005000 (promotional split)
-- and 20260921002000 (statement withdrawals). Writes nothing, changes no payout, hold, transfer,
-- bank-detail or authority rule, and touches no money-fingerprint function: it calls the reviewed
-- classifiers private.money_obligation_reconciliation (funds state, every hold, eligibility time,
-- live statement) and private.money_ach_payable (the payout kernel's own blocker) and words their
-- result for the provider. Nothing is re-derived here.
--
-- vendor_own_earnings(): the caller's provider is resolved from auth.uid(); there is no provider
-- parameter. Jobs are those whose effective payee (after any provider replacement, F612-10) is the
-- caller. Per job: provider-funds state (MPS §5.5), hold categories only (DEC-2026-056 item 3),
-- amounts only once the payment is fully captured (item 4), the date the payout became or becomes
-- eligible but never an expected payout date (item 2), and the live transfer's status (item 5).
-- Statements are one per weekly ACH batch with each job's recorded amounts and latest transfer
-- status (item 6). Bank account, bank evidence, bank references, batch approvers, actors, hold
-- reasons and evidence stay operator-only. The legacy get_vendor_earnings_metrics stays for
-- clients deployed before 6.12B and is no longer read by the portal (item 1).

create or replace function public.vendor_own_earnings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now(); c public.contractors; o public.money_obligations; r public.service_requests;
  rec jsonb; pay jsonb; ne text[]; held text[]; holds text[]; state text; blocker text; captured boolean;
  ret record; amounts jsonb; received bigint; jobs jsonb:='[]'::jsonb; statements jsonb;
begin
 if auth.uid() is null or not public.has_role(auth.uid(),'vendor') then
   raise exception 'Vendor account required' using errcode='42501';
 end if;
 select * into c from public.contractors where user_id=auth.uid();
 if c.id is null then
   return jsonb_build_object('evaluated_at',at_value,'provider_found',false,'payout_onboarding_current',false,
     'jobs','[]'::jsonb,'totals','{}'::jsonb,'statements','[]'::jsonb);
 end if;

 for o in select x.* from public.money_obligations x
   where (x.contractor_id=c.id or exists(select 1 from public.money_replacement_reconciliations m
       where m.obligation_id=x.id and m.replacement_contractor_id=c.id))
     and private.money_effective_contractor(x.id)=c.id
   order by x.created_at desc, x.id
 loop
   select * into r from public.service_requests where id=o.service_request_id;
   begin
     rec:=private.money_obligation_reconciliation(o.id,at_value);
   exception when others then
     rec:=null;
   end;
   pay:=rec->'payout';
   captured:=coalesce((rec->'charges'->>'fully_captured')::boolean,false);
   select coalesce(array_agg(v),'{}') into ne from jsonb_array_elements_text(coalesce(pay->'not_eligible','[]'::jsonb)) v;
   select coalesce(array_agg(v),'{}') into held from jsonb_array_elements_text(coalesce(pay->'held','[]'::jsonb)) v;
   holds:='{}';

   if rec is null then
     state:='unavailable';
   elsif pay->'statement'->>'bank_status' is not null then
     -- On a live statement: the latest transfer attempt decides, never a sum of attempts.
     state:=case pay->'statement'->>'bank_status'
       when 'prepared' then 'in_transfer' when 'submitted' then 'sent' when 'unknown' then 'unknown'
       when 'settled' then 'paid' when 'failed' then 'failed' when 'returned' then 'returned' else 'unavailable' end;
   elsif pay->>'funds_state'='paid' then
     -- The bank paid a withdrawn transfer late.
     state:='paid';
   elsif 'payment_incomplete'=any(ne) then
     state:='waiting_payment';
   elsif cardinality(held)>0 or 'replacement_reconciliation'=any(ne) then
     state:='held';
   elsif 'awaiting_confirmation'=any(ne) then
     state:='awaiting_confirmation';
   elsif 'confirmation_window'=any(ne) then
     state:='confirmation_window';
   elsif 'no_payable'=any(ne) then
     state:='nothing_payable';
   else
     -- The classifier says eligible; the payout kernel has the last word.
     begin
       blocker:=private.money_ach_payable(o.id)->>'blocker';
     exception when others then
       blocker:='unavailable';
     end;
     state:=case when blocker is null then 'eligible' when blocker='already_paid' then 'paid'
       when blocker='no_payable' then 'nothing_payable' when blocker='unavailable' then 'unavailable' else 'held' end;
     if state='held' then holds:=array['mercurius']; end if;
   end if;

   if state='held' and cardinality(holds)=0 then
     -- Categories only (DEC-2026-056 item 3), in a fixed order.
     select coalesce(array_agg(k order by p),'{}') into holds from (values
       ('dispute',1,'dispute'=any(held)),
       ('payment_review',2,held && array['chargeback','reconciliation','provider_event']),
       ('refund',3,'pending_refund'=any(held)),
       ('payout_onboarding',4,'payout_onboarding'=any(held)),
       ('mercurius',5,'payout_hold'=any(held) or 'replacement_reconciliation'=any(ne))) h(k,p,on_hold)
     where on_hold;
   end if;

   amounts:=null; received:=null;
   if captured then
     select * into ret from public.money_retained_parts(o.id);
     amounts:=jsonb_build_object('service',ret.service,'platform_fee',(rec->'earnings'->>'platform_fee')::bigint,
       'platform_subsidy',coalesce((rec->'earnings'->>'platform_subsidy')::bigint,0),'tips',ret.tip,
       'payout',(rec->'earnings'->>'provider_proceeds')::bigint);
     received:=private.money_payout_received(o.id);
   end if;

   jobs:=jobs||jsonb_build_object(
     'job_id',r.id,
     'invoice_number',rec->>'invoice_number',
     'service',coalesce((select sc.name from public.services_catalog sc where sc.id=r.service_catalog_id),r.service_type),
     'completed_at',r.vendor_completed_at,
     'confirmed_at',r.homeowner_confirmed_at,
     'state',state,
     'holds',to_jsonb(holds),
     'eligible_at',case when state in ('eligible','confirmation_window','held') then pay->>'eligible_at' end,
     'amounts',amounts,
     'received',received,
     'transfer',case when pay->'statement' is not null and jsonb_typeof(pay->'statement')='object' then jsonb_build_object(
       'week_start',pay->'statement'->>'period_start',
       'week_end',((pay->'statement'->>'period_start')::date+6)::text,
       'amount',(pay->'statement'->>'amount')::bigint) end);
 end loop;

 select coalesce(jsonb_agg(jsonb_build_object(
     'week_start',to_char(b.period_start,'YYYY-MM-DD'),
     'week_end',to_char(b.period_end-1,'YYYY-MM-DD'),
     'payout_total',x.payout_total,
     'paid_total',x.paid_total,
     'items',x.items) order by b.period_start desc),'[]'::jsonb) into statements
 from public.money_ach_batches b
 cross join lateral (
   select coalesce(sum(i.amount) filter (where a.status<>'withdrawn'),0)::bigint as payout_total,
     coalesce(sum(i.amount) filter (where a.status='settled'),0)::bigint as paid_total,
     jsonb_agg(jsonb_build_object(
       'job_id',sn.obligation_id_request,
       'invoice_number',sn.invoice_number,
       'service',sn.service_name,
       'service_amount',i.service_retained,
       'platform_fee',i.platform_fee,
       'platform_subsidy',i.platform_subsidy,
       'tips',i.tip_retained,
       'payout',i.amount,
       'status',a.status) order by sn.invoice_number, i.id) as items
   from public.money_ach_items i
   join lateral (select t.status from public.money_ach_attempts t where t.item_id=i.id
     order by t.attempt_number desc limit 1) a on true
   join lateral (select s.invoice_number, q.id as obligation_id_request,
       coalesce((select sc.name from public.services_catalog sc where sc.id=q.service_catalog_id),q.service_type) as service_name
     from public.money_snapshots s join public.money_obligations ob on ob.id=i.obligation_id
     join public.service_requests q on q.id=ob.service_request_id where s.id=i.snapshot_id) sn on true
   where i.batch_id=b.id and i.contractor_id=c.id
 ) x
 where exists(select 1 from public.money_ach_items i where i.batch_id=b.id and i.contractor_id=c.id);

 return jsonb_build_object(
  'evaluated_at',at_value,
  'provider_found',true,
  'payout_onboarding_current',private.vendor_payout_eligible(c.id,at_value),
  'jobs',jobs,
  -- Per state: number of jobs and the payout they carry once captured; paid counts what the bank paid.
  'totals',(select coalesce(jsonb_object_agg(t.state,jsonb_build_object('count',t.n,'amount',t.amount)),'{}'::jsonb) from (
    select j->>'state' as state, count(*)::integer as n,
      sum(case when j->>'state'='paid' then (j->>'received')::bigint else (j->'amounts'->>'payout')::bigint end)::bigint as amount
    from jsonb_array_elements(jobs) j group by j->>'state') t),
  'statements',statements);
end $$;
revoke all on function public.vendor_own_earnings() from public, anon;
grant execute on function public.vendor_own_earnings() to authenticated;
