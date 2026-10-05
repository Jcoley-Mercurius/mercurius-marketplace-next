-- TRACE-105: onboarding review for the eight legacy providers without an application
-- (owner decision 2026-10-04, DEC-2026-027).
--
-- Eight providers listed before the rebuilt onboarding were given profile-setup access
-- (R0.5, 20260930001000) and are access-managed, so their legacy is_active eligibility
-- is closed. 20261003001000 opened review for them only through a real application from
-- the confirmed contact. Josh holds their compliance documents and signed agreements
-- outside the platform and directed that these eight, and only these eight, start
-- review without applying. Every other provider applies.
--
--   The closed list is recorded here once, by exact business name, for providers that
--   are access-managed and have no onboarding. No command adds to it.
--   An operator starts review on the provider record: an operator application record is
--   written from the existing profile and the confirmed contact (marked as such, never
--   presented as the provider's submission), and onboarding review opens at revision 1
--   against its version, as TRACE-065 does for an applicant.
--
-- The MPS §8 checklist, evidence, activation and listing rules are unchanged: the
-- operator records each checklist item against the documents held, then activates.
-- No evidence, approval, role, listing, matching, marketing or email follows the start,
-- and no new-application notification is raised for the operator record.

create table private.r0_legacy_review_providers (
  contractor_id uuid primary key references public.contractors(id),
  listed_at timestamptz not null default now(),
  application_id uuid unique references public.vendor_applications(id),
  business_key text unique check (length(btrim(business_key)) > 0),
  reason text check (length(btrim(reason)) between 1 and 500),
  started_by uuid references auth.users(id),
  started_at timestamptz,
  check ((application_id is null) = (business_key is null)
    and (application_id is null) = (reason is null)
    and (application_id is null) = (started_by is null)
    and (application_id is null) = (started_at is null))
);
revoke all on private.r0_legacy_review_providers from public, anon, authenticated, service_role;

do $$
declare listed integer;
begin
  insert into private.r0_legacy_review_providers(contractor_id)
  select c.id from public.contractors c
   where lower(btrim(c.name)) in ('all surface pressure cleaning & sealing', 'flash handyman service',
       'garden of eden lawn service', 'maritzas cleaning services', 'p & p cleaning solutions',
       'sparkling squeegees window cleaning', 'spiffy clean canz', 'tdj construction')
     and private.r0_provider_access_managed(c.id)
     and not exists (select 1 from public.vendor_onboarding o where o.contractor_id = c.id);
  get diagnostics listed = row_count;
  raise notice 'Legacy review list: % of 8 providers recorded', listed;
end $$;

-- Set for the operator record's insert only (transaction-local), so it raises no
-- new-application notice and no owner notification record.
create function private.r0_legacy_intake_active() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('mercurius.legacy_review_intake', true), '') = 'on'
$$;

-- Unchanged from 20260731165143 except the operator-record guard.
create or replace function public.notify_admins_new_vendor_application()
returns trigger language plpgsql security definer set search_path = public as $$
declare admin_id uuid;
begin
  if private.r0_legacy_intake_active() then return new; end if;
  for admin_id in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify_user(
      admin_id, 'vendor_application', 'warning',
      'New vendor application',
      new.business_name || ' applied' ||
        case when new.primary_category is not null then ' (' || new.primary_category || ')' else '' end ||
        '. Review and send a login invite.',
      '/admin/applications', null, null);
  end loop;
  return new;
end $$;

-- Unchanged from 20260929003000 except the operator-record guard: the record stays
-- untracked, since no provider submission or owner email exists for it.
create or replace function private.r0_application_notification_create() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.r0_legacy_intake_active() then return new; end if;
  insert into private.r0_application_notifications(application_id) values (new.id)
  on conflict (application_id) do nothing;
  perform private.r0_notification_log(new.id, null, 'pending', 0, null, null);
  return new;
end $$;

create function public.r0_start_legacy_provider_review(p_contractor uuid, p_reason text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; legacy private.r0_legacy_review_providers; c public.contractors;
  cur private.r0_provider_current_contacts; app_id uuid; version_id uuid;
begin
  actor := public.vendor_require_operator();
  select * into legacy from private.r0_legacy_review_providers where contractor_id = p_contractor for update;
  if not found then raise exception 'Provider is not on the legacy review list'; end if;
  if legacy.business_key is not null then
    if legacy.business_key = p_key and legacy.started_by = actor and legacy.reason = btrim(p_reason) then
      return jsonb_build_object('contractor_id', p_contractor, 'application_id', legacy.application_id,
        'onboarding_status', 'review', 'onboarding_revision', 1, 'created', false);
    end if;
    raise exception 'Legacy review already started';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 or length(btrim(coalesce(p_key, ''))) = 0 then
    raise exception 'Reason and idempotency key required';
  end if;
  if length(btrim(p_reason)) > 500 then raise exception 'Reason is too long'; end if;

  select * into c from public.contractors where id = p_contractor for update;
  if exists (select 1 from public.vendor_onboarding x where x.contractor_id = p_contractor) then
    raise exception 'Provider already has onboarding';
  end if;
  if exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = p_contractor) then
    raise exception 'Excluded provider cannot start onboarding';
  end if;
  if exists (select 1 from private.r0_provider_access_attempts a
     where a.contractor_id = p_contractor and a.status in ('prepared', 'submitted', 'unknown')) then
    raise exception 'Close the live access invitation before starting application onboarding';
  end if;
  select * into cur from private.r0_provider_current_contacts where contractor_id = p_contractor;
  if not found then raise exception 'Confirmed contact required'; end if;
  if exists (select 1 from public.vendor_applications a
     where a.contractor_id = p_contractor and a.status not in ('rejected', 'abandoned')) then
    raise exception 'Provider has an open application; start review from it';
  end if;

  perform set_config('mercurius.legacy_review_intake', 'on', true);
  insert into public.vendor_applications(business_name, first_name, last_name, email, phone, address,
      years_experience, services, business_description, website, additional_notes, status, contractor_id)
    values (c.name, 'Legacy provider', '(operator record)', cur.email, coalesce(c.phone, ''), '',
      coalesce(c.years_experience, 0), coalesce(c.services, '{}'), c.bio, c.website,
      'Operator record for legacy provider review (DEC-2026-027). Not submitted by the provider; '
        || 'compliance documents are held by the operator.',
      'pending', p_contractor)
    returning id into app_id;
  perform set_config('mercurius.legacy_review_intake', 'off', true);
  select v.id into strict version_id from public.vendor_application_versions v
   where v.application_id = app_id and v.revision = 1;

  insert into public.vendor_onboarding(contractor_id, application_version_id, revision, status)
    values (p_contractor, version_id, 1, 'review');
  insert into public.vendor_onboarding_events(contractor_id, revision, action, before_status, after_status, actor, reason, business_key)
    values (p_contractor, 1, 'review_started', 'review', 'review', actor, btrim(p_reason), 'legacy-review-start:' || p_key);
  insert into public.vendor_onboarding_review_starts(business_key, application_id, expected_version_id, contractor_id, actor, reason)
    values ('legacy:' || p_key, app_id, version_id, p_contractor, actor, btrim(p_reason));
  update private.r0_legacy_review_providers
     set application_id = app_id, business_key = p_key, reason = btrim(p_reason), started_by = actor, started_at = now()
   where contractor_id = p_contractor;
  perform private.r0_access_log(p_contractor, null, 'onboarding_review_started', null, null,
    'Legacy onboarding review started (DEC-2026-027); operator record ' || app_id, actor);
  return jsonb_build_object('contractor_id', p_contractor, 'application_id', app_id,
    'onboarding_status', 'review', 'onboarding_revision', 1, 'created', true);
end $$;

-- Whether the vendor page should offer the legacy start, and why not when it cannot.
create function public.r0_legacy_review_status(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare legacy private.r0_legacy_review_providers;
begin
  perform public.vendor_require_operator();
  select * into legacy from private.r0_legacy_review_providers where contractor_id = p_contractor;
  if not found then return jsonb_build_object('listed', false); end if;
  return jsonb_build_object('listed', true,
    'started', legacy.application_id is not null,
    'onboarding', exists (select 1 from public.vendor_onboarding o where o.contractor_id = p_contractor),
    'contact', exists (select 1 from private.r0_provider_current_contacts x where x.contractor_id = p_contractor),
    'excluded', exists (select 1 from private.r0_public_listing_exclusions x where x.contractor_id = p_contractor),
    'live_attempt', exists (select 1 from private.r0_provider_access_attempts a
       where a.contractor_id = p_contractor and a.status in ('prepared', 'submitted', 'unknown')),
    'open_application', exists (select 1 from public.vendor_applications a
       where a.contractor_id = p_contractor and a.status not in ('rejected', 'abandoned')));
end $$;

revoke all on function private.r0_legacy_intake_active(),
  public.r0_start_legacy_provider_review(uuid, text, text),
  public.r0_legacy_review_status(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.r0_start_legacy_provider_review(uuid, text, text),
  public.r0_legacy_review_status(uuid)
to authenticated;

-- Documents for a started legacy review. The checklist accepts license and insurance
-- only from the application or a TRACE-073 document submission, and the operator record
-- carries no application documents. An operator may therefore upload the documents
-- held for a listed legacy provider while its review is open, through the existing
-- operator upload; the provider itself still submits only once active or suspended.
create function private.r0_legacy_review_open(p_contractor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.r0_legacy_review_providers l
                   join public.vendor_onboarding o on o.contractor_id = l.contractor_id
                  where l.contractor_id = p_contractor and l.application_id is not null and o.status = 'review')
$$;

-- Unchanged from 20260915001000 except the legacy review branch.
create or replace function private.vendor_renewal_submitter(p_contractor uuid)
returns table(contractor_id uuid,actor uuid,submitted_as text)
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=auth.uid(); resolved uuid; role_value text; status_value text;
begin
 if caller is null then raise exception 'Renewal document submitter required' using errcode='42501'; end if;
 if p_contractor is not null then
   if not public.has_role(caller,'admin') then raise exception 'Onboarding operator required' using errcode='42501'; end if;
   resolved:=p_contractor; role_value:='operator';
 else
   if not public.has_role(caller,'vendor') then raise exception 'Vendor account required' using errcode='42501'; end if;
   select c.id into resolved from public.contractors c where c.user_id=caller;
   if resolved is null then raise exception 'Linked provider required' using errcode='42501'; end if;
   role_value:='provider';
 end if;
 select o.status into status_value from public.vendor_onboarding o where o.contractor_id=resolved;
 if (status_value is null or status_value not in ('active','suspended'))
   and not (role_value='operator' and private.r0_legacy_review_open(resolved)) then
   raise exception 'Renewal documents are accepted only for active or suspended providers';
 end if;
 return query select resolved,caller,role_value;
end $$;

-- Unchanged from 20260915002000 except 'operator_upload': whether the operator upload
-- applies (active, suspended, or an open legacy review).
create or replace function public.vendor_renewal_document_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',(select o.status from public.vendor_onboarding o where o.contractor_id=p_contractor),
  'operator_upload',coalesce((select o.status in ('active','suspended') from public.vendor_onboarding o where o.contractor_id=p_contractor),false)
    or private.r0_legacy_review_open(p_contractor),
  'open_limit',private.vendor_renewal_open_limit(),
  'retention_hold',(select jsonb_build_object('reason',h.reason,'placed_at',h.placed_at) from private.vendor_retention_hold(p_contractor) h),
  'documents',coalesce((select jsonb_agg(private.vendor_renewal_document_json(d,true) || coalesce(private.vendor_renewal_retention_json(d),'{}'::jsonb)
      order by d.created_at desc,d.id)
    from public.vendor_renewal_documents d where d.contractor_id=p_contractor),'[]'::jsonb));
end $$;

revoke all on function private.r0_legacy_review_open(uuid) from public, anon, authenticated, service_role;
