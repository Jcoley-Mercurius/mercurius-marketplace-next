import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { after, NextResponse } from "next/server";
import {
  MAX_VENDOR_DOCUMENT_COUNT,
  VENDOR_DOCUMENT_BUCKET,
  isAllowedVendorDocumentMimeType,
  isVendorDocumentKind,
  safeVendorDocumentName,
  type VendorDocumentDescriptor,
} from "@/lib/vendorApplicationDocuments";
import { signVendorDocumentUploadGrant } from "@/lib/vendorApplicationUploadToken";
import { sendOwnerNotification } from "@/lib/ownerNotifications";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";

export const runtime = "nodejs";

type ApplicationInput = {
  business_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  years_experience: number;
  services: string[];
  service_areas: string | null;
  availability: string | null;
  primary_category: string;
  team_size: string;
  business_description: string | null;
  website: string | null;
  preferred_contact: string;
  credentials: string[];
  other_certification: string | null;
  additional_notes: string | null;
  license_number: string | null;
  insurance_policy_number: string | null;
};

class RequestValidationError extends Error {}

function serviceClient() {
  const env = getServiceSupabaseEnvironment();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestValidationError("The application payload is invalid.");
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  label: string,
  options: { required?: boolean; max?: number } = {},
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (options.required && !normalized) {
    throw new RequestValidationError(`${label} is required.`);
  }
  if (normalized.length > (options.max ?? 500)) {
    throw new RequestValidationError(`${label} is too long.`);
  }
  return normalized;
}

function nullableText(value: unknown, label: string, max = 2_000) {
  return text(value, label, { max }) || null;
}

function stringList(
  value: unknown,
  label: string,
  options: { required?: boolean; maxItems?: number; maxLength?: number } = {},
) {
  if (!Array.isArray(value)) {
    if (options.required) {
      throw new RequestValidationError(`${label} is required.`);
    }
    return [];
  }

  const items = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (options.required && items.length === 0) {
    throw new RequestValidationError(`${label} is required.`);
  }
  if (items.length > (options.maxItems ?? 50)) {
    throw new RequestValidationError(`Too many ${label.toLowerCase()} were provided.`);
  }
  if (items.some((item) => item.length > (options.maxLength ?? 160))) {
    throw new RequestValidationError(`A ${label.toLowerCase()} entry is too long.`);
  }
  return items;
}

function parseApplication(value: unknown): ApplicationInput {
  const input = recordValue(value);
  const email = text(input.email, "Email", { required: true, max: 254 })
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestValidationError("Enter a valid email address.");
  }

  const experience = Number(input.years_experience);
  if (!Number.isInteger(experience) || experience < 0 || experience > 100) {
    throw new RequestValidationError("Years of experience must be between 0 and 100.");
  }

  return {
    business_name: text(input.business_name, "Business name", {
      required: true,
      max: 160,
    }),
    first_name: text(input.first_name, "First name", {
      required: true,
      max: 100,
    }),
    last_name: text(input.last_name, "Last name", { max: 100 }),
    email,
    phone: text(input.phone, "Phone", { required: true, max: 50 }),
    address: text(input.address, "Address", { max: 300 }),
    years_experience: experience,
    services: stringList(input.services, "Services", {
      required: true,
      maxItems: 50,
    }),
    service_areas: nullableText(input.service_areas, "Service areas", 1_000),
    availability: nullableText(input.availability, "Availability", 1_000),
    primary_category: text(input.primary_category, "Primary category", {
      required: true,
      max: 160,
    }),
    team_size: text(input.team_size, "Team size", {
      required: true,
      max: 50,
    }),
    business_description: nullableText(
      input.business_description,
      "Business description",
      4_000,
    ),
    website: nullableText(input.website, "Website", 500),
    preferred_contact: text(input.preferred_contact, "Preferred contact", {
      max: 20,
    }),
    credentials: stringList(input.credentials, "Credentials", {
      maxItems: 20,
    }),
    other_certification: nullableText(
      input.other_certification,
      "Other certification",
      500,
    ),
    additional_notes: nullableText(
      input.additional_notes,
      "Additional notes",
      4_000,
    ),
    license_number: nullableText(input.license_number, "License number", 200),
    insurance_policy_number: nullableText(
      input.insurance_policy_number,
      "Insurance policy number",
      200,
    ),
  };
}

function parseDocuments(value: unknown): VendorDocumentDescriptor[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new RequestValidationError("Document details are invalid.");
  }
  if (value.length > MAX_VENDOR_DOCUMENT_COUNT) {
    throw new RequestValidationError(
      `Upload no more than ${MAX_VENDOR_DOCUMENT_COUNT} documents.`,
    );
  }

  const seenClientIds = new Set<string>();
  return value.map((item) => {
    const descriptor = recordValue(item);
    const clientId = text(descriptor.clientId, "Document identifier", {
      required: true,
      max: 80,
    });
    const name = text(descriptor.name, "Document name", {
      required: true,
      max: 180,
    });
    const type = text(descriptor.type, "Document type", {
      required: true,
      max: 100,
    }).toLowerCase();
    const size = Number(descriptor.size);

    if (!/^[a-zA-Z0-9-]+$/.test(clientId) || seenClientIds.has(clientId)) {
      throw new RequestValidationError("Document identifiers are invalid.");
    }
    seenClientIds.add(clientId);
    if (!isVendorDocumentKind(descriptor.kind)) {
      throw new RequestValidationError("Choose a valid credential document type.");
    }
    if (!isAllowedVendorDocumentMimeType(type)) {
      throw new RequestValidationError(
        `${name} must be a PDF, JPG, PNG, WebP, HEIC, or HEIF file.`,
      );
    }
    if (!Number.isInteger(size) || size <= 0 || size > 10 * 1024 * 1024) {
      throw new RequestValidationError(`${name} must be 10 MB or smaller.`);
    }

    return {
      clientId,
      kind: descriptor.kind,
      name,
      size,
      type,
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = recordValue(await request.json());
    const application = parseApplication(body.application);
    const documents = parseDocuments(body.documents);
    const applicationId = randomUUID();
    const supabase = serviceClient();

    const { error: applicationError } = await supabase
      .from("vendor_applications")
      .insert({
        id: applicationId,
        ...application,
        status: "pending",
        document_urls: [],
      });
    if (applicationError) throw applicationError;

    const uploads: Array<{
      clientId: string;
      path: string;
      token: string;
    }> = [];
    let uploadWarning: string | null = null;

    for (const document of documents) {
      const path = `${applicationId}/${document.kind}/${randomUUID()}-${safeVendorDocumentName(document.name, document.type)}`;
      const { data, error } = await supabase.storage
        .from(VENDOR_DOCUMENT_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });

      if (error) {
        console.error("Unable to create vendor document upload URL", error);
        uploadWarning =
          "Your application was saved, but secure document upload is temporarily unavailable.";
        continue;
      }
      uploads.push({ clientId: document.clientId, path, token: data.token });
    }

    const finalizeToken =
      uploads.length > 0
        ? signVendorDocumentUploadGrant({
            applicationId,
            paths: uploads.map((upload) => upload.path),
            expiresAt: Date.now() + 110 * 60 * 1_000,
          })
        : null;

    const submittedAt = new Date().toISOString();
    const businessSummary = application.business_name.replace(/\s+/g, " ").slice(0, 100);
    after(async () => {
      const result = await sendOwnerNotification({
        subject: `New vendor application — ${businessSummary}`,
        replyTo: application.email,
        text: [
          "New Mercurius vendor application",
          "",
          `Submitted: ${submittedAt}`,
          `Business: ${application.business_name}`,
          `Contact: ${`${application.first_name} ${application.last_name}`.trim()}`,
          `Email: ${application.email}`,
          `Phone: ${application.phone}`,
          `Primary category: ${application.primary_category}`,
          `Services: ${application.services.join(", ") || "Not provided"}`,
          `Service areas: ${application.service_areas ?? "Not provided"}`,
        ].join("\n"),
      });
      if (!result.ok) {
        console.error("Vendor application owner notification failed", {
          applicationId,
          error: result.error,
        });
      }
    });

    return NextResponse.json(
      {
        applicationId,
        uploads,
        finalizeToken,
        uploadWarning,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Vendor application submission failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          error.message === "Vendor application uploads are not configured."
            ? error.message
            : "Your application could not be submitted. Please try again.",
      },
      { status: 500 },
    );
  }
}
