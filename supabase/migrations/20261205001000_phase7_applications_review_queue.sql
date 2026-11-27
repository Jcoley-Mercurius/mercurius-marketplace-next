-- Phase 7.5G-1 (TRACE-159): applications awaiting review, as a server reader and an overview row.
-- Plan: governance/PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md §5 and §9 (Codex R-1..R-5, C-1..C-3).
-- Function-only. Nothing is written by either function, and no table, column, index, trigger,
-- policy or grant on a table changes.
--
-- 1. public.admin_application_review_queue() returns {checked_at, items}, one item
--    {application_id, since} per application the applications page classifies as
--    "awaiting_review" (src/lib/applicationQueueState.ts), with the same precedence:
--      abandoned application                                 -> abandoned (left out)
--      onboarding rejected, or application rejected          -> rejected (left out)
--      a review-start row exists                             -> in review / active / suspended (left out)
--      application status 'approved' (recovered pipeline)    -> legacy approved (left out)
--      anything else                                         -> awaiting review (listed)
--    The onboarding row is the one for the application's contractor_id, as
--    vendor_onboarding_intake_status reads it; a null contractor_id has none. A linked onboarding
--    row without a review start does not count as a started review, as on the page.
--    `since` is vendor_applications.created_at: when the application was received (R-3). It is
--    not the start of a review episode, and intake revisions (vendor_application_versions) do not
--    reset it. Order: created_at, then id (C-3). No threshold, aged flag or due time is approved,
--    so none is returned. Admin only, through vendor_require_operator() (42501 otherwise).
-- 2. public.admin_operations_summary() restated from 20261130001000 with one change: the
--    'applications' row, read from the function above with no aged rule, appended after
--    'offer_terms' inside the same per-queue error handling (R-5). Finance stays last and keeps
--    its restricted/error handling; every other row and the order are unchanged. CREATE OR
--    REPLACE keeps its owner and grants (no PUBLIC or anon execute; authenticated execute).
-- Rollback: a forward migration restoring the 20261130001000 summary body; the new reader can be
-- left in place or revoked. No data is written here, so nothing needs repair.

create function public.admin_application_review_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return jsonb_build_object('checked_at', now(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('application_id', a.id, 'since', a.created_at) order by a.created_at, a.id)
    from public.vendor_applications a
    where a.status not in ('abandoned', 'rejected', 'approved')
      and not exists (select 1 from public.vendor_onboarding o
        where o.contractor_id = a.contractor_id and o.status = 'rejected')
      and not exists (select 1 from public.vendor_onboarding_review_starts r where r.application_id = a.id)
  ), '[]'::jsonb));
end $$;

revoke all on function public.admin_application_review_queue() from public, anon, authenticated, service_role;
grant execute on function public.admin_application_review_queue() to authenticated;

create or replace function public.admin_operations_summary() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.require_admin();
  out_items jsonb := '[]'::jsonb;
  q jsonb;
  entry record;
begin
  for entry in select * from (values
    ('quote', 'items', 'aged'), ('recurring_payment', 'items', 'aged'), ('fulfillment', 'items', null),
    ('cancellation', 'items', null), ('support', 'items', 'overdue'),
    ('compliance_renewal', 'entries', null), ('renewal_documents', 'entries', null),
    ('offer_terms', 'items', null), ('applications', 'items', null)) v(queue, list_key, aged_key)
  loop
    begin
      q := case entry.queue
        when 'quote' then public.admin_quote_queue()
        when 'recurring_payment' then public.admin_recurring_payment_queue()
        when 'fulfillment' then public.admin_fulfillment_queue()
        when 'cancellation' then public.admin_cancellation_queue()
        when 'support' then public.admin_support_queue(false)
        when 'compliance_renewal' then public.vendor_evidence_renewal_queue()
        when 'renewal_documents' then public.vendor_renewal_document_queue()
        when 'offer_terms' then public.admin_offer_terms_queue()
        when 'applications' then public.admin_application_review_queue() end;
      out_items := out_items || jsonb_build_object('queue', entry.queue, 'state', 'ready',
        'count', jsonb_array_length(coalesce(q -> entry.list_key, '[]'::jsonb)),
        'aged', case when entry.aged_key is null then null else
          (select count(*) from jsonb_array_elements(coalesce(q -> entry.list_key, '[]'::jsonb)) i
            where coalesce((i ->> entry.aged_key)::boolean, false)) end);
    exception when others then
      out_items := out_items || jsonb_build_object('queue', entry.queue, 'state', 'error', 'count', null, 'aged', null);
    end;
  end loop;
  -- Finance: "restricted" only when the finance-authority check denies the caller; a failed read
  -- after that check passes is an error, like any other queue.
  begin
    perform public.money_require_finance(actor);
    begin
      q := public.money_finance_reconciliation();
      out_items := out_items || jsonb_build_object('queue', 'finance_exceptions', 'state', 'ready',
        'count', jsonb_array_length(coalesce(q -> 'exceptions', '[]'::jsonb)), 'aged', null);
    exception when others then
      out_items := out_items || jsonb_build_object('queue', 'finance_exceptions', 'state', 'error', 'count', null, 'aged', null);
    end;
  exception when insufficient_privilege then
    out_items := out_items || jsonb_build_object('queue', 'finance_exceptions', 'state', 'restricted', 'count', null, 'aged', null);
  end;
  return jsonb_build_object('checked_at', now(), 'queues', out_items);
end $$;
