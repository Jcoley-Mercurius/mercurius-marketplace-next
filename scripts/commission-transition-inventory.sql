-- DEC-2026-067 / TRACE-160: read-only transition inventory for the pilot standard commission.
-- Counts only; returns no customer, provider or payment identifiers. Run before and after the
-- hosted push of 20261201001000 (governance/PILOT-COMMISSION-10.md §7):
--   npx supabase db query --linked -f scripts/commission-transition-inventory.sql
-- Before the push the policy and stamp columns do not exist; those lines report "not applied".
with
snap as (
  select s.id, s.obligation_id,
    exists (select 1 from public.money_checkout_attempts a where a.snapshot_id = s.id) as has_checkout,
    exists (select 1 from public.money_checkout_attempts a where a.snapshot_id = s.id and a.status = 'captured') as captured,
    exists (select 1 from public.money_snapshot_promotions p where p.snapshot_id = s.id) as promoted,
    s.expires_at > now() as unexpired
  from public.money_snapshots s
  join public.money_obligations o on o.current_snapshot_id = s.id
)
select 'current snapshots' as item, count(*)::text as value from snap
union all select 'current snapshots paid (captured checkout)', count(*) filter (where captured)::text from snap
union all select 'current snapshots with a checkout attempt, not captured', count(*) filter (where has_checkout and not captured)::text from snap
union all select 'current snapshots published, no checkout attempt, unexpired (stay 15% unless republished)', count(*) filter (where not has_checkout and unexpired)::text from snap
union all select 'current snapshots published, no checkout attempt, expired', count(*) filter (where not has_checkout and not unexpired)::text from snap
union all select 'current snapshots with a promotion', count(*) filter (where promoted)::text from snap
union all select 'recurring visits with a money snapshot', count(*)::text from public.money_recurring_occurrence_identities
union all select 'promotion reservations (reserved, unpaid)', count(*)::text from private.promotion_redemptions where status = 'reserved'
union all select 'promotion redemptions finalized', count(*)::text from private.promotion_redemptions where status = 'finalized'
union all select 'promotion reservations by rate (bps:count)', coalesce(string_agg(rate || ':' || n, ', ' order by rate), 'none')
  from (select commission_rate_bps as rate, count(*) as n from private.promotion_redemptions where status = 'reserved' group by 1) r
union all select 'promotions gate open', coalesce((select enabled::text from private.money_feature_gates where name = 'promotions_checkout'), 'missing')
union all select 'approved, unretired promotion offers', count(*)::text from private.promotion_offers where status = 'approved' and retired_at is null
union all select 'ACH items prepared', count(*)::text from public.money_ach_items
union all select 'legacy invoices (stored amounts, not recomputed)', count(*)::text from public.invoices
union all select 'migration 20261201001000 applied',
  (exists (select 1 from supabase_migrations.schema_migrations where version = '20261201001000'))::text
union all select 'snapshot stamps (bps:count)',
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'money_snapshots' and column_name = 'commission_rate_bps')
    then (select coalesce(string_agg(x, ', '), 'none') from (
      select (j->>'commission_rate_bps') || ':' || count(*) as x from public.money_snapshots s, lateral (select to_jsonb(s) j) l group by j->>'commission_rate_bps' order by 1) y)
    else 'not applied' end
union all select 'commission policy in force (standard/promotional bps, effective)',
  case when to_regclass('private.money_commission_policies') is not null
    -- Dynamic, so the script still parses before the table exists.
    then (xpath('/row/v/text()', query_to_xml($q$select string_agg(standard_bps || '/' || promotional_bps || ' @ ' || effective_at, '; '
      order by effective_at, id) as v from private.money_commission_policies$q$, false, true, '')))[1]::text
    else 'not applied' end;
