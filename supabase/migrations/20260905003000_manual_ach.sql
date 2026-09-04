-- Owner-operated weekly direct ACH. Records evidence; never initiates a bank transfer.
create table public.money_completion_evidence (
  obligation_id uuid primary key references public.money_obligations(id),
  homeowner_id uuid not null references auth.users(id),
  confirmed_at timestamptz not null,
  source_ref text not null unique check(length(trim(source_ref))>0),
  created_at timestamptz not null default now()
);
create table public.money_holds (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  business_key text not null unique,
  reason text not null check(length(trim(reason))>0),
  actor uuid not null references auth.users(id),
  evidence text not null check(length(trim(evidence))>0),
  created_at timestamptz not null default now()
);
create table public.money_hold_resolutions (
  hold_id uuid primary key references public.money_holds(id),
  actor uuid not null references auth.users(id),
  reason text not null check(length(trim(reason))>0),
  evidence text not null check(length(trim(evidence))>0),
  created_at timestamptz not null default now()
);
create table public.money_ach_batches (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  period_end date not null,
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  bank_authorization_ref text not null check(length(trim(bank_authorization_ref))>0),
  reason text not null check(length(trim(reason))>0),
  created_at timestamptz not null default now(),
  check(period_end=period_start+7), check(created_by<>approved_by)
);
alter table public.money_ach_batches add constraint money_weekly_periods_do_not_overlap
  exclude using gist (daterange(period_start,period_end,'[)') with &&);
create table public.money_ach_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.money_ach_batches(id),
  obligation_id uuid not null unique references public.money_obligations(id),
  contractor_id uuid not null references public.contractors(id),
  snapshot_id uuid not null references public.money_snapshots(id),
  service_retained bigint not null,
  tip_retained bigint not null,
  platform_fee bigint not null,
  amount bigint not null check(amount>0),
  confirmation_ref text not null,
  bank_evidence_id uuid not null references public.vendor_compliance_evidence(id),
  created_at timestamptz not null default now(),
  check(amount=service_retained-platform_fee+tip_retained)
);
create table public.money_ach_attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.money_ach_items(id),
  attempt_number integer not null check(attempt_number>0),
  status text not null default 'prepared' check(status in ('prepared','submitted','unknown','settled','failed','returned')),
  bank_reference text unique,
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(item_id,attempt_number),check(created_by<>approved_by)
);
create unique index money_one_unresolved_ach on public.money_ach_attempts(item_id) where status in ('prepared','submitted','unknown','settled');
create table public.money_ach_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.money_ach_attempts(id),
  previous_status text not null,
  status text not null,
  actor uuid not null references auth.users(id),
  evidence text not null check(length(trim(evidence))>0),
  business_key text not null unique,
  created_at timestamptz not null default now()
);

-- Service-only integration port, deliberately not attached to legacy completed/released triggers.
create function public.money_record_completion(p_obligation uuid,p_homeowner uuid,p_confirmed timestamptz,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.money_obligations;
begin
  select * into strict o from public.money_obligations where id=p_obligation for update;
  if p_homeowner is distinct from o.customer_id or p_confirmed is null or p_confirmed>now() then raise exception 'Homeowner confirmation evidence required'; end if;
  insert into public.money_completion_evidence(obligation_id,homeowner_id,confirmed_at,source_ref) values(o.id,p_homeowner,p_confirmed,p_source) on conflict do nothing;
  if not exists(select 1 from public.money_completion_evidence where obligation_id=o.id and homeowner_id=p_homeowner and confirmed_at=p_confirmed and source_ref=p_source) then raise exception 'Confirmation conflict'; end if;
end $$;
create function public.money_place_hold(p_obligation uuid,p_key text,p_actor uuid,p_reason text,p_evidence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare h public.money_holds;
begin
  perform public.money_require_finance(p_actor);
  perform 1 from public.money_obligations where id=p_obligation for update;
  insert into public.money_holds(obligation_id,business_key,actor,reason,evidence) values(p_obligation,p_key,p_actor,p_reason,p_evidence) on conflict do nothing;
  select * into strict h from public.money_holds where business_key=p_key;
  if h.obligation_id<>p_obligation or h.actor<>p_actor or h.reason<>p_reason or h.evidence<>p_evidence then raise exception 'Hold idempotency conflict'; end if;
  return h.id;
end $$;
create function public.money_resolve_hold(p_hold uuid,p_actor uuid,p_reason text,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare obligation uuid;
begin
  perform public.money_require_finance(p_actor);
  select obligation_id into strict obligation from public.money_holds where id=p_hold;
  perform 1 from public.money_obligations where id=obligation for update;
  insert into public.money_hold_resolutions(hold_id,actor,reason,evidence) values(p_hold,p_actor,p_reason,p_evidence);
end $$;

create function public.money_payable(p_obligation uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; s public.money_snapshots; amount bigint; retained record;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
  if o.captured<>s.total or o.dispute_open or o.reconciliation_open then raise exception 'Payment or dispute hold'; end if;
  if exists(select 1 from public.money_webhook_events e where e.status<>'processed'
    and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
    and (e.event_type='reconciliation_required' or e.payload->>'attempt_id' in(select id::text from public.money_checkout_attempts where obligation_id=o.id)
      or e.payload->>'payment_id' in(select stripe_payment_id from public.money_checkout_attempts where obligation_id=o.id))) then raise exception 'Unreconciled provider event hold'; end if;
  if not exists(select 1 from public.money_completion_evidence where obligation_id=o.id and homeowner_id=o.customer_id and confirmed_at+interval '48 hours'<=now()) then raise exception '48 hours after homeowner confirmation required'; end if;
  if exists(select 1 from public.money_holds h where obligation_id=o.id and not exists(select 1 from public.money_hold_resolutions r where r.hold_id=h.id)) then raise exception 'Unresolved payout hold'; end if;
  if exists(select 1 from public.money_refund_authorizations r where obligation_id=o.id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then raise exception 'Pending refund hold'; end if;
  if not public.vendor_is_eligible(o.contractor_id) then raise exception 'Vendor onboarding hold'; end if;
  select * into strict retained from public.money_retained_parts(o.id);
  amount:=retained.service-round(retained.service::numeric*15/100)+retained.tip;
  if amount<=0 then raise exception 'No provider payable'; end if;
  return amount;
end $$;

create function public.money_prepare_ach(p_period date,p_obligations uuid[],p_actor uuid,p_approver uuid,p_bank_ref text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; obligation uuid; o public.money_obligations; s public.money_snapshots; item uuid; bank_evidence uuid; amount bigint; retained record;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','ach','period',p_period,'obligations',p_obligations,'bank_ref',p_bank_ref,'reason',p_reason));
  if cardinality(p_obligations) is null or cardinality(p_obligations) not between 1 and 500 then raise exception 'Bounded batch required'; end if;
  -- Consistent vendor then obligation lock order, also used by submission/retry.
  perform 1 from public.vendor_onboarding where contractor_id in(select contractor_id from public.money_obligations where id=any(p_obligations)) order by contractor_id for share;
  perform 1 from public.money_obligations where id=any(p_obligations) order by id for update;
  insert into public.money_ach_batches(period_start,period_end,created_by,approved_by,bank_authorization_ref,reason)
    values(p_period,p_period+7,p_actor,p_approver,p_bank_ref,p_reason) returning id into batch;
  for obligation in select distinct unnest(p_obligations) order by 1 loop
    select * into strict o from public.money_obligations where id=obligation;
    select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
    amount:=public.money_payable(o.id);
    select * into strict retained from public.money_retained_parts(o.id);
    select e.id into strict bank_evidence from public.vendor_compliance_evidence e where contractor_id=o.contractor_id and kind='bank_authorization'
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
    insert into public.money_ach_items(batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,amount,confirmation_ref,bank_evidence_id)
      values(batch,o.id,o.contractor_id,s.id,retained.service,retained.tip,round(retained.service::numeric*15/100),amount,
        (select source_ref from public.money_completion_evidence where obligation_id=o.id),bank_evidence) returning id into item;
    insert into public.money_ach_attempts(item_id,attempt_number,created_by,approved_by) values(item,1,p_actor,p_approver);
  end loop;
  return batch;
end $$;

create function public.money_record_ach(p_attempt uuid,p_status text,p_bank_ref text,p_actor uuid,p_evidence text,p_key text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.money_ach_attempts; i public.money_ach_items; prior public.money_ach_events;
begin
  perform public.money_require_finance(p_actor);
  select item.* into strict i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id where attempt.id=p_attempt;
  perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
  perform 1 from public.money_obligations where id=i.obligation_id for update;
  select * into strict a from public.money_ach_attempts where id=p_attempt for update;
  select * into prior from public.money_ach_events where business_key=p_key;
  if found then
    if prior.attempt_id<>p_attempt or prior.status<>p_status or prior.actor<>p_actor or prior.evidence<>p_evidence or a.bank_reference is distinct from p_bank_ref then raise exception 'Bank event idempotency conflict'; end if;
    return;
  end if;
  if not ((a.status='prepared' and p_status='submitted') or (a.status in ('submitted','unknown') and p_status in ('unknown','settled','failed')) or (a.status='settled' and p_status='returned')) then raise exception 'Invalid bank transition'; end if;
  if p_bank_ref is null or length(trim(p_bank_ref))=0 then raise exception 'Bank reference required'; end if;
  if a.bank_reference is not null and a.bank_reference<>p_bank_ref then raise exception 'Bank reference conflict'; end if;
  if p_status='submitted' then
    if public.money_payable(i.obligation_id)<>i.amount then raise exception 'Statement amount stale'; end if;
    if exists(select 1 from public.vendor_compliance_evidence where supersedes=i.bank_evidence_id) then raise exception 'Bank authorization changed; reconcile batch'; end if;
  end if;
  insert into public.money_ach_events(attempt_id,previous_status,status,actor,evidence,business_key) values(a.id,a.status,p_status,p_actor,p_evidence,p_key);
  update public.money_ach_attempts set status=p_status,bank_reference=p_bank_ref where id=a.id;
  if p_status in ('settled','returned') then
    insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(i.obligation_id,'ach:'||a.id||':'||p_status,'ach_'||p_status,
      jsonb_build_array(jsonb_build_object('account','provider_payable','debit',case when p_status='settled' then i.amount else 0 end,'credit',case when p_status='returned' then i.amount else 0 end),
      jsonb_build_object('account','bank','debit',case when p_status='returned' then i.amount else 0 end,'credit',case when p_status='settled' then i.amount else 0 end)),p_evidence);
  end if;
end $$;
create function public.money_retry_ach(p_item uuid,p_actor uuid,p_approver uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.money_ach_items; a public.money_ach_attempts; result uuid;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','ach_retry','item',p_item));
  select * into strict i from public.money_ach_items where id=p_item;
  perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
  perform 1 from public.money_obligations where id=i.obligation_id for update;
  select * into strict a from public.money_ach_attempts where item_id=i.id order by attempt_number desc limit 1 for update;
  if a.status not in ('failed','returned') then raise exception 'Bank outcome unresolved or already paid; do not resend'; end if;
  if not exists(select 1 from public.money_ach_events where attempt_id=a.id and status=a.status) then raise exception 'Bank failure evidence required'; end if;
  if public.money_payable(i.obligation_id)<>i.amount then raise exception 'Statement reconciliation required'; end if;
  insert into public.money_ach_attempts(item_id,attempt_number,created_by,approved_by) values(i.id,a.attempt_number+1,p_actor,p_approver) returning id into result;
  return result;
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['money_completion_evidence','money_holds','money_hold_resolutions','money_ach_batches','money_ach_items','money_ach_attempts','money_ach_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    if t<>'money_ach_attempts' then execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t); end if;
  end loop;
  for f in select oid::regprocedure signature from pg_proc where proname in ('money_record_completion','money_place_hold','money_resolve_hold','money_payable','money_prepare_ach','money_record_ach','money_retry_ach') and pronamespace='public'::regnamespace loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.signature::text not like '%money_payable(%' then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;
