-- TRACE-095 / P6-R1: submission requires the homeowner capability (Codex Phase 6.1 decision
-- review D3, 2026-09-27; MPS §4; MTS §6).
--
-- submit_service_requests checked only auth.uid(), so an authenticated identity without the
-- homeowner role (for example a vendor-only account whose default grant was removed) could
-- create an active request. Signup's default homeowner grant is provisioning, not an invariant.
--
-- Now the public command first requires an authenticated caller holding the homeowner role,
-- then runs the unchanged 6.1 body, moved to private.submit_service_requests_core. The check
-- precedes the stored-result replay, so a caller who has since lost the role cannot replay an
-- earlier submission either. Accounts that also hold vendor or admin keep working as
-- homeowners. Signature, grants, coverage, eligibility, pricing, replay and dispatch semantics
-- are unchanged. No caller other than the homeowner intake uses this command; operator and
-- trusted writers keep their separate paths. Nothing is backfilled; roles are not changed.

alter function public.submit_service_requests(text, jsonb) rename to submit_service_requests_core;
alter function public.submit_service_requests_core(text, jsonb) set schema private;
revoke all on function private.submit_service_requests_core(text, jsonb)
  from public, anon, authenticated, service_role;

create function public.submit_service_requests(p_submission_key text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.has_role(auth.uid(), 'homeowner') then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  return private.submit_service_requests_core(p_submission_key, p_payload);
end
$$;

revoke all on function public.submit_service_requests(text, jsonb) from public, anon;
grant execute on function public.submit_service_requests(text, jsonb) to authenticated;
comment on function public.submit_service_requests(text, jsonb) is
  'TRACE-095: the homeowner request write path. Requires the homeowner role; server-derived coverage, eligibility and price; all-or-nothing plans; key-bound replay.';
