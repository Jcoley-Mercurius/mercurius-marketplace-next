import { createClient } from "@supabase/supabase-js";
import { after, NextResponse } from "next/server";
import { deliverOwnerEmail } from "@/lib/ownerEmailNotifications";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
} from "@/lib/observability/operationalLog";
import {
  appendRequestContext,
  normalizeRequestId,
} from "@/lib/requestContext";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
import {
  INTAKE_REFUSAL_MESSAGE,
  intakeClientIp,
  intakeGuardRefusal,
  recordIntakeSubmission,
} from "@/lib/intakeProtection";

export const runtime = "nodejs";

type ContactSubmission = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
};

class ContactValidationError extends Error {}

function text(
  value: unknown,
  label: string,
  options: { required?: boolean; max: number },
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (options.required && !normalized) {
    throw new ContactValidationError(`${label} is required.`);
  }
  if (normalized.length > options.max) {
    throw new ContactValidationError(`${label} is too long.`);
  }
  return normalized;
}

function parseSubmission(value: unknown): ContactSubmission {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContactValidationError("The contact form is invalid.");
  }
  const input = value as Record<string, unknown>;
  const email = text(input.email, "Email", { required: true, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ContactValidationError("Enter a valid email address.");
  }

  const requestId = normalizeRequestId(input.request_id);
  const message = text(input.message, "Message", {
    required: true,
    max: 5_000,
  });

  return {
    first_name: text(input.first_name, "First name", { required: true, max: 100 }),
    last_name: text(input.last_name, "Last name", { required: true, max: 100 }),
    email,
    phone: text(input.phone, "Phone", { max: 50 }) || null,
    subject: text(input.subject, "Subject", { required: true, max: 200 }),
    message: appendRequestContext(message, requestId),
  };
}

// The service key is the only writer to contact_submissions (TRACE-087); clients hold no
// INSERT on the table.
function serviceClient() {
  const env = getServiceSupabaseEnvironment();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// TRACE-154 (Phase 7.2C-1): the saved submission and its owner-email record commit together
// (AFTER INSERT trigger). The email is claimed and sent after the response; whatever happens
// to it, the submission stays saved and its delivery state stays visible in Owner Emails.
// Each request has its own server correlation ID; a client-supplied one is never read.
const ROUTE = "contact_submit" as const;

export async function POST(request: Request) {
  const trace = { route: ROUTE, correlationId: createCorrelationId() } as const;
  const startedAt = Date.now();
  try {
    const body: unknown = await request.json();
    const refusal = intakeGuardRefusal(
      typeof body === "object" && body !== null ? (body as Record<string, unknown>).intake : null,
    );
    if (refusal) {
      logOperationalEvent({
        ...trace,
        event: "contact_submission.refused",
        outcome: "refused",
        errorCode: refusal === "trap" ? "intake_trap" : "intake_too_fast",
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json({ error: INTAKE_REFUSAL_MESSAGE }, { status: 429 });
    }
    const submission = parseSubmission(body);
    const supabase = serviceClient();
    const limit = await recordIntakeSubmission(
      supabase,
      "contact",
      submission.email,
      intakeClientIp(request.headers),
    );
    if (limit !== "accepted") {
      logOperationalEvent({
        ...trace,
        event: "contact_submission.refused",
        outcome: "refused",
        errorCode: limit === "email_limit" ? "intake_email_limit" : "intake_ip_limit",
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json({ error: INTAKE_REFUSAL_MESSAGE }, { status: 429 });
    }
    const { data, error } = await supabase
      .from("contact_submissions")
      .insert(submission)
      .select("id")
      .single();
    if (error) throw error;
    const submissionId = (data as { id: string }).id;

    // Email is deliberately post-response: the stored submission remains the
    // source of truth and an email-provider outage cannot erase user success.
    after(async () => {
      try {
        await deliverOwnerEmail(supabase, "contact_submission", submissionId, "initial", undefined, trace);
      } catch (error) {
        logOperationalEvent({
          ...trace,
          sourceKind: "contact_submission",
          sourceId: submissionId,
          mode: "initial",
          event: "owner_email.background_failed",
          outcome: "failed",
          error,
        });
      }
    });

    logOperationalEvent({
      ...trace,
      sourceKind: "contact_submission",
      sourceId: submissionId,
      event: "contact_submission.saved",
      outcome: "saved",
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json({ submitted: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ContactValidationError) {
      logOperationalEvent({
        ...trace,
        event: "contact_submission.refused",
        outcome: "invalid",
        errorCode: "validation_failed",
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logOperationalEvent({
      ...trace,
      event: "contact_submission.failed",
      outcome: "failed",
      error,
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json(
      { error: "Your message could not be submitted. Please try again." },
      { status: 500 },
    );
  }
}
