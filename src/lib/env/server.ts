import "server-only";

import { getBrowserEnvironment } from "./browser";
import {
  optionalString,
  requiredString,
  type EnvironmentSource,
} from "./validation";

function serverSource(): EnvironmentSource {
  return {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OWNER_NOTIFICATION_EMAIL: process.env.OWNER_NOTIFICATION_EMAIL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    VENDOR_UPLOAD_HMAC_SECRET: process.env.VENDOR_UPLOAD_HMAC_SECRET,
    VENDOR_UPLOAD_HMAC_VERSION: process.env.VENDOR_UPLOAD_HMAC_VERSION,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    RESEND_WEBHOOK_SECRET_PREVIOUS: process.env.RESEND_WEBHOOK_SECRET_PREVIOUS,
    EMAIL_EVIDENCE_PROBES_ENABLED: process.env.EMAIL_EVIDENCE_PROBES_ENABLED,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}

export function getAnonymousSupabaseEnvironment() {
  const browser = getBrowserEnvironment();
  return {
    supabaseUrl: browser.supabaseUrl,
    supabaseAnonKey: browser.supabaseAnonKey,
  } as const;
}

export function getServiceSupabaseEnvironment() {
  const browser = getBrowserEnvironment();
  return {
    supabaseUrl: browser.supabaseUrl,
    serviceRoleKey: requiredString(
      serverSource(),
      "SUPABASE_SERVICE_ROLE_KEY",
      { minLength: 20 },
    ),
  } as const;
}

export function getOwnerNotificationEnvironment() {
  const source = serverSource();
  return {
    apiKey: requiredString(source, "RESEND_API_KEY", { minLength: 10 }),
    from: requiredString(source, "RESEND_FROM_EMAIL"),
    to: optionalString(source, "OWNER_NOTIFICATION_EMAIL"),
  } as const;
}

export function getVendorUploadSigningEnvironment() {
  const source = serverSource();
  const version = requiredString(source, "VENDOR_UPLOAD_HMAC_VERSION");
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(version)) {
    throw new Error(
      "Environment configuration error: VENDOR_UPLOAD_HMAC_VERSION must be a short identifier.",
    );
  }
  return {
    secret: requiredString(source, "VENDOR_UPLOAD_HMAC_SECRET", {
      minLength: 32,
    }),
    version,
  } as const;
}

/**
 * TRACE-155 (Phase 7.3B): the Resend webhook signing secrets. Both are optional and never
 * throw here: an unset current secret keeps the receiver dormant (503), and a malformed
 * value is refused by the receiver's own configuration check.
 */
export function getResendWebhookEnvironment() {
  const source = serverSource();
  return {
    current: optionalString(source, "RESEND_WEBHOOK_SECRET"),
    previous: optionalString(source, "RESEND_WEBHOOK_SECRET_PREVIOUS"),
  } as const;
}

/**
 * TRACE-155 (Phase 7.3D-1): the delivery-evidence probe harness. Off unless
 * EMAIL_EVIDENCE_PROBES_ENABLED is exactly "true" and VERCEL_ENV is exactly "production"
 * (7.3D-1 review fixes, D-8). Both are compared raw, untrimmed; a missing VERCEL_ENV fails
 * closed. Never throws.
 */
export function getEmailEvidenceProbeEnvironment() {
  const source = serverSource();
  return {
    enabled: source.EMAIL_EVIDENCE_PROBES_ENABLED === "true",
    production: source.VERCEL_ENV === "production",
  } as const;
}
