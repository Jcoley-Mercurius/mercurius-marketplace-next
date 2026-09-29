-- TRACE-102 / DEC-2026-022 / CFG-014: R0 homeowner early-access and expansion interest,
-- independent marketing consent, verified-account linkage, update/withdrawal/suppression
-- and list-only retention tied to the recorded R2 broad-booking opening.
--
-- Interest collects only email, a five-digit ZIP, service interests or "still exploring",
-- and an optional first name. No phone, address, photo, payment or SMS field exists.
-- Joining, account creation and marketing opt-in award nothing and grant no admission;
-- trial admission remains the separate TRACE-101 operator command.
--
-- Every table lives in the private schema with no client or service-key table privilege.
-- The public intake route reaches the data only through service-role commands; a signed-in
-- account reaches only its own linked interest through authenticated commands that
-- require a confirmed Auth email; the R0 operator roster (TRACE-101) records the R2 event,
-- holds and retention runs. Nothing here sends email, schedules a job or changes admission.

-- Accept the early-access form in the existing per-email/per-network intake limits.
alter table private.intake_submissions drop constraint intake_submissions_form_check;
alter table private.intake_submissions add constraint intake_submissions_form_check
  check (form in ('contact', 'vendor_application', 'early_access'));
create or replace function public.intake_record_submission(p_form text, p_email_hash text, p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare recent integer;
begin
  if p_form is null or p_form not in ('contact', 'vendor_application', 'early_access') then
    raise exception 'Unknown intake form' using errcode = '22023';
  end if;
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid intake key' using errcode = '22023';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid intake network key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intake:' || p_form || ':' || p_email_hash, 0));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('intake-ip:' || p_form || ':' || p_ip_hash, 0));
  end if;
  delete from private.intake_submissions where created_at < now() - interval '1 day';
  select count(*) into recent from private.intake_submissions
   where form = p_form and email_hash = p_email_hash and created_at >= now() - interval '1 day';
  if recent >= 3 then
    return 'email_limit';
  end if;
  if p_ip_hash is not null then
    select count(*) into recent from private.intake_submissions
     where form = p_form and ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';
    if recent >= 5 then
      return 'ip_limit';
    end if;
  end if;
  insert into private.intake_submissions (form, email_hash, ip_hash)
    values (p_form, p_email_hash, p_ip_hash);
  return 'accepted';
end $$;
revoke all on function public.intake_record_submission(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.intake_record_submission(text, text, text) to service_role;

create table private.r0_interests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('early_access', 'expansion')),
  status text not null default 'active' check (status in ('active', 'withdrawn', 'deidentified')),
  email text check (email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  email_hash text check (email_hash ~ '^[0-9a-f]{64}$'),
  first_name text check (first_name = btrim(first_name) and length(first_name) between 1 and 100),
  zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
  service_ids text[] not null default '{}' check (cardinality(service_ids) <= 30),
  still_exploring boolean not null default false,
  -- Deleting the account removes its linked interest (verified deletion).
  user_id uuid references auth.users(id) on delete cascade,
  hold_reason text check (length(btrim(hold_reason)) between 3 and 500),
  hold_placed_at timestamptz,
  hold_placed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_at timestamptz,
  withdrawn_at timestamptz,
  deidentified_at timestamptz,
  check (still_exploring <> (cardinality(service_ids) > 0)),
  check ((hold_reason is null) = (hold_placed_at is null)),
  check ((status = 'deidentified') = (deidentified_at is not null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (case when status = 'deidentified'
    then email is null and email_hash is null and first_name is null and user_id is null
    else email is not null and email_hash is not null end),
  check ((user_id is null) = (linked_at is null))
);
-- One identity per kind: an email or an account holds at most one live interest of a kind.
create unique index r0_interests_kind_email on private.r0_interests (kind, email_hash)
  where email_hash is not null;
create unique index r0_interests_kind_user on private.r0_interests (kind, user_id)
  where user_id is not null;
create index r0_interests_retention on private.r0_interests (created_at)
  where status <> 'deidentified';

-- Marketing consent is independent of interest and persists only while opted in. An
-- opted-out or suppressed address keeps no plaintext email here.
create table private.r0_marketing_preferences (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  email text check (email = lower(btrim(email))),
  user_id uuid references auth.users(id) on delete set null,
  opted_in boolean not null,
  source text not null check (source in ('early_access_form', 'account', 'unsubscribe_link', 'provider')),
  consented_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((opted_in and email is not null and consented_at is not null and withdrawn_at is null)
    or (not opted_in and email is null and consented_at is null and withdrawn_at is not null))
);
-- 'marketing' stops promotional mail; 'all' also stops early-access mail (bounce, complaint).
create table private.r0_email_suppressions (
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  scope text not null check (scope in ('marketing', 'all')),
  reason text not null check (reason in ('unsubscribe', 'account', 'bounce', 'complaint', 'operator')),
  created_at timestamptz not null default now(),
  primary key (email_hash, scope)
);
-- Email links carry a random token; only its hash is stored. A token names either one
-- interest (manage/withdraw) or one address (marketing unsubscribe).
create table private.r0_link_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('manage', 'unsubscribe')),
  interest_id uuid references private.r0_interests(id) on delete cascade,
  email_hash text check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check ((purpose = 'manage' and interest_id is not null and email_hash is null)
    or (purpose = 'unsubscribe' and interest_id is null and email_hash is not null))
);
create index r0_link_tokens_expiry on private.r0_link_tokens (expires_at);
create index r0_link_tokens_interest on private.r0_link_tokens (interest_id)
  where interest_id is not null;
-- Append-only audit without personal data. It survives de-identification.
create table private.r0_interest_events (
  id bigint generated always as identity primary key,
  interest_id uuid,
  action text not null check (action in ('joined', 'updated', 'linked', 'merged',
    'withdrawn', 'deidentified', 'hold_placed', 'hold_released', 'marketing_opt_in',
    'marketing_opt_out', 'suppressed')),
  actor text not null check (actor in ('public_form', 'manage_link', 'account', 'operator',
    'retention', 'unsubscribe_link', 'provider')),
  actor_id uuid,
  recorded_at timestamptz not null default now()
);
create index r0_interest_events_interest on private.r0_interest_events (interest_id, recorded_at);
-- The actual R2 broad-booking opening. Recorded once by an R0 operator; the list-only
-- retention clock reads only this row, never a calendar assumption.
create table private.r0_release_events (
  event text primary key check (event = 'r2_broad_booking_opened'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 3 and 500)
);
create table private.r0_retention_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  actor text not null check (actor in ('operator', 'service')),
  actor_id uuid,
  r2_opened_at timestamptz,
  retention_due_at timestamptz,
  deidentified integer not null check (deidentified >= 0),
  held integer not null check (held >= 0),
  remaining integer not null check (remaining >= 0)
);
alter table private.r0_interests enable row level security;
alter table private.r0_marketing_preferences enable row level security;
alter table private.r0_email_suppressions enable row level security;
alter table private.r0_link_tokens enable row level security;
alter table private.r0_interest_events enable row level security;
alter table private.r0_release_events enable row level security;
alter table private.r0_retention_runs enable row level security;
revoke all on private.r0_interests, private.r0_marketing_preferences,
  private.r0_email_suppressions, private.r0_link_tokens, private.r0_interest_events,
  private.r0_release_events, private.r0_retention_runs
  from public, anon, authenticated, service_role;

-- Helpers. None is callable by a client or the service key.
create function private.r0_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if length(v_email) not between 3 and 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  return v_email;
end $$;
create function private.r0_hash(p_value text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_value, 'sha256'), 'hex') $$;
create function private.r0_is_operator(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and public.has_role(p_user, 'admin')
    and exists (select 1 from private.r0_trial_operators where user_id = p_user) $$;
-- The signed-in account's confirmed email, or null when it has none.
create function private.r0_account_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select lower(btrim(u.email)) from auth.users u
   where u.id = p_user and u.email_confirmed_at is not null and u.email is not null
     and btrim(u.email) <> '' $$;
-- Validates one interest's content and returns its sorted, distinct services. The raised
-- message 'r0_boundary' means the ZIP does not match the kind (Lee ZIP for early access,
-- other ZIP for expansion); callers turn it into an honest boundary outcome.
create function private.r0_interest_shape(
  p_kind text, p_zip text, p_service_ids text[], p_still_exploring boolean, p_first_name text
) returns text[] language plpgsql stable security definer set search_path = '' as $$
declare services text[];
begin
  if p_kind is null or p_kind not in ('early_access', 'expansion') then
    raise exception 'Choose early access or expansion interest.' using errcode = '22023';
  end if;
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'Enter a five-digit ZIP code.' using errcode = '22023';
  end if;
  if (p_kind = 'early_access') <> exists (select 1 from private.r0_lee_zips where zip_code = p_zip) then
    raise exception 'r0_boundary' using errcode = '22023';
  end if;
  if p_first_name is not null and length(btrim(p_first_name)) > 100 then
    raise exception 'First name is too long.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct s order by s), '{}') into services
    from unnest(coalesce(p_service_ids, '{}')) s;
  if p_still_exploring is null or p_still_exploring = (cardinality(services) > 0)
    or cardinality(services) > 30 then
    raise exception 'Choose services of interest or still exploring.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(services) s
      where not exists (select 1 from public.services_catalog c where c.id = s and c.is_active)) then
    raise exception 'Choose services from the current catalog.' using errcode = '22023';
  end if;
  return services;
end $$;
create function private.r0_log(p_interest uuid, p_action text, p_actor text, p_actor_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into private.r0_interest_events (interest_id, action, actor, actor_id)
  values (p_interest, p_action, p_actor, p_actor_id) $$;
-- Removes identity from one interest unless a hold applies. Returns true when removed.
create function private.r0_deidentify(p_interest uuid, p_actor text, p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare row private.r0_interests;
begin
  select * into row from private.r0_interests where id = p_interest for update;
  if not found or row.status = 'deidentified' or row.hold_reason is not null then
    return false;
  end if;
  delete from private.r0_link_tokens where interest_id = p_interest;
  update private.r0_interests
     set status = 'deidentified', email = null, email_hash = null, first_name = null,
         user_id = null, linked_at = null, withdrawn_at = null,
         deidentified_at = now(), updated_at = now()
   where id = p_interest;
  perform private.r0_log(p_interest, 'deidentified', p_actor, p_actor_id);
  return true;
end $$;
-- Verified withdrawal: de-identify now, or keep the withdrawn record under a hold.
create function private.r0_withdraw(p_interest uuid, p_actor text, p_actor_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare row private.r0_interests;
begin
  select * into row from private.r0_interests where id = p_interest for update;
  if not found or row.status = 'deidentified' then return 'withdrawn'; end if;
  if row.status = 'active' then
    update private.r0_interests set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
     where id = p_interest;
    perform private.r0_log(p_interest, 'withdrawn', p_actor, p_actor_id);
  end if;
  if private.r0_deidentify(p_interest, p_actor, p_actor_id) then return 'withdrawn'; end if;
  return 'withdrawn_held';
end $$;
-- Sets marketing consent for an address and returns the resulting opt-in. An unverified
-- source (the public form) cannot lift an earlier unsubscribe; a verified account can.
-- Nothing lifts an 'all' suppression here.
create function private.r0_set_marketing(
  p_email text, p_opted_in boolean, p_source text, p_user uuid, p_verified boolean,
  p_actor text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare hash text := private.r0_hash(p_email); was_opted_in boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('r0-marketing:' || hash, 0));
  select opted_in into was_opted_in from private.r0_marketing_preferences
   where email_hash = hash for update;
  was_opted_in := coalesce(was_opted_in, false);
  if p_opted_in then
    if exists (select 1 from private.r0_email_suppressions where email_hash = hash and scope = 'all') then
      return false;
    end if;
    if exists (select 1 from private.r0_email_suppressions where email_hash = hash and scope = 'marketing') then
      if not p_verified then return false; end if;
      delete from private.r0_email_suppressions where email_hash = hash and scope = 'marketing';
    end if;
    if was_opted_in then
      update private.r0_marketing_preferences set user_id = coalesce(p_user, user_id), updated_at = now()
       where email_hash = hash;
      return true;
    end if;
    insert into private.r0_marketing_preferences
      (email_hash, email, user_id, opted_in, source, consented_at, withdrawn_at, updated_at)
    values (hash, p_email, p_user, true, p_source, now(), null, now())
    on conflict (email_hash) do update
      set email = excluded.email,
          user_id = coalesce(excluded.user_id, private.r0_marketing_preferences.user_id),
          opted_in = true, source = excluded.source, consented_at = now(), withdrawn_at = null,
          updated_at = now();
    perform private.r0_log(null, 'marketing_opt_in', p_actor, p_user);
    return true;
  end if;
  insert into private.r0_marketing_preferences
    (email_hash, email, user_id, opted_in, source, consented_at, withdrawn_at, updated_at)
  values (hash, null, p_user, false, p_source, null, now(), now())
  on conflict (email_hash) do update
    set email = null, opted_in = false, source = excluded.source, consented_at = null,
        withdrawn_at = case when private.r0_marketing_preferences.opted_in then now()
          else private.r0_marketing_preferences.withdrawn_at end,
        user_id = coalesce(excluded.user_id, private.r0_marketing_preferences.user_id),
        updated_at = now();
  insert into private.r0_email_suppressions (email_hash, scope, reason)
  values (hash, 'marketing', case when p_actor = 'account' then 'account' else 'unsubscribe' end)
  on conflict do nothing;
  if was_opted_in then perform private.r0_log(null, 'marketing_opt_out', p_actor, p_user); end if;
  return false;
end $$;
-- Links the account's unlinked interests that carry its confirmed email. An account that
-- already holds an interest of that kind keeps it; the unheld email-matched duplicate is
-- removed, so one person never holds two live identities of a kind.
create function private.r0_link_account(p_user uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare hash text := private.r0_hash(p_email); candidate private.r0_interests;
begin
  perform pg_advisory_xact_lock(hashtextextended('r0-interest:' || hash, 0));
  for candidate in
    select * from private.r0_interests
     where email_hash = hash and user_id is null and status <> 'deidentified'
     order by kind for update
  loop
    if exists (select 1 from private.r0_interests
        where kind = candidate.kind and user_id = p_user) then
      if candidate.hold_reason is null then
        delete from private.r0_interests where id = candidate.id;
        perform private.r0_log(candidate.id, 'merged', 'account', p_user);
      end if;
    else
      update private.r0_interests set user_id = p_user, linked_at = now(), updated_at = now()
       where id = candidate.id;
      perform private.r0_log(candidate.id, 'linked', 'account', p_user);
    end if;
  end loop;
  update private.r0_marketing_preferences set user_id = p_user
   where email_hash = hash and user_id is distinct from p_user;
end $$;
create function private.r0_interest_view(p_row private.r0_interests)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('kind', p_row.kind, 'status', p_row.status,
    'first_name', p_row.first_name, 'zip_code', p_row.zip_code,
    'service_ids', to_jsonb(p_row.service_ids), 'still_exploring', p_row.still_exploring,
    'linked', p_row.user_id is not null, 'updated_at', p_row.updated_at) $$;
revoke all on function private.r0_email(text), private.r0_hash(text), private.r0_is_operator(uuid),
  private.r0_account_email(uuid), private.r0_interest_shape(text,text,text[],boolean,text),
  private.r0_log(uuid,text,text,uuid), private.r0_deidentify(uuid,text,uuid),
  private.r0_withdraw(uuid,text,uuid), private.r0_set_marketing(text,boolean,text,uuid,boolean,text),
  private.r0_link_account(uuid,text), private.r0_interest_view(private.r0_interests)
  from public, anon, authenticated, service_role;

-- The Lee County boundary for the public form. The approved ZIP list is public policy.
create function public.r0_zip_in_lee(p_zip text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.r0_lee_zips where zip_code = p_zip) $$;
revoke all on function public.r0_zip_in_lee(text) from public, anon, authenticated, service_role;
grant execute on function public.r0_zip_in_lee(text) to service_role;

-- Public form (service role only, behind the intake route's honeypot and limits).
-- Returns 'boundary' when the ZIP does not match the chosen kind, else 'saved'. An
-- existing live interest for the email is never changed from the anonymous form, and the
-- result does not reveal whether one existed.
create function public.r0_submit_interest(
  p_kind text, p_email text, p_first_name text, p_zip text, p_service_ids text[],
  p_still_exploring boolean, p_marketing boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text; hash text; services text[]; existing private.r0_interests; new_id uuid;
begin
  v_email := private.r0_email(p_email);
  if p_marketing is null then
    raise exception 'Marketing choice is required.' using errcode = '22023';
  end if;
  begin
    services := private.r0_interest_shape(p_kind, p_zip, p_service_ids, p_still_exploring, p_first_name);
  exception when sqlstate '22023' then
    if sqlerrm = 'r0_boundary' then return jsonb_build_object('outcome', 'boundary'); end if;
    raise;
  end;
  hash := private.r0_hash(v_email);
  perform pg_advisory_xact_lock(hashtextextended('r0-interest:' || hash, 0));
  select * into existing from private.r0_interests
   where kind = p_kind and email_hash = hash for update;
  if not found then
    insert into private.r0_interests (kind, email, email_hash, first_name, zip_code, service_ids, still_exploring)
    values (p_kind, v_email, hash, nullif(btrim(p_first_name), ''), p_zip, services, p_still_exploring)
    returning id into new_id;
    perform private.r0_log(new_id, 'joined', 'public_form', null);
  end if;
  -- An existing live record is never changed here, and neither is a withdrawn record kept
  -- by a hold: an unverified form must not reverse someone's withdrawal.
  if p_marketing then
    perform private.r0_set_marketing(v_email, true, 'early_access_form', null, false, 'public_form');
  end if;
  return jsonb_build_object('outcome', 'saved');
end $$;
revoke all on function public.r0_submit_interest(text,text,text,text,text[],boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.r0_submit_interest(text,text,text,text,text[],boolean,boolean)
  to service_role;

-- Issues a fresh link token for an outgoing email. Returns null when the email has no
-- live interest of that kind (manage) or no current opt-in (unsubscribe), so a sender
-- cannot mint a link for a withdrawn, suppressed or unknown address.
create function public.r0_issue_link_token(p_purpose text, p_email text, p_kind text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare hash text := private.r0_hash(private.r0_email(p_email)); interest uuid;
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if p_purpose = 'manage' then
    select id into interest from private.r0_interests
     where kind = p_kind and email_hash = hash and status = 'active';
    if interest is null
      or exists (select 1 from private.r0_email_suppressions where email_hash = hash and scope = 'all') then
      return null;
    end if;
    insert into private.r0_link_tokens (token_hash, purpose, interest_id, expires_at)
    values (private.r0_hash(token), 'manage', interest, now() + interval '90 days');
  elsif p_purpose = 'unsubscribe' then
    if not exists (select 1 from private.r0_marketing_preferences where email_hash = hash and opted_in) then
      return null;
    end if;
    insert into private.r0_link_tokens (token_hash, purpose, email_hash, expires_at)
    values (private.r0_hash(token), 'unsubscribe', hash, now() + interval '90 days');
  else
    raise exception 'Unknown link purpose' using errcode = '22023';
  end if;
  delete from private.r0_link_tokens where expires_at < now();
  return token;
end $$;
revoke all on function public.r0_issue_link_token(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.r0_issue_link_token(text,text,text) to service_role;

-- Email-link management: read, update or withdraw the one interest a manage token names.
create function public.r0_manage_interest(
  p_token text, p_action text, p_first_name text default null, p_zip text default null,
  p_service_ids text[] default null, p_still_exploring boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare link private.r0_link_tokens; row private.r0_interests; services text[];
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select * into link from private.r0_link_tokens
   where token_hash = private.r0_hash(p_token) and purpose = 'manage' and expires_at > now();
  if not found then return jsonb_build_object('outcome', 'invalid'); end if;
  select * into row from private.r0_interests where id = link.interest_id for update;
  if not found or row.status <> 'active' then return jsonb_build_object('outcome', 'invalid'); end if;
  if p_action = 'read' then
    return jsonb_build_object('outcome', 'found', 'interest', private.r0_interest_view(row));
  elsif p_action = 'update' then
    begin
      services := private.r0_interest_shape(row.kind, p_zip, p_service_ids, p_still_exploring, p_first_name);
    exception when sqlstate '22023' then
      if sqlerrm = 'r0_boundary' then return jsonb_build_object('outcome', 'boundary'); end if;
      raise;
    end;
    update private.r0_interests
       set first_name = nullif(btrim(p_first_name), ''), zip_code = p_zip,
           service_ids = services, still_exploring = p_still_exploring, updated_at = now()
     where id = row.id returning * into row;
    perform private.r0_log(row.id, 'updated', 'manage_link', null);
    return jsonb_build_object('outcome', 'updated', 'interest', private.r0_interest_view(row));
  elsif p_action = 'withdraw' then
    return jsonb_build_object('outcome', private.r0_withdraw(row.id, 'manage_link', null));
  end if;
  raise exception 'Unknown action' using errcode = '22023';
end $$;
revoke all on function public.r0_manage_interest(text,text,text,text,text[],boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.r0_manage_interest(text,text,text,text,text[],boolean) to service_role;

-- Promotional unsubscribe. Idempotent while the token is unexpired.
create function public.r0_unsubscribe_marketing(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link private.r0_link_tokens;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select * into link from private.r0_link_tokens
   where token_hash = private.r0_hash(p_token) and purpose = 'unsubscribe' and expires_at > now();
  if not found then return jsonb_build_object('outcome', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended('r0-marketing:' || link.email_hash, 0));
  update private.r0_marketing_preferences
     set email = null, opted_in = false, source = 'unsubscribe_link', consented_at = null,
         withdrawn_at = now(), updated_at = now()
   where email_hash = link.email_hash and opted_in;
  if found then perform private.r0_log(null, 'marketing_opt_out', 'unsubscribe_link', null); end if;
  insert into private.r0_email_suppressions (email_hash, scope, reason)
  values (link.email_hash, 'marketing', 'unsubscribe') on conflict do nothing;
  return jsonb_build_object('outcome', 'unsubscribed');
end $$;
revoke all on function public.r0_unsubscribe_marketing(text) from public, anon, authenticated, service_role;
grant execute on function public.r0_unsubscribe_marketing(text) to service_role;

-- Provider outcomes (bounce/complaint) and operator suppression. Any suppression also
-- ends marketing consent; 'all' also stops early-access mail.
create function public.r0_record_email_suppression(p_email text, p_scope text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := private.r0_email(p_email); hash text := private.r0_hash(v_email);
begin
  if p_scope is null or p_scope not in ('marketing', 'all')
    or p_reason is null or p_reason not in ('bounce', 'complaint', 'operator') then
    raise exception 'Invalid suppression' using errcode = '22023';
  end if;
  perform private.r0_set_marketing(v_email, false, 'provider', null, false, 'provider');
  insert into private.r0_email_suppressions (email_hash, scope, reason)
  values (hash, p_scope, p_reason) on conflict do nothing;
  perform private.r0_log(null, 'suppressed', 'provider', null);
end $$;
revoke all on function public.r0_record_email_suppression(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.r0_record_email_suppression(text,text,text) to service_role;

-- Send-time classification check: early-access status mail needs a live interest and no
-- 'all' suppression; marketing needs a current opt-in and no suppression of either scope.
create function public.r0_email_allowed(p_email text, p_class text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare hash text := private.r0_hash(private.r0_email(p_email));
begin
  if p_class is null or p_class not in ('early_access', 'marketing') then
    raise exception 'Unknown email class' using errcode = '22023';
  end if;
  if exists (select 1 from private.r0_email_suppressions where email_hash = hash and scope = 'all') then
    return false;
  end if;
  if p_class = 'early_access' then
    return exists (select 1 from private.r0_interests where email_hash = hash and status = 'active');
  end if;
  return exists (select 1 from private.r0_marketing_preferences where email_hash = hash and opted_in)
    and not exists (select 1 from private.r0_email_suppressions where email_hash = hash);
end $$;
revoke all on function public.r0_email_allowed(text,text) from public, anon, authenticated, service_role;
grant execute on function public.r0_email_allowed(text,text) to service_role;

-- Verified account holder commands. An unconfirmed account sees only verified=false and
-- cannot link, save or change consent.
create function public.r0_my_interest() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); v_email text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_email := private.r0_account_email(actor);
  if v_email is null then return jsonb_build_object('verified', false); end if;
  perform private.r0_link_account(actor, v_email);
  return jsonb_build_object('verified', true,
    'interests', coalesce((select jsonb_agg(private.r0_interest_view(i) order by i.kind)
      from private.r0_interests i where i.user_id = actor), '[]'::jsonb),
    'marketing_opted_in', exists (select 1 from private.r0_marketing_preferences
      where email_hash = private.r0_hash(v_email) and opted_in));
end $$;
create function public.r0_save_my_interest(
  p_kind text, p_first_name text, p_zip text, p_service_ids text[], p_still_exploring boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); v_email text; services text[]; row private.r0_interests;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_email := private.r0_account_email(actor);
  if v_email is null or not public.has_role(actor, 'homeowner') then
    raise exception 'A verified homeowner account is required' using errcode = '42501';
  end if;
  begin
    services := private.r0_interest_shape(p_kind, p_zip, p_service_ids, p_still_exploring, p_first_name);
  exception when sqlstate '22023' then
    if sqlerrm = 'r0_boundary' then return jsonb_build_object('outcome', 'boundary'); end if;
    raise;
  end;
  perform private.r0_link_account(actor, v_email);
  select * into row from private.r0_interests where kind = p_kind and user_id = actor for update;
  if found then
    update private.r0_interests
       set status = 'active', withdrawn_at = null, first_name = nullif(btrim(p_first_name), ''),
           zip_code = p_zip, service_ids = services, still_exploring = p_still_exploring,
           updated_at = now()
     where id = row.id returning * into row;
    perform private.r0_log(row.id, 'updated', 'account', actor);
  else
    insert into private.r0_interests
      (kind, email, email_hash, first_name, zip_code, service_ids, still_exploring, user_id, linked_at)
    values (p_kind, v_email, private.r0_hash(v_email), nullif(btrim(p_first_name), ''), p_zip, services,
      p_still_exploring, actor, now())
    returning * into row;
    perform private.r0_log(row.id, 'joined', 'account', actor);
  end if;
  return jsonb_build_object('outcome', 'saved', 'interest', private.r0_interest_view(row));
end $$;
create function public.r0_withdraw_my_interest(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); interest uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select id into interest from private.r0_interests where kind = p_kind and user_id = actor;
  if interest is null then return jsonb_build_object('outcome', 'withdrawn'); end if;
  return jsonb_build_object('outcome', private.r0_withdraw(interest, 'account', actor));
end $$;
create function public.r0_set_my_marketing(p_opted_in boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); v_email text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  v_email := private.r0_account_email(actor);
  if v_email is null or p_opted_in is null then
    raise exception 'A verified account is required' using errcode = '42501';
  end if;
  return jsonb_build_object('marketing_opted_in',
    private.r0_set_marketing(v_email, p_opted_in, 'account', actor, true, 'account'));
end $$;
revoke all on function public.r0_my_interest(), public.r0_save_my_interest(text,text,text,text[],boolean),
  public.r0_withdraw_my_interest(text), public.r0_set_my_marketing(boolean)
  from public, anon, service_role;
grant execute on function public.r0_my_interest(), public.r0_save_my_interest(text,text,text,text[],boolean),
  public.r0_withdraw_my_interest(text), public.r0_set_my_marketing(boolean) to authenticated;

-- R0 operator commands (TRACE-101 roster). The R2 event is recorded once and cannot be
-- placed in the future; a mistaken record requires a reviewed forward fix.
create function public.r0_record_r2_opening(p_occurred_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if not private.r0_is_operator(actor) then
    raise exception 'R0 operator required' using errcode = '42501';
  end if;
  if p_occurred_at is null or p_occurred_at > now()
    or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Invalid R2 opening record' using errcode = '22023';
  end if;
  insert into private.r0_release_events (event, occurred_at, recorded_by, reason)
  values ('r2_broad_booking_opened', p_occurred_at, actor, btrim(p_reason))
  on conflict (event) do nothing;
  if not found then
    raise exception 'R2 opening is already recorded' using errcode = '23505';
  end if;
  return jsonb_build_object('r2_opened_at', p_occurred_at,
    'retention_due_at', p_occurred_at + interval '90 days');
end $$;
create function public.r0_set_interest_hold(p_email text, p_kind text, p_hold boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); row private.r0_interests;
begin
  if not private.r0_is_operator(actor) then
    raise exception 'R0 operator required' using errcode = '42501';
  end if;
  if p_hold is null or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select * into row from private.r0_interests
   where kind = p_kind and email_hash = private.r0_hash(private.r0_email(p_email)) for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  update private.r0_interests
     set hold_reason = case when p_hold then btrim(p_reason) end,
         hold_placed_at = case when p_hold then now() end,
         hold_placed_by = case when p_hold then actor end, updated_at = now()
   where id = row.id;
  perform private.r0_log(row.id, case when p_hold then 'hold_placed' else 'hold_released' end,
    'operator', actor);
  return jsonb_build_object('outcome', case when p_hold then 'held' else 'released' end);
end $$;
-- One retention pass: a withdrawn record whose hold has ended is removed at any time,
-- linked or not; every other list-only record is removed once 90 days have passed since
-- the recorded R2 opening. Live account-linked interests and held records are kept. Each
-- pass is recorded, including passes before R2, so the job's state is observable.
create function public.r0_run_interest_retention(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); via text; opened timestamptz; due timestamptz;
  removed integer := 0; held integer; remaining integer; candidate uuid;
begin
  if auth.role() = 'service_role' then via := 'service';
  elsif private.r0_is_operator(actor) then via := 'operator';
  else raise exception 'R0 operator required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'Invalid retention batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('r0-interest-retention', 0));
  select occurred_at into opened from private.r0_release_events where event = 'r2_broad_booking_opened';
  due := opened + interval '90 days';
  for candidate in
    select id from private.r0_interests
     where status <> 'deidentified' and hold_reason is null
       and (status = 'withdrawn' or (user_id is null and due <= now()))
     order by created_at limit p_limit
  loop
    if private.r0_deidentify(candidate, 'retention', actor) then removed := removed + 1; end if;
  end loop;
  select count(*) into held from private.r0_interests
   where status <> 'deidentified' and hold_reason is not null
     and (status = 'withdrawn' or user_id is null);
  select count(*) into remaining from private.r0_interests
   where status <> 'deidentified' and hold_reason is null
     and (status = 'withdrawn' or (user_id is null and due <= now()));
  insert into private.r0_retention_runs
    (actor, actor_id, r2_opened_at, retention_due_at, deidentified, held, remaining)
  values (via, actor, opened, due, removed, held, remaining);
  return jsonb_build_object('r2_opened_at', opened, 'retention_due_at', due,
    'deidentified', removed, 'held', held, 'remaining', remaining);
end $$;
create function public.r0_interest_retention_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare opened timestamptz; last private.r0_retention_runs;
begin
  if not private.r0_is_operator(auth.uid()) then
    raise exception 'R0 operator required' using errcode = '42501';
  end if;
  select occurred_at into opened from private.r0_release_events where event = 'r2_broad_booking_opened';
  select * into last from private.r0_retention_runs order by id desc limit 1;
  return jsonb_build_object(
    'r2_opened_at', opened,
    'retention_due_at', opened + interval '90 days',
    'list_only_live', (select count(*) from private.r0_interests
      where user_id is null and status <> 'deidentified'),
    'held', (select count(*) from private.r0_interests
      where status <> 'deidentified' and hold_reason is not null
        and (status = 'withdrawn' or user_id is null)),
    'withdrawn_pending', (select count(*) from private.r0_interests where status = 'withdrawn'),
    'account_linked', (select count(*) from private.r0_interests where user_id is not null),
    'marketing_opted_in', (select count(*) from private.r0_marketing_preferences where opted_in),
    'last_run', case when last.id is null then null else jsonb_build_object(
      'ran_at', last.ran_at, 'actor', last.actor, 'deidentified', last.deidentified,
      'held', last.held, 'remaining', last.remaining) end);
end $$;
revoke all on function public.r0_record_r2_opening(timestamptz,text),
  public.r0_set_interest_hold(text,text,boolean,text), public.r0_run_interest_retention(integer),
  public.r0_interest_retention_status() from public, anon, service_role;
grant execute on function public.r0_record_r2_opening(timestamptz,text),
  public.r0_set_interest_hold(text,text,boolean,text), public.r0_interest_retention_status()
  to authenticated;
grant execute on function public.r0_run_interest_retention(integer) to authenticated, service_role;
