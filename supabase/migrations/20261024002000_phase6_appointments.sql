-- Phase 6.5 / TRACE-121: one-time appointments in Eastern Time with preserved schedule history.
-- DEC-2026-007: provider acceptance schedules the job; the appointment time is independent and
-- recorded by operations with a reason (Phase 4 state table). Nothing here confirms on behalf of
-- the homeowner or provider (MPS checklist E1 stays open), changes CFG-006/007 assessments,
-- moves money, generates recurring visits or delivers anything outside the app.

-- Deterministic order for schedule history; created_at is the transaction time and can tie.
alter table public.job_operations add column seq bigint generated always as identity;
create index job_operations_job_seq on public.job_operations(job_id, seq);

-- Operations records, changes or keeps the appointment of an accepted one-time job.
-- _local_start is the Eastern wall time the operator saw; the instant must match it exactly, so a
-- device timezone or a nonexistent spring-forward time can never shift the appointment silently.
-- _expected_start is the appointment the operator loaded (null for none); a different current
-- value is a stale read. A retried key with the same intent returns the recorded result.
-- The trailing defaults only keep the generated client types honest; a null reason is refused.
create function public.admin_record_appointment(_job_id uuid, _operation_key uuid, _starts_at timestamptz,
  _local_start timestamp, _expected_start timestamptz default null, _reason text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; prior public.job_operations; open_request public.job_operations;
  outcome text; result jsonb; op_id uuid; label text; title text; recipient uuid;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _job_id is null or _operation_key is null or _starts_at is null or _local_start is null
    or nullif(btrim(_reason), '') is null then
    raise exception 'Appointment, Eastern time, operation key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;

  select * into prior from public.job_operations where job_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if prior.kind <> 'appointment' or prior.actor_id <> auth.uid() or prior.reason <> btrim(_reason)
      or (prior.policy_assessment ->> 'new_start')::timestamptz is distinct from _starts_at
      or (prior.before_value ->> 'scheduled_start_at')::timestamptz is distinct from _expected_start then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return prior.policy_assessment || jsonb_build_object('operation_id', prior.id, 'replayed', true);
  end if;

  if r.status <> 'scheduled' or r.contractor_id is null then
    raise exception 'An appointment can be recorded only after a provider accepts and before work starts' using errcode = '22023';
  end if;
  if r.frequency is not null and r.frequency <> 'one-time' then
    raise exception 'Recurring visits are scheduled separately' using errcode = '22023';
  end if;
  if r.scheduled_start_at is distinct from _expected_start then
    raise exception 'The appointment changed since you loaded it' using errcode = '40001';
  end if;
  if date_trunc('minute', _starts_at) <> _starts_at
    or (_starts_at at time zone 'America/New_York') <> _local_start then
    raise exception 'The appointment does not match the Eastern Time entered' using errcode = '22023';
  end if;
  if _starts_at <= now() then raise exception 'Choose a future appointment time' using errcode = '22023'; end if;

  select j.* into open_request from public.job_operations j
    where j.job_id = r.id and j.kind = 'reschedule_request'
      and not exists (select 1 from public.job_operations a where a.job_id = r.id and a.kind = 'appointment' and a.seq > j.seq)
    order by j.seq desc limit 1;
  if _starts_at = r.scheduled_start_at then
    if open_request.id is null then raise exception 'This appointment is already recorded' using errcode = '22023'; end if;
    outcome := 'kept';
  elsif r.scheduled_start_at is null then outcome := 'recorded';
  else outcome := 'changed';
  end if;

  result := jsonb_build_object('policy', 'CFG-006/007', 'waived', false, 'money_action', 'none', 'requires_operations', false,
    'outcome', outcome, 'previous_start', r.scheduled_start_at, 'new_start', _starts_at, 'local_start', _local_start,
    'timezone', 'America/New_York', 'answers_request', open_request.id);
  insert into public.job_operations(job_id, operation_key, actor_id, kind, reason, before_value, policy_assessment)
    values (r.id, _operation_key, auth.uid(), 'appointment', btrim(_reason),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at), result)
    returning id into op_id;
  -- preferred_date/preferred_time stay the homeowner's request; the appointment is its own field.
  if outcome <> 'kept' then
    update public.service_requests set scheduled_start_at = _starts_at, timezone = 'America/New_York' where id = r.id;
  end if;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'appointment',
    'outcome', outcome, 'operation_key', _operation_key, 'reason', btrim(_reason),
    'previous_start', r.scheduled_start_at, 'new_start', _starts_at));

  label := to_char(_local_start, 'Dy, Mon FMDD, YYYY, FMHH12:MI AM') || ' '
    || case when _local_start - (_starts_at at time zone 'UTC') = interval '-4 hours' then 'EDT' else 'EST' end;
  title := case outcome when 'recorded' then 'Appointment recorded' when 'changed' then 'Appointment changed'
    else 'Appointment unchanged' end;
  for recipient in select r.customer_id union select user_id from public.contractors where id = r.contractor_id loop
    if recipient is not null then
      perform public.notify_user(recipient, 'job_status', 'info', title, label || ' (Eastern Time). ' || btrim(_reason),
        '/notifications', r.id, r.contractor_id);
    end if;
  end loop;
  return result || jsonb_build_object('operation_id', op_id, 'replayed', false);
end;
$$;

-- Participant readback: the current appointment, any open reschedule request and history,
-- with actors as roles. Missing and foreign jobs refuse alike.
create function public.job_schedule(_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; vendor_user uuid; history jsonb; open_request jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _job_id;
  select user_id into vendor_user from public.contractors where id = r.contractor_id;
  -- coalesce: a job without a provider has a null vendor_user, which must not skip the refusal.
  if r.id is null or not coalesce(public.has_role(auth.uid(), 'admin') or r.customer_id = auth.uid()
    or vendor_user = auth.uid(), false) then
    raise exception 'Not a participant in this service' using errcode = '42501';
  end if;
  with ops as (
    select j.*, case when j.actor_id = r.customer_id then 'homeowner'
        when coalesce(public.has_role(j.actor_id, 'admin'), false) then 'operations'
        when j.actor_id = vendor_user then 'provider' else 'previous_provider' end as actor_role
      from public.job_operations j where j.job_id = r.id and j.kind in ('appointment', 'reschedule_request')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind,
      'outcome', case when o.kind = 'reschedule_request' then 'requested'
        else coalesce(o.policy_assessment ->> 'outcome',
          case when o.before_value -> 'scheduled_start_at' = 'null'::jsonb then 'recorded' else 'changed' end) end,
      'actor', o.actor_role, 'at', o.created_at, 'reason', o.reason,
      'previous_start', o.before_value -> 'scheduled_start_at',
      'new_start', case when o.kind = 'appointment' then o.policy_assessment -> 'new_start' end,
      'requested_start', case when o.kind = 'reschedule_request' then o.policy_assessment -> 'new_start' end,
      'operation_key', case when o.actor_id = auth.uid() then o.operation_key end
    ) order by o.seq), '[]'::jsonb),
    (select jsonb_build_object('id', q.id, 'actor', q.actor_role, 'at', q.created_at, 'reason', q.reason,
        'requested_start', q.policy_assessment -> 'new_start')
      from ops q where q.kind = 'reschedule_request'
        and not exists (select 1 from ops a where a.kind = 'appointment' and a.seq > q.seq)
      order by q.seq desc limit 1)
    into history, open_request from ops o;
  return jsonb_build_object('timezone', 'America/New_York', 'status', r.status, 'matching_status', r.matching_status,
    'has_provider', r.contractor_id is not null, 'recurring', coalesce(r.frequency, 'one-time') <> 'one-time',
    'appointment', r.scheduled_start_at, 'open_request', open_request, 'history', history);
end;
$$;

revoke all on function public.admin_record_appointment(uuid, uuid, timestamptz, timestamp, timestamptz, text),
  public.job_schedule(uuid) from public, anon;
grant execute on function public.admin_record_appointment(uuid, uuid, timestamptz, timestamp, timestamptz, text),
  public.job_schedule(uuid) to authenticated;

-- Restated from 20260904004000 (its only definition) with one change: the generic 'appointment'
-- kind is retired in favour of admin_record_appointment, which verifies the Eastern wall time,
-- refuses stale reads and keeps the homeowner's preferred date. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.record_job_operation(_job_id uuid,_operation_key uuid,_kind text,_reason text,
  _scheduled_at timestamptz DEFAULT NULL,_waived boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests; prior public.job_operations; is_admin boolean; is_owner boolean; is_vendor boolean;
  hours numeric; assessment jsonb; next_offer uuid; recipient uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_job_id FOR UPDATE;
  is_admin:=COALESCE(public.has_role(auth.uid(),'admin'),false);
  is_owner:=r.customer_id=auth.uid();
  is_vendor:=EXISTS(SELECT 1 FROM public.contractors WHERE id=r.contractor_id AND user_id=auth.uid());
  IF NOT (is_admin OR COALESCE(is_owner,false) OR is_vendor) THEN RAISE EXCEPTION 'Not a participant in this service' USING ERRCODE='42501'; END IF;
  IF _waived IS NULL OR _operation_key IS NULL OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Operation key and reason required' USING ERRCODE='22023'; END IF;
  IF _kind NOT IN ('appointment','customer_cancel','reschedule_request','provider_cancel','no_show','partial_completion','customer_unavailable','unable_to_complete') THEN RAISE EXCEPTION 'Unknown job operation' USING ERRCODE='22023'; END IF;
  IF _kind='appointment' THEN RAISE EXCEPTION 'Record appointments with admin_record_appointment' USING ERRCODE='22023'; END IF;
  IF _waived AND NOT is_admin THEN RAISE EXCEPTION 'Only operations may accept an exception' USING ERRCODE='42501'; END IF;
  IF (_kind='customer_cancel' AND NOT (is_owner OR is_admin))
    OR (_kind IN ('provider_cancel','partial_completion','customer_unavailable','unable_to_complete') AND NOT (is_vendor OR is_admin)) THEN RAISE EXCEPTION 'Actor cannot perform this operation' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM public.job_operations WHERE job_id=r.id AND operation_key=_operation_key;
  IF prior.id IS NOT NULL THEN
    IF (prior.policy_assessment->>'waived')::boolean IS DISTINCT FROM _waived OR prior.actor_id<>auth.uid() OR prior.kind<>_kind OR prior.reason<>btrim(_reason) OR (prior.policy_assessment->>'new_start')::timestamptz IS DISTINCT FROM _scheduled_at THEN RAISE EXCEPTION 'Operation key reused with different intent' USING ERRCODE='22023'; END IF;
    RETURN prior.policy_assessment;
  END IF;
  IF r.status NOT IN ('pending','matched','quoted','scheduled','in_progress') THEN RAISE EXCEPTION 'Service no longer accepts this operation' USING ERRCODE='22023'; END IF;
  IF _kind='reschedule_request' AND (_scheduled_at IS NULL OR _scheduled_at<=now()) THEN RAISE EXCEPTION 'Proposed future appointment required' USING ERRCODE='22023'; END IF;
  hours:=extract(epoch FROM (r.scheduled_start_at-now()))/3600;
  assessment:=jsonb_build_object('policy','CFG-006/007','waived',_waived,'new_start',_scheduled_at,'money_action','none','requires_operations',r.scheduled_start_at IS NULL);
  IF _kind='customer_cancel' THEN
    assessment:=assessment||jsonb_build_object('refund_percent',CASE WHEN _waived THEN 100 WHEN hours IS NULL THEN NULL WHEN hours>=72 THEN 100 WHEN hours>=24 THEN 50 ELSE 0 END);
  ELSIF _kind='reschedule_request' THEN
    assessment:=assessment||jsonb_build_object('fee',CASE WHEN _waived OR hours>=48 THEN 0 WHEN hours>=24 THEN 25 ELSE NULL END,'requires_operations',true);
  ELSIF _kind IN ('provider_cancel','no_show') THEN
    assessment:=assessment||jsonb_build_object('next_action','rematch_first','refund_if_no_acceptable_replacement',100,'quality_event',NOT _waived,'requires_operations',true);
  END IF;
  INSERT INTO public.job_operations(job_id,operation_key,actor_id,kind,reason,before_value,policy_assessment)
    VALUES(r.id,_operation_key,auth.uid(),_kind,btrim(_reason),jsonb_build_object('status',r.status,'contractor_id',r.contractor_id,'scheduled_start_at',r.scheduled_start_at),assessment);
  IF _kind='customer_cancel' THEN
    PERFORM public.transition_job_status(r.id,'cancelled',btrim(_reason),jsonb_build_object('operation_key',_operation_key,'policy_assessment',assessment));
  ELSIF _kind='provider_cancel' OR (_kind='no_show' AND is_admin) THEN
    UPDATE public.job_match_attempts SET outcome='withdrawn',withdrawn_at=now(),reason=btrim(_reason) WHERE service_request_id=r.id AND outcome='pending';
    UPDATE public.service_requests SET contractor_id=NULL,status='pending',matching_status='awaiting_match',assigned_at=NULL,match_expires_at=NULL WHERE id=r.id;
    next_offer:=private.offer_next_for_request_internal(r.id);
  END IF;
  IF _kind<>'customer_cancel' THEN
    UPDATE public.service_requests SET needs_admin_review=true WHERE id=r.id;
    INSERT INTO public.support_tickets(user_id,subject,description,issue_type,job_id,next_action)
      VALUES(r.customer_id,'Service operation: '||replace(_kind,'_',' '),btrim(_reason),'schedule_exception',r.id::text,
        CASE WHEN _kind IN ('provider_cancel','no_show') THEN 'Find an acceptable replacement; assess full refund if none is available' ELSE 'Review evidence, policy and proposed next step' END);
  END IF;
  PERFORM public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object('action',_kind,'operation_key',_operation_key,'reason',btrim(_reason),'assessment',assessment));
  FOR recipient IN SELECT r.customer_id UNION SELECT user_id FROM public.contractors WHERE id=r.contractor_id UNION SELECT user_id FROM public.user_roles WHERE role='admin' LOOP
    IF recipient IS NOT NULL THEN PERFORM public.notify_user(recipient,'job_status','info','Service update',replace(_kind,'_',' ')||': '||btrim(_reason),'/notifications',r.id,r.contractor_id); END IF;
  END LOOP;
  RETURN assessment;
END;
$$;
