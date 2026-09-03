-- Restrict column-level access on contractors so email/phone are not exposed
-- via the "Anyone can view active contractors" SELECT policy.

REVOKE SELECT ON public.contractors FROM anon, authenticated;
GRANT SELECT (
  id, name, logo_url, bio, location, rating, badges, services,
  years_experience, jobs_completed, is_active, created_at, updated_at,
  user_id, marketing_enabled, special_offer, our_promise, verified_specialty,
  payouts_paused, payouts_paused_reason, payouts_paused_at,
  video_url, website, tagline
) ON public.contractors TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.contractors TO authenticated;
GRANT ALL ON public.contractors TO service_role;
-- Owner- or admin-only single contractor contact lookup
CREATE OR REPLACE FUNCTION public.get_contractor_contact(_contractor_id uuid)
RETURNS TABLE(email text, phone text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.contractors
      WHERE id = _contractor_id AND user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to view this contact info';
  END IF;

  RETURN QUERY
  SELECT c.email, c.phone
  FROM public.contractors c
  WHERE c.id = _contractor_id;
END;
$$;
-- Admin-only bulk lookup (used by admin vendor list/search)
CREATE OR REPLACE FUNCTION public.admin_list_contractor_contacts()
RETURNS TABLE(id uuid, email text, phone text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list vendor contacts';
  END IF;

  RETURN QUERY SELECT c.id, c.email, c.phone FROM public.contractors c;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contractor_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_contractor_contacts() TO authenticated;
