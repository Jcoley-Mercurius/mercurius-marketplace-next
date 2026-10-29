-- TRACE-129, DEC-2026-051: four pest services for vendors being onboarded. Catalog rows only.
-- Custom Quote with zero reference prices: the catalog never sets a vendor's price; each vendor
-- prices a service in its own package, and until one does, homeowners see "Not available yet
-- in your area" (CFG-002). A service already added from Service Catalog (same id or same name,
-- any case) is left as it is, so this is safe to apply after an operator added one by hand.

-- Hosted already has this category (Pest Control is in it); a fresh local replay creates it
-- before seed.sql runs, with the seed's own values. An existing row is left as it is.
insert into public.service_categories(id, name, icon, description, sort_order)
values ('specialty', 'Specialty', 'Star', 'Pest control, security, smart home & more', 5)
on conflict (id) do nothing;

insert into public.services_catalog(id, name, category_id, icon, tags, descriptor, is_popular, is_active,
    weekly_price, monthly_price, one_time_price, default_frequency, available_frequencies,
    pricing_mode, default_deposit_amount, sort_order)
select s.id, s.name, 'specialty', 'Bug', s.tags, s.descriptor, false, true,
    null, 0, 0, 'one-time', array['monthly', 'quarterly', 'one-time'],
    'custom_quote', null,
    (select coalesce(max(c.sort_order), -1) from public.services_catalog c) + s.position
from (values
    (1, 'termite-control', 'Termite Control', array['termites', 'wood', 'inspection', 'bait'], 'Termite inspection, treatment & bait stations'),
    (2, 'rodent-control', 'Rodent Control', array['rodents', 'rats', 'mice', 'exclusion'], 'Rodent removal, exclusion & monitoring'),
    (3, 'mosquito-control', 'Mosquito Control', array['mosquitoes', 'yard', 'spray'], 'Yard mosquito treatment & prevention'),
    (4, 'flea-tick-control', 'Flea & Tick Control', array['fleas', 'ticks', 'pets', 'yard'], 'Indoor & yard flea and tick treatment')
  ) as s(position, id, name, tags, descriptor)
where not exists (select 1 from public.services_catalog c where c.id = s.id or lower(btrim(c.name)) = lower(s.name));

-- TRACE-129: an operator could not publish a Custom Quote with no price levels: the price
-- history row needs at least one change, and only levels and add-ons were recorded. Restated
-- from 20261024001000 with that one addition; everything else is unchanged.
create or replace function public.admin_publish_package_draft(p_draft uuid, p_expected_updated_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  reason text := btrim(coalesce(p_reason, ''));
  draft private.operator_package_drafts;
  service public.services_catalog;
  content jsonb;
  target public.vendor_packages;
  lineage uuid;
  next_revision integer := 1;
  replaced uuid;
  entry jsonb;
  primary_cadence text;
  new_package uuid;
  new_tier uuid;
  changes jsonb := '[]'::jsonb;
  review boolean;
  vendor_user uuid;
  vendor_approved boolean;
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Publish reason required'; end if;
  if length(reason) > 500 then raise exception 'Publish reason too long'; end if;

  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at
     or draft.content_hash <> private.draft_revision_hash(draft) then
    raise exception 'Draft changed since it was read; reload before publishing' using errcode = '40001';
  end if;
  -- DEC-2026-046: the vendor's approval is recorded when given, not required.
  vendor_approved := draft.approval_state = 'approved' and draft.approved_hash is not distinct from draft.content_hash;
  select * into service from public.services_catalog s where s.id = draft.service_id;
  if not service.is_active then raise exception 'Choose an active catalog service'; end if;
  -- Re-checked: the catalog's cadence list may have changed since the draft was saved.
  content := private.pricing_normalize_content(draft.content, draft.service_id);

  -- Serialize publication for this vendor.
  perform 1 from public.contractors c where c.id = draft.contractor_id for update;
  if draft.target_package_id is not null then
    select * into target from public.vendor_packages p where p.id = draft.target_package_id for update;
    if not found or target.contractor_id <> draft.contractor_id or target.service_id <> draft.service_id then
      raise exception 'The package this draft replaces no longer belongs to this vendor and service';
    end if;
    lineage := target.lineage_id;
    perform 1 from public.vendor_packages p where p.lineage_id = lineage for update;
    select max(p.revision_number) + 1 into next_revision from public.vendor_packages p where p.lineage_id = lineage;
  end if;
  if exists (select 1 from public.vendor_packages p
      where p.contractor_id = draft.contractor_id and p.service_id = draft.service_id and p.is_active
        and lower(btrim(p.name)) = lower(btrim(content ->> 'name'))
        and (lineage is null or p.lineage_id <> lineage)) then
    raise exception 'This vendor already has an active package named "%" for this service; rename it or replace that package',
      content ->> 'name' using errcode = '23505';
  end if;

  if lineage is not null then
    update public.vendor_packages p set is_active = false
     where p.lineage_id = lineage and p.is_active returning p.id into replaced;
  end if;

  primary_cadence := coalesce(
    (select t ->> 'frequency' from jsonb_array_elements(content -> 'tiers') t where t ->> 'frequency' = service.default_frequency limit 1),
    content #>> '{tiers,0,frequency}', service.default_frequency);
  insert into public.vendor_packages(contractor_id, service_id, name, description, pricing_mode, default_frequency,
      deposit_amount, is_active, needs_review, included_scope, policy_notes, lineage_id, revision_number)
    values (draft.contractor_id, draft.service_id, content ->> 'name', content ->> 'description', content ->> 'pricing_mode',
      primary_cadence, (content ->> 'deposit_amount')::numeric, true, false,
      array(select jsonb_array_elements_text(content -> 'included_scope')), content ->> 'policy_notes', lineage, next_revision)
    returning id into new_package;
  insert into public.package_qualifying_questions(package_id, question_key, question_label, input_type, unit, options, is_required, sort_order)
    select new_package, q ->> 'question_key', q ->> 'question_label', q ->> 'input_type', q ->> 'unit',
      case when jsonb_typeof(q -> 'options') = 'array' then q -> 'options' end, (q ->> 'is_required')::boolean, (q ->> 'sort_order')::integer
    from jsonb_array_elements(content -> 'questions') q;
  for entry in select value from jsonb_array_elements(content -> 'tiers') loop
    insert into public.package_tiers(package_id, name, price, price_kind, price_max, frequency, rule_conditions, includes, sort_order)
      values (new_package, entry ->> 'name', (entry ->> 'price')::numeric, entry ->> 'price_kind',
        (entry ->> 'price_max')::numeric, entry ->> 'frequency', entry -> 'conditions',
        array(select jsonb_array_elements_text(entry -> 'includes')), (entry ->> 'sort_order')::integer)
      returning id into new_tier;
    changes := changes || jsonb_build_object('kind', 'tier', 'id', new_tier, 'name', entry ->> 'name',
      'frequency', entry ->> 'frequency', 'from', null, 'to', (entry ->> 'price')::numeric);
  end loop;
  insert into public.package_addons(package_id, name, description, price, price_kind, price_max, unit_label,
      min_quantity, max_quantity, is_required, frequencies, sort_order, is_offered)
    select new_package, a ->> 'name', a ->> 'description', (a ->> 'price')::numeric, a ->> 'price_kind',
      (a ->> 'price_max')::numeric, a ->> 'unit_label', (a ->> 'min_quantity')::integer, (a ->> 'max_quantity')::integer,
      (a ->> 'is_required')::boolean, array(select jsonb_array_elements_text(a -> 'frequencies')), (a ->> 'sort_order')::integer, true
    from jsonb_array_elements(content -> 'addons') a;
  -- TRACE-129: a quote with no price levels has no level to record; record its pricing mode,
  -- so a Custom Quote can be published (the price history needs at least one entry).
  if jsonb_array_length(changes) = 0 then
    changes := jsonb_build_array(jsonb_build_object('kind', 'quote', 'pricing_mode', content ->> 'pricing_mode',
      'deposit', (content ->> 'deposit_amount')::numeric));
  end if;
  -- The review-flag trigger leaves an operator's write as given, so set it here.
  update public.vendor_packages set needs_review = public.custom_package_price_needs_review(new_package)
   where id = new_package returning needs_review into review;

  update private.operator_package_drafts
     set status = 'published', package_id = new_package, publish_reason = reason,
         closed_by = actor, closed_at = now(), updated_by = actor, updated_at = now()
   where id = p_draft;
  insert into private.vendor_package_price_corrections(package_id, contractor_id, package_name, changes, reason, actor)
    values (new_package, draft.contractor_id, content ->> 'name', changes, reason, actor);
  perform private.record_package_draft_event(draft.id, 'published', actor, 'operator', draft.content_hash, null,
    jsonb_build_object('package_id', new_package, 'replaced_package_id', replaced, 'revision_number', next_revision,
      'vendor_approved', vendor_approved), reason);

  select c.user_id into vendor_user from public.contractors c where c.id = draft.contractor_id;
  if vendor_user is not null then
    perform public.notify_user(vendor_user, 'pricing', 'info',
      case when vendor_approved then 'Your approved price is live' else 'Mercurius published a price for you' end,
      (content ->> 'name') || ': ' || reason, '/vendor/packages', null, draft.contractor_id);
  end if;

  return jsonb_build_object('package_id', new_package, 'needs_review', review, 'vendor_notified', vendor_user is not null,
    'replaced_package_id', replaced, 'revision_number', next_revision, 'vendor_approved', vendor_approved);
end $$;

revoke all on function public.admin_publish_package_draft(uuid, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_package_draft(uuid, timestamptz, text) to authenticated;
