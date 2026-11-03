-- Phase 6 corrective slice CS-1 / TRACE-138: post-deploy grant cleanup. Record:
-- governance/PHASE-6-CLOSURE-REPORT.md §4.4 W-1, W-2 and §8 CS-1.
-- Additive: privileges only. No table, column, function or stored value is dropped or rewritten,
-- and no money function changes (fingerprint 45 | 34c51131… before and after).
--
-- Both grants were kept only for clients deployed before 6.11B and 6.12B. No client deployed since
-- reads them: the last direct read of contractors.special_offer left in 6.11B (b6021ea) and the last
-- call of get_vendor_earnings_metrics left in 6.12B (c0a19ca). Production and both earlier
-- production deployments (85bb7c6, b5629a6, 015f371) contain those removals.

-- W-1, DEC-2026-055 item 1: the stored text is kept for operator access only. Operators read it
-- through admin_vendor_special_offer (security definer, operator check), which is unchanged.
-- Anonymous reads were revoked in 20261105001000; this closes the signed-in column grant from
-- 20260903160000. There is no table-level SELECT on contractors for either client role.
revoke select (special_offer) on public.contractors from authenticated;

-- W-2, DEC-2026-056 item 1: the legacy-invoice metrics stay in the database, without client
-- execution. Vendors read canonical earnings through vendor_own_earnings(), which is unchanged.
revoke all on function public.get_vendor_earnings_metrics(uuid) from public, anon, authenticated;
