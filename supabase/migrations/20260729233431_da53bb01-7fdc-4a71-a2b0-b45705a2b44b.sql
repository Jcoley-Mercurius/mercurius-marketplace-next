CREATE OR REPLACE FUNCTION public.enforce_homeowner_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_cols text[] := ARRAY[
    'description','preferred_date','preferred_time','address','city','state','zip_code','notes','updated_at'
  ];
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb := to_jsonb(NEW);
  k text;
BEGIN
  -- Bypass unless the invoking PostgREST role is authenticated.
  IF current_setting('role', true) <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- Bypass for admins
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Only applies to the homeowner who owns the job
  IF auth.uid() IS NULL OR auth.uid() <> OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending'::public.request_status THEN
    PERFORM public.log_status_rejection(NEW.id, OLD.status::text, NEW.status::text,
      'homeowner_edit_after_pending', NULL);
    RAISE EXCEPTION 'This request can no longer be edited directly'
      USING ERRCODE = '42501';
  END IF;

  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) AND NOT (k = ANY (allowed_cols)) THEN
      RAISE EXCEPTION 'Homeowners are not allowed to modify "%" on a service request', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_homeowner_update_scope ON public.service_requests;
CREATE TRIGGER trg_enforce_homeowner_update_scope
BEFORE UPDATE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_homeowner_update_scope();
DROP POLICY IF EXISTS "Customers can dispute own completed jobs" ON public.service_requests;
DROP POLICY IF EXISTS "Customers can respond to quotes" ON public.service_requests;
DROP POLICY IF EXISTS "Customers can confirm pending_review requests" ON public.service_requests;
DROP POLICY IF EXISTS "Customers can update own pending requests" ON public.service_requests;
CREATE POLICY "Customers can update own pending requests"
ON public.service_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = customer_id AND status = 'pending'::public.request_status)
WITH CHECK (auth.uid() = customer_id AND status = 'pending'::public.request_status);
