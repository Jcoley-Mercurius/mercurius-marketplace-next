-- TRACE-072 forward fix: a lapse in provider qualification evidence no longer holds payouts.
--
-- Owner decision (2026-09-13): lapsed license, insurance or other checklist evidence takes
-- a provider out of matching (unchanged, vendor_is_eligible) but does not hold weekly ACH
-- or replacement payee reconciliation; Mercurius contacts the provider instead. A lapsed
-- payout onboarding item (bank_authorization) still holds, because that evidence
-- authorizes the transfer. Suspension and any non-active onboarding status still hold.
--
-- The two function bodies below are copied unchanged from
-- 20260905014000_replacement_commercial_reconciliation.sql except for their eligibility
-- line. Grants are preserved by create or replace.

-- Payout eligibility: active onboarding on the latest, open application version, with
-- current payout onboarding evidence on that version. The application checks mirror
-- vendor_evidence_current so a closed or superseded application still holds.
create function private.vendor_payout_eligible(p_contractor uuid,p_at timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.vendor_onboarding o
    join public.vendor_application_versions v on v.id=o.application_version_id
    join public.vendor_applications a on a.id=v.application_id
    where o.contractor_id=p_contractor and o.status='active'
      and a.contractor_id=p_contractor and a.status not in ('rejected','abandoned')
      and not exists(select 1 from public.vendor_application_versions n where n.application_id=v.application_id and n.revision>v.revision)
      and exists(select 1 from public.vendor_compliance_evidence e
        where e.contractor_id=p_contractor and e.kind='bank_authorization'
          and e.application_version_id=o.application_version_id
          and e.accepted_at<=p_at and (e.expires_at is null or e.expires_at>p_at)
          and not exists(select 1 from public.vendor_compliance_evidence newer where newer.supersedes=e.id)))
$$;
revoke all on function private.vendor_payout_eligible(uuid,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.money_payable(p_obligation uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare o public.money_obligations; s public.money_snapshots; amount bigint; retained record; payee uuid;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
  payee:=private.money_effective_contractor(o.id);
  if o.captured<>s.total or o.dispute_open or o.reconciliation_open then raise exception 'Payment or dispute hold'; end if;
  if exists(select 1 from public.money_webhook_events e where e.status<>'processed'
    and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
    and (e.event_type='reconciliation_required' or e.payload->>'attempt_id' in(select id::text from public.money_checkout_attempts where obligation_id=o.id)
      or e.payload->>'payment_id' in(select stripe_payment_id from public.money_checkout_attempts where obligation_id=o.id))) then raise exception 'Unreconciled provider event hold'; end if;
  if not exists(select 1 from public.money_completion_evidence where obligation_id=o.id and homeowner_id=o.customer_id and confirmed_at+interval '48 hours'<=now()) then raise exception '48 hours after homeowner confirmation required'; end if;
  if exists(select 1 from public.money_holds h where obligation_id=o.id and not exists(select 1 from public.money_hold_resolutions r where r.hold_id=h.id)) then raise exception 'Unresolved payout hold'; end if;
  if exists(select 1 from public.money_refund_authorizations r where obligation_id=o.id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id)) then raise exception 'Pending refund hold'; end if;
  if not private.vendor_payout_eligible(payee) then raise exception 'Vendor onboarding hold'; end if;
  select * into strict retained from public.money_retained_parts(o.id);
  amount:=retained.service-round(retained.service::numeric*15/100)+retained.tip;
  if amount<=0 then raise exception 'No provider payable'; end if;
  return amount;
end $$;

create or replace function public.money_reconcile_replacement(
  p_operation uuid,p_decision uuid,p_actor uuid,p_approver uuid,p_reason text
) returns public.money_replacement_reconciliations
language plpgsql security definer set search_path='' as $$
declare op public.job_operations; decision public.money_provider_replacement_decisions;
  o public.money_obligations; r public.service_requests; binding public.money_commercial_sources;
  prior public.money_replacement_reconciliations; result public.money_replacement_reconciliations;
  source_hash text; command jsonb; current_payee uuid;
begin
  perform public.money_require_finance(p_actor);
  perform public.money_require_finance(p_approver);
  select * into strict op from public.job_operations where id=p_operation;
  perform pg_advisory_xact_lock(hashtextextended(op.job_id::text,0));
  select * into strict r from public.service_requests where id=op.job_id for update;
  select * into strict o from public.money_obligations where service_request_id=r.id for update;
  select * into strict decision from public.money_provider_replacement_decisions where id=p_decision;
  select * into binding from public.money_commercial_sources where snapshot_id=o.current_snapshot_id;
  source_hash:=coalesce(binding.source_hash,'legacy-snapshot:'||o.current_snapshot_id);
  select * into prior from public.money_replacement_reconciliations where operation_id=p_operation;
  current_payee:=case when prior.id is not null then prior.original_contractor_id
    else private.money_effective_contractor(o.id) end;
  command:=jsonb_build_object('operation','replacement_reconciliation','provider_operation',p_operation,
    'replacement_decision',p_decision,'obligation',o.id,'snapshot',o.current_snapshot_id,
    'captured',o.captured,'original_contractor',current_payee,
    'replacement_contractor',r.contractor_id,'source_hash',source_hash,'reason',btrim(p_reason));
  perform public.money_require_review(p_actor,p_approver,command);
  if prior.id is not null then
    if prior.replacement_decision_id<>p_decision or prior.created_by<>p_actor
      or prior.approved_by<>p_approver or prior.reason<>btrim(p_reason)
      or prior.replacement_contractor_id is distinct from r.contractor_id
      or prior.snapshot_id<>o.current_snapshot_id or prior.captured<>o.captured
      or prior.source_hash<>source_hash then
      raise exception 'Replacement reconciliation idempotency conflict';
    end if;
    return prior;
  end if;
  if op.kind not in ('provider_cancel','no_show') or op.job_id<>r.id
    or op.policy_assessment->>'next_action' is distinct from 'rematch_first' then
    raise exception 'Approved provider replacement operation required';
  end if;
  if decision.operation_id<>op.id or decision.outcome<>'replacement_active' then
    raise exception 'Active replacement decision required';
  end if;
  if r.contractor_id is null or r.contractor_id=current_payee
    or not exists(select 1 from public.job_match_attempts a where a.service_request_id=r.id
      and a.contractor_id=r.contractor_id and a.outcome='accepted') then
    raise exception 'Canonically accepted replacement required';
  end if;
  if o.current_snapshot_id is null or o.captured<=0 then raise exception 'Paid agreement required'; end if;
  if exists(select 1 from public.money_checkout_attempts a where a.obligation_id=o.id
      and a.status not in ('captured','expired')) then raise exception 'Uncertain checkout requires reconciliation'; end if;
  if exists(select 1 from public.money_refund_authorizations where obligation_id=o.id)
    or o.refunded_service+o.refunded_tax+o.refunded_tip>0 then
    raise exception 'Refunded agreement cannot be reassigned';
  end if;
  if exists(select 1 from public.money_ach_items where obligation_id=o.id) then
    raise exception 'Existing ACH statement cannot be reassigned';
  end if;
  if not private.vendor_payout_eligible(r.contractor_id) then raise exception 'Replacement vendor onboarding hold'; end if;
  insert into public.money_replacement_reconciliations(
    obligation_id,operation_id,replacement_decision_id,snapshot_id,original_contractor_id,
    replacement_contractor_id,captured,source_hash,created_by,approved_by,reason)
  values(o.id,op.id,decision.id,o.current_snapshot_id,current_payee,r.contractor_id,
    o.captured,source_hash,p_actor,p_approver,btrim(p_reason)) returning * into result;
  return result;
end $$;
