-- TRACE-112 (DEC-2026-038): accurate package pricing end to end (pricing review 2026-10-18,
-- slice A: PR-01 to PR-05). Additive; existing packages, prices, requests, quotes and money
-- snapshots are unchanged.
--
-- 1. Package identity (PR-01). vendor_packages.id stays the identity every request, quote
--    and history row already references. lineage_id is the stable identity of a package
--    across revisions: a replacement revision is a new row in the same lineage, so the row a
--    request references never changes after the fact. Every existing row is its own
--    lineage (lineage_id = id). At most one row per lineage is active; the earlier "one
--    active price per cadence per service" refusal in admin_publish_package_draft is
--    replaced (migration 20261018002000) by a same-name refusal, so distinct named packages
--    (one-time cleaning, dump & clean) can share a vendor, service and cadence.
-- 2. Price meaning (PR-02). A tier's price_kind is exact, starting_at or range. Fixed
--    packages carry exact prices only; a starting-at or range price is an estimate and
--    lives on a quote package (quote required), so it can never become a firm charge. A
--    quote package without tiers is "quote after walkthrough" and shows no amount. Legacy
--    tiers keep price_kind null and keep their current meaning: exact on a fixed package,
--    ignored on a quote package (as today). Nothing is backfilled.
-- 3. Structured add-ons (PR-03): fixed or range unit price, unit label, allowed quantity,
--    required or optional, and the cadences they apply to. Existing add-ons become exact,
--    optional, quantity 0 to 1, every cadence: what the public page already says.
-- 4. Rules (PR-04): rule_conditions adds AND conditions to a tier's existing single rule
--    (bedrooms, bathrooms, square feet). A tier matches when every condition holds.
--    When several rule-based levels match the same answers (overlapping bounds), no level
--    is chosen: the package is not offered at an exact price for those answers. The
--    previous behavior silently used the cheapest matching level.
-- 5. One calculation (PR-05). private.price_selection prices a package content document
--    (a live package via private.package_content, or a draft) in whole cents: tier,
--    required and selected add-ons, quantity bounds, cadence. Its status is exact only
--    when one price level applies and every component has one fixed price. Request
--    preview and submission use it, so add-ons now reach the request amount, and the
--    submission stores the breakdown and package revision in service_requests.pricing_inputs
--    (unused until now). A fixed package whose selection is not exact (a range-priced
--    add-on) becomes a quote request with the estimate kept, never a charge. Levels without
--    rules stay homeowner-chosen options; without a choice the request keeps today's
--    behavior (the lowest level, its scope shown). A stale package revision is refused as
--    price_changed.
-- 6. Checkout (fail closed). The checkout commercial source re-checks a fixed request's tier
--    against all its rule conditions. Because the reviewed money snapshot verifies only the
--    tier price, a request priced with add-ons is refused there ("Offering add-ons need
--    commercial-source integration") until that integration is reviewed; R0 does not open
--    checkout in any case.

-- Identity and content ----------------------------------------------------------------

alter table public.vendor_packages
  add column lineage_id uuid,
  add column revision_number integer not null default 1 check (revision_number > 0),
  add column included_scope text[] not null default '{}'
    check (cardinality(included_scope) <= 20),
  add column policy_notes text check (policy_notes is null or length(policy_notes) <= 2000);

-- The backfill is not an edit: updated_at feeds the matching freshness score, so its trigger
-- is suspended for this statement only.
alter table public.vendor_packages disable trigger trg_vendor_packages_updated;
update public.vendor_packages set lineage_id = id where lineage_id is null;
alter table public.vendor_packages enable trigger trg_vendor_packages_updated;
-- Required, but filled by the trigger below, so a CHECK keeps inserts free to omit it.
alter table public.vendor_packages add constraint vendor_packages_lineage_required check (lineage_id is not null);
create index vendor_packages_lineage_idx on public.vendor_packages(lineage_id);
create unique index vendor_packages_one_active_per_lineage
  on public.vendor_packages(lineage_id) where is_active;

comment on column public.vendor_packages.lineage_id is
  'Stable package identity across revisions (TRACE-112). Equals id for a first revision; a replacement revision is a new row with the same lineage.';
comment on column public.vendor_packages.included_scope is
  'What the package includes, shown to homeowners. An add-on may not charge for an included item.';
comment on column public.vendor_packages.policy_notes is
  'Provider notes shown with the package. Display only: Mercurius does not enforce them (TRACE-112).';

-- A lineage stays with one vendor and service, and a row cannot move to another lineage.
create function private.vendor_package_lineage_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.lineage_id := coalesce(new.lineage_id, new.id);
  elsif new.lineage_id is distinct from old.lineage_id then
    raise exception 'A package cannot change lineage' using errcode = '22023';
  end if;
  if new.lineage_id <> new.id and not exists (
    select 1 from public.vendor_packages root
    where root.id = new.lineage_id and root.contractor_id = new.contractor_id
      and root.service_id = new.service_id) then
    raise exception 'A package revision must belong to the same vendor and service' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_vendor_package_lineage before insert or update of lineage_id, contractor_id, service_id
  on public.vendor_packages for each row execute function private.vendor_package_lineage_guard();

-- Price meaning and rules -------------------------------------------------------------

-- Conditions: [{question_key, min, max}], numbers or absent, at least one bound, min <= max.
create function private.pricing_valid_conditions(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 5 and not exists (
    select 1 from jsonb_array_elements(p) c
    where jsonb_typeof(c) <> 'object'
      or coalesce(c ->> 'question_key', '') !~ '^[A-Za-z0-9_-]{1,60}$'
      or coalesce(jsonb_typeof(c -> 'min'), 'null') not in ('number', 'null')
      or coalesce(jsonb_typeof(c -> 'max'), 'null') not in ('number', 'null')
      or (coalesce(jsonb_typeof(c -> 'min'), 'null') = 'null' and coalesce(jsonb_typeof(c -> 'max'), 'null') = 'null')
      or (jsonb_typeof(c -> 'min') = 'number' and jsonb_typeof(c -> 'max') = 'number'
          and (c ->> 'min')::numeric > (c ->> 'max')::numeric))
$$;

alter table public.package_tiers
  add column price_kind text check (price_kind in ('exact', 'starting_at', 'range')),
  add column price_max numeric,
  add column rule_conditions jsonb not null default '[]'::jsonb,
  add constraint package_tiers_price_max_check check (
    (price_kind = 'range' and coalesce(price_max > price, false))
    or (price_kind is distinct from 'range' and price_max is null)),
  add constraint package_tiers_rule_conditions_check check (private.pricing_valid_conditions(rule_conditions));

comment on column public.package_tiers.price_kind is
  'exact, starting_at or range (TRACE-112). Null on legacy rows: exact on a fixed package, unused on a quote package.';
comment on column public.package_tiers.rule_conditions is
  'Extra AND conditions [{question_key, min, max}] beside rule_question_key; bounds inclusive.';

alter table public.package_addons
  add column price_kind text not null default 'exact' check (price_kind in ('exact', 'range')),
  add column price_max numeric,
  add column unit_label text check (unit_label is null or length(btrim(unit_label)) between 1 and 24),
  add column min_quantity integer not null default 0 check (min_quantity between 0 and 99),
  add column max_quantity integer not null default 1 check (max_quantity between 1 and 99),
  add column is_required boolean not null default false,
  add column frequencies text[] not null default '{}',
  add constraint package_addons_quantity_check check (
    max_quantity >= min_quantity and (not is_required or min_quantity >= 1)),
  add constraint package_addons_price_max_check check (
    (price_kind = 'range' and coalesce(price_max > price, false)) or (price_kind = 'exact' and price_max is null)),
  add constraint package_addons_frequencies_check check (
    frequencies <@ array['one-time', 'weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly']::text[]);

comment on column public.package_addons.is_required is
  'A required add-on is always included at least at min_quantity and cannot be deselected.';
comment on column public.package_addons.frequencies is
  'Cadences the add-on applies to; empty means every cadence of the package.';

-- A fixed package charges exact prices only; an estimate tier belongs to a quote package.
create function private.package_tier_kind_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mode text;
begin
  select p.pricing_mode into mode from public.vendor_packages p where p.id = new.package_id;
  if mode = 'fixed' and new.price_kind in ('starting_at', 'range') then
    raise exception 'A fixed-price package needs exact prices; use a quote package for an estimate' using errcode = '22023';
  end if;
  if mode in ('custom_quote', 'deposit_quote') and new.price_kind = 'exact' then
    raise exception 'A quote package shows estimates only; use a fixed-price package for an exact price' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_package_tier_kind before insert or update of price_kind, package_id
  on public.package_tiers for each row execute function private.package_tier_kind_guard();

create function private.package_mode_kind_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pricing_mode = 'fixed' and exists (select 1 from public.package_tiers t
      where t.package_id = new.id and t.price_kind in ('starting_at', 'range')) then
    raise exception 'A fixed-price package needs exact prices; use a quote package for an estimate' using errcode = '22023';
  end if;
  if new.pricing_mode in ('custom_quote', 'deposit_quote') and exists (select 1 from public.package_tiers t
      where t.package_id = new.id and t.price_kind = 'exact') then
    raise exception 'A quote package shows estimates only; use a fixed-price package for an exact price' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger trg_package_mode_kind before update of pricing_mode
  on public.vendor_packages for each row execute function private.package_mode_kind_guard();

-- Calculation -------------------------------------------------------------------------

create function private.pricing_cents(p_amount numeric) returns bigint
language sql immutable set search_path = '' as $$ select round(p_amount * 100)::bigint $$;

-- A content tier's conditions: its legacy single rule, then rule_conditions.
create function private.pricing_tier_conditions(p_tier jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when nullif(btrim(coalesce(p_tier ->> 'rule_question_key', '')), '') is not null
      then jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('question_key', p_tier ->> 'rule_question_key',
        'min', p_tier -> 'rule_min', 'max', p_tier -> 'rule_max')))
      else '[]'::jsonb end
    || coalesce(p_tier -> 'conditions', '[]'::jsonb)
$$;

-- Answers are {key: {answer: text}}. A condition needs a numeric answer within its bounds.
create function private.pricing_condition_holds(p_condition jsonb, p_answers jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when coalesce(p_answers -> (p_condition ->> 'question_key') ->> 'answer', '') ~ '^-?[0-9]+([.][0-9]+)?$' then
      (coalesce(jsonb_typeof(p_condition -> 'min'), '') <> 'number'
        or (p_answers -> (p_condition ->> 'question_key') ->> 'answer')::numeric >= (p_condition ->> 'min')::numeric)
      and (coalesce(jsonb_typeof(p_condition -> 'max'), '') <> 'number'
        or (p_answers -> (p_condition ->> 'question_key') ->> 'answer')::numeric <= (p_condition ->> 'max')::numeric)
    else false end
$$;

-- True or false; null when the tier has conditions and answers are not being evaluated.
create function private.pricing_tier_matches(p_tier jsonb, p_answers jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when jsonb_array_length(private.pricing_tier_conditions(p_tier)) = 0 then true
    when p_answers is null then null
    else not exists (select 1 from jsonb_array_elements(private.pricing_tier_conditions(p_tier)) c
                     where not private.pricing_condition_holds(c, p_answers))
  end
$$;

create function private.pricing_tier_json(p_tier public.package_tiers) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', p_tier.id::text, 'name', p_tier.name, 'price', p_tier.price,
    'price_kind', p_tier.price_kind, 'price_max', p_tier.price_max, 'frequency', p_tier.frequency,
    'rule_question_key', p_tier.rule_question_key, 'rule_min', p_tier.rule_min, 'rule_max', p_tier.rule_max,
    'conditions', p_tier.rule_conditions, 'includes', to_jsonb(p_tier.includes), 'sort_order', p_tier.sort_order)
$$;

-- The content document of a live package, in the shape drafts use.
create function private.package_content(p_package uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'package_id', p.id, 'lineage_id', p.lineage_id, 'revision_number', p.revision_number,
    'contractor_id', p.contractor_id, 'service_id', p.service_id,
    'name', p.name, 'description', p.description, 'pricing_mode', p.pricing_mode,
    'deposit_amount', p.deposit_amount, 'default_frequency', p.default_frequency,
    'included_scope', to_jsonb(p.included_scope), 'policy_notes', p.policy_notes,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('question_key', q.question_key,
        'question_label', q.question_label, 'input_type', q.input_type, 'unit', q.unit, 'options', q.options,
        'is_required', q.is_required is not false) order by q.sort_order, q.question_key)
      from public.package_qualifying_questions q where q.package_id = p.id), '[]'::jsonb),
    'tiers', coalesce((select jsonb_agg(private.pricing_tier_json(t) order by t.sort_order, t.id)
      from public.package_tiers t where t.package_id = p.id), '[]'::jsonb),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id::text,
        'name', coalesce(nullif(btrim(a.name), ''), ta.label), 'description', coalesce(a.description, ta.description),
        'price', a.price, 'price_kind', a.price_kind, 'price_max', a.price_max, 'unit_label', a.unit_label,
        'min_quantity', a.min_quantity, 'max_quantity', a.max_quantity, 'is_required', a.is_required,
        'frequencies', to_jsonb(a.frequencies), 'sort_order', a.sort_order) order by a.sort_order, a.id)
      from public.package_addons a left join public.pricing_template_addons ta on ta.id = a.template_addon_id
      where a.package_id = p.id and a.is_offered), '[]'::jsonb))
  from public.vendor_packages p where p.id = p_package
$$;

-- The revision fingerprint: any change to price, scope, rule, cadence or add-on changes it.
create function private.pricing_content_hash(p_content jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_content::text, 'UTF8')), 'hex')
$$;

create function private.package_revision_hash(p_package uuid) returns text
language sql stable security definer set search_path = '' as $$
  select private.pricing_content_hash(private.package_content(p_package))
$$;

-- DEC-2026-041 item 7: when answers match no rule-based level, which answers prevented it.
-- A question blocks when no level of the cadence accepts its answer; when each answer fits
-- some level but no level fits them all, every rule question is reported as a combination.
-- {answers: [{question_key, question_label, answer}], combination: boolean}
create function private.pricing_blocking_answers(p_content jsonb, p_tiers jsonb, p_answers jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with keys as (
    select distinct c ->> 'question_key' as question_key
    from jsonb_array_elements(p_tiers) t cross join lateral jsonb_array_elements(private.pricing_tier_conditions(t)) c),
  blocking as (
    select k.question_key from keys k
    where not exists (select 1 from jsonb_array_elements(p_tiers) t
      where not exists (select 1 from jsonb_array_elements(private.pricing_tier_conditions(t)) c
                        where c ->> 'question_key' = k.question_key and not private.pricing_condition_holds(c, p_answers)))),
  reported as (
    select question_key, false as combination from blocking
    union all select question_key, true from keys where not exists (select 1 from blocking))
  select jsonb_build_object(
    'answers', coalesce(jsonb_agg(jsonb_build_object('question_key', r.question_key,
        'question_label', coalesce((select q ->> 'question_label' from jsonb_array_elements(coalesce(p_content -> 'questions', '[]'::jsonb)) q
          where q ->> 'question_key' = r.question_key limit 1), r.question_key),
        'answer', p_answers -> r.question_key ->> 'answer') order by r.question_key), '[]'::jsonb),
    'combination', coalesce(bool_or(r.combination), false))
  from reported r
$$;

-- Prices a selection of a content document. p_answers null leaves rules unevaluated
-- (availability preview). p_addons is [{id, quantity}] or null. Amounts in whole cents.
-- status: exact (one firm total), estimate (amounts that need provider confirmation),
-- quote (no amount: quote after walkthrough), unresolved (answers needed, or no single
-- price level matches them), invalid (a selection the package does not offer).
create function private.price_selection(p_content jsonb, p_frequency text, p_tier text, p_answers jsonb, p_addons jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  mode text := coalesce(p_content ->> 'pricing_mode', 'fixed');
  quote_mode boolean := coalesce(p_content ->> 'pricing_mode', 'fixed') in ('custom_quote', 'deposit_quote');
  tiers jsonb;
  matching jsonb;
  chosen jsonb;
  status text;
  reason text;
  kind text;
  lines jsonb := '[]'::jsonb;
  min_total bigint := 0;
  max_total bigint := 0;
  open_ended boolean := false;
  all_exact boolean := true;
  available jsonb;
  addon jsonb;
  wanted jsonb;
  quantity integer;
  seen text[] := '{}';
  unit bigint;
  unit_max bigint;
  included text[];
  invalid jsonb := jsonb_build_object('status', 'invalid', 'requires_quote', true, 'pricing_mode',
    coalesce(p_content ->> 'pricing_mode', 'fixed'), 'frequency', p_frequency, 'lines', '[]'::jsonb, 'currency', 'usd');
begin
  if p_content is null then return invalid || jsonb_build_object('reason', 'package_not_found'); end if;

  -- Tiers that price this cadence: exact ones on a fixed package, estimates on a quote package.
  select coalesce(jsonb_agg(t order by coalesce((t ->> 'sort_order')::integer, 0), t ->> 'id'), '[]'::jsonb) into tiers
  from jsonb_array_elements(coalesce(p_content -> 'tiers', '[]'::jsonb)) t
  where t ->> 'frequency' = p_frequency
    and (case when quote_mode then t ->> 'price_kind' in ('starting_at', 'range')
              else coalesce(t ->> 'price_kind', 'exact') = 'exact' end)
    and coalesce((t ->> 'price')::numeric, 0) > 0;

  if jsonb_array_length(tiers) = 0 then
    if not quote_mode then return invalid || jsonb_build_object('reason', 'no_price_for_cadence'); end if;
    status := 'quote';
  elsif exists (select 1 from jsonb_array_elements(tiers) t where jsonb_array_length(private.pricing_tier_conditions(t)) > 0) then
    -- Rule-based levels: exactly one must match the answers.
    if p_answers is null then
      status := 'unresolved'; reason := 'answers_needed';
    else
      select coalesce(jsonb_agg(t), '[]'::jsonb) into matching
      from jsonb_array_elements(tiers) t where private.pricing_tier_matches(t, p_answers);
      if jsonb_array_length(matching) = 0 then
        status := 'unresolved'; reason := 'no_matching_price_level';
      elsif jsonb_array_length(matching) > 1 then
        status := 'unresolved'; reason := 'ambiguous_price_levels';
      else
        chosen := matching -> 0;
        if p_tier is not null and chosen ->> 'id' <> p_tier then
          return invalid || jsonb_build_object('reason', 'tier_not_applicable');
        end if;
      end if;
    end if;
  else
    -- Levels without rules are options the homeowner chooses.
    if p_tier is not null then
      select t into chosen from jsonb_array_elements(tiers) t where t ->> 'id' = p_tier;
      if chosen is null then return invalid || jsonb_build_object('reason', 'tier_not_offered'); end if;
    elsif jsonb_array_length(tiers) = 1 then
      chosen := tiers -> 0;
    else
      status := 'estimate'; reason := 'price_level_not_chosen';
    end if;
  end if;

  if chosen is not null then
    kind := coalesce(chosen ->> 'price_kind', 'exact');
    unit := private.pricing_cents((chosen ->> 'price')::numeric);
    unit_max := case kind when 'range' then private.pricing_cents((chosen ->> 'price_max')::numeric)
                          when 'starting_at' then null else unit end;
    lines := lines || jsonb_build_object('kind', 'tier', 'id', chosen ->> 'id', 'name', chosen ->> 'name',
      'price_kind', kind, 'quantity', 1, 'unit_cents', unit, 'unit_max_cents', unit_max,
      'amount_cents', unit, 'amount_max_cents', unit_max, 'required', true);
    min_total := unit;
    if unit_max is null then open_ended := true; else max_total := unit_max; end if;
    all_exact := kind = 'exact';
  elsif status = 'estimate' or reason = 'answers_needed' then
    -- No single level yet: the range across the cadence's levels, never a charge. Once the
    -- answers match no level (or several), no level's amount is shown (DEC-2026-041 item 7).
    select min(private.pricing_cents((t ->> 'price')::numeric)),
           max(private.pricing_cents(coalesce((t ->> 'price_max')::numeric, (t ->> 'price')::numeric))),
           coalesce(bool_or(t ->> 'price_kind' = 'starting_at'), false)
      into unit, unit_max, open_ended
    from jsonb_array_elements(tiers) t;
    lines := lines || jsonb_build_object('kind', 'tier', 'id', null, 'name', null, 'price_kind', 'range',
      'quantity', 1, 'unit_cents', unit, 'unit_max_cents', case when open_ended then null else unit_max end,
      'amount_cents', unit, 'amount_max_cents', case when open_ended then null else unit_max end, 'required', true);
    min_total := unit; max_total := unit_max;
    all_exact := false;
  end if;

  select array_agg(lower(btrim(item))) into included
  from (select jsonb_array_elements_text(coalesce(p_content -> 'included_scope', '[]'::jsonb)) item
        union all select jsonb_array_elements_text(coalesce(chosen -> 'includes', '[]'::jsonb))) scope;

  -- Add-ons for this cadence. Required ones are always included; selected ones within bounds.
  select coalesce(jsonb_agg(a order by coalesce((a ->> 'sort_order')::integer, 0), a ->> 'id'), '[]'::jsonb) into available
  from jsonb_array_elements(coalesce(p_content -> 'addons', '[]'::jsonb)) a
  where coalesce(jsonb_array_length(a -> 'frequencies'), 0) = 0 or (a -> 'frequencies') ? p_frequency;

  if p_addons is not null then
    if jsonb_typeof(p_addons) <> 'array' or jsonb_array_length(p_addons) > 20 then
      return invalid || jsonb_build_object('reason', 'invalid_addons');
    end if;
    for wanted in select value from jsonb_array_elements(p_addons) loop
      if jsonb_typeof(wanted) <> 'object' or jsonb_typeof(wanted -> 'id') <> 'string'
        or jsonb_typeof(wanted -> 'quantity') <> 'number' or (wanted ->> 'quantity') !~ '^[0-9]{1,2}$' then
        return invalid || jsonb_build_object('reason', 'invalid_addons');
      end if;
      if (wanted ->> 'id') = any(seen) then return invalid || jsonb_build_object('reason', 'duplicate_addon'); end if;
      seen := seen || (wanted ->> 'id');
      if not exists (select 1 from jsonb_array_elements(available) a where a ->> 'id' = wanted ->> 'id') then
        return invalid || jsonb_build_object('reason', 'addon_not_offered', 'addon_id', wanted ->> 'id');
      end if;
    end loop;
  end if;

  for addon in select value from jsonb_array_elements(available) loop
    wanted := null;
    if p_addons is not null then
      select w into wanted from jsonb_array_elements(p_addons) w where w ->> 'id' = addon ->> 'id';
    end if;
    quantity := coalesce((wanted ->> 'quantity')::integer, 0);
    if coalesce((addon ->> 'is_required')::boolean, false) and wanted is null then
      quantity := greatest(coalesce((addon ->> 'min_quantity')::integer, 1), 1);
    end if;
    continue when quantity = 0 and not coalesce((addon ->> 'is_required')::boolean, false);
    if quantity < coalesce((addon ->> 'min_quantity')::integer, 0)
      or quantity > coalesce((addon ->> 'max_quantity')::integer, 1)
      or (quantity = 0 and coalesce((addon ->> 'is_required')::boolean, false)) then
      return invalid || jsonb_build_object('reason', 'addon_quantity', 'addon_id', addon ->> 'id');
    end if;
    if lower(btrim(addon ->> 'name')) = any(coalesce(included, '{}')) then
      return invalid || jsonb_build_object('reason', 'addon_included_in_package', 'addon_id', addon ->> 'id');
    end if;
    kind := coalesce(addon ->> 'price_kind', 'exact');
    unit := private.pricing_cents((addon ->> 'price')::numeric);
    unit_max := case when kind = 'range' then private.pricing_cents((addon ->> 'price_max')::numeric) else unit end;
    lines := lines || jsonb_build_object('kind', 'addon', 'id', addon ->> 'id', 'name', addon ->> 'name',
      'unit_label', addon ->> 'unit_label', 'price_kind', kind, 'quantity', quantity,
      'unit_cents', unit, 'unit_max_cents', unit_max, 'amount_cents', unit * quantity,
      'amount_max_cents', unit_max * quantity, 'required', coalesce((addon ->> 'is_required')::boolean, false));
    min_total := min_total + unit * quantity;
    max_total := max_total + unit_max * quantity;
    all_exact := all_exact and kind = 'exact';
  end loop;

  if status is null then
    status := case when not quote_mode and all_exact then 'exact' else 'estimate' end;
  end if;

  return jsonb_build_object(
    'status', status, 'reason', reason, 'requires_quote', status <> 'exact',
    'pricing_mode', mode, 'frequency', p_frequency,
    'tier_id', chosen ->> 'id', 'tier_name', chosen ->> 'name', 'lines', lines,
    'total_cents', case when status = 'exact' then min_total end,
    'min_cents', case when status = 'estimate' or reason = 'answers_needed' then min_total end,
    'max_cents', case when (status = 'estimate' or reason = 'answers_needed') and not open_ended then max_total end,
    'deposit_cents', case when mode = 'deposit_quote' and coalesce((p_content ->> 'deposit_amount')::numeric, 0) > 0
      then private.pricing_cents((p_content ->> 'deposit_amount')::numeric) end,
    'included_scope', coalesce((select jsonb_agg(item) from (
        select jsonb_array_elements_text(coalesce(p_content -> 'included_scope', '[]'::jsonb)) item
        union select jsonb_array_elements_text(coalesce(chosen -> 'includes', '[]'::jsonb))) scope), '[]'::jsonb),
    'currency', 'usd')
    -- DEC-2026-041 item 7: present only when answers matched no level.
    || case when reason = 'no_matching_price_level'
         then jsonb_build_object('blocking', private.pricing_blocking_answers(p_content, tiers, p_answers)) else '{}'::jsonb end;
end $$;

-- Add-on choices a homeowner can make for a package and cadence (public package content).
create function private.intake_addon_options(p_package uuid, p_frequency text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a ->> 'id', 'name', a ->> 'name',
      'description', a ->> 'description', 'unit_label', a ->> 'unit_label', 'price_kind', a ->> 'price_kind',
      'price', (a ->> 'price')::numeric, 'price_max', (a ->> 'price_max')::numeric,
      'min_quantity', (a ->> 'min_quantity')::integer, 'max_quantity', (a ->> 'max_quantity')::integer,
      'is_required', (a ->> 'is_required')::boolean)
    order by coalesce((a ->> 'sort_order')::integer, 0), a ->> 'id'), '[]'::jsonb)
  from jsonb_array_elements(coalesce(private.package_content(p_package) -> 'addons', '[]'::jsonb)) a
  where coalesce(jsonb_array_length(a -> 'frequencies'), 0) = 0 or (a -> 'frequencies') ? p_frequency
$$;

-- Validates a selection's add-on input shape before any pricing.
create function private.intake_addons_input(p_selection jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare addons jsonb := p_selection -> 'addons';
begin
  if addons is null or jsonb_typeof(addons) = 'null' then return null; end if;
  if jsonb_typeof(addons) <> 'array' or jsonb_array_length(addons) > 20
    or exists (select 1 from jsonb_array_elements(addons) a
      where jsonb_typeof(a) <> 'object' or jsonb_typeof(a -> 'id') <> 'string' or length(a ->> 'id') > 64
        or jsonb_typeof(a -> 'quantity') <> 'number' or (a ->> 'quantity') !~ '^[0-9]{1,2}$') then
    raise exception 'Invalid add-on selection' using errcode = '22023';
  end if;
  if p_selection ? 'package_revision' and (jsonb_typeof(p_selection -> 'package_revision') <> 'string'
      or (p_selection ->> 'package_revision') !~ '^[0-9a-f]{64}$') then
    raise exception 'Invalid package revision' using errcode = '22023';
  end if;
  return addons;
end $$;

revoke all on function
  private.vendor_package_lineage_guard(), private.package_tier_kind_guard(), private.package_mode_kind_guard(),
  private.pricing_cents(numeric), private.pricing_tier_conditions(jsonb),
  private.pricing_condition_holds(jsonb, jsonb), private.pricing_tier_matches(jsonb, jsonb),
  private.pricing_blocking_answers(jsonb, jsonb, jsonb),
  private.pricing_tier_json(public.package_tiers), private.package_content(uuid), private.pricing_content_hash(jsonb),
  private.package_revision_hash(uuid), private.price_selection(jsonb, text, text, jsonb, jsonb),
  private.intake_addon_options(uuid, text), private.intake_addons_input(jsonb)
from public, anon, authenticated, service_role;
-- The tier check constraint calls this validator as the writing role (vendors write their own
-- tiers directly), so it keeps its default execute grant. It reads nothing.

-- Eligibility: rules evaluate every condition; overlapping rule-based levels choose nothing.
-- Otherwise unchanged from 20260928000000.
CREATE OR REPLACE FUNCTION private.find_eligible_packages_with_answers(_request_id uuid, _service_id text, _frequency text, _zip_code text, _preferred_contractor_id uuid, _answers jsonb)
 RETURNS TABLE(contractor_id uuid, contractor_name text, package_id uuid, package_tier_id uuid, promotion_id uuid, frequency text, path text, base_price numeric, effective_price numeric, median_fixed_price numeric, fixed_score numeric, profile_score numeric, verification_score numeric, price_band_score numeric, response_score numeric, freshness_score numeric, total_score numeric, preferred boolean, score_breakdown jsonb, rank_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  resolved_service_id text := _service_id;
  resolved_frequency text := _frequency;
  resolved_zip text := _zip_code;
  resolved_preferred uuid := _preferred_contractor_id;
  resolved_preferred_package uuid;
  resolved_preferred_tier uuid;
  -- TRACE-098: NULL leaves price-level rules unevaluated (availability preview only).
  resolved_answers jsonb := _answers;
BEGIN
  IF _request_id IS NOT NULL THEN
    SELECT
      request.service_catalog_id,
      request.frequency,
      request.zip_code,
      COALESCE(_preferred_contractor_id, request.preferred_contractor_id, request.contractor_id),
      request.package_id,
      request.package_tier_id,
      COALESCE(request.package_question_answers, '{}'::jsonb)
    INTO resolved_service_id, resolved_frequency, resolved_zip, resolved_preferred,
      resolved_preferred_package, resolved_preferred_tier, resolved_answers
    FROM public.service_requests request
    WHERE request.id = _request_id;
  END IF;

  IF resolved_service_id IS NULL OR resolved_frequency IS NULL OR resolved_zip IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH profile AS (
    SELECT
      contractor.id AS contractor_id,
      LEAST(100,
        CASE WHEN btrim(contractor.name) <> '' THEN 8 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.location), '') <> '' THEN 8 ELSE 0 END
        + CASE WHEN cardinality(COALESCE(contractor.services, '{}'::text[])) > 0 THEN 10 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.email), '') <> '' THEN 7 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.phone), '') <> '' THEN 7 ELSE 0 END
        + CASE WHEN COALESCE(contractor.years_experience, 0) > 0 THEN 10 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.verified_specialty), '') <> '' THEN 10 ELSE 0 END
        + CASE WHEN contractor.logo_url IS NOT NULL THEN 8 ELSE 0 END
        + LEAST(3, COALESCE(gallery.photo_count, 0)) * 4
        + CASE
            WHEN length(COALESCE(btrim(contractor.bio), '')) >= 80 THEN 10
            WHEN length(COALESCE(btrim(contractor.bio), '')) > 0 THEN 5
            ELSE 0
          END
        + CASE WHEN COALESCE(btrim(contractor.special_offer), '') <> '' THEN 5 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.our_promise), '') <> '' THEN 5 ELSE 0 END
      )::numeric AS strength,
      COALESCE(contractor.badges, '{}'::text[])
        && ARRAY['Licensed', 'Insured', 'Background Checked']::text[] AS has_badges
    FROM public.contractors contractor
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS photo_count
      FROM public.contractor_gallery gallery_row
      WHERE gallery_row.contractor_id = contractor.id
    ) gallery ON true
  ), response_history AS (
    SELECT
      attempt.contractor_id,
      count(*) FILTER (WHERE attempt.outcome = 'accepted')::numeric AS accepted,
      count(*) FILTER (WHERE attempt.outcome IN ('accepted', 'declined', 'expired'))::numeric AS decided
    FROM public.job_match_attempts attempt
    GROUP BY attempt.contractor_id
  ), fixed_raw AS (
    SELECT
      contractor.id AS contractor_id,
      contractor.name AS contractor_name,
      package.id AS package_id,
      tier.id AS package_tier_id,
      resolved.promotion_id,
      tier.frequency,
      'fixed'::text AS path,
      resolved.base_price,
      resolved.effective_price,
      package.updated_at,
      profile.strength,
      profile.has_badges,
      COALESCE(history.accepted, 0) AS accepted,
      COALESCE(history.decided, 0) AS decided,
      jsonb_array_length(private.pricing_tier_conditions(private.pricing_tier_json(tier))) > 0 AS conditioned
    FROM public.vendor_packages package
    JOIN public.contractors contractor ON contractor.id = package.contractor_id
    JOIN public.services_catalog service ON service.id = package.service_id AND service.is_active = true
    JOIN public.package_tiers tier
      ON tier.package_id = package.id
      AND tier.frequency = resolved_frequency
      AND tier.price > 0
    JOIN LATERAL public.resolve_package_tier_price(package.id, tier.id) resolved ON true
    JOIN profile ON profile.contractor_id = contractor.id
    LEFT JOIN response_history history ON history.contractor_id = contractor.id
    WHERE package.service_id = resolved_service_id
      AND package.pricing_mode = 'fixed'
      AND package.is_active = true
      AND package.needs_review IS NOT TRUE
      AND contractor.is_active IS TRUE
      AND contractor.marketing_enabled IS TRUE
      -- TRACE-112: every condition of the level (its rule and rule_conditions) holds, or the
      -- answers are not being evaluated. A fixed package charges exact prices only.
      AND private.pricing_tier_matches(private.pricing_tier_json(tier), resolved_answers) IS NOT FALSE
      AND COALESCE(tier.price_kind, 'exact') = 'exact'
      AND EXISTS (
        SELECT 1
        FROM public.coverage_areas area
        WHERE area.zip_code = resolved_zip AND area.is_active = true
      )
      AND EXISTS (
        SELECT 1
        FROM public.contractor_service_zips service_zip
        WHERE service_zip.contractor_id = contractor.id
          AND service_zip.zip_code = resolved_zip
      )
  ), fixed_counted AS (
    SELECT raw.*,
      count(*) OVER (PARTITION BY raw.package_id) AS matching_levels,
      bool_or(raw.conditioned) OVER (PARTITION BY raw.package_id) AS rule_based
    FROM fixed_raw raw
  ), fixed_candidates AS (
    -- TRACE-112: when several rule-based levels match the same answers, none is chosen.
    SELECT DISTINCT ON (raw.contractor_id, raw.package_id)
      raw.contractor_id, raw.contractor_name, raw.package_id, raw.package_tier_id, raw.promotion_id,
      raw.frequency, raw.path, raw.base_price, raw.effective_price, raw.updated_at, raw.strength,
      raw.has_badges, raw.accepted, raw.decided
    FROM fixed_counted raw
    WHERE NOT (resolved_answers IS NOT NULL AND raw.rule_based AND raw.matching_levels > 1)
    ORDER BY raw.contractor_id, raw.package_id, raw.effective_price, raw.package_tier_id
  ), quote_candidates AS (
    SELECT
      contractor.id AS contractor_id,
      contractor.name AS contractor_name,
      package.id AS package_id,
      NULL::uuid AS package_tier_id,
      NULL::uuid AS promotion_id,
      package.default_frequency AS frequency,
      'quote'::text AS path,
      NULL::numeric AS base_price,
      NULL::numeric AS effective_price,
      package.updated_at,
      profile.strength,
      profile.has_badges,
      COALESCE(history.accepted, 0) AS accepted,
      COALESCE(history.decided, 0) AS decided
    FROM public.vendor_packages package
    JOIN public.contractors contractor ON contractor.id = package.contractor_id
    JOIN public.services_catalog service ON service.id = package.service_id AND service.is_active = true
    JOIN profile ON profile.contractor_id = contractor.id
    LEFT JOIN response_history history ON history.contractor_id = contractor.id
    WHERE package.service_id = resolved_service_id
      AND package.pricing_mode IN ('custom_quote', 'deposit_quote')
      AND package.default_frequency = resolved_frequency
      AND package.is_active = true
      AND package.needs_review IS NOT TRUE
      AND contractor.is_active IS TRUE
      AND contractor.marketing_enabled IS TRUE
      AND EXISTS (
        SELECT 1
        FROM public.coverage_areas area
        WHERE area.zip_code = resolved_zip AND area.is_active = true
      )
      AND EXISTS (
        SELECT 1
        FROM public.contractor_service_zips service_zip
        WHERE service_zip.contractor_id = contractor.id
          AND service_zip.zip_code = resolved_zip
      )
  ), candidates AS (
    SELECT * FROM fixed_candidates
    UNION ALL
    SELECT * FROM quote_candidates
  ), price_stats AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY candidate.effective_price)::numeric AS median_price
    FROM candidates candidate
    WHERE candidate.path = 'fixed'
  ), scored AS (
    SELECT
      candidate.*,
      stats.median_price,
      CASE WHEN candidate.path = 'fixed' THEN 40 ELSE 0 END::numeric AS fixed_points,
      round(candidate.strength * 0.20, 2) AS profile_points,
      CASE WHEN candidate.has_badges THEN 15 ELSE 0 END::numeric AS verification_points,
      CASE
        WHEN candidate.path = 'fixed'
          AND stats.median_price IS NOT NULL
          AND candidate.effective_price <= stats.median_price * 1.25
          THEN 15
        ELSE 0
      END::numeric AS price_points,
      CASE
        WHEN candidate.decided > 0 THEN round((candidate.accepted / candidate.decided) * 10, 2)
        ELSE 0
      END::numeric AS response_points,
      CASE WHEN candidate.updated_at >= now() - interval '30 days' THEN 5 ELSE 0 END::numeric AS freshness_points,
      candidate.contractor_id = resolved_preferred AS is_preferred,
      candidate.contractor_id = resolved_preferred
        AND candidate.package_id = resolved_preferred_package
        AND (resolved_preferred_tier IS NULL OR candidate.package_tier_id = resolved_preferred_tier)
        AS is_selected_package
    FROM candidates candidate
    CROSS JOIN price_stats stats
  ), ranked AS (
    SELECT
      scored.*,
      scored.fixed_points + scored.profile_points + scored.verification_points
        + scored.price_points + scored.response_points + scored.freshness_points AS score_total
    FROM scored
  )
  SELECT
    ranked.contractor_id,
    ranked.contractor_name,
    ranked.package_id,
    ranked.package_tier_id,
    ranked.promotion_id,
    ranked.frequency,
    ranked.path,
    ranked.base_price,
    ranked.effective_price,
    ranked.median_price,
    ranked.fixed_points,
    ranked.profile_points,
    ranked.verification_points,
    ranked.price_points,
    ranked.response_points,
    ranked.freshness_points,
    ranked.score_total,
    ranked.is_preferred,
    jsonb_build_object(
      'fixed', ranked.fixed_points,
      'profile', ranked.profile_points,
      'verification', ranked.verification_points,
      'price_band', ranked.price_points,
      'response', ranked.response_points,
      'freshness', ranked.freshness_points
    ),
    row_number() OVER (
      ORDER BY ranked.is_selected_package DESC,
        ranked.is_preferred DESC,
        ranked.score_total DESC,
        ranked.effective_price ASC NULLS LAST,
        lower(ranked.contractor_name),
        ranked.contractor_id,
        ranked.package_id
    )::integer
  FROM ranked
  ORDER BY ranked.is_selected_package DESC,
    ranked.is_preferred DESC,
    ranked.score_total DESC,
    ranked.effective_price ASC NULLS LAST,
    lower(ranked.contractor_name),
    ranked.contractor_id,
    ranked.package_id;
END;
$function$;

revoke all on function private.find_eligible_packages_with_answers(uuid, text, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Request preview: restated from 20261016002000; changes marked TRACE-112.
CREATE OR REPLACE FUNCTION public.preview_service_request_selections(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  stage text;
  zip text;
  area public.coverage_areas;
  selections jsonb;
  selection jsonb;
  selection_count integer;
  idx integer;
  seen_services text[] := '{}';
  service public.services_catalog;
  wanted_frequency text;
  selected_provider uuid;
  wanted_package uuid;
  wanted_tier uuid;
  offering public.vendor_packages;
  raw_answers jsonb;
  provisional_answers jsonb;
  rule_answers jsonb;
  missing_answers text[];
  candidate record;
  candidate_packages uuid[];
  chosen_mode text;
  chosen_package uuid;
  chosen_tier uuid;
  chosen_total numeric;
  chosen_promotion uuid;
  depends_on_answers boolean;
  tier_price record;
  chosen_base numeric;
  addons_input jsonb;
  pricing jsonb;
  addon_cents bigint;
  outcome jsonb;
  outcomes jsonb := '[]'::jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid preview' using errcode = '22023';
  end if;
  stage := coalesce(p_payload ->> 'stage', 'final');
  if stage not in ('availability', 'final') then
    raise exception 'Invalid preview stage' using errcode = '22023';
  end if;
  zip := btrim(coalesce(p_payload #>> '{location,zip_code}', ''));
  if zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'Enter a valid five-digit ZIP code' using errcode = '22023';
  end if;
  zip := left(zip, 5);
  selections := p_payload -> 'selections';
  if jsonb_typeof(selections) is distinct from 'array' then
    raise exception 'Choose at least one service' using errcode = '22023';
  end if;
  selection_count := jsonb_array_length(selections);
  if selection_count < 1 or selection_count > 20 then
    raise exception 'Choose between 1 and 20 services' using errcode = '22023';
  end if;

  select * into area from public.coverage_areas where zip_code = zip;
  if not coalesce(area.is_active, false) then
    return jsonb_build_object('stage', stage,
      'coverage', case when area.has_waitlist then 'waitlist' else 'uncovered' end,
      'outcomes', '[]'::jsonb);
  end if;

  for idx in 0 .. selection_count - 1 loop
    -- Input checks mirror submit_service_requests so a preview never accepts what it refuses.
    selection := selections -> idx;
    if jsonb_typeof(selection) is distinct from 'object' then
      raise exception 'Invalid service selection' using errcode = '22023';
    end if;
    wanted_frequency := selection ->> 'frequency';
    if wanted_frequency is null
      or wanted_frequency not in ('weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly', 'one-time') then
      raise exception 'Invalid service frequency' using errcode = '22023';
    end if;
    if coalesce(selection ->> 'service_id', '') !~ '^[a-z0-9-]{1,100}$' then
      raise exception 'Invalid service' using errcode = '22023';
    end if;
    if (selection ->> 'service_id') = any(seen_services) then
      raise exception 'Each service can be selected once' using errcode = '22023';
    end if;
    seen_services := seen_services || (selection ->> 'service_id');
    begin
      selected_provider := nullif(selection ->> 'preferred_contractor_id', '')::uuid;
      wanted_package := nullif(selection ->> 'package_id', '')::uuid;
      wanted_tier := nullif(selection ->> 'tier_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid provider or offering identifier' using errcode = '22023';
    end;
    if wanted_tier is not null and wanted_package is null then
      raise exception 'A tier requires its offering' using errcode = '22023';
    end if;
    raw_answers := coalesce(selection -> 'answers', '{}'::jsonb);
    if jsonb_typeof(raw_answers) <> 'object'
      or (select count(*) from jsonb_object_keys(raw_answers)) > 50
      or exists (select 1 from jsonb_each(raw_answers) answer
        where jsonb_typeof(answer.value) not in ('string', 'number')
          or length(answer.value #>> '{}') > 200) then
      raise exception 'Invalid qualifying answers' using errcode = '22023';
    end if;
    select coalesce(jsonb_object_agg(answer.key, jsonb_build_object('answer', btrim(answer.value #>> '{}'))), '{}'::jsonb)
    into provisional_answers
    from jsonb_each(raw_answers) answer
    where btrim(answer.value #>> '{}') <> '';
    rule_answers := case when stage = 'final' then provisional_answers end;
    addons_input := private.intake_addons_input(selection);
    pricing := null;

    outcome := jsonb_build_object('selection_index', idx, 'service_id', selection ->> 'service_id');

    select * into service from public.services_catalog
    where id = selection ->> 'service_id' and is_active = true;
    if not found then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'service_not_offered'));
      continue;
    end if;
    if selected_provider is not null and not exists (select 1 from public.contractors where id = selected_provider) then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_provider'));
      continue;
    end if;
    offering := null;
    if wanted_package is not null then
      select * into offering from public.vendor_packages where id = wanted_package;
      if not found or offering.service_id <> service.id
        or (selected_provider is not null and offering.contractor_id <> selected_provider)
        or (wanted_tier is not null and not exists (select 1 from public.package_tiers
          where id = wanted_tier and package_id = wanted_package)) then
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package'));
        continue;
      end if;
      if stage = 'final' then
        select array_agg(question.question_key order by question.sort_order) into missing_answers
        from public.package_qualifying_questions question
        where question.package_id = offering.id and question.is_required is not false
          and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
        if missing_answers is not null then
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required',
            'questions', to_jsonb(missing_answers), 'package_id', offering.id,
            'question_details', private.intake_package_questions(offering.id)));
          continue;
        end if;
      end if;
    end if;

    if not exists (
      select 1 from private.find_eligible_packages_with_answers(
        null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
      where private.vendor_matching_eligible(eligible.contractor_id)
    ) then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'no_eligible_provider',
        -- TRACE-112: for a chosen offering, why no single price level applies.
        'price_reason', case when wanted_package is not null then private.price_selection(
          private.package_content(wanted_package), wanted_frequency, wanted_tier::text, rule_answers, null) ->> 'reason' end)
        -- DEC-2026-041 item 7: which answers prevented an exact price, when any.
        || coalesce((select jsonb_build_object('price_blocking', b) from (select private.price_selection(
          private.package_content(wanted_package), wanted_frequency, wanted_tier::text, rule_answers, null) -> 'blocking' as b) s
          where wanted_package is not null and b is not null), '{}'::jsonb));
      continue;
    end if;

    select array_agg(eligible.package_id) into candidate_packages
    from private.find_eligible_packages_with_answers(
      null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
    where private.vendor_matching_eligible(eligible.contractor_id)
      and (selected_provider is null or eligible.contractor_id = selected_provider)
      and (wanted_package is null or eligible.package_id = wanted_package);

    select eligible.* into candidate
    from private.find_eligible_packages_with_answers(
      null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
    where private.vendor_matching_eligible(eligible.contractor_id)
      and (selected_provider is null or eligible.contractor_id = selected_provider)
      and (wanted_package is null or eligible.package_id = wanted_package)
    order by (eligible.path = 'fixed') desc, eligible.effective_price asc nulls last, eligible.rank_order
    limit 1;
    if candidate.contractor_id is null then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome',
        case when wanted_package is not null then 'package_unavailable' else 'preferred_provider_unavailable' end));
      continue;
    end if;

    chosen_promotion := null;
    depends_on_answers := false;
    if candidate.path = 'fixed' then
      chosen_mode := 'fixed';
      chosen_package := candidate.package_id;
      chosen_tier := candidate.package_tier_id;
      chosen_total := candidate.effective_price;
      chosen_promotion := candidate.promotion_id;
      if wanted_tier is not null and wanted_tier <> candidate.package_tier_id then
        select resolved.* into tier_price
        from public.package_tiers tier
        cross join lateral public.resolve_package_tier_price(tier.package_id, tier.id) resolved
        where tier.id = wanted_tier and tier.package_id = candidate.package_id
          and tier.frequency = wanted_frequency and tier.price > 0
          and private.pricing_tier_matches(private.pricing_tier_json(tier), rule_answers) is not false;
        if not found or coalesce(tier_price.effective_price, 0) <= 0 then
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable'));
          continue;
        end if;
        chosen_tier := wanted_tier;
        chosen_total := tier_price.effective_price;
        chosen_promotion := tier_price.promotion_id;
      end if;
      -- Without answers, an answer-based price level among the candidates may change the
      -- amount (or the offering) the submission will choose.
      if stage = 'availability' then
        depends_on_answers := exists (
          select 1 from public.package_tiers tier
          where tier.package_id = any(candidate_packages)
            and tier.frequency = wanted_frequency
            and (tier.rule_question_key is not null or jsonb_array_length(tier.rule_conditions) > 0));
      end if;
      -- TRACE-112: price the whole selection with the shared calculation: one price level,
      -- required and chosen add-ons. Exact only when every component has one fixed price.
      pricing := private.price_selection(private.package_content(chosen_package), wanted_frequency,
        coalesce(wanted_tier, chosen_tier)::text, rule_answers, addons_input);
      addon_cents := coalesce((pricing ->> 'total_cents')::bigint, (pricing ->> 'min_cents')::bigint, 0)
        - coalesce((pricing #>> '{lines,0,amount_cents}')::bigint, 0);
      if pricing ->> 'status' = 'invalid' then

        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package',
          'reason', pricing ->> 'reason'));
        continue;
      elsif pricing ->> 'status' = 'exact' then
        if pricing ->> 'tier_id' <> chosen_tier::text then
          select resolved.* into tier_price
          from public.resolve_package_tier_price(chosen_package, (pricing ->> 'tier_id')::uuid) resolved;
          if not found or coalesce(tier_price.effective_price, 0) <= 0 then

            outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable'));
            continue;
          end if;
          chosen_tier := (pricing ->> 'tier_id')::uuid;
          chosen_total := tier_price.effective_price;
          chosen_base := tier_price.base_price;
          chosen_promotion := tier_price.promotion_id;
        end if;
        -- Add-ons on top of the level (a legacy promotion overlay applies to the level only).
        if addon_cents <> 0 then chosen_total := chosen_total + round(addon_cents / 100.0, 2); end if;
      elsif pricing ->> 'status' = 'unresolved' then
        if stage = 'final' then
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable',
            'reason', pricing ->> 'reason')
            || case when pricing ? 'blocking' then jsonb_build_object('price_blocking', pricing -> 'blocking') else '{}'::jsonb end);
          continue;
        end if;
        depends_on_answers := true;
        if addon_cents <> 0 then chosen_total := chosen_total + round(addon_cents / 100.0, 2); end if;
      else
        -- An estimate needs the provider's confirmation: a quote request, never a charge.
        chosen_mode := 'custom_quote';
        chosen_tier := case when pricing ->> 'tier_id' is not null then (pricing ->> 'tier_id')::uuid end;
        chosen_total := null;
        chosen_base := null;
        chosen_promotion := null;
      end if;
    else
      chosen_mode := case when offering.id is not null then offering.pricing_mode else 'custom_quote' end;
      chosen_package := offering.id;
      chosen_tier := null;
      chosen_total := null;
      -- TRACE-112: a quote offering shows its estimate, if any, and validates add-ons.
      if chosen_package is not null then
        pricing := private.price_selection(private.package_content(chosen_package), wanted_frequency,
          null, rule_answers, addons_input);
        if pricing ->> 'status' = 'invalid' then

          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package',
            'reason', pricing ->> 'reason'));
          continue;
        end if;
      end if;
    end if;

    -- TRACE-112: the homeowner saw a specific package revision; a later edit is re-shown.
    if chosen_package is not null and selection ? 'package_revision'
      and selection ->> 'package_revision' <> private.package_revision_hash(chosen_package) then

      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'price_changed',
        'reason', 'revision_changed'));
      continue;
    end if;

    if stage = 'final' and chosen_package is not null then
      select array_agg(question.question_key order by question.sort_order) into missing_answers
      from public.package_qualifying_questions question
      where question.package_id = chosen_package and question.is_required is not false
        and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
      if missing_answers is not null then
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required',
          'questions', to_jsonb(missing_answers), 'package_id', chosen_package,
          'question_details', private.intake_package_questions(chosen_package)));
        continue;
      end if;
    end if;

    outcomes := outcomes || (outcome || jsonb_build_object(
      'outcome', case when chosen_mode = 'fixed' then 'eligible_fixed' else 'eligible_quote' end,
      'pricing_mode', case when chosen_mode = 'fixed' then 'fixed' else 'quote' end,
      'offering_mode', chosen_mode,
      'total', case when depends_on_answers then null else chosen_total end,
      'from_total', case when depends_on_answers then chosen_total end,
      'depends_on_answers', depends_on_answers,
      'promotion', chosen_promotion is not null,
      'package_id', chosen_package,
      'tier_id', chosen_tier,
      'question_details', case when chosen_package is not null
        then private.intake_package_questions(chosen_package) else '[]'::jsonb end,
      'scope', case when chosen_package is not null
        then private.intake_offering_scope(chosen_package, chosen_tier) end,
      -- TRACE-112: the calculation's status and lines, the estimate a quote shows, the
      -- add-on choices for this cadence and the revision the homeowner is looking at.
      'price_status', pricing ->> 'status',
      'price_reason', pricing ->> 'reason',
      'price_breakdown', pricing -> 'lines',
      'estimate', case when pricing ->> 'status' in ('estimate', 'unresolved') and pricing ? 'min_cents'
        and pricing ->> 'min_cents' is not null
        then jsonb_build_object('min', round((pricing ->> 'min_cents')::numeric / 100, 2),
          'max', round((pricing ->> 'max_cents')::numeric / 100, 2)) end,
      'deposit', case when pricing ->> 'deposit_cents' is not null then round((pricing ->> 'deposit_cents')::numeric / 100, 2) end,
      'addon_options', case when chosen_package is not null
        then private.intake_addon_options(chosen_package, wanted_frequency) else '[]'::jsonb end,
      'package_revision', case when chosen_package is not null
        then private.package_revision_hash(chosen_package) end));
  end loop;

  return jsonb_build_object('stage', stage, 'coverage', 'covered', 'outcomes', outcomes);
end
$function$

;

-- Request submission core: restated from 20261016002000; changes marked TRACE-112.
CREATE OR REPLACE FUNCTION private.submit_service_requests_core(p_submission_key text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  digest bytea;
  prior public.service_request_submissions;
  submission uuid;
  location jsonb;
  zip text;
  street text;
  city_name text;
  state_code text;
  window_start date;
  window_text text;
  area public.coverage_areas;
  selections jsonb;
  selection jsonb;
  selection_count integer;
  idx integer;
  seen_services text[] := '{}';
  service public.services_catalog;
  wanted_frequency text;
  selected_provider uuid;
  wanted_package uuid;
  wanted_tier uuid;
  offering public.vendor_packages;
  raw_answers jsonb;
  provisional_answers jsonb;
  labelled_answers jsonb;
  missing_answers text[];
  expected jsonb;
  request_id uuid;
  candidate record;
  chosen_mode text;
  chosen_package uuid;
  chosen_tier uuid;
  chosen_total numeric;
  chosen_base numeric;
  chosen_promotion uuid;
  tier_price record;
  addons_input jsonb;
  pricing jsonb;
  addon_cents bigint;
  outcome jsonb;
  outcomes jsonb := '[]'::jsonb;
  created jsonb := '[]'::jsonb;
  refused boolean := false;
  result jsonb;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_submission_key is null or p_submission_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid submission key' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid submission' using errcode = '22023';
  end if;

  -- Serialize one actor's key, then replay or refuse before re-evaluating anything.
  digest := sha256(convert_to(p_payload::text, 'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended(
    'service_request_submission:' || actor::text || ':' || p_submission_key, 0));
  select * into prior from public.service_request_submissions
  where customer_id = actor and submission_key = p_submission_key;
  if found then
    if prior.payload_hash <> digest then
      raise exception 'Submission key reused with a different request' using errcode = '22023';
    end if;
    return prior.result || jsonb_build_object('reused', true);
  end if;

  location := p_payload -> 'location';
  if jsonb_typeof(location) is distinct from 'object' then
    raise exception 'Service location required' using errcode = '22023';
  end if;
  zip := btrim(coalesce(location ->> 'zip_code', ''));
  if zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'Enter a valid five-digit ZIP code' using errcode = '22023';
  end if;
  zip := left(zip, 5);
  street := btrim(coalesce(location ->> 'address', ''));
  city_name := btrim(coalesce(location ->> 'city', ''));
  state_code := upper(btrim(coalesce(location ->> 'state', '')));
  if street = '' or length(street) > 200 or city_name = '' or length(city_name) > 100
    or state_code !~ '^[A-Z]{2}$' then
    raise exception 'Service address required' using errcode = '22023';
  end if;

  if nullif(p_payload ->> 'preferred_date', '') is not null then
    begin
      window_start := (p_payload ->> 'preferred_date')::date;
    exception when others then
      raise exception 'Invalid preferred date' using errcode = '22023';
    end;
    if window_start < (now() at time zone 'America/New_York')::date then
      raise exception 'The preferred start date cannot be in the past' using errcode = '22023';
    end if;
  end if;
  window_text := nullif(btrim(coalesce(p_payload ->> 'preferred_time', '')), '');
  if length(window_text) > 200 then
    raise exception 'Invalid preferred time' using errcode = '22023';
  end if;

  selections := p_payload -> 'selections';
  if jsonb_typeof(selections) is distinct from 'array' then
    raise exception 'Choose at least one service' using errcode = '22023';
  end if;
  selection_count := jsonb_array_length(selections);
  if selection_count < 1 or selection_count > 20 then
    raise exception 'Choose between 1 and 20 services' using errcode = '22023';
  end if;

  -- Geography alone does not establish supply, but no request exists outside it.
  select * into area from public.coverage_areas where zip_code = zip;
  if not coalesce(area.is_active, false) then
    return jsonb_build_object(
      'status', 'refused',
      'coverage', case when area.has_waitlist then 'waitlist' else 'uncovered' end,
      'outcomes', '[]'::jsonb, 'requests', '[]'::jsonb, 'reused', false);
  end if;

  begin
    for idx in 0 .. selection_count - 1 loop
      selection := selections -> idx;
      if jsonb_typeof(selection) is distinct from 'object' then
        raise exception 'Invalid service selection' using errcode = '22023';
      end if;
      wanted_frequency := selection ->> 'frequency';
      if wanted_frequency is null
        or wanted_frequency not in ('weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly', 'one-time') then
        raise exception 'Invalid service frequency' using errcode = '22023';
      end if;
      if coalesce(selection ->> 'service_id', '') !~ '^[a-z0-9-]{1,100}$' then
        raise exception 'Invalid service' using errcode = '22023';
      end if;
      if (selection ->> 'service_id') = any(seen_services) then
        raise exception 'Each service can be selected once' using errcode = '22023';
      end if;
      seen_services := seen_services || (selection ->> 'service_id');
      if length(coalesce(selection ->> 'description', '')) > 5000 then
        raise exception 'Service description is too long' using errcode = '22023';
      end if;
      begin
        selected_provider := nullif(selection ->> 'preferred_contractor_id', '')::uuid;
        wanted_package := nullif(selection ->> 'package_id', '')::uuid;
        wanted_tier := nullif(selection ->> 'tier_id', '')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid provider or offering identifier' using errcode = '22023';
      end;
      if wanted_tier is not null and wanted_package is null then
        raise exception 'A tier requires its offering' using errcode = '22023';
      end if;
      raw_answers := coalesce(selection -> 'answers', '{}'::jsonb);
      if jsonb_typeof(raw_answers) <> 'object'
        or (select count(*) from jsonb_object_keys(raw_answers)) > 50
        or exists (select 1 from jsonb_each(raw_answers) answer
          where jsonb_typeof(answer.value) not in ('string', 'number')
            or length(answer.value #>> '{}') > 200) then
        raise exception 'Invalid qualifying answers' using errcode = '22023';
      end if;
      select coalesce(jsonb_object_agg(answer.key, jsonb_build_object('answer', btrim(answer.value #>> '{}'))), '{}'::jsonb)
      into provisional_answers
      from jsonb_each(raw_answers) answer
      where btrim(answer.value #>> '{}') <> '';
      expected := selection -> 'expected';
      addons_input := private.intake_addons_input(selection);
      pricing := null;

      outcome := jsonb_build_object('selection_index', idx, 'service_id', selection ->> 'service_id');

      select * into service from public.services_catalog
      where id = selection ->> 'service_id' and is_active = true;
      if not found then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'service_not_offered'));
        continue;
      end if;
      if selected_provider is not null and not exists (select 1 from public.contractors where id = selected_provider) then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_provider'));
        continue;
      end if;
      offering := null;
      if wanted_package is not null then
        select * into offering from public.vendor_packages where id = wanted_package;
        if not found or offering.service_id <> service.id
          or (selected_provider is not null and offering.contractor_id <> selected_provider)
          or (wanted_tier is not null and not exists (select 1 from public.package_tiers
            where id = wanted_tier and package_id = wanted_package)) then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package'));
          continue;
        end if;
        -- Rule tiers need their answers to be found at all, so report missing answers first.
        select array_agg(question.question_key order by question.sort_order) into missing_answers
        from public.package_qualifying_questions question
        where question.package_id = offering.id and question.is_required is not false
          and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
        if missing_answers is not null then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required', 'questions', to_jsonb(missing_answers)));
          continue;
        end if;
      end if;

      -- The eligibility core reads the request row, so evaluate a provisional row and roll
      -- the whole plan back below if any selection is refused.
      insert into public.service_requests (
        customer_id, service_type, service_catalog_id, address, city, state, zip_code,
        preferred_date, preferred_time, description, frequency, preferred_contractor_id,
        contractor_id, package_id, package_tier_id, package_question_answers,
        pricing_mode, quote_only, total_amount, status, matching_status)
      values (
        actor, service.name, service.id, street, city_name, state_code, zip,
        window_start, window_text, nullif(btrim(coalesce(selection ->> 'description', '')), ''),
        wanted_frequency, selected_provider, null, wanted_package, wanted_tier, provisional_answers,
        'custom_quote', true, null, 'pending', 'awaiting_match')
      returning id into request_id;

      if not exists (select 1 from private.find_eligible_packages_core(request_id)) then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'no_eligible_provider',
          -- TRACE-112: for a chosen offering, why no single price level applies.
          'price_reason', case when wanted_package is not null then private.price_selection(
            private.package_content(wanted_package), wanted_frequency, wanted_tier::text, provisional_answers, null) ->> 'reason' end)
          -- DEC-2026-041 item 7: which answers prevented an exact price, when any.
          || coalesce((select jsonb_build_object('price_blocking', b) from (select private.price_selection(
            private.package_content(wanted_package), wanted_frequency, wanted_tier::text, provisional_answers, null) -> 'blocking' as b) s
            where wanted_package is not null and b is not null), '{}'::jsonb));
        continue;
      end if;

      select eligible.* into candidate
      from private.find_eligible_packages_core(request_id) eligible
      where (selected_provider is null or eligible.contractor_id = selected_provider)
        and (wanted_package is null or eligible.package_id = wanted_package)
      order by (eligible.path = 'fixed') desc, eligible.effective_price asc nulls last, eligible.rank_order
      limit 1;
      if candidate.contractor_id is null then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome',
          case when wanted_package is not null then 'package_unavailable' else 'preferred_provider_unavailable' end));
        continue;
      end if;

      chosen_base := null;
      chosen_promotion := null;
      if candidate.path = 'fixed' then
        chosen_mode := 'fixed';
        chosen_package := candidate.package_id;
        chosen_tier := candidate.package_tier_id;
        chosen_total := candidate.effective_price;
        chosen_base := candidate.base_price;
        chosen_promotion := candidate.promotion_id;
        -- The core returns the lowest eligible tier; an explicitly chosen tier must itself
        -- match this frequency and the qualifying answers.
        if wanted_tier is not null and wanted_tier <> candidate.package_tier_id then
          select resolved.* into tier_price
          from public.package_tiers tier
          cross join lateral public.resolve_package_tier_price(tier.package_id, tier.id) resolved
          where tier.id = wanted_tier and tier.package_id = candidate.package_id
            and tier.frequency = wanted_frequency and tier.price > 0
            and private.pricing_tier_matches(private.pricing_tier_json(tier), provisional_answers) is not false;
          if not found or coalesce(tier_price.effective_price, 0) <= 0 then
            refused := true;
            outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable'));
            continue;
          end if;
          chosen_tier := wanted_tier;
          chosen_total := tier_price.effective_price;
          chosen_base := tier_price.base_price;
          chosen_promotion := tier_price.promotion_id;
        end if;
        -- TRACE-112: price the whole selection with the shared calculation: one price level,
        -- required and chosen add-ons. Exact only when every component has one fixed price.
        pricing := private.price_selection(private.package_content(chosen_package), wanted_frequency,
          coalesce(wanted_tier, chosen_tier)::text, provisional_answers, addons_input);
        addon_cents := coalesce((pricing ->> 'total_cents')::bigint, (pricing ->> 'min_cents')::bigint, 0)
          - coalesce((pricing #>> '{lines,0,amount_cents}')::bigint, 0);
        if pricing ->> 'status' = 'invalid' then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package',
            'reason', pricing ->> 'reason'));
          continue;
        elsif pricing ->> 'status' = 'exact' then
          if pricing ->> 'tier_id' <> chosen_tier::text then
            select resolved.* into tier_price
            from public.resolve_package_tier_price(chosen_package, (pricing ->> 'tier_id')::uuid) resolved;
            if not found or coalesce(tier_price.effective_price, 0) <= 0 then
              refused := true;
              outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable'));
              continue;
            end if;
            chosen_tier := (pricing ->> 'tier_id')::uuid;
            chosen_total := tier_price.effective_price;
            chosen_base := tier_price.base_price;
            chosen_promotion := tier_price.promotion_id;
          end if;
          -- Add-ons on top of the level (a legacy promotion overlay applies to the level only).
          if addon_cents <> 0 then chosen_total := chosen_total + round(addon_cents / 100.0, 2); end if;
        elsif pricing ->> 'status' = 'unresolved' then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable',
            'reason', pricing ->> 'reason')
            || case when pricing ? 'blocking' then jsonb_build_object('price_blocking', pricing -> 'blocking') else '{}'::jsonb end);
          continue;
        else
          -- An estimate needs the provider's confirmation: a quote request, never a charge.
          chosen_mode := 'custom_quote';
          chosen_tier := case when pricing ->> 'tier_id' is not null then (pricing ->> 'tier_id')::uuid end;
          chosen_total := null;
          chosen_base := null;
          chosen_promotion := null;
        end if;
      else
        chosen_mode := case when offering.id is not null then offering.pricing_mode else 'custom_quote' end;
        chosen_package := offering.id;
        chosen_tier := null;
        chosen_total := null;
        -- TRACE-112: a quote offering shows its estimate, if any, and validates add-ons.
        if chosen_package is not null then
          pricing := private.price_selection(private.package_content(chosen_package), wanted_frequency,
            null, provisional_answers, addons_input);
          if pricing ->> 'status' = 'invalid' then
            refused := true;
            outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package',
              'reason', pricing ->> 'reason'));
            continue;
          end if;
        end if;
      end if;

      -- TRACE-112: the homeowner saw a specific package revision; a later edit is re-shown.
      if chosen_package is not null and selection ? 'package_revision'
        and selection ->> 'package_revision' <> private.package_revision_hash(chosen_package) then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'price_changed',
          'reason', 'revision_changed'));
        continue;
      end if;

      if chosen_package is not null then
        select array_agg(question.question_key order by question.sort_order) into missing_answers
        from public.package_qualifying_questions question
        where question.package_id = chosen_package and question.is_required is not false
          and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
        if missing_answers is not null then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required', 'questions', to_jsonb(missing_answers)));
          continue;
        end if;
      end if;
      select coalesce(jsonb_object_agg(question.question_key, jsonb_build_object(
          'question', question.question_label,
          'answer', provisional_answers -> question.question_key ->> 'answer',
          'unit', nullif(question.unit, ''))), '{}'::jsonb)
      into labelled_answers
      from public.package_qualifying_questions question
      where question.package_id = chosen_package
        and coalesce(provisional_answers -> question.question_key ->> 'answer', '') <> '';

      -- The homeowner must have seen this pricing mode and amount; a mismatch is re-shown.
      if jsonb_typeof(expected) = 'object' and (
        (chosen_mode = 'fixed') is distinct from (expected ->> 'pricing_mode' = 'fixed')
        or (chosen_mode = 'fixed' and (jsonb_typeof(expected -> 'total') <> 'number'
          or round((expected ->> 'total')::numeric, 2) <> round(chosen_total, 2)))) then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'price_changed',
          'pricing_mode', case when chosen_mode = 'fixed' then 'fixed' else 'quote' end,
          'total', chosen_total));
        continue;
      end if;

      update public.service_requests
      set pricing_mode = chosen_mode,
          quote_only = chosen_mode <> 'fixed',
          total_amount = chosen_total,
          base_amount = case when chosen_promotion is not null then chosen_base end,
          promotion_id = chosen_promotion,
          package_id = chosen_package,
          package_tier_id = chosen_tier,
          package_question_answers = labelled_answers,
          -- TRACE-112: the priced selection and the package revision it was priced from.
          -- A copy: later catalog edits never change it.
          pricing_inputs = case when chosen_package is not null then jsonb_build_object(
            'version', 'pricing-v2', 'package_id', chosen_package,
            'lineage_id', (select p.lineage_id from public.vendor_packages p where p.id = chosen_package),
            'revision_number', (select p.revision_number from public.vendor_packages p where p.id = chosen_package),
            'package_revision', private.package_revision_hash(chosen_package),
            'frequency', wanted_frequency, 'answers', labelled_answers, 'priced_at', now())
            || coalesce(pricing, '{}'::jsonb) end
      where id = request_id;

      outcomes := outcomes || (outcome || jsonb_build_object(
        'outcome', case when chosen_mode = 'fixed' then 'eligible_fixed' else 'eligible_quote' end,
        'pricing_mode', case when chosen_mode = 'fixed' then 'fixed' else 'quote' end,
        'total', chosen_total,
        'price_status', pricing ->> 'status',
        'estimate', case when pricing ->> 'status' in ('estimate', 'unresolved') and pricing ->> 'min_cents' is not null
          then jsonb_build_object('min', round((pricing ->> 'min_cents')::numeric / 100, 2),
            'max', round((pricing ->> 'max_cents')::numeric / 100, 2)) end));
      created := created || jsonb_build_object(
        'selection_index', idx, 'request_id', request_id, 'service_id', service.id,
        'pricing_mode', chosen_mode, 'quote_only', chosen_mode <> 'fixed',
        'total_amount', chosen_total, 'package_id', chosen_package, 'package_tier_id', chosen_tier);
    end loop;

    if refused then
      raise exception 'Submission refused' using errcode = 'MR095';
    end if;
  exception when sqlstate 'MR095' then
    -- Local variables survive the rollback of the provisional rows.
    return jsonb_build_object('status', 'refused', 'coverage', 'covered',
      'outcomes', outcomes, 'requests', '[]'::jsonb, 'reused', false);
  end;

  result := jsonb_build_object('status', 'submitted', 'coverage', 'covered',
    'outcomes', outcomes, 'requests', created);
  insert into public.service_request_submissions (customer_id, submission_key, payload_hash, result)
  values (actor, p_submission_key, digest, result)
  returning id into submission;
  insert into public.service_request_submission_items (submission_id, selection_index, service_request_id)
  select submission, (item ->> 'selection_index')::integer, (item ->> 'request_id')::uuid
  from jsonb_array_elements(created) item;

  return result || jsonb_build_object('reused', false);
end
$function$

;

-- Operator drafts ------------------------------------------------------------------


-- Checkout commercial source: restated from 20260905010000; changes marked TRACE-112.
create or replace function private.money_source(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
begin
  lock table public.package_promotions,public.package_qualifying_questions in share mode;
  select * into strict r from public.service_requests where id=p_request;
  if r.customer_id is null or r.contractor_id is null or r.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') then
    raise exception 'Scheduled commercial parties required';
  end if;
  request_context:=private.money_source_context(r);
  if r.current_quote_id is not null then
    select * into strict q from public.request_quotes where id=r.current_quote_id for share;
    if q.request_id<>r.id or q.revision<>r.quote_revision or q.status<>'accepted' or r.quote_status is distinct from 'accepted'
      or q.decision_actor is distinct from r.customer_id or q.decided_at is null or q.decided_at<q.sent_at or q.decided_at>=q.expires_at then
      raise exception 'Current homeowner-accepted quote required';
    end if;
    if not exists(select 1 from public.money_quote_contexts where quote_id=q.id and money_quote_contexts.context=request_context-'contractor') then
      raise exception 'Quote scope unverified or changed; send a new revision';
    end if;
    -- Existing admin/homeowner UI calls amount the total. Never silently add tax,
    -- tips or extras on top of that accepted amount. Its allocation is reviewed.
    price:=private.money_minor_units(q.amount);
    evidence:=jsonb_build_object('kind','quote','context',request_context,'quote',to_jsonb(q),'total',price);
  else
    if r.quote_only is true or r.pricing_mode is distinct from 'fixed' or r.quote_status is not null then
      raise exception 'Versioned quote required';
    end if;
    select * into strict p from public.vendor_packages where id=r.package_id for share;
    select * into strict t from public.package_tiers where id=r.package_tier_id for share;
    if p.contractor_id<>r.contractor_id or p.service_id is distinct from r.service_catalog_id
      or t.package_id<>p.id or p.pricing_mode<>'fixed' or not p.is_active or p.needs_review is true
      or r.frequency is null or t.frequency is distinct from r.frequency
      or not exists(select 1 from public.resolve_package_tier_price(p.id,t.id)) then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.contractors where id=p.contractor_id and is_active and marketing_enabled for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.services_catalog where id=p.service_id and is_active for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.coverage_areas where zip_code=r.zip_code and is_active for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.contractor_service_zips where contractor_id=p.contractor_id and zip_code=r.zip_code for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    if t.rule_question_key is not null then
      if coalesce(r.package_question_answers->t.rule_question_key->>'answer','') !~ '^-?[0-9]+([.][0-9]+)?$' then
        raise exception 'Offering answers do not match selected tier';
      end if;
      if (t.rule_min is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric<t.rule_min)
        or (t.rule_max is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric>t.rule_max) then
        raise exception 'Offering answers do not match selected tier';
      end if;
    end if;
    -- TRACE-112: every rule condition of the tier must hold, as at submission.
    if private.pricing_tier_matches(private.pricing_tier_json(t), r.package_question_answers) is not true then
      raise exception 'Offering answers do not match selected tier';
    end if;
    -- TRACE-112: the reviewed snapshot verifies the service amount against the tier only and
    -- nothing verifies add-ons yet, so a request priced with add-ons stops here (fail closed)
    -- until the commercial source carries them (R1 money gate).
    if r.pricing_inputs->>'version' = 'pricing-v2'
      and exists(select 1 from jsonb_array_elements(coalesce(r.pricing_inputs->'lines','[]'::jsonb)) l where l->>'kind'='addon') then
      raise exception 'Offering add-ons need commercial-source integration';
    end if;
    perform 1 from public.package_qualifying_questions where package_id=p.id for share;
    if exists(select 1 from public.package_qualifying_questions x where x.package_id=p.id and x.is_required
      and nullif(btrim(r.package_question_answers->x.question_key->>'answer'),'') is null) then
      raise exception 'Required offering answers missing';
    end if;
    -- Promotions have unresolved funding/allocation authority. Do not silently
    -- charge base price when an advertised promotion may apply.
    if r.promotion_id is not null or exists(select 1 from public.package_promotions where package_id=p.id and is_enabled and starts_at<=now() and ends_at>now()) then
      raise exception 'Promotion allocation integration required';
    end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into questions from public.package_qualifying_questions x where x.package_id=p.id;
    price:=private.money_minor_units(t.price);
    evidence:=jsonb_build_object('kind','offering','context',request_context,'package',to_jsonb(p),'tier',to_jsonb(t),'questions',questions,'service',price);
  end if;
  return evidence||jsonb_build_object('version','commercial-v1:'||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
end $$;

revoke all on function private.money_source(uuid) from public, anon, authenticated, service_role;
