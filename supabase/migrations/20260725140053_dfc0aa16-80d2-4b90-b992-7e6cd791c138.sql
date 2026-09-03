-- Restore Data API access to contractors (email/phone stay protected via column grants)
GRANT SELECT (id, name, logo_url, bio, location, rating, badges, services, years_experience, jobs_completed, is_active, created_at, updated_at, user_id, marketing_enabled, special_offer, our_promise, verified_specialty, payouts_paused, payouts_paused_reason, payouts_paused_at, video_url, website, tagline) ON public.contractors TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.contractors TO authenticated;
GRANT ALL ON public.contractors TO service_role;
-- Admins need to see inactive vendors too
DROP POLICY IF EXISTS "Admins can view all contractors" ON public.contractors;
CREATE POLICY "Admins can view all contractors"
ON public.contractors FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
