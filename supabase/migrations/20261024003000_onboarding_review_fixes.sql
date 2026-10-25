-- TRACE-122 (DEC-2026-047): vendor onboarding review, 2026-10-24. Additive: new private tables,
-- guards and functions; three functions restated with one change each. The only data written
-- is a copy of existing provider notes into the internal notes table; no package, revision,
-- request or evidence row is changed.
--
-- 1. Internal notes (item 1). A package's notes are Mercurius-internal and never shown to
--    homeowners. They are kept outside the revision content: package_revision_hash covers
--    vendor_packages.policy_notes, and submitted requests are bound to that hash, so notes on
--    a live revision cannot change in place. Notes now belong to the package lineage (or to
--    an unpublished new draft until it is published) and are edited without a new revision,
--    a republish or a vendor notice. Existing notes are copied; the column keeps its values
--    for the existing revisions (their hashes) and is left empty on new ones.
-- 2. Archive (item 3). An operator archives a paused or replaced package: hidden from Vendor
--    Prices, kept with its archive record, never turned back on, no vendor notice.
-- 3. Checklist exception (item 5). An operator marks licensing or insurance current while the
--    document is pending, with a reason, an approver and a follow-up due date. It is recorded
--    as evidence that expires at the end of the follow-up date (America/New_York), so it
--    lapses like any expired evidence unless the document is recorded first.

-- 1. Internal notes ---------------------------------------------------------------------------

create table private.package_internal_notes (
  subject_id uuid primary key,
  subject_kind text not null check (subject_kind in ('lineage', 'draft')),
  contractor_id uuid not null,
  notes text not null check (length(btrim(notes)) between 1 and 2000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index package_internal_notes_contractor_idx on private.package_internal_notes(contractor_id);
alter table private.package_internal_notes enable row level security;
revoke all on private.package_internal_notes from public, anon, authenticated, service_role;

create table private.package_internal_note_events (
  id bigint generated always as identity primary key,
  subject_id uuid not null,
  contractor_id uuid not null,
  notes text,
  actor uuid not null,
  created_at timestamptz not null default now()
);
alter table private.package_internal_note_events enable row level security;
revoke all on private.package_internal_note_events from public, anon, authenticated, service_role;

comment on column public.vendor_packages.policy_notes is
  'Legacy provider notes of existing revisions (part of their revision hash). Not shown to homeowners; internal notes live in private.package_internal_notes (TRACE-122).';

-- Copy: the active revision's notes, else the latest revision's; then open drafts' notes
-- where their package has none.
insert into private.package_internal_notes(subject_id, subject_kind, contractor_id, notes, updated_at)
select distinct on (p.lineage_id) p.lineage_id, 'lineage', p.contractor_id, btrim(p.policy_notes), p.updated_at
  from public.vendor_packages p
 where nullif(btrim(p.policy_notes), '') is not null
 order by p.lineage_id, p.is_active desc, p.revision_number desc;
insert into private.package_internal_notes(subject_id, subject_kind, contractor_id, notes, updated_at)
select coalesce(t.lineage_id, d.id), case when t.lineage_id is null then 'draft' else 'lineage' end,
       d.contractor_id, btrim(d.content ->> 'policy_notes'), d.updated_at
  from private.operator_package_drafts d
  left join public.vendor_packages t on t.id = d.target_package_id
 where d.status = 'draft' and nullif(btrim(d.content ->> 'policy_notes'), '') is not null
on conflict (subject_id) do nothing;

-- Sets or clears the internal notes of a package (its lineage) or of an open draft (a
-- replacement draft shares its package's notes). No revision, republish or vendor notice.
create function public.admin_set_package_internal_notes(p_package uuid default null, p_draft uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
  draft private.operator_package_drafts;
  subject uuid;
  kind text := 'lineage';
  contractor uuid;
begin
  if (p_package is null) = (p_draft is null) then raise exception 'Choose a package or a draft' using errcode = '22023'; end if;
  if length(notes) > 2000 then raise exception 'Internal notes too long' using errcode = '22023'; end if;
  if p_package is not null then
    select p.lineage_id, p.contractor_id into subject, contractor from public.vendor_packages p where p.id = p_package;
    if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  else
    select * into draft from private.operator_package_drafts d where d.id = p_draft;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
    if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
    contractor := draft.contractor_id;
    select p.lineage_id into subject from public.vendor_packages p where p.id = draft.target_package_id;
    if subject is null then subject := draft.id; kind := 'draft'; end if;
  end if;
  if notes is null then
    delete from private.package_internal_notes n where n.subject_id = subject;
  else
    insert into private.package_internal_notes(subject_id, subject_kind, contractor_id, notes, updated_by, updated_at)
      values (subject, kind, contractor, notes, actor, now())
    on conflict (subject_id) do update set notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  insert into private.package_internal_note_events(subject_id, contractor_id, notes, actor) values (subject, contractor, notes, actor);
  return jsonb_build_object('subject_id', subject, 'notes', notes, 'updated_at', now());
end $$;

create function private.package_internal_notes_json(p_subject uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('notes', n.notes, 'updated_at', n.updated_at,
    'updated_by_email', (select u.email from auth.users u where u.id = n.updated_by))
  from private.package_internal_notes n where n.subject_id = p_subject
$$;

-- On publication a new draft's notes move to the package; a legacy draft's notes are kept the
-- same way, and the new revision stores none. A discarded draft's notes are removed.
create function private.package_draft_notes_follow() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lineage uuid;
begin
  if new.status = 'published' and new.package_id is not null then
    select p.lineage_id into lineage from public.vendor_packages p where p.id = new.package_id;
    if exists (select 1 from private.package_internal_notes n where n.subject_id = new.id) then
      insert into private.package_internal_notes(subject_id, subject_kind, contractor_id, notes, updated_by, updated_at)
        select lineage, 'lineage', n.contractor_id, n.notes, n.updated_by, n.updated_at
          from private.package_internal_notes n where n.subject_id = new.id
      on conflict (subject_id) do update set notes = excluded.notes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      delete from private.package_internal_notes n where n.subject_id = new.id;
    elsif nullif(btrim(new.content ->> 'policy_notes'), '') is not null then
      insert into private.package_internal_notes(subject_id, subject_kind, contractor_id, notes, updated_by)
        values (lineage, 'lineage', new.contractor_id, btrim(new.content ->> 'policy_notes'), new.closed_by)
      on conflict (subject_id) do nothing;
    end if;
    update public.vendor_packages p set policy_notes = null where p.id = new.package_id and p.policy_notes is not null;
  elsif new.status = 'discarded' then
    delete from private.package_internal_notes n where n.subject_id = new.id;
  end if;
  return null;
end $$;
create trigger trg_operator_package_draft_notes after update of status on private.operator_package_drafts
  for each row when (old.status = 'draft' and new.status <> 'draft') execute function private.package_draft_notes_follow();

-- Restates 20261018004000: a replacement draft no longer copies the live revision's notes
-- into its content (they stay with the package as internal notes).
create or replace function private.pricing_draft_content_from_package(p_package uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with content as (select private.package_content(p_package) c)
  select jsonb_build_object(
    'content', (c - 'package_id' - 'lineage_id' - 'revision_number' - 'contractor_id' - 'service_id' - 'default_frequency' - 'policy_notes')
      || jsonb_build_object('tiers', coalesce((select jsonb_agg(
          (t - 'rule_question_key' - 'rule_min' - 'rule_max' - 'sort_order')
          || jsonb_build_object('conditions', private.pricing_tier_conditions(t),
               'price_kind', coalesce(t ->> 'price_kind', case when c ->> 'pricing_mode' = 'fixed' then 'exact' else 'starting_at' end)))
        from jsonb_array_elements(c -> 'tiers') t), '[]'::jsonb),
        'addons', coalesce((select jsonb_agg((a - 'sort_order')
          || jsonb_build_object('price_kind', coalesce(a ->> 'price_kind', 'exact')))
        from jsonb_array_elements(c -> 'addons') a), '[]'::jsonb)),
    'conversions', coalesce((select jsonb_agg(note) from (
        select format('%s: legacy rule kept as a condition', t ->> 'name') note
          from jsonb_array_elements(c -> 'tiers') t where nullif(btrim(coalesce(t ->> 'rule_question_key', '')), '') is not null
        union all
        select format('%s: shown as "starting at" (no price meaning was recorded)', t ->> 'name')
          from jsonb_array_elements(c -> 'tiers') t where t ->> 'price_kind' is null and c ->> 'pricing_mode' <> 'fixed') notes), '[]'::jsonb))
  from content
$$;

-- Restates 20261018002000, adding internal_notes: the draft's own, its package's for a
-- replacement, or the notes still in a legacy draft's content.
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
    'internal_notes', coalesce(
      (select n.notes from private.package_internal_notes n
        where n.subject_id = coalesce((select p.lineage_id from public.vendor_packages p where p.id = p_draft.target_package_id), p_draft.id)),
      nullif(btrim(p_draft.content ->> 'policy_notes'), '')),
    'created_by_email', (select u.email from auth.users u where u.id = p_draft.created_by),
    'created_at', p_draft.created_at, 'updated_at', p_draft.updated_at)
$$;

-- 2. Archive ----------------------------------------------------------------------------------

create table private.package_archives (
  package_id uuid primary key,
  contractor_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  actor uuid not null,
  archived_at timestamptz not null default now()
);
create index package_archives_contractor_idx on private.package_archives(contractor_id);
alter table private.package_archives enable row level security;
revoke all on private.package_archives from public, anon, authenticated, service_role;

-- An archived package is never turned back on, on any write path.
create function private.vendor_package_archive_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.package_archives a where a.package_id = new.id) then
    raise exception 'Mercurius archived this price; start a new price instead of turning it back on' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger trg_vendor_package_archive before update of is_active on public.vendor_packages
  for each row when (new.is_active and not old.is_active) execute function private.vendor_package_archive_guard();

-- Archives a paused or replaced package. Requests and bookings keep their own pricing; the
-- package row is unchanged. The vendor is not notified.
create function public.admin_archive_package(p_package uuid, p_expected_updated_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  pkg public.vendor_packages;
  reason text := btrim(coalesce(p_reason, ''));
  archived timestamptz;
begin
  if length(reason) = 0 then raise exception 'Enter the reason for archiving' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  select * into pkg from public.vendor_packages where id = p_package for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or pkg.updated_at <> p_expected_updated_at then
    raise exception 'Package changed since it was read; reload before archiving' using errcode = '40001';
  end if;
  if pkg.is_active then raise exception 'Suspend this listing before archiving it' using errcode = '55000'; end if;
  if exists (select 1 from private.package_archives a where a.package_id = pkg.id) then
    raise exception 'This package is already archived' using errcode = '55000';
  end if;
  if exists (select 1 from private.operator_package_drafts d where d.target_package_id = pkg.id and d.status = 'draft') then
    raise exception 'Publish or discard the replacement draft of this package first' using errcode = '55000';
  end if;
  insert into private.package_archives(package_id, contractor_id, reason, actor)
    values (pkg.id, pkg.contractor_id, reason, actor) returning archived_at into archived;
  return jsonb_build_object('package_id', pkg.id, 'archived_at', archived);
end $$;

-- Restates 20261018004000, adding each package's internal notes and archive record.
create or replace function public.admin_package_contents(p_contractor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(jsonb_build_object('package_id', p.id, 'content', private.package_content(p.id),
        'approval', private.package_approval_evidence(p.id),
        'internal_notes', private.package_internal_notes_json(p.lineage_id),
        'archive', (select jsonb_build_object('reason', a.reason, 'archived_at', a.archived_at,
            'actor_email', (select u.email from auth.users u where u.id = a.actor))
          from private.package_archives a where a.package_id = p.id))
      order by p.sort_order, p.name)
    from public.vendor_packages p where p_contractor is null or p.contractor_id = p_contractor), '[]'::jsonb);
end $$;

-- 3. Checklist exception ----------------------------------------------------------------------

create table private.vendor_checklist_exceptions (
  evidence_id uuid primary key references public.vendor_compliance_evidence(id),
  contractor_id uuid not null,
  kind text not null check (kind in ('license', 'insurance')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  approver text not null check (length(btrim(approver)) between 1 and 120),
  follow_up_due date not null,
  business_key text not null unique,
  actor uuid not null,
  created_at timestamptz not null default now()
);
create index vendor_checklist_exceptions_contractor_idx on private.vendor_checklist_exceptions(contractor_id, created_at desc);
alter table private.vendor_checklist_exceptions enable row level security;
revoke all on private.vendor_checklist_exceptions from public, anon, authenticated, service_role;

create function private.vendor_checklist_exception_json(x private.vendor_checklist_exceptions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('evidence_id', x.evidence_id, 'contractor_id', x.contractor_id, 'kind', x.kind,
    'reason', x.reason, 'approver', x.approver, 'follow_up_due', x.follow_up_due, 'created_at', x.created_at,
    'expires_at', e.expires_at, 'actor_email', (select u.email from auth.users u where u.id = x.actor),
    'open', newer.id is null, 'resolved_at', newer.accepted_at)
  from public.vendor_compliance_evidence e
  left join public.vendor_compliance_evidence newer on newer.supersedes = e.id
  where e.id = x.evidence_id
$$;

-- Marks licensing or insurance current without a document. The same key replays the result.
create function public.vendor_record_checklist_exception(p_contractor uuid, p_kind text, p_reason text, p_approver text,
  p_follow_up_due date, p_supersedes uuid default null, p_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  reason text := btrim(coalesce(p_reason, ''));
  approver text := btrim(coalesce(p_approver, ''));
  prior private.vendor_checklist_exceptions;
  o public.vendor_onboarding;
  v public.vendor_application_versions;
  current_evidence public.vendor_compliance_evidence;
  evidence uuid;
begin
  if length(btrim(coalesce(p_key, ''))) = 0 then raise exception 'Idempotency key required'; end if;
  select * into prior from private.vendor_checklist_exceptions where business_key = p_key;
  if found then
    if prior.contractor_id <> p_contractor or prior.kind is distinct from p_kind or prior.reason <> reason
       or prior.approver <> approver or prior.follow_up_due is distinct from p_follow_up_due or prior.actor <> actor then
      raise exception 'Checklist exception idempotency conflict';
    end if;
    return private.vendor_checklist_exception_json(prior) || jsonb_build_object('replayed', true);
  end if;
  if p_kind is null or p_kind not in ('license', 'insurance') then
    raise exception 'An exception is only for licensing or insurance' using errcode = '22023';
  end if;
  if length(reason) = 0 then raise exception 'Enter the reason for the exception' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  if length(approver) = 0 then raise exception 'Enter who approved the exception' using errcode = '22023'; end if;
  if length(approver) > 120 then raise exception 'Approver too long' using errcode = '22023'; end if;
  if p_follow_up_due is null or p_follow_up_due <= (now() at time zone 'America/New_York')::date then
    raise exception 'Enter a follow-up due date after today' using errcode = '22023';
  end if;

  select * into o from public.vendor_onboarding where contractor_id = p_contractor for update;
  if not found then raise exception 'Onboarding review required'; end if;
  if o.status = 'rejected' then raise exception 'A rejected provider takes no further evidence'; end if;
  select * into strict v from public.vendor_application_versions where id = o.application_version_id;
  if exists (select 1 from public.vendor_application_versions newer where newer.application_id = v.application_id and newer.revision > v.revision)
     or not exists (select 1 from public.vendor_applications app where app.id = v.application_id
       and app.contractor_id = p_contractor and app.status not in ('rejected', 'abandoned')) then
    raise exception 'Current application version required';
  end if;
  select * into current_evidence from public.vendor_compliance_evidence e
   where e.contractor_id = p_contractor and e.kind = p_kind
     and not exists (select 1 from public.vendor_compliance_evidence n where n.supersedes = e.id);
  if current_evidence.id is not null and current_evidence.application_version_id = o.application_version_id
     and (current_evidence.expires_at is null or current_evidence.expires_at > now())
     and not exists (select 1 from private.vendor_checklist_exceptions x where x.evidence_id = current_evidence.id) then
    raise exception 'This item already has current evidence' using errcode = '55000';
  end if;

  -- The kernel enforces operator, freshness and the stale-supersede guard.
  evidence := public.vendor_record_evidence(p_contractor, p_kind, 'exception', 'Exception: document pending', now(),
    ((p_follow_up_due + 1)::timestamp at time zone 'America/New_York'), p_supersedes);
  begin
    insert into private.vendor_checklist_exceptions(evidence_id, contractor_id, kind, reason, approver, follow_up_due, business_key, actor)
      values (evidence, p_contractor, p_kind, reason, approver, p_follow_up_due, p_key, actor) returning * into prior;
  exception when unique_violation then
    raise exception 'Checklist exception idempotency conflict';
  end;
  -- Recording an exception activates nothing, grants no role and changes no revision.
  return private.vendor_checklist_exception_json(prior) || jsonb_build_object('replayed', false);
end $$;

-- Every exception recorded for one provider, newest first; open until a document supersedes it.
create function public.vendor_checklist_exceptions(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(private.vendor_checklist_exception_json(x) order by x.created_at desc, x.evidence_id)
    from private.vendor_checklist_exceptions x where x.contractor_id = p_contractor), '[]'::jsonb);
end $$;

-- Grants ----------------------------------------------------------------------------------------

revoke all on function
  public.admin_set_package_internal_notes(uuid, uuid, text),
  private.package_internal_notes_json(uuid),
  private.package_draft_notes_follow(),
  private.vendor_package_archive_guard(),
  public.admin_archive_package(uuid, timestamptz, text),
  public.admin_package_contents(uuid),
  private.vendor_checklist_exception_json(private.vendor_checklist_exceptions),
  public.vendor_record_checklist_exception(uuid, text, text, text, date, uuid, text),
  public.vendor_checklist_exceptions(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.admin_set_package_internal_notes(uuid, uuid, text),
  public.admin_archive_package(uuid, timestamptz, text),
  public.admin_package_contents(uuid),
  public.vendor_record_checklist_exception(uuid, text, text, text, date, uuid, text),
  public.vendor_checklist_exceptions(uuid)
to authenticated;
