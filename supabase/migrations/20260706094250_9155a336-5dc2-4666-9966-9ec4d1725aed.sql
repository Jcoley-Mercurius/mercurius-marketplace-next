-- Admin-only: link a contractor record to an existing auth user by email
CREATE OR REPLACE FUNCTION public.admin_link_contractor_to_user(
  _contractor_id uuid,
  _email text
)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _existing_contractor_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can link vendor accounts';
  END IF;

  SELECT id INTO _uid
  FROM auth.users
  WHERE lower(auth.users.email) = lower(_email)
  LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user account found for %', _email;
  END IF;

  -- Prevent linking the same user to two different contractors
  SELECT c.id INTO _existing_contractor_id
  FROM public.contractors c
  WHERE c.user_id = _uid AND c.id <> _contractor_id
  LIMIT 1;

  IF _existing_contractor_id IS NOT NULL THEN
    RAISE EXCEPTION 'That account is already linked to another vendor';
  END IF;

  UPDATE public.contractors
     SET user_id = _uid, updated_at = now()
   WHERE id = _contractor_id;

  -- Ensure the account has the vendor role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'vendor')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN QUERY SELECT _uid, _email;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_link_contractor_to_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_link_contractor_to_user(uuid, text) TO authenticated;
-- Admin-only: unlink a contractor from its user account
CREATE OR REPLACE FUNCTION public.admin_unlink_contractor(_contractor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can unlink vendor accounts';
  END IF;

  UPDATE public.contractors
     SET user_id = NULL, updated_at = now()
   WHERE id = _contractor_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unlink_contractor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unlink_contractor(uuid) TO authenticated;
-- Admin-only: look up which email a contractor is currently linked to
CREATE OR REPLACE FUNCTION public.admin_get_contractor_linked_email(_contractor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _email text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can view linked vendor accounts';
  END IF;

  SELECT user_id INTO _uid FROM public.contractors WHERE id = _contractor_id;
  IF _uid IS NULL THEN RETURN NULL; END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  RETURN _email;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_contractor_linked_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_contractor_linked_email(uuid) TO authenticated;
