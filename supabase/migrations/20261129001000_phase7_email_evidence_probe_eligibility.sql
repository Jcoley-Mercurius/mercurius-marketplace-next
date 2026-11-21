-- TRACE-155 (Phase 7.3D-1 review fixes, D-11): whole-provider-ID probe exclusion, with logical expiry.
--
-- Record: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1-REVIEW-FIXES.md. Forward repair of
-- 20261128001000, which is applied and is not edited.
--
-- The 7.3D-1 record (D-11) says a provider email ID whose receipts include any linked, tagged or
-- conflicted receipt is not probe evidence, and none of its receipts is returned. The shipped
-- readback checked only `identity_class <> 'unmatched' or tag_ledger is not null`. So:
--   - an unmatched receipt carrying the permanent content-conflict flag did not exclude its ID,
--     and an otherwise valid expected-event receipt for the same ID was still returned beside it;
--   - an expired receipt (logically gone, awaiting purge) still excluded its ID.
--
-- This restates public.email_evidence_probe_readback(text) only. Same signature, return type,
-- keys, security definer, empty search_path and grants. Eligibility reads each receipt through
-- the one trust and expiry predicate, private.email_evidence_receipt_state (20261125002000):
--   - an expired receipt (expires_at <= now()) is ignored entirely, for eligibility and output;
--   - an unexpired receipt disqualifies the whole ID if it is
--       linked      identity_class id_only, tag_only or tag_and_id (state trusted or current_conflict),
--       tagged      any stored tag (tag_ledger is not null), or
--       conflicted  state stored_conflict, content_conflict or current_conflict;
--   - otherwise every unexpired receipt for the ID is `unlinked` and is returned.
-- A disqualified ID returns `not_probe = true` and no receipts, so no verdict can be drawn from
-- it. The key name is kept so the deployed route keeps working between this push and the merge.
--
-- Not changed: every other function, table, trigger and grant. Nothing is armed, sent, purged,
-- linked or rematched.

set lock_timeout = '2s';

create or replace function public.email_evidence_probe_readback(p_provider_email_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare not_probe boolean; receipts jsonb;
begin
  perform public.vendor_require_operator();
  if p_provider_email_id is null or p_provider_email_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    raise exception 'A provider email ID is required' using errcode = '22023';
  end if;
  -- Whole-ID exclusion over unexpired receipts only (D-11, logical expiry).
  select exists (select 1 from private.email_provider_events e
                   cross join lateral (select private.email_evidence_receipt_state(e) as state) s
                  where e.provider_email_id = p_provider_email_id
                    and s.state <> 'expired'
                    and (e.identity_class in ('id_only', 'tag_only', 'tag_and_id')
                         or e.tag_ledger is not null
                         or s.state in ('stored_conflict', 'content_conflict', 'current_conflict')))
    into not_probe;
  if not not_probe then
    select coalesce(jsonb_agg(jsonb_build_object(
             'event_type', e.event_type,
             'fact', private.email_evidence_fact(e.event_type, e.bounce_type),
             'bounce_type', e.bounce_type,
             'bounce_subtype', e.bounce_subtype,
             'provider_created_at', e.provider_created_at,
             'received_at', e.received_at,
             'state', s.state)
           order by e.provider_created_at nulls last, e.received_at, e.svix_id), '[]'::jsonb)
      into receipts
      from private.email_provider_events e
      cross join lateral (select private.email_evidence_receipt_state(e) as state) s
     where e.provider_email_id = p_provider_email_id and s.state = 'unlinked';
  end if;
  return jsonb_build_object('checked_at', now(), 'not_probe', not_probe,
                            'receipts', coalesce(receipts, '[]'::jsonb));
end $$;

-- Unchanged privileges, restated so the file is self-describing (create or replace keeps them).
revoke all on function public.email_evidence_probe_readback(text) from public, anon, authenticated, service_role;
grant execute on function public.email_evidence_probe_readback(text) to authenticated;

reset lock_timeout;
