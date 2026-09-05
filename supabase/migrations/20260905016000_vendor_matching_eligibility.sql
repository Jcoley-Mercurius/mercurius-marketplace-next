-- TRACE-060: matching and acceptance must consume the current private
-- onboarding/compliance decision, not public profile claims or legacy activation
-- alone. Keep the Phase 4 ranking implementation intact behind this gate.
alter function private.find_eligible_packages_core(uuid,text,text,text,uuid)
  rename to find_eligible_packages_without_onboarding;

revoke all on function private.find_eligible_packages_without_onboarding(uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;

create function private.vendor_matching_eligible(_contractor_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  -- Existing providers cannot be declared unapproved merely because their private
  -- evidence has not yet been migrated. Once onboarding exists, it is authoritative.
  select case
    when exists (
      select 1 from public.vendor_onboarding onboarding
      where onboarding.contractor_id=_contractor_id
    ) then public.vendor_is_eligible(_contractor_id)
    else exists (
      select 1 from public.contractors contractor
      where contractor.id=_contractor_id and contractor.is_active is true
    )
  end
$$;

revoke all on function private.vendor_matching_eligible(uuid)
  from public,anon,authenticated,service_role;

create function private.find_eligible_packages_core(
  _request_id uuid default null,
  _service_id text default null,
  _frequency text default null,
  _zip_code text default null,
  _preferred_contractor_id uuid default null
)
returns table (
  contractor_id uuid,
  contractor_name text,
  package_id uuid,
  package_tier_id uuid,
  promotion_id uuid,
  frequency text,
  path text,
  base_price numeric,
  effective_price numeric,
  median_fixed_price numeric,
  fixed_score numeric,
  profile_score numeric,
  verification_score numeric,
  price_band_score numeric,
  response_score numeric,
  freshness_score numeric,
  total_score numeric,
  preferred boolean,
  score_breakdown jsonb,
  rank_order integer
)
language sql
stable
security definer
set search_path=''
as $$
  select candidate.*
  from private.find_eligible_packages_without_onboarding(
    _request_id,
    _service_id,
    _frequency,
    _zip_code,
    _preferred_contractor_id
  ) candidate
  where private.vendor_matching_eligible(candidate.contractor_id)
$$;

revoke all on function private.find_eligible_packages_core(uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
