CREATE OR REPLACE FUNCTION public.set_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.contractor_id IS NOT NULL AND OLD.contractor_id IS DISTINCT FROM NEW.contractor_id THEN
    NEW.assigned_at = now();
    NEW.match_attempt_count = COALESCE(OLD.match_attempt_count, 0) + 1;
    NEW.match_expires_at = now() + interval '24 hours';
  END IF;

  IF NEW.contractor_id IS NULL THEN
    NEW.assigned_at = NULL;
    NEW.match_expires_at = NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'matched' THEN
    NEW.match_expires_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;
