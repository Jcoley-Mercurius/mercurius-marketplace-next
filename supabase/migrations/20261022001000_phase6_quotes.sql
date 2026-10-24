-- Phase 6.4 marketplace quotes (TRACE-119; owner decisions DEC-2026-045 G1–G6).
--
-- MPS §4 role contract: the assigned provider proposes, Mercurius sends or corrects with a
-- reason, the homeowner approves. This migration adds:
--
-- * Provider proposals (preliminary, itemized estimates for operator review).
-- * Itemized quote terms (G1): service, labor, materials, add-on and discount lines with
--   quantities and unit prices in whole cents; service subtotal computed here, never by the
--   browser. Tax is "pending confirmation" unless a confirmed treatment is recorded. No command
--   in this migration records a confirmed treatment: no approved tax rule exists
--   (DEC-2026-015 §4), so none is invented. Homeowner approval requires confirmed tax.
-- * Deposit $0 (G2) and the existing invoice/checkout payment timing as the payment terms.
--   Jobs that would require a deposit need an operator review before a quote is sent.
-- * Accepted quotes are final on every path (G3): the older single-amount operator send is
--   retired, and triggers refuse any change to an accepted quote or the request fields that
--   point at it. A needed change after acceptance is an operator exception, not new terms.
-- * Aging and exception queue (G4–G6), computed from recorded timestamps so editing a request
--   never resets a clock. Queue items never accept, cancel, reassign, extend, charge, refund,
--   start service or release funds. No reminders or external messages.
-- * Provider eligibility (G5, private.vendor_matching_eligible) rechecked at proposal, send
--   and homeowner approval; assigned jobs of an ineligible provider are flagged, never
--   unassigned or cancelled.
--
-- Unchanged: request_quotes columns, 24-hour expiry (DEC-2026-008) and its worker, quote scope
-- capture, private.money_source and every snapshot/checkout/refund/payout kernel, matching,
-- pricing, promotions (gate closed) and R0 admission. Existing accepted quotes and their
-- histories are preserved as recorded; nothing is backfilled or reinterpreted.

-- ---------------------------------------------------------------------------- shared rules

create function private.quote_policy_version() returns text language sql immutable set search_path = '' as $$
  select 'DEC-2026-045'::text
$$;

create function private.quote_payment_terms() returns text language sql immutable set search_path = '' as $$
  select 'No deposit. Payment through a Mercurius invoice and secure checkout under the approved payment timing.'::text
$$;

-- G1: normalize and price quote lines. Whole cents only; no rounding rule is applied.
create function private.quote_items(p_items jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare item jsonb; kind text; label text; qty numeric; unit bigint; amount numeric;
  lines jsonb := '[]'::jsonb; service bigint := 0; addons bigint := 0; discount bigint := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'List between 1 and 50 quote items' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'Each quote item must be an object' using errcode = '22023'; end if;
    kind := item ->> 'kind';
    if kind is null or kind not in ('service', 'labor', 'materials', 'addon', 'discount') then
      raise exception 'Each item needs a type: service, labor, materials, add-on or discount' using errcode = '22023';
    end if;
    label := nullif(btrim(coalesce(item ->> 'description', '')), '');
    if label is null or length(label) > 200 then
      raise exception 'Each item needs a description (up to 200 characters)' using errcode = '22023';
    end if;
    begin
      qty := (item ->> 'quantity')::numeric;
      unit := (item ->> 'unit_cents')::bigint;
    exception when others then
      raise exception 'Quantities and unit prices must be numbers; unit prices are whole cents' using errcode = '22023';
    end;
    if qty is null or qty <= 0 or qty > 10000 or qty * 100 <> trunc(qty * 100) then
      raise exception 'Quantity must be greater than 0 with at most two decimals' using errcode = '22023';
    end if;
    if unit is null or unit <= 0 or unit > 10000000000 then
      raise exception 'Unit price must be greater than $0' using errcode = '22023';
    end if;
    amount := qty * unit;
    if amount <> trunc(amount) then
      raise exception 'Quantity times unit price must come to whole cents' using errcode = '22023';
    end if;
    lines := lines || jsonb_build_object('kind', kind, 'description', label, 'quantity', trim_scale(qty),
      'unit_cents', unit, 'amount_cents', amount::bigint);
    if kind = 'addon' then addons := addons + amount::bigint;
    elsif kind = 'discount' then discount := discount + amount::bigint;
    else service := service + amount::bigint; end if;
  end loop;
  if service + addons = 0 then
    raise exception 'Add at least one service, labor, materials or add-on item' using errcode = '22023';
  end if;
  if discount >= service + addons then
    raise exception 'Discounts must leave a subtotal greater than $0' using errcode = '22023';
  end if;
  if service + addons - discount > 1000000000000 then raise exception 'Quote subtotal is too large' using errcode = '22023'; end if;
  return jsonb_build_object('items', lines, 'service_cents', service, 'addons_cents', addons,
    'discount_cents', discount, 'subtotal_cents', service + addons - discount);
end $$;

-- G2: a job whose request or selected offering asks for a deposit needs operator review.
create function private.quote_deposit_required(r public.service_requests) returns boolean language sql stable security definer set search_path = '' as $$
  select r.pricing_mode = 'deposit_quote'
    or coalesce(nullif(r.pricing_inputs ->> 'deposit_cents', '')::bigint, 0) > 0
    or exists (select 1 from public.vendor_packages p where p.id = r.package_id and coalesce(p.deposit_amount, 0) > 0)
$$;

-- G5: the one provider eligibility rule (suspension, exclusions, evidence, cutover).
create function private.quote_provider_eligible(p_contractor uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select p_contractor is null or coalesce(private.vendor_matching_eligible(p_contractor), false)
$$;

revoke all on function private.quote_policy_version(), private.quote_payment_terms(), private.quote_items(jsonb),
  private.quote_deposit_required(public.service_requests), private.quote_provider_eligible(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------- proposals

create table public.request_quote_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id),
  contractor_id uuid not null references public.contractors(id),
  proposer_id uuid not null references auth.users(id),
  items jsonb not null,
  subtotal_cents bigint not null check (subtotal_cents > 0),
  scope text not null check (length(btrim(scope)) between 1 and 2000),
  based_on_revision integer not null check (based_on_revision >= 0),
  context jsonb not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'returned', 'superseded')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  quote_id uuid references public.request_quotes(id),
  corrected boolean,
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'sent') = (quote_id is not null and corrected is not null)),
  check (status not in ('sent', 'returned') or (decided_by is not null and length(btrim(coalesce(decision_reason, ''))) > 0))
);
create unique index request_quote_proposals_one_pending on public.request_quote_proposals(request_id) where status = 'pending';
create index request_quote_proposals_request on public.request_quote_proposals(request_id, created_at desc);
comment on table public.request_quote_proposals is
  'TRACE-119: preliminary itemized provider estimates for operator review (MPS §4). Sent proposals become quote revisions.';

alter table public.request_quote_proposals enable row level security;
revoke all on public.request_quote_proposals from public, anon, authenticated;
grant select on public.request_quote_proposals to authenticated;
grant all on public.request_quote_proposals to service_role;
create policy "Operators read quote proposals" on public.request_quote_proposals for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
create policy "Providers read their own quote proposals" on public.request_quote_proposals for select to authenticated
  using (exists (select 1 from public.contractors c where c.id = contractor_id and c.user_id = auth.uid()));

create function private.guard_quote_proposal() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Quote proposals are kept as history' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['status', 'decided_by', 'decided_at', 'decision_reason', 'quote_id', 'corrected'])
    is distinct from (to_jsonb(old) - array['status', 'decided_by', 'decided_at', 'decision_reason', 'quote_id', 'corrected']) then
    raise exception 'Quote proposal terms are immutable; propose again' using errcode = '42501';
  end if;
  if old.status <> 'pending' then raise exception 'This quote proposal was already handled' using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function private.guard_quote_proposal() from public, anon, authenticated;
create trigger preserve_quote_proposal before update or delete on public.request_quote_proposals
  for each row execute function private.guard_quote_proposal();

-- ---------------------------------------------------------------------------- itemized terms

create table public.request_quote_terms (
  quote_id uuid primary key references public.request_quotes(id),
  request_id uuid not null references public.service_requests(id),
  proposal_id uuid references public.request_quote_proposals(id),
  items jsonb not null,
  scope text not null check (length(btrim(scope)) between 1 and 2000),
  service_cents bigint not null check (service_cents >= 0),
  addons_cents bigint not null check (addons_cents >= 0),
  discount_cents bigint not null check (discount_cents >= 0),
  subtotal_cents bigint not null check (subtotal_cents > 0 and subtotal_cents = service_cents + addons_cents - discount_cents),
  tax_status text not null check (tax_status in ('pending', 'confirmed')),
  tax_cents bigint check (tax_cents >= 0),
  tax_basis text,
  total_cents bigint,
  deposit_cents bigint not null default 0 check (deposit_cents = 0),
  payment_terms text not null check (length(btrim(payment_terms)) > 0),
  policy_version text not null check (length(btrim(policy_version)) > 0),
  created_at timestamptz not null default now(),
  check ((tax_status = 'pending' and tax_cents is null and tax_basis is null and total_cents is null)
    or (tax_status = 'confirmed' and tax_cents is not null and total_cents = subtotal_cents + tax_cents
      and length(btrim(coalesce(tax_basis, ''))) > 0))
);
create index request_quote_terms_request on public.request_quote_terms(request_id);
comment on table public.request_quote_terms is
  'DEC-2026-045 G1/G2: immutable itemized terms of a quote revision. Tax pending until a confirmed treatment exists; deposit $0.';

alter table public.request_quote_terms enable row level security;
revoke all on public.request_quote_terms from public, anon, authenticated;
grant select on public.request_quote_terms to authenticated;
grant all on public.request_quote_terms to service_role;
create policy "Quote participants read itemized terms" on public.request_quote_terms for select to authenticated using
  (exists (select 1 from public.service_requests r where r.id = request_id and
    (r.customer_id = auth.uid() or public.has_role(auth.uid(), 'admin') or exists
      (select 1 from public.contractors c where c.id = r.contractor_id and c.user_id = auth.uid()))));

create function private.guard_quote_terms() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Quote terms are immutable; send a new revision' using errcode = '42501';
end $$;
revoke all on function private.guard_quote_terms() from public, anon, authenticated;
create trigger preserve_itemized_terms before update or delete on public.request_quote_terms
  for each row execute function private.guard_quote_terms();

-- ---------------------------------------------------------------------------- G3 guards

-- A decided quote stays decided: no status or decision rewrite on any path.
create function private.guard_quote_decision() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'submitted' and jsonb_build_array(new.status, new.decision_actor, new.decided_at)
    is distinct from jsonb_build_array(old.status, old.decision_actor, old.decided_at) then
    raise exception 'A decided quote cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_quote_decision() from public, anon, authenticated;
create trigger preserve_quote_decision before update on public.request_quotes
  for each row execute function private.guard_quote_decision();

-- The request keeps pointing at its accepted quote, whatever the caller.
create function private.guard_accepted_quote_request() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.quote_status = 'accepted' and jsonb_build_array(new.current_quote_id, new.quote_revision, new.quote_status,
      new.quote_amount, new.quote_approved_at, new.quote_declined_at, new.quote_expires_at)
    is distinct from jsonb_build_array(old.current_quote_id, old.quote_revision, old.quote_status,
      old.quote_amount, old.quote_approved_at, old.quote_declined_at, old.quote_expires_at) then
    raise exception 'The homeowner accepted this quote; its terms cannot be replaced. Open an operator exception instead'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_accepted_quote_request() from public, anon, authenticated;
create trigger preserve_accepted_quote before update on public.service_requests
  for each row execute function private.guard_accepted_quote_request();

-- ---------------------------------------------------------------------------- operator exceptions

create table public.request_quote_exceptions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id),
  kind text not null check (kind in ('accepted_change', 'deposit_review', 'provider_review')),
  subject text not null,
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  resolution text,
  check ((closed_at is null) = (closed_by is null)),
  check (closed_at is null or length(btrim(coalesce(resolution, ''))) between 1 and 2000)
);
create unique index request_quote_exceptions_one_open on public.request_quote_exceptions(request_id, kind, subject) where closed_at is null;
comment on table public.request_quote_exceptions is
  'DEC-2026-045: operator exceptions (accepted-quote change, G3) and recorded reviews (deposit G2, provider eligibility G5).';

alter table public.request_quote_exceptions enable row level security;
revoke all on public.request_quote_exceptions from public, anon, authenticated;
grant select on public.request_quote_exceptions to authenticated;
grant all on public.request_quote_exceptions to service_role;
create policy "Operators read quote exceptions" on public.request_quote_exceptions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create function private.guard_quote_exception() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Quote exceptions are kept as history' using errcode = '42501'; end if;
  if old.closed_at is not null
    or (to_jsonb(new) - array['closed_by', 'closed_at', 'resolution']) is distinct from (to_jsonb(old) - array['closed_by', 'closed_at', 'resolution']) then
    raise exception 'Quote exceptions are closed once and otherwise immutable' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_quote_exception() from public, anon, authenticated;
create trigger preserve_quote_exception before update or delete on public.request_quote_exceptions
  for each row execute function private.guard_quote_exception();

-- ---------------------------------------------------------------------------- commands

create function public.vendor_propose_quote(_job_id uuid, _items jsonb, _scope text, _expected_revision integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; c public.contractors; pending public.request_quote_proposals;
  v_priced jsonb; v_scope text; v_context jsonb; v_proposal uuid; v_admin uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to propose a quote' using errcode = '42501'; end if;
  v_priced := private.quote_items(_items);
  v_scope := nullif(btrim(coalesce(_scope, '')), '');
  if v_scope is null or length(v_scope) > 2000 then
    raise exception 'Describe what the quote covers (up to 2,000 characters)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  select * into c from public.contractors where user_id = auth.uid();
  if r.id is null or c.id is null or r.contractor_id is distinct from c.id then
    raise exception 'Only the provider assigned to this request can propose a quote' using errcode = '42501';
  end if;
  if not private.quote_provider_eligible(c.id) then
    raise exception 'Your provider account is not currently eligible to propose quotes' using errcode = '42501';
  end if;
  if r.matching_status is distinct from 'matched' or r.status not in ('matched', 'quoted', 'scheduled') then
    raise exception 'This request is not open for a quote' using errcode = '22023';
  end if;
  if not (coalesce(r.quote_only, false) or r.pricing_mode is distinct from 'fixed') then
    raise exception 'This request has a fixed price, so no quote is needed' using errcode = '22023';
  end if;
  if r.quote_status = 'accepted' then
    raise exception 'The homeowner already accepted a quote; contact Mercurius to change agreed terms' using errcode = '22023';
  end if;
  if _expected_revision is distinct from r.quote_revision then
    raise exception 'Quote changed; refresh before proposing' using errcode = '22023';
  end if;
  v_context := private.money_source_context(r) - 'contractor';

  select * into pending from public.request_quote_proposals where request_id = r.id and status = 'pending' for update;
  if pending.id is not null and pending.proposer_id = auth.uid() and pending.contractor_id = c.id
    and pending.items = v_priced -> 'items' and pending.scope = v_scope
    and pending.based_on_revision = r.quote_revision and pending.context = v_context then
    return pending.id; -- Lost-response retry of the same proposal.
  end if;
  if pending.id is not null then
    update public.request_quote_proposals set status = 'superseded', decided_at = now() where id = pending.id;
  end if;
  insert into public.request_quote_proposals(request_id, contractor_id, proposer_id, items, subtotal_cents, scope, based_on_revision, context)
    values (r.id, c.id, auth.uid(), v_priced -> 'items', (v_priced ->> 'subtotal_cents')::bigint, v_scope, r.quote_revision, v_context)
    returning id into v_proposal;

  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_proposed',
    'proposal_id', v_proposal, 'supersedes', pending.id, 'subtotal_cents', (v_priced ->> 'subtotal_cents')::bigint,
    'based_on_revision', r.quote_revision));
  for v_admin in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify_user(v_admin, 'job_status', 'info', 'Quote proposal ready for review',
      'The assigned provider proposed an itemized quote. Review it and send it to the homeowner, corrected if needed, or return it with a reason.',
      '/admin/requests', r.id, r.contractor_id);
  end loop;
  return v_proposal;
end $$;
revoke all on function public.vendor_propose_quote(uuid, jsonb, text, integer) from public, anon;
grant execute on function public.vendor_propose_quote(uuid, jsonb, text, integer) to authenticated;

-- G1/G3: the only way to send a quote. Single-amount quotes are retired.
create function public.admin_send_itemized_quote(_job_id uuid, _items jsonb, _scope text, _reason text,
  _expected_revision integer, _proposal_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; p public.request_quote_proposals; v_priced jsonb; v_scope text; v_reason text;
  v_subtotal bigint; v_quote uuid; v_corrected boolean; v_vendor_user uuid; v_existing public.request_quote_terms;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can send quotes' using errcode = '42501';
  end if;
  v_priced := private.quote_items(_items);
  v_subtotal := (v_priced ->> 'subtotal_cents')::bigint;
  v_scope := nullif(btrim(coalesce(_scope, '')), '');
  if v_scope is null or length(v_scope) > 2000 then
    raise exception 'Describe what the quote covers (up to 2,000 characters)' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(coalesce(_reason, '')), '');
  if v_reason is null then raise exception 'Quote reason required' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null then raise exception 'Job cannot receive a quote' using errcode = '22023'; end if;
  if _proposal_id is not null then
    select * into p from public.request_quote_proposals where id = _proposal_id for update;
    if p.id is null or p.request_id <> r.id then raise exception 'Quote proposal not found' using errcode = '22023'; end if;
    if p.status = 'sent' then
      select * into v_existing from public.request_quote_terms where quote_id = p.quote_id;
      -- Lost-response retry of the same send returns the quote it created.
      if p.decided_by = auth.uid() and p.decision_reason = v_reason and v_existing.items = v_priced -> 'items'
        and v_existing.scope = v_scope then return p.quote_id; end if;
      raise exception 'This quote proposal was already sent; refresh' using errcode = '22023';
    end if;
    if p.status <> 'pending' then raise exception 'This quote proposal was already handled; refresh' using errcode = '22023'; end if;
  end if;
  if r.status not in ('pending', 'matched', 'quoted', 'scheduled') then
    raise exception 'Job cannot receive a quote' using errcode = '22023';
  end if;
  if r.quote_status = 'accepted' then
    raise exception 'The homeowner accepted the current quote; its terms cannot be replaced. Open an operator exception instead'
      using errcode = '22023';
  end if;
  if _expected_revision is distinct from r.quote_revision then
    raise exception 'Quote changed; refresh before sending' using errcode = '22023';
  end if;
  if not private.quote_provider_eligible(r.contractor_id) then
    raise exception 'The assigned provider is not currently eligible; review the assignment before sending a quote'
      using errcode = '22023';
  end if;
  if private.quote_deposit_required(r) and not exists (select 1 from public.request_quote_exceptions x
      where x.request_id = r.id and x.kind = 'deposit_review' and x.closed_at is not null) then
    raise exception 'This job asks for a deposit; record the deposit review before sending a quote' using errcode = '22023';
  end if;
  if p.id is not null then
    if p.contractor_id is distinct from r.contractor_id then
      raise exception 'The provider changed since this proposal; ask the assigned provider to propose again' using errcode = '22023';
    end if;
    if p.based_on_revision is distinct from r.quote_revision then
      raise exception 'Quote changed; refresh before sending' using errcode = '22023';
    end if;
    if p.context is distinct from private.money_source_context(r) - 'contractor' then
      raise exception 'Request details changed since this proposal; ask the provider to propose again' using errcode = '22023';
    end if;
  end if;

  -- Same revision mechanics as the Phase 4 command (DEC-2026-008): supersede, 24-hour deadline.
  update public.request_quotes set status = 'superseded' where request_id = r.id and status = 'submitted';
  insert into public.request_quotes(request_id, revision, supersedes_id, amount, sender_id, reason)
    values (r.id, r.quote_revision + 1, r.current_quote_id, v_subtotal / 100.0, auth.uid(), v_reason)
    returning id into v_quote;
  insert into public.request_quote_terms(quote_id, request_id, proposal_id, items, scope, service_cents, addons_cents,
      discount_cents, subtotal_cents, tax_status, deposit_cents, payment_terms, policy_version)
    values (v_quote, r.id, p.id, v_priced -> 'items', v_scope, (v_priced ->> 'service_cents')::bigint,
      (v_priced ->> 'addons_cents')::bigint, (v_priced ->> 'discount_cents')::bigint, v_subtotal, 'pending', 0,
      private.quote_payment_terms(), private.quote_policy_version());
  update public.service_requests set current_quote_id = v_quote, quote_revision = r.quote_revision + 1,
    quote_status = 'submitted', quote_expires_at = now() + interval '24 hours', quote_amount = v_subtotal / 100.0,
    quote_approved_at = null, quote_declined_at = null, updated_at = now() where id = r.id;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_submitted',
    'quote_id', v_quote, 'revision', r.quote_revision + 1, 'supersedes', r.current_quote_id, 'subtotal_cents', v_subtotal,
    'tax', 'pending', 'deposit_cents', 0, 'proposal_id', p.id, 'reason', v_reason, 'expires_at', now() + interval '24 hours',
    'policy', private.quote_policy_version()));
  perform public.notify_user(r.customer_id, 'job_status', 'info', 'Itemized quote ready to review',
    'Review the itemized price. Tax is pending confirmation, so this quote can''t be approved yet; Mercurius sends a final quote once tax is confirmed. Provider acceptance controls scheduling; a quote is not a payment.',
    '/dashboard', r.id, r.contractor_id);

  if p.id is not null then
    v_corrected := p.items is distinct from v_priced -> 'items' or p.scope is distinct from v_scope;
    update public.request_quote_proposals set status = 'sent', decided_by = auth.uid(), decided_at = now(),
      decision_reason = v_reason, quote_id = v_quote, corrected = v_corrected where id = p.id;
    perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_proposal_sent',
      'proposal_id', p.id, 'quote_id', v_quote, 'corrected', v_corrected));
    select user_id into v_vendor_user from public.contractors where id = p.contractor_id;
    if v_vendor_user is not null then
      perform public.notify_user(v_vendor_user, 'job_status', 'info',
        case when v_corrected then 'Your quote was corrected and sent' else 'Your quote was sent' end,
        case when v_corrected then 'Mercurius corrected your proposal before sending it to the homeowner. Open the job to see the items and reason.'
          else 'Mercurius sent your proposed quote to the homeowner.' end,
        '/vendor/jobs', r.id, p.contractor_id);
    end if;
  end if;
  return v_quote;
end $$;
revoke all on function public.admin_send_itemized_quote(uuid, jsonb, text, text, integer, uuid) from public, anon;
grant execute on function public.admin_send_itemized_quote(uuid, jsonb, text, text, integer, uuid) to authenticated;

-- G1/G3: the Phase 4 single-amount send could replace an accepted quote and cannot carry an
-- itemized breakdown. Same signature, now refused for every caller.
create or replace function public.admin_send_quote(_job_id uuid, _amount numeric, _reason text, _expected_revision integer)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  raise exception 'Quotes are itemized (DEC-2026-045); send an itemized quote' using errcode = '22023';
end;
$$;

create function public.admin_return_quote_proposal(_proposal_id uuid, _reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.request_quote_proposals; v_request uuid; v_reason text; v_vendor_user uuid;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can return quote proposals' using errcode = '42501';
  end if;
  v_reason := nullif(btrim(coalesce(_reason, '')), '');
  if v_reason is null then raise exception 'Explain why the proposal is returned' using errcode = '22023'; end if;
  select x.request_id into v_request from public.request_quote_proposals x where x.id = _proposal_id;
  if v_request is null then raise exception 'Quote proposal not found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request::text, 0));
  perform 1 from public.service_requests where id = v_request for update;
  select * into strict p from public.request_quote_proposals where id = _proposal_id for update;
  if p.status = 'returned' and p.decision_reason = v_reason and p.decided_by = auth.uid() then return; end if;
  if p.status <> 'pending' then raise exception 'This quote proposal was already handled; refresh' using errcode = '22023'; end if;
  update public.request_quote_proposals set status = 'returned', decided_by = auth.uid(), decided_at = now(),
    decision_reason = v_reason where id = p.id;
  perform public.log_job_event(p.request_id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_proposal_returned',
    'proposal_id', p.id, 'reason', v_reason));
  select user_id into v_vendor_user from public.contractors where id = p.contractor_id;
  if v_vendor_user is not null then
    perform public.notify_user(v_vendor_user, 'job_status', 'warning', 'Your quote proposal was returned',
      'Mercurius returned your quote proposal without sending it. Open the job to see why and propose again.',
      '/vendor/jobs', p.request_id, p.contractor_id);
  end if;
end $$;
revoke all on function public.admin_return_quote_proposal(uuid, text) from public, anon;
grant execute on function public.admin_return_quote_proposal(uuid, text) to authenticated;

-- Restated from 20260904001000 with the DEC-2026-045 approval requirements (G1, G2, G5).
-- Decline, identity, stale-revision and deadline checks are unchanged.
create or replace function public.homeowner_respond_to_quote(_job_id uuid,_approve boolean,_quote_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests; q public.request_quotes; t public.request_quote_terms; admin_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_job_id FOR UPDATE;
  IF auth.uid() IS NULL OR r.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the homeowner can respond to this quote' USING ERRCODE='42501';
  END IF;
  IF _quote_id IS NULL OR _quote_id IS DISTINCT FROM r.current_quote_id THEN RAISE EXCEPTION 'Quote changed; refresh before responding' USING ERRCODE='22023'; END IF;
  SELECT * INTO q FROM public.request_quotes WHERE id=_quote_id FOR UPDATE;
  IF _approve IS NULL OR q.status<>'submitted' OR r.status NOT IN ('pending','matched','quoted','scheduled') THEN
    RAISE EXCEPTION 'There is no open quote on this job' USING ERRCODE='22023';
  END IF;
  IF q.expires_at<=now() THEN RAISE EXCEPTION 'Quote has expired' USING ERRCODE='22023'; END IF;
  IF _approve THEN
    SELECT * INTO t FROM public.request_quote_terms WHERE quote_id=q.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This quote has no itemized breakdown; Mercurius must send an itemized quote before it can be approved' USING ERRCODE='22023';
    END IF;
    IF t.tax_status<>'confirmed' THEN
      RAISE EXCEPTION 'Tax pending confirmation; this quote can''t be approved until Mercurius confirms tax' USING ERRCODE='22023';
    END IF;
    IF t.total_cents IS DISTINCT FROM round(q.amount*100)::bigint OR t.deposit_cents<>0
      OR nullif(btrim(t.payment_terms),'') IS NULL OR nullif(btrim(t.policy_version),'') IS NULL THEN
      RAISE EXCEPTION 'Quote terms are incomplete; Mercurius must send a new revision' USING ERRCODE='22023';
    END IF;
    IF NOT private.quote_provider_eligible(r.contractor_id) THEN
      RAISE EXCEPTION 'The provider can''t take this job right now, so the quote can''t be approved. Mercurius will follow up; you can still decline.' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.request_quotes SET status=CASE WHEN _approve THEN 'accepted' ELSE 'declined' END,
    decision_actor=auth.uid(),decided_at=now() WHERE id=q.id;
  UPDATE public.service_requests SET quote_status=CASE WHEN _approve THEN 'accepted' ELSE 'declined' END,
    quote_approved_at=CASE WHEN _approve THEN now() ELSE NULL END,
    quote_declined_at=CASE WHEN NOT _approve THEN now() ELSE NULL END,
    needs_admin_review=needs_admin_review OR NOT _approve WHERE id=r.id;
  -- Approval/decline never fabricates or reverses vendor acceptance.
  IF NOT _approve THEN
    UPDATE public.job_match_attempts SET outcome='withdrawn',withdrawn_at=now(),responded_at=now(),reason='Homeowner declined quote'
      WHERE service_request_id=r.id AND outcome='pending';
    UPDATE public.service_requests SET matching_status='quote_pending' WHERE id=r.id AND matching_status<>'matched';
    FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role='admin' LOOP
      PERFORM public.notify_user(admin_id,'job_status','warning','Quote declined','Review the declined quote and contact the parties. The request has not been cancelled.','/admin/requests',r.id,r.contractor_id);
    END LOOP;
  END IF;
  PERFORM public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object('action',CASE WHEN _approve THEN 'quote_approved' ELSE 'quote_declined' END,
    'quote_id',q.id,'revision',q.revision,'amount',q.amount,'from',r.status,'to',r.status));
END;
$$;

-- G3: a needed material change after acceptance is an operator exception, never new terms.
create function public.admin_open_quote_exception(_job_id uuid, _reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; v_reason text; v_id uuid;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can open quote exceptions' using errcode = '42501';
  end if;
  v_reason := nullif(btrim(coalesce(_reason, '')), '');
  if v_reason is null or length(v_reason) > 2000 then raise exception 'Describe the change that is needed' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null or r.quote_status is distinct from 'accepted' then
    raise exception 'Only an accepted quote needs a change exception; otherwise send a new revision' using errcode = '22023';
  end if;
  select id into v_id from public.request_quote_exceptions
    where request_id = r.id and kind = 'accepted_change' and subject = r.current_quote_id::text and closed_at is null;
  if v_id is not null then return v_id; end if;
  insert into public.request_quote_exceptions(request_id, kind, subject, opened_by, reason)
    values (r.id, 'accepted_change', r.current_quote_id::text, auth.uid(), v_reason) returning id into v_id;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_exception_opened',
    'exception_id', v_id, 'quote_id', r.current_quote_id, 'reason', v_reason));
  return v_id;
end $$;
revoke all on function public.admin_open_quote_exception(uuid, text) from public, anon;
grant execute on function public.admin_open_quote_exception(uuid, text) to authenticated;

create function public.admin_close_quote_exception(_exception_id uuid, _resolution text)
returns void language plpgsql security definer set search_path = '' as $$
declare x public.request_quote_exceptions; v_resolution text;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can close quote exceptions' using errcode = '42501';
  end if;
  v_resolution := nullif(btrim(coalesce(_resolution, '')), '');
  if v_resolution is null or length(v_resolution) > 2000 then raise exception 'Record how it was resolved' using errcode = '22023'; end if;
  select * into x from public.request_quote_exceptions where id = _exception_id for update;
  if x.id is null then raise exception 'Quote exception not found' using errcode = '22023'; end if;
  if x.closed_at is not null then
    if x.resolution = v_resolution and x.closed_by = auth.uid() then return; end if;
    raise exception 'This exception is already closed' using errcode = '22023';
  end if;
  update public.request_quote_exceptions set closed_by = auth.uid(), closed_at = now(), resolution = v_resolution where id = x.id;
  perform public.log_job_event(x.request_id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_exception_closed',
    'exception_id', x.id, 'kind', x.kind, 'resolution', v_resolution));
end $$;
revoke all on function public.admin_close_quote_exception(uuid, text) from public, anon;
grant execute on function public.admin_close_quote_exception(uuid, text) to authenticated;

-- G2 deposit review and G5 provider review: a recorded operator review, opened and closed at once.
create function public.admin_record_quote_review(_job_id uuid, _kind text, _note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; v_note text; v_subject text; v_id uuid;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can record quote reviews' using errcode = '42501';
  end if;
  v_note := nullif(btrim(coalesce(_note, '')), '');
  if v_note is null or length(v_note) > 2000 then raise exception 'Record what was reviewed' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null then raise exception 'Request not found' using errcode = '22023'; end if;
  if _kind = 'deposit_review' then
    if not private.quote_deposit_required(r) then raise exception 'This job does not ask for a deposit' using errcode = '22023'; end if;
    v_subject := 'deposit';
  elsif _kind = 'provider_review' then
    if r.contractor_id is null or private.quote_provider_eligible(r.contractor_id) then
      raise exception 'The assigned provider is eligible; nothing to review' using errcode = '22023';
    end if;
    v_subject := r.contractor_id::text;
  else
    raise exception 'Unknown review' using errcode = '22023';
  end if;
  select id into v_id from public.request_quote_exceptions
    where request_id = r.id and kind = _kind and subject = v_subject and opened_by = auth.uid() and reason = v_note and closed_at is not null;
  if v_id is not null then return v_id; end if; -- Lost-response retry.
  insert into public.request_quote_exceptions(request_id, kind, subject, opened_by, reason, closed_by, closed_at, resolution)
    values (r.id, _kind, v_subject, auth.uid(), v_note, auth.uid(), now(), v_note) returning id into v_id;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'quote_review_recorded',
    'exception_id', v_id, 'kind', _kind, 'note', v_note));
  return v_id;
end $$;
revoke all on function public.admin_record_quote_review(uuid, text, text) from public, anon;
grant execute on function public.admin_record_quote_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------- G4–G6 queue

-- Thresholds (DEC-2026-045 G4/G6): proposal missing 24 h after a quote became required from
-- the assigned provider; proposal awaiting send 4 h; sent quote awaiting decision 12 h (the
-- 24-hour expiry is separate); confirmed payment failure aged after 24 h. Deposit, provider,
-- change and unresolved-payment items appear immediately. Every clock is a recorded event
-- time, never updated_at.
create function public.admin_quote_queue() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read the quote queue' using errcode = '42501';
  end if;
  with open_quote_work as (
    select r.* from public.service_requests r
    where r.contractor_id is not null and r.matching_status = 'matched' and r.status in ('matched', 'quoted', 'scheduled')
      and (coalesce(r.quote_only, false) or r.pricing_mode is distinct from 'fixed')
  ), missing as (
    select r.id, r.service_type, greatest(
        (select max(coalesce(a.accepted_at, a.responded_at)) from public.job_match_attempts a
          where a.service_request_id = r.id and a.contractor_id = r.contractor_id and a.outcome = 'accepted'),
        case when not exists (select 1 from public.job_match_attempts a where a.service_request_id = r.id
          and a.contractor_id = r.contractor_id and a.outcome = 'accepted') then r.assigned_at end,
        (select max(q.decided_at) from public.request_quotes q where q.request_id = r.id and q.status = 'declined'),
        (select max(q.expires_at) from public.request_quotes q where q.request_id = r.id and q.status = 'expired'),
        (select max(p.decided_at) from public.request_quote_proposals p where p.request_id = r.id and p.status = 'returned')) as since
    from open_quote_work r
    where r.quote_status is distinct from 'submitted' and r.quote_status is distinct from 'accepted'
      and not exists (select 1 from public.request_quote_proposals p where p.request_id = r.id and p.status = 'pending')
  ), items as (
    select 'proposal_missing' as kind, m.id as request_id, m.service_type, m.since, m.since + interval '24 hours' as due_at,
      null::uuid as exception_id, '{}'::jsonb as detail
    from missing m where m.since is not null and now() >= m.since + interval '24 hours'
    union all
    select 'proposal_review', p.request_id, r.service_type, p.created_at, p.created_at + interval '4 hours', null,
      jsonb_build_object('proposal_id', p.id, 'subtotal_cents', p.subtotal_cents)
    from public.request_quote_proposals p join public.service_requests r on r.id = p.request_id
    where p.status = 'pending' and now() >= p.created_at + interval '4 hours'
    union all
    select 'quote_decision', q.request_id, r.service_type, q.sent_at, q.sent_at + interval '12 hours', null,
      jsonb_build_object('quote_id', q.id, 'revision', q.revision, 'expires_at', q.expires_at, 'deadline_passed', now() >= q.expires_at)
    from public.request_quotes q join public.service_requests r on r.current_quote_id = q.id
    where q.status = 'submitted' and now() >= q.sent_at + interval '12 hours'
    union all
    select 'deposit_review', r.id, r.service_type, r.created_at, null, null, '{}'::jsonb
    from public.service_requests r
    where r.status in ('pending', 'matched', 'quoted', 'scheduled') and r.quote_status is distinct from 'accepted'
      and (coalesce(r.quote_only, false) or r.pricing_mode is distinct from 'fixed')
      and private.quote_deposit_required(r)
      and not exists (select 1 from public.request_quote_exceptions x where x.request_id = r.id and x.kind = 'deposit_review'
        and x.closed_at is not null)
    union all
    select 'provider_review', r.id, r.service_type, null, null, null, jsonb_build_object('contractor_id', r.contractor_id)
    from public.service_requests r
    where r.contractor_id is not null
      and (r.status in ('scheduled', 'in_progress', 'pending_review', 'vendor_completed', 'disputed')
        or (r.status in ('matched', 'quoted') and r.matching_status = 'matched'))
      and not private.quote_provider_eligible(r.contractor_id)
      and not exists (select 1 from public.request_quote_exceptions x where x.request_id = r.id and x.kind = 'provider_review'
        and x.subject = r.contractor_id::text and x.closed_at is not null)
    union all
    select 'accepted_change', x.request_id, r.service_type, x.opened_at, null, x.id, jsonb_build_object('reason', x.reason, 'quote_id', x.subject)
    from public.request_quote_exceptions x join public.service_requests r on r.id = x.request_id
    where x.kind = 'accepted_change' and x.closed_at is null
    union all
    select case when a.status = 'expired' then 'payment_failed' else 'payment_unresolved' end, o.service_request_id, r.service_type,
      case when a.status = 'expired' then coalesce((select min(e.received_at) from public.money_webhook_events e
          where e.event_type = 'checkout_expired' and e.payload ->> 'attempt_id' = a.id::text), a.expires_at)
        else least(a.expires_at, a.created_at) end,
      case when a.status = 'expired' then coalesce((select min(e.received_at) from public.money_webhook_events e
          where e.event_type = 'checkout_expired' and e.payload ->> 'attempt_id' = a.id::text), a.expires_at) + interval '24 hours' end,
      null,
      jsonb_build_object('attempt_id', a.id, 'attempt_status', a.status, 'failure_code', a.failure_code, 'amount_cents', a.amount,
        'reconciliation_open', o.reconciliation_open)
    from public.money_obligations o
    join public.service_requests r on r.id = o.service_request_id
    join lateral (select * from public.money_checkout_attempts x where x.obligation_id = o.id order by x.created_at desc, x.id desc limit 1) a on true
    left join public.money_snapshots s on s.id = o.current_snapshot_id
    where (a.status = 'expired' and o.captured < coalesce(s.total, a.amount + o.captured))
      or a.status = 'reconcile' or o.reconciliation_open
      or (a.status in ('prepared', 'session_created') and a.expires_at <= now())
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'request_id', i.request_id, 'service_type', i.service_type,
      'since', i.since, 'due_at', i.due_at, 'aged', i.due_at is not null and now() >= i.due_at,
      'exception_id', i.exception_id, 'detail', i.detail)
    order by (i.due_at is not null and now() >= i.due_at) desc, coalesce(i.due_at, i.since) nulls last, i.request_id), '[]'::jsonb)
    into result from items i;
  return jsonb_build_object('checked_at', now(), 'items', result);
end $$;
revoke all on function public.admin_quote_queue() from public, anon;
grant execute on function public.admin_quote_queue() to authenticated;
