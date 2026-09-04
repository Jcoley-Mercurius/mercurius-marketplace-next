#!/bin/sh
set -eu
# Deliberately fixed local container. Never use --linked or another project's DB.
container=supabase_db_vugqqyemuptlvcieihww
validate_tap() {
  awk '
    BEGIN { plan_count = 0; test_count = 0; failed = 0 }
    /^Bail out!/ { failed = 1 }
    /^1\.\.[0-9]+([[:space:]]*#.*)?$/ {
      plan_count++
      plan = $0
      sub(/^1\.\./, "", plan)
      sub(/[[:space:]]*#.*/, "", plan)
      expected = plan + 0
      next
    }
    /^not ok([[:space:]]|$)/ {
      test_count++
      line = $0
      sub(/^not ok[[:space:]]+/, "", line)
      split(line, fields, /[[:space:]]+/)
      if (fields[1] !~ /^[0-9]+$/ || fields[1] + 0 != test_count) failed = 1
      failed = 1
      next
    }
    /^ok([[:space:]]|$)/ {
      test_count++
      line = $0
      sub(/^ok[[:space:]]+/, "", line)
      split(line, fields, /[[:space:]]+/)
      if (fields[1] !~ /^[0-9]+$/ || fields[1] + 0 != test_count) failed = 1
      next
    }
    /^(not )?ok/ { failed = 1 }
    END {
      if (plan_count != 1 || test_count != expected) failed = 1
      exit failed
    }
  '
}
for file in supabase/tests/*.sql; do
  output=$(docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At < "$file")
  printf '%s\n' "$output" | sed -n '/^ok /p;/^not ok /p;/^1\.\./p;/^Bail out!/p'
  if ! printf '%s\n' "$output" | validate_tap; then
    printf 'Invalid or failing TAP output from %s\n' "$file" >&2
    exit 1
  fi
done
