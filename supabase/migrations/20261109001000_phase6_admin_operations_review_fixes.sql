-- Phase 6.13 / TRACE-136, DEC-2026-057 (reconciled 2026-11-02): forward fix for the Codex review
-- of PR #132, which merged 20261108001000 as originally written (applied on hosted; read back
-- 2026-11-03). That migration is not edited; this one corrects it. Additive: no table or column is
-- dropped and no stored value is rewritten. Removed are only a command and an unkeyed command
-- variant that the review rejected (functions, no data). Hosted readback before this migration:
-- 0 catalog visibility events, 0 hidden services, 0 badge events, 0 request actions, 0 operator
-- notes. No money function is changed (fingerprint 45 | 34c51131… before and after).

-- Every operator history record of 6.13 is append-only, for every role including the owner.
create function private.refuse_history_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
revoke all on function private.refuse_history_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Finding 1 / Q2 (amended). CFG-002 keeps every catalog service visible. Hiding, restoring or
-- removing a service is an owner-approved, reviewed change (migration). The operator command that
-- accepted a free-text approval note is removed; its (empty) history table is kept, read-only.
drop function public.admin_set_catalog_service_visibility(text, boolean, boolean, text, text, uuid);
drop policy if exists "Admins can delete services" on public.services_catalog;
revoke delete on public.services_catalog from anon, authenticated;
create or replace function private.guard_catalog_visibility() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' and new.is_active is distinct from true then
    raise exception 'A new service is added shown (CFG-002); hiding one is an owner-approved, reviewed change' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then
    raise exception 'Hiding or restoring a service is an owner-approved, reviewed change (CFG-002)' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger guard_catalog_visibility on public.services_catalog;
create trigger guard_catalog_visibility before insert or update on public.services_catalog
  for each row execute function private.guard_catalog_visibility();
create trigger catalog_visibility_events_append_only before update or delete on private.catalog_visibility_events
  for each row execute function private.refuse_history_change();
create trigger catalog_visibility_events_no_truncate before truncate on private.catalog_visibility_events
  for each statement execute function private.refuse_history_change();

-- ---------------------------------------------------------------------------------------------
-- Finding 2 / Q3 (conservative). No client switch activates or suspends any provider, onboarded or
-- legacy, and a client-created record starts inactive. Onboarded providers use
-- vendor_decide_onboarding. A legacy provider's recorded stop is the public-listing exclusion
-- (r0_set_public_listing_exclusion, which also removes matching eligibility); activation goes
-- through the reviewed onboarding starts. No new activation mechanism; stored values are kept.
-- admin_provider_is_onboarded is no longer used by the guard; it stays for the previous client.
create or replace function private.guard_contractor_operator_writes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.user_id is not null then
      raise exception 'Link a login account through account linking' using errcode = '42501';
    end if;
    if new.is_active is distinct from false then
      raise exception 'New providers start inactive; activation goes through onboarding review' using errcode = '42501';
    end if;
    if new.payouts_paused or new.payouts_paused_reason is not null or new.payouts_paused_at is not null then
      raise exception 'Payout holds are placed in Finance' using errcode = '42501';
    end if;
    if new.rating is distinct from 5.0 or new.jobs_completed is distinct from 0 or new.badges is distinct from '{}'::text[] then
      raise exception 'Ratings and job counts come from verified records; badges are set through the badge command' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Link or release a login account through account linking' using errcode = '42501';
  end if;
  if (new.payouts_paused, new.payouts_paused_reason, new.payouts_paused_at)
     is distinct from (old.payouts_paused, old.payouts_paused_reason, old.payouts_paused_at) then
    raise exception 'Payout holds are placed in Finance (finance authority required)' using errcode = '42501';
  end if;
  if new.rating is distinct from old.rating or new.jobs_completed is distinct from old.jobs_completed then
    raise exception 'Ratings and job counts come from verified reviews and completed jobs' using errcode = '42501';
  end if;
  if new.badges is distinct from old.badges then
    raise exception 'Change badges through the badge command (reason required)' using errcode = '42501';
  end if;
  -- Vendors are already refused by the vendor profile guard (its wording is kept); this closes the
  -- admin path, which had no guard for legacy providers.
  if new.is_active is distinct from old.is_active and public.has_role(auth.uid(), 'admin') then
    raise exception 'Activate or suspend a provider through onboarding review; to stop work for a legacy provider, hide it from listing and matching' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Finding 5. A key binds the actor, the target and the complete intent, including the version
-- read; a retry of the same intent returns the original result, anything else is refused.
create function private.version_text(p timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
revoke all on function private.version_text(timestamptz) from public, anon, authenticated;

create or replace function public.admin_set_provider_badges(p_contractor uuid, p_expected_badges text[], p_badges text[], p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_admin();
  reason text := btrim(coalesce(p_reason, ''));
  wanted text[] := private.sorted_badges(p_badges);
  current_badges text[];
  e private.provider_badge_events;
  allowed constant text[] := array['Licensed', 'Insured', 'Background Checked', '24/7 Available', 'Emergency Services',
    'Eco-Friendly', 'Satisfaction Guaranteed', 'Top Rated'];
begin
  if p_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  if length(reason) = 0 then raise exception 'Enter the reason for the badge change' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  if exists (select 1 from unnest(wanted) b where not (b = any (allowed))) then
    raise exception 'Unknown badge' using errcode = '22023';
  end if;
  select private.sorted_badges(badges) into current_badges from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  -- A key binds the actor, the provider and the whole intent (badges read, badges wanted, reason).
  select * into e from private.provider_badge_events where request_key = p_key;
  if found then
    if e.actor <> actor or e.contractor_id <> p_contractor or e.before_badges <> private.sorted_badges(p_expected_badges)
       or e.after_badges <> wanted or e.reason <> reason then
      raise exception 'This request key was already used for a different change' using errcode = '22023';
    end if;
    return jsonb_build_object('badges', to_jsonb(e.after_badges), 'replayed', true);
  end if;
  if current_badges <> private.sorted_badges(p_expected_badges) then
    raise exception 'This provider''s badges changed since you opened them; review the current badges' using errcode = '40001';
  end if;
  if current_badges = wanted then raise exception 'No badge change' using errcode = '22023'; end if;
  update public.contractors set badges = wanted where id = p_contractor;
  insert into private.provider_badge_events(contractor_id, request_key, actor, before_badges, after_badges, reason)
    values (p_contractor, p_key, actor, current_badges, wanted, reason);
  return jsonb_build_object('badges', to_jsonb(wanted), 'replayed', false);
end $$;

create or replace function public.admin_transition_job_status_expected(p_job uuid, p_expected_updated_at timestamptz, p_key uuid,
  p_to_status public.request_status, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_admin();
  reason text := btrim(coalesce(p_reason, ''));
  payload jsonb := jsonb_build_object('to_status', p_to_status, 'reason', reason,
    'expected_updated_at', private.version_text(p_expected_updated_at));
  r public.service_requests;
  prior jsonb;
  outcome public.request_status;
  result jsonb;
begin
  if p_key is null or p_expected_updated_at is null then raise exception 'Request key and version required' using errcode = '22023'; end if;
  if length(reason) = 0 then raise exception 'Enter the reason for the status change' using errcode = '22023'; end if;
  select * into r from public.service_requests where id = p_job for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  prior := private.admin_request_action_replay(p_key, p_job, actor, 'status_change', payload);
  if prior is not null then return prior; end if;
  if r.updated_at <> p_expected_updated_at then
    raise exception 'This request changed since you opened it; review the current state' using errcode = '40001';
  end if;
  outcome := public.transition_job_status(p_job, p_to_status, reason, '{}'::jsonb);
  select jsonb_build_object('request_id', p_job, 'from_status', r.status, 'status', outcome, 'updated_at', s.updated_at, 'replayed', false)
    into result from public.service_requests s where s.id = p_job;
  insert into private.admin_request_actions(request_key, request_id, actor, action, payload, result, reason)
    values (p_key, p_job, actor, 'status_change', payload, result, reason);
  return result;
end $$;

create or replace function public.admin_correct_request_details(p_request uuid, p_expected_updated_at timestamptz, p_key uuid,
  p_address text, p_city text, p_state text, p_zip_code text, p_description text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_admin();
  reason text := btrim(coalesce(p_reason, ''));
  street text := btrim(coalesce(p_address, ''));
  city_name text := btrim(coalesce(p_city, ''));
  state_code text := upper(btrim(coalesce(p_state, '')));
  zip text := btrim(coalesce(p_zip_code, ''));
  scope text := btrim(coalesce(p_description, ''));
  payload jsonb;
  r public.service_requests;
  prior jsonb;
  before_v jsonb;
  after_v jsonb;
  result jsonb;
  bound text;
begin
  if p_key is null or p_expected_updated_at is null then raise exception 'Request key and version required' using errcode = '22023'; end if;
  if length(reason) = 0 then raise exception 'Enter the reason for the correction' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  if street = '' or length(street) > 200 or city_name = '' or length(city_name) > 100 or state_code !~ '^[A-Z]{2}$' then
    raise exception 'Service address required' using errcode = '22023';
  end if;
  if zip !~ '^[0-9]{5}$' then raise exception 'Enter a valid five-digit ZIP code' using errcode = '22023'; end if;
  if length(scope) > 5000 then raise exception 'Description too long' using errcode = '22023'; end if;
  after_v := jsonb_build_object('address', street, 'city', city_name, 'state', state_code, 'zip_code', zip, 'description', nullif(scope, ''));
  payload := after_v || jsonb_build_object('reason', reason, 'expected_updated_at', private.version_text(p_expected_updated_at));

  select * into r from public.service_requests where id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  prior := private.admin_request_action_replay(p_key, p_request, actor, 'detail_correction', payload);
  if prior is not null then return prior; end if;
  if r.updated_at <> p_expected_updated_at then
    raise exception 'This request changed since you opened it; review the current details' using errcode = '40001';
  end if;

  -- Any offer, quote, assignment, payment, promotion or bound price is a commercial binding:
  -- agreed property and scope are not rewritten here (a dedicated change workflow is required).
  bound := case
    when r.status <> 'pending' then 'its status is ' || r.status::text
    when r.contractor_id is not null or r.matching_status in ('offered', 'matched', 'quote_pending') then 'a provider was offered or matched'
    when exists (select 1 from public.job_match_attempts a where a.service_request_id = r.id) then 'a provider was offered'
    when r.current_quote_id is not null or r.quote_status is not null
      or exists (select 1 from public.request_quotes q where q.request_id = r.id)
      or exists (select 1 from public.request_quote_proposals q where q.request_id = r.id) then 'a quote exists'
    when r.payment_status <> 'pending' or exists (select 1 from public.money_obligations o where o.service_request_id = r.id) then 'a payment exists'
    when r.promotion_id is not null
      or exists (select 1 from private.promotion_selections s where s.service_request_id = r.id)
      or exists (select 1 from private.promotion_redemptions s where s.service_request_id = r.id) then 'a promotion is attached'
    when r.package_id is not null or r.package_tier_id is not null or r.resolved_price is not null
      or r.total_amount is not null or r.quote_amount is not null then 'a price is bound'
    else null end;
  if bound is not null then
    raise exception 'This request can''t be corrected here because %; use a change request instead', bound using errcode = '55000';
  end if;

  -- Revalidate coverage and the service under the lock (the same allowlist intake uses).
  if not exists (select 1 from public.coverage_areas c where c.zip_code = zip and c.is_active) then
    raise exception 'ZIP % is outside the service area', zip using errcode = '22023';
  end if;
  if r.service_catalog_id is not null
     and not exists (select 1 from public.services_catalog s where s.id = r.service_catalog_id and s.is_active) then
    raise exception 'This service is not currently offered' using errcode = '22023';
  end if;

  before_v := jsonb_build_object('address', r.address, 'city', r.city, 'state', r.state, 'zip_code', r.zip_code, 'description', r.description);
  if before_v = after_v then raise exception 'No change' using errcode = '22023'; end if;
  update public.service_requests set address = street, city = city_name, state = state_code, zip_code = zip, description = nullif(scope, '')
    where id = p_request;
  select jsonb_build_object('request_id', p_request, 'before', before_v, 'after', after_v, 'updated_at', s.updated_at, 'replayed', false)
    into result from public.service_requests s where s.id = p_request;
  insert into private.admin_request_actions(request_key, request_id, actor, action, payload, result, reason)
    values (p_key, p_request, actor, 'detail_correction', payload, result, reason);
  return result;
end $$;

-- Package Review clearance is keyed; the unkeyed variant is removed.
create table private.package_review_clearances (
  request_key uuid primary key,
  package_id uuid not null references public.vendor_packages(id) on delete restrict,
  actor uuid not null,
  expected_updated_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  result jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on private.package_review_clearances from public, anon, authenticated;
create trigger package_review_clearances_append_only before update or delete on private.package_review_clearances
  for each row execute function private.refuse_history_change();
create trigger package_review_clearances_no_truncate before truncate on private.package_review_clearances
  for each statement execute function private.refuse_history_change();

drop function public.admin_clear_package_review(uuid, timestamptz, text);
create function public.admin_clear_package_review(p_package uuid, p_expected_updated_at timestamptz, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  pkg public.vendor_packages;
  reason text := btrim(coalesce(p_reason, ''));
  prior private.package_review_clearances;
  result jsonb;
begin
  if p_key is null or p_expected_updated_at is null then raise exception 'Request key and version required' using errcode = '22023'; end if;
  if length(reason) = 0 then raise exception 'Enter the reason. The vendor will see it.' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  select * into pkg from public.vendor_packages where id = p_package for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  select * into prior from private.package_review_clearances where request_key = p_key;
  if found then
    if prior.actor <> actor or prior.package_id <> p_package or prior.expected_updated_at <> p_expected_updated_at or prior.reason <> reason then
      raise exception 'This request key was already used for a different action' using errcode = '22023';
    end if;
    return prior.result || jsonb_build_object('replayed', true);
  end if;
  if pkg.updated_at <> p_expected_updated_at then
    raise exception 'Package changed since it was read; reload before approving' using errcode = '40001';
  end if;
  if not pkg.needs_review then raise exception 'This package is not waiting for review' using errcode = '55000'; end if;
  if pkg.pricing_mode = 'fixed' then
    if not exists (select 1 from public.package_tiers t where t.package_id = pkg.id)
       or exists (select 1 from public.package_tiers t where t.package_id = pkg.id and not (coalesce(t.price, 0) > 0)) then
      raise exception 'Every fixed-price tier must contain a positive valid price before the review flag can be cleared' using errcode = '22023';
    end if;
  elsif pkg.pricing_mode = 'deposit_quote' then
    if not (coalesce(pkg.deposit_amount, 0) > 0) then
      raise exception 'A quote + deposit package needs a positive deposit before approval' using errcode = '22023';
    end if;
  elsif pkg.pricing_mode is distinct from 'custom_quote' then
    raise exception 'This package is not currently eligible for approval' using errcode = '22023';
  end if;
  update public.vendor_packages set needs_review = false where id = pkg.id returning * into pkg;
  insert into private.vendor_package_price_corrections(package_id, contractor_id, package_name, changes, reason, actor)
    values (pkg.id, pkg.contractor_id, pkg.name, jsonb_build_array(jsonb_build_object('kind', 'review_cleared')), reason, actor);
  result := jsonb_build_object('package_id', pkg.id, 'updated_at', pkg.updated_at, 'is_active', pkg.is_active);
  insert into private.package_review_clearances(request_key, package_id, actor, expected_updated_at, reason, result)
    values (p_key, pkg.id, actor, p_expected_updated_at, reason, result);
  return result || jsonb_build_object('replayed', false);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Finding 6. Append-only history (operator notes already refused UPDATE/DELETE; now one function
-- and TRUNCATE too).
drop trigger request_operator_notes_append_only on private.request_operator_notes;
create trigger request_operator_notes_append_only before update or delete on private.request_operator_notes
  for each row execute function private.refuse_history_change();
create trigger request_operator_notes_no_truncate before truncate on private.request_operator_notes
  for each statement execute function private.refuse_history_change();
create trigger provider_badge_events_append_only before update or delete on private.provider_badge_events
  for each row execute function private.refuse_history_change();
create trigger provider_badge_events_no_truncate before truncate on private.provider_badge_events
  for each statement execute function private.refuse_history_change();
create trigger admin_request_actions_append_only before update or delete on private.admin_request_actions
  for each row execute function private.refuse_history_change();
create trigger admin_request_actions_no_truncate before truncate on private.admin_request_actions
  for each statement execute function private.refuse_history_change();

-- ---------------------------------------------------------------------------------------------
-- Finding 4. "restricted" only when the finance-authority check denies the caller; a failed read
-- after that check passes is an error.
create or replace function public.admin_operations_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_admin();
  out_items jsonb := '[]'::jsonb;
  q jsonb;
  entry record;
begin
  for entry in select * from (values
    ('quote', 'items', 'aged'), ('recurring_payment', 'items', 'aged'), ('fulfillment', 'items', 'aged'),
    ('cancellation', 'items', null), ('support', 'items', 'overdue'),
    ('compliance_renewal', 'entries', null), ('renewal_documents', 'entries', null)) v(queue, list_key, aged_key)
  loop
    begin
      q := case entry.queue
        when 'quote' then public.admin_quote_queue()
        when 'recurring_payment' then public.admin_recurring_payment_queue()
        when 'fulfillment' then public.admin_fulfillment_queue()
        when 'cancellation' then public.admin_cancellation_queue()
        when 'support' then public.admin_support_queue(false)
        when 'compliance_renewal' then public.vendor_evidence_renewal_queue()
        when 'renewal_documents' then public.vendor_renewal_document_queue() end;
      out_items := out_items || jsonb_build_object('queue', entry.queue, 'state', 'ready',
        'count', jsonb_array_length(coalesce(q -> entry.list_key, '[]'::jsonb)),
        'aged', case when entry.aged_key is null then null else
          (select count(*) from jsonb_array_elements(coalesce(q -> entry.list_key, '[]'::jsonb)) i
            where coalesce((i ->> entry.aged_key)::boolean, false)) end);
    exception when others then
      out_items := out_items || jsonb_build_object('queue', entry.queue, 'state', 'error', 'count', null, 'aged', null);
    end;
  end loop;
  -- Finance: "restricted" only when the finance-authority check denies the caller; a failed read
  -- after that check passes is an error, like any other queue.
  begin
    perform public.money_require_finance(actor);
    begin
      q := public.money_finance_reconciliation();
      out_items := out_items || jsonb_build_object('queue', 'finance_exceptions', 'state', 'ready',
        'count', jsonb_array_length(coalesce(q -> 'exceptions', '[]'::jsonb)), 'aged', null);
    exception when others then
      out_items := out_items || jsonb_build_object('queue', 'finance_exceptions', 'state', 'error', 'count', null, 'aged', null);
    end;
  exception when insufficient_privilege then
    out_items := out_items || jsonb_build_object('queue', 'finance_exceptions', 'state', 'restricted', 'count', null, 'aged', null);
  end;
  return jsonb_build_object('checked_at', now(), 'queues', out_items);
end $$;

-- Request columns: anon writes none (signed-in writes were closed by 20261108001000).
revoke update on public.service_requests from anon;

revoke all on function public.admin_clear_package_review(uuid, timestamptz, text, uuid) from public, anon;
grant execute on function public.admin_clear_package_review(uuid, timestamptz, text, uuid) to authenticated;
