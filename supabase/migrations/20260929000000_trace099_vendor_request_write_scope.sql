-- TRACE-099: make the vendor request write scope effective (Phase 6 slice 6.3; MPS §4/§6.2;
-- MTS §4/§6).
--
-- Before this migration public.enforce_vendor_update_scope was SECURITY DEFINER. Inside a
-- definer function current_user is the owner, so its "current_user <> 'authenticated'" early
-- return always fired and the vendor allowlist never ran. Any vendor whose contractor was on
-- the request -- including one holding only a pending, unaccepted offer, since an offer sets
-- contractor_id -- could rewrite the homeowner's address, city, state, ZIP, description,
-- preferred date/time and notes through a direct REST update (guard_direct_status_writes
-- leaves those columns to the scope triggers). No application path writes the request
-- directly as a vendor; accept, decline, start and complete all use SECURITY DEFINER RPCs.
--
-- Now the function runs as the caller, like enforce_homeowner_update_scope, so a direct
-- update by the authenticated role is checked while updates made inside definer RPCs are
-- not. A vendor may not write the request directly until they have accepted it
-- (matching_status 'matched'); after that the original allowlist applies unchanged. The
-- contractor lookup relies on the existing "Vendors can view own contractor record" policy.
--
-- Additive and forward-only: the trigger, the RLS policies and every RPC are unchanged; only
-- this function's body and security mode are replaced. Recovery is a forward migration.

CREATE OR REPLACE FUNCTION public.enforce_vendor_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
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
  -- Only direct writes by the API role are checked; definer RPCs run as their owner.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.contractors c
    WHERE c.id = OLD.contractor_id AND c.user_id = auth.uid()
  ) INTO is_vendor;

  IF NOT is_vendor OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- An offer is not an assignment: nothing may be written before acceptance.
  IF OLD.matching_status IS DISTINCT FROM 'matched' THEN
    RAISE EXCEPTION 'Accept the offer before changing this request'
      USING ERRCODE = '42501';
  END IF;

  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) AND NOT (k = ANY (allowed_cols)) THEN
      RAISE EXCEPTION 'Vendors are not allowed to modify "%" on a service request', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (NEW.status::text = ANY (allowed_status)) THEN
    RAISE EXCEPTION 'Vendors cannot set job status to "%"', NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
