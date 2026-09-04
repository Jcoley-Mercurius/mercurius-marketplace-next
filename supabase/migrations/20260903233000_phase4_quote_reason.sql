-- TRACE-012. Quote expiry remains unset; four hours is the vendor offer window.
DROP FUNCTION public.admin_send_quote(uuid, numeric);
CREATE OR REPLACE FUNCTION public.admin_send_quote(_job_id uuid, _amount numeric, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can send quotes';
  END IF;
  IF NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Quote reason required' USING ERRCODE = '22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Quote amount must be greater than zero'; END IF;

  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  UPDATE public.service_requests
     SET total_amount = _amount,
         quote_amount = _amount,
         updated_at = now()
   WHERE id = _job_id;

  PERFORM public.transition_job_status(_job_id, 'quoted'::request_status, _reason,
    jsonb_build_object('quote_amount', _amount));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_send_quote(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_quote(uuid, numeric, text) TO authenticated;
