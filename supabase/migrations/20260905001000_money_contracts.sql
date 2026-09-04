-- Phase 5 independent contracts. No Phase 4 schema, lifecycle effects or scheduler.
-- No authorities are seeded; no legacy invoices or statuses are inferred/backfilled.
create table public.money_authorities (
  user_id uuid primary key references auth.users(id),
  granted_by uuid not null references auth.users(id),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);
create table public.money_obligations (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null unique references public.service_requests(id),
  customer_id uuid not null references auth.users(id),
  contractor_id uuid not null references public.contractors(id),
  current_snapshot_id uuid,
  captured bigint not null default 0 check (captured >= 0),
  refunded_service bigint not null default 0 check (refunded_service >= 0),
  refunded_tax bigint not null default 0 check (refunded_tax >= 0),
  refunded_tip bigint not null default 0 check (refunded_tip >= 0),
  dispute_open boolean not null default false,
  reconciliation_open boolean not null default false,
  created_at timestamptz not null default now()
);
create sequence public.money_invoice_number_seq;
create table public.money_snapshots (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  revision integer not null check (revision > 0),
  invoice_number text not null unique default ('M5-' || lpad(nextval('public.money_invoice_number_seq')::text, 10, '0')),
  service bigint not null check (service between 0 and 1000000000000),
  addons bigint not null check (addons between 0 and 1000000000000),
  discount bigint not null check (discount between 0 and 1000000000000),
  adjustment bigint not null check (adjustment between -1000000000000 and 1000000000000),
  subtotal bigint not null check (subtotal >= 0),
  tax bigint not null check (tax between 0 and 1000000000000),
  tip bigint not null check (tip between 0 and 1000000000000),
  deposit bigint not null check (deposit >= 0),
  total bigint not null check (total > 0),
  currency text not null check (currency = 'usd'),
  source_version text not null check (length(trim(source_version)) > 0),
  policy_version text not null check (length(trim(policy_version)) > 0),
  tax_evidence text not null check (length(trim(tax_evidence)) > 0),
  promotion_terms text,
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  reason text not null check (length(trim(reason)) > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (obligation_id, revision),
  check (created_by <> approved_by),
  check (subtotal = service + addons - discount + adjustment),
  check (total = subtotal + tax + tip),
  check (deposit <= subtotal),
  check (discount = 0 or length(trim(promotion_terms)) > 0),
  check (discount = 0 or promotion_terms is not null),
  check (expires_at > created_at)
);
alter table public.money_obligations add constraint money_current_snapshot_fk
  foreign key (current_snapshot_id) references public.money_snapshots(id);

create table public.money_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  snapshot_id uuid not null references public.money_snapshots(id),
  customer_id uuid not null references auth.users(id),
  mode text not null check (mode in ('full','deposit','balance')),
  attempt_number integer not null default 1 check(attempt_number>0),
  amount bigint not null check (amount > 0),
  currency text not null check (currency = 'usd'),
  business_key text not null unique,
  stripe_idempotency_key text not null unique,
  stripe_session_id text unique,
  stripe_payment_id text unique,
  checkout_url text,
  status text not null default 'prepared' check (status in ('prepared','session_created','captured','expired','reconcile')),
  failure_code text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(snapshot_id, mode, attempt_number)
);
create unique index money_one_open_checkout on public.money_checkout_attempts(obligation_id)
  where status in ('prepared','session_created','reconcile');

create table public.money_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'received' check (status in ('received','processing','processed','failed','dead_letter')),
  attempt_count integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  next_retry_at timestamptz
);
create table public.money_journals (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  business_key text not null unique,
  kind text not null,
  lines jsonb not null,
  evidence text not null check (length(trim(evidence)) > 0),
  created_at timestamptz not null default now()
);
create table public.money_refund_authorizations (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.money_obligations(id),
  payment_id text not null,
  service bigint not null check (service >= 0),
  tax bigint not null check (tax >= 0),
  tip bigint not null check (tip >= 0),
  business_key text not null unique,
  created_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  policy_evidence text not null check (length(trim(policy_evidence)) > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  check (created_by <> approved_by), check (service + tax + tip > 0)
);
create table public.money_refunds (
  provider_ref text primary key,
  authorization_id uuid not null unique references public.money_refund_authorizations(id),
  event_id text not null references public.money_webhook_events(event_id),
  created_at timestamptz not null default now()
);
create table public.money_reconciliation (
  id uuid primary key default gen_random_uuid(),
  observation_sequence bigint generated always as identity unique,
  obligation_id uuid not null references public.money_obligations(id),
  observation_key text not null unique,
  expected bigint not null,
  observed bigint not null,
  currency text not null,
  evidence text not null check (length(trim(evidence)) > 0),
  created_at timestamptz not null default now()
);

create function public.money_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Immutable financial evidence; append a correction' using errcode = '55000'; end $$;
create function public.money_check_journal() returns trigger language plpgsql set search_path = '' as $$
declare line jsonb; debit numeric; credit numeric; balance numeric := 0;
begin
  if jsonb_typeof(new.lines) <> 'array' or jsonb_array_length(new.lines) < 2 then raise exception 'Invalid journal'; end if;
  for line in select * from jsonb_array_elements(new.lines) loop
    debit := (line->>'debit')::numeric; credit := (line->>'credit')::numeric;
    if debit is null or credit is null or debit < 0 or credit < 0 or trunc(debit) <> debit or trunc(credit) <> credit
      or (debit > 0) = (credit > 0) or greatest(debit,credit) > 9007199254740991
      or coalesce(line->>'account','') not in ('stripe_clearing','customer_advance','platform_revenue','tax_liability','provider_payable','processor_expense','chargeback_suspense','bank')
      then raise exception 'Invalid posting'; end if;
    balance := balance + debit - credit;
  end loop;
  if balance <> 0 then raise exception 'Unbalanced journal'; end if;
  return new;
end $$;
create trigger money_journal_balance before insert on public.money_journals for each row execute function public.money_check_journal();

create function public.money_require_finance(p_actor uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_actor is null or not public.has_role(p_actor,'admin') or not exists(select 1 from public.money_authorities where user_id=p_actor)
  then raise exception 'Restricted finance authority required' using errcode='42501'; end if;
end $$;

-- Manual reviewed snapshot intake. Automated offering/quote adapter is a Phase 4 integration gate.
create function public.money_publish_snapshot(p_request uuid, p_terms jsonb, p_actor uuid, p_approver uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; o public.money_obligations; snapshot uuid; revision integer;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','snapshot','request',p_request,'terms',p_terms));
  select * into strict r from public.service_requests where id=p_request for update;
  if r.customer_id is null or r.contractor_id is null then raise exception 'Confirmed commercial parties required'; end if;
  insert into public.money_obligations(service_request_id,customer_id,contractor_id)
    values(r.id,r.customer_id,r.contractor_id) on conflict(service_request_id) do nothing;
  select * into strict o from public.money_obligations where service_request_id=r.id for update;
  if o.customer_id <> r.customer_id or o.contractor_id <> r.contractor_id then raise exception 'Commercial party reconciliation required'; end if;
  if exists(select 1 from public.money_checkout_attempts where obligation_id=o.id)
    then raise exception 'Existing checkout requires reconciliation before repricing'; end if;
  select coalesce(max(s.revision),0)+1 into revision from public.money_snapshots s where obligation_id=o.id;
  insert into public.money_snapshots(obligation_id,revision,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,promotion_terms,created_by,approved_by,reason,expires_at)
  values(o.id,revision,(p_terms->>'service')::bigint,(p_terms->>'addons')::bigint,(p_terms->>'discount')::bigint,(p_terms->>'adjustment')::bigint,
    (p_terms->>'subtotal')::bigint,(p_terms->>'tax')::bigint,(p_terms->>'tip')::bigint,(p_terms->>'deposit')::bigint,(p_terms->>'total')::bigint,
    p_terms->>'currency',p_terms->>'source_version',p_terms->>'policy_version',p_terms->>'tax_evidence',p_terms->>'promotion_terms',p_actor,p_approver,p_terms->>'reason',(p_terms->>'expires_at')::timestamptz)
  returning id into snapshot;
  update public.money_obligations set current_snapshot_id=snapshot where id=o.id;
  return snapshot;
end $$;

create function public.money_prepare_checkout(p_snapshot uuid, p_mode text)
returns public.money_checkout_attempts language plpgsql security definer set search_path = '' as $$
declare s public.money_snapshots; o public.money_obligations; a public.money_checkout_attempts; amount bigint; key text; attempt_number integer;
begin
  select * into strict s from public.money_snapshots where id=p_snapshot;
  select * into strict o from public.money_obligations where id=s.obligation_id for update;
  if auth.uid() is null or o.customer_id <> auth.uid() then raise exception 'Homeowner authorization required' using errcode='42501'; end if;
  if o.current_snapshot_id <> s.id or s.expires_at <= now() then raise exception 'Stale commercial snapshot'; end if;
  if o.dispute_open or o.reconciliation_open then raise exception 'Commercial review required'; end if;
  if o.refunded_service+o.refunded_tax+o.refunded_tip>0 then raise exception 'Refunded obligation requires reviewed new terms'; end if;
  if p_mode not in ('full','deposit','balance') or p_mode is null then raise exception 'Invalid checkout mode'; end if;
  select * into a from public.money_checkout_attempts where snapshot_id=s.id and mode=p_mode order by money_checkout_attempts.attempt_number desc limit 1;
  if found and a.status<>'expired' then return a; end if;
  attempt_number:=coalesce(a.attempt_number,0)+1;
  if exists(select 1 from public.money_checkout_attempts where obligation_id=o.id and status in ('prepared','session_created','reconcile')) then raise exception 'Checkout already in progress'; end if;
  if p_mode='full' and o.captured=0 then amount:=s.total;
  elsif p_mode='deposit' and o.captured=0 and s.deposit>0 then amount:=s.deposit;
  elsif p_mode='balance' and o.captured=s.deposit and s.deposit>0 then amount:=s.total-o.captured;
  else raise exception 'Mode does not match outstanding balance'; end if;
  if s.expires_at<now()+interval '31 minutes' then raise exception 'Commercial terms expire too soon for new checkout'; end if;
  key:= s.id::text || ':' || p_mode || ':' || attempt_number;
  insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,expires_at,attempt_number)
    values(o.id,s.id,o.customer_id,p_mode,amount,s.currency,key,'mercurius:money-v1:'||key,least(s.expires_at,now()+interval '1 hour'),attempt_number) returning * into a;
  return a;
end $$;

create function public.money_attach_checkout(p_attempt uuid,p_session text,p_url text) returns void language plpgsql security definer set search_path = '' as $$
declare a public.money_checkout_attempts;
begin
  select * into strict a from public.money_checkout_attempts where id=p_attempt for update;
  if p_session is null or p_session not like 'cs_%' or p_url is null or p_url !~ '^https://checkout.stripe.com/' then raise exception 'Invalid Stripe session'; end if;
  if a.stripe_session_id is not null and a.stripe_session_id<>p_session then raise exception 'Session reconciliation required'; end if;
  if a.status not in ('prepared','session_created','captured') then raise exception 'Attempt not attachable'; end if;
  update public.money_checkout_attempts set stripe_session_id=p_session,checkout_url=p_url,
    status=case when status='captured' then status else 'session_created' end where id=a.id;
end $$;

create function public.money_receive_event(p_id text,p_type text,p_payload jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare e public.money_webhook_events;
begin
  if p_id is null or p_id not like 'evt_%' or octet_length(p_payload::text)>16000 then raise exception 'Invalid event'; end if;
  insert into public.money_webhook_events(event_id,event_type,payload) values(p_id,p_type,p_payload) on conflict do nothing;
  select * into strict e from public.money_webhook_events where event_id=p_id;
  if e.event_type<>p_type or e.payload<>p_payload then raise exception 'Event identity conflict'; end if;
end $$;

create function public.money_authorize_refund(p_obligation uuid,p_payment text,p_service bigint,p_tax bigint,p_tip bigint,p_key text,p_actor uuid,p_approver uuid,p_policy text,p_reason text)
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
  if (select coalesce(sum(service),0)+p_service>s.subtotal or coalesce(sum(tax),0)+p_tax>s.tax or coalesce(sum(tip),0)+p_tip>s.tip from public.money_refund_authorizations where obligation_id=o.id)
    then raise exception 'Refund exceeds remaining components'; end if;
  if (select coalesce(sum(service+tax+tip),0)+p_service+p_tax+p_tip from public.money_refund_authorizations where payment_id=p_payment)
    > (select amount from public.money_checkout_attempts where stripe_payment_id=p_payment) then raise exception 'Refund exceeds payment'; end if;
  insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,business_key,created_by,approved_by,policy_evidence,reason)
    values(o.id,p_payment,p_service,p_tax,p_tip,p_key,p_actor,p_approver,p_policy,p_reason) returning id into result;
  return result;
end $$;

-- Receipt commits separately from processing. This function catches effect failures in a
-- subtransaction, retains the inbox row and records retry evidence after rollback.
create function public.money_process_event(p_event text) returns text language plpgsql security definer set search_path = '' as $$
declare e public.money_webhook_events; a public.money_checkout_attempts; o public.money_obligations; s public.money_snapshots;
  r public.money_refund_authorizations; platform bigint; provider bigint; old_fee bigint; new_fee bigint; lines jsonb; code text;
begin
  select * into strict e from public.money_webhook_events where event_id=p_event for update;
  if e.status='processed' then return 'processed'; end if;
  if e.status='dead_letter' then return 'dead_letter'; end if;
  update public.money_webhook_events set status='processing',attempt_count=attempt_count+1 where event_id=p_event;
  begin
    if e.event_type='capture' then
      select * into strict a from public.money_checkout_attempts where id=(e.payload->>'attempt_id')::uuid;
      select * into strict o from public.money_obligations where id=a.obligation_id for update;
      select * into strict a from public.money_checkout_attempts where id=a.id for update;
      select * into strict s from public.money_snapshots where id=a.snapshot_id;
      if a.amount is distinct from (e.payload->>'amount')::bigint or a.currency is distinct from (e.payload->>'currency') or coalesce(e.payload->>'payment_id','') not like 'pi_%' then raise exception 'Capture mismatch'; end if;
      if a.status='captured' then
        if a.stripe_payment_id<>e.payload->>'payment_id' then raise exception 'Duplicate payment conflict'; end if;
      else
        if a.status='expired' then raise exception 'Capture on expired session requires reconciliation'; end if;
        if o.current_snapshot_id<>s.id or o.captured+a.amount>s.total then raise exception 'Capture requires reconciliation'; end if;
        insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'capture:'||(e.payload->>'payment_id'),'capture',jsonb_build_array(
          jsonb_build_object('account','stripe_clearing','debit',a.amount,'credit',0),jsonb_build_object('account','customer_advance','debit',0,'credit',a.amount)),e.event_id);
        update public.money_checkout_attempts set status='captured',stripe_payment_id=e.payload->>'payment_id',completed_at=now() where id=a.id;
        update public.money_obligations set captured=captured+a.amount where id=o.id;
        if o.captured+a.amount=s.total then
          platform:=round(s.subtotal::numeric*15/100); provider:=s.subtotal-platform+s.tip;
          lines:=jsonb_build_array(jsonb_build_object('account','customer_advance','debit',s.total,'credit',0));
          if platform>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',0,'credit',platform)); end if;
          if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',0,'credit',provider)); end if;
          if s.tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',0,'credit',s.tax)); end if;
          insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'earnings:'||s.id,'earnings',lines,e.event_id);
        end if;
      end if;
    elsif e.event_type='refund' then
      select * into strict r from public.money_refund_authorizations where id=(e.payload->>'authorization_id')::uuid;
      select * into strict o from public.money_obligations where id=r.obligation_id for update;
      select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
      if r.service+r.tax+r.tip is distinct from (e.payload->>'amount')::bigint or e.payload->>'currency' is distinct from s.currency or e.payload->>'payment_id' is distinct from r.payment_id or coalesce(e.payload->>'refund_id','') not like 're_%' then raise exception 'Refund mismatch'; end if;
      if exists(select 1 from public.money_refunds where authorization_id=r.id) then
        if not exists(select 1 from public.money_refunds where authorization_id=r.id and provider_ref=e.payload->>'refund_id') then raise exception 'Refund identity conflict'; end if;
      else
        old_fee:=round((s.subtotal-o.refunded_service)::numeric*15/100); new_fee:=round((s.subtotal-o.refunded_service-r.service)::numeric*15/100);
        platform:=old_fee-new_fee; provider:=r.service-platform+r.tip;
        lines:=jsonb_build_array(jsonb_build_object('account','stripe_clearing','debit',0,'credit',r.service+r.tax+r.tip));
        if platform>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',platform,'credit',0)); end if;
        if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',provider,'credit',0)); end if;
        if r.tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',r.tax,'credit',0)); end if;
        if o.captured<s.total then
          lines:=jsonb_build_array(jsonb_build_object('account','customer_advance','debit',r.service,'credit',0),jsonb_build_object('account','stripe_clearing','debit',0,'credit',r.service));
        end if;
        insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'refund:'||r.id,'refund',lines,e.event_id);
        insert into public.money_refunds(provider_ref,authorization_id,event_id) values(e.payload->>'refund_id',r.id,e.event_id);
        update public.money_obligations set refunded_service=refunded_service+r.service,refunded_tax=refunded_tax+r.tax,refunded_tip=refunded_tip+r.tip where id=o.id;
      end if;
    else raise exception 'Unsupported event requires reconciliation'; end if;
    update public.money_webhook_events set status='processed',processed_at=now(),last_error=null,next_retry_at=null where event_id=p_event;
    return 'processed';
  exception when others then
    get stacked diagnostics code = returned_sqlstate;
    update public.money_webhook_events set status=case when attempt_count>=5 then 'dead_letter' else 'failed' end,
      last_error=code,next_retry_at=now()+interval '5 minutes' where event_id=p_event;
    return 'failed';
  end;
end $$;

create function public.money_replay_event(p_event text,p_actor uuid,p_reason text) returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public.money_require_finance(p_actor);
  if p_reason is null or length(trim(p_reason))=0 then raise exception 'Replay reason required'; end if;
  update public.money_webhook_events set status='received',next_retry_at=null where event_id=p_event and status in ('failed','dead_letter');
  return public.money_process_event(p_event);
end $$;

-- Explicit grants: browser roles cannot write money evidence, even when they are admins.
do $$ declare t text; begin
  foreach t in array array['money_authorities','money_obligations','money_snapshots','money_checkout_attempts','money_webhook_events','money_journals','money_refund_authorizations','money_refunds','money_reconciliation'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  foreach t in array array['money_snapshots','money_journals','money_refund_authorizations','money_refunds','money_reconciliation','money_review_approvals'] loop
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;
revoke all on sequence public.money_invoice_number_seq from public,anon,authenticated,service_role;
grant select on public.money_snapshots,public.money_obligations,public.money_checkout_attempts to authenticated;
create policy money_own_obligations on public.money_obligations for select to authenticated using(customer_id=auth.uid());
create policy money_own_snapshots on public.money_snapshots for select to authenticated using(exists(select 1 from public.money_obligations o where o.id=obligation_id and o.customer_id=auth.uid()));
create policy money_own_attempts on public.money_checkout_attempts for select to authenticated using(customer_id=auth.uid());
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'money\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.money_publish_snapshot(uuid,jsonb,uuid,uuid),public.money_attach_checkout(uuid,text,text),public.money_receive_event(text,text,jsonb),public.money_process_event(text),public.money_replay_event(text,uuid,text),public.money_authorize_refund(uuid,text,bigint,bigint,bigint,text,uuid,uuid,text,text) to service_role;
grant execute on function public.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function public.money_approve_review(uuid,jsonb,text) to authenticated;
