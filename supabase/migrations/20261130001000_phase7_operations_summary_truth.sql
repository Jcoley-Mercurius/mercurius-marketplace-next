-- Phase 7.5B (TRACE-159): operations overview summary truth repair. Function-only.
-- Contract: governance/PHASE-7-OPERATIONS-QUEUES-CONTRACT.md §8 (OQ-1, DF-1 and DF-2).
--
-- Restates public.admin_operations_summary() from 20261109001000 with exactly two changes:
--   DF-1  fulfillment has no aging rule beyond entry (admin_fulfillment_queue emits no `aged` field),
--         so its aged key is null and the row reports aged null, as cancellation does. Before this,
--         the summary counted a field that never exists and always reported 0.
--   DF-2  the offers-at-other-terms queue (admin_offer_terms_queue, added after the summary) is
--         summarized from its `items` list, with no aged rule, inside the same per-queue
--         `exception when others` error handling. It is appended after the existing queues, so the
--         existing rows keep their order and finance stays last.
-- Everything else is unchanged: admin check, security definer, empty search_path, finance
-- restricted/error handling, nothing written. CREATE OR REPLACE keeps the owner and the grants
-- (20261108001000: no PUBLIC or anon execute; authenticated execute).
-- Rollback is a forward migration restoring the 20261109001000 body; no data is written here.
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
    ('offer_terms', 'items', null)) v(queue, list_key, aged_key)
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
        when 'offer_terms' then public.admin_offer_terms_queue() end;
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
