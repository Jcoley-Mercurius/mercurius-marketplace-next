-- Phase 2 canonical client grants.
-- RLS remains the row-level authorization boundary; client roles do not need
-- schema-management, table-maintenance, trigger, truncate, or sequence-update
-- capabilities.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Anonymous clients only need public discovery and the two public intake forms.
GRANT SELECT ON TABLE
  public.service_categories, public.services_catalog, public.coverage_areas,
  public.featured_providers, public.smart_picks, public.vendor_packages,
  public.package_tiers, public.package_qualifying_questions,
  public.package_addons, public.contractor_gallery,
  public.contractor_service_zips
TO anon;
GRANT INSERT ON TABLE public.contact_submissions, public.vendor_applications TO anon;

-- Public contractor discovery must never expose direct contact information.
-- A table-level SELECT would override column revocations, so replace it with
-- an explicit safe projection for both browser-facing roles.
REVOKE SELECT ON TABLE public.contractors FROM anon, authenticated;
GRANT SELECT (
  id, name, logo_url, bio, location, rating, badges, services,
  years_experience, jobs_completed, is_active, created_at, updated_at,
  user_id, marketing_enabled, special_offer, our_promise, verified_specialty,
  payouts_paused, payouts_paused_reason, payouts_paused_at,
  video_url, website, tagline
) ON TABLE public.contractors TO anon, authenticated;

-- Anonymous review readers may see public review content, but not the
-- homeowner identity behind it. Authenticated access remains governed by RLS.
REVOKE SELECT ON TABLE public.reviews FROM anon;
GRANT SELECT (
  id, service_request_id, contractor_id, rating, comment, created_at,
  visibility, google_prompt_shown, google_prompt_clicked,
  vendor_acknowledged_at
) ON TABLE public.reviews TO anon;

-- These tables are internal processing state and have no direct client API.
REVOKE ALL ON TABLE public.internal_worker_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Public read-only pricing/provider projections.
GRANT EXECUTE ON FUNCTION public.find_public_eligible_providers(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_job_counts(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_server_now() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_package_tier_price(uuid, uuid) TO anon, authenticated;

-- Authenticated application RPC surface. Each function performs its own actor
-- or ownership checks in addition to underlying table RLS.
GRANT EXECUTE ON FUNCTION public.admin_assign_contractor(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_contractor_linked_email(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_contractor_to_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_contractor_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, public.dispute_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_quote(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlink_contractor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_job_offer(uuid, uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_matches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_eligible_packages(uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contractor_contact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendor_earnings_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendor_operational_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_confirm_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_raise_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_respond_to_quote(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offer_next_for_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_request_matching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job_review(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_google_prompt(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_job_status(uuid, public.request_status, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_accept_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_complete_job(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_decline_job(uuid, text) TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Future objects are closed by default. Migrations must opt client roles into
-- the exact table and function capabilities their RLS/RPC tests cover.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;
