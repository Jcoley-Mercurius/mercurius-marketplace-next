-- TRACE-122 (DEC-2026-047) review corrections, 2026-10-25: Codex review of PR #110, owner-approved.
--
-- ROLLOUT: push AFTER the PR #110 deploy lands, not before merge. Narrowing vendor_packages
-- privileges is not compatible with the client deployed before PR #110 (its public profile
-- selects policy_notes and its vendor package pages select *). The PR #110 client works on
-- either schema (it treats a missing vendor_package_archives as no archives).
-- Forward fix for 20261024003000 (already applied to hosted). Additive: no row is changed or
-- removed; privileges narrowed; guards, one readback, one identity column and one check
-- constraint added; five functions restated with one change each.
--
-- 1. Legacy internal notes. vendor_packages.policy_notes keeps its historical values (they are
--    part of package_revision_hash, which submitted requests are bound to), but anonymous users,
--    homeowners and vendors can no longer read them: column-level SELECT replaces the table-level
--    grant, and vendors can no longer write the column. The vendor's draft/approval readback drops
--    policy_notes from legacy draft content (the revision string is the stored content_hash and is
--    unchanged). Operators read notes through the security-definer admin readbacks only.
--    A future column on vendor_packages must be granted explicitly to anon/authenticated.
-- 2. Archived packages are read-only history on every write path: their row and its tiers,
--    questions and add-ons (the revision content) cannot be changed or deleted. The reactivation
--    guard of 20261024003000 stays and still answers a turn-on attempt first. Vendors read which
--    of their packages are archived (no reason, no operator identity).
-- 3. Checklist exceptions: the follow-up date must be after today and at most 14 calendar days
--    after today (America/New_York); expiry stays the end of that Eastern date. A further
--    exception still supersedes the current one explicitly, with its own reason, approver and
--    record; each exception reports its sequence for its item (recording order, a new identity
--    column) so repeats are visible.

-- 1. Legacy internal notes --------------------------------------------------------------------

revoke select, insert, update on public.vendor_packages from anon, authenticated;
grant select (id, contractor_id, service_id, name, description, pricing_mode, default_frequency, deposit_amount,
  is_active, sort_order, created_at, updated_at, template_id, needs_review, lineage_id, revision_number, included_scope)
  on public.vendor_packages to anon, authenticated;
grant insert (id, contractor_id, service_id, name, description, pricing_mode, default_frequency, deposit_amount,
  is_active, sort_order, created_at, updated_at, template_id, needs_review, lineage_id, revision_number, included_scope),
  update (id, contractor_id, service_id, name, description, pricing_mode, default_frequency, deposit_amount,
  is_active, sort_order, created_at, updated_at, template_id, needs_review, lineage_id, revision_number, included_scope)
  on public.vendor_packages to authenticated;

comment on column public.vendor_packages.policy_notes is
  'Legacy provider notes of existing revisions (part of their revision hash). Mercurius-internal: not readable or writable by anon or authenticated (TRACE-122); internal notes live in private.package_internal_notes.';

-- Restates 20261018002000: legacy draft content may still hold policy_notes; the vendor never
-- receives them. The revision returned is the stored hash, so approval still binds to it.
create or replace function private.vendor_package_draft_json(p_draft private.operator_package_drafts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_draft.id, 'contractor_id', p_draft.contractor_id,
    'service_id', p_draft.service_id,
    'service_name', (select s.name from public.services_catalog s where s.id = p_draft.service_id),
    'content', p_draft.content - 'policy_notes', 'revision', p_draft.content_hash,
    'target_package_id', p_draft.target_package_id,
    'target_package_name', (select p.name from public.vendor_packages p where p.id = p_draft.target_package_id),
    'status', p_draft.status, 'approval_state', p_draft.approval_state,
    'sent_at', p_draft.sent_at, 'approved_at', p_draft.approved_at, 'change_request', p_draft.change_request,
    'package_id', p_draft.package_id)
$$;

-- Restates 20260809120000: reads the four columns it checks instead of the whole row, which the
-- invoking vendor can no longer select. Behavior unchanged; still runs as the invoker.
create or replace function public.validate_package_promotion()
returns trigger language plpgsql set search_path to 'public' as $function$
DECLARE
  package_found uuid;
  package_active boolean;
  package_needs_review boolean;
  package_mode text;
  tier_count integer;
  invalid_tier_count integer;
  single_base_price numeric;
BEGIN
  IF NOT NEW.is_enabled THEN
    RETURN NEW;
  END IF;

  SELECT id, is_active, needs_review, pricing_mode
  INTO package_found, package_active, package_needs_review, package_mode
  FROM public.vendor_packages
  WHERE id = NEW.package_id;

  IF package_found IS NULL
    OR package_active IS NOT TRUE
    OR package_needs_review IS TRUE
    OR package_mode <> 'fixed' THEN
    RAISE EXCEPTION 'Promotions require an active, review-cleared fixed-price package';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE price IS NULL OR price <= 0), min(price)
  INTO tier_count, invalid_tier_count, single_base_price
  FROM public.package_tiers
  WHERE package_id = NEW.package_id;

  IF tier_count = 0 OR invalid_tier_count > 0 THEN
    RAISE EXCEPTION 'Promotions require valid positive prices on every package tier';
  END IF;

  IF NEW.promotion_type = 'fixed_price' THEN
    IF tier_count <> 1 THEN
      RAISE EXCEPTION 'Fixed promotional prices require a single-tier package';
    END IF;
    IF NEW.fixed_price >= single_base_price THEN
      RAISE EXCEPTION 'Fixed promotional price must be below the base price';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Archived packages are read-only --------------------------------------------------------

create function private.package_archived(p_package uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.package_archives a where a.package_id = p_package)
$$;

-- Fires after trg_vendor_package_archive (name order), so a turn-on attempt keeps its message.
create function private.vendor_package_archived_history_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.package_archived(old.id) then
    raise exception 'Mercurius archived this price; it is kept as read-only history' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_vendor_package_archived_history before update or delete on public.vendor_packages
  for each row execute function private.vendor_package_archived_history_guard();

-- Tiers, questions and add-ons are the revision content of their package.
create function private.package_part_archived_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' and private.package_archived(old.package_id))
     or (tg_op <> 'DELETE' and private.package_archived(new.package_id)) then
    raise exception 'Mercurius archived this price; it is kept as read-only history' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_package_tiers_archived_history before insert or update or delete on public.package_tiers
  for each row execute function private.package_part_archived_guard();
create trigger trg_package_questions_archived_history before insert or update or delete on public.package_qualifying_questions
  for each row execute function private.package_part_archived_guard();
create trigger trg_package_addons_archived_history before insert or update or delete on public.package_addons
  for each row execute function private.package_part_archived_guard();

-- Which of a provider's packages are archived: the vendor's own, or any provider for an operator.
create function public.vendor_package_archives(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_role(auth.uid(), 'admin')
      or exists (select 1 from public.contractors c where c.id = p_contractor and c.user_id = auth.uid())) then
    raise exception 'Provider not found' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('package_id', a.package_id, 'archived_at', a.archived_at)
      order by a.archived_at, a.package_id)
    from private.package_archives a where a.contractor_id = p_contractor), '[]'::jsonb);
end $$;

-- 3. Checklist exception window -------------------------------------------------------------

create function private.checklist_exception_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/New_York')::date
$$;

-- The end of the follow-up date in Eastern time (the start of the next Eastern day).
create function private.checklist_exception_expires_at(p_due date) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_due + 1)::timestamp at time zone 'America/New_York'
$$;

-- New rows only: existing rows are reported, never rewritten (none existed on hosted at review).
alter table private.vendor_checklist_exceptions add constraint vendor_checklist_exceptions_follow_up_window
  check (follow_up_due > (created_at at time zone 'America/New_York')::date
     and follow_up_due <= (created_at at time zone 'America/New_York')::date + 14) not valid;

-- Recording order; created_at alone cannot order two exceptions written in one transaction.
alter table private.vendor_checklist_exceptions add column recorded_seq bigint generated always as identity;

-- Restates 20261024003000, adding the exception's sequence among its provider's exceptions for
-- the same item (1 for the first; 2 or more is a repeat the operator should see).
create or replace function private.vendor_checklist_exception_json(x private.vendor_checklist_exceptions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('evidence_id', x.evidence_id, 'contractor_id', x.contractor_id, 'kind', x.kind,
    'reason', x.reason, 'approver', x.approver, 'follow_up_due', x.follow_up_due, 'created_at', x.created_at,
    'expires_at', e.expires_at, 'actor_email', (select u.email from auth.users u where u.id = x.actor),
    'open', newer.id is null, 'resolved_at', newer.accepted_at,
    'sequence', (select count(*) from private.vendor_checklist_exceptions p
      where p.contractor_id = x.contractor_id and p.kind = x.kind
        and p.recorded_seq <= x.recorded_seq))
  from public.vendor_compliance_evidence e
  left join public.vendor_compliance_evidence newer on newer.supersedes = e.id
  where e.id = x.evidence_id
$$;

-- Restates 20261024003000 with the 14-day window; everything else unchanged. A replay returns
-- the recorded exception without re-checking the window.
create or replace function public.vendor_record_checklist_exception(p_contractor uuid, p_kind text, p_reason text, p_approver text,
  p_follow_up_due date, p_supersedes uuid default null, p_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  reason text := btrim(coalesce(p_reason, ''));
  approver text := btrim(coalesce(p_approver, ''));
  today date := private.checklist_exception_today();
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
  if p_follow_up_due is null or p_follow_up_due <= today then
    raise exception 'Enter a follow-up due date after today' using errcode = '22023';
  end if;
  if p_follow_up_due > today + 14 then
    raise exception 'The follow-up due date can be at most 14 days after today (Eastern)' using errcode = '22023';
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
    private.checklist_exception_expires_at(p_follow_up_due), p_supersedes);
  begin
    insert into private.vendor_checklist_exceptions(evidence_id, contractor_id, kind, reason, approver, follow_up_due, business_key, actor)
      values (evidence, p_contractor, p_kind, reason, approver, p_follow_up_due, p_key, actor) returning * into prior;
  exception when unique_violation then
    raise exception 'Checklist exception idempotency conflict';
  end;
  -- Recording an exception activates nothing, grants no role and changes no revision.
  return private.vendor_checklist_exception_json(prior) || jsonb_build_object('replayed', false);
end $$;

-- Restates 20261024003000: newest first by recording order.
create or replace function public.vendor_checklist_exceptions(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(private.vendor_checklist_exception_json(x) order by x.recorded_seq desc)
    from private.vendor_checklist_exceptions x where x.contractor_id = p_contractor), '[]'::jsonb);
end $$;

-- Grants ----------------------------------------------------------------------------------------

revoke all on function
  private.package_archived(uuid),
  private.vendor_package_archived_history_guard(),
  private.package_part_archived_guard(),
  public.vendor_package_archives(uuid),
  private.checklist_exception_today(),
  private.checklist_exception_expires_at(date)
from public, anon, authenticated, service_role;
grant execute on function public.vendor_package_archives(uuid) to authenticated;
