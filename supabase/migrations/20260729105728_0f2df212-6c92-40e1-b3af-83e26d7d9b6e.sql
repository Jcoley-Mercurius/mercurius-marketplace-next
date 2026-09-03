CREATE OR REPLACE FUNCTION public.job_transition_allowed(_from request_status, _to request_status)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _from
    WHEN 'pending'             THEN _to IN ('matched','quoted','scheduled','in_progress','cancelled')
    WHEN 'quoted'              THEN _to IN ('scheduled','matched','pending','in_progress','cancelled')
    WHEN 'matched'             THEN _to IN ('scheduled','quoted','pending','in_progress','cancelled')
    WHEN 'scheduled'           THEN _to IN ('in_progress','quoted','pending','cancelled')
    WHEN 'in_progress'         THEN _to IN ('pending_review','vendor_completed','pending','cancelled')
    WHEN 'pending_review'      THEN _to IN ('vendor_completed','in_progress','cancelled')
    WHEN 'vendor_completed'    THEN _to IN ('homeowner_confirmed','disputed','in_progress')
    WHEN 'homeowner_confirmed' THEN _to IN ('completed','disputed')
    WHEN 'completed'           THEN _to IN ('review_requested','reviewed','closed','disputed')
    WHEN 'review_requested'    THEN _to IN ('reviewed','closed','disputed')
    WHEN 'reviewed'            THEN _to IN ('closed','disputed')
    WHEN 'disputed'            THEN _to IN ('resolved','in_progress')
    WHEN 'resolved'            THEN _to IN ('completed','closed')
    WHEN 'cancelled'           THEN false
    WHEN 'closed'              THEN false
    ELSE false
  END
$$;
-- Confirmation automatically closes the job out (payment release + loyalty points)
CREATE OR REPLACE FUNCTION public.auto_complete_after_confirmation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'homeowner_confirmed' AND OLD.status IS DISTINCT FROM 'homeowner_confirmed' THEN
    PERFORM public.transition_job_status(NEW.id, 'completed'::request_status,
      'Auto-completed on homeowner confirmation', jsonb_build_object('source', 'state_machine'));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.auto_complete_after_confirmation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_auto_complete_after_confirmation ON public.service_requests;
CREATE TRIGGER trg_auto_complete_after_confirmation
  AFTER UPDATE OF status ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.auto_complete_after_confirmation();
