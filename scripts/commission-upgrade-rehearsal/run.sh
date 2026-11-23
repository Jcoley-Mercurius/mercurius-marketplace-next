#!/bin/sh
# DEC-2026-067 / TRACE-160: rehearse 20261201001000 across real pre-existing rows.
# LOCAL ISOLATED STACK ONLY (container supabase_db_mercurius-phase5-isolated); never --linked.
#   1. reset the isolated stack to every migration *except* 20261201001000 (as on hosted today);
#   2. pre.sql commits synthetic 15% bookings (paid, refunded, unpaid, promoted, reserved);
#   3. apply 20261201001000 in one transaction, as `supabase db push` does;
#   4. post.sql checks nothing historical moved and new bookings get 10%.
# Leaves the stack reset to the branch afterwards (`sh scripts/phase5-db.sh reset`).
set -eu
container=supabase_db_mercurius-phase5-isolated
migration=20261201001000_pilot_standard_commission.sql
here=$(dirname "$0")
node scripts/prepare-phase5-local.mjs
mv ".phase5-local/supabase/migrations/$migration" .phase5-local/held-migration.sql
trap 'mv .phase5-local/held-migration.sql ".phase5-local/supabase/migrations/$migration" 2>/dev/null || true' EXIT
sh scripts/phase5-db.sh reset > .phase5-local/rehearsal-reset.log 2>&1
docker exec -i "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 < "$here/pre.sql"
docker exec -i "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 --single-transaction < .phase5-local/held-migration.sql
echo "MIGRATION 20261201001000 applied over the 15% bookings"
docker exec -i "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 < "$here/post.sql"
echo "REHEARSAL PASSED"
