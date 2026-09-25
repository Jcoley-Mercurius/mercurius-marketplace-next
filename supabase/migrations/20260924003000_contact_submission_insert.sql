-- TRACE-087: make the contact route the only writer to contact_submissions, and drop the
-- duplicate admin read policy on vendor-documents (owner decisions 2026-09-24,
-- DEC-2026-012 items 2 and 4).
--
-- The 2026-06-02 policy "Anyone can submit contact form" let any anonymous or signed-in
-- client insert a contact submission directly, backed by INSERT grants to anon (2026-09-03
-- Phase 2 intake grant) and authenticated (the Phase 2 blanket grant). /contact and
-- /request post to /api/contact-submissions, which validates the submission, appends the
-- request context and notifies the owner; it now inserts with the service key. A direct
-- insert skipped that validation and the owner notification. The policy is dropped and the
-- grants revoked, as TRACE-086 did for vendor_applications. The admin read policy and the
-- service key's privileges are unchanged.
--
-- "Admins can review vendor application documents" (2026-08-09) duplicates "Admins can
-- read vendor documents" (2026-07-31): both let an authenticated admin SELECT any object in
-- vendor-documents. The later copy is dropped; admin access does not change.

drop policy if exists "Anyone can submit contact form" on public.contact_submissions;
revoke insert on public.contact_submissions from anon, authenticated;

drop policy if exists "Admins can review vendor application documents" on storage.objects;
