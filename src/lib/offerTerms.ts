// TRACE-150 (DEC-2026-063): presentation of a provider's bound terms (public.job_offer_terms). The
// server binds and checks the terms; this file only words what was bound, never computes a price.

export type OfferTermsRecord = {
  id: string;
  consent_hash: string;
  total_cents: number;
  terms: unknown;
};

type Line = { id?: string | null; name?: string | null; quantity?: number | null; amount_cents?: number | null; kind?: string | null; required?: boolean | null };
type Omitted = { id?: string | null; name?: string | null; quantity?: number | null; amount_cents?: number | null; required_by_earlier_offering?: boolean | null };
type Answer = { answer?: unknown; label?: string | null; unit?: string | null };
type Terms = {
  provider?: { name?: string | null };
  service?: { name?: string | null };
  frequency?: string | null;
  offering?: { name?: string | null; description?: string | null; policy_notes?: string | null };
  level?: { name?: string | null };
  scope?: { included?: unknown; answers?: Record<string, Answer> | null };
  lines?: Line[];
  amounts?: { total_cents?: number | null };
  exclusions?: { earlier_addons_not_included?: Omitted[]; tax?: string | null; tip?: string | null };
  submission?: { total_cents?: number | null } | null;
};

export type OfferTermsView = {
  provider: string;
  service: string;
  offering: string;
  level: string | null;
  frequency: string;
  description: string | null;
  included: string[];
  answers: string[];
  lines: { key: string; label: string; amount: string }[];
  total: string;
  earlierTotal: string | null;
  omitted: string[];
  tax: string;
  tip: string;
  policy: string | null;
};

export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const frequencies: Record<string, string> = { "one-time": "One time", weekly: "Weekly", biweekly: "Every two weeks", monthly: "Monthly" };

export function offerTermsView(record: OfferTermsRecord): OfferTermsView {
  const t = (record.terms ?? {}) as Terms;
  const lines = (t.lines ?? []).map((line, index) => {
    const quantity = line.quantity && line.quantity > 1 ? ` × ${line.quantity}` : "";
    const name = text(line.name) ?? (line.kind === "tier" ? "Service" : "Add-on");
    const label = line.kind === "addon" ? `${name}${quantity}${line.required ? " (required by this provider)" : ""}` : name;
    return { key: `${line.id ?? index}`, label, amount: formatCents(line.amount_cents ?? 0) };
  });
  const omitted = (t.exclusions?.earlier_addons_not_included ?? []).map((item) => {
    const quantity = item.quantity && item.quantity > 1 ? ` × ${item.quantity}` : "";
    return `${text(item.name) ?? "Add-on"}${quantity} (${formatCents(item.amount_cents ?? 0)} with the earlier provider) isn't offered in these terms`;
  });
  const answers = Object.values(t.scope?.answers ?? {}).flatMap((answer) => {
    const value = answer && answer.answer !== undefined && answer.answer !== null ? String(answer.answer) : null;
    if (!value) return [];
    return [`${text(answer.label) ?? "Answer"}: ${value}${text(answer.unit) ? ` ${answer.unit}` : ""}`];
  });
  const included = Array.isArray(t.scope?.included) ? (t.scope!.included as unknown[]).map(text).filter((item): item is string => Boolean(item)) : [];
  const earlier = t.submission?.total_cents;
  return {
    provider: text(t.provider?.name) ?? "The provider",
    service: text(t.service?.name) ?? "This service",
    offering: text(t.offering?.name) ?? "Offering",
    level: text(t.level?.name),
    frequency: frequencies[t.frequency ?? ""] ?? text(t.frequency) ?? "One time",
    description: text(t.offering?.description),
    included,
    answers,
    lines,
    total: formatCents(t.amounts?.total_cents ?? record.total_cents),
    earlierTotal: typeof earlier === "number" ? formatCents(earlier) : null,
    omitted,
    tax: text(t.exclusions?.tax) ?? "Any tax is confirmed by Mercurius before payment and shown at checkout",
    tip: text(t.exclusions?.tip) ?? "Optional; chosen at checkout",
    policy: text(t.offering?.policy_notes),
  };
}

/** Words a refused answer. The server's message names the reason; stale terms ask for a reload. */
export function offerTermsErrorMessage(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "";
  if (code === "40001") return "These terms changed since you opened them. Review the current terms.";
  if (message.includes("already answered")) return "You already answered these terms.";
  if (message.includes("can't take the service") || message.includes("can’t take the service")) {
    return "This provider can't take the service at these terms right now. You can decline them; Mercurius will follow up.";
  }
  if (code === "42501") return "Only the homeowner can answer these terms.";
  return "Your answer wasn't saved. Check this request again before retrying.";
}
