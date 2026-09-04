#!/bin/sh
set -eu
export PATH="/home/josh/.nvm/versions/node/v24.17.0/bin:$PATH"
export MERCURIUS_BUILD_WORKERS=1
export PATH="$PWD/.phase5-local/tools-linux/node_modules/.bin:$PATH"
test "$(supabase --version)" = "2.116.0"
case "${1:-}" in
  start) supabase start --workdir .phase5-local --exclude studio,imgproxy,edge-runtime,logflare,vector,realtime,supavisor > .phase5-local/start.log 2>&1 || { echo 'Isolated start failed; inspect ignored start.log without printing credentials.'; exit 1; } ;;
  reset) supabase db reset --local --workdir .phase5-local ;;
  test) supabase test db --workdir .phase5-local ;;
  stop) supabase stop --workdir .phase5-local ;;
  *) echo 'Use start, reset, test or stop for the isolated Phase 5 stack only.'; exit 1 ;;
esac
