-- 1. Column-level restriction on contractors: hide email/phone from anon + authenticated
REVOKE SELECT ON public.contractors FROM anon, authenticated;
GRANT SELECT (
  id, name, logo_url, bio, location, rating, badges, services,
  years_experience, jobs_completed, is_active, created_at, updated_at,
  user_id, marketing_enabled, special_offer, our_promise, verified_specialty,
  payouts_paused, payouts_paused_reason, payouts_paused_at,
  video_url, website, tagline
) ON public.contractors TO anon, authenticated;
GRANT SELECT ON public.contractors TO service_role;
-- 2. Internal trigger functions must not be directly callable via the API
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
-- Internal-only helpers should not be callable by clients either
REVOKE ALL ON FUNCTION public.award_points(uuid, integer, text, public.loyalty_source_type, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_job_event(uuid, public.job_event_type, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_status_rejection(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job_match(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_matches() FROM PUBLIC, anon, authenticated;
