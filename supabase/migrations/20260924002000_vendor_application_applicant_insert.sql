-- TRACE-086: remove the direct applicant insert path to vendor applications (owner
-- decision 2026-09-24).
--
-- The 2026-03-16 policy "Anyone can submit vendor application" (last replaced 2026-07-31)
-- let any anonymous or signed-in client insert a pending, uninvited vendor_applications row
-- directly, backed by INSERT grants to anon and authenticated (2026-07-31, and the
-- 2026-09-03 Phase 2 client grants). The application form does not use it: /vendors/apply posts to
-- /api/vendor-applications, which validates the application, inserts with the service key,
-- issues signed document upload URLs and notifies the owner.
--
-- A direct insert skipped that validation, the owner notification and the upload grant, and
-- could set any column the policy does not check, including document_urls. It still fired
-- the admin notification trigger, so it placed a pending application with no uploaded
-- documents in the admin queue. The policy is dropped and the grants revoked; the route is
-- the only way to create an application. Admin SELECT, the service key's privileges, the
-- notification and intake triggers, and contact_submissions are unchanged.

drop policy if exists "Anyone can submit vendor application" on public.vendor_applications;
revoke insert on public.vendor_applications from anon, authenticated;
