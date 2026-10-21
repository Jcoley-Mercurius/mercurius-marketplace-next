-- TRACE-113 (DEC-2026-039): operator-drafted prices are published only after the vendor
-- approves the exact revision (pricing review 2026-10-18, slice B: PR-06 preview, PR-07,
-- PR-08, PR-09). Builds on TRACE-110 drafts and TRACE-112 content and calculation.
--
-- Drafts. A draft now holds a full package content document: name, description, price
-- meaning, price levels with rules, questions, structured add-ons, included scope and
-- provider notes, validated by private.pricing_normalize_content. The earlier one-price-per-
-- cadence draft (admin_save_package_draft) still works and is stored the same way. A draft
-- may target an existing package: publishing then creates the next revision in that
-- package's lineage and pauses the revision it replaces in the same transaction, so the
-- approved live revision stays live until its replacement is published and the row a
-- request references never changes. A draft can start from a pricing template: the
-- template's questions, levels, rules and add-ons are copied, so later template edits never
-- reprice the copy; a rule or question shape the package model cannot hold is reported,
-- not guessed.
--
-- Approval. draft -> sent for vendor approval -> approved -> published, with "changes
-- requested" back to the operator. The revision fingerprint covers the content, vendor,
-- service and target package; any edit to it returns the draft to draft. Only the
-- authenticated account bound to the vendor (vendor role) can approve or ask for changes,
-- for the revision it was sent, so an obsolete revision cannot be approved. Only an
-- operator publishes, with a reason, and only the approved revision; approval never
-- publishes by itself. Retries are idempotent: a second approval of the same revision
-- changes nothing; a published draft cannot be published again.
--
-- Delivery. A send is an in-app notification to the bound vendor account; no email or SMS
-- is sent by this slice. The operator sees what is observable: not sent, in the vendor's
-- inbox, read, or removed by the vendor. A notification is never consent. Without a bound
-- vendor account the send is refused and recorded as blocked, with the reason.
--
-- Audit. Every save (old and new revision), send, block, approval, change request,
-- publication and discard is recorded with actor, role, revision and time. Operators read
-- the history; vendors see their drafts without operator identity.
--
-- Unchanged: DEC-2026-034 operator corrections (vendor notified only), the vendor's own
-- editor, existing packages and their approval status (none is marked vendor-approved),
-- requests, quotes and money snapshots. Publishing no longer refuses a second package for
-- the same cadence (DEC-2026-035); it refuses a second active package with the same name
-- for the same vendor and service.

-- Draft storage ------------------------------------------------------------------------

alter table private.operator_package_drafts
  alter column prices drop not null,
  add column content jsonb check (content is null or jsonb_typeof(content) = 'object'),
  add column content_hash text,
  add column target_package_id uuid references public.vendor_packages(id) on delete set null,
  add column template_id uuid references public.pricing_templates(id) on delete set null,
  add column approval_state text not null default 'draft'
    check (approval_state in ('draft', 'sent', 'approved', 'changes_requested')),
  add column sent_hash text,
  add column sent_at timestamptz,
  add column sent_by uuid,
  add column notification_id uuid,
  add column approved_hash text,
  add column approved_at timestamptz,
  add column approved_by uuid,
  add column change_request text check (change_request is null or length(change_request) <= 1000),
  add constraint operator_package_drafts_approved_check check (
    (approval_state = 'approved') = (approved_hash is not null and approved_by is not null and approved_at is not null)),
  add constraint operator_package_drafts_sent_check check (
    approval_state = 'draft' or (sent_hash is not null and sent_at is not null));

create table private.package_draft_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  draft_id uuid not null references private.operator_package_drafts(id) on delete cascade,
  kind text not null check (kind in ('saved', 'sent', 'resent', 'send_blocked', 'approved', 'changes_requested',
    'published', 'discarded')),
  actor uuid not null,
  actor_role text not null check (actor_role in ('operator', 'vendor')),
  revision text,
  previous_revision text,
  changes jsonb,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index package_draft_events_draft_idx on private.package_draft_events(draft_id, sequence);
alter table private.package_draft_events enable row level security;
revoke all on private.package_draft_events from public, anon, authenticated, service_role;

-- Content validation ------------------------------------------------------------------

create function private.pricing_text(p_value jsonb, p_max integer, p_label text, p_required boolean)
returns text language plpgsql immutable set search_path = '' as $$
declare value text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then value := null;
  elsif jsonb_typeof(p_value) <> 'string' then raise exception '% must be text', p_label using errcode = '22023';
  else value := nullif(btrim(p_value #>> '{}'), '');
  end if;
  if value is null and p_required then raise exception '% is required', p_label using errcode = '22023'; end if;
  if length(value) > p_max then raise exception '% is too long', p_label using errcode = '22023'; end if;
  return value;
end $$;

create function private.pricing_text_list(p_value jsonb, p_max_items integer, p_max integer, p_label text)
returns jsonb language plpgsql immutable set search_path = '' as $$
#variable_conflict use_column
declare result jsonb := '[]'::jsonb; item jsonb; value text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return result; end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > p_max_items then
    raise exception '% must be a list of at most % items', p_label, p_max_items using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_value) loop
    value := private.pricing_text(item, p_max, p_label, false);
    if value is not null and not result ? value then result := result || to_jsonb(value); end if;
  end loop;
  return result;
end $$;

create function private.pricing_bound(p_value jsonb, p_label text) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'number' or abs((p_value #>> '{}')::numeric) > 1000000 then
    raise exception '% must be a number', p_label using errcode = '22023';
  end if;
  return (p_value #>> '{}')::numeric;
end $$;

-- Validates a draft content document for a service and returns it normalized. Raises a
-- readable 22023 error for the first problem found.
create function private.pricing_normalize_content(p_content jsonb, p_service text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  service public.services_catalog;
  offered text[];
  mode text;
  deposit numeric;
  questions jsonb := '[]'::jsonb;
  tiers jsonb := '[]'::jsonb;
  addons jsonb := '[]'::jsonb;
  item jsonb;
  cond jsonb;
  conds jsonb;
  keys text[] := '{}';
  number_keys text[] := '{}';
  cond_keys text[];
  ids text[] := '{}';
  value text;
  kind text;
  price numeric;
  price_max numeric;
  lo numeric;
  hi numeric;
  frequency text;
  frequencies jsonb;
  min_q integer;
  max_q integer;
  required boolean;
  idx integer := 0;
  scope_items text[];
  f text;
  a jsonb;
  b jsonb;
  overlap boolean;
  k text;
  a_lo numeric; a_hi numeric; b_lo numeric; b_hi numeric;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Package content is required' using errcode = '22023';
  end if;
  select * into service from public.services_catalog s where s.id = p_service;
  if not found then raise exception 'Choose a catalog service' using errcode = '22023'; end if;
  offered := coalesce(service.available_frequencies, '{}');

  mode := coalesce(p_content ->> 'pricing_mode', 'fixed');
  if mode not in ('fixed', 'deposit_quote', 'custom_quote') then
    raise exception 'Choose a price type' using errcode = '22023';
  end if;
  if mode = 'deposit_quote' then
    deposit := private.price_amount(p_content -> 'deposit_amount');
    if deposit is null then raise exception 'A quote with deposit needs a positive deposit in whole cents' using errcode = '22023'; end if;
  end if;

  -- Questions: numbers, single choices or text, unique keys.
  if jsonb_typeof(coalesce(p_content -> 'questions', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_content -> 'questions', '[]'::jsonb)) > 10 then
    raise exception 'Use at most 10 questions' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_content -> 'questions', '[]'::jsonb)) loop
    value := coalesce(item ->> 'question_key', '');
    if value !~ '^[A-Za-z0-9_-]{1,60}$' then raise exception 'Each question needs a short key (letters, numbers, - or _)' using errcode = '22023'; end if;
    if value = any(keys) then raise exception 'Question keys must be unique' using errcode = '22023'; end if;
    keys := keys || value;
    if coalesce(item ->> 'input_type', 'number') not in ('number', 'select', 'text') then
      raise exception 'A question is a number, a choice or text' using errcode = '22023';
    end if;
    if coalesce(item ->> 'input_type', 'number') = 'number' then number_keys := number_keys || value; end if;
    if item ->> 'input_type' = 'select' and jsonb_array_length(private.pricing_text_list(item -> 'options', 12, 60, 'Choice')) < 2 then
      raise exception 'A choice question needs at least two options' using errcode = '22023';
    end if;
    questions := questions || jsonb_build_object(
      'question_key', value,
      'question_label', private.pricing_text(item -> 'question_label', 160, 'Question', true),
      'input_type', coalesce(item ->> 'input_type', 'number'),
      'unit', private.pricing_text(item -> 'unit', 20, 'Question unit', false),
      'options', case when item ->> 'input_type' = 'select' then private.pricing_text_list(item -> 'options', 12, 60, 'Choice') end,
      'is_required', coalesce((item ->> 'is_required')::boolean, true),
      'sort_order', idx);
    idx := idx + 1;
  end loop;

  -- Price levels.
  if jsonb_typeof(coalesce(p_content -> 'tiers', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_content -> 'tiers', '[]'::jsonb)) > 24 then
    raise exception 'Use at most 24 price levels' using errcode = '22023';
  end if;
  idx := 0;
  for item in select value from jsonb_array_elements(coalesce(p_content -> 'tiers', '[]'::jsonb)) loop
    value := coalesce(item ->> 'id', '');
    if value !~ '^[A-Za-z0-9_-]{1,64}$' or value = any(ids) then
      raise exception 'Each price level needs a unique id' using errcode = '22023';
    end if;
    ids := ids || value;
    frequency := item ->> 'frequency';
    if private.pricing_cadence_rank(frequency) is null then raise exception 'Unknown cadence' using errcode = '22023'; end if;
    if cardinality(offered) > 0 and not frequency = any(offered) then
      raise exception '% is not offered for this service in the catalog', private.pricing_cadence_label(frequency) using errcode = '22023';
    end if;
    kind := coalesce(item ->> 'price_kind', case when mode = 'fixed' then 'exact' else 'range' end);
    if kind not in ('exact', 'starting_at', 'range') then raise exception 'Unknown price meaning' using errcode = '22023'; end if;
    if mode = 'fixed' and kind <> 'exact' then
      raise exception 'A fixed price is exact; use "Quote required" for a starting-at or range estimate' using errcode = '22023';
    end if;
    if mode <> 'fixed' and kind = 'exact' then
      raise exception 'A quote shows an estimate (starting at or a range), not an exact price' using errcode = '22023';
    end if;
    price := private.price_amount(item -> 'price');
    if price is null then raise exception 'Each price must be a positive amount in whole cents' using errcode = '22023'; end if;
    price_max := null;
    if kind = 'range' then
      price_max := private.price_amount(item -> 'price_max');
      if price_max is null or price_max <= price then
        raise exception 'A range needs an upper amount above its lower amount' using errcode = '22023';
      end if;
    end if;
    -- Rule conditions on number questions; one condition per question.
    conds := '[]'::jsonb;
    cond_keys := '{}';
    if jsonb_typeof(coalesce(item -> 'conditions', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(item -> 'conditions', '[]'::jsonb)) > 5 then
      raise exception 'Use at most 5 rule conditions per price level' using errcode = '22023';
    end if;
    for cond in select value from jsonb_array_elements(coalesce(item -> 'conditions', '[]'::jsonb)) loop
      k := cond ->> 'question_key';
      if k is null or not k = any(number_keys) then
        raise exception 'A rule must use a number question of this package' using errcode = '22023';
      end if;
      if k = any(cond_keys) then raise exception 'Use one rule per question in a price level' using errcode = '22023'; end if;
      cond_keys := cond_keys || k;
      lo := private.pricing_bound(cond -> 'min', 'A rule bound');
      hi := private.pricing_bound(cond -> 'max', 'A rule bound');
      if lo is null and hi is null then raise exception 'A rule needs a minimum or maximum' using errcode = '22023'; end if;
      if lo is not null and hi is not null and lo > hi then
        raise exception 'A rule minimum cannot be above its maximum' using errcode = '22023';
      end if;
      conds := conds || jsonb_strip_nulls(jsonb_build_object('question_key', k, 'min', lo, 'max', hi));
    end loop;
    tiers := tiers || jsonb_build_object(
      'id', value, 'name', private.pricing_text(item -> 'name', 80, 'Price level name', true),
      'frequency', frequency, 'price_kind', kind, 'price', price, 'price_max', price_max,
      'conditions', conds, 'includes', private.pricing_text_list(item -> 'includes', 20, 120, 'Included item'),
      'sort_order', idx);
    idx := idx + 1;
  end loop;
  if mode = 'fixed' and jsonb_array_length(tiers) = 0 then
    raise exception 'A fixed price needs at least one price' using errcode = '22023';
  end if;

  -- Per cadence: every level has rules or none does; rule-based levels must not overlap.
  for f in select distinct t ->> 'frequency' from jsonb_array_elements(tiers) t loop
    if exists (select 1 from jsonb_array_elements(tiers) t where t ->> 'frequency' = f and jsonb_array_length(t -> 'conditions') > 0)
      and exists (select 1 from jsonb_array_elements(tiers) t where t ->> 'frequency' = f and jsonb_array_length(t -> 'conditions') = 0) then
      raise exception '%: give every price level a rule, or none (then the homeowner chooses)', private.pricing_cadence_label(f)
        using errcode = '22023';
    end if;
    for a in select t from jsonb_array_elements(tiers) t where t ->> 'frequency' = f and jsonb_array_length(t -> 'conditions') > 0 loop
      for b in select t from jsonb_array_elements(tiers) t where t ->> 'frequency' = f and jsonb_array_length(t -> 'conditions') > 0
          and (t ->> 'sort_order')::integer > (a ->> 'sort_order')::integer loop
        -- Two levels overlap when, on every question either one bounds, their ranges meet.
        overlap := true;
        for k in select distinct c ->> 'question_key' from (select jsonb_array_elements(a -> 'conditions') c
                   union all select jsonb_array_elements(b -> 'conditions')) both_conditions loop
          select (c ->> 'min')::numeric, (c ->> 'max')::numeric into a_lo, a_hi
            from jsonb_array_elements(a -> 'conditions') c where c ->> 'question_key' = k;
          if not found then a_lo := null; a_hi := null; end if;
          select (c ->> 'min')::numeric, (c ->> 'max')::numeric into b_lo, b_hi
            from jsonb_array_elements(b -> 'conditions') c where c ->> 'question_key' = k;
          if not found then b_lo := null; b_hi := null; end if;
          if not ((a_lo is null or b_hi is null or a_lo <= b_hi) and (b_lo is null or a_hi is null or b_lo <= a_hi)) then
            overlap := false;
          end if;
        end loop;
        if overlap then
          raise exception '%: "%" and "%" can both match the same home; make their rules not overlap',
            private.pricing_cadence_label(f), a ->> 'name', b ->> 'name' using errcode = '22023';
        end if;
      end loop;
    end loop;
  end loop;

  -- Included scope, from the package and its levels; an add-on may not charge for it.
  select array_agg(lower(btrim(x))) into scope_items from (
    select jsonb_array_elements_text(private.pricing_text_list(p_content -> 'included_scope', 20, 120, 'Included item')) x
    union all select jsonb_array_elements_text(t -> 'includes') from jsonb_array_elements(tiers) t) s;

  -- Add-ons.
  if jsonb_typeof(coalesce(p_content -> 'addons', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_content -> 'addons', '[]'::jsonb)) > 20 then
    raise exception 'Use at most 20 add-ons' using errcode = '22023';
  end if;
  idx := 0;
  for item in select value from jsonb_array_elements(coalesce(p_content -> 'addons', '[]'::jsonb)) loop
    value := coalesce(item ->> 'id', '');
    if value !~ '^[A-Za-z0-9_-]{1,64}$' or value = any(ids) then
      raise exception 'Each add-on needs a unique id' using errcode = '22023';
    end if;
    ids := ids || value;
    kind := coalesce(item ->> 'price_kind', 'exact');
    if kind not in ('exact', 'range') then raise exception 'An add-on price is exact or a range' using errcode = '22023'; end if;
    price := private.price_amount(item -> 'price');
    if price is null then raise exception 'Each add-on price must be a positive amount in whole cents' using errcode = '22023'; end if;
    price_max := null;
    if kind = 'range' then
      price_max := private.price_amount(item -> 'price_max');
      if price_max is null or price_max <= price then
        raise exception 'An add-on range needs an upper amount above its lower amount' using errcode = '22023';
      end if;
    end if;
    required := coalesce((item ->> 'is_required')::boolean, false);
    if coalesce(jsonb_typeof(item -> 'min_quantity'), 'null') not in ('number', 'null')
      or coalesce(jsonb_typeof(item -> 'max_quantity'), 'null') not in ('number', 'null')
      or coalesce(item ->> 'min_quantity', '0') !~ '^[0-9]{1,2}$' or coalesce(item ->> 'max_quantity', '1') !~ '^[0-9]{1,2}$' then
      raise exception 'Add-on quantities are whole numbers from 0 to 99' using errcode = '22023';
    end if;
    min_q := coalesce((item ->> 'min_quantity')::integer, case when required then 1 else 0 end);
    max_q := coalesce((item ->> 'max_quantity')::integer, greatest(min_q, 1));
    if max_q < 1 or max_q < min_q then raise exception 'An add-on maximum must be at least its minimum and at least 1' using errcode = '22023'; end if;
    if required and min_q < 1 then raise exception 'A required add-on needs a quantity of at least 1' using errcode = '22023'; end if;
    frequencies := '[]'::jsonb;
    for frequency in select jsonb_array_elements_text(coalesce(item -> 'frequencies', '[]'::jsonb)) loop
      if private.pricing_cadence_rank(frequency) is null then raise exception 'Unknown cadence' using errcode = '22023'; end if;
      if not exists (select 1 from jsonb_array_elements(tiers) t where t ->> 'frequency' = frequency) and mode = 'fixed' then
        raise exception 'An add-on applies only to cadences the package prices' using errcode = '22023';
      end if;
      if not frequencies ? frequency then frequencies := frequencies || to_jsonb(frequency); end if;
    end loop;
    value := private.pricing_text(item -> 'name', 80, 'Add-on name', true);
    if lower(value) = any(coalesce(scope_items, '{}')) then
      raise exception '"%" is already included in the package; it cannot also be charged as an add-on', value using errcode = '22023';
    end if;
    addons := addons || jsonb_build_object(
      'id', item ->> 'id', 'name', value,
      'description', private.pricing_text(item -> 'description', 160, 'Add-on description', false),
      'price_kind', kind, 'price', price, 'price_max', price_max,
      'unit_label', private.pricing_text(item -> 'unit_label', 24, 'Add-on unit', false),
      'min_quantity', min_q, 'max_quantity', max_q, 'is_required', required,
      'frequencies', frequencies, 'sort_order', idx);
    idx := idx + 1;
  end loop;

  return jsonb_build_object(
    'name', private.pricing_text(p_content -> 'name', 120, 'Package name', true),
    'description', private.pricing_text(p_content -> 'description', 1000, 'Description', false),
    'pricing_mode', mode, 'deposit_amount', deposit,
    'included_scope', private.pricing_text_list(p_content -> 'included_scope', 20, 120, 'Included item'),
    'policy_notes', private.pricing_text(p_content -> 'policy_notes', 2000, 'Provider notes', false),
    'questions', questions, 'tiers', tiers, 'addons', addons);
end $$;

-- The earlier one-price-per-cadence draft, as content.
create function private.draft_content_from_prices(p_name text, p_description text, p_prices jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('name', p_name, 'description', p_description, 'pricing_mode', 'fixed',
    'included_scope', '[]'::jsonb, 'policy_notes', null, 'questions', '[]'::jsonb, 'addons', '[]'::jsonb,
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('id', 'level-' || (entry ->> 'frequency'),
        'name', private.pricing_cadence_label(entry ->> 'frequency'), 'frequency', entry ->> 'frequency',
        'price_kind', 'exact', 'price', entry -> 'price', 'conditions', '[]'::jsonb, 'includes', '[]'::jsonb))
      from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) entry), '[]'::jsonb))
$$;

-- The revision the vendor approves: content plus vendor, service and target package.
create function private.draft_revision_hash(p_draft private.operator_package_drafts) returns text
language sql immutable set search_path = '' as $$
  select private.pricing_content_hash(jsonb_build_object('content', p_draft.content,
    'contractor_id', p_draft.contractor_id, 'service_id', p_draft.service_id,
    'target_package_id', p_draft.target_package_id))
$$;

-- Backfill open and closed drafts to content. Approval state stays draft: nothing that
-- was never sent to a vendor is treated as approved.
update private.operator_package_drafts d
   set content = private.pricing_normalize_content(private.draft_content_from_prices(d.name, d.description, d.prices), d.service_id)
 where d.content is null and d.prices is not null and d.status = 'draft';
update private.operator_package_drafts d
   set content = private.draft_content_from_prices(d.name, d.description, d.prices)
 where d.content is null and d.prices is not null;
update private.operator_package_drafts d set content_hash = private.draft_revision_hash(d) where d.content is not null;
alter table private.operator_package_drafts
  add constraint operator_package_drafts_content_required check (content is not null and content_hash is not null);

-- Views of a draft ------------------------------------------------------------------------

create function private.package_draft_vendor_link(p_contractor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'linked', c.user_id is not null,
    'vendor_role', c.user_id is not null and public.has_role(c.user_id, 'vendor'),
    'blocker', case when c.user_id is null then 'No vendor account is bound to this provider'
                    when not public.has_role(c.user_id, 'vendor') then 'The bound account does not have vendor access yet' end)
  from public.contractors c where c.id = p_contractor
$$;

create function private.package_draft_delivery(p_draft private.operator_package_drafts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_draft.notification_id is null then jsonb_build_object('channel', 'in_app', 'status', 'not_sent', 'email', 'not_sent')
    else coalesce((select jsonb_build_object('channel', 'in_app', 'email', 'not_sent', 'sent_at', n.created_at,
        'status', case when n.read_at is null then 'in_inbox' else 'read' end, 'read_at', n.read_at)
      from public.notifications n where n.id = p_draft.notification_id),
      jsonb_build_object('channel', 'in_app', 'email', 'not_sent', 'status', 'removed_by_vendor'))
  end
$$;

-- Replaces the TRACE-110 view: content, revision, approval, linkage and delivery added.
create or replace function private.operator_package_draft_json(p_draft private.operator_package_drafts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_draft.id, 'contractor_id', p_draft.contractor_id,
    'contractor_name', (select c.name from public.contractors c where c.id = p_draft.contractor_id),
    'service_id', p_draft.service_id,
    'service_name', (select s.name from public.services_catalog s where s.id = p_draft.service_id),
    'name', p_draft.name, 'description', p_draft.description,
    -- One exact price per cadence, for the earlier price list.
    'prices', coalesce(p_draft.prices, (select jsonb_agg(jsonb_build_object('frequency', t ->> 'frequency', 'price', (t ->> 'price')::numeric))
       from jsonb_array_elements(p_draft.content -> 'tiers') t where t ->> 'price_kind' = 'exact'), '[]'::jsonb),
    'content', p_draft.content, 'revision', p_draft.content_hash,
    'target_package_id', p_draft.target_package_id,
    'target_package_name', (select p.name from public.vendor_packages p where p.id = p_draft.target_package_id),
    'template_id', p_draft.template_id,
    'status', p_draft.status, 'package_id', p_draft.package_id,
    'approval_state', p_draft.approval_state,
    'approval_current', p_draft.approval_state = 'approved' and p_draft.approved_hash = p_draft.content_hash,
    'sent_at', p_draft.sent_at, 'approved_at', p_draft.approved_at, 'change_request', p_draft.change_request,
    'vendor_link', private.package_draft_vendor_link(p_draft.contractor_id),
    'delivery', private.package_draft_delivery(p_draft),
    'created_by_email', (select u.email from auth.users u where u.id = p_draft.created_by),
    'created_at', p_draft.created_at, 'updated_at', p_draft.updated_at)
$$;

-- What the vendor sees: no operator identity, no internal history.
create function private.vendor_package_draft_json(p_draft private.operator_package_drafts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_draft.id, 'contractor_id', p_draft.contractor_id,
    'service_id', p_draft.service_id,
    'service_name', (select s.name from public.services_catalog s where s.id = p_draft.service_id),
    'content', p_draft.content, 'revision', p_draft.content_hash,
    'target_package_id', p_draft.target_package_id,
    'target_package_name', (select p.name from public.vendor_packages p where p.id = p_draft.target_package_id),
    'status', p_draft.status, 'approval_state', p_draft.approval_state,
    'sent_at', p_draft.sent_at, 'approved_at', p_draft.approved_at, 'change_request', p_draft.change_request,
    'package_id', p_draft.package_id)
$$;

create function private.record_package_draft_event(p_draft uuid, p_kind text, p_actor uuid, p_role text,
  p_revision text, p_previous text, p_changes jsonb, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into private.package_draft_events(draft_id, kind, actor, actor_role, revision, previous_revision, changes, note)
  values (p_draft, p_kind, p_actor, p_role, p_revision, p_previous, p_changes, p_note)
$$;

-- Field-level differences between two content documents, for the audit record.
create function private.pricing_content_changes(p_old jsonb, p_new jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', key, 'from', p_old -> key, 'to', p_new -> key) order by key), '[]'::jsonb)
  from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) key
        union select jsonb_object_keys(coalesce(p_new, '{}'::jsonb))) keys
  where (p_old -> key) is distinct from (p_new -> key)
$$;

-- Saving --------------------------------------------------------------------------------

-- Creates or replaces an open draft's content against the updated_at the operator read.
-- A change to the revision returns an approved or sent draft to draft.
create function private.save_package_draft(p_draft uuid, p_expected_updated_at timestamptz, p_contractor uuid,
  p_service text, p_target_package uuid, p_content jsonb, p_prices jsonb, p_template uuid)
returns private.operator_package_drafts language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  draft private.operator_package_drafts;
  normalized jsonb;
  previous jsonb;
  previous_hash text;
  next_hash text;
begin
  if not exists (select 1 from public.contractors c where c.id = p_contractor) then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.services_catalog s where s.id = p_service and s.is_active) then
    raise exception 'Choose an active catalog service';
  end if;
  if p_target_package is not null and not exists (select 1 from public.vendor_packages p
      where p.id = p_target_package and p.contractor_id = p_contractor and p.service_id = p_service) then
    raise exception 'A replacement must be one of this vendor''s packages for the same service' using errcode = '22023';
  end if;
  normalized := private.pricing_normalize_content(p_content, p_service);

  if p_draft is null then
    insert into private.operator_package_drafts(contractor_id, service_id, name, description, prices, content,
        content_hash, target_package_id, template_id, created_by, updated_by)
      values (p_contractor, p_service, normalized ->> 'name', normalized ->> 'description', p_prices, normalized,
        'pending', p_target_package, p_template, actor, actor)
      returning * into draft;
  else
    select * into draft from private.operator_package_drafts where id = p_draft for update;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
    if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
    if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at then
      raise exception 'Draft changed since it was read; reload before saving' using errcode = '40001';
    end if;
    if draft.contractor_id <> p_contractor then raise exception 'A draft stays with the vendor it was started for'; end if;
    previous := draft.content;
    previous_hash := draft.content_hash;
    update private.operator_package_drafts
       set service_id = p_service, name = normalized ->> 'name', description = normalized ->> 'description',
           prices = p_prices, content = normalized, target_package_id = p_target_package,
           updated_by = actor, updated_at = now()
     where id = p_draft returning * into draft;
  end if;

  next_hash := private.draft_revision_hash(draft);
  update private.operator_package_drafts d
     set content_hash = next_hash,
         approval_state = case when previous_hash is not distinct from next_hash then d.approval_state else 'draft' end,
         approved_hash = case when previous_hash is not distinct from next_hash then d.approved_hash end,
         approved_at = case when previous_hash is not distinct from next_hash then d.approved_at end,
         approved_by = case when previous_hash is not distinct from next_hash then d.approved_by end
   where d.id = draft.id returning * into draft;
  if previous_hash is distinct from next_hash then
    perform private.record_package_draft_event(draft.id, 'saved', actor, 'operator', next_hash, previous_hash,
      private.pricing_content_changes(previous, normalized), null);
  end if;
  return draft;
end $$;

-- The TRACE-110 command keeps its signature and behavior; its prices become content.
create or replace function public.admin_save_package_draft(
  p_draft uuid, p_expected_updated_at timestamptz, p_contractor uuid, p_service text,
  p_name text, p_description text, p_prices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  draft_prices jsonb;
  existing private.operator_package_drafts;
begin
  perform public.vendor_require_operator();
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Package name required'; end if;
  if length(btrim(p_name)) > 120 then raise exception 'Package name too long'; end if;
  if length(nullif(btrim(coalesce(p_description, '')), '')) > 1000 then raise exception 'Description too long'; end if;
  if not exists (select 1 from public.services_catalog s where s.id = p_service and s.is_active) then
    raise exception 'Choose an active catalog service';
  end if;
  draft_prices := private.operator_draft_prices(p_prices, p_service);
  if p_draft is not null then
    select * into existing from private.operator_package_drafts where id = p_draft;
  end if;
  return private.operator_package_draft_json(private.save_package_draft(p_draft, p_expected_updated_at, p_contractor,
    p_service, existing.target_package_id,
    private.draft_content_from_prices(btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), draft_prices),
    draft_prices, existing.template_id));
end $$;

create function public.admin_save_package_draft_content(
  p_draft uuid, p_expected_updated_at timestamptz, p_contractor uuid, p_service text,
  p_target_package uuid, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing private.operator_package_drafts;
begin
  perform public.vendor_require_operator();
  if p_draft is not null then
    select * into existing from private.operator_package_drafts where id = p_draft;
  end if;
  return private.operator_package_draft_json(private.save_package_draft(p_draft, p_expected_updated_at, p_contractor,
    p_service, p_target_package, p_content, null, existing.template_id));
end $$;

-- Starts a draft from a pricing template. The copy is independent of later template edits.
create function public.admin_draft_from_template(p_contractor uuid, p_template uuid, p_frequency text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  template public.pricing_templates;
  service public.services_catalog;
  cadence text;
  questions jsonb := '[]'::jsonb;
  tiers jsonb := '[]'::jsonb;
  addons jsonb := '[]'::jsonb;
  notes jsonb := '[]'::jsonb;
  q public.pricing_template_questions;
  t public.pricing_template_tiers;
  a public.pricing_template_addons;
  rule jsonb;
  conds jsonb;
  usable boolean;
  number_keys text[] := '{}';
  draft private.operator_package_drafts;
begin
  perform public.vendor_require_operator();
  select * into template from public.pricing_templates where id = p_template;
  if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
  select * into service from public.services_catalog where id = template.service_id;
  cadence := coalesce(p_frequency,
    case when cardinality(coalesce(service.available_frequencies, '{}')) = 0 or 'one-time' = any(service.available_frequencies)
         then 'one-time' else service.default_frequency end);

  for q in select * from public.pricing_template_questions where template_id = p_template order by sort_order, question_key loop
    if q.input_type = 'number' then number_keys := number_keys || q.question_key; end if;
    if q.input_type in ('multiselect', 'boolean') then
      notes := notes || to_jsonb(format('Question "%s" (%s) was copied as %s', q.question_label, q.input_type,
        case when q.input_type = 'boolean' then 'a yes/no choice' else 'text' end));
    end if;
    questions := questions || jsonb_build_object('question_key', q.question_key, 'question_label', q.question_label,
      'input_type', case q.input_type when 'boolean' then 'select' when 'multiselect' then 'text' else q.input_type end,
      'unit', q.unit,
      'options', case when q.input_type = 'boolean' then '["Yes","No"]'::jsonb
                      when q.input_type = 'select' then q.options end,
      'is_required', q.required);
  end loop;

  for t in select * from public.pricing_template_tiers where template_id = p_template order by sort_order, id loop
    -- Only {"all":[{question_key|key, min, max}]} on number questions converts to rules.
    conds := '[]'::jsonb;
    usable := true;
    rule := t.rule_json;
    if rule is not null and rule <> '{}'::jsonb and coalesce(jsonb_array_length(rule -> 'all'), 0) > 0 then
      if jsonb_typeof(rule -> 'all') <> 'array' or (select count(*) from jsonb_object_keys(rule)) <> 1 then
        usable := false;
      else
        select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('question_key', coalesce(c ->> 'question_key', c ->> 'key'),
            'min', c -> 'min', 'max', c -> 'max'))), '[]'::jsonb),
          bool_and(coalesce(c ->> 'question_key', c ->> 'key') = any(number_keys)
            and coalesce(jsonb_typeof(c -> 'min'), 'null') in ('number', 'null')
            and coalesce(jsonb_typeof(c -> 'max'), 'null') in ('number', 'null')
            and (c ? 'min' or c ? 'max'))
        into conds, usable
        from jsonb_array_elements(rule -> 'all') c;
      end if;
    elsif rule is not null and rule not in ('{}'::jsonb, '{"all":[]}'::jsonb) then
      usable := false;
    end if;
    if not usable then
      notes := notes || to_jsonb(format('The rule of "%s" could not be converted; set it before sending', t.name));
      conds := '[]'::jsonb;
    end if;
    tiers := tiers || jsonb_build_object('id', 'level-' || (jsonb_array_length(tiers) + 1), 'name', t.name,
      'frequency', cadence, 'price_kind', 'exact', 'price', coalesce(t.suggested_price, t.min_price),
      'conditions', conds, 'includes', to_jsonb(t.includes));
  end loop;

  -- Rules are all or none: if only some levels converted, copy none and say so.
  if exists (select 1 from jsonb_array_elements(tiers) x where jsonb_array_length(x -> 'conditions') > 0)
     and exists (select 1 from jsonb_array_elements(tiers) x where jsonb_array_length(x -> 'conditions') = 0) then
    tiers := (select jsonb_agg(jsonb_set(x, '{conditions}', '[]'::jsonb)) from jsonb_array_elements(tiers) x);
    notes := notes || to_jsonb('Only some rules converted, so no rules were copied; set them before sending'::text);
  end if;

  for a in select * from public.pricing_template_addons where template_id = p_template order by sort_order, addon_key loop
    addons := addons || jsonb_build_object('id', 'addon-' || (jsonb_array_length(addons) + 1), 'name', a.label,
      'description', a.description, 'price_kind', 'exact', 'price', a.default_price,
      'min_quantity', 0, 'max_quantity', 1, 'is_required', false, 'frequencies', '[]'::jsonb);
  end loop;

  draft := private.save_package_draft(null, null, p_contractor, template.service_id, null,
    jsonb_build_object('name', template.name, 'description', template.description, 'pricing_mode', 'fixed',
      'questions', questions, 'tiers', tiers, 'addons', addons), null, p_template);
  return private.operator_package_draft_json(draft) || jsonb_build_object('copy_notes', notes);
end $$;

-- Approval --------------------------------------------------------------------------------

-- Sends the revision the operator is looking at to the bound vendor account.
create function public.admin_send_package_draft(p_draft uuid, p_revision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  draft private.operator_package_drafts;
  vendor_user uuid;
  link jsonb;
  notification uuid;
  resend boolean;
begin
  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_revision is null or p_revision <> draft.content_hash then
    raise exception 'Draft changed since it was read; reload before sending' using errcode = '40001';
  end if;
  if draft.approval_state = 'approved' then raise exception 'The vendor already approved this revision'; end if;
  -- The catalog may have changed since the draft was saved.
  perform private.pricing_normalize_content(draft.content, draft.service_id);

  link := private.package_draft_vendor_link(draft.contractor_id);
  if not coalesce((link ->> 'vendor_role')::boolean, false) then
    perform private.record_package_draft_event(draft.id, 'send_blocked', actor, 'operator', draft.content_hash, null, null,
      link ->> 'blocker');
    return jsonb_build_object('status', 'blocked', 'reason', link ->> 'blocker',
      'draft', private.operator_package_draft_json(draft));
  end if;
  select c.user_id into vendor_user from public.contractors c where c.id = draft.contractor_id;

  resend := draft.approval_state = 'sent' and draft.sent_hash = draft.content_hash;
  insert into public.notifications(user_id, type, severity, title, body, link, related_contractor_id)
    values (vendor_user, 'pricing', 'info', 'A price is waiting for your approval',
      draft.name || ': review the price Mercurius prepared and approve it or ask for changes.',
      '/vendor/packages#price-approvals', draft.contractor_id)
    returning id into notification;
  update private.operator_package_drafts
     set approval_state = 'sent', sent_hash = draft.content_hash, sent_at = now(), sent_by = actor,
         notification_id = notification, change_request = null
   where id = draft.id returning * into draft;
  perform private.record_package_draft_event(draft.id, case when resend then 'resent' else 'sent' end, actor, 'operator',
    draft.content_hash, null, jsonb_build_object('notification_id', notification), null);
  return jsonb_build_object('status', 'sent', 'draft', private.operator_package_draft_json(draft));
end $$;

-- The authenticated vendor account bound to the draft's provider.
create function private.require_draft_vendor(p_draft uuid) returns private.operator_package_drafts
language plpgsql security definer set search_path = '' as $$
declare draft private.operator_package_drafts;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'vendor') then
    raise exception 'Vendor account required' using errcode = '42501';
  end if;
  select d.* into draft from private.operator_package_drafts d
    join public.contractors c on c.id = d.contractor_id and c.user_id = auth.uid()
   where d.id = p_draft for update of d;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  return draft;
end $$;

create function public.vendor_approve_package_draft(p_draft uuid, p_revision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare draft private.operator_package_drafts;
begin
  draft := private.require_draft_vendor(p_draft);
  if draft.status <> 'draft' then raise exception 'This price was already published or withdrawn'; end if;
  -- A retry of the same approval changes nothing.
  if draft.approval_state = 'approved' and draft.approved_hash = p_revision then
    return private.vendor_package_draft_json(draft);
  end if;
  if draft.approval_state <> 'sent' or p_revision is null or p_revision <> draft.content_hash
     or draft.sent_hash <> draft.content_hash then
    raise exception 'This price changed since you opened it; reload to review the current version' using errcode = '40001';
  end if;
  update private.operator_package_drafts
     set approval_state = 'approved', approved_hash = draft.content_hash, approved_at = now(), approved_by = auth.uid(),
         change_request = null
   where id = draft.id returning * into draft;
  perform private.record_package_draft_event(draft.id, 'approved', auth.uid(), 'vendor', draft.content_hash, null, null, null);
  return private.vendor_package_draft_json(draft);
end $$;

create function public.vendor_request_package_changes(p_draft uuid, p_revision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  draft private.operator_package_drafts;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  draft := private.require_draft_vendor(p_draft);
  if note is null then raise exception 'Say what should change'; end if;
  if length(note) > 1000 then raise exception 'Keep the note under 1000 characters'; end if;
  if draft.status <> 'draft' then raise exception 'This price was already published or withdrawn'; end if;
  if draft.approval_state not in ('sent', 'approved') or p_revision is null or p_revision <> draft.content_hash then
    raise exception 'This price changed since you opened it; reload to review the current version' using errcode = '40001';
  end if;
  update private.operator_package_drafts
     set approval_state = 'changes_requested', change_request = note,
         approved_hash = null, approved_at = null, approved_by = null
   where id = draft.id returning * into draft;
  perform private.record_package_draft_event(draft.id, 'changes_requested', auth.uid(), 'vendor', draft.content_hash, null, null, note);
  return private.vendor_package_draft_json(draft);
end $$;

-- Drafts waiting for, or recently given, the signed-in vendor's decision.
create function public.vendor_package_approvals()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'vendor') then
    raise exception 'Vendor account required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.vendor_package_draft_json(d) order by d.sent_at desc nulls last, d.id)
    from private.operator_package_drafts d
    join public.contractors c on c.id = d.contractor_id and c.user_id = auth.uid()
   where d.approval_state <> 'draft'
     and (d.status = 'draft' or d.closed_at > now() - interval '30 days')), '[]'::jsonb);
end $$;

-- Preview ---------------------------------------------------------------------------------

-- Plain answers {key: value} as the calculation reads them.
create function private.pricing_preview_answers(p_answers jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_answers is null or jsonb_typeof(p_answers) <> 'object' then null
    else coalesce((select jsonb_object_agg(key, jsonb_build_object('answer', btrim(value #>> '{}')))
      from jsonb_each(p_answers) where jsonb_typeof(value) in ('string', 'number') and btrim(value #>> '{}') <> ''), '{}'::jsonb) end
$$;

-- The homeowner's view of unsaved content (operator) or of a saved draft (operator or the
-- draft's vendor), priced by the same calculation as requests.
create function public.pricing_preview_content(p_service text, p_content jsonb, p_frequency text, p_tier text,
  p_answers jsonb, p_addons jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return private.price_selection(private.pricing_normalize_content(p_content, p_service), p_frequency,
    nullif(p_tier, ''), private.pricing_preview_answers(p_answers), p_addons);
end $$;

create function public.pricing_preview_draft(p_draft uuid, p_frequency text, p_tier text, p_answers jsonb, p_addons jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare draft private.operator_package_drafts;
begin
  select d.* into draft from private.operator_package_drafts d where d.id = p_draft;
  if not found or not (public.has_role(auth.uid(), 'admin') or (public.has_role(auth.uid(), 'vendor')
      and exists (select 1 from public.contractors c where c.id = draft.contractor_id and c.user_id = auth.uid()))) then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  return private.price_selection(draft.content, p_frequency, nullif(p_tier, ''),
    private.pricing_preview_answers(p_answers), p_addons) || jsonb_build_object('revision', draft.content_hash);
end $$;

-- Publication -----------------------------------------------------------------------------

-- Replaces TRACE-110 publication: only the vendor-approved revision, with a reason.
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
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Publish reason required'; end if;
  if length(reason) > 500 then raise exception 'Publish reason too long'; end if;

  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at then
    raise exception 'Draft changed since it was read; reload before publishing' using errcode = '40001';
  end if;
  -- TRACE-113: only the revision the vendor approved.
  if draft.approval_state <> 'approved' or draft.approved_hash is distinct from draft.content_hash
     or draft.content_hash <> private.draft_revision_hash(draft) then
    raise exception 'The vendor has not approved this revision; send it for approval first' using errcode = '42501';
  end if;
  select * into service from public.services_catalog s where s.id = draft.service_id;
  if not service.is_active then raise exception 'Choose an active catalog service'; end if;
  -- Re-checked: the catalog's cadence list may have changed since approval.
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
    jsonb_build_object('package_id', new_package, 'replaced_package_id', replaced, 'revision_number', next_revision), reason);

  select c.user_id into vendor_user from public.contractors c where c.id = draft.contractor_id;
  if vendor_user is not null then
    perform public.notify_user(vendor_user, 'pricing', 'info', 'Your approved price is live',
      (content ->> 'name') || ': ' || reason, '/vendor/packages', null, draft.contractor_id);
  end if;

  return jsonb_build_object('package_id', new_package, 'needs_review', review, 'vendor_notified', vendor_user is not null,
    'replaced_package_id', replaced, 'revision_number', next_revision);
end $$;

-- Discard keeps its TRACE-110 behavior and is now recorded.
create or replace function public.admin_discard_package_draft(p_draft uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  draft private.operator_package_drafts;
begin
  actor := public.vendor_require_operator();
  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at then
    raise exception 'Draft changed since it was read; reload before discarding' using errcode = '40001';
  end if;
  update private.operator_package_drafts
     set status = 'discarded', closed_by = actor, closed_at = now(), updated_by = actor, updated_at = now()
   where id = p_draft returning * into draft;
  perform private.record_package_draft_event(draft.id, 'discarded', actor, 'operator', draft.content_hash, null, null, null);
  return private.operator_package_draft_json(draft);
end $$;

-- History and inventory -------------------------------------------------------------------

create function public.admin_package_draft_events(p_draft uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor_role', e.actor_role,
      'actor_email', (select u.email from auth.users u where u.id = e.actor), 'revision', e.revision,
      'previous_revision', e.previous_revision, 'changes', e.changes, 'note', e.note, 'created_at', e.created_at)
    order by e.sequence) from private.package_draft_events e where e.draft_id = p_draft), '[]'::jsonb);
end $$;

-- How many live packages carry recorded vendor approval. Nothing is changed or inferred:
-- a package without an approved draft behind it is reported as such.
create function public.admin_pricing_approval_inventory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return (select jsonb_build_object(
    'active_packages', count(*),
    'vendor_approved_revision', count(*) filter (where approved.package_id is not null),
    'published_without_vendor_approval', count(*) filter (where approved.package_id is null and drafted.package_id is not null),
    'vendor_or_legacy_editor', count(*) filter (where drafted.package_id is null and p.template_id is null),
    'managed_template', count(*) filter (where drafted.package_id is null and p.template_id is not null),
    'operator_corrected', count(*) filter (where exists (select 1 from private.vendor_package_price_corrections h where h.package_id = p.id)))
  from public.vendor_packages p
  left join lateral (select d.package_id from private.operator_package_drafts d
    where d.package_id = p.id and d.status = 'published' limit 1) drafted on true
  left join lateral (select d.package_id from private.operator_package_drafts d
    where d.package_id = p.id and d.status = 'published' and d.approved_hash = d.content_hash limit 1) approved on true
  where p.is_active);
end $$;

revoke all on function
  private.pricing_text(jsonb, integer, text, boolean), private.pricing_text_list(jsonb, integer, integer, text),
  private.pricing_bound(jsonb, text), private.pricing_normalize_content(jsonb, text),
  private.draft_content_from_prices(text, text, jsonb), private.draft_revision_hash(private.operator_package_drafts),
  private.package_draft_vendor_link(uuid), private.package_draft_delivery(private.operator_package_drafts),
  private.vendor_package_draft_json(private.operator_package_drafts),
  private.record_package_draft_event(uuid, text, uuid, text, text, text, jsonb, text),
  private.pricing_content_changes(jsonb, jsonb),
  private.save_package_draft(uuid, timestamptz, uuid, text, uuid, jsonb, jsonb, uuid),
  private.require_draft_vendor(uuid), private.pricing_preview_answers(jsonb),
  public.admin_save_package_draft_content(uuid, timestamptz, uuid, text, uuid, jsonb),
  public.admin_draft_from_template(uuid, uuid, text),
  public.admin_send_package_draft(uuid, text),
  public.vendor_approve_package_draft(uuid, text),
  public.vendor_request_package_changes(uuid, text, text),
  public.vendor_package_approvals(),
  public.pricing_preview_content(text, jsonb, text, text, jsonb, jsonb),
  public.pricing_preview_draft(uuid, text, text, jsonb, jsonb),
  public.admin_package_draft_events(uuid),
  public.admin_pricing_approval_inventory()
from public, anon, authenticated, service_role;
grant execute on function
  public.admin_save_package_draft_content(uuid, timestamptz, uuid, text, uuid, jsonb),
  public.admin_draft_from_template(uuid, uuid, text),
  public.admin_send_package_draft(uuid, text),
  public.vendor_approve_package_draft(uuid, text),
  public.vendor_request_package_changes(uuid, text, text),
  public.vendor_package_approvals(),
  public.pricing_preview_content(text, jsonb, text, text, jsonb, jsonb),
  public.pricing_preview_draft(uuid, text, text, jsonb, jsonb),
  public.admin_package_draft_events(uuid),
  public.admin_pricing_approval_inventory()
to authenticated;
