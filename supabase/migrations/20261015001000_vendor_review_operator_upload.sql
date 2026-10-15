-- TRACE-105: operator document upload for any provider under onboarding review (owner
-- decision 2026-10-14, DEC-2026-030).
--
-- TRACE-073 let an operator upload license and insurance documents only for an active
-- or suspended provider; DEC-2026-027 added the eight legacy reviews. Applicants submit
-- documents only with /vendors/apply, which allows none, and reach the vendor portal
-- only at activation, so an applicant under review who sends documents to Mercurius
-- directly had no path into the checklist. The operator upload now also applies to
-- every provider in review. The upload still awaits review: checklist items 4 and 5
-- (license, insurance) are recorded only when an operator selects the document, with
-- an expiry, through the unchanged checklist command.
--
-- The provider itself still submits only while active or suspended. Rejected or
-- unknown providers are still refused. Both functions are otherwise unchanged from
-- 20261004001000; private.r0_legacy_review_open stays (a legacy review is in review).

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
   and not (role_value='operator' and status_value is not distinct from 'review') then
   raise exception 'Renewal documents are accepted only for active or suspended providers';
 end if;
 return query select resolved,caller,role_value;
end $$;

-- 'operator_upload': active, suspended or in review.
create or replace function public.vendor_renewal_document_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',(select o.status from public.vendor_onboarding o where o.contractor_id=p_contractor),
  'operator_upload',coalesce((select o.status in ('review','active','suspended') from public.vendor_onboarding o where o.contractor_id=p_contractor),false),
  'open_limit',private.vendor_renewal_open_limit(),
  'retention_hold',(select jsonb_build_object('reason',h.reason,'placed_at',h.placed_at) from private.vendor_retention_hold(p_contractor) h),
  'documents',coalesce((select jsonb_agg(private.vendor_renewal_document_json(d,true) || coalesce(private.vendor_renewal_retention_json(d),'{}'::jsonb)
      order by d.created_at desc,d.id)
    from public.vendor_renewal_documents d where d.contractor_id=p_contractor),'[]'::jsonb));
end $$;
