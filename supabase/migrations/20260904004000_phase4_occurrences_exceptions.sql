-- Separate visits; one-visit cancellation; policy assessment without money movement.
ALTER TABLE public.service_requests ADD COLUMN recurrence_parent_id uuid REFERENCES public.service_requests(id),
  ADD COLUMN occurrence_key uuid,
  ADD COLUMN scheduled_start_at timestamptz;
CREATE UNIQUE INDEX unique_recurring_occurrence ON public.service_requests(recurrence_parent_id,occurrence_key) WHERE recurrence_parent_id IS NOT NULL;
CREATE TABLE public.job_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.service_requests(id),
  operation_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  kind text NOT NULL,
  reason text NOT NULL,
  before_value jsonb NOT NULL,
  policy_assessment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,operation_key)
);
ALTER TABLE public.job_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.job_operations TO authenticated;
GRANT ALL ON public.job_operations TO service_role;
CREATE POLICY "Job participants read operations" ON public.job_operations FOR SELECT TO authenticated USING
  (EXISTS(SELECT 1 FROM public.service_requests r WHERE r.id=job_id AND
    (r.customer_id=auth.uid() OR public.has_role(auth.uid(),'admin') OR EXISTS(SELECT 1 FROM public.contractors c WHERE c.id=r.contractor_id AND c.user_id=auth.uid()))));

CREATE FUNCTION public.create_service_occurrence(_template_id uuid,_occurrence_key uuid,_scheduled_at timestamptz,_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests; existing public.service_requests; new_id uuid;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF _occurrence_key IS NULL OR _scheduled_at IS NULL OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Occurrence, appointment and reason required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_template_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_template_id FOR UPDATE;
  IF r.id IS NULL OR r.frequency IS NULL OR r.frequency='one-time' THEN RAISE EXCEPTION 'Recurring template required' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM public.service_requests WHERE recurrence_parent_id=r.id AND occurrence_key=_occurrence_key;
  IF existing.id IS NOT NULL THEN
    IF existing.scheduled_start_at IS DISTINCT FROM _scheduled_at THEN RAISE EXCEPTION 'Occurrence key reused with different appointment' USING ERRCODE='22023'; END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO public.service_requests(customer_id,service_type,service_catalog_id,address,city,state,zip_code,
    description,frequency,preferred_contractor_id,recurrence_parent_id,occurrence_key,scheduled_start_at,preferred_date,timezone)
    VALUES(r.customer_id,r.service_type,r.service_catalog_id,r.address,r.city,r.state,r.zip_code,
      r.description,r.frequency,r.contractor_id,r.id,_occurrence_key,_scheduled_at,(_scheduled_at AT TIME ZONE 'America/New_York')::date,'America/New_York') RETURNING id INTO new_id;
  PERFORM public.log_job_event(new_id,'status_changed',auth.uid(),jsonb_build_object('action','occurrence_created','template_id',r.id,'reason',btrim(_reason),'scheduled_at',_scheduled_at));
  -- Each visit must receive its own provider acceptance and completion evidence.
  IF NOT EXISTS(SELECT 1 FROM private.find_eligible_packages_core(new_id)) THEN
    RAISE EXCEPTION 'Not available yet in your area' USING ERRCODE='22023';
  END IF;
  PERFORM private.offer_next_for_request_internal(new_id);
  RETURN new_id;
END;
$$;

CREATE FUNCTION public.record_job_operation(_job_id uuid,_operation_key uuid,_kind text,_reason text,
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
  IF _waived AND NOT is_admin THEN RAISE EXCEPTION 'Only operations may accept an exception' USING ERRCODE='42501'; END IF;
  IF (_kind='appointment' AND NOT is_admin) OR (_kind='customer_cancel' AND NOT (is_owner OR is_admin))
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
  IF _kind='appointment' THEN
    IF _scheduled_at IS NULL OR _scheduled_at<=now() OR r.status='in_progress' THEN RAISE EXCEPTION 'Future appointment required before work starts' USING ERRCODE='22023'; END IF;
    UPDATE public.service_requests SET scheduled_start_at=_scheduled_at,preferred_date=(_scheduled_at AT TIME ZONE 'America/New_York')::date,timezone='America/New_York' WHERE id=r.id;
  ELSIF _kind='customer_cancel' THEN
    PERFORM public.transition_job_status(r.id,'cancelled',btrim(_reason),jsonb_build_object('operation_key',_operation_key,'policy_assessment',assessment));
  ELSIF _kind='provider_cancel' OR (_kind='no_show' AND is_admin) THEN
    UPDATE public.job_match_attempts SET outcome='withdrawn',withdrawn_at=now(),reason=btrim(_reason) WHERE service_request_id=r.id AND outcome='pending';
    UPDATE public.service_requests SET contractor_id=NULL,status='pending',matching_status='awaiting_match',assigned_at=NULL,match_expires_at=NULL WHERE id=r.id;
    next_offer:=private.offer_next_for_request_internal(r.id);
  END IF;
  IF _kind NOT IN ('appointment','customer_cancel') THEN
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
REVOKE ALL ON FUNCTION public.create_service_occurrence(uuid,uuid,timestamptz,text),public.record_job_operation(uuid,uuid,text,text,timestamptz,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_service_occurrence(uuid,uuid,timestamptz,text),public.record_job_operation(uuid,uuid,text,text,timestamptz,boolean) TO authenticated;
