ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS primary_category text,
  ADD COLUMN IF NOT EXISTS team_size text,
  ADD COLUMN IF NOT EXISTS business_description text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS preferred_contact text,
  ADD COLUMN IF NOT EXISTS credentials text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS other_certification text,
  ADD COLUMN IF NOT EXISTS additional_notes text;
ALTER TABLE public.vendor_applications ALTER COLUMN address DROP NOT NULL;
ALTER TABLE public.vendor_applications ALTER COLUMN address SET DEFAULT '';
CREATE OR REPLACE FUNCTION public.notify_admins_new_vendor_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE admin_id uuid;
BEGIN
  FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.notify_user(
      admin_id, 'vendor_application', 'warning',
      'New vendor application',
      NEW.business_name || ' applied' ||
        CASE WHEN NEW.primary_category IS NOT NULL THEN ' (' || NEW.primary_category || ')' ELSE '' END ||
        '. Review and send a login invite.',
      '/admin/applications', NULL, NULL);
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_admins_new_vendor_application ON public.vendor_applications;
CREATE TRIGGER trg_notify_admins_new_vendor_application
AFTER INSERT ON public.vendor_applications
FOR EACH ROW EXECUTE FUNCTION public.notify_admins_new_vendor_application();
