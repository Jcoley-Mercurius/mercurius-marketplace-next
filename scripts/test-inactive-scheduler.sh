#!/bin/sh
set -eu
# Local isolated container only. Synthetic cadence is not production policy.
container=supabase_db_vugqqyemuptlvcieihww
name=phase4_inactive_installer_contract
before=$(docker exec "$container" psql -U postgres -d postgres -Atc "select count(*) from cron.job")
test "$before" = 0
cleanup() {
  docker exec "$container" psql -U postgres -d postgres -Atc "select cron.unschedule(jobid) from cron.job where jobname='$name'" >/dev/null
}
trap cleanup EXIT
docker exec -i "$container" psql -U postgres -d postgres -v job_name="$name" -v cadence='*/15 * * * *' < scripts/install-inactive-lifecycle.sql >/dev/null
inactive=$(docker exec "$container" psql -U postgres -d postgres -Atc "select count(*) from cron.job where jobname='$name' and not active")
test "$inactive" = 1
active=$(docker exec "$container" psql -U postgres -d postgres -Atc "select count(*) from cron.job where active")
test "$active" = 0
# The template must reject a duplicate, not overwrite the reviewed schedule.
if docker exec -i "$container" psql -U postgres -d postgres -v job_name="$name" -v cadence='*/15 * * * *' < scripts/install-inactive-lifecycle.sql >/dev/null 2>&1; then
  echo 'FAIL: duplicate inactive installation accepted'; exit 1
fi
cleanup
after=$(docker exec "$container" psql -U postgres -d postgres -Atc "select count(*) from cron.job")
test "$after" = 0
echo 'PASS: installer committed only an inactive schedule, rejected duplicate installation, and removed only its synthetic job; zero active Cron jobs.'
