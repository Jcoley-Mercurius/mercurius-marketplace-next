-- Phase 7.5G-2 (TRACE-159): the sourcing queue, as a server reader and an overview row.
-- Plan: governance/PHASE-7-SOURCING-QUEUE-PLAN-7-5G-2.md (revision 2; Codex SG-1..SG-9; OD-4a,
-- DEC-2026-070). Function-only. Nothing is written by either function, and no table, column, index,
-- trigger, policy or grant on a table changes. The matcher and every matching command are untouched.
--
-- 1. public.admin_sourcing_queue() returns {checked_at, items}. A request is listed when
--    status = 'pending' and matching_status is 'exhausted', 'awaiting_consent' or 'sourcing' (E-1).
--    needs_admin_review is not required (SG-1). Excluded: any other status, even with 'exhausted'
--    and the flag still set (X-1, cancellation leaves both); 'awaiting_match', including
--    rematch_failed (X-2); 'offered' with a pending offer, including one past expires_at that
--    nothing has settled (X-3, SG-4: nothing here settles an offer); 'matched', 'awaiting_terms',
--    'awaiting_homeowner', 'quote_pending' (X-4).
--    Each item:
--      request_id        the request;
--      kind              'exhausted' | 'awaiting_consent' (a candidate exists; the homeowner has
--                        not consented to a fallback provider; never counted as exhausted, SG-8) |
--                        'legacy_sourcing' (set only by the superseded Phase 1 matcher; its own kind,
--                        SG-5);
--      related_event_at  the time of the latest related stored event (SG-2). It is not a time the
--      related_event     request entered this queue, an exhaustion time or a bound on either:
--                        'provider_operation'  latest job_operations.created_at with kind
--                                              'provider_cancel' or 'no_show' (when it was recorded);
--                        'offer_closed'        latest greatest(declined_at, withdrawn_at,
--                                              responded_at) over attempts with outcome 'declined',
--                                              'expired' or 'withdrawn' ('accepted' is not a closing
--                                              event; an expiry's time is when it was processed, not
--                                              expires_at);
--                        'request_created'     service_requests.created_at, when neither exists.
--                        The later of the first two is taken; on equal times 'provider_operation'
--                        (P-5 writes the operation and the attempt's withdrawn_at with one now()).
--                        updated_at is never used.
--      plan_visit        recurrence_parent_id is not null, the test the matcher and
--                        record_job_operation use (SG-6). Information only: no reassignment
--                        authority is added anywhere.
--      offer_terms_block true exactly when admin_offer_terms_queue() lists the request as
--                        'blocked_inactive': pending, exhausted, and its latest offer_terms_blocks row
--                        has no offer_terms_retries row strictly later (SG-3). The queues overlap and
--                        are never summed as unique requests.
--    Order: related_event_at, then request_id. No customer, address, ZIP, service, price, provider or
--    candidate field; offer_terms_blocks.candidates is not read. No threshold, aged flag or due time
--    (OD-6). Admin only, through private.require_admin() (42501 otherwise). STABLE.
-- 2. public.admin_operations_summary() restated from 20261205001000 with one change: the 'sourcing'
--    row, read from the function above with no aged rule, appended after 'applications' inside the
--    same per-queue error handling (SG-7). Finance stays last and keeps its restricted/error
--    handling; every other row and the order are unchanged. CREATE OR REPLACE keeps its owner and
--    grants (no PUBLIC or anon execute; authenticated execute).
-- Rollback: a forward migration restoring the 20261205001000 summary body; the new reader can be
-- left in place or revoked. No data is written here, so nothing needs repair.

create function public.admin_sourcing_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object('checked_at', now(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'request_id', x.id, 'kind', x.kind, 'related_event_at', x.related_event_at, 'related_event', x.related_event,
        'plan_visit', x.plan_visit, 'offer_terms_block', x.offer_terms_block)
      order by x.related_event_at, x.id)
    from (
      select r.id,
        case r.matching_status when 'exhausted' then 'exhausted' when 'awaiting_consent' then 'awaiting_consent'
          else 'legacy_sourcing' end as kind,
        case when op.at is null and closed.at is null then r.created_at else greatest(op.at, closed.at) end as related_event_at,
        case when op.at is null and closed.at is null then 'request_created'
          when op.at is not null and (closed.at is null or op.at >= closed.at) then 'provider_operation'
          else 'offer_closed' end as related_event,
        r.recurrence_parent_id is not null as plan_visit,
        r.matching_status = 'exhausted' and exists(
          select 1 from (select b.created_at from private.offer_terms_blocks b where b.request_id = r.id
              order by b.created_at desc, b.id desc limit 1) latest
            where not exists(select 1 from private.offer_terms_retries t
              where t.request_id = r.id and t.created_at > latest.created_at)) as offer_terms_block
      from public.service_requests r
      left join lateral (select max(o.created_at) as at from public.job_operations o
        where o.job_id = r.id and o.kind in ('provider_cancel', 'no_show')) op on true
      left join lateral (select max(greatest(a.declined_at, a.withdrawn_at, a.responded_at)) as at
        from public.job_match_attempts a
        where a.service_request_id = r.id and a.outcome in ('declined', 'expired', 'withdrawn')) closed on true
      where r.status = 'pending' and r.matching_status in ('exhausted', 'awaiting_consent', 'sourcing')
    ) x
  ), '[]'::jsonb));
end $$;

revoke all on function public.admin_sourcing_queue() from public, anon, authenticated, service_role;
grant execute on function public.admin_sourcing_queue() to authenticated;

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
    ('offer_terms', 'items', null), ('applications', 'items', null), ('sourcing', 'items', null)) v(queue, list_key, aged_key)
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
        when 'applications' then public.admin_application_review_queue()
        when 'sourcing' then public.admin_sourcing_queue() end;
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
