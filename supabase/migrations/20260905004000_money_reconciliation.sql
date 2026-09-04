create table public.money_event_replays (
  id uuid primary key default gen_random_uuid(), event_id text not null references public.money_webhook_events(event_id),
  actor uuid not null references auth.users(id), reason text not null check(length(trim(reason))>0), created_at timestamptz not null default now()
);
create table public.money_disputes (
  provider_id text primary key, obligation_id uuid not null references public.money_obligations(id), payment_id text not null,
  amount bigint not null check(amount>0), status text not null check(status in ('open','won','lost')),
  created_at timestamptz not null default now()
);
create table public.money_dispute_events (
  event_id text primary key references public.money_webhook_events(event_id), dispute_id text not null references public.money_disputes(provider_id),
  state text not null, created_at timestamptz not null default now()
);
create table public.money_chargeback_resolutions (
  dispute_id text primary key references public.money_disputes(provider_id),
  service bigint not null check(service>=0), tax bigint not null check(tax>=0), tip bigint not null check(tip>=0),
  actor uuid not null references auth.users(id), approver uuid not null references auth.users(id),
  reason text not null check(length(trim(reason))>0), created_at timestamptz not null default now(), check(actor<>approver)
);

-- The closed dispute can arrive before its opened event. One suspense movement is
-- recorded per dispute, and a late opened event never restores a resolved hold.
alter function public.money_process_event(text) rename to money_process_payment_event;
revoke all on function public.money_process_payment_event(text) from service_role;
create function public.money_process_event(p_event text) returns text language plpgsql security definer set search_path='' as $$
declare e public.money_webhook_events; a public.money_checkout_attempts; o public.money_obligations; d public.money_disputes; state text; code text;
begin
  select * into strict e from public.money_webhook_events where event_id=p_event for update;
  if exists(select 1 from public.money_event_exclusions where event_id=p_event) then return 'reviewed_no_effect'; end if;
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
create or replace function public.money_replay_event(p_event text,p_actor uuid,p_reason text) returns text language plpgsql security definer set search_path='' as $$
begin
  perform public.money_require_finance(p_actor);
  if exists(select 1 from public.money_event_exclusions where event_id=p_event) then raise exception 'Excluded event requires a new reviewed reconciliation, not replay'; end if;
  insert into public.money_event_replays(event_id,actor,reason) values(p_event,p_actor,p_reason);
  update public.money_webhook_events set status='received',next_retry_at=null where event_id=p_event and status in ('failed','dead_letter');
  return public.money_process_event(p_event);
end $$;
create function public.money_flag_checkout(p_attempt uuid,p_code text) returns void language plpgsql security definer set search_path='' as $$
declare obligation uuid;
begin
  select obligation_id into strict obligation from public.money_checkout_attempts where id=p_attempt;
  perform 1 from public.money_obligations where id=obligation for update;
  update public.money_checkout_attempts set status='reconcile',failure_code=p_code where id=p_attempt and status in ('prepared','session_created');
  update public.money_obligations set reconciliation_open=true where id=obligation;
end $$;
create function public.money_record_reconciliation(p_obligation uuid,p_key text,p_observed bigint,p_currency text,p_evidence text)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; expected bigint; existing public.money_reconciliation;
begin
  select * into strict o from public.money_obligations where id=p_obligation for update;
  expected:=o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip;
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
create function public.money_record_processor_cost(p_obligation uuid,p_reference text,p_amount bigint,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.money_journals; lines jsonb;
begin
  perform 1 from public.money_obligations where id=p_obligation for update;
  lines:=jsonb_build_array(jsonb_build_object('account','processor_expense','debit',p_amount,'credit',0),jsonb_build_object('account','stripe_clearing','debit',0,'credit',p_amount));
  select * into existing from public.money_journals where business_key='processor:'||p_reference;
  if found then
    if existing.obligation_id<>p_obligation or existing.lines<>lines or existing.evidence<>p_evidence then raise exception 'Processor cost conflict'; end if;
    return;
  end if;
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(p_obligation,'processor:'||p_reference,'processor_cost',lines,p_evidence);
end $$;

-- Prevent a newly authorized refund racing with an already reserved bank instruction.
create function public.money_refund_bank_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.money_ach_items where obligation_id=new.obligation_id) then raise exception 'Bank statement reconciliation required before refund'; end if;
  return new;
end $$;
create trigger refund_bank_guard before insert on public.money_refund_authorizations for each row execute function public.money_refund_bank_guard();

do $$ declare t text; f record; begin
  foreach t in array array['money_event_replays','money_disputes','money_dispute_events','money_chargeback_resolutions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    if t<>'money_disputes' then execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t); end if;
  end loop;
  for f in select oid::regprocedure signature from pg_proc where proname in ('money_process_event','money_flag_checkout','money_record_reconciliation','money_record_processor_cost','money_refund_bank_guard') and pronamespace='public'::regnamespace loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.signature::text not like '%money_refund_bank_guard(%' then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;
