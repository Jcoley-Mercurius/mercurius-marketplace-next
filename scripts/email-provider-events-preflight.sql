-- TRACE-155 (Phase 7.3B): read-only preflight for migration 20261124001000, run immediately
-- before an independently owner-authorized push (Codex clearance #5920917095). It reads only
-- counts, sizes, lock and session metadata: no ledger row contents, addresses or query text.
-- Usage: npx supabase db query --linked -f scripts/email-provider-events-preflight.sql
--
-- Proceed only if: the 7.3B objects are absent; each ledger is still a few rows and a few
-- pages (2026-11-16 baseline: application 20 rows / 8192 heap bytes; owner email 0 / 0;
-- price-draft notices 0 / 0); no lock is held or awaited on any ledger; and no transaction has
-- been open on the database for more than a few seconds. Otherwise stop: do not retry in a loop,
-- and return to Codex for a nontransactional concurrent-index rollout (7.3B record §7).

select 'ledger' as check, c.relname as name, c.reltuples::bigint as estimated_rows,
       (select count(*) from private.r0_application_notifications) as exact_rows,
       pg_relation_size(c.oid) as heap_bytes, pg_total_relation_size(c.oid) as total_bytes
  from pg_class c where c.oid = 'private.r0_application_notifications'::regclass
union all
select 'ledger', c.relname, c.reltuples::bigint, (select count(*) from private.owner_email_notifications),
       pg_relation_size(c.oid), pg_total_relation_size(c.oid)
  from pg_class c where c.oid = 'private.owner_email_notifications'::regclass
union all
select 'ledger', c.relname, c.reltuples::bigint, (select count(*) from private.package_draft_email_notices),
       pg_relation_size(c.oid), pg_total_relation_size(c.oid)
  from pg_class c where c.oid = 'private.package_draft_email_notices'::regclass;

-- Locks held or awaited on the three ledgers right now (mode and whether granted only).
select 'ledger_lock' as check, c.relname as name, l.mode, l.granted, count(*) as sessions
  from pg_locks l join pg_class c on c.oid = l.relation
 where c.oid in ('private.r0_application_notifications'::regclass, 'private.owner_email_notifications'::regclass,
                 'private.package_draft_email_notices'::regclass)
   and l.pid <> pg_backend_pid()
 group by c.relname, l.mode, l.granted;

-- Open transactions on this database by age (no query text, user or address).
select 'open_transaction' as check, state, count(*) as sessions,
       max(extract(epoch from now() - xact_start))::integer as oldest_seconds
  from pg_stat_activity
 where datname = current_database() and xact_start is not null and pid <> pg_backend_pid()
 group by state;

-- The 7.3B objects must not exist yet.
select 'absent_before_push' as check,
       to_regclass('private.email_provider_events') is null
   and to_regclass('private.email_evidence_config') is null
   and to_regclass('private.email_provider_event_purges') is null
   and to_regclass('private.r0_application_notifications_provider_message_id') is null
   and to_regclass('private.owner_email_notifications_provider_message_id') is null
   and to_regclass('private.package_draft_email_notices_provider_message_id') is null as ok;
