-- TRACE-085: remove the legacy admin write paths to vendor applications and their stored
-- documents (owner decision 2026-09-23).
--
-- The 2026-03-16 policies let any signed-in admin update or delete a vendor_applications
-- row directly, and the 2026-07-31 policies let one overwrite, move or remove any object in
-- the private vendor-documents bucket. Since TRACE-084 the application does neither: a
-- status changes only through vendor_close_application or vendor_start_onboarding_review,
-- applicant document paths are attached by the service-key upload route, files are opened
-- with signed links (SELECT), and retention moves and deletions run through the service-key
-- retention routes after a recorded prepare. Every database writer is SECURITY DEFINER.
--
-- A direct write skipped the closure record, application and provider retention holds,
-- the evidence guard and the retention record, so the four policies are dropped and the
-- table grants that backed the two row policies are revoked. Admin SELECT on both, the
-- applicant INSERT policy on vendor_applications and every other bucket's policies are
-- unchanged.

drop policy if exists "Admins can update applications" on public.vendor_applications;
drop policy if exists "Admins can delete applications" on public.vendor_applications;
revoke update, delete on public.vendor_applications from authenticated;

drop policy if exists "Admins can update vendor documents" on storage.objects;
drop policy if exists "Admins can delete vendor documents" on storage.objects;
