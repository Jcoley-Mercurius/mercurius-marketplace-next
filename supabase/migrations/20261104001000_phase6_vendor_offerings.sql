-- Phase 6.11A / TRACE-134: vendor offering versions, write boundaries and exact coverage.
-- Record: governance/PHASE-6-VENDOR-OFFERINGS-BRIEF.md §8. Additive; requires 20261103001000.
-- Decisions: DEC-2026-055 item 2 (vendors publish and pause their own fixed offerings inside the
-- guardrail), DEC-2026-039 item 2 (a change is a new revision of the lineage; earlier bookings keep
-- theirs), DEC-2026-047 (archived prices are read-only history).
--
-- 1. A package version is immutable once it is live or in use (a request, match attempt or recurring
--    plan names it or one of its price levels), on every path: package content columns, price
--    levels, add-ons and questions refuse INSERT/UPDATE/DELETE, and the package refuses DELETE
--    (F611-1: an editor save or a delete set request references to NULL). A version created in this
--    transaction is still being built (operator publication inserts its rows live). Pausing and the
--    review flag stay writable; operator pause/archive commands are unchanged.
-- 2. vendor_save_package: one keyed, stale-guarded call saves a vendor's offering. A paused version
--    no one has used is rewritten in place; otherwise the content becomes the next revision of the
--    lineage, and publishing it pauses the live one. vendor_set_package_active publishes or pauses a
--    version; only the newest revision can go live, and one revision per lineage is live.
-- 3. The guardrail applies on the server to Managed Pricing (template) packages too: out-of-band
--    template prices go to Package Reviews whatever the browser sends.
-- 4. Vendors no longer write legacy package_promotions (F611-2) or their service ZIP codes
--    (F611-3); operator policies are unchanged. Service ZIP codes are five digits.
--
-- Not changed: money and payout kernels, money_source (TRACE-126/127 stay open: a replacement still
-- pauses the version an unpaid request was priced from, as operator publication already does),
-- matching, operator publication, suspension and archive, catalog, drafts and internal notes.

-- ── Version immutability ─────────────────────────────────────────────────────────────────────────

-- Volatile so each call in a trigger reads rows committed by concurrent transactions.
create or replace function private.package_in_use(p_package uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (select 1 from public.service_requests r
      where r.package_id = p_package
         or r.package_tier_id in (select t.id from public.package_tiers t where t.package_id = p_package))
    or exists (select 1 from public.job_match_attempts a
      where a.package_id = p_package
         or a.package_tier_id in (select t.id from public.package_tiers t where t.package_id = p_package))
    or exists (select 1 from private.recurring_series_terms s where s.package_id = p_package)
$$;
revoke all on function private.package_in_use(uuid) from public, anon, authenticated;

create or replace function private.vendor_package_version_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  building boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_active then
      raise exception 'Pause this price before deleting it' using errcode = '55000';
    end if;
    if private.package_in_use(old.id) then
      raise exception 'Requests use this price version; it is kept as history and cannot be deleted' using errcode = '55000';
    end if;
    if exists (select 1 from private.operator_package_drafts d where d.package_id = old.id or d.target_package_id = old.id)
       or exists (select 1 from private.vendor_package_price_corrections c where c.package_id = old.id) then
      raise exception 'Mercurius published or corrected this price; it is kept as history and cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    building := old.created_at = now();
    if (new.contractor_id, new.service_id, new.template_id, new.name, new.description, new.pricing_mode,
        new.default_frequency, new.deposit_amount, new.included_scope, new.revision_number)
       is distinct from
       (old.contractor_id, old.service_id, old.template_id, old.name, old.description, old.pricing_mode,
        old.default_frequency, old.deposit_amount, old.included_scope, old.revision_number) then
      if old.is_active and not building then
        raise exception 'This price is live; save your changes as a new version' using errcode = '55000';
      end if;
      if private.package_in_use(old.id) then
        raise exception 'Requests use this price version; save your changes as a new version' using errcode = '55000';
      end if;
    end if;
    if new.policy_notes is distinct from old.policy_notes and private.package_in_use(old.id) then
      raise exception 'Requests use this price version; its notes are part of what they were priced from' using errcode = '55000';
    end if;
  end if;

  -- Only the newest revision goes live (one live revision per lineage is the existing unique index).
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    if exists (select 1 from public.vendor_packages p
        where p.lineage_id = coalesce(new.lineage_id, new.id) and p.revision_number > new.revision_number) then
      raise exception 'A newer version of this price exists; publish that version instead' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.vendor_package_version_guard() from public, anon, authenticated;

create trigger trg_vendor_package_version_guard
  before insert or update or delete on public.vendor_packages
  for each row execute function private.vendor_package_version_guard();

create or replace function private.package_part_version_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pkg uuid;
  parent public.vendor_packages;
begin
  foreach pkg in array array_remove(array[
      case when tg_op <> 'INSERT' then old.package_id end,
      case when tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.package_id is distinct from old.package_id) then new.package_id end], null) loop
    -- Serialize with publishing or pausing the version. A parent deleted by this statement (a
    -- cascade from an allowed package delete) is no longer visible and needs no guard.
    select * into parent from public.vendor_packages p where p.id = pkg for no key update;
    continue when not found;
    if parent.is_active and parent.created_at <> now() then
      raise exception 'This price is live; save your changes as a new version' using errcode = '55000';
    end if;
    if private.package_in_use(pkg) then
      raise exception 'Requests use this price version; save your changes as a new version' using errcode = '55000';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.package_part_version_guard() from public, anon, authenticated;

create trigger trg_package_tiers_version_guard
  before insert or update or delete on public.package_tiers
  for each row execute function private.package_part_version_guard();
create trigger trg_package_addons_version_guard
  before insert or update or delete on public.package_addons
  for each row execute function private.package_part_version_guard();
create trigger trg_package_questions_version_guard
  before insert or update or delete on public.package_qualifying_questions
  for each row execute function private.package_part_version_guard();

-- ── Managed Pricing guardrail on the server ─────────────────────────────────────────────────────

-- The vendor editor's rule (TRACE-112 guardrail): every level within its template level's range and
-- every offered add-on within its template add-on's range.
create or replace function private.template_package_needs_review(p_package uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.package_tiers t
      left join public.pricing_template_tiers tt on tt.id = t.template_tier_id
      where t.package_id = p_package
        and (tt.id is null or t.price is null or t.price < tt.min_price or t.price > tt.max_price))
    or exists (select 1 from public.package_addons a
      left join public.pricing_template_addons ta on ta.id = a.template_addon_id
      where a.package_id = p_package and a.is_offered
        and (ta.id is null or a.price < ta.price_min or a.price > ta.price_max))
$$;
revoke all on function private.template_package_needs_review(uuid) from public, anon, authenticated;

create or replace function public.enforce_custom_package_price_review_flag()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT COALESCE(public.has_role(auth.uid(), 'admin'), false) THEN
    IF NEW.template_id IS NULL AND NEW.pricing_mode = 'fixed' THEN
      NEW.needs_review := public.custom_package_price_needs_review(NEW.id);
    -- TRACE-134: a Managed Pricing package's flag is computed here too, never taken from the browser.
    ELSIF NEW.template_id IS NOT NULL THEN
      NEW.needs_review := private.template_package_needs_review(NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function private.refresh_template_package_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pkg uuid := case when tg_op = 'DELETE' then old.package_id else new.package_id end;
begin
  update public.vendor_packages p set needs_review = private.template_package_needs_review(pkg)
   where p.id = pkg and p.template_id is not null
     and p.needs_review is distinct from private.template_package_needs_review(pkg);
  return null;
end $$;
revoke all on function private.refresh_template_package_review() from public, anon, authenticated;

create trigger trg_refresh_template_review_from_tier
  after insert or update or delete on public.package_tiers
  for each row execute function private.refresh_template_package_review();
create trigger trg_refresh_template_review_from_addon
  after insert or update or delete on public.package_addons
  for each row execute function private.refresh_template_package_review();

-- ── Vendor commands ─────────────────────────────────────────────────────────────────────────────

create table private.vendor_package_saves (
  actor uuid not null,
  save_key text not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor, save_key)
);
revoke all on private.vendor_package_saves from public, anon, authenticated;

create or replace function private.vendor_package_owner()
returns public.contractors
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  vendor public.contractors;
begin
  if actor is null or not public.has_role(actor, 'vendor') then
    raise exception 'Vendor access required' using errcode = '42501';
  end if;
  -- Serializes this vendor's saves with each other and with operator publication; no key lock, so
  -- requests naming the vendor are not blocked.
  select * into vendor from public.contractors c where c.user_id = actor for no key update;
  if not found then
    raise exception 'This account is not linked to a vendor profile' using errcode = '42501';
  end if;
  return vendor;
end $$;
revoke all on function private.vendor_package_owner() from public, anon, authenticated;

-- Writes a version's levels, add-ons and questions from the editor's rows. The existing triggers
-- (price meaning, archive, review flag) validate them as they validate direct writes.
create or replace function private.vendor_package_write_parts(p_package uuid, p_template uuid, p_content jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  offered text[];
  default_frequency text;
begin
  if jsonb_typeof(coalesce(p_content -> 'questions', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_content -> 'tiers', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_content -> 'addons', '[]')) <> 'array' then
    raise exception 'Questions, price levels and add-ons are lists' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_content -> 'questions', '[]')) > 10
     or jsonb_array_length(coalesce(p_content -> 'tiers', '[]')) > 24
     or jsonb_array_length(coalesce(p_content -> 'addons', '[]')) > 20 then
    raise exception 'Use at most 10 questions, 24 price levels and 20 add-ons' using errcode = '22023';
  end if;
  -- The catalog's cadence list limits every vendor's cadences (DEC-2026-051 item 7 left unchanged).
  select coalesce(s.available_frequencies, '{}'), p.default_frequency into offered, default_frequency
    from public.vendor_packages p join public.services_catalog s on s.id = p.service_id where p.id = p_package;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_content -> 'tiers', '[]')) t(frequency text)
        where private.pricing_cadence_rank(t.frequency) is null
           or (cardinality(offered) > 0 and not t.frequency = any(offered)))
     or (cardinality(offered) > 0 and not default_frequency = any(offered)) then
    raise exception 'Use only the cadences this service offers in the catalog' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_content -> 'tiers', '[]')) t(template_tier_id uuid)
      where (p_template is null and t.template_tier_id is not null)
         or (p_template is not null and not exists (select 1 from public.pricing_template_tiers tt
               where tt.id = t.template_tier_id and tt.template_id = p_template))) then
    raise exception 'A price level does not belong to this pricing template' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_content -> 'addons', '[]')) a(template_addon_id uuid)
      where a.template_addon_id is not null and (p_template is null or not exists (
        select 1 from public.pricing_template_addons ta where ta.id = a.template_addon_id and ta.template_id = p_template))) then
    raise exception 'An add-on does not belong to this pricing template' using errcode = '22023';
  end if;

  insert into public.package_qualifying_questions(package_id, question_key, question_label, input_type, unit, options, is_required, sort_order)
    select p_package, q.question_key, q.question_label, coalesce(q.input_type, 'number'), nullif(q.unit, ''), q.options,
           coalesce(q.is_required, true), coalesce(q.sort_order, q.ord::integer - 1)
      from rows from (jsonb_to_recordset(coalesce(p_content -> 'questions', '[]')) as (question_key text, question_label text, input_type text, unit text, options jsonb, is_required boolean, sort_order integer)) with ordinality
           q(question_key, question_label, input_type, unit, options, is_required, sort_order, ord);
  insert into public.package_tiers(package_id, template_tier_id, name, price, price_kind, price_max, frequency,
      rule_question_key, rule_min, rule_max, rule_conditions, includes, sort_order)
    select p_package, t.template_tier_id, t.name, t.price, coalesce(t.price_kind, 'exact'), t.price_max, t.frequency,
           nullif(t.rule_question_key, ''), t.rule_min, t.rule_max, coalesce(t.rule_conditions, '[]'::jsonb), coalesce(t.includes, '{}'),
           coalesce(t.sort_order, t.ord::integer - 1)
      from rows from (jsonb_to_recordset(coalesce(p_content -> 'tiers', '[]')) as (template_tier_id uuid, name text, price numeric, price_kind text, price_max numeric, frequency text, rule_question_key text, rule_min numeric, rule_max numeric, rule_conditions jsonb, includes text[], sort_order integer)) with ordinality
           t(template_tier_id, name, price, price_kind, price_max, frequency, rule_question_key, rule_min, rule_max, rule_conditions, includes, sort_order, ord);
  insert into public.package_addons(package_id, template_addon_id, name, description, price, price_kind, price_max,
      unit_label, min_quantity, max_quantity, is_required, frequencies, sort_order, is_offered)
    select p_package, a.template_addon_id, nullif(btrim(a.name), ''), nullif(btrim(a.description), ''), a.price,
           coalesce(a.price_kind, 'exact'), a.price_max, nullif(a.unit_label, ''), coalesce(a.min_quantity, 0),
           coalesce(a.max_quantity, 1), coalesce(a.is_required, false), coalesce(a.frequencies, '{}'),
           coalesce(a.sort_order, a.ord::integer - 1), coalesce(a.is_offered, true)
      from rows from (jsonb_to_recordset(coalesce(p_content -> 'addons', '[]')) as (template_addon_id uuid, name text, description text, price numeric, price_kind text, price_max numeric, unit_label text, min_quantity integer, max_quantity integer, is_required boolean, frequencies text[], sort_order integer, is_offered boolean)) with ordinality
           a(template_addon_id, name, description, price, price_kind, price_max, unit_label, min_quantity, max_quantity, is_required, frequencies, sort_order, is_offered, ord);
end $$;
revoke all on function private.vendor_package_write_parts(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function private.vendor_package_publish(p_package uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pkg public.vendor_packages;
  paused uuid;
begin
  select * into pkg from public.vendor_packages p where p.id = p_package;
  if exists (select 1 from public.vendor_packages p where p.lineage_id = pkg.lineage_id and p.revision_number > pkg.revision_number) then
    raise exception 'A newer version of this price exists; publish that version instead' using errcode = '55000';
  end if;
  update public.vendor_packages p set is_active = false
   where p.lineage_id = pkg.lineage_id and p.id <> pkg.id and p.is_active returning p.id into paused;
  update public.vendor_packages p set is_active = true where p.id = pkg.id;
  return paused;
end $$;
revoke all on function private.vendor_package_publish(uuid) from public, anon, authenticated;

create or replace function public.vendor_save_package(p_package uuid, p_expected_revision text, p_content jsonb,
  p_publish boolean, p_save_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  vendor public.contractors;
  digest text;
  prior private.vendor_package_saves;
  source public.vendor_packages;
  fields jsonb := coalesce(p_content -> 'package', '{}'::jsonb);
  v_service text;
  v_template uuid;
  lineage uuid;
  next_revision integer := 1;
  in_place boolean := false;
  target uuid;
  replaced uuid;
  saved public.vendor_packages;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_save_key is null or p_save_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid save key' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or jsonb_typeof(fields) <> 'object' then
    raise exception 'Package content is required' using errcode = '22023';
  end if;

  -- Replay or refuse a reused key before reading anything else.
  digest := encode(sha256(convert_to(jsonb_build_object('package', p_package, 'expected', p_expected_revision,
    'content', p_content, 'publish', coalesce(p_publish, false))::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('vendor_package_save:' || actor::text || ':' || p_save_key, 0));
  select * into prior from private.vendor_package_saves s where s.actor = auth.uid() and s.save_key = p_save_key;
  if found then
    if prior.payload_hash <> digest then
      raise exception 'Save key reused with different content' using errcode = '22023';
    end if;
    return prior.result || jsonb_build_object('reused', true);
  end if;

  vendor := private.vendor_package_owner();

  if p_package is not null then
    select * into source from public.vendor_packages p where p.id = p_package for no key update;
    if not found or source.contractor_id <> vendor.id then
      raise exception 'Price not found' using errcode = 'P0002';
    end if;
    if private.package_archived(source.id) then
      raise exception 'Mercurius archived this price; it is kept as read-only history' using errcode = '55000';
    end if;
    perform 1 from public.vendor_packages p where p.lineage_id = source.lineage_id for no key update;
    if exists (select 1 from public.vendor_packages p where p.lineage_id = source.lineage_id and p.revision_number > source.revision_number) then
      raise exception 'A newer version of this price was saved; reload before saving' using errcode = '40001';
    end if;
    if p_expected_revision is null or p_expected_revision <> private.package_revision_hash(source.id) then
      raise exception 'This price changed since it was read; reload before saving' using errcode = '40001';
    end if;
    v_service := source.service_id;
    v_template := source.template_id;
    lineage := source.lineage_id;
    in_place := not source.is_active and not private.package_in_use(source.id);
  else
    v_service := p_content ->> 'service_id';
    v_template := nullif(p_content ->> 'template_id', '')::uuid;
    if not exists (select 1 from public.services_catalog s where s.id = v_service and s.is_active) then
      raise exception 'Choose an active catalog service' using errcode = '22023';
    end if;
    if v_template is not null and not exists (select 1 from public.pricing_templates t
        where t.id = v_template and t.is_active and t.service_id = v_service) then
      raise exception 'Choose an active pricing template for this service' using errcode = '22023';
    end if;
  end if;

  if in_place then
    target := source.id;
    delete from public.package_qualifying_questions q where q.package_id = target;
    delete from public.package_tiers t where t.package_id = target;
    delete from public.package_addons a where a.package_id = target;
    update public.vendor_packages p set
        name = fields ->> 'name', description = nullif(fields ->> 'description', ''),
        pricing_mode = coalesce(fields ->> 'pricing_mode', 'fixed'),
        default_frequency = coalesce(fields ->> 'default_frequency', 'one-time'),
        deposit_amount = (fields ->> 'deposit_amount')::numeric,
        included_scope = coalesce(array(select jsonb_array_elements_text(fields -> 'included_scope')), '{}')
      where p.id = target;
  else
    if lineage is not null then
      select max(p.revision_number) + 1 into next_revision from public.vendor_packages p where p.lineage_id = lineage;
    end if;
    insert into public.vendor_packages(contractor_id, service_id, template_id, name, description, pricing_mode,
        default_frequency, deposit_amount, included_scope, sort_order, is_active, needs_review, lineage_id, revision_number)
      values (vendor.id, v_service, v_template, fields ->> 'name', nullif(fields ->> 'description', ''),
        coalesce(fields ->> 'pricing_mode', 'fixed'), coalesce(fields ->> 'default_frequency', 'one-time'),
        (fields ->> 'deposit_amount')::numeric,
        coalesce(array(select jsonb_array_elements_text(fields -> 'included_scope')), '{}'),
        coalesce(source.sort_order, 0), false, false, lineage, next_revision)
      returning id into target;
  end if;
  perform private.vendor_package_write_parts(target, v_template, p_content);

  update public.vendor_packages p set needs_review = case when p.template_id is null
      then public.custom_package_price_needs_review(p.id) else private.template_package_needs_review(p.id) end
    where p.id = target;
  if coalesce(p_publish, false) then
    replaced := private.vendor_package_publish(target);
  end if;

  select * into saved from public.vendor_packages p where p.id = target;
  result := jsonb_build_object('package_id', saved.id, 'lineage_id', saved.lineage_id,
    'revision_number', saved.revision_number, 'new_version', not in_place, 'replaced_package_id', replaced,
    'is_active', saved.is_active, 'needs_review', saved.needs_review, 'updated_at', saved.updated_at,
    'package_revision', private.package_revision_hash(saved.id));
  insert into private.vendor_package_saves(actor, save_key, payload_hash, result) values (actor, p_save_key, digest, result);
  return result || jsonb_build_object('reused', false);
end $$;
revoke all on function public.vendor_save_package(uuid, text, jsonb, boolean, text) from public, anon;
grant execute on function public.vendor_save_package(uuid, text, jsonb, boolean, text) to authenticated;

create or replace function public.vendor_set_package_active(p_package uuid, p_active boolean, p_expected_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  vendor public.contractors := private.vendor_package_owner();
  pkg public.vendor_packages;
  paused uuid;
begin
  if p_active is null then raise exception 'Choose publish or pause' using errcode = '22023'; end if;
  select * into pkg from public.vendor_packages p where p.id = p_package for no key update;
  if not found or pkg.contractor_id <> vendor.id then raise exception 'Price not found' using errcode = 'P0002'; end if;
  if private.package_archived(pkg.id) then
    raise exception 'Mercurius archived this price; it is kept as read-only history' using errcode = '55000';
  end if;
  perform 1 from public.vendor_packages p where p.lineage_id = pkg.lineage_id for no key update;
  if p_expected_updated_at is null or pkg.updated_at <> p_expected_updated_at then
    raise exception 'This price changed since it was read; reload' using errcode = '40001';
  end if;
  if pkg.is_active = p_active then
    return jsonb_build_object('package_id', pkg.id, 'is_active', pkg.is_active, 'updated_at', pkg.updated_at, 'changed', false);
  end if;
  if p_active then
    paused := private.vendor_package_publish(pkg.id);
  else
    update public.vendor_packages p set is_active = false where p.id = pkg.id;
  end if;
  select * into pkg from public.vendor_packages p where p.id = p_package;
  return jsonb_build_object('package_id', pkg.id, 'is_active', pkg.is_active, 'needs_review', pkg.needs_review,
    'updated_at', pkg.updated_at, 'paused_package_id', paused, 'changed', true);
end $$;
revoke all on function public.vendor_set_package_active(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.vendor_set_package_active(uuid, boolean, timestamptz) to authenticated;

-- The vendor editors read the version hash they save against.
create or replace function public.vendor_package_revisions(p_packages uuid[])
returns table(package_id uuid, package_revision text, in_use boolean, is_head boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, private.package_revision_hash(p.id), private.package_in_use(p.id),
         not exists (select 1 from public.vendor_packages n where n.lineage_id = p.lineage_id and n.revision_number > p.revision_number)
    from public.vendor_packages p
    join public.contractors c on c.id = p.contractor_id
   where p.id = any(p_packages) and c.user_id = auth.uid()
$$;
revoke all on function public.vendor_package_revisions(uuid[]) from public, anon;
grant execute on function public.vendor_package_revisions(uuid[]) to authenticated;

-- ── Legacy promotions and service ZIP codes are operator-managed ────────────────────────────────

-- F611-2: a vendor-written overlay changed the matched and shown price that checkout then refused.
-- Vendor-funded offers keep their approval flow (vendor_approve_promotion_offer, DEC-2026-038).
drop policy if exists "Vendors manage own package promotions" on public.package_promotions;

-- F611-3: Mercurius sets the service area during review (MPS §8; DEC-2026-051 item 3).
drop policy if exists "Vendors manage own service zips" on public.contractor_service_zips;

alter table public.contractor_service_zips
  add constraint contractor_service_zips_zip_format check (zip_code ~ '^[0-9]{5}$') not valid;
alter table public.contractor_service_zips validate constraint contractor_service_zips_zip_format;
