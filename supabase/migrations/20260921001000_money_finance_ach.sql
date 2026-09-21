-- TRACE-078: finance operator commands, part 2B: weekly ACH preparation, bank outcomes and retry
-- (MPS §§5.5/6.5/7; CFG-008; TRACE-054/055/075/076/077).
--
-- The owner sends weekly ACH from Mercurius's bank. The database records permission and evidence,
-- never a transfer. This gateway gives signed-in finance operators the three ACH kernels, which are
-- called unchanged:
--  * preparing a weekly batch (money_prepare_ach) is a reviewed request. The requester names the
--    week, payouts, bank batch reference and reason, and the stored command is byte for byte the
--    object the kernel hashes. The request also records each payout's amount, payee and bank
--    authorization and goes stale if any of them changes, so the approver approves exact money;
--  * a bank outcome (money_record_ach) is recorded by one operator, as the kernel allows.
--    Recording the submission re-proves the payout is payable at its statement amount; later
--    outcomes reuse the reference recorded at submission;
--  * retrying a failed or returned transfer (money_retry_ach) is a reviewed request bound to the
--    failed attempt. The kernel command names only the item, so without that binding an approval
--    could carry over to a later failure of the same payout.
-- TRACE-077's 24-hour window and request-bound approvals apply. Bank transaction references are
-- returned to operators only as their last four characters.

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry'));
alter table public.money_review_requests drop constraint money_review_requests_evidence_shape;
alter table public.money_review_requests add constraint money_review_requests_evidence_shape
  check ((operation in ('reconciliation_resolution','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry'))=(evidence is null));
-- What an ACH batch request pays: each payout's amount, payee and bank authorization when requested.
alter table public.money_review_requests add column terms jsonb;
alter table public.money_review_requests add constraint money_review_requests_terms_shape
  check (case when operation='ach_preparation' then coalesce(jsonb_typeof(terms)='array',false) else terms is null end);

-- The exact objects money_prepare_ach and money_retry_ach hash.
create function private.money_ach_command(p_period date,p_obligations uuid[],p_bank_ref text,p_reason text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('operation','ach','period',p_period,'obligations',p_obligations,'bank_ref',p_bank_ref,'reason',p_reason)
$$;
create function private.money_ach_retry_command(p_item uuid)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','ach_retry','item',p_item)
$$;

-- What ACH preparation would pay for one obligation now, or why it would refuse. Mirrors
-- public.money_payable and private.money_payable without writing completion evidence, then the
-- kernel's bank authorization lookup. The kernels still decide at execution.
create function private.money_ach_payable(p_obligation uuid)
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
  select array_agg(e.id order by e.id) into banks from public.vendor_compliance_evidence e
    where e.contractor_id=payee and e.kind='bank_authorization'
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  return jsonb_build_object('blocker',null,'amount',payable,'payee',payee,
    'bank_evidence',case when cardinality(banks)=1 then banks[1] end,'bank_count',coalesce(cardinality(banks),0),
    'eligible_at',c.confirmed_at+interval '48 hours');
end $$;

-- Why one payout of a batch request cannot be prepared now: it is already on a statement, it is
-- not payable, or its amount, payee or bank authorization differs from what was requested.
create function private.money_ach_term_blocker(p_term jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare p jsonb;
begin
  if exists(select 1 from public.money_ach_items where obligation_id=(p_term->>'obligation')::uuid) then return 'on_ach_statement'; end if;
  p:=private.money_ach_payable((p_term->>'obligation')::uuid);
  if p->>'blocker' is not null then return p->>'blocker'; end if;
  -- The kernel's strict lookup refuses a payee with more than one current bank authorization.
  if (p->>'bank_count')::integer<>1 then return 'bank_authorization_ambiguous'; end if;
  if (p->>'amount')::bigint is distinct from (p_term->>'amount')::bigint then return 'payable_changed'; end if;
  if p->>'payee' is distinct from p_term->>'payee' then return 'payee_changed'; end if;
  if p->>'bank_evidence' is distinct from p_term->>'bank_evidence' then return 'bank_authorization_changed'; end if;
  return null;
end $$;

create function private.money_ach_preparation_blocker(p_period date,p_terms jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare term jsonb; blocker text;
begin
  if exists(select 1 from public.money_ach_batches b
    where daterange(b.period_start,b.period_end,'[)') && daterange(p_period,p_period+7,'[)')) then
    return 'period_taken';
  end if;
  for term in select t from jsonb_array_elements(p_terms) t loop
    blocker:=private.money_ach_term_blocker(term);
    if blocker is not null then return blocker; end if;
  end loop;
  return null;
end $$;

-- Why a payout already on a statement cannot be sent now. Mirrors money_record_ach's submission
-- checks: still payable, at the statement amount, to the bank authorization it was prepared with.
create function private.money_ach_item_blocker(p_item uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare i public.money_ach_items; p jsonb;
begin
  select * into i from public.money_ach_items where id=p_item;
  if not found then return 'not_found'; end if;
  p:=private.money_ach_payable(i.obligation_id);
  if p->>'blocker' is not null then return p->>'blocker'; end if;
  if (p->>'amount')::bigint<>i.amount then return 'statement_stale'; end if;
  if exists(select 1 from public.vendor_compliance_evidence where supersedes=i.bank_evidence_id) then return 'bank_authorization_changed'; end if;
  return null;
end $$;

-- Why this bank outcome cannot be recorded now. Mirrors money_record_ach.
create function private.money_ach_record_blocker(p_attempt uuid,p_status text,p_bank_ref text)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_ach_attempts;
begin
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
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

-- Why this failed attempt cannot be retried now. Mirrors money_retry_ach, and also refuses a
-- retry the bank authorization check would stop at submission: a prepared attempt cannot be
-- withdrawn, so it would hold the payout with no way forward.
create function private.money_ach_retry_blocker(p_attempt uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare a public.money_ach_attempts;
begin
  select * into a from public.money_ach_attempts where id=p_attempt;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_ach_attempts x where x.item_id=a.item_id and x.attempt_number>a.attempt_number) then return 'completed'; end if;
  if a.status not in ('failed','returned') then return 'bank_outcome_open'; end if;
  if not exists(select 1 from public.money_ach_events e where e.attempt_id=a.id and e.status=a.status) then return 'failure_evidence_missing'; end if;
  return private.money_ach_item_blocker(a.item_id);
end $$;

-- Why a stored request cannot run now, or null when it can. ACH requests also read their terms.
create function private.money_request_blocker(p_operation text,p_subject text,p_command jsonb,p_terms jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if p_operation='ach_preparation' then
    return private.money_ach_preparation_blocker(p_subject::date,p_terms);
  elsif p_operation='ach_retry' then
    return private.money_ach_retry_blocker(p_subject::uuid);
  end if;
  return private.money_command_blocker(p_operation,p_subject,p_command);
end $$;

-- Stores a new request with its terms, or replays one with the same key.
create function private.money_store_review_request(p_actor uuid,p_key text,p_operation text,p_subject text,
  p_obligation uuid,p_command jsonb,p_reason text,p_evidence text,p_replay_compares_command boolean,p_terms jsonb)
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
  blocker:=case when p_command is null then 'not_eligible' else private.money_request_blocker(p_operation,p_subject,p_command,p_terms) end;
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  insert into public.money_review_requests(business_key,operation,subject,obligation_id,command,command_hash,requested_by,reason,evidence,terms)
    values(p_key,p_operation,p_subject,p_obligation,p_command,private.money_command_hash(p_command),p_actor,p_reason,p_evidence,p_terms)
    returning * into q;
  return jsonb_build_object('request_id',q.id,'replay',false);
end $$;

-- The TRACE-077 entry point keeps its signature for the requests that carry no terms.
create or replace function private.money_store_review_request(p_actor uuid,p_key text,p_operation text,p_subject text,
  p_obligation uuid,p_command jsonb,p_reason text,p_evidence text,p_replay_compares_command boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return private.money_store_review_request(p_actor,p_key,p_operation,p_subject,p_obligation,p_command,p_reason,p_evidence,p_replay_compares_command,null::jsonb);
end $$;

-- A weekly ACH batch: the week it covers, the payouts in it, the bank's reference for the batch and
-- a reason. The payouts are sorted and de-duplicated before the command is built.
create function public.money_operator_request_ach(p_period date,p_obligations uuid[],p_bank_ref text,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); payouts uuid[]; bank_ref text; reason text; terms jsonb;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  if p_bank_ref is null or length(trim(p_bank_ref))=0 or length(p_bank_ref)>200 then
    raise exception 'Bank batch reference of up to 200 characters required' using errcode='22023';
  end if;
  if p_period is null then raise exception 'Weekly period start required' using errcode='22023'; end if;
  if p_obligations is null or cardinality(p_obligations) not between 1 and 500 or array_position(p_obligations,null) is not null then
    raise exception 'Between 1 and 500 payouts required' using errcode='22023';
  end if;
  payouts:=array(select distinct x from unnest(p_obligations) x order by x);
  if (select count(*) from public.money_obligations where id=any(payouts))<>cardinality(payouts) then
    raise exception 'Finance obligation not found' using errcode='P0002';
  end if;
  bank_ref:=btrim(p_bank_ref); reason:=btrim(p_reason);
  select jsonb_agg(jsonb_build_object('obligation',x.id,'amount',(y.p->>'amount')::bigint,'payee',y.p->>'payee',
      'bank_evidence',y.p->>'bank_evidence') order by x.id)
    into terms from unnest(payouts) x(id) cross join lateral (select private.money_ach_payable(x.id) p) y;
  return private.money_store_review_request(actor,p_key,'ach_preparation',to_char(p_period,'YYYY-MM-DD'),null,
    private.money_ach_command(p_period,payouts,bank_ref,reason),reason,null,true,terms);
end $$;

-- A new attempt for one failed or returned transfer. The request names the failed attempt.
create function public.money_operator_request_ach_retry(p_attempt uuid,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); i public.money_ach_items; reason text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  select item.* into i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id where attempt.id=p_attempt;
  if not found then raise exception 'Bank attempt not found' using errcode='P0002'; end if;
  reason:=btrim(p_reason);
  return private.money_store_review_request(actor,p_key,'ach_retry',p_attempt::text,i.obligation_id,
    private.money_ach_retry_command(i.id),reason,null,true,null::jsonb);
end $$;

-- One operator records what the bank shows for a transfer. The submission is the eligibility
-- check to record immediately before sending at the bank; if it is refused, nothing is sent.
-- Later outcomes reuse the submission's reference when none is entered.
create function public.money_operator_record_ach(p_attempt uuid,p_status text,p_bank_ref text,p_evidence text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); i public.money_ach_items; a public.money_ach_attempts; prior public.money_ach_events;
  event_key text; reference text; blocker text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_evidence,'Evidence');
  if p_status is null or p_status not in ('submitted','unknown','settled','failed','returned') then
    raise exception 'Bank outcome required' using errcode='22023';
  end if;
  if p_bank_ref is not null and (length(trim(p_bank_ref))=0 or length(p_bank_ref)>200) then
    raise exception 'Bank reference of up to 200 characters required' using errcode='22023';
  end if;
  select item.* into i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id where attempt.id=p_attempt;
  if not found then raise exception 'Bank attempt not found' using errcode='P0002'; end if;
  -- The kernel's order: lifecycle, provider onboarding, obligation, attempt.
  perform private.money_lock_lifecycle(array[i.obligation_id]);
  perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
  perform 1 from public.money_obligations where id=i.obligation_id for update;
  select * into strict a from public.money_ach_attempts where id=p_attempt for update;
  event_key:='finance-ach:'||p_key;
  select * into prior from public.money_ach_events where business_key=event_key;
  if found then
    if prior.attempt_id<>a.id or prior.status<>p_status or prior.actor<>actor or prior.evidence<>p_evidence
      or (p_bank_ref is not null and btrim(p_bank_ref) is distinct from a.bank_reference) then
      raise exception 'Bank outcome idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('attempt_id',a.id,'status',a.status,'replay',true);
  end if;
  reference:=coalesce(btrim(p_bank_ref),a.bank_reference);
  blocker:=private.money_ach_record_blocker(a.id,p_status,reference);
  if blocker is not null then raise exception 'Bank outcome not recordable: %',blocker using errcode='55000'; end if;
  perform public.money_record_ach(a.id,p_status,reference,actor,p_evidence,event_key);
  return jsonb_build_object('attempt_id',a.id,'status',p_status,'replay',false);
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
  blocker:=private.money_request_blocker(q.operation,q.subject,q.command,q.terms);
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
  elsif q.operation='ach_retry' then
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
  else
    raise exception 'Unsupported finance review' using errcode='22023';
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;

-- The ACH part of the operator readback: payouts ready for a batch, and recent or unfinished
-- batches with each payout's latest bank attempt.
create function private.money_ach_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'next_period_start',(select to_char(max(period_end),'YYYY-MM-DD') from public.money_ach_batches),
    'ready',coalesce((select jsonb_agg(r.item order by r.eligible_at,r.id) from (
      select o.id,(y.p->>'eligible_at')::timestamptz eligible_at,jsonb_build_object(
        'obligation_id',o.id,'invoice_number',s.invoice_number,
        'payee_id',y.p->>'payee','payee_name',(select c.name from public.contractors c where c.id=(y.p->>'payee')::uuid),
        'amount',(y.p->>'amount')::bigint,'eligible_at',y.p->>'eligible_at',
        'blocker',case when (y.p->>'bank_count')::integer<>1 then 'bank_authorization_ambiguous' end,
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='ach_preparation'
          and q.terms @> jsonb_build_array(jsonb_build_object('obligation',o.id))
          and now()<private.money_review_expires_at(q.created_at)
          and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1)) item
      from public.money_obligations o
      left join public.money_snapshots s on s.id=o.current_snapshot_id
      cross join lateral (select private.money_ach_payable(o.id) p) y
      where not exists(select 1 from public.money_ach_items i where i.obligation_id=o.id) and y.p->>'blocker' is null
      order by 2,o.id limit 500) r),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(b.item order by b.period_start desc) from (
      select x.period_start,jsonb_build_object(
        'batch_id',x.id,'period_start',to_char(x.period_start,'YYYY-MM-DD'),'period_end',to_char(x.period_end,'YYYY-MM-DD'),
        'created_by_me',x.created_by=p_me,'approved_by_me',x.approved_by=p_me,'created_at',x.created_at,
        'total',(select sum(i.amount) from public.money_ach_items i where i.batch_id=x.id),
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
          where i.batch_id=x.id and a.status<>'settled')
      order by x.period_start desc limit 50) b),'[]'::jsonb))
$$;

-- What an ACH request asks for, so the approver sees the exact payouts and amounts.
create function private.money_ach_request_details(p_request public.money_review_requests,p_live boolean)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_request.operation='ach_preparation' then jsonb_build_object(
      'period_start',p_request.subject,'period_end',to_char(p_request.subject::date+7,'YYYY-MM-DD'),
      'bank_ref',p_request.command->>'bank_ref',
      'total',(select sum((t->>'amount')::bigint) from jsonb_array_elements(p_request.terms) t),
      'items',(select jsonb_agg(jsonb_build_object(
          'obligation_id',t->>'obligation','amount',(t->>'amount')::bigint,
          'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=(t->>'obligation')::uuid),
          'payee_name',(select c.name from public.contractors c where c.id=(t->>'payee')::uuid),
          'blocker',case when p_live then private.money_ach_term_blocker(t) end) order by e.n)
        from jsonb_array_elements(p_request.terms) with ordinality e(t,n)))
    when p_request.operation='ach_retry' then (select jsonb_build_object(
      'item_id',i.id,'attempt_number',a.attempt_number,'status',a.status,'amount',i.amount,
      'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id),
      'period_start',to_char(b.period_start,'YYYY-MM-DD'))
      from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id join public.money_ach_batches b on b.id=i.batch_id
      where a.id=p_request.subject::uuid) end
$$;

-- Operator readback for the commands. Reasons, evidence and amounts are returned because an
-- approver must see exactly what they approve; bank transaction references only as a hint, and
-- no customer identities.
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
          when q.operation in ('ach_preparation','ach_retry') then private.money_ach_request_details(q,l.live) end,
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

revoke all on function private.money_ach_command(date,uuid[],text,text),
  private.money_ach_retry_command(uuid),
  private.money_ach_payable(uuid),
  private.money_ach_term_blocker(jsonb),
  private.money_ach_preparation_blocker(date,jsonb),
  private.money_ach_item_blocker(uuid),
  private.money_ach_record_blocker(uuid,text,text),
  private.money_ach_retry_blocker(uuid),
  private.money_request_blocker(text,text,jsonb,jsonb),
  private.money_store_review_request(uuid,text,text,text,uuid,jsonb,text,text,boolean,jsonb),
  private.money_ach_operations(uuid),
  private.money_ach_request_details(public.money_review_requests,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.money_operator_request_ach(date,uuid[],text,text,text),
  public.money_operator_request_ach_retry(uuid,text,text),
  public.money_operator_record_ach(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.money_operator_request_ach(date,uuid[],text,text,text),
  public.money_operator_request_ach_retry(uuid,text,text),
  public.money_operator_record_ach(uuid,text,text,text,text)
  to authenticated;
