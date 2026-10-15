-- DEC-2026-029 follow-up (owner, 2026-10-13): the provider invitation email carries a
-- Mercurius link that stays valid until the invitation expires, instead of the Auth link,
-- which hosted Auth caps at 24 hours. See governance/PHASE-5-INVITATION-OPEN-LINK.md.
--
-- vendor-invite generates a random key per dispatched attempt, records only its SHA-256
-- here, and passes the key to the invite template. /api/invitations/open checks the key
-- against a live attempt and mints a fresh single-use Auth sign-in. Acceptance itself is
-- unchanged and still enforces every invitation, application and identity rule.

create table private.provider_invitation_open_keys (
  source text not null check (source in ('application', 'existing_provider')),
  attempt_id uuid not null,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (source, attempt_id)
);
create table private.provider_invitation_opens (
  id bigint generated always as identity primary key,
  source text not null,
  attempt_id uuid not null,
  opened_at timestamptz not null default now(),
  foreign key (source, attempt_id) references private.provider_invitation_open_keys(source, attempt_id)
);
create index provider_invitation_opens_recent on private.provider_invitation_opens(source, attempt_id, opened_at);
alter table private.provider_invitation_open_keys enable row level security;
alter table private.provider_invitation_opens enable row level security;
revoke all on private.provider_invitation_open_keys, private.provider_invitation_opens
  from public, anon, authenticated, service_role;

-- How many sign-ins one invitation link may mint per rolling hour.
create function private.provider_invitation_open_limit() returns integer
language sql immutable set search_path = '' as $$ select 10 $$;

-- Records the key for a reserved dispatch, once. Called by vendor-invite after its claim
-- and before Auth sends anything, so only the claiming request can set it.
create function public.provider_invitation_set_open_key(p_source text, p_attempt uuid, p_key_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare dispatch_state text;
begin
  if p_source is null or p_source not in ('application', 'existing_provider') or p_attempt is null
    or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation open key' using errcode = '22023';
  end if;
  if p_source = 'application' then
    select d.state into dispatch_state from public.vendor_invitation_dispatches d
     where d.attempt_id = p_attempt for update;
  else
    select d.state into dispatch_state from private.r0_provider_access_dispatches d
     where d.attempt_id = p_attempt for update;
  end if;
  if dispatch_state is distinct from 'started' then
    raise exception 'An open key needs a reserved, unsent dispatch' using errcode = 'P0001';
  end if;
  -- The primary key refuses a second key for the same attempt.
  insert into private.provider_invitation_open_keys(source, attempt_id, key_hash)
    values (p_source, p_attempt, p_key_hash);
end $$;

-- Checks an invitation link and, when it may be used, records the open and returns the
-- recipient's Auth user. Every refusal raises the same message, so a caller cannot tell a
-- wrong key from a closed, accepted or expired invitation.
create function public.provider_invitation_open(p_source text, p_attempt uuid, p_key_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k private.provider_invitation_open_keys; attempt_status text; expires timestamptz;
  dispatch_state text; recipient uuid; recipient_email text; recent integer;
begin
  if p_source is null or p_source not in ('application', 'existing_provider') or p_attempt is null
    or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation link not valid' using errcode = 'P0001';
  end if;
  -- The key row lock serializes opens of one link, so the hourly limit holds under races.
  select * into k from private.provider_invitation_open_keys
   where source = p_source and attempt_id = p_attempt for update;
  if not found or k.key_hash <> p_key_hash then
    raise exception 'Invitation link not valid' using errcode = 'P0001';
  end if;
  if p_source = 'application' then
    select a.status, a.expires_at, d.state, d.auth_user_id, d.recipient_email
      into attempt_status, expires, dispatch_state, recipient, recipient_email
      from public.vendor_invitation_attempts a
      join public.vendor_invitation_dispatches d on d.attempt_id = a.id
     where a.id = p_attempt;
  else
    select a.status, a.expires_at, d.state, d.auth_user_id, d.recipient_email
      into attempt_status, expires, dispatch_state, recipient, recipient_email
      from private.r0_provider_access_attempts a
      join private.r0_provider_access_dispatches d on d.attempt_id = a.id
     where a.id = p_attempt;
  end if;
  if attempt_status is distinct from 'submitted' or dispatch_state is distinct from 'provider_accepted'
    or expires is null or expires <= now() or recipient is null
    or not exists (select 1 from auth.users u where u.id = recipient
                    and lower(btrim(u.email)) = lower(btrim(recipient_email))) then
    raise exception 'Invitation link not valid' using errcode = 'P0001';
  end if;
  select count(*) into recent from private.provider_invitation_opens o
   where o.source = p_source and o.attempt_id = p_attempt and o.opened_at > now() - interval '1 hour';
  if recent >= private.provider_invitation_open_limit() then
    raise exception 'Invitation link not valid' using errcode = 'P0001',
      detail = 'open_limit';
  end if;
  insert into private.provider_invitation_opens(source, attempt_id) values (p_source, p_attempt);
  return jsonb_build_object('auth_user_id', recipient, 'email', lower(btrim(recipient_email)));
end $$;

revoke all on function
  private.provider_invitation_open_limit(),
  public.provider_invitation_set_open_key(text, uuid, text),
  public.provider_invitation_open(text, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.provider_invitation_set_open_key(text, uuid, text),
  public.provider_invitation_open(text, uuid, text)
to service_role;

-- A lapsed Auth link no longer needs an operator when the email carried an open link,
-- which lives as long as the invitation. Each body is otherwise unchanged from
-- migration 20261013001000.
create or replace function public.r0_invitation_attention()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.vendor_require_operator();
  with latest as (
    select distinct on (a.contractor_id) a.*
      from public.vendor_invitation_attempts a
     order by a.contractor_id, a.created_at desc, a.id desc
  ), classified as (
    select l.id, l.contractor_id, l.status, l.expires_at, l.created_at, d.state as dispatch_state,
           c.name as business_name, v.application_id, o.status as onboarding_status,
           case
             when l.status = 'unknown'
               or (l.status = 'submitted' and d.state = 'started' and d.started_at < now() - interval '10 minutes')
               then 'uncertain'
             when l.status = 'failed' then 'refused'
             when l.status in ('prepared', 'submitted') and l.expires_at <= now() then 'expired_unaccepted'
             when l.status = 'submitted' and d.state = 'provider_accepted'
               and d.resolved_at < now() - private.provider_invitation_link_lifetime()
               and not exists (select 1 from private.provider_invitation_open_keys k
                                where k.source = 'application' and k.attempt_id = l.id) then 'link_lapsed'
           end as reason
      from latest l
      join public.contractors c on c.id = l.contractor_id
      join public.vendor_onboarding o on o.contractor_id = l.contractor_id
      join public.vendor_application_versions v on v.id = l.application_version_id
      left join public.vendor_invitation_dispatches d on d.attempt_id = l.id
     where o.status <> 'rejected'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'attempt_id', id, 'contractor_id', contractor_id, 'application_id', application_id,
      'business_name', business_name, 'attempt_status', status, 'dispatch_state', dispatch_state,
      'onboarding_status', onboarding_status, 'created_at', created_at, 'expires_at', expires_at,
      'reason', reason) order by created_at desc), '[]'::jsonb) into rows
  from classified where reason is not null;
  return jsonb_build_object('checked_at', now(), 'items', rows);
end $$;

create or replace function public.r0_provider_access_queue()
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
        when a.status = 'submitted' and d.state = 'provider_accepted' and d.resolved_at < now() - private.provider_invitation_link_lifetime()
          and not exists (select 1 from private.provider_invitation_open_keys k
                          where k.source = 'existing_provider' and k.attempt_id = a.id)
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
