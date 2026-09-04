-- MPS 6.3: declining a quote is not cancellation. Do not invent quote expiry.
ALTER TABLE public.service_requests ADD COLUMN quote_declined_at timestamptz;

CREATE OR REPLACE FUNCTION public.homeowner_respond_to_quote(_job_id uuid,_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE j record; admin_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  SELECT * INTO j FROM public.service_requests WHERE id=_job_id FOR UPDATE;
  IF auth.uid() IS NULL OR j.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the homeowner can respond to this quote' USING ERRCODE='42501';
  END IF;
  IF _approve IS NULL OR j.status <> 'quoted' OR j.quote_declined_at IS NOT NULL OR j.quote_approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'There is no open quote on this job' USING ERRCODE='22023';
  END IF;
  IF _approve THEN
    UPDATE public.service_requests SET quote_approved_at=now() WHERE id=_job_id;
    PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),
      jsonb_build_object('action','quote_approved','from',j.status,'to',j.status,'lifecycle_version','phase4-v1'));
    -- Preserve a scheduled vendor acceptance; quote approval must not manufacture it.
    IF j.matching_status='matched' THEN
      PERFORM public.transition_job_status(_job_id,'scheduled',NULL,NULL);
    END IF;
  ELSE
    UPDATE public.service_requests SET quote_declined_at=now(),needs_admin_review=true,matching_status='quote_pending' WHERE id=_job_id;
    UPDATE public.job_match_attempts SET outcome='withdrawn',withdrawn_at=now(),responded_at=now(),reason='Homeowner declined quote' WHERE service_request_id=_job_id AND outcome='pending';
    PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),
      jsonb_build_object('action','quote_declined','from',j.status,'to',j.status,'lifecycle_version','phase4-v1'));
    FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role='admin' LOOP
      PERFORM public.notify_user(admin_id,'job_status','warning','Quote declined',
        'The homeowner declined the quote. Review the next step; the request has not been cancelled.',
        '/admin/requests',_job_id,j.contractor_id);
    END LOOP;
  END IF;
END;
$$;
