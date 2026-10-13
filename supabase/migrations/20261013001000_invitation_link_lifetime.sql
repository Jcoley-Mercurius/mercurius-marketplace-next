-- DEC-2026-029 (owner, 2026-10-13): the provider invitation email link lasts 24 hours, not
-- 3 hours (supersedes the owner decision of 2026-09-13); 24 hours is the most hosted Auth
-- allows. The Auth setting itself is otp_expiry = 86400 (supabase/config.toml locally; the
-- hosted project's Auth email settings). This migration moves the two operator queues that
-- flag a lapsed email link from a hardcoded 3 hours to one shared lifetime. Each function
-- body is otherwise unchanged from migrations 20260929003000 and 20260930001000.

-- The Auth email link lifetime. Keep in step with otp_expiry and
-- AUTH_INVITATION_LINK_HOURS (src/lib/invitationLinkLifetime.ts).
create function private.provider_invitation_link_lifetime() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

revoke all on function private.provider_invitation_link_lifetime() from public, anon, authenticated, service_role;

-- The newest attempt per provider that needs an operator: an uncertain Auth result, a
-- definite refusal, an expiry without acceptance, or a provider-accepted invitation whose
-- 24-hour email link (DEC-2026-029) has lapsed without acceptance.
create or replace function public.r0_invitation_attention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.vendor_require_operator();
  with latest as (
    select distinct on (a.contractor_id) a.*
      from public.vendor_invitation_attempts a
     order by a.contractor_id, a.created_at desc, a.id desc
  ), classified as (
    select l.id, l.contractor_id, l.status, l.expires_at, l.created_at, d.state as dispatch_state,
           c.name as business_name, v.application_id, o.status as onboarding_status,
           case
             when l.status = 'unknown'
               or (l.status = 'submitted' and d.state = 'started' and d.started_at < now() - interval '10 minutes')
               then 'uncertain'
             when l.status = 'failed' then 'refused'
             when l.status in ('prepared', 'submitted') and l.expires_at <= now() then 'expired_unaccepted'
             when l.status = 'submitted' and d.state = 'provider_accepted'
               and d.resolved_at < now() - private.provider_invitation_link_lifetime() then 'link_lapsed'
           end as reason
      from latest l
      join public.contractors c on c.id = l.contractor_id
      join public.vendor_onboarding o on o.contractor_id = l.contractor_id
      join public.vendor_application_versions v on v.id = l.application_version_id
      left join public.vendor_invitation_dispatches d on d.attempt_id = l.id
     where o.status <> 'rejected'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'attempt_id', id, 'contractor_id', contractor_id, 'application_id', application_id,
      'business_name', business_name, 'attempt_status', status, 'dispatch_state', dispatch_state,
      'onboarding_status', onboarding_status, 'created_at', created_at, 'expires_at', expires_at,
      'reason', reason) order by created_at desc), '[]'::jsonb) into rows
  from classified where reason is not null;
  return jsonb_build_object('checked_at', now(), 'items', rows);
end $$;

-- Every access-managed provider, for the recruiting page. Includes attempts that need
-- attention: unknown, refused, lapsed Auth link (24 hours, DEC-2026-029) or operator expiry
-- without acceptance, and accepted receipts awaiting a reviewed binding.
create or replace function public.r0_provider_access_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.vendor_require_operator();
  select coalesce(jsonb_agg(item order by item->>'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'contractor_id', c.id, 'name', c.name, 'email', cur.email,
      'account_linked', c.user_id is not null,
      'bound_by_access', c.user_id is not null and b.action = 'bind' and b.auth_user_id = c.user_id,
      'attempt_id', a.id, 'mode', a.mode, 'status', a.status, 'expires_at', a.expires_at,
      'dispatch_state', d.state, 'dispatch_started_at', d.started_at,
      'accepted', r.attempt_id is not null,
      'attention', case
        when a.id is null then null
        when a.status = 'unknown' or d.state in ('started', 'unknown') then 'uncertain'
        when a.status = 'failed' then 'refused'
        when a.status = 'accepted' and not (c.user_id is not null and b.action = 'bind' and b.auth_user_id = c.user_id)
          then 'awaiting_binding'
        when a.status in ('prepared', 'submitted') and a.expires_at <= now() then 'expired'
        when a.status = 'submitted' and d.state = 'provider_accepted' and d.resolved_at < now() - private.provider_invitation_link_lifetime()
          then 'link_lapsed'
      end) as item
    from private.r0_provider_current_contacts cur
    join public.contractors c on c.id = cur.contractor_id
    left join lateral (select * from private.r0_provider_access_attempts x where x.contractor_id = c.id
      order by (x.status in ('prepared', 'submitted', 'unknown')) desc, x.created_at desc, x.id desc limit 1) a on true
    left join private.r0_provider_access_dispatches d on d.attempt_id = a.id
    left join private.r0_provider_access_acceptances r on r.attempt_id = a.id
    left join lateral (select * from private.r0_provider_access_bindings y where y.contractor_id = c.id
      order by y.sequence desc limit 1) b on true
  ) q;
  return jsonb_build_object('checked_at', now(), 'items', rows);
end $$;
