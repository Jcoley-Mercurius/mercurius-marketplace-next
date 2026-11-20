import { NextResponse } from "next/server";
import { isProbeChoice, probeVerdict, type ProbeReadback } from "@/lib/emailEvidence/acceptance";
import { probeConfigured, probeGate, sendProbe } from "@/lib/emailEvidence/probe";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
  type OperationalErrorCode,
  type OperationalOutcome,
} from "@/lib/observability/operationalLog";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// TRACE-155 (Phase 7.3D-1, R3D-4): the restricted delivery-evidence probe. Disabled by default:
// unless EMAIL_EVIDENCE_PROBES_ENABLED is exactly "true" (and the deployment is Production, or not
// on Vercel), it answers 404 before reading the request. Every invocation then needs a signed-in
// operator, checked by the database. The body names one enumerated probe and nothing else; the
// recipient, content, headers and key are fixed on the server. One invocation makes at most one
// provider request and is never retried. The response carries the probe's own unlinked receipts
// from the database (transport evidence only), never the provider email ID, recipient or payload,
// and nothing about it is logged beyond the outcome.
const ROUTE = "email_evidence_probe" as const;
const MAX_BODY_BYTES = 256;

function refuse(
  trace: { route: typeof ROUTE; correlationId: string },
  startedAt: number,
  status: number,
  message: string,
  outcome: OperationalOutcome,
  errorCode?: OperationalErrorCode,
  error?: unknown,
) {
  logOperationalEvent({ ...trace, event: "email_probe.refused", outcome, errorCode, error, durationMs: elapsedSince(startedAt) });
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  const startedAt = Date.now();
  const trace = { route: ROUTE, correlationId } as const;

  const gate = probeGate();
  if (!gate.open) {
    return refuse(trace, startedAt, 404, "Not found.", "refused",
      gate.reason === "disabled" ? "probe_disabled" : "probe_environment_refused");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return refuse(trace, startedAt, 401, "Sign in to run delivery-evidence tests.", "unauthenticated");
  const { error: authorizeError } = await supabase.rpc("email_evidence_probe_authorize");
  if (authorizeError) {
    return authorizeError.code === "42501"
      ? refuse(trace, startedAt, 403, "Only an operator can run delivery-evidence tests.", "forbidden", undefined, authorizeError)
      : refuse(trace, startedAt, 503, "The test could not be authorized. Nothing was sent.", "failed", undefined, authorizeError);
  }

  // Exactly {"choice": "<one probe>"}: any other field (recipient, URL, header, content, ledger
  // reference, claim) refuses the whole request. The rejected input is not logged.
  const raw = await request.text().catch(() => "");
  let body: unknown = null;
  if (raw.length <= MAX_BODY_BYTES) {
    try { body = JSON.parse(raw); } catch { body = null; }
  }
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  const choice = (body as { choice?: unknown } | null)?.choice;
  if (keys.length !== 1 || keys[0] !== "choice" || !isProbeChoice(choice)) {
    return refuse(trace, startedAt, 400, "Choose one of the listed test addresses.", "invalid", "validation_failed");
  }

  if (!probeConfigured()) {
    return refuse(trace, startedAt, 503, "Delivery-evidence tests are not configured on this deployment. Nothing was sent.", "refused", "config_missing");
  }

  const result = await sendProbe(choice, new Date());
  if (!result.ok) {
    logOperationalEvent({
      ...trace,
      event: "email_probe.failed",
      outcome: result.definite ? "failed" : "unknown",
      errorCode: result.definite ? "provider_refused" : "provider_timeout_or_network",
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json(
      result.definite
        ? { state: "failed", message: "Resend refused the test email. It was not retried." }
        : { state: "unknown", message: "The test email's result is unknown. It was not retried; check the Resend log before trying again." },
      { status: 502 },
    );
  }
  logOperationalEvent({ ...trace, event: "email_probe.sent", outcome: "sent", durationMs: elapsedSince(startedAt) });

  if (!result.id) {
    return NextResponse.json({ state: "sent", choice, readback: null, verdict: null });
  }
  const { data, error: readError } = await supabase.rpc("email_evidence_probe_readback", { p_provider_email_id: result.id });
  if (readError || !data) {
    return NextResponse.json({ state: "sent", choice, readback: null, verdict: null });
  }
  const readback = data as ProbeReadback;
  return NextResponse.json({ state: "sent", choice, readback, verdict: probeVerdict(readback, choice) });
}
