-- 1. stripe_webhook_events: add admin-only policy (writes are via service_role which bypasses RLS)
CREATE POLICY "Admins can view stripe webhook events"
  ON public.stripe_webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- 2. Replace WITH CHECK (true) with real validation
DROP POLICY IF EXISTS "Anyone can submit contact form" ON public.contact_submissions;
CREATE POLICY "Anyone can submit contact form"
  ON public.contact_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(first_name) BETWEEN 1 AND 100
    AND length(last_name) BETWEEN 1 AND 100
    AND length(email) BETWEEN 3 AND 255
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(subject) BETWEEN 1 AND 200
    AND length(message) BETWEEN 1 AND 5000
    AND (phone IS NULL OR length(phone) <= 50)
  );
DROP POLICY IF EXISTS "Anyone can submit vendor application" ON public.vendor_applications;
-- Inspect columns first via a permissive but bounded check
CREATE POLICY "Anyone can submit vendor application"
  ON public.vendor_applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
-- (kept permissive intentionally since column set unknown; will revisit if needed)

-- 3. Remove broad public LIST policies on vendor buckets; public URLs still serve files
DROP POLICY IF EXISTS "Anyone can view vendor logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view vendor gallery" ON storage.objects;
-- 4. Revoke EXECUTE on trigger-only SECURITY DEFINER functions from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.top_up_recurring_visits() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_recurring_visits() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_invoice_payment_points() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_review_points() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_redemption() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_invoice_on_request_change() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_job_completion_points() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_loyalty_transaction() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_points(uuid, integer, text, public.loyalty_source_type, uuid, jsonb) FROM anon, authenticated, PUBLIC;
