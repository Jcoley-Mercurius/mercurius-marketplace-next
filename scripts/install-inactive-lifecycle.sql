-- REVIEW TEMPLATE ONLY: never executed by migrations/reset/CI.
-- Required psql variables: job_name and cadence, approved for the target environment.
-- Preconditions: pg_cron, pg_net and Vault installed; no duplicate external scheduler;
-- Vault names mercurius_lifecycle_url, mercurius_lifecycle_gateway_jwt and
-- mercurius_lifecycle_worker_secret provisioned through an approved secret store.
-- Do not place secret values in this file, cron command text, shell history or logs.
\set ON_ERROR_STOP on
begin;
create or replace function private.dispatch_lifecycle_worker()
returns bigint language plpgsql security definer
set search_path=public,private,pg_temp as $$
declare endpoint text; gateway_jwt text; worker_secret text; request_id bigint;
begin
  select decrypted_secret into strict endpoint from vault.decrypted_secrets where name='mercurius_lifecycle_url';
  select decrypted_secret into strict gateway_jwt from vault.decrypted_secrets where name='mercurius_lifecycle_gateway_jwt';
  select decrypted_secret into strict worker_secret from vault.decrypted_secrets where name='mercurius_lifecycle_worker_secret';
  if endpoint !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/job-lifecycle-worker$'
    or length(gateway_jwt)=0 or length(worker_secret)=0 then
    raise exception 'Lifecycle transport configuration is incomplete';
  end if;
  select net.http_post(url:=endpoint,
    headers:=jsonb_build_object('Authorization','Bearer '||gateway_jwt,
      'x-worker-secret',worker_secret,'Content-Type','application/json'),
    body:='{}'::jsonb,timeout_milliseconds:=10000) into request_id;
  return request_id;
end;
$$;
revoke all on function private.dispatch_lifecycle_worker() from public,anon,authenticated;

-- A repeat install is an error rather than silently changing an existing job.
select set_config('mercurius.install_job_name', :'job_name', true);
do $$ begin
  if exists(select 1 from cron.job where jobname=current_setting('mercurius.install_job_name')) then
    raise exception 'Named lifecycle job already exists; inspect it before updating';
  end if;
end $$;
select cron.schedule(:'job_name', :'cadence', 'select private.dispatch_lifecycle_worker();') as installed_job_id \gset
select cron.alter_job(:installed_job_id, active:=false);
-- The initial active value is never visible outside this transaction.
select jobid,jobname,schedule,active from cron.job where jobid=:installed_job_id;
commit;

-- Activation is intentionally absent. JOB_LIFECYCLE_ENABLED also defaults false.
-- Cron SQL success/queued pg_net ID is NOT worker success. Inspect the HTTP result
-- in net._http_response and its lifecycle_worker_runs entry without exporting headers.
