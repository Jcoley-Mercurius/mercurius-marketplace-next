import { createClient } from "@supabase/supabase-js";
import {
  createExactDecoder,
  createSvixVerifier,
  handleResendWebhook,
  methodNotAllowed,
  type ReceiveParams,
  type ResendWebhookDeps,
} from "@/lib/emailEvidence/resendWebhook";
import { getResendWebhookEnvironment, getServiceSupabaseEnvironment } from "@/lib/env/server";
import { createCorrelationId, logOperationalEvent } from "@/lib/observability/operationalLog";

// TRACE-155 (Phase 7.3B): Resend webhook receiver, DORMANT. Without RESEND_WEBHOOK_SECRET it
// answers 503 and reads nothing. No webhook is registered and no secret is configured by this
// slice; arming is the separately authorized 7.3D step. The proxy does not match this path.
export const runtime = "nodejs";

// The receipt is written with the service key only (plan §11.2). The client is built after
// authentication, so an unarmed or rejected request never touches the database.
async function receive(params: ReceiveParams): Promise<unknown> {
  const env = getServiceSupabaseEnvironment();
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("email_receive_provider_event", params);
  if (error) throw error;
  return data;
}

const deps: ResendWebhookDeps = {
  secrets: () => getResendWebhookEnvironment(),
  createVerifier: createSvixVerifier,
  createDecoder: createExactDecoder,
  receive,
  log: logOperationalEvent,
  correlationId: createCorrelationId,
  now: Date.now,
};

export async function POST(request: Request) {
  return handleResendWebhook(request, deps);
}

// Anything other than POST is refused before configuration or the body are read.
export async function GET() {
  return methodNotAllowed();
}
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
