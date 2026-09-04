-- Owner-delegated chargeback policy: processor/dispute costs belong to Mercurius;
-- unpaid principal is allocated to the retained service/tax/tip components after review.
-- Already scheduled/paid transfers require a separate recorded recovery decision.
create function public.money_retained_parts(p_obligation uuid)
returns table(service bigint,tax bigint,tip bigint) language sql stable security definer set search_path='' as $$
  select s.subtotal-o.refunded_service-coalesce(loss.service,0),s.tax-o.refunded_tax-coalesce(loss.tax,0),s.tip-o.refunded_tip-coalesce(loss.tip,0)
  from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id
  left join lateral (select sum(r.service)::bigint service,sum(r.tax)::bigint tax,sum(r.tip)::bigint tip from public.money_chargeback_resolutions r
    join public.money_disputes d on d.provider_id=r.dispute_id where d.obligation_id=o.id) loss on true where o.id=p_obligation
$$;
create function public.money_resolve_chargeback_loss(p_dispute text,p_service bigint,p_tax bigint,p_tip bigint,p_actor uuid,p_approver uuid,p_reason text)
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
  if exists(select 1 from public.money_ach_items where obligation_id=d.obligation_id) then raise exception 'Scheduled or paid funds require manual recovery review; no automatic clawback'; end if;
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
create or replace function public.money_refund_bank_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.money_ach_items where obligation_id=new.obligation_id) then raise exception 'Bank statement reconciliation required before refund'; end if;
  if exists(select 1 from public.money_disputes where obligation_id=new.obligation_id and status in ('open','lost')) then raise exception 'Chargeback reconciliation required before refund'; end if;
  return new;
end $$;
revoke all on function public.money_retained_parts(uuid),public.money_resolve_chargeback_loss(text,bigint,bigint,bigint,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.money_resolve_chargeback_loss(text,bigint,bigint,bigint,uuid,uuid,text) to service_role;
