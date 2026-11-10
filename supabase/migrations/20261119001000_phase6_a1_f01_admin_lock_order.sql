-- Phase 6 A1-F01 (TRACE-136): the admin status change takes the request's lifecycle advisory lock
-- before it locks the request row, the same order as start_job, cancellation and every other caller of
-- private.transition_job_status. Before this, the admin command locked the row and then waited for the
-- advisory lock inside the transition, so a lifecycle command already holding the advisory lock and
-- waiting for the row formed a cycle that PostgreSQL aborted with 40P01 (governance/PHASE-6-CODEX-A1-REVIEW.md §2).
--
-- Additive: restates only public.admin_transition_job_status_expected from 20261109001000. The single
-- change is the marked advisory-lock statement. Authorization (require_admin), key/version/reason
-- validation, actor-bound replay, the expected-version refusal, the transition guards and the
-- same-transaction history row are unchanged. Money functions are unchanged.

create or replace function public.admin_transition_job_status_expected(p_job uuid, p_expected_updated_at timestamptz, p_key uuid,
  p_to_status public.request_status, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_admin();
  reason text := btrim(coalesce(p_reason, ''));
  payload jsonb := jsonb_build_object('to_status', p_to_status, 'reason', reason,
    'expected_updated_at', private.version_text(p_expected_updated_at));
  r public.service_requests;
  prior jsonb;
  outcome public.request_status;
  result jsonb;
begin
  if p_key is null or p_expected_updated_at is null then raise exception 'Request key and version required' using errcode = '22023'; end if;
  if length(reason) = 0 then raise exception 'Enter the reason for the status change' using errcode = '22023'; end if;
  -- A1-F01: request advisory lock first, then the row (the lifecycle lock order).
  perform pg_advisory_xact_lock(hashtextextended(p_job::text, 0));
  select * into r from public.service_requests where id = p_job for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  prior := private.admin_request_action_replay(p_key, p_job, actor, 'status_change', payload);
  if prior is not null then return prior; end if;
  if r.updated_at <> p_expected_updated_at then
    raise exception 'This request changed since you opened it; review the current state' using errcode = '40001';
  end if;
  outcome := public.transition_job_status(p_job, p_to_status, reason, '{}'::jsonb);
  select jsonb_build_object('request_id', p_job, 'from_status', r.status, 'status', outcome, 'updated_at', s.updated_at, 'replayed', false)
    into result from public.service_requests s where s.id = p_job;
  insert into private.admin_request_actions(request_key, request_id, actor, action, payload, result, reason)
    values (p_key, p_job, actor, 'status_change', payload, result, reason);
  return result;
end $$;
