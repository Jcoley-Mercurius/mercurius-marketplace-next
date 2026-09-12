-- TRACE-066: operator readback for the provider invitation queue. Read-only.
-- No new write path, transport, role grant, contractor link or activation. The
-- TRACE-053/063 command functions remain the only way invitation state changes.
-- Facts only: every permission decision stays inside those commands, so this
-- readback cannot drift into a second, weaker copy of their predicates.
create function public.vendor_invitation_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.vendor_onboarding; c public.contractors; v public.vendor_application_versions;
 a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches; recipient text;
begin
 perform public.vendor_require_operator();
 select * into o from public.vendor_onboarding where contractor_id=p_contractor;
 if not found then raise exception 'Onboarding record not found'; end if;
 select * into strict c from public.contractors where id=p_contractor;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 -- The bound snapshot recipient, not the editable application row: this is the
 -- address a dispatch would actually use.
 recipient:=lower(btrim(v.application->>'email'));
 -- The current record is the live attempt when one exists, otherwise the newest
 -- closed one: an accepted or revoked attempt is evidence the operator must see,
 -- not history to bury. At most one attempt can be live.
 select * into a from public.vendor_invitation_attempts
  where contractor_id=p_contractor
  order by (status in ('prepared','submitted','unknown','delivered')) desc,created_at desc,id desc
  limit 1;
 select * into d from public.vendor_invitation_dispatches where attempt_id=a.id;
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',o.status,
  'onboarding_revision',o.revision,
  'application_id',v.application_id,
  'application_version_id',o.application_version_id,
  'version_current',not exists(select 1 from public.vendor_application_versions newer
    where newer.application_id=v.application_id and newer.revision>v.revision),
  'recipient_email',recipient,
  'recipient_valid',recipient is not null
    and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$',
  'account_linked',c.user_id is not null,
  'attempt',case when a.id is null then null else jsonb_build_object(
    'attempt_id',a.id,'status',a.status,'expires_at',a.expires_at,'created_at',a.created_at,
    'expired',a.expires_at<=now(),
    -- public.vendor_one_live_invitation permits one attempt in these statuses.
    'live',a.status in ('prepared','submitted','unknown','delivered'),
    'dispatch_state',d.state,'auth_user_id',d.auth_user_id,
    'accepted',exists(select 1 from public.vendor_invitation_acceptances where attempt_id=a.id)) end,
  'prior_attempts',(select coalesce(jsonb_agg(jsonb_build_object(
      'attempt_id',x.id,'status',x.status,'expires_at',x.expires_at,'created_at',x.created_at)
      order by x.created_at desc),'[]'::jsonb)
    from public.vendor_invitation_attempts x
    where x.contractor_id=p_contractor and x.id is distinct from a.id));
end $$;
revoke all on function public.vendor_invitation_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.vendor_invitation_overview(uuid) to authenticated;
