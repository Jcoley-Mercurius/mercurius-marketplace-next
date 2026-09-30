-- TRACE-103 / DEC-2026-022: the signed-in homeowner's own R0 trial admission, read-only.
-- R0.1 (TRACE-101) keeps admissions private and gives the account no readback, so the
-- waiting, invited and closed account states had nothing authoritative to show. This
-- command returns only the caller's own cells: service, ZIP and a derived state. It
-- exposes no operator identity, reason or other homeowner, and it grants nothing; the
-- request and checkout commands still decide admission themselves.
--
-- state: 'active'      admitted, and the Lee ZIP, coverage and service are all active;
--        'unavailable' admitted, but the area or service is no longer active;
--        'revoked'     admission was revoked (history is kept; no new transactions).
create function public.r0_my_trial_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'homeowner', public.has_role(actor, 'homeowner'),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
          'zip_code', a.zip_code,
          'service_id', a.service_id,
          'service_name', s.name,
          'state', case
            when not a.is_active then 'revoked'
            when l.zip_code is null or not c.is_active or not s.is_active then 'unavailable'
            else 'active' end,
          'changed_at', coalesce(a.revoked_at, a.granted_at))
        order by a.zip_code, s.name)
      from private.r0_trial_admissions a
      join public.services_catalog s on s.id = a.service_id
      join public.coverage_areas c on c.zip_code = a.zip_code
      left join private.r0_lee_zips l on l.zip_code = a.zip_code
      where a.homeowner_id = actor), '[]'::jsonb));
end $$;
revoke all on function public.r0_my_trial_access() from public, anon, service_role;
grant execute on function public.r0_my_trial_access() to authenticated;
