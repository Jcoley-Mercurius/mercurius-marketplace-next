-- Read-only. Fingerprint of the deployed functions that decide promotional money: eligibility and
-- the eligible amount, the split, reservation lifecycle, the commercial source, the snapshot,
-- capture/refund postings, proceeds, ACH, chargebacks and reconciliation (TRACE-112–116).
-- The two-person finance review records this value (governance/PRICING-FINANCE-REVIEW.md §10);
-- before the promotions gate is opened, the value on production must equal the signed-off one.
-- A different value means a listed function changed after review and needs review again.
-- Usage: npx supabase db query --linked -f scripts/promotion-money-fingerprint.sql
--    or: psql "$DB_URL" -At -f scripts/promotion-money-fingerprint.sql
select count(*) as functions, md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))) as fingerprint
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('private','promotion_economics'), ('private','promotion_discount'), ('private','promotion_usage'), ('private','promotion_evaluate'),
  ('private','promotion_request_context'), ('private','promotion_reserve'), ('private','promotion_finalize'), ('private','promotion_commit'),
  ('private','promotion_restore_after_refund'), ('private','promotion_release_on_cancel'), ('private','promotion_release_unpaid'),
  ('private','run_promotion_release_sweep'), ('private','promotion_has_completed_service'), ('private','promotion_redemption_problem'),
  ('private','promotion_request_locked'), ('private','money_gate'), ('private','money_split'), ('private','money_provider_proceeds'),
  ('private','money_source'), ('private','money_publish_snapshot'), ('private','money_payable'), ('private','money_payout_proceeds'),
  ('private','money_ach_payable'), ('private','money_ach_exceeds_proceeds'), ('private','money_prepare_ach'), ('private','money_refund_reversal'),
  ('private','money_obligation_reconciliation'), ('private','price_selection'), ('private','package_content'), ('private','package_revision_hash'),
  ('private','find_eligible_packages_core'),
  ('public','money_publish_snapshot'), ('public','money_check_journal'), ('public','money_process_payment_event'),
  ('public','money_resolve_chargeback_loss'), ('public','admin_restore_promotion'), ('public','submit_service_requests'),
  ('public','homeowner_choose_request_promotion'), ('public','create_service_occurrence'),
  -- TRACE-123: carries the priced add-on selection into recurring visits (replaces create_service_occurrence).
  ('public','admin_create_recurring_visit'),
  -- TRACE-124: the 6.6a body moved into the shared core; the cadence path also reaches it.
  ('private','create_recurring_visit_core'), ('public','admin_create_cadence_visit'),
  -- TRACE-125: a visit's commercial source is its bound plan terms, checked by one shared rule whose
  -- refusal text comes from the problem helper (money_source, already listed, is restated with the
  -- visit branch). The read-only payment state and queue functions are listed in the finance review.
  ('private','recurring_visit_terms'), ('private','recurring_visit_source_check'), ('private','recurring_visit_payment_problem'),
  -- TRACE-127 (CS-4): acceptance writes the visit's amounts from its offer and now judges a visit with
  -- bound terms by the payment rule; the rule moved into recurring_visit_offer_problem, and whether the
  -- bound offering is still offered is bound_offering_problem.
  ('public','vendor_accept_job'), ('private','recurring_visit_offer_problem'), ('private','bound_offering_problem'),
  -- CS-3 (TRACE-126): a one-time request is accepted and checked out at the terms bound at its
  -- submission; that rule is one_time_bound_problem (money_source and vendor_accept_job, above).
  ('private','one_time_bound_problem'),
  -- O-10 (TRACE-150, DEC-2026-063): an offer at other terms binds its price when it is created
  -- (create_job_offer_internal writes the request's price from offer_terms_build, chosen by
  -- one_time_offer_basis); payment needs the homeowner's answer to that exact offer, terms row and
  -- consent hash (homeowner_respond_offer_terms, or homeowner_respond_replacement for an E6
  -- replacement), judged by offer_terms_problem against offer_terms_current.
  ('private','create_job_offer_internal'), ('private','offer_terms_build'), ('private','one_time_offer_basis'),
  ('private','offer_terms_consent_hash'), ('private','offer_terms_problem'), ('private','offer_terms_current'),
  ('public','homeowner_respond_offer_terms'), ('public','homeowner_respond_replacement'));
