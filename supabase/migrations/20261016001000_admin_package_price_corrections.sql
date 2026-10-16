-- TRACE-109: an operator sets or corrects a vendor's package prices with a reason
-- (owner decision 2026-10-15, DEC-2026-034; MPS §4 "Configure provider offerings:
-- supervised" and "Approve price/quote: send/correct with reason").
--
-- Before this, an operator could change prices only by writing package tables directly
-- (managed-template packages from the vendor page), with no reason or history, and could
-- not edit a vendor's custom packages at all. The guardrail queue could approve or pause a
-- flagged package but not correct its price.
--
-- admin_correct_package_prices changes only prices (tier prices, add-on prices and the
-- quote deposit) of one package, all or nothing, against the package's updated_at read by
-- the operator; each submitted price also carries the value the operator saw ('from'), so a
-- vendor edit in between refuses the correction instead of being overwritten. Name, cadence, mode, tiers offered and active state are unchanged. Each
-- correction records the old and new values, the reason and the operator, and notifies
-- the linked vendor account. The vendor reads what changed and why, never who.
--
-- Review flag: a custom fixed package is re-evaluated by the existing guardrail triggers
-- (20260809200000). A managed-template package is re-evaluated here against its template
-- ranges, as the vendor editor does. A correction is not an approval: a price still outside
-- the band stays in the Package Reviews queue.
--
-- Existing commercial snapshots, quotes and requests keep their agreed price.

create table private.vendor_package_price_corrections (
  id bigint generated always as identity primary key,
  package_id uuid not null,
  contractor_id uuid not null,
  package_name text not null,
  changes jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) > 0),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  actor uuid not null,
  created_at timestamptz not null default now()
);
create index vendor_package_price_corrections_contractor_idx
  on private.vendor_package_price_corrections(contractor_id, created_at desc);
alter table private.vendor_package_price_corrections enable row level security;
revoke all on private.vendor_package_price_corrections from public, anon, authenticated, service_role;

-- Whole-cent positive amount, or null when the value is not one.
create function private.price_amount(p_value jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare amount numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then return null; end if;
  amount := p_value::text::numeric;
  if amount <= 0 or amount > 1000000 or amount <> round(amount, 2) then return null; end if;
  return amount;
end $$;

-- Managed-template guardrail, mirroring ManagedPricingEditor: any tier or offered add-on
-- outside its template range flags the package.
create function private.template_package_price_needs_review(p_package uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.package_tiers t
        join public.pricing_template_tiers tt on tt.id = t.template_tier_id
       where t.package_id = p_package and (t.price < tt.min_price or t.price > tt.max_price))
    or exists (
      select 1 from public.package_addons a
        join public.pricing_template_addons ta on ta.id = a.template_addon_id
       where a.package_id = p_package and a.is_offered
         and (a.price < ta.price_min or a.price > ta.price_max))
$$;

create function public.admin_correct_package_prices(
  p_package uuid, p_expected_updated_at timestamptz, p_prices jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  reason text := btrim(coalesce(p_reason, ''));
  pkg public.vendor_packages;
  vendor_user uuid;
  entry jsonb;
  item_id uuid;
  amount numeric;
  old_amount numeric;
  item_name text;
  item_frequency text;
  seen uuid[] := '{}';
  changes jsonb := '[]'::jsonb;
  review boolean;
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Price correction reason required'; end if;
  if length(reason) > 500 then raise exception 'Price correction reason too long'; end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'object' then raise exception 'Price changes required'; end if;

  select * into pkg from public.vendor_packages where id = p_package for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or pkg.updated_at <> p_expected_updated_at then
    raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
  end if;

  for entry in select value from jsonb_array_elements(coalesce(p_prices->'tiers', '[]'::jsonb)) loop
    item_id := (entry->>'id')::uuid;
    if item_id = any(seen) then raise exception 'Each price may be changed once per correction'; end if;
    seen := seen || item_id;
    amount := private.price_amount(entry->'price');
    if amount is null then raise exception 'Each price must be a positive amount in whole cents'; end if;
    select t.price, t.name, t.frequency into old_amount, item_name, item_frequency
      from public.package_tiers t where t.id = item_id and t.package_id = p_package for update;
    if not found then raise exception 'Tier does not belong to this package'; end if;
    if (entry->>'from')::numeric is distinct from old_amount then
      raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
    end if;
    if old_amount <> amount then
      update public.package_tiers set price = amount where id = item_id;
      changes := changes || jsonb_build_object('kind', 'tier', 'id', item_id, 'name', item_name,
        'frequency', item_frequency, 'from', old_amount, 'to', amount);
    end if;
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(p_prices->'addons', '[]'::jsonb)) loop
    item_id := (entry->>'id')::uuid;
    if item_id = any(seen) then raise exception 'Each price may be changed once per correction'; end if;
    seen := seen || item_id;
    amount := private.price_amount(entry->'price');
    if amount is null then raise exception 'Each price must be a positive amount in whole cents'; end if;
    select a.price, coalesce(nullif(btrim(a.name), ''), ta.label, 'Add-on') into old_amount, item_name
      from public.package_addons a left join public.pricing_template_addons ta on ta.id = a.template_addon_id
     where a.id = item_id and a.package_id = p_package for update of a;
    if not found then raise exception 'Add-on does not belong to this package'; end if;
    if (entry->>'from')::numeric is distinct from old_amount then
      raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
    end if;
    if old_amount <> amount then
      update public.package_addons set price = amount where id = item_id;
      changes := changes || jsonb_build_object('kind', 'addon', 'id', item_id, 'name', item_name,
        'from', old_amount, 'to', amount);
    end if;
  end loop;

  if p_prices ? 'deposit' then
    if pkg.pricing_mode <> 'deposit_quote' then raise exception 'Only a quote + deposit package has a deposit'; end if;
    amount := private.price_amount(p_prices->'deposit');
    if amount is null then raise exception 'The deposit must be a positive amount in whole cents'; end if;
    if (p_prices->>'deposit_from')::numeric is distinct from pkg.deposit_amount then
      raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
    end if;
    if pkg.deposit_amount is distinct from amount then
      changes := changes || jsonb_build_object('kind', 'deposit', 'name', 'Deposit',
        'from', pkg.deposit_amount, 'to', amount);
      update public.vendor_packages set deposit_amount = amount where id = p_package;
    end if;
  end if;

  if jsonb_array_length(changes) = 0 then raise exception 'No price changed'; end if;

  if pkg.template_id is not null then
    update public.vendor_packages
       set needs_review = private.template_package_price_needs_review(p_package)
     where id = p_package;
  end if;
  update public.vendor_packages set updated_at = now() where id = p_package
    returning needs_review into review;

  insert into private.vendor_package_price_corrections(package_id, contractor_id, package_name, changes, reason, actor)
    values (p_package, pkg.contractor_id, pkg.name, changes, reason, actor);

  select c.user_id into vendor_user from public.contractors c where c.id = pkg.contractor_id;
  if vendor_user is not null then
    perform public.notify_user(vendor_user, 'pricing', 'info', 'Mercurius updated your prices',
      pkg.name || ': ' || reason,
      case when pkg.template_id is null then '/vendor/packages' else '/vendor/pricing' end,
      null, pkg.contractor_id);
  end if;

  return jsonb_build_object('changed', jsonb_array_length(changes), 'needs_review', review,
    'updated_at', (select updated_at from public.vendor_packages where id = p_package),
    'vendor_notified', vendor_user is not null);
end $$;

-- Operator history for one provider, newest first.
create function public.admin_package_price_corrections(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'package_id', e.package_id, 'package_name', e.package_name, 'changes', e.changes,
      'reason', e.reason, 'actor_email', u.email, 'created_at', e.created_at)
      order by e.created_at desc, e.id desc)
    from private.vendor_package_price_corrections e
    left join auth.users u on u.id = e.actor
   where e.contractor_id = p_contractor), '[]'::jsonb);
end $$;

-- The signed-in vendor reads Mercurius corrections to its own packages: what and why, not who.
create function public.vendor_my_package_price_corrections()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'package_id', e.package_id, 'package_name', e.package_name, 'changes', e.changes,
      'reason', e.reason, 'created_at', e.created_at) order by e.created_at desc, e.id desc)
    from (select e.* from private.vendor_package_price_corrections e
            join public.contractors c on c.id = e.contractor_id
           where c.user_id = auth.uid()
           order by e.created_at desc, e.id desc limit 50) e), '[]'::jsonb);
end $$;

revoke all on function
  private.price_amount(jsonb),
  private.template_package_price_needs_review(uuid),
  public.admin_correct_package_prices(uuid, timestamptz, jsonb, text),
  public.admin_package_price_corrections(uuid),
  public.vendor_my_package_price_corrections()
from public, anon, authenticated, service_role;
grant execute on function
  public.admin_correct_package_prices(uuid, timestamptz, jsonb, text),
  public.admin_package_price_corrections(uuid),
  public.vendor_my_package_price_corrections()
to authenticated;
