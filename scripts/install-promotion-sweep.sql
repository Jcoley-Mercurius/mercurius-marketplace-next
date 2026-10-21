-- REVIEW TEMPLATE (TRACE-116, DEC-2026-042): outside migrations/reset. Installs the unpaid
-- promotion-reservation cleanup as an INACTIVE pg_cron job. Activation is a separate,
-- owner-authorized statement (governance/PRICING-FINANCE-REVIEW.md §6).
-- Required psql variables: job_name and cadence, approved for the target environment, e.g.
--   psql "$DB_URL" -v job_name=mercurius-promotion-release-sweep -v cadence='*/15 * * * *' -f scripts/install-promotion-sweep.sql
-- Preconditions: pg_cron installed; migration 20261018006000 applied; no other scheduler
-- calls private.run_promotion_release_sweep(). The job runs SQL only: no HTTP, no secrets.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if to_regprocedure('private.run_promotion_release_sweep()') is null then
    raise exception 'Migration 20261018006000 is not applied';
  end if;
end $$;

-- A repeat install is an error rather than silently changing an existing job.
select set_config('mercurius.install_job_name', :'job_name', true);
do $$ begin
  if exists (select 1 from cron.job where jobname = current_setting('mercurius.install_job_name')) then
    raise exception 'Named promotion sweep job already exists; inspect it before updating';
  end if;
  if exists (select 1 from cron.job where command ilike '%run_promotion_release_sweep%') then
    raise exception 'Another job already runs the promotion sweep; inspect it before installing';
  end if;
end $$;
select cron.schedule(:'job_name', :'cadence', 'select private.run_promotion_release_sweep();') as installed_job_id \gset
select cron.alter_job(:installed_job_id, active := false);
-- The initial active value is never visible outside this transaction.
select jobid, jobname, schedule, command, active from cron.job where jobid = :installed_job_id;
commit;

-- Activation is intentionally absent. After the owner authorizes it:
--   select cron.alter_job((select jobid from cron.job where jobname = 'mercurius-promotion-release-sweep'), active := true);
-- Success is a 'completed' row in private.promotion_sweep_runs and 'succeeded' in
-- cron.job_run_details, not the cron.schedule return value.
