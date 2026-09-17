-- TRACE-076: finance operator command gateway, part 1 (MPS §§4/7; CFG-008; TRACE-050–059/075).
--
-- The money kernels are service-role only and trust a caller-supplied p_actor. This gateway
-- lets a signed-in finance operator run a bounded set of them without that trust:
--  * the actor is always auth.uid(), re-checked against money_require_finance; no function
--    here accepts an actor or approver from its caller;
--  * a second-person command is a stored request whose exact command is built here, byte for
--    byte the object the kernel hashes. A different finance operator approves it in their
--    own session through money_approve_review; only the requester executes it, and execution
--    re-derives the approver from the approvals table and re-checks the command is still
--    actionable;
--  * the kernels are called unchanged and keep their own checks and grants.
-- Commands: payout hold placement (one operator) and release (two); Stripe readback record
-- (one) and resolution (two); event replay (one) and exclusion (two). Refund send and
-- readback call Stripe and stay in the refund-invoice Edge function, which passes the
-- verified JWT user as the actor to the two service-only functions at the end.
-- Owner decision 2026-09-16: an unsupported Stripe event keeps holding every payout; the
-- reviewed exclusion below is how operators clear it. No kernel predicate is changed.

create table public.money_review_requests (
  id uuid primary key default gen_random_uuid(),
  business_key text not null unique check (length(business_key) between 1 and 200),
  operation text not null check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution')),
  subject text not null check (length(subject) between 1 and 255),
  obligation_id uuid references public.money_obligations(id),
  command jsonb not null,
  command_hash text not null,
  requested_by uuid not null references auth.users(id),
  reason text not null check (length(trim(reason))>0 and length(reason)<=1000),
  evidence text check (evidence is null or (length(trim(evidence))>0 and length(evidence)<=1000)),
  created_at timestamptz not null default now(),
  check ((operation='reconciliation_resolution')=(evidence is null))
);
create index money_review_requests_subject on public.money_review_requests(operation,subject);

create table public.money_review_executions (
  request_id uuid primary key references public.money_review_requests(id),
  actor uuid not null references auth.users(id),
  approver uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (actor<>approver)
);

-- Who recorded each gateway readback. The kernel observation itself names no actor.
create table public.money_readback_entries (
  observation_id uuid primary key references public.money_reconciliation(id),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Each operator-triggered Stripe refund readback, including "not found at Stripe".
create table public.money_refund_readbacks (
  id uuid primary key default gen_random_uuid(),
  readback_sequence bigint generated always as identity unique,
  authorization_id uuid not null references public.money_refund_attempts(authorization_id),
  actor uuid not null references auth.users(id),
  found boolean not null,
  provider_reference text,
  provider_status text,
  created_at timestamptz not null default now(),
  check (found=(provider_reference is not null)),
  check (provider_reference is null or provider_reference like 're\_%'),
  check (found=(provider_status is not null))
);

do $$ declare t text; begin
  foreach t in array array['money_review_requests','money_review_executions','money_readback_entries','money_refund_readbacks'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;

create function private.money_is_uuid(p_value text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
$$;

-- The exact objects money_exclude_event and money_resolve_reconciliation hash. The hold
-- release has no kernel review, so the gateway defines its command in the same form.
create function private.money_review_command(p_operation text,p_subject text,p_reason text,p_evidence text)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
  if p_operation='event_exclusion' then
    return jsonb_build_object('operation','event_exclusion','event',p_subject,'reason',p_reason,'evidence',p_evidence);
  elsif p_operation='reconciliation_resolution' then
    return jsonb_build_object('operation','reconciliation_resolution','observation',p_subject::uuid,'reason',p_reason);
  elsif p_operation='hold_resolution' then
    return jsonb_build_object('operation','hold_resolution','hold',p_subject::uuid,'reason',p_reason,'evidence',p_evidence);
  end if;
  raise exception 'Unsupported finance review' using errcode='22023';
end $$;

create function private.money_command_hash(p_command jsonb) returns text
language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_command::text,'UTF8')),'hex')
$$;

-- Why a reviewed command cannot run now, or null when it can. Mirrors the kernel refusals so
-- operators see the reason before anyone approves; the kernels still decide at execution.
create function private.money_review_blocker(p_operation text,p_subject text)
returns text language plpgsql stable security definer set search_path='' as $$
declare e public.money_webhook_events; r public.money_reconciliation; o public.money_obligations;
begin
  if p_operation='event_exclusion' then
    select * into e from public.money_webhook_events where event_id=p_subject;
    if not found then return 'not_found'; end if;
    if exists(select 1 from public.money_event_exclusions where event_id=e.event_id) then return 'completed'; end if;
    if e.status not in ('failed','dead_letter') then return 'event_not_failed'; end if;
    if exists(select 1 from public.money_journals where evidence=e.event_id) then return 'event_has_effects'; end if;
    return null;
  elsif p_operation='reconciliation_resolution' then
    if not private.money_is_uuid(p_subject) then return 'not_found'; end if;
    select * into r from public.money_reconciliation where id=p_subject::uuid;
    if not found then return 'not_found'; end if;
    if exists(select 1 from public.money_reconciliation_resolutions where observation_id=r.id) then return 'completed'; end if;
    select * into strict o from public.money_obligations where id=r.obligation_id;
    if exists(select 1 from public.money_reconciliation where obligation_id=o.id and observation_sequence>r.observation_sequence) then return 'readback_superseded'; end if;
    if r.currency<>'usd' or r.expected<>r.observed then return 'readback_mismatch'; end if;
    if r.expected<>o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip then return 'readback_outdated'; end if;
    if not o.reconciliation_open then return 'not_open'; end if;
    return null;
  elsif p_operation='hold_resolution' then
    if not private.money_is_uuid(p_subject) then return 'not_found'; end if;
    if not exists(select 1 from public.money_holds where id=p_subject::uuid) then return 'not_found'; end if;
    if exists(select 1 from public.money_hold_resolutions where hold_id=p_subject::uuid) then return 'completed'; end if;
    return null;
  end if;
  return 'not_found';
end $$;

-- The approver execution will use: a different operator who still holds finance authority
-- and, for a readback resolution, did not record that readback.
create function private.money_review_approver(p_request uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select a.approved_by from public.money_review_requests q
  join public.money_review_approvals a on a.requested_by=q.requested_by and a.command_hash=q.command_hash
  where q.id=p_request and a.approved_by<>q.requested_by
    and public.has_role(a.approved_by,'admin') and exists(select 1 from public.money_authorities m where m.user_id=a.approved_by)
    and not (q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries x
      where x.observation_id::text=q.subject and x.actor=a.approved_by))
  order by a.created_at,a.id limit 1
$$;

create function private.money_require_text(p_value text,p_label text) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_value is null or length(trim(p_value))=0 or length(p_value)>1000 then
    raise exception '% of up to 1000 characters required',p_label using errcode='22023';
  end if;
end $$;

create function private.money_require_key(p_key text) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_key is null or length(p_key) not between 1 and 200 then raise exception 'Idempotency key required' using errcode='22023'; end if;
end $$;

-- One operator places a payout hold. A hold only affects ACH preparation, so a payout already
-- on a statement is refused rather than shown as held.
create function public.money_operator_place_hold(p_obligation uuid,p_reason text,p_evidence text,p_key text)
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
  if exists(select 1 from public.money_ach_items where obligation_id=p_obligation) then
    raise exception 'Payout already on an ACH statement; a hold cannot stop it' using errcode='55000';
  end if;
  return jsonb_build_object('hold_id',public.money_place_hold(p_obligation,p_key,actor,p_reason,p_evidence),'replay',false);
end $$;

-- One operator records what Stripe shows as collected, net of refunds. A mismatch opens the
-- reconciliation hold; a match never clears one (that needs the reviewed resolution).
create function public.money_operator_record_readback(p_obligation uuid,p_observed bigint,p_currency text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.money_reconciliation; matched boolean;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_evidence,'Evidence');
  if p_observed is null or p_observed<0 then raise exception 'Observed amount in cents required' using errcode='22023'; end if;
  if p_currency is null or p_currency !~ '^[a-z]{3}$' then raise exception 'Three-letter lowercase currency required' using errcode='22023'; end if;
  perform 1 from public.money_obligations where id=p_obligation for update;
  if not found then raise exception 'Finance obligation not found' using errcode='P0002'; end if;
  select * into r from public.money_reconciliation where observation_key=p_key;
  if found then
    if r.obligation_id<>p_obligation or r.observed<>p_observed or r.currency<>p_currency or r.evidence<>p_evidence
      or not exists(select 1 from public.money_readback_entries x where x.observation_id=r.id and x.actor=auth.uid()) then
      raise exception 'Readback idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('observation_id',r.id,'matched',r.expected=r.observed and r.currency='usd','expected',r.expected,'replay',true);
  end if;
  matched:=public.money_record_reconciliation(p_obligation,p_key,p_observed,p_currency,p_evidence);
  select * into strict r from public.money_reconciliation where observation_key=p_key;
  insert into public.money_readback_entries(observation_id,actor) values(r.id,actor);
  return jsonb_build_object('observation_id',r.id,'matched',matched,'expected',r.expected,'replay',false);
end $$;

-- One operator replays a received or failed Stripe event through the kernel. Each replay is
-- logged by the kernel; processing re-validates the event, so a replay cannot force an effect.
create function public.money_operator_replay_event(p_event text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); e public.money_webhook_events; outcome text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_text(p_reason,'Reason');
  select * into e from public.money_webhook_events where event_id=p_event;
  if not found then raise exception 'Stripe event not found' using errcode='P0002'; end if;
  if exists(select 1 from public.money_event_exclusions where event_id=p_event) then
    raise exception 'Excluded event requires a new reviewed reconciliation, not replay' using errcode='55000';
  end if;
  if e.status='processed' then raise exception 'Stripe event already processed' using errcode='55000'; end if;
  outcome:=public.money_replay_event(p_event,actor,p_reason);
  select * into strict e from public.money_webhook_events where event_id=p_event;
  return jsonb_build_object('event_id',e.event_id,'outcome',outcome,'status',e.status,'attempts',e.attempt_count);
end $$;

-- Step 1 of a second-person command: the requester states the exact command.
create function public.money_operator_request_review(p_operation text,p_subject text,p_reason text,p_key text,p_evidence text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject text; command jsonb; blocker text; obligation uuid; q public.money_review_requests;
begin
  perform public.money_require_finance(actor);
  if p_operation is null or p_operation not in ('event_exclusion','reconciliation_resolution','hold_resolution') then
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
  command:=private.money_review_command(p_operation,subject,p_reason,p_evidence);
  perform pg_advisory_xact_lock(hashtextextended('money_review_request:'||p_key,0));
  select * into q from public.money_review_requests where business_key=p_key;
  if found then
    if q.operation<>p_operation or q.subject<>subject or q.command<>command or q.requested_by<>actor then
      raise exception 'Review request idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('request_id',q.id,'replay',true);
  end if;
  blocker:=private.money_review_blocker(p_operation,subject);
  if blocker='not_found' then raise exception 'Finance review subject not found' using errcode='P0002'; end if;
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  if p_operation='event_exclusion' then
    select a.obligation_id into obligation from public.money_webhook_events e join public.money_checkout_attempts a
      on a.id::text=e.payload->>'attempt_id' or a.stripe_payment_id=e.payload->>'payment_id' where e.event_id=subject order by a.created_at limit 1;
  elsif p_operation='reconciliation_resolution' then
    select obligation_id into obligation from public.money_reconciliation where id::text=subject;
  else
    select obligation_id into obligation from public.money_holds where id::text=subject;
  end if;
  insert into public.money_review_requests(business_key,operation,subject,obligation_id,command,command_hash,requested_by,reason,evidence)
    values(p_key,p_operation,subject,obligation,command,private.money_command_hash(command),actor,p_reason,p_evidence)
    returning * into q;
  return jsonb_build_object('request_id',q.id,'replay',false);
end $$;

-- Step 2: a different finance operator approves the stored exact command in their own session.
create function public.money_operator_approve_review(p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare approver uuid:=auth.uid(); q public.money_review_requests; blocker text;
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
  blocker:=private.money_review_blocker(q.operation,q.subject);
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  return jsonb_build_object('request_id',q.id,'approval_id',public.money_approve_review(q.requested_by,q.command,p_reason));
end $$;

-- Step 3: the requester executes the approved command through the unchanged kernel.
create function public.money_operator_execute_review(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.money_review_requests; x public.money_review_executions; approver uuid; blocker text;
begin
  perform public.money_require_finance(actor);
  select * into q from public.money_review_requests where id=p_request for update;
  if not found then raise exception 'Finance review request not found' using errcode='P0002'; end if;
  if q.requested_by<>actor then raise exception 'Only the requesting finance operator can execute this command' using errcode='42501'; end if;
  select * into x from public.money_review_executions where request_id=q.id;
  if found then return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',true); end if;
  -- Two requests for the same subject serialize here; the second then sees it completed.
  perform pg_advisory_xact_lock(hashtextextended('money_review_subject:'||q.operation||':'||q.subject,0));
  -- Take the row the kernel will lock before checking, so a concurrent readback, hold change or
  -- replay is seen here and refused with its reason rather than inside the kernel.
  if q.operation='event_exclusion' then
    perform 1 from public.money_webhook_events where event_id=q.subject for update;
  else
    perform 1 from public.money_obligations where id=q.obligation_id for update;
  end if;
  approver:=private.money_review_approver(q.id);
  if approver is null then
    raise exception 'Separate authenticated approval of exact financial command required' using errcode='42501';
  end if;
  blocker:=private.money_review_blocker(q.operation,q.subject);
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  if q.operation='event_exclusion' then
    perform public.money_exclude_event(q.subject,actor,approver,q.reason,q.evidence);
  elsif q.operation='reconciliation_resolution' then
    perform public.money_resolve_reconciliation(q.subject::uuid,actor,approver,q.reason);
  else
    perform public.money_require_finance(approver);
    perform public.money_require_review(actor,approver,q.command);
    perform public.money_resolve_hold(q.subject::uuid,actor,q.reason,q.evidence);
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;

-- Operator readback for the commands. Reasons and evidence are returned because an approver
-- must see exactly what they approve; bank references and customer identities are not.
create function public.money_finance_operations()
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
        'reason',q.reason,'evidence',q.evidence,'requested_by_me',q.requested_by=me,
        'approved_by_me',exists(select 1 from public.money_review_approvals a where a.requested_by=q.requested_by and a.command_hash=q.command_hash and a.approved_by=me),
        'recorded_by_me',q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries e where e.observation_id::text=q.subject and e.actor=me),
        'state',case when x.request_id is not null then 'executed'
          when private.money_review_blocker(q.operation,q.subject) is not null then 'stale'
          when private.money_review_approver(q.id) is not null then 'approved' else 'awaiting_approval' end,
        'blocker',case when x.request_id is null then private.money_review_blocker(q.operation,q.subject) end,
        'created_at',q.created_at,'executed_at',x.created_at) item
      from public.money_review_requests q left join public.money_review_executions x on x.request_id=q.id
      where x.request_id is null or x.created_at>now()-interval '30 days'
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
        'last_readback',(select jsonb_build_object('found',b.found,'provider_status',b.provider_status,'by_me',b.actor=me,'created_at',b.created_at)
          from public.money_refund_readbacks b where b.authorization_id=a.id order by b.readback_sequence desc limit 1),
        'created_at',a.created_at) order by a.created_at,a.id)
      from public.money_refund_authorizations a left join public.money_refund_attempts t on t.authorization_id=a.id
      where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)),'[]'::jsonb));
end $$;

-- Service-only, for refund-invoice: the verified JWT user is p_actor. The target read writes
-- nothing, so a readback never creates a refund attempt.
create function public.money_refund_readback_target(p_authorization uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.money_refund_authorizations; a public.money_refund_attempts;
begin
  perform public.money_require_finance(p_actor);
  select * into r from public.money_refund_authorizations where id=p_authorization;
  if not found then raise exception 'Refund authorization not found' using errcode='P0002'; end if;
  select * into a from public.money_refund_attempts where authorization_id=r.id;
  return jsonb_build_object('authorization_id',r.id,'payment_id',r.payment_id,'amount',r.service+r.tax+r.tip,
    'attempt_status',coalesce(a.status,'not_started'),'provider_reference',a.provider_reference,
    'settled',exists(select 1 from public.money_refunds where authorization_id=r.id));
end $$;

-- Records what Stripe returned for a sent refund. Found refunds go through the unchanged
-- money_record_refund_result, which never marks success without the settled refund event.
create function public.money_record_refund_readback(p_authorization uuid,p_actor uuid,p_reference text,p_status text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.money_refund_attempts;
begin
  perform public.money_require_finance(p_actor);
  select * into a from public.money_refund_attempts where authorization_id=p_authorization for update;
  if not found then raise exception 'Refund was not sent; nothing to read back' using errcode='55000'; end if;
  if p_reference is null then
    if a.provider_reference is not null then raise exception 'Refund reference already recorded' using errcode='55000'; end if;
    insert into public.money_refund_readbacks(authorization_id,actor,found) values(a.authorization_id,p_actor,false);
  else
    perform public.money_record_refund_result(p_authorization,p_reference,p_status,p_amount);
    insert into public.money_refund_readbacks(authorization_id,actor,found,provider_reference,provider_status)
      values(a.authorization_id,p_actor,true,p_reference,p_status);
  end if;
  select * into strict a from public.money_refund_attempts where authorization_id=p_authorization;
  return jsonb_build_object('authorization_id',a.authorization_id,'attempt_status',a.status,
    'provider_reference',a.provider_reference,'found',p_reference is not null,
    'settled',exists(select 1 from public.money_refunds where authorization_id=a.authorization_id));
end $$;

revoke all on function private.money_is_uuid(text),private.money_review_command(text,text,text,text),
  private.money_command_hash(jsonb),private.money_review_blocker(text,text),private.money_review_approver(uuid),
  private.money_require_text(text,text),private.money_require_key(text)
  from public,anon,authenticated,service_role;
revoke all on function public.money_operator_place_hold(uuid,text,text,text),
  public.money_operator_record_readback(uuid,bigint,text,text,text),
  public.money_operator_replay_event(text,text),
  public.money_operator_request_review(text,text,text,text,text),
  public.money_operator_approve_review(uuid,text),
  public.money_operator_execute_review(uuid),
  public.money_finance_operations(),
  public.money_refund_readback_target(uuid,uuid),
  public.money_record_refund_readback(uuid,uuid,text,text,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.money_operator_place_hold(uuid,text,text,text),
  public.money_operator_record_readback(uuid,bigint,text,text,text),
  public.money_operator_replay_event(text,text),
  public.money_operator_request_review(text,text,text,text,text),
  public.money_operator_approve_review(uuid,text),
  public.money_operator_execute_review(uuid),
  public.money_finance_operations()
  to authenticated;
grant execute on function public.money_refund_readback_target(uuid,uuid),
  public.money_record_refund_readback(uuid,uuid,text,text,bigint)
  to service_role;
