-- TRACE-104 (R0.4): vendor/operator readiness for public recruiting.
--
-- 1. Owner-notification delivery ledger. Every saved vendor application gets a
--    delivery record in the same transaction as the application row, so a failed,
--    lost or uncertain Resend notification can never hide the application. The
--    route claims, sends and records; operators read back, request a resend or
--    acknowledge. A resend never creates an application, account, role or grant.
-- 2. Invitation attention readback over the existing TRACE-063/070/071 Auth
--    invitation records. Recovery stays in the existing invitation commands.
-- 3. Truthful public listing: a provider is public only when the existing matching
--    eligibility decision admits it, it carries real profile content, and no
--    operator has excluded it as a test, fake or duplicate record. Exclusion hides
--    and stops matching; it deletes nothing and preserves history.
--
-- No existing row is changed or deleted. No operator, exclusion or email is seeded.

-- 1. Owner-notification delivery ---------------------------------------------------

create table private.r0_application_notifications (
  application_id uuid primary key references public.vendor_applications(id) on delete cascade,
  state text not null default 'pending'
    check (state in ('pending','sending','sent','failed','unknown','resend_requested','acknowledged')),
  attempts integer not null default 0 check (attempts >= 0),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text check (length(provider_message_id) <= 200),
  last_error text check (length(last_error) <= 500),
  requested_by uuid references auth.users(id),
  requested_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  acknowledged_reason text check (length(acknowledged_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'sending') = (claim_id is not null)),
  check ((state = 'sent') = (sent_at is not null)),
  check ((state = 'acknowledged') = (acknowledged_at is not null))
);

-- Transition audit. It names no address; the application row is the source of contact data.
create table private.r0_application_notification_events (
  id bigint generated always as identity primary key,
  application_id uuid not null,
  previous_state text,
  state text not null,
  attempt integer not null,
  actor uuid,
  detail text check (length(detail) <= 500),
  created_at timestamptz not null default now()
);

alter table private.r0_application_notifications enable row level security;
alter table private.r0_application_notification_events enable row level security;
revoke all on private.r0_application_notifications, private.r0_application_notification_events
  from public, anon, authenticated, service_role;

-- A delivery record older than this without a claim or a result was lost by its sender.
create function private.r0_notification_stale_after() returns interval
language sql immutable set search_path = '' as $$ select interval '10 minutes' $$;

create function private.r0_notification_log(
  p_application uuid, p_previous text, p_state text, p_attempt integer, p_actor uuid, p_detail text
) returns void language sql security definer set search_path = '' as $$
  insert into private.r0_application_notification_events(application_id, previous_state, state, attempt, actor, detail)
  values (p_application, p_previous, p_state, p_attempt, p_actor, p_detail)
$$;

-- Provider error text is kept for the operator, without any address it may echo.
create function private.r0_notification_redact(p_text text) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(btrim(coalesce(p_text, '')),
    '[^[:space:]@<>"'',;:()]+@[^[:space:]@<>"'',;:()]+', '[address]', 'g'), 500), '')
$$;

create function private.r0_application_notification_create() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.r0_application_notifications(application_id) values (new.id)
  on conflict (application_id) do nothing;
  perform private.r0_notification_log(new.id, null, 'pending', 0, null, null);
  return new;
end $$;

create trigger r0_application_notification_create
  after insert on public.vendor_applications
  for each row execute function private.r0_application_notification_create();

-- The state an operator should act on. Applications saved before this migration have
-- no record: their notification outcome was never tracked.
create function private.r0_notification_view(p_application uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when n.state = 'pending' and n.created_at < now() - private.r0_notification_stale_after() then 'missed'
      when n.state = 'sending' and n.claimed_at < now() - private.r0_notification_stale_after() then 'unknown'
      else n.state end
    from private.r0_application_notifications n where n.application_id = p_application), 'untracked')
$$;

-- Service key only: the application route (mode `initial`) and the operator resend
-- route (mode `resend`). One caller wins; the rest learn the current state. The email
-- content comes from the saved application, never from the caller.
create function public.r0_claim_application_notification(p_application uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n private.r0_application_notifications; app public.vendor_applications; claim uuid;
begin
  if p_mode not in ('initial', 'resend') then raise exception 'Unknown notification claim mode'; end if;
  select * into n from private.r0_application_notifications where application_id = p_application for update;
  if not found then raise exception 'Notification record not found' using errcode = 'P0002'; end if;
  if (p_mode = 'initial' and n.state <> 'pending') or (p_mode = 'resend' and n.state <> 'resend_requested') then
    return jsonb_build_object('claimed', false, 'state', private.r0_notification_view(p_application));
  end if;
  select * into strict app from public.vendor_applications where id = p_application;
  claim := gen_random_uuid();
  update private.r0_application_notifications
     set state = 'sending', claim_id = claim, claimed_at = now(), attempts = attempts + 1, updated_at = now()
   where application_id = p_application;
  perform private.r0_notification_log(p_application, n.state, 'sending', n.attempts + 1, n.requested_by, p_mode);
  return jsonb_build_object(
    'claimed', true, 'claim_id', claim, 'attempt', n.attempts + 1,
    'application', jsonb_build_object(
      'id', app.id, 'created_at', app.created_at, 'business_name', app.business_name,
      'first_name', app.first_name, 'last_name', app.last_name, 'email', app.email,
      'phone', app.phone, 'primary_category', app.primary_category,
      'services', to_jsonb(coalesce(app.services, '{}'::text[])), 'service_areas', app.service_areas));
end $$;

create function public.r0_record_application_notification(
  p_application uuid, p_claim uuid, p_outcome text, p_provider_id text default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n private.r0_application_notifications; detail text;
begin
  if p_outcome not in ('sent', 'failed', 'unknown') then raise exception 'Unknown notification outcome'; end if;
  select * into n from private.r0_application_notifications where application_id = p_application for update;
  if not found or n.state <> 'sending' or n.claim_id is distinct from p_claim then
    raise exception 'Notification claim is not current' using errcode = '40001';
  end if;
  detail := private.r0_notification_redact(p_error);
  update private.r0_application_notifications
     set state = p_outcome, claim_id = null,
         sent_at = case when p_outcome = 'sent' then now() end,
         provider_message_id = case when p_outcome = 'sent' then left(nullif(btrim(p_provider_id), ''), 200) end,
         last_error = case when p_outcome = 'sent' then null else detail end,
         updated_at = now()
   where application_id = p_application;
  perform private.r0_notification_log(p_application, 'sending', p_outcome, n.attempts, null,
    case when p_outcome = 'sent' then null else detail end);
  return jsonb_build_object('state', p_outcome, 'attempt', n.attempts);
end $$;

-- Operator: allow one more send. A failed or never-claimed notification can resend
-- directly. An unknown or untracked one may already be in the inbox, so the operator
-- must confirm they checked before a possible duplicate owner email is allowed.
create function public.r0_request_application_notification_resend(
  p_application uuid, p_confirm_unknown boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; view_state text; attempt_count integer;
begin
  actor := public.vendor_require_operator();
  -- Serializes operator commands for one application.
  perform 1 from public.vendor_applications where id = p_application for no key update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  view_state := private.r0_notification_view(p_application);
  select coalesce(max(attempts), 0) into attempt_count
    from private.r0_application_notifications where application_id = p_application;
  if view_state = 'resend_requested' then
    return jsonb_build_object('state', 'resend_requested', 'attempt', attempt_count);
  end if;
  if view_state not in ('failed', 'missed', 'unknown', 'untracked') then
    raise exception 'This notification cannot be resent from %', view_state using errcode = '55000';
  end if;
  if view_state in ('unknown', 'untracked') and p_confirm_unknown is not true then
    raise exception 'Confirm the earlier email is not in the inbox before resending' using errcode = '55000';
  end if;
  insert into private.r0_application_notifications(application_id, state, requested_by, requested_at)
    values (p_application, 'resend_requested', actor, now())
  on conflict (application_id) do update
     set state = 'resend_requested', claim_id = null, requested_by = actor, requested_at = now(),
         acknowledged_at = null, acknowledged_by = null, acknowledged_reason = null, updated_at = now();
  perform private.r0_notification_log(p_application, view_state, 'resend_requested', attempt_count, actor, null);
  return jsonb_build_object('state', 'resend_requested', 'attempt', attempt_count);
end $$;

-- Operator: the application has been seen in the queue, so no further email is needed.
create function public.r0_acknowledge_application_notification(p_application uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; n private.r0_application_notifications; view_state text; reason text := btrim(coalesce(p_reason, ''));
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Acknowledgement reason required'; end if;
  if length(reason) > 500 then raise exception 'Acknowledgement reason too long'; end if;
  perform 1 from public.vendor_applications where id = p_application for no key update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  view_state := private.r0_notification_view(p_application);
  if view_state = 'acknowledged' then return jsonb_build_object('state', 'acknowledged'); end if;
  if view_state not in ('failed', 'missed', 'unknown', 'untracked', 'resend_requested') then
    raise exception 'This notification cannot be acknowledged from %', view_state using errcode = '55000';
  end if;
  insert into private.r0_application_notifications(application_id, state, acknowledged_by, acknowledged_at, acknowledged_reason)
    values (p_application, 'acknowledged', actor, now(), reason)
  on conflict (application_id) do update
     set state = 'acknowledged', claim_id = null, acknowledged_by = actor, acknowledged_at = now(),
         acknowledged_reason = reason, updated_at = now()
  returning * into n;
  perform private.r0_notification_log(p_application, view_state, 'acknowledged', n.attempts, actor, reason);
  return jsonb_build_object('state', 'acknowledged');
end $$;

create function public.r0_application_notification_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.vendor_require_operator();
  with items as (
    select a.id, a.business_name, a.status, a.created_at,
           private.r0_notification_view(a.id) as state,
           n.attempts, n.last_error, n.sent_at, n.requested_at, n.acknowledged_at, n.acknowledged_reason, n.updated_at
      from public.vendor_applications a
      left join private.r0_application_notifications n on n.application_id = a.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'application_id', id, 'business_name', business_name, 'application_status', status,
      'submitted_at', created_at, 'state', state, 'attempts', coalesce(attempts, 0),
      'last_error', last_error, 'sent_at', sent_at, 'requested_at', requested_at,
      'acknowledged_at', acknowledged_at, 'acknowledged_reason', acknowledged_reason, 'updated_at', updated_at,
      'needs_attention', state in ('failed', 'missed', 'unknown', 'resend_requested')
        or (state = 'untracked' and status = 'pending'))
    order by created_at desc), '[]'::jsonb) into rows
  from items;
  return jsonb_build_object('checked_at', now(), 'stale_after_minutes', 10, 'items', rows);
end $$;

-- 2. Invitation attention ------------------------------------------------------------

-- The newest attempt per provider that needs an operator: an uncertain Auth result, a
-- definite refusal, an expiry without acceptance, or a provider-accepted invitation whose
-- 3-hour email link (owner decision 2026-09-13) has lapsed without acceptance.
create function public.r0_invitation_attention()
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
               and d.resolved_at < now() - interval '3 hours' then 'link_lapsed'
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

-- 3. Truthful public listing ---------------------------------------------------------

create table private.r0_public_listing_exclusions (
  contractor_id uuid primary key references public.contractors(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  excluded_by uuid not null references auth.users(id),
  excluded_at timestamptz not null default now()
);
create table private.r0_public_listing_events (
  id bigint generated always as identity primary key,
  contractor_id uuid not null,
  excluded boolean not null,
  reason text not null,
  actor uuid not null,
  created_at timestamptz not null default now()
);
alter table private.r0_public_listing_exclusions enable row level security;
alter table private.r0_public_listing_events enable row level security;
revoke all on private.r0_public_listing_exclusions, private.r0_public_listing_events
  from public, anon, authenticated, service_role;

-- Real content: a business name, a description and at least one service in the active catalog.
create function private.r0_provider_has_content(p_contractor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.contractors c
     where c.id = p_contractor
       and length(btrim(coalesce(c.name, ''))) > 0
       and length(btrim(coalesce(c.bio, ''))) > 0
       and exists (select 1 from public.services_catalog s
                    where s.is_active and s.id = any(coalesce(c.services, '{}'::text[]))))
$$;

-- Matching and public pricing already consume this decision; an excluded test or fake
-- record must not receive offers either. The rest of the TRACE-061 body is unchanged.
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
  end
$$;

create function public.r0_provider_listable(p_contractor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contractors c
                  where c.id = p_contractor and c.is_active is true and c.marketing_enabled is not false)
     and private.r0_provider_has_content(p_contractor)
     and private.vendor_matching_eligible(p_contractor)
$$;

-- Public directory and profile projection. Contact fields, payout state and operator
-- decisions are never returned.
create function public.r0_public_providers(p_contractor uuid default null)
returns table (
  id uuid, name text, logo_url text, bio text, location text, badges text[], services text[],
  years_experience integer, special_offer text, our_promise text, verified_specialty text, tagline text,
  video_url text, website text
) language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.logo_url, c.bio, c.location, c.badges, c.services, c.years_experience,
         c.special_offer, c.our_promise, c.verified_specialty, c.tagline, c.video_url, c.website
    from public.contractors c
   where (p_contractor is null or c.id = p_contractor)
     and public.r0_provider_listable(c.id)
   order by c.name
$$;

-- Anonymous table reads follow the same rule. Signed-in reads keep the existing active
-- rule so homeowners and vendors still see providers on their own history.
drop policy if exists "Anyone can view active contractors" on public.contractors;
create policy "Anyone can view listed contractors" on public.contractors
  for select to anon using (public.r0_provider_listable(id));
create policy "Signed-in users can view active contractors" on public.contractors
  for select to authenticated using (is_active = true);

create function public.r0_set_public_listing_exclusion(p_contractor uuid, p_excluded boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; reason text := btrim(coalesce(p_reason, ''));
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Exclusion reason required'; end if;
  if length(reason) > 500 then raise exception 'Exclusion reason too long'; end if;
  perform 1 from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  if p_excluded then
    insert into private.r0_public_listing_exclusions(contractor_id, reason, excluded_by)
      values (p_contractor, reason, actor) on conflict (contractor_id) do nothing;
    if not found then return jsonb_build_object('excluded', true, 'changed', false); end if;
  else
    delete from private.r0_public_listing_exclusions where contractor_id = p_contractor;
    if not found then return jsonb_build_object('excluded', false, 'changed', false); end if;
  end if;
  insert into private.r0_public_listing_events(contractor_id, excluded, reason, actor)
    values (p_contractor, p_excluded, reason, actor);
  return jsonb_build_object('excluded', p_excluded, 'changed', true);
end $$;

-- Operator cleanup inventory: why each provider is or is not public, what history it
-- holds, and a name/email pattern signal for suspected test records. The signal is a
-- prompt for review, never an automatic exclusion.
create function public.r0_public_listing_inventory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb;
begin
  perform public.vendor_require_operator();
  select coalesce(jsonb_agg(jsonb_build_object(
      'contractor_id', c.id, 'name', c.name, 'is_active', c.is_active,
      'marketing_enabled', c.marketing_enabled, 'account_linked', c.user_id is not null,
      'onboarding_status', o.status, 'eligible', private.vendor_matching_eligible(c.id),
      'has_content', private.r0_provider_has_content(c.id),
      'listable', public.r0_provider_listable(c.id),
      'excluded', x.contractor_id is not null, 'exclusion_reason', x.reason, 'excluded_at', x.excluded_at,
      'test_signal', coalesce(c.name, '') ~* '\m(test|demo|fake|sample|example|dummy|placeholder|lorem)\M'
        or coalesce(c.email, '') ~* '(@example\.(com|org|net)$|\mtest\M|\mfake\M)',
      'featured', exists (select 1 from public.featured_providers f where f.contractor_id = c.id and f.is_active),
      'request_count', (select count(*) from public.service_requests r where r.contractor_id = c.id),
      'invoice_count', (select count(*) from public.invoices i where i.contractor_id = c.id),
      'review_count', (select count(*) from public.reviews v where v.contractor_id = c.id))
    order by c.name), '[]'::jsonb) into rows
  from public.contractors c
  left join public.vendor_onboarding o on o.contractor_id = c.id
  left join private.r0_public_listing_exclusions x on x.contractor_id = c.id;
  return jsonb_build_object('checked_at', now(), 'items', rows);
end $$;

-- A vendor reads its own listing readiness. Operator reasons and identities stay private.
create function public.r0_my_provider_listing()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.contractors;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into c from public.contractors where user_id = auth.uid() order by created_at limit 1;
  if not found then return jsonb_build_object('linked', false); end if;
  return jsonb_build_object(
    'linked', true, 'contractor_id', c.id,
    'listed', public.r0_provider_listable(c.id),
    'active', c.is_active is true,
    'accepting_work', c.marketing_enabled is not false,
    'approved', private.vendor_matching_eligible(c.id)
      and not exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = c.id),
    'held', exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = c.id),
    'has_name', length(btrim(coalesce(c.name, ''))) > 0,
    'has_description', length(btrim(coalesce(c.bio, ''))) > 0,
    'has_catalog_service', exists (select 1 from public.services_catalog s
      where s.is_active and s.id = any(coalesce(c.services, '{}'::text[]))),
    'service_zips', (select coalesce(jsonb_agg(z.zip_code order by z.zip_code), '[]'::jsonb)
      from public.contractor_service_zips z where z.contractor_id = c.id));
end $$;

-- Privileges -------------------------------------------------------------------------

revoke all on function
  private.r0_notification_stale_after(),
  private.r0_notification_log(uuid, text, text, integer, uuid, text),
  private.r0_notification_redact(text),
  private.r0_application_notification_create(),
  private.r0_notification_view(uuid),
  private.r0_provider_has_content(uuid),
  public.r0_claim_application_notification(uuid, text),
  public.r0_record_application_notification(uuid, uuid, text, text, text),
  public.r0_request_application_notification_resend(uuid, boolean),
  public.r0_acknowledge_application_notification(uuid, text),
  public.r0_application_notification_overview(),
  public.r0_invitation_attention(),
  public.r0_provider_listable(uuid),
  public.r0_public_providers(uuid),
  public.r0_set_public_listing_exclusion(uuid, boolean, text),
  public.r0_public_listing_inventory(),
  public.r0_my_provider_listing()
from public, anon, authenticated, service_role;
revoke all on function private.vendor_matching_eligible(uuid) from public, anon, authenticated, service_role;

grant execute on function
  public.r0_claim_application_notification(uuid, text),
  public.r0_record_application_notification(uuid, uuid, text, text, text)
to service_role;
grant execute on function
  public.r0_request_application_notification_resend(uuid, boolean),
  public.r0_acknowledge_application_notification(uuid, text),
  public.r0_application_notification_overview(),
  public.r0_invitation_attention(),
  public.r0_set_public_listing_exclusion(uuid, boolean, text),
  public.r0_public_listing_inventory(),
  public.r0_my_provider_listing()
to authenticated;
grant execute on function public.r0_provider_listable(uuid), public.r0_public_providers(uuid)
to anon, authenticated;
