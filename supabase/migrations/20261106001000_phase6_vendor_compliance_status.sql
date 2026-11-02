-- Phase 6.12A / TRACE-135: a provider's own compliance status and next actions.
--
-- Read-only and additive. Requires 20261024003000/20261025001000 (checklist exceptions) and
-- 20260915001000 (renewal documents). Writes nothing, changes no evidence, eligibility, role,
-- activation, matching or payout rule, and touches no money-fingerprint function.
--
-- 1. vendor_own_compliance_status(): each checklist item for the caller's own provider with its
--    state (missing, current, expiring, expired, exception), whether it rests on a temporary
--    exception (document pending, never a verified document; DEC-2026-047), renewal documents
--    awaiting review, the latest decline note, and the compliance part of matching and payout
--    eligibility. The provider is resolved from auth.uid(); there is no provider parameter.
--    Evidence references, requirement versions, evidence ids and exception reasons, approvers
--    and actors stay operator-only.
-- 2. vendor_own_evidence_renewal() is restated with two added keys per item: exception and
--    follow_up_due. The notice could otherwise word an expiring exception as a document on file
--    being renewed (F612-1). Existing keys and their meaning are unchanged.

create or replace function public.vendor_own_compliance_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now(); c public.contractors; o public.vendor_onboarding;
begin
 if auth.uid() is null or not public.has_role(auth.uid(),'vendor') then
   raise exception 'Vendor account required' using errcode='42501';
 end if;
 select * into c from public.contractors where user_id=auth.uid();
 if c.id is not null then
   select * into o from public.vendor_onboarding where contractor_id=c.id;
 end if;
 return jsonb_build_object(
  'evaluated_at',at_value,
  'today',(at_value at time zone 'America/New_York')::date,
  'notice_days',extract(day from private.vendor_renewal_notice())::integer,
  'provider_found',c.id is not null,
  'onboarding_status',o.status,
  -- The compliance part of matching: active onboarding and all nine items current (TRACE-060).
  -- Live offerings and coverage are separate requirements and are not reported here.
  'checklist_current',o.contractor_id is not null and public.vendor_evidence_current(c.id,at_value),
  'matching_allowed',o.contractor_id is not null and public.vendor_is_eligible(c.id),
  -- Payouts need current payout onboarding (owner decision 2026-09-13).
  'payout_onboarding_current',o.contractor_id is not null and private.vendor_payout_eligible(c.id,at_value),
  'accepting_uploads',coalesce(o.status in ('active','suspended'),false),
  'open_limit',private.vendor_renewal_open_limit(),
  'items',case when o.contractor_id is null then '[]'::jsonb else (select jsonb_agg(jsonb_build_object(
      'kind',k.kind,
      'state',case when e.id is null or e.application_version_id<>o.application_version_id then 'missing'
        when e.expires_at is not null and e.expires_at<=at_value then 'expired'
        when x.evidence_id is not null then 'exception'
        when e.expires_at is not null and e.expires_at<=at_value+private.vendor_renewal_notice() then 'expiring'
        else 'current' end,
      'exception',e.id is not null and e.application_version_id=o.application_version_id and x.evidence_id is not null,
      -- An exception lapses at the end of its follow-up date (America/New_York).
      'follow_up_due',case when e.application_version_id=o.application_version_id then x.follow_up_due end,
      'expires_at',case when e.application_version_id=o.application_version_id then e.expires_at end,
      -- When Mercurius recorded the item. Not shown for an exception, which records no review of a document.
      'recorded_at',case when e.application_version_id=o.application_version_id and x.evidence_id is null then e.accepted_at end,
      'awaiting_review',coalesce(d.awaiting,0),
      'last_submitted_at',d.last_submitted_at,
      'declined',case when d.declined_at is not null and (e.id is null or d.declined_at>e.accepted_at)
        then jsonb_build_object('at',d.declined_at,'note',d.declined_note) end
    ) order by k.position)
    from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'])
      with ordinality as k(kind,position)
    left join lateral (select * from public.vendor_compliance_evidence e where e.contractor_id=c.id and e.kind=k.kind
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id)) e on true
    left join private.vendor_checklist_exceptions x on x.evidence_id=e.id
    left join lateral (
      select count(*) filter (where dd.document_id is null)::integer as awaiting,
        max(doc.created_at) filter (where dd.document_id is null) as last_submitted_at,
        (array_agg(dd.created_at order by dd.created_at desc) filter (where dd.document_id is not null))[1] as last_decided_at,
        (array_agg(dd.outcome order by dd.created_at desc) filter (where dd.document_id is not null))[1] as last_outcome,
        (array_agg(dd.note order by dd.created_at desc) filter (where dd.document_id is not null))[1] as last_note
      from public.vendor_renewal_documents doc
      left join public.vendor_renewal_document_decisions dd on dd.document_id=doc.id
      where doc.contractor_id=c.id and doc.kind=k.kind) d0 on true
    cross join lateral (select d0.awaiting, d0.last_submitted_at,
        case when d0.last_outcome='declined' then d0.last_decided_at end as declined_at,
        case when d0.last_outcome='declined' then d0.last_note end as declined_note) d)
  end);
end $$;

-- TRACE-072 notice, restated: each item also says whether it is a temporary exception and, if so,
-- its follow-up date. Which items are listed, and their states, are unchanged.
create or replace function public.vendor_own_evidence_renewal()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now(); contractor uuid;
begin
 if auth.uid() is null or not public.has_role(auth.uid(),'vendor') then
   raise exception 'Vendor account required' using errcode='42501';
 end if;
 select id into contractor from public.contractors where user_id=auth.uid();
 return jsonb_build_object(
  'evaluated_at',at_value,
  'notice_days',extract(day from private.vendor_renewal_notice())::integer,
  'items',coalesce((select jsonb_agg(jsonb_build_object('kind',i.kind,'expires_at',i.expires_at,'state',i.state,
        'exception',x.evidence_id is not null,'follow_up_due',x.follow_up_due)
      order by i.expires_at,i.kind)
    from private.vendor_renewal_items(contractor,at_value) i
    left join private.vendor_checklist_exceptions x on x.evidence_id=i.evidence_id
    where contractor is not null),'[]'::jsonb));
end $$;

revoke all on function public.vendor_own_compliance_status() from public,anon,authenticated,service_role;
grant execute on function public.vendor_own_compliance_status() to authenticated;
-- create or replace keeps vendor_own_evidence_renewal's TRACE-072 grants (authenticated only).
