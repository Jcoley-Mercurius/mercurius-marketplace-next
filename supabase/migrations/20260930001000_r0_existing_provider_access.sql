-- TRACE-105: reviewed profile-setup access for existing providers (owner decision 2026-09-30).
--
-- Legacy providers created before the rebuilt onboarding have no application, so the
-- TRACE-063/070 invitation (which reads its recipient from an application snapshot)
-- cannot reach them, and TRACE-065 refuses to start application review for them. This
-- path gives such a provider's confirmed owner access to set up the existing profile,
-- without an application, consent, evidence or approval being created for them.
--
--   contact  -> an operator records the owner-confirmed business email for the exact
--               contractor (append-only; one current contact per provider and per address)
--   attempt  -> operator-entered expiry; one live attempt per provider
--   dispatch -> reserved before Auth is called (new-account mode only); provider accepted,
--               unknown or refused exactly as TRACE-063/TRACE-072
--   receipt  -> the verified recipient explicitly accepts while signed in
--   binding  -> an operator re-proves identity, recipient, ownership and receipt, links the
--               account and grants the vendor role for portal access (TRACE-068 timing change)
--
-- Setup access is not approval. An access-managed provider is never matching-eligible
-- or publicly listable on its legacy is_active flag: it needs onboarding or cutover
-- evidence like any other provider. Application-based onboarding is unchanged.

create table private.r0_provider_contacts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id),
  email text not null check (email = lower(btrim(email))
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  confirmation text not null check (length(btrim(confirmation)) between 1 and 500),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  business_key text not null unique check (length(btrim(business_key)) > 0),
  supersedes uuid unique references private.r0_provider_contacts(id),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
-- The current contact. Unique per provider and per address, so one mailbox can never
-- be the access recipient for two providers.
create table private.r0_provider_current_contacts (
  contractor_id uuid primary key references public.contractors(id),
  contact_id uuid not null unique references private.r0_provider_contacts(id),
  email text not null unique
);
create table private.r0_provider_access_attempts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id),
  contact_id uuid not null references private.r0_provider_contacts(id),
  mode text not null check (mode in ('new_account', 'existing_account')),
  existing_account_id uuid references auth.users(id),
  business_key text not null unique check (length(btrim(business_key)) > 0),
  status text not null default 'prepared'
    check (status in ('prepared', 'submitted', 'unknown', 'accepted', 'failed', 'expired', 'revoked')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((mode = 'existing_account') = (existing_account_id is not null))
);
create unique index r0_provider_access_one_live on private.r0_provider_access_attempts(contractor_id)
  where status in ('prepared', 'submitted', 'unknown');
create table private.r0_provider_access_dispatches (
  attempt_id uuid primary key references private.r0_provider_access_attempts(id),
  recipient_email text not null,
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users(id),
  state text not null default 'started' check (state in ('started', 'unknown', 'provider_accepted', 'failed')),
  auth_user_id uuid references auth.users(id),
  resolved_at timestamptz,
  refusal_code text,
  -- No foreign key: refusal evidence must survive a later account deletion.
  refused_account_id uuid,
  check ((state = 'provider_accepted') = (auth_user_id is not null)),
  check ((state = 'failed') = (refusal_code is not null) and (refused_account_id is null or state = 'failed'))
);
create table private.r0_provider_access_acceptances (
  attempt_id uuid primary key references private.r0_provider_access_attempts(id),
  contractor_id uuid not null references public.contractors(id),
  contact_id uuid not null references private.r0_provider_contacts(id),
  auth_user_id uuid not null references auth.users(id),
  accepted_at timestamptz not null default now()
);
create table private.r0_provider_access_bindings (
  sequence bigint generated always as identity primary key,
  business_key text not null unique check (length(btrim(business_key)) > 0),
  contractor_id uuid not null references public.contractors(id),
  action text not null check (action in ('bind', 'release')),
  auth_user_id uuid not null,
  attempt_id uuid references private.r0_provider_access_acceptances(attempt_id),
  contact_id uuid references private.r0_provider_contacts(id),
  vendor_role_changed boolean not null,
  actor uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  check ((action = 'bind') = (attempt_id is not null))
);
-- Audit trail. Names no address; the contact row is the only place one is kept.
create table private.r0_provider_access_events (
  id bigint generated always as identity primary key,
  contractor_id uuid not null,
  attempt_id uuid,
  event text not null,
  previous_status text,
  status text,
  evidence text not null check (length(btrim(evidence)) > 0),
  actor uuid not null,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['r0_provider_contacts','r0_provider_current_contacts','r0_provider_access_attempts',
    'r0_provider_access_dispatches','r0_provider_access_acceptances','r0_provider_access_bindings',
    'r0_provider_access_events'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', t);
  end loop;
  foreach t in array array['r0_provider_contacts','r0_provider_access_acceptances','r0_provider_access_bindings',
    'r0_provider_access_events'] loop
    execute format('create trigger immutable_evidence before update or delete on private.%I
      for each row execute function public.money_immutable()', t);
  end loop;
end $$;

-- Helpers ---------------------------------------------------------------------------

create function private.r0_access_log(p_contractor uuid, p_attempt uuid, p_event text,
  p_previous text, p_status text, p_evidence text, p_actor uuid) returns void
language sql set search_path = '' as $$
  insert into private.r0_provider_access_events(contractor_id, attempt_id, event, previous_status, status, evidence, actor)
  values (p_contractor, p_attempt, p_event, p_previous, p_status, p_evidence, p_actor)
$$;

create function private.r0_access_email_valid(p_email text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$', false)
$$;

-- A provider is access-managed once an owner-confirmed contact exists for it. From then
-- on its legacy is_active flag is not treated as approval.
create function private.r0_provider_access_managed(p_contractor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.r0_provider_contacts c where c.contractor_id = p_contractor)
$$;

-- The live account link, when this path created it.
create function private.r0_provider_access_binding(p_contractor uuid) returns private.r0_provider_access_bindings
language sql stable set search_path = '' as $$
  select b.* from private.r0_provider_access_bindings b
   where b.contractor_id = p_contractor
   order by b.sequence desc limit 1
$$;

-- Conditions every access step rechecks: the provider is on the legacy path (no
-- application onboarding), is not excluded as a test/fake record, and the contact the
-- attempt names is still current.
create function private.r0_access_provider_ready(p_contractor uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from public.vendor_onboarding o where o.contractor_id = p_contractor) then
    raise exception 'Provider follows application onboarding';
  end if;
  if exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = p_contractor) then
    raise exception 'Excluded provider cannot receive access';
  end if;
end $$;

-- An account at this provider's contact address that already accepted one of this
-- provider's access attempts. A new-account invitation to it would be refused by Auth;
-- the recovery is an existing-account attempt naming that account by ID.
create function private.r0_access_recipient_account(p_contractor uuid, p_email text) returns uuid
language sql stable set search_path = '' as $$
  select u.id from private.r0_provider_access_acceptances r
    join auth.users u on u.id = r.auth_user_id
   where r.contractor_id = p_contractor and lower(btrim(u.email)) = p_email
   order by r.accepted_at desc limit 1
$$;

-- Owner-confirmed contact ---------------------------------------------------------------

create function public.r0_record_provider_contact(p_contractor uuid, p_email text, p_confirmation text,
  p_reason text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; prior private.r0_provider_contacts; cur private.r0_provider_current_contacts;
  c public.contractors; v_email text := lower(btrim(coalesce(p_email, ''))); created private.r0_provider_contacts;
begin
  actor := public.vendor_require_operator();
  select * into prior from private.r0_provider_contacts where business_key = p_key;
  if found then
    if prior.contractor_id <> p_contractor or prior.email <> v_email or prior.recorded_by <> actor
      or prior.confirmation <> btrim(p_confirmation) or prior.reason <> btrim(p_reason) then
      raise exception 'Contact idempotency conflict';
    end if;
    return jsonb_build_object('contact_id', prior.id, 'contractor_id', prior.contractor_id, 'recorded', false);
  end if;
  if length(btrim(coalesce(p_confirmation, ''))) = 0 or length(btrim(coalesce(p_reason, ''))) = 0
    or length(btrim(coalesce(p_key, ''))) = 0 then
    raise exception 'Owner confirmation, reason and idempotency key required';
  end if;
  if not private.r0_access_email_valid(v_email) then raise exception 'Valid contact email required'; end if;
  select * into c from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  perform private.r0_access_provider_ready(p_contractor);
  if c.user_id is not null then raise exception 'Provider already has a linked account'; end if;
  if exists (select 1 from private.r0_provider_access_attempts a
     where a.contractor_id = p_contractor and a.status in ('prepared', 'submitted', 'unknown')) then
    raise exception 'Close the live access invitation before changing the contact';
  end if;
  select * into cur from private.r0_provider_current_contacts where contractor_id = p_contractor;
  if cur.email = v_email then
    return jsonb_build_object('contact_id', cur.contact_id, 'contractor_id', p_contractor, 'recorded', false);
  end if;
  if exists (select 1 from private.r0_provider_current_contacts x where x.email = v_email) then
    raise exception 'Contact email belongs to another provider';
  end if;
  insert into private.r0_provider_contacts(contractor_id, email, confirmation, reason, business_key, supersedes, recorded_by)
    values (p_contractor, v_email, btrim(p_confirmation), btrim(p_reason), p_key, cur.contact_id, actor)
    returning * into created;
  insert into private.r0_provider_current_contacts(contractor_id, contact_id, email)
    values (p_contractor, created.id, v_email)
    on conflict (contractor_id) do update set contact_id = excluded.contact_id, email = excluded.email;
  -- The business email on the profile follows the confirmed contact (normalized casing).
  if c.email is distinct from v_email then
    update public.contractors set email = v_email, updated_at = now() where id = p_contractor;
  end if;
  perform private.r0_access_log(p_contractor, null, 'contact_recorded', null, null,
    case when cur.contact_id is null then 'Owner-confirmed contact recorded'
      else 'Owner-confirmed contact replaced ' || cur.contact_id end
    || case when c.email is distinct from v_email then '; profile business email updated' else '' end, actor);
  return jsonb_build_object('contact_id', created.id, 'contractor_id', p_contractor, 'recorded', true);
end $$;

-- Attempts ------------------------------------------------------------------------------

create function public.r0_prepare_provider_access(p_contractor uuid, p_key text, p_expires timestamptz,
  p_existing_account uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; a private.r0_provider_access_attempts; c public.contractors;
  cur private.r0_provider_current_contacts; target auth.users;
begin
  actor := public.vendor_require_operator();
  select * into a from private.r0_provider_access_attempts where business_key = p_key;
  if found then
    if a.contractor_id <> p_contractor or a.expires_at <> p_expires
      or a.existing_account_id is distinct from p_existing_account or a.created_by <> actor then
      raise exception 'Access invitation idempotency conflict';
    end if;
    return jsonb_build_object('attempt_id', a.id, 'mode', a.mode, 'status', a.status, 'created', false);
  end if;
  if length(btrim(coalesce(p_key, ''))) = 0 then raise exception 'Idempotency key required'; end if;
  if p_expires is null or p_expires <= now() or p_expires > now() + interval '30 days' then
    raise exception 'Operator-entered expiry within 30 days required';
  end if;
  select * into c from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  perform private.r0_access_provider_ready(p_contractor);
  if c.user_id is not null then raise exception 'Provider already has a linked account'; end if;
  select * into cur from private.r0_provider_current_contacts where contractor_id = p_contractor;
  if not found then raise exception 'Owner-confirmed contact required'; end if;
  if p_existing_account is not null then
    -- Existing account: identity by exact ID, proven against the confirmed contact.
    select * into target from auth.users where id = p_existing_account;
    if not found then raise exception 'Account identity not found'; end if;
    if target.email_confirmed_at is null then raise exception 'Confirmed account required'; end if;
    if lower(btrim(target.email)) is distinct from cur.email then
      raise exception 'Account does not match the confirmed contact';
    end if;
    if exists (select 1 from public.contractors x where x.user_id = p_existing_account) then
      raise exception 'Account already linked to another provider';
    end if;
  elsif private.r0_access_recipient_account(p_contractor, cur.email) is not null then
    raise exception 'Recipient already holds an account; prepare existing-account access by account ID';
  end if;
  begin
    insert into private.r0_provider_access_attempts(contractor_id, contact_id, mode, existing_account_id,
      business_key, expires_at, created_by)
    values (p_contractor, cur.contact_id, case when p_existing_account is null then 'new_account' else 'existing_account' end,
      p_existing_account, p_key, p_expires, actor)
    returning * into a;
  exception when unique_violation then
    raise exception 'Close the live access invitation first';
  end;
  perform private.r0_access_log(p_contractor, a.id, 'attempt_prepared', null, 'prepared',
    case when a.mode = 'new_account' then 'Access invitation prepared; nothing sent'
      else 'Existing-account access prepared for account ' || p_existing_account || '; nothing sent' end, actor);
  return jsonb_build_object('attempt_id', a.id, 'mode', a.mode, 'status', a.status, 'created', true);
end $$;

-- Reserve the Auth dispatch before the non-idempotent Auth call (operator session).
create function public.r0_claim_provider_access(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; a private.r0_provider_access_attempts; c public.contractors; cur private.r0_provider_current_contacts;
begin
  actor := public.vendor_require_operator();
  select x.* into c from public.contractors x join private.r0_provider_access_attempts y on y.contractor_id = x.id
   where y.id = p_attempt for update of x;
  if not found then raise exception 'Access invitation not found' using errcode = 'P0002'; end if;
  select * into strict a from private.r0_provider_access_attempts where id = p_attempt for update;
  if exists (select 1 from private.r0_provider_access_dispatches where attempt_id = a.id) then
    return jsonb_build_object('claimed', false, 'status', a.status);
  end if;
  perform private.r0_access_provider_ready(a.contractor_id);
  select * into cur from private.r0_provider_current_contacts where contractor_id = a.contractor_id;
  if a.mode <> 'new_account' then raise exception 'Existing-account access is not emailed by Auth'; end if;
  if a.status <> 'prepared' or a.expires_at <= now() or cur.contact_id is distinct from a.contact_id
    or c.user_id is not null then
    raise exception 'Current access invitation required';
  end if;
  if private.r0_access_recipient_account(a.contractor_id, cur.email) is not null then
    raise exception 'Recipient already holds an account; prepare existing-account access by account ID';
  end if;
  insert into private.r0_provider_access_dispatches(attempt_id, recipient_email, started_by)
    values (a.id, cur.email, actor);
  update private.r0_provider_access_attempts set status = 'submitted' where id = a.id;
  perform private.r0_access_log(a.contractor_id, a.id, 'dispatch_reserved', 'prepared', 'submitted',
    'Auth dispatch reserved; delivery not yet confirmed', actor);
  return jsonb_build_object('claimed', true, 'recipient_email', cur.email, 'business_name', c.name,
    'expires_at', a.expires_at);
end $$;

-- Service-only receipt writer (Edge function). Auth users are read by ID only.
create function public.r0_finish_provider_access(p_attempt uuid, p_auth_user uuid default null, p_actor uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a private.r0_provider_access_attempts; d private.r0_provider_access_dispatches; target auth.users;
begin
  perform 1 from public.contractors x join private.r0_provider_access_attempts y on y.contractor_id = x.id
   where y.id = p_attempt for update of x;
  select * into strict a from private.r0_provider_access_attempts where id = p_attempt for update;
  select * into strict d from private.r0_provider_access_dispatches where attempt_id = p_attempt for update;
  if p_actor is not null and not public.has_role(p_actor, 'admin') then
    raise exception 'Onboarding operator required' using errcode = '42501';
  end if;
  if d.state = 'failed' then
    if p_auth_user is null then return; end if;
    raise exception 'Access invitation already refused by Auth';
  end if;
  if d.state = 'provider_accepted' then
    if p_auth_user is null or p_auth_user = d.auth_user_id then return; end if;
    raise exception 'Invitation identity conflict';
  end if;
  if p_auth_user is null then
    if d.state = 'unknown' then return; end if;
    update private.r0_provider_access_dispatches set state = 'unknown' where attempt_id = a.id;
    update private.r0_provider_access_attempts set status = 'unknown' where id = a.id;
    perform private.r0_access_log(a.contractor_id, a.id, 'dispatch_unknown', a.status, 'unknown',
      'Auth outcome unknown; reconcile before any further dispatch', coalesce(p_actor, d.started_by));
    return;
  end if;
  select * into strict target from auth.users where id = p_auth_user;
  if lower(btrim(target.email)) is distinct from d.recipient_email
    or target.invited_at is null or target.invited_at < d.started_at then
    raise exception 'Auth invitation identity evidence mismatch';
  end if;
  if exists (select 1 from public.contractors x where x.id = a.contractor_id and x.user_id is not null and x.user_id <> p_auth_user) then
    raise exception 'Invitation identity conflict';
  end if;
  update private.r0_provider_access_dispatches set state = 'provider_accepted', auth_user_id = p_auth_user, resolved_at = now()
   where attempt_id = a.id;
  update private.r0_provider_access_attempts set status = 'submitted' where id = a.id;
  perform private.r0_access_log(a.contractor_id, a.id, 'provider_accepted', a.status, 'submitted',
    'Auth accepted invitation; mailbox delivery not asserted', coalesce(p_actor, d.started_by));
end $$;

-- Service-only. A definite Auth refusal of an address that already holds an account,
-- on the same evidence rules as vendor_refuse_invitation.
create function public.r0_refuse_provider_access(p_attempt uuid, p_code text, p_actor uuid, p_existing_account uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a private.r0_provider_access_attempts; d private.r0_provider_access_dispatches; target auth.users;
begin
  perform 1 from public.contractors x join private.r0_provider_access_attempts y on y.contractor_id = x.id
   where y.id = p_attempt for update of x;
  select * into strict a from private.r0_provider_access_attempts where id = p_attempt for update;
  select * into strict d from private.r0_provider_access_dispatches where attempt_id = p_attempt for update;
  if p_actor is null or not public.has_role(p_actor, 'admin') then
    raise exception 'Onboarding operator required' using errcode = '42501';
  end if;
  if p_code is null or p_code <> 'email_exists' then raise exception 'Definite Auth refusal required'; end if;
  if d.state = 'failed' then
    if d.refusal_code = p_code and (p_existing_account is null or d.refused_account_id is null
      or p_existing_account = d.refused_account_id) then return; end if;
    raise exception 'Invitation refusal conflict';
  end if;
  if d.state = 'provider_accepted' then raise exception 'Invitation identity conflict'; end if;
  if p_existing_account is null then
    if d.state <> 'started' then raise exception 'Unknown invitation requires account evidence'; end if;
  else
    select * into target from auth.users where id = p_existing_account;
    if not found then raise exception 'Account identity not found'; end if;
    if lower(btrim(target.email)) is distinct from d.recipient_email
      or target.email_confirmed_at is null or target.email_confirmed_at >= d.started_at
      or (target.invited_at is not null and target.invited_at >= d.started_at) then
      raise exception 'Auth refusal evidence mismatch';
    end if;
  end if;
  if a.status not in ('submitted', 'unknown') then raise exception 'Access invitation already closed'; end if;
  update private.r0_provider_access_dispatches
     set state = 'failed', refusal_code = p_code, refused_account_id = p_existing_account, resolved_at = now()
   where attempt_id = a.id;
  update private.r0_provider_access_attempts set status = 'failed' where id = a.id;
  perform private.r0_access_log(a.contractor_id, a.id, 'dispatch_refused', a.status, 'failed',
    case when p_existing_account is null
      then 'Auth refused invitation: recipient address already holds an account; nothing sent'
      else 'Auth refusal reconciled: account ' || p_existing_account || ' held the recipient address before dispatch; nothing sent' end,
    p_actor);
end $$;

-- The verified recipient explicitly accepts while signed in. Binds nothing.
create function public.r0_accept_provider_access(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); a private.r0_provider_access_attempts; d private.r0_provider_access_dispatches;
  c public.contractors; cur private.r0_provider_current_contacts;
begin
  if actor is null then raise exception 'Authenticated recipient required' using errcode = '42501'; end if;
  select x.* into c from public.contractors x join private.r0_provider_access_attempts y on y.contractor_id = x.id
   where y.id = p_attempt for update of x;
  if not found then raise exception 'Verified invitation recipient required' using errcode = '42501'; end if;
  select * into strict a from private.r0_provider_access_attempts where id = p_attempt for update;
  select * into d from private.r0_provider_access_dispatches where attempt_id = p_attempt;
  select * into cur from private.r0_provider_current_contacts where contractor_id = a.contractor_id;
  -- Identity first, so another account learns nothing about the attempt.
  if (a.mode = 'new_account' and d.auth_user_id is distinct from actor)
    or (a.mode = 'existing_account' and a.existing_account_id <> actor)
    or not exists (select 1 from auth.users u where u.id = actor and u.email_confirmed_at is not null
      and lower(btrim(u.email)) = (select k.email from private.r0_provider_contacts k where k.id = a.contact_id)) then
    raise exception 'Verified invitation recipient required' using errcode = '42501';
  end if;
  if exists (select 1 from private.r0_provider_access_acceptances r where r.attempt_id = a.id and r.auth_user_id = actor) then
    return jsonb_build_object('status', 'accepted', 'recorded', false);
  end if;
  perform private.r0_access_provider_ready(a.contractor_id);
  if a.expires_at <= now() or cur.contact_id is distinct from a.contact_id
    or (c.user_id is not null and c.user_id <> actor)
    or (a.mode = 'new_account' and (d.state is distinct from 'provider_accepted' or a.status <> 'submitted'))
    or (a.mode = 'existing_account' and a.status <> 'prepared') then
    raise exception 'Current access invitation required';
  end if;
  insert into private.r0_provider_access_acceptances(attempt_id, contractor_id, contact_id, auth_user_id)
    values (a.id, a.contractor_id, a.contact_id, actor);
  update private.r0_provider_access_attempts set status = 'accepted' where id = a.id;
  perform private.r0_access_log(a.contractor_id, a.id, 'accepted', a.status, 'accepted',
    'Verified recipient explicitly accepted profile access', actor);
  -- No account link, role, evidence, approval, listing or activation here.
  return jsonb_build_object('status', 'accepted', 'recorded', true);
end $$;

create function public.r0_close_provider_access(p_attempt uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; a private.r0_provider_access_attempts; d private.r0_provider_access_dispatches;
begin
  actor := public.vendor_require_operator();
  perform 1 from public.contractors x join private.r0_provider_access_attempts y on y.contractor_id = x.id
   where y.id = p_attempt for update of x;
  select * into a from private.r0_provider_access_attempts where id = p_attempt for update;
  if not found then raise exception 'Access invitation not found' using errcode = 'P0002'; end if;
  if p_status is null or p_status not in ('revoked', 'expired') or length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Reviewed closure and reason required';
  end if;
  if a.status = p_status then return jsonb_build_object('status', a.status, 'changed', false); end if;
  select * into d from private.r0_provider_access_dispatches where attempt_id = a.id;
  -- An unknown outcome must be reconciled first; closing it could hide a live Auth link.
  if a.status = 'unknown' or d.state in ('started', 'unknown') then
    raise exception 'Reconcile access invitation before closure';
  end if;
  if a.status not in ('prepared', 'submitted') then raise exception 'Access invitation already closed'; end if;
  if p_status = 'expired' and a.expires_at > now() then raise exception 'Access invitation not expired'; end if;
  update private.r0_provider_access_attempts set status = p_status where id = a.id;
  perform private.r0_access_log(a.contractor_id, a.id, 'closed', a.status, p_status, btrim(p_reason), actor);
  return jsonb_build_object('status', p_status, 'changed', true);
end $$;

create function public.r0_provider_access_status(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a private.r0_provider_access_attempts; d private.r0_provider_access_dispatches;
begin
  perform public.vendor_require_operator();
  select * into a from private.r0_provider_access_attempts where id = p_attempt;
  if not found then raise exception 'Access invitation not found' using errcode = 'P0002'; end if;
  select * into d from private.r0_provider_access_dispatches where attempt_id = p_attempt;
  return jsonb_build_object('attempt_id', a.id, 'contractor_id', a.contractor_id, 'mode', a.mode,
    'status', a.status, 'dispatch_state', d.state, 'auth_user_id', d.auth_user_id, 'expires_at', a.expires_at,
    'refusal_code', d.refusal_code, 'refused_account_id', d.refused_account_id,
    'accepted', exists (select 1 from private.r0_provider_access_acceptances r where r.attempt_id = a.id));
end $$;

-- Reviewed binding ------------------------------------------------------------------

create function public.r0_bind_provider_access(p_contractor uuid, p_attempt uuid, p_reason text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; prior private.r0_provider_access_bindings; c public.contractors;
  receipt private.r0_provider_access_acceptances; a private.r0_provider_access_attempts;
  d private.r0_provider_access_dispatches; cur private.r0_provider_current_contacts; target auth.users;
  role_changed boolean := false;
begin
  actor := public.vendor_require_operator();
  select * into prior from private.r0_provider_access_bindings where business_key = p_key;
  if found then
    if prior.contractor_id <> p_contractor or prior.action <> 'bind' or prior.attempt_id is distinct from p_attempt
      or prior.actor <> actor or prior.reason <> btrim(p_reason) then
      raise exception 'Access binding idempotency conflict';
    end if;
    return jsonb_build_object('contractor_id', prior.contractor_id, 'auth_user_id', prior.auth_user_id,
      'vendor_role_granted', prior.vendor_role_changed, 'recorded', false);
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 or length(btrim(coalesce(p_key, ''))) = 0 then
    raise exception 'Reason and idempotency key required';
  end if;
  select * into c from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  -- The receipt is the evidence. Another provider's receipt reads as missing.
  select * into receipt from private.r0_provider_access_acceptances r
   where r.attempt_id = p_attempt and r.contractor_id = p_contractor;
  if not found then raise exception 'Accepted access invitation required'; end if;
  select * into strict a from private.r0_provider_access_attempts where id = p_attempt for update;
  perform private.r0_access_provider_ready(p_contractor);
  select * into cur from private.r0_provider_current_contacts where contractor_id = p_contractor;
  if cur.contact_id is distinct from receipt.contact_id then
    raise exception 'Accepted invitation is for a superseded contact';
  end if;
  if a.status <> 'accepted' then raise exception 'Accepted access invitation required'; end if;
  if a.mode = 'new_account' then
    select * into strict d from private.r0_provider_access_dispatches where attempt_id = a.id;
    if d.auth_user_id is distinct from receipt.auth_user_id or d.recipient_email is distinct from cur.email then
      raise exception 'Account identity does not match the confirmed contact';
    end if;
  elsif a.existing_account_id is distinct from receipt.auth_user_id then
    raise exception 'Account identity does not match the confirmed contact';
  end if;
  -- Re-prove the account now, by ID.
  select * into target from auth.users where id = receipt.auth_user_id;
  if not found then raise exception 'Account identity not found'; end if;
  if target.email_confirmed_at is null then raise exception 'Confirmed account required'; end if;
  if lower(btrim(target.email)) is distinct from cur.email then
    raise exception 'Account identity does not match the confirmed contact';
  end if;
  if c.user_id is not null then
    if c.user_id = receipt.auth_user_id then raise exception 'Account already bound to this provider'; end if;
    raise exception 'Provider already has a linked account';
  end if;
  if exists (select 1 from public.contractors x where x.user_id = receipt.auth_user_id and x.id <> p_contractor) then
    raise exception 'Account already linked to another provider';
  end if;
  if exists (select 1 from private.r0_provider_access_attempts x
     where x.contractor_id = p_contractor and x.status in ('prepared', 'submitted', 'unknown')) then
    raise exception 'Close the live access invitation before binding an account';
  end if;
  begin
    update public.contractors set user_id = receipt.auth_user_id, updated_at = now() where id = p_contractor;
  exception when unique_violation then
    raise exception 'Account already linked to another provider';
  end;
  -- TRACE-068 timing change (owner decision 2026-09-30): portal access for profile
  -- setup follows a reviewed binding. Record whether this command added the role so a
  -- release never removes one the account held for another reason.
  insert into public.user_roles(user_id, role) values (receipt.auth_user_id, 'vendor')
    on conflict (user_id, role) do nothing;
  role_changed := found;
  begin
    insert into private.r0_provider_access_bindings(business_key, contractor_id, action, auth_user_id, attempt_id,
      contact_id, vendor_role_changed, actor, reason)
    values (p_key, p_contractor, 'bind', receipt.auth_user_id, p_attempt, receipt.contact_id, role_changed, actor, btrim(p_reason));
  exception when unique_violation then
    raise exception 'Access binding idempotency conflict';
  end;
  perform private.r0_access_log(p_contractor, p_attempt, 'account_bound', null, null,
    'Reviewed binding of account ' || receipt.auth_user_id
    || case when role_changed then '; vendor role granted for profile setup' else '; vendor role already held' end, actor);
  -- No compliance evidence, approval, eligibility, listing, matching or activation follows.
  return jsonb_build_object('contractor_id', p_contractor, 'auth_user_id', receipt.auth_user_id,
    'vendor_role_granted', role_changed, 'recorded', true);
end $$;

-- Correct a mis-binding. Only a link this path created, and never for an activated provider.
create function public.r0_release_provider_access(p_contractor uuid, p_reason text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; prior private.r0_provider_access_bindings; live private.r0_provider_access_bindings;
  c public.contractors; role_changed boolean := false;
begin
  actor := public.vendor_require_operator();
  select * into prior from private.r0_provider_access_bindings where business_key = p_key;
  if found then
    if prior.contractor_id <> p_contractor or prior.action <> 'release' or prior.actor <> actor
      or prior.reason <> btrim(p_reason) then
      raise exception 'Access binding idempotency conflict';
    end if;
    return jsonb_build_object('contractor_id', prior.contractor_id, 'auth_user_id', prior.auth_user_id,
      'vendor_role_removed', prior.vendor_role_changed, 'recorded', false);
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 or length(btrim(coalesce(p_key, ''))) = 0 then
    raise exception 'Reason and idempotency key required';
  end if;
  select * into c from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  live := private.r0_provider_access_binding(p_contractor);
  if c.user_id is null or live.action is distinct from 'bind' or live.auth_user_id <> c.user_id then
    raise exception 'No access binding to release';
  end if;
  if exists (select 1 from public.vendor_onboarding o where o.contractor_id = p_contractor and o.status = 'active') then
    raise exception 'Suspend an active provider before releasing its account';
  end if;
  update public.contractors set user_id = null, updated_at = now() where id = p_contractor;
  if live.vendor_role_changed and not exists (select 1 from public.contractors x where x.user_id = live.auth_user_id)
    and not exists (select 1 from public.vendor_role_decisions r where r.auth_user_id = live.auth_user_id and r.outcome = 'granted') then
    delete from public.user_roles where user_id = live.auth_user_id and role = 'vendor';
    role_changed := found;
  end if;
  insert into private.r0_provider_access_bindings(business_key, contractor_id, action, auth_user_id, attempt_id,
    contact_id, vendor_role_changed, actor, reason)
  values (p_key, p_contractor, 'release', live.auth_user_id, null, null, role_changed, actor, btrim(p_reason));
  perform private.r0_access_log(p_contractor, null, 'account_released', null, null,
    'Access binding of account ' || live.auth_user_id || ' released'
    || case when role_changed then '; vendor role removed' else '' end, actor);
  return jsonb_build_object('contractor_id', p_contractor, 'auth_user_id', live.auth_user_id,
    'vendor_role_removed', role_changed, 'recorded', true);
end $$;

-- Read-only operator readbacks --------------------------------------------------------

create function public.r0_provider_access_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.contractors; cur private.r0_provider_current_contacts; k private.r0_provider_contacts;
  a private.r0_provider_access_attempts; d private.r0_provider_access_dispatches;
  r private.r0_provider_access_acceptances; live private.r0_provider_access_bindings; u auth.users;
begin
  perform public.vendor_require_operator();
  select * into c from public.contractors where id = p_contractor;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  select * into cur from private.r0_provider_current_contacts where contractor_id = p_contractor;
  select * into k from private.r0_provider_contacts where id = cur.contact_id;
  select * into a from private.r0_provider_access_attempts where contractor_id = p_contractor
   order by (status in ('prepared', 'submitted', 'unknown')) desc, created_at desc, id desc limit 1;
  select * into d from private.r0_provider_access_dispatches where attempt_id = a.id;
  select * into r from private.r0_provider_access_acceptances where attempt_id = a.id;
  select * into u from auth.users where id = r.auth_user_id;
  live := private.r0_provider_access_binding(p_contractor);
  return jsonb_build_object(
    'contractor_id', c.id, 'name', c.name,
    'application_onboarding', exists (select 1 from public.vendor_onboarding o where o.contractor_id = c.id),
    'excluded', exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = c.id),
    'account_linked', c.user_id is not null,
    'linked_user_id', c.user_id,
    'bound_by_access', c.user_id is not null and live.action = 'bind' and live.auth_user_id = c.user_id,
    'vendor_role_held', c.user_id is not null and exists (select 1 from public.user_roles x
      where x.user_id = c.user_id and x.role = 'vendor'),
    'eligible', private.vendor_matching_eligible(c.id),
    'contact', case when k.id is null then null else jsonb_build_object('contact_id', k.id, 'email', k.email,
      'confirmation', k.confirmation, 'recorded_at', k.recorded_at) end,
    'attempt', case when a.id is null then null else jsonb_build_object(
      'attempt_id', a.id, 'mode', a.mode, 'status', a.status, 'expires_at', a.expires_at,
      'expired', a.expires_at <= now(), 'created_at', a.created_at,
      'live', a.status in ('prepared', 'submitted', 'unknown'),
      'existing_account_id', a.existing_account_id,
      'dispatch_state', d.state, 'dispatch_started_at', d.started_at, 'auth_user_id', d.auth_user_id,
      'refusal_code', d.refusal_code,
      'accepted', r.attempt_id is not null, 'accepted_at', r.accepted_at,
      'accepted_by', r.auth_user_id, 'accepted_account_confirmed', u.email_confirmed_at is not null,
      'for_current_contact', a.contact_id is not distinct from cur.contact_id) end,
    'prior_attempts', (select coalesce(jsonb_agg(jsonb_build_object('attempt_id', x.id, 'mode', x.mode,
        'status', x.status, 'expires_at', x.expires_at, 'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
      from private.r0_provider_access_attempts x where x.contractor_id = c.id and x.id is distinct from a.id),
    'bindings', (select coalesce(jsonb_agg(jsonb_build_object('action', b.action, 'auth_user_id', b.auth_user_id,
        'vendor_role_changed', b.vendor_role_changed, 'reason', b.reason, 'created_at', b.created_at)
        order by b.sequence desc), '[]'::jsonb)
      from private.r0_provider_access_bindings b where b.contractor_id = c.id));
end $$;

-- Every access-managed provider, for the recruiting page. Includes attempts that need
-- attention: unknown, refused, lapsed Auth link (3 h) or operator expiry without acceptance,
-- and accepted receipts awaiting a reviewed binding.
create function public.r0_provider_access_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.vendor_require_operator();
  select coalesce(jsonb_agg(item order by item->>'name'), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'contractor_id', c.id, 'name', c.name, 'email', cur.email,
      'account_linked', c.user_id is not null,
      'bound_by_access', c.user_id is not null and b.action = 'bind' and b.auth_user_id = c.user_id,
      'attempt_id', a.id, 'mode', a.mode, 'status', a.status, 'expires_at', a.expires_at,
      'dispatch_state', d.state, 'dispatch_started_at', d.started_at,
      'accepted', r.attempt_id is not null,
      'attention', case
        when a.id is null then null
        when a.status = 'unknown' or d.state in ('started', 'unknown') then 'uncertain'
        when a.status = 'failed' then 'refused'
        when a.status = 'accepted' and not (c.user_id is not null and b.action = 'bind' and b.auth_user_id = c.user_id)
          then 'awaiting_binding'
        when a.status in ('prepared', 'submitted') and a.expires_at <= now() then 'expired'
        when a.status = 'submitted' and d.state = 'provider_accepted' and d.resolved_at < now() - interval '3 hours'
          then 'link_lapsed'
      end) as item
    from private.r0_provider_current_contacts cur
    join public.contractors c on c.id = cur.contractor_id
    left join lateral (select * from private.r0_provider_access_attempts x where x.contractor_id = c.id
      order by (x.status in ('prepared', 'submitted', 'unknown')) desc, x.created_at desc, x.id desc limit 1) a on true
    left join private.r0_provider_access_dispatches d on d.attempt_id = a.id
    left join private.r0_provider_access_acceptances r on r.attempt_id = a.id
    left join lateral (select * from private.r0_provider_access_bindings y where y.contractor_id = c.id
      order by y.sequence desc limit 1) b on true
  ) q;
  return jsonb_build_object('checked_at', now(), 'items', rows);
end $$;

-- Interlocks ------------------------------------------------------------------------

-- Application onboarding cannot start for a provider while a live access attempt exists,
-- so the two identity paths never run at once.
create function private.r0_access_onboarding_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.r0_provider_access_attempts a
     where a.contractor_id = new.contractor_id and a.status in ('prepared', 'submitted', 'unknown')) then
    raise exception 'Close the live access invitation before starting application onboarding';
  end if;
  return new;
end $$;
create trigger r0_access_onboarding_guard before insert on public.vendor_onboarding
  for each row execute function private.r0_access_onboarding_guard();

-- Unchanged from 20260929003000 except the legacy branch: an access-managed provider is
-- not eligible on its legacy is_active flag. It needs onboarding or cutover evidence.
create or replace function private.vendor_matching_eligible(_contractor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = _contractor_id)
  and case when (select enforced from public.vendor_cutover_control where singleton)
    then exists(select 1 from public.vendor_cutover_decisions decision
      where decision.contractor_id=_contractor_id and decision.disposition='included')
      and public.vendor_is_eligible(_contractor_id)
      and public.vendor_category_evidence_current(_contractor_id,now())
    when exists(select 1 from public.vendor_onboarding onboarding where onboarding.contractor_id=_contractor_id)
      then public.vendor_is_eligible(_contractor_id)
    else exists(select 1 from public.contractors contractor
      where contractor.id=_contractor_id and contractor.is_active is true)
      and not private.r0_provider_access_managed(_contractor_id)
  end
$$;

-- Unchanged from 20260929003000 except 'setup_access': the vendor reached the portal
-- through a reviewed access binding and has no approval yet.
create or replace function public.r0_my_provider_listing()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.contractors; live private.r0_provider_access_bindings;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into c from public.contractors where user_id = auth.uid() order by created_at limit 1;
  if not found then return jsonb_build_object('linked', false); end if;
  live := private.r0_provider_access_binding(c.id);
  return jsonb_build_object(
    'linked', true, 'contractor_id', c.id,
    'listed', public.r0_provider_listable(c.id),
    'active', c.is_active is true,
    'accepting_work', c.marketing_enabled is not false,
    'approved', private.vendor_matching_eligible(c.id)
      and not exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = c.id),
    'held', exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = c.id),
    'setup_access', coalesce(live.action = 'bind' and live.auth_user_id = c.user_id
      and not private.vendor_matching_eligible(c.id), false),
    'has_name', length(btrim(coalesce(c.name, ''))) > 0,
    'has_description', length(btrim(coalesce(c.bio, ''))) > 0,
    'has_catalog_service', exists (select 1 from public.services_catalog s
      where s.is_active and s.id = any(coalesce(c.services, '{}'::text[]))),
    'service_zips', (select coalesce(jsonb_agg(z.zip_code order by z.zip_code), '[]'::jsonb)
      from public.contractor_service_zips z where z.contractor_id = c.id));
end $$;

-- Operator list of excluded (archived) providers for normal admin vendor lists.
create function public.r0_excluded_provider_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select x.contractor_id from private.r0_public_listing_exclusions x
   where public.has_role(auth.uid(), 'admin')
$$;

-- Privileges -----------------------------------------------------------------------

revoke all on function
  private.r0_access_log(uuid, uuid, text, text, text, text, uuid),
  private.r0_access_email_valid(text),
  private.r0_provider_access_managed(uuid),
  private.r0_provider_access_binding(uuid),
  private.r0_access_provider_ready(uuid),
  private.r0_access_recipient_account(uuid, text),
  private.r0_access_onboarding_guard(),
  private.vendor_matching_eligible(uuid),
  public.r0_record_provider_contact(uuid, text, text, text, text),
  public.r0_prepare_provider_access(uuid, text, timestamptz, uuid),
  public.r0_claim_provider_access(uuid),
  public.r0_finish_provider_access(uuid, uuid, uuid),
  public.r0_refuse_provider_access(uuid, text, uuid, uuid),
  public.r0_accept_provider_access(uuid),
  public.r0_close_provider_access(uuid, text, text),
  public.r0_provider_access_status(uuid),
  public.r0_bind_provider_access(uuid, uuid, text, text),
  public.r0_release_provider_access(uuid, text, text),
  public.r0_provider_access_overview(uuid),
  public.r0_provider_access_queue(),
  public.r0_my_provider_listing(),
  public.r0_excluded_provider_ids()
from public, anon, authenticated, service_role;
grant execute on function
  public.r0_record_provider_contact(uuid, text, text, text, text),
  public.r0_prepare_provider_access(uuid, text, timestamptz, uuid),
  public.r0_claim_provider_access(uuid),
  public.r0_accept_provider_access(uuid),
  public.r0_close_provider_access(uuid, text, text),
  public.r0_provider_access_status(uuid),
  public.r0_bind_provider_access(uuid, uuid, text, text),
  public.r0_release_provider_access(uuid, text, text),
  public.r0_provider_access_overview(uuid),
  public.r0_provider_access_queue(),
  public.r0_my_provider_listing(),
  public.r0_excluded_provider_ids()
to authenticated;
grant execute on function
  public.r0_finish_provider_access(uuid, uuid, uuid),
  public.r0_refuse_provider_access(uuid, text, uuid, uuid)
to service_role;
