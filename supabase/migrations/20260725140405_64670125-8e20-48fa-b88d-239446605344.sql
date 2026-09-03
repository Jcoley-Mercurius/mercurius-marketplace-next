REVOKE ALL PRIVILEGES ON public.contractors FROM anon, authenticated;
GRANT SELECT (
  id,
  name,
  logo_url,
  bio,
  location,
  rating,
  badges,
  services,
  years_experience,
  jobs_completed,
  is_active,
  created_at,
  updated_at,
  user_id,
  marketing_enabled,
  special_offer,
  our_promise,
  verified_specialty,
  payouts_paused,
  payouts_paused_reason,
  payouts_paused_at,
  video_url,
  website,
  tagline
) ON public.contractors TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.contractors TO authenticated;
GRANT ALL ON public.contractors TO service_role;
