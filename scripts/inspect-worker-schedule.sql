-- Read-only operational metadata. Never return command text, headers, tokens,
-- decrypted secrets, customer rows, or job execution output.
SELECT (SELECT count(*) FROM cron.job) AS total_job_count,
  count(*) AS worker_job_count,
  coalesce(jsonb_agg(worker ORDER BY jobid), '[]'::jsonb) AS worker_jobs
FROM (
SELECT jobid, jobname, schedule, active,
  position('job-lifecycle-worker' in command) > 0 AS targets_worker,
  position('vugqqyemuptlvcieihww.supabase.co/functions/v1/job-lifecycle-worker' in command) > 0 AS targets_expected_project,
  position('authorization' in lower(command)) > 0 AS has_authorization_header,
  position('x-worker-secret' in lower(command)) > 0 AS has_worker_secret_header,
  position('internal_worker_tokens' in command) > 0 AS reads_private_worker_token,
  position('vault.decrypted_secrets' in command) > 0 AS reads_vault,
  command ~ 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' AS contains_literal_jwt
FROM cron.job
WHERE command LIKE '%job-lifecycle-worker%'
) AS worker;
