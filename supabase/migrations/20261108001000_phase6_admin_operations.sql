-- Phase 6.13 / TRACE-136, DEC-2026-057 (approved as amended 2026-11-02).
-- Admin operations: closes direct client writes that bypass reviewed commands, closes every
-- participant read of operator notes, and adds keyed, version-bound operator commands with
-- history. Additive: no table or column is dropped and no stored value is rewritten.
-- No money function is changed (fingerprint 45 | 34c51131… before and after).
-- This is the expand step of an expand/contract release (brief §12.5): it is safe under the
-- client deployed before it and under the client merged with it. The participant read of the
-- legacy service_requests.notes column is narrowed by the later contract migration, once no
-- deployed or rollback client selects that column; until then the column is frozen (below).

-- ---------------------------------------------------------------------------------------------
-- A1 / Q7. Legacy invoices: no client writes. sync_invoice_on_request_change (SECURITY DEFINER,
-- owner postgres) keeps writing; SELECT policies are unchanged.
drop policy if exists "Admins can insert invoices" on public.invoices;
drop policy if exists "Admins can update invoices" on public.invoices;
revoke insert, update, delete on public.invoices from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Q1. The coverage allowlist changes only by reviewed migration (CFG-001). Reads are unchanged.
drop policy if exists "Admins can insert coverage areas" on public.coverage_areas;
drop policy if exists "Admins can update coverage areas" on public.coverage_areas;
drop policy if exists "Admins can delete coverage areas" on public.coverage_areas;
revoke insert, update, delete on public.coverage_areas from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- A7. Smart Picks are deferred (MPS §3): no client reads or writes. Table and rows are kept.
drop policy if exists "Admins can insert smart picks" on public.smart_picks;
drop policy if exists "Admins can update smart picks" on public.smart_picks;
drop policy if exists "Admins can delete smart picks" on public.smart_picks;
revoke all on public.smart_picks from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- A5. One dispute-decision path: the keyed, stale-guarded admin_decide_dispute (6.10). It calls
-- admin_resolve_dispute as its owner, so revoking client EXECUTE leaves it working.
revoke execute on function public.admin_resolve_dispute(uuid, public.dispute_status, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- A4 / correction 1. Operator notes are operator-only.
-- service_requests.notes was readable by the homeowner and the assigned provider through the
-- table-wide SELECT grant, and written by the admin "Internal Notes" save. From this step no client
-- writes notes, address, ZIP or description (Q5), so nothing new can enter the shared column;
-- operator notes are written only to the private, append-only table below. The column's SELECT
-- grant is narrowed by the contract migration, after the client that stops selecting it is live
-- (the previous admin requests page selects it, and must keep loading until then). Historical
-- values stay in the column, unchanged, and are read back to operators only, labelled as the
-- legacy shared field (not copied anywhere).
revoke update on public.service_requests from authenticated, anon;
-- The only columns a homeowner could still change directly while pending (no client uses them).
grant update (preferred_date, preferred_time) on public.service_requests to authenticated;

create table private.request_operator_notes (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.service_requests(id) on delete restrict,
  request_key uuid not null unique,
  author uuid not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index request_operator_notes_request on private.request_operator_notes(request_id, created_at);
revoke all on private.request_operator_notes from public, anon, authenticated;

-- Every operator history record in this migration is append-only, for every role including the
-- owner (a trigger, not only a missing grant): no UPDATE, DELETE or TRUNCATE.
create function private.refuse_history_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger request_operator_notes_append_only before update or delete on private.request_operator_notes
  for each row execute function private.refuse_history_change();
create trigger request_operator_notes_no_truncate before truncate on private.request_operator_notes
  for each statement execute function private.refuse_history_change();

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.has_role(actor, 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return actor;
end $$;
revoke all on function private.require_admin() from public, anon, authenticated;

create function public.admin_add_request_note(p_request uuid, p_key uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_admin(); body text := btrim(coalesce(p_body, '')); n private.request_operator_notes;
begin
  if p_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  if length(body) = 0 then raise exception 'Enter the note' using errcode = '22023'; end if;
  if length(body) > 4000 then raise exception 'Note too long (4,000 characters at most)' using errcode = '22023'; end if;
  select * into n from private.request_operator_notes where request_key = p_key;
  if found then
    if n.request_id <> p_request or n.body <> body or n.author <> actor then
      raise exception 'This request key was already used for a different note' using errcode = '22023';
    end if;
    return jsonb_build_object('id', n.id, 'created_at', n.created_at, 'replayed', true);
  end if;
  perform 1 from public.service_requests where id = p_request;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  insert into private.request_operator_notes(request_id, request_key, author, body)
    values (p_request, p_key, actor, body)
    on conflict (request_key) do nothing returning * into n;
  if n.id is null then
    -- A concurrent call with the same key committed first.
    select * into n from private.request_operator_notes where request_key = p_key;
    if n.request_id <> p_request or n.body <> body or n.author <> actor then
      raise exception 'This request key was already used for a different note' using errcode = '22023';
    end if;
    return jsonb_build_object('id', n.id, 'created_at', n.created_at, 'replayed', true);
  end if;
  return jsonb_build_object('id', n.id, 'created_at', n.created_at, 'replayed', false);
end $$;

create function public.admin_request_notes(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare legacy text;
begin
  perform private.require_admin();
  select nullif(btrim(notes), '') into legacy from public.service_requests where id = p_request;
  return jsonb_build_object(
    'legacy_note', legacy,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at,
        'author_name', coalesce(nullif(btrim(p.full_name), ''), 'Mercurius operator')) order by n.created_at, n.id)
      from private.request_operator_notes n left join public.profiles p on p.user_id = n.author
      where n.request_id = p_request), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- A3. A message is sent as its signed-in author, under a role the author holds on that thread.
-- SECURITY INVOKER: current_user is the statement's role, so a definer command (owner) passes.
create function private.guard_message_sender() returns trigger
language plpgsql set search_path = '' as $$
declare actor uuid := auth.uid(); ok boolean;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if actor is null or new.sender_id is distinct from actor then
    raise exception 'Messages are sent as the signed-in account' using errcode = '42501';
  end if;
  ok := case new.sender_role
    when 'homeowner' then exists (select 1 from public.service_requests r where r.id = new.service_request_id and r.customer_id = actor)
    when 'vendor' then exists (select 1 from public.service_requests r join public.contractors c on c.id = r.contractor_id
      where r.id = new.service_request_id and c.user_id = actor)
    when 'admin' then public.has_role(actor, 'admin')
    else false end;
  if not ok then
    raise exception 'You cannot send messages as % on this request', coalesce(new.sender_role, 'that role') using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_message_sender before insert or update of sender_id, sender_role on public.messages
  for each row execute function private.guard_message_sender();

-- ---------------------------------------------------------------------------------------------
-- A2 / Q3 / Q4. Provider records: ownership, payout flags, statistics, badges and activation
-- change only through reviewed commands. Definer commands run as their owner and are not affected.
-- Q3 (correction 3, conservative): no client switch activates or suspends any provider, onboarded
-- or legacy. Onboarded providers use vendor_decide_onboarding. A legacy provider (no onboarding
-- record) has no reviewed suspension command; the recorded, reasoned stop is the public-listing
-- exclusion (r0_set_public_listing_exclusion), which also removes matching eligibility, and
-- activation goes through the reviewed onboarding starts (r0_start_existing_provider_review,
-- r0_start_legacy_provider_review). No new activation mechanism is added. Stored values are kept.
-- SECURITY INVOKER: current_user is the statement's role, so a definer command (owner) passes.
create function private.guard_contractor_operator_writes() returns trigger
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
create trigger guard_contractor_operator_writes before insert or update on public.contractors
  for each row execute function private.guard_contractor_operator_writes();

create table private.provider_badge_events (
  id bigint generated always as identity primary key,
  contractor_id uuid not null references public.contractors(id) on delete restrict,
  request_key uuid not null unique,
  actor uuid not null,
  before_badges text[] not null,
  after_badges text[] not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);
revoke all on private.provider_badge_events from public, anon, authenticated;
create trigger provider_badge_events_append_only before update or delete on private.provider_badge_events
  for each row execute function private.refuse_history_change();
create trigger provider_badge_events_no_truncate before truncate on private.provider_badge_events
  for each statement execute function private.refuse_history_change();

create function private.sorted_badges(p text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct b order by b), '{}'::text[]) from unnest(coalesce(p, '{}'::text[])) b
$$;

-- DEC-2026-047: badges are operator-managed. The list matches the admin editor.
create function public.admin_set_provider_badges(p_contractor uuid, p_expected_badges text[], p_badges text[], p_reason text, p_key uuid)
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

create function public.admin_provider_badge_history(p_contractor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('before', to_jsonb(e.before_badges), 'after', to_jsonb(e.after_badges),
      'reason', e.reason, 'created_at', e.created_at,
      'actor_name', coalesce(nullif(btrim(p.full_name), ''), 'Mercurius operator')) order by e.created_at desc, e.id desc)
    from private.provider_badge_events e left join public.profiles p on p.user_id = e.actor
    where e.contractor_id = p_contractor), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Q2 (amended 2026-11-02). CFG-002 keeps every catalog service visible. Hiding or restoring a
-- service, or removing it, is an owner-approved, reviewed change (migration); no operator control
-- or command does it, and a free-text approval note is not authorization. Direct client changes to
-- is_active and client deletes are refused; a new service is added shown. "Popular" and the
-- add/edit form are unchanged.
drop policy if exists "Admins can delete services" on public.services_catalog;
revoke delete on public.services_catalog from anon, authenticated;

-- SECURITY INVOKER: current_user is the statement's role, so a reviewed migration (owner) passes.
create function private.guard_catalog_visibility() returns trigger
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
create trigger guard_catalog_visibility before insert or update on public.services_catalog
  for each row execute function private.guard_catalog_visibility();

-- ---------------------------------------------------------------------------------------------
-- A6 / correction 2 and Q5. Version-bound, keyed operator actions on a request. The row version
-- is updated_at (bumped by every write to the row), so any intervening change refuses the action.
-- The key is checked after the row lock, so a concurrent retry replays instead of failing. A key
-- binds the actor, the request, the action and its complete intent, including the version read:
-- a retry of the same intent returns the original result; any other use of the key is refused.
create table private.admin_request_actions (
  request_key uuid primary key,
  request_id uuid not null references public.service_requests(id) on delete restrict,
  actor uuid not null,
  action text not null check (action in ('status_change', 'detail_correction')),
  payload jsonb not null,
  result jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index admin_request_actions_request on private.admin_request_actions(request_id, created_at);
revoke all on private.admin_request_actions from public, anon, authenticated;
create trigger admin_request_actions_append_only before update or delete on private.admin_request_actions
  for each row execute function private.refuse_history_change();
create trigger admin_request_actions_no_truncate before truncate on private.admin_request_actions
  for each statement execute function private.refuse_history_change();

-- The record version as stable text, so a key binds the version the operator read regardless of
-- the session time zone.
create function private.version_text(p timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
revoke all on function private.version_text(timestamptz) from public, anon, authenticated;

create function private.admin_request_action_replay(p_key uuid, p_request uuid, p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a private.admin_request_actions;
begin
  select * into a from private.admin_request_actions where request_key = p_key;
  if not found then return null; end if;
  if a.request_id <> p_request or a.actor <> p_actor or a.action <> p_action or a.payload <> p_payload then
    raise exception 'This request key was already used for a different action' using errcode = '22023';
  end if;
  return a.result || jsonb_build_object('replayed', true);
end $$;
revoke all on function private.admin_request_action_replay(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

create function public.admin_transition_job_status_expected(p_job uuid, p_expected_updated_at timestamptz, p_key uuid,
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

-- Q5 / correction 5. Corrections before any offer, quote or commercial binding only.
create function public.admin_correct_request_details(p_request uuid, p_expected_updated_at timestamptz, p_key uuid,
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

create function public.admin_request_action_history(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'result', a.result - 'replayed',
      'created_at', a.created_at, 'actor_name', coalesce(nullif(btrim(p.full_name), ''), 'Mercurius operator')) order by a.created_at desc)
    from private.admin_request_actions a left join public.profiles p on p.user_id = a.actor
    where a.request_id = p_request), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Q6 / correction 6. Clearing a Package Review takes a reason, keeps the updated_at stale check
-- and the approval guardrails (now server-side), and is recorded in the vendor-visible history.
-- It is keyed like the other commands: a key binds the actor, the package, the version read and
-- the reason; a retry returns the original result. Pausing uses the reviewed admin_suspend_package.
-- Direct admin writes to the flags are refused.
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

-- SECURITY INVOKER: current_user is the statement's role, so a definer command (owner) passes.
create function private.guard_package_review_flags() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and public.has_role(auth.uid(), 'admin')
     and (new.needs_review is distinct from old.needs_review or new.is_active is distinct from old.is_active) then
    raise exception 'Clear or pause a Package Review through its command (reason required)' using errcode = '42501';
  end if;
  return new;
end $$;
-- Named to run after enforce_custom_package_price_review_flag recomputes the flag for vendors.
create trigger zz_guard_package_review_flags before update on public.vendor_packages
  for each row execute function private.guard_package_review_flags();

-- ---------------------------------------------------------------------------------------------
-- A8. Operations summary: the same queue functions the queue pages call, in one transaction.
-- No threshold, SLA or action of its own. Finance counts only for finance-authority holders;
-- others see "restricted". A queue that fails to read shows "error", never a zero.
create function public.admin_operations_summary() returns jsonb
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

-- ---------------------------------------------------------------------------------------------
revoke all on function public.admin_add_request_note(uuid, uuid, text) from public, anon;
revoke all on function public.admin_request_notes(uuid) from public, anon;
revoke all on function public.admin_set_provider_badges(uuid, text[], text[], text, uuid) from public, anon;
revoke all on function public.admin_provider_badge_history(uuid) from public, anon;
revoke all on function public.admin_transition_job_status_expected(uuid, timestamptz, uuid, public.request_status, text) from public, anon;
revoke all on function public.admin_correct_request_details(uuid, timestamptz, uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_request_action_history(uuid) from public, anon;
revoke all on function public.admin_clear_package_review(uuid, timestamptz, text, uuid) from public, anon;
revoke all on function public.admin_operations_summary() from public, anon;
revoke all on function private.guard_message_sender() from public, anon, authenticated;
revoke all on function private.guard_contractor_operator_writes() from public, anon, authenticated;
revoke all on function private.guard_catalog_visibility() from public, anon, authenticated;
revoke all on function private.guard_package_review_flags() from public, anon, authenticated;
revoke all on function private.sorted_badges(text[]) from public, anon, authenticated;
revoke all on function private.refuse_history_change() from public, anon, authenticated;
grant execute on function public.admin_add_request_note(uuid, uuid, text) to authenticated;
grant execute on function public.admin_request_notes(uuid) to authenticated;
grant execute on function public.admin_set_provider_badges(uuid, text[], text[], text, uuid) to authenticated;
grant execute on function public.admin_provider_badge_history(uuid) to authenticated;
grant execute on function public.admin_transition_job_status_expected(uuid, timestamptz, uuid, public.request_status, text) to authenticated;
grant execute on function public.admin_correct_request_details(uuid, timestamptz, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_request_action_history(uuid) to authenticated;
grant execute on function public.admin_clear_package_review(uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.admin_operations_summary() to authenticated;
