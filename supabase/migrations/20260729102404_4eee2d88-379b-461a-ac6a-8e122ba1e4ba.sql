-- 1. Contractor PII: remove phone/email from publicly selectable columns
REVOKE SELECT ON public.contractors FROM anon, authenticated;
GRANT SELECT (
  id, name, logo_url, bio, location, rating, badges, services,
  years_experience, jobs_completed, is_active, created_at, updated_at,
  user_id, marketing_enabled, special_offer, our_promise, verified_specialty,
  payouts_paused, payouts_paused_reason, payouts_paused_at, video_url, website, tagline
) ON public.contractors TO anon, authenticated;
GRANT ALL ON public.contractors TO service_role;
-- 2. Reviews: internal-only reviews must not be public
DROP POLICY IF EXISTS "Anyone can view reviews" ON public.reviews;
CREATE POLICY "Public can view shareable reviews"
ON public.reviews FOR SELECT TO anon, authenticated
USING (visibility = 'eligible_for_google'::public.review_visibility);
CREATE POLICY "Participants can view own reviews"
ON public.reviews FOR SELECT TO authenticated
USING (
  customer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.id = reviews.contractor_id AND c.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);
-- 3. SECURITY DEFINER functions: revoke blanket EXECUTE, re-grant only user-facing RPCs
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contractor_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_confirm_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_raise_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job_review(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_google_prompt(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_complete_job(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_contractor_linked_email(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_contractor_to_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlink_contractor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_contractor_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, public.dispute_status, text) TO authenticated;
-- 4. Storage: vendor gallery ownership must bind to the object path
DROP POLICY IF EXISTS "Vendors can delete own gallery" ON storage.objects;
DROP POLICY IF EXISTS "Vendors can upload own gallery" ON storage.objects;
CREATE POLICY "Vendors can delete own gallery"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-gallery'
  AND (
    EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.user_id = auth.uid()
        AND c.id::text = (storage.foldername(storage.objects.name))[1]
    )
    OR public.has_role(auth.uid(), 'admin')
  )
);
CREATE POLICY "Vendors can upload own gallery"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vendor-gallery'
  AND (
    EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.user_id = auth.uid()
        AND c.id::text = (storage.foldername(storage.objects.name))[1]
    )
    OR public.has_role(auth.uid(), 'admin')
  )
);
