-- Guard: restrict which columns an assigned vendor may change on service_requests.
-- Native RLS cannot restrict per-column, so we use a BEFORE UPDATE trigger that
-- diffs OLD vs NEW. Admins, service_role, and SECURITY DEFINER functions bypass.
CREATE OR REPLACE FUNCTION public.enforce_vendor_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_vendor boolean;
  allowed_cols text[] := ARRAY[
    'notes',
    'photo_proof_urls',
    'status',
    'vendor_completed_at',
    'updated_at'
  ];
  allowed_status text[] := ARRAY[
    'scheduled', 'in_progress', 'pending_review', 'vendor_completed'
  ];
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb := to_jsonb(NEW);
  k text;
BEGIN
  -- Bypass for service_role / superuser / SECURITY DEFINER platform functions
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- Bypass for admins
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Only applies to the assigned vendor acting on their own job
  SELECT EXISTS (
    SELECT 1 FROM public.contractors c
    WHERE c.id = NEW.contractor_id AND c.user_id = auth.uid()
  ) INTO is_vendor;

  IF NOT is_vendor OR auth.uid() = NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Reject any change outside the allowlist
  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) AND NOT (k = ANY (allowed_cols)) THEN
      RAISE EXCEPTION 'Vendors are not allowed to modify "%" on a service request', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- Restrict which status values a vendor may set
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (NEW.status::text = ANY (allowed_status)) THEN
    RAISE EXCEPTION 'Vendors cannot set job status to "%"', NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_vendor_update_scope ON public.service_requests;
CREATE TRIGGER trg_enforce_vendor_update_scope
BEFORE UPDATE ON public.service_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_vendor_update_scope();
-- Defense in depth: vendor UPDATE policy had no WITH CHECK, so a vendor could
-- also reassign the job away from themselves. Re-create it scoped both ways.
DROP POLICY IF EXISTS "Vendors can update assigned requests" ON public.service_requests;
CREATE POLICY "Vendors can update assigned requests"
ON public.service_requests
FOR UPDATE
TO authenticated
USING (
  contractor_id IN (SELECT c.id FROM public.contractors c WHERE c.user_id = auth.uid())
)
WITH CHECK (
  contractor_id IN (SELECT c.id FROM public.contractors c WHERE c.user_id = auth.uid())
);
