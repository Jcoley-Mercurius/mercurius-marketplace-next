-- TRACE-120 (DEC-2026-046, owner instruction 2026-10-24): an operator publishes a draft price
-- without the vendor's approval. Supersedes the publication gate of DEC-2026-039 item 1 and
-- DEC-2026-041 item 4; nothing else of the approval flow changes.
--
-- Additive: admin_publish_package_draft is restated from 20261018002000 with one rule
-- removed (only the vendor-approved revision publishes). Sending a draft to the vendor,
-- the vendor's approval or change request, and their history stay available and recorded,
-- but none of them is required. Still required: an operator, a reason the vendor reads, an
-- open draft read at its current version, an active catalog service, distinct package names
-- and the guardrail review. The published event and the return value say whether the vendor
-- had approved the published revision; the vendor's notice says so too. Package approval
-- evidence (20261018004000) already reports such a package as operator_published.
-- Vendor-funded promotion offers keep their vendor approval (DEC-2026-038); not changed here.
-- No data is changed.

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
