-- TRACE-101: repair only unambiguous legacy admission cells before checkout.
-- Never rewrite requests already bound to financial history. Those require
-- source reconciliation; unresolved rows remain readable but cannot check out.
update public.service_requests r
set service_catalog_id = p.service_id
from public.vendor_packages p
join public.services_catalog s on s.id = p.service_id
where r.package_id = p.id and r.service_catalog_id is null
  and not exists (select 1 from public.money_obligations o
    where o.service_request_id = r.id);

-- Existing visits can inherit missing keys only from the same customer's
-- matching template. Do not guess a ZIP from a city or a provider's coverage.
update public.service_requests r
set zip_code = coalesce(r.zip_code, t.zip_code),
    service_catalog_id = coalesce(r.service_catalog_id, t.service_catalog_id)
from public.service_requests t
where r.recurrence_parent_id = t.id
  and t.recurrence_parent_id is null and t.occurrence_key is null
  and t.frequency is not null and t.frequency <> 'one-time'
  and r.customer_id = t.customer_id and r.frequency = t.frequency
  and r.service_type = t.service_type and r.address = t.address
  and r.city = t.city and r.state = t.state
  and t.zip_code is not null and t.service_catalog_id is not null
  and exists (select 1 from public.coverage_areas a where a.zip_code = t.zip_code)
  and exists (select 1 from public.services_catalog s where s.id = t.service_catalog_id)
  and (r.zip_code is null or r.zip_code = t.zip_code)
  and (r.service_catalog_id is null or r.service_catalog_id = t.service_catalog_id)
  and (r.zip_code is null or r.service_catalog_id is null)
  and not exists (select 1 from public.money_obligations o
    where o.service_request_id = r.id);

-- Required values are enforced at the checkout boundary, allowing incomplete
-- historical requests to remain intact without granting them transactional access.
create or replace function public.money_prepare_checkout(p_snapshot uuid,p_mode text)
returns public.money_checkout_attempts
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); source_request public.service_requests;
begin
  if actor is null then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  select r.* into source_request
    from public.money_snapshots s
    join public.money_obligations o on o.id = s.obligation_id
    join public.service_requests r on r.id = o.service_request_id
    where s.id = p_snapshot and o.customer_id = actor;
  if not found then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  if source_request.zip_code is null or source_request.service_catalog_id is null then
    raise exception 'Request ZIP and catalog service required for checkout'
      using errcode = '22023';
  end if;
  if not private.r0_trial_admitted(
      actor, source_request.zip_code, source_request.service_catalog_id) then
    raise exception 'Trial invitation required for checkout'
      using errcode = '42501';
  end if;
  return private.money_checkout_source_guarded(p_snapshot,p_mode);
end $$;
revoke all on function public.money_prepare_checkout(uuid,text)
  from public, anon, service_role;
grant execute on function public.money_prepare_checkout(uuid,text)
  to authenticated;
