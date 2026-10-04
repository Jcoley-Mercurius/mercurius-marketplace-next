-- TRACE-105: onboarding review for an access-bound existing provider (owner decision 2026-10-03).
--
-- R0.5 (20260930001000) gave existing providers reviewed profile-setup access and closed
-- their legacy is_active eligibility, but left "the compliance path for access-managed
-- providers (real application or cutover evidence)" open: TRACE-065 refuses application
-- review for an existing provider, so no onboarding row, checklist or activation could
-- follow. This closes it with a real application.
--
--   The provider submits the standard application (/vendors/apply) from the confirmed
--   contact address. An operator starts review for the existing provider record instead
--   of creating a new one: the application is linked to that provider and onboarding
--   review opens at revision 1 against the latest application version, exactly as
--   TRACE-065 does for a new applicant. Checklist, evidence, activation and listing are
--   unchanged.
--
-- No application is fabricated. No evidence, approval, role, listing, matching or
-- marketing change follows the start. The account and its vendor role stay as the
-- reviewed binding left them.

create function public.r0_start_existing_provider_review(p_application uuid, p_expected_version uuid,
  p_contractor uuid, p_reason text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; replay jsonb; app public.vendor_applications; started public.vendor_onboarding_review_starts;
  o public.vendor_onboarding; c public.contractors; live private.r0_provider_access_bindings;
  cur private.r0_provider_current_contacts; target auth.users;
begin
  actor := public.vendor_require_operator();
  -- Exact replays resolve before validation, as in TRACE-065.
  replay := private.vendor_review_start_replay(p_key, p_application, p_expected_version, p_reason, actor);
  if replay is not null then
    if (replay->>'contractor_id')::uuid is distinct from p_contractor then
      raise exception 'Onboarding review idempotency conflict';
    end if;
    return replay || jsonb_build_object('existing_provider', true);
  end if;
  select * into app from public.vendor_applications where id = p_application for update;
  if not found then raise exception 'Application not found'; end if;
  replay := private.vendor_review_start_replay(p_key, p_application, p_expected_version, p_reason, actor);
  if replay is not null then
    if (replay->>'contractor_id')::uuid is distinct from p_contractor then
      raise exception 'Onboarding review idempotency conflict';
    end if;
    return replay || jsonb_build_object('existing_provider', true);
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 or length(btrim(coalesce(p_key, ''))) = 0 then
    raise exception 'Reason and idempotency key required';
  end if;
  if app.status in ('rejected', 'abandoned') then raise exception 'Closed application cannot start onboarding'; end if;
  if p_expected_version is null or not exists (select 1 from public.vendor_application_versions v
     where v.id = p_expected_version and v.application_id = app.id
       and not exists (select 1 from public.vendor_application_versions newer
         where newer.application_id = app.id and newer.revision > v.revision)) then
    raise exception 'Latest application version required';
  end if;
  if exists (select 1 from public.vendor_onboarding_review_starts s where s.application_id = app.id) then
    raise exception 'Onboarding already exists';
  end if;
  if app.contractor_id is not null and app.contractor_id <> p_contractor then
    raise exception 'Application is linked to another provider';
  end if;

  select * into c from public.contractors where id = p_contractor for update;
  if not found then raise exception 'Provider not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.vendor_onboarding x where x.contractor_id = p_contractor) then
    raise exception 'Provider already has onboarding';
  end if;
  if exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = p_contractor) then
    raise exception 'Excluded provider cannot start onboarding';
  end if;
  if not private.r0_provider_access_managed(p_contractor) then
    raise exception 'Existing provider access contact required';
  end if;
  if exists (select 1 from private.r0_provider_access_attempts a
     where a.contractor_id = p_contractor and a.status in ('prepared', 'submitted', 'unknown')) then
    raise exception 'Close the live access invitation before starting application onboarding';
  end if;
  live := private.r0_provider_access_binding(p_contractor);
  if c.user_id is null or live.action is distinct from 'bind' or live.auth_user_id is distinct from c.user_id then
    raise exception 'Reviewed access binding required';
  end if;
  -- The application, the confirmed contact and the bound account must be one address.
  select * into cur from private.r0_provider_current_contacts where contractor_id = p_contractor;
  if lower(btrim(app.email)) is distinct from cur.email then
    raise exception 'Application email does not match the confirmed contact';
  end if;
  select * into target from auth.users where id = c.user_id;
  if not found or target.email_confirmed_at is null or lower(btrim(target.email)) is distinct from cur.email then
    raise exception 'Bound account does not match the confirmed contact';
  end if;

  update public.vendor_applications set contractor_id = p_contractor where id = app.id;
  insert into public.vendor_onboarding(contractor_id, application_version_id, revision, status)
    values (p_contractor, p_expected_version, 1, 'review');
  insert into public.vendor_onboarding_events(contractor_id, revision, action, before_status, after_status, actor, reason, business_key)
    values (p_contractor, 1, 'review_started', 'review', 'review', actor, btrim(p_reason), 'review-start:' || p_key);
  begin
    insert into public.vendor_onboarding_review_starts(business_key, application_id, expected_version_id, contractor_id, actor, reason)
      values (p_key, app.id, p_expected_version, p_contractor, actor, btrim(p_reason));
  exception when unique_violation then
    raise exception 'Onboarding review idempotency conflict';
  end;
  perform private.r0_access_log(p_contractor, null, 'onboarding_review_started', null, null,
    'Onboarding review started from application ' || app.id, actor);
  return jsonb_build_object('contractor_id', p_contractor, 'onboarding_status', 'review', 'onboarding_revision', 1,
    'created', true, 'existing_provider', true);
end $$;

-- An application from an access-managed provider's confirmed contact must not create a
-- second, new provider record through TRACE-065.
create function private.r0_review_start_existing_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare match uuid;
begin
  select cur.contractor_id into match
    from public.vendor_applications app
    join private.r0_provider_current_contacts cur on cur.email = lower(btrim(app.email))
   where app.id = new.application_id;
  if match is not null and match <> new.contractor_id then
    raise exception 'Application is from an existing provider; start review for that provider';
  end if;
  return new;
end $$;
create trigger r0_review_start_existing_guard before insert on public.vendor_onboarding_review_starts
  for each row execute function private.r0_review_start_existing_guard();

-- Unchanged from 20260911001000 except 'existing_provider': the access-managed provider
-- whose confirmed contact sent this application, and whether review can start for it.
create or replace function public.vendor_onboarding_intake_status(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare app public.vendor_applications; latest public.vendor_application_versions; o public.vendor_onboarding;
 cur private.r0_provider_current_contacts; c public.contractors; live private.r0_provider_access_bindings;
begin
 perform public.vendor_require_operator();
 select * into app from public.vendor_applications where id=p_application;
 if not found then raise exception 'Application not found'; end if;
 select * into latest from public.vendor_application_versions where application_id=app.id order by revision desc limit 1;
 select * into o from public.vendor_onboarding where contractor_id=app.contractor_id;
 select * into cur from private.r0_provider_current_contacts where email=lower(btrim(app.email));
 if found then
   select * into c from public.contractors where id=cur.contractor_id;
   live:=private.r0_provider_access_binding(c.id);
 end if;
 return jsonb_build_object('application_id',app.id,'application_status',app.status,
   'latest_version_id',latest.id,'latest_revision',latest.revision,'contractor_id',app.contractor_id,
   'onboarding_status',o.status,'onboarding_revision',o.revision,'onboarding_version_id',o.application_version_id,
   'review_started',exists(select 1 from public.vendor_onboarding_review_starts where application_id=app.id),
   'existing_provider',case when c.id is null then null else jsonb_build_object(
     'contractor_id',c.id,'name',c.name,
     'bound',c.user_id is not null and live.action='bind' and live.auth_user_id=c.user_id,
     'onboarding',exists(select 1 from public.vendor_onboarding x where x.contractor_id=c.id),
     'excluded',exists(select 1 from private.r0_public_listing_exclusions x where x.contractor_id=c.id),
     'live_attempt',exists(select 1 from private.r0_provider_access_attempts a
       where a.contractor_id=c.id and a.status in ('prepared','submitted','unknown'))) end);
end $$;

revoke all on function public.r0_start_existing_provider_review(uuid, uuid, uuid, text, text),
  private.r0_review_start_existing_guard(),
  public.vendor_onboarding_intake_status(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.r0_start_existing_provider_review(uuid, uuid, uuid, text, text),
  public.vendor_onboarding_intake_status(uuid)
to authenticated;
