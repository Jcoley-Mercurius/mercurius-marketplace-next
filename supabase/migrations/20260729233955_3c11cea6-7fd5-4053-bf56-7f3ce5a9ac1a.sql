CREATE OR REPLACE FUNCTION public.enforce_contractor_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_cols text[] := ARRAY[
    'name','bio','location','phone','email','services','years_experience',
    'special_offer','our_promise','tagline','website','video_url','logo_url','updated_at'
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

  -- Only applies to the vendor who owns this contractor row
  IF auth.uid() IS NULL OR OLD.user_id IS NULL OR auth.uid() <> OLD.user_id THEN
    RETURN NEW;
  END IF;

  -- Ownership can never be changed by a vendor
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Vendors cannot change ownership of a provider profile'
      USING ERRCODE = '42501';
  END IF;

  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) AND NOT (k = ANY (allowed_cols)) THEN
      RAISE EXCEPTION 'Vendors are not allowed to modify "%" on a provider profile', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_contractor_update_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_contractor_update_scope ON public.contractors;
CREATE TRIGGER trg_enforce_contractor_update_scope
BEFORE UPDATE ON public.contractors
FOR EACH ROW EXECUTE FUNCTION public.enforce_contractor_update_scope();
