import { createClient } from "@supabase/supabase-js";
import { after, NextResponse } from "next/server";
import { sendOwnerNotification } from "@/lib/ownerNotifications";
import {
  appendRequestContext,
  normalizeRequestId,
} from "@/lib/requestContext";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";

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

export async function POST(request: Request) {
  try {
    const submission = parseSubmission(await request.json());
    const submittedAt = new Date().toISOString();
    const { error } = await serviceClient()
      .from("contact_submissions")
      .insert(submission);
    if (error) throw error;

    const fullName = `${submission.first_name} ${submission.last_name}`.trim();
    const subjectSummary = submission.subject.replace(/\s+/g, " ").slice(0, 100);

    // Email is deliberately post-response: the stored submission remains the
    // source of truth and an email-provider outage cannot erase user success.
    after(async () => {
      const result = await sendOwnerNotification({
        subject: `New contact submission — ${subjectSummary}`,
        replyTo: submission.email,
        text: [
          "New Mercurius contact form submission",
          "",
          `Submitted: ${submittedAt}`,
          `Name: ${fullName}`,
          `Email: ${submission.email}`,
          `Phone: ${submission.phone ?? "Not provided"}`,
          `Subject: ${submission.subject}`,
          "",
          "Message:",
          submission.message,
        ].join("\n"),
      });
      if (!result.ok) {
        console.error("Contact owner notification failed", { error: result.error });
      }
    });

    return NextResponse.json({ submitted: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ContactValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Contact submission failed", error);
    return NextResponse.json(
      { error: "Your message could not be submitted. Please try again." },
      { status: 500 },
    );
  }
}
