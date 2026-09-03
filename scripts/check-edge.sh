#!/bin/sh
set -eu
# Run with Deno 2.9.6 on PATH. All checks are local; package fetches happen only
# during dependency resolution. Do not run provider endpoints to test imports.
for edge in beta-access checkout-request create-checkout customer-portal job-lifecycle-worker list-payment-methods loyalty-recommend refund-invoice stripe-webhook vendor-application-notify vendor-invite; do
  deno check --frozen --config "supabase/functions/$edge/deno.json" "supabase/functions/$edge/index.ts"
done
