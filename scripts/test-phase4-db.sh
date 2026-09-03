#!/bin/sh
set -eu
# Deliberately fixed local container. Never use --linked or another project's DB.
container=supabase_db_vugqqyemuptlvcieihww
for file in supabase/tests/*.sql; do
  output=$(docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At < "$file")
  printf '%s\n' "$output" | sed -n '/^ok /p;/^not ok /p;/^1\.\./p'
  if printf '%s\n' "$output" | grep -q '^not ok '; then exit 1; fi
done
