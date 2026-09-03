CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_code text;
BEGIN
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.profiles (user_id, full_name, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    new_code
  );

  -- SECURITY: always default new users to 'homeowner'. Never trust client-supplied role
  -- metadata from signup. Vendor/admin roles must be assigned server-side by an admin.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'homeowner');

  INSERT INTO public.loyalty_accounts (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
-- Lock down trigger function from direct API calls too
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
