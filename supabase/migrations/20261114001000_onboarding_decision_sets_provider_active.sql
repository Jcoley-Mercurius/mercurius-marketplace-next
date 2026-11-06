-- TRACE-146, DEC-2026-061 (owner, 2026-11-05): the onboarding decision is the provider's activation.
--
-- DEC-2026-057 item 3 routes every provider activation and suspension through
-- vendor_decide_onboarding, and the forward fix 20261109001000 refuses every client write to
-- contractors.is_active. But vendor_decide_onboarding only changed vendor_onboarding.status and
-- granted the vendor role; it never wrote contractors.is_active. Everything a homeowner sees reads
-- that column (r0_provider_listable, find_eligible_packages_with_answers, resolve_package_tier_price,
-- get_completed_job_counts, the recurring-visit source check), so a provider activated after
-- 20261109001000 stayed off the platform with no path to list it (found 2026-11-05: one provider
-- activated 2026-11-04 stayed inactive; corrected the same day by an owner-authorized one-row update).
--
-- This restates vendor_decide_onboarding with one addition, in the same transaction as the decision:
--   activate (review or suspended -> active): contractors.is_active := true
--   suspend  (active -> suspended):           contractors.is_active := false
-- Reject and renew leave is_active unchanged. marketing_enabled is not touched; it remains the
-- operator's separate listing choice. Everything else in the function is unchanged (checklist,
-- revision, idempotent replay, evidence snapshot, role grant). No stored value is backfilled, no
-- table or grant changes, and no money function is changed.
--
-- The write runs as the function owner, so private.guard_contractor_operator_writes (which refuses
-- client writes only) allows it; enforce_contractor_update_scope bypasses operators.

CREATE OR REPLACE FUNCTION public.vendor_decide_onboarding(p_contractor uuid, p_expected_revision integer, p_action text, p_reason text, p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; v public.vendor_onboarding; prior public.vendor_onboarding_events; next_status text; ids uuid[];
begin
  actor:=public.vendor_require_operator();
  select * into strict v from public.vendor_onboarding where contractor_id=p_contractor for update;
  select * into prior from public.vendor_onboarding_events where business_key=p_key;
  if found then
    if prior.contractor_id<>p_contractor or prior.actor<>actor or prior.reason<>p_reason or prior.action<>p_action then raise exception 'Onboarding idempotency conflict'; end if;
    return prior.revision;
  end if;
  if v.revision<>p_expected_revision then raise exception 'Stale onboarding revision'; end if;
  if p_action='activate' and v.status in ('review','suspended') then
    if not public.vendor_evidence_current(p_contractor,now()) then raise exception 'Activation checklist incomplete or expired'; end if;
    next_status:='active';
  elsif p_action='suspend' and v.status='active' then next_status:='suspended';
  elsif p_action='reject' and v.status='review' then next_status:='rejected';
  elsif p_action='renew' and v.status in ('active','suspended') then
    if not public.vendor_evidence_current(p_contractor,now()) then raise exception 'Renewal checklist incomplete or expired'; end if;
    next_status:=v.status; -- Renewal does not silently lift an operator suspension.
  else raise exception 'Invalid onboarding transition'; end if;
  select coalesce(array_agg(e.id order by e.kind),'{}') into ids from public.vendor_compliance_evidence e where e.contractor_id=p_contractor
    and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key,evidence_ids)
    values(p_contractor,v.revision+1,p_action,v.status,next_status,actor,p_reason,p_key,ids);
  update public.vendor_onboarding set status=next_status,revision=revision+1 where contractor_id=p_contractor;
  -- Activation is where the MPS §8 checklist is enforced, so it is the only place
  -- the vendor role is granted. Suspension, renewal and rejection leave roles alone.
  if p_action='activate' then
    perform private.vendor_grant_activation_role(p_contractor,v.revision+1,p_key,actor);
  end if;
  -- DEC-2026-061: the decision is the provider's platform activation (DEC-2026-057 item 3).
  if p_action='activate' then
    update public.contractors set is_active=true where id=p_contractor and is_active is distinct from true;
  elsif p_action='suspend' then
    update public.contractors set is_active=false where id=p_contractor and is_active is distinct from false;
  end if;
  return v.revision+1;
end $function$;
