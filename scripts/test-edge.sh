#!/bin/sh
set -eu
for edge in beta-access checkout-request create-checkout customer-portal job-lifecycle-worker list-payment-methods loyalty-recommend refund-invoice stripe-webhook vendor-application-notify vendor-invite; do
  deno test --frozen --config "supabase/functions/$edge/deno.json" --allow-env --allow-read=supabase/functions,supabase/runtime-tests supabase/runtime-tests/handler_test.ts -- "$edge"
done
