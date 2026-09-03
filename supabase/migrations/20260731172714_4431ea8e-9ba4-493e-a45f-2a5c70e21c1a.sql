DROP POLICY IF EXISTS "Anyone can submit vendor application" ON public.vendor_applications;
CREATE POLICY "Anyone can submit vendor application"
ON public.vendor_applications
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(business_name) BETWEEN 1 AND 200
  AND length(first_name) BETWEEN 1 AND 100
  AND length(coalesce(last_name, '')) <= 100
  AND length(email) BETWEEN 3 AND 255
  AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND length(phone) BETWEEN 7 AND 50
  AND length(coalesce(address, '')) <= 500
  AND years_experience BETWEEN 0 AND 100
  AND coalesce(array_length(services, 1), 0) BETWEEN 1 AND 50
  AND status = 'pending'
  AND invite_status = 'not_invited'
  AND contractor_id IS NULL
  AND invited_user_id IS NULL
  AND activated_at IS NULL
);
