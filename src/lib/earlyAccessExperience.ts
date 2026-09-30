// TRACE-103 (R0.3): presentation contract for the homeowner early-access experience.
// Approved design: governance/HOMEOWNER-EARLY-ACCESS-EXPERIENCE.md, with route and state
// precedence in HOMEOWNER-EARLY-ACCESS-RECONCILIATION.md. Nothing here authorizes a
// request or checkout: the R0.1 database commands decide admission, and a failed or
// malformed readback is treated as closed.

/** Public booking entry points during R0 recruiting (MDS R0 addendum; reconciliation §1). */
export const EARLY_ACCESS_CTA = "Join early access";
export const EARLY_ACCESS_PATH = "/early-access";
/** Same-tab handoff of the joined email to the optional account step. Never a URL. */
export const EARLY_ACCESS_EMAIL_KEY = "mercurius.earlyAccess.email";

const SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SERVICES = 30;

/** Early-access link that carries the selected catalog services, when there are any. */
export function earlyAccessHref(serviceIds: readonly (string | null | undefined)[] = []): string {
  const params = new URLSearchParams();
  for (const id of new Set(serviceIds)) {
    if (id && SERVICE_ID.test(id) && params.getAll("service").length < MAX_SERVICES) params.append("service", id);
  }
  const query = params.toString();
  return query ? `${EARLY_ACCESS_PATH}?${query}` : EARLY_ACCESS_PATH;
}

/** Preselected services from `?service=a&service=b` (or a comma list); invalid IDs are dropped. */
export function earlyAccessServicesFromQuery(value: string | string[] | undefined): string[] {
  const values = (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => item.split(","));
  return [...new Set(values.map((item) => item.trim()).filter((item) => SERVICE_ID.test(item)))].slice(0, MAX_SERVICES);
}

export type TrialCellState = "active" | "unavailable" | "revoked";
export type TrialCell = {
  zipCode: string;
  serviceId: string;
  serviceName: string;
  state: TrialCellState;
  changedAt: string | null;
};
export type TrialAccess = { homeowner: boolean; cells: TrialCell[] };

export class EarlyAccessReadError extends Error {}

/** Parses `r0_my_trial_access()`. Anything unexpected throws, and callers fail closed. */
export function parseTrialAccess(data: unknown): TrialAccess {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new EarlyAccessReadError("Your booking access could not be read.");
  }
  const { homeowner, cells } = data as Record<string, unknown>;
  if (typeof homeowner !== "boolean" || !Array.isArray(cells)) {
    throw new EarlyAccessReadError("Your booking access could not be read.");
  }
  return {
    homeowner,
    cells: cells.map((cell) => {
      const row = (typeof cell === "object" && cell !== null ? cell : {}) as Record<string, unknown>;
      if (
        typeof row.zip_code !== "string" || typeof row.service_id !== "string" ||
        typeof row.service_name !== "string" ||
        (row.state !== "active" && row.state !== "unavailable" && row.state !== "revoked")
      ) {
        throw new EarlyAccessReadError("Your booking access could not be read.");
      }
      return {
        zipCode: row.zip_code,
        serviceId: row.service_id,
        serviceName: row.service_name,
        state: row.state,
        changedAt: typeof row.changed_at === "string" ? row.changed_at : null,
      };
    }),
  };
}

/**
 * The account-level booking state. `invited` needs at least one active cell and the
 * homeowner role; otherwise an unavailable or revoked cell explains why booking is
 * closed, and an account with no cells is waiting.
 */
export type BookingState = "invited" | "unavailable" | "revoked" | "waiting";

export function bookingState(access: TrialAccess): BookingState {
  if (access.homeowner && access.cells.some((cell) => cell.state === "active")) return "invited";
  if (access.cells.some((cell) => cell.state === "unavailable")) return "unavailable";
  if (access.cells.some((cell) => cell.state === "revoked")) return "revoked";
  return "waiting";
}

export function activeCells(access: TrialAccess): TrialCell[] {
  return access.homeowner ? access.cells.filter((cell) => cell.state === "active") : [];
}

/** Whether this account is admitted for one service cell (checkout presentation only). */
export function admittedFor(access: TrialAccess, zipCode: string | null | undefined, serviceId: string | null | undefined) {
  if (!zipCode || !serviceId) return false;
  const zip = zipCode.slice(0, 5);
  return activeCells(access).some((cell) => cell.zipCode === zip && cell.serviceId === serviceId);
}

/** "Lawn Mowing in 33904; AC Maintenance in 33904 and 33990" */
export function describeCells(cells: readonly TrialCell[]): string {
  const byService = new Map<string, string[]>();
  for (const cell of cells) byService.set(cell.serviceName, [...(byService.get(cell.serviceName) ?? []), cell.zipCode]);
  return [...byService].map(([name, zips]) => `${name} in ${joinWords([...new Set(zips)].sort())}`).join("; ");
}

function joinWords(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export type InterestKind = "early_access" | "expansion";
export type InterestView = {
  kind: InterestKind;
  status: "active" | "withdrawn";
  firstName: string | null;
  zipCode: string;
  serviceIds: string[];
  stillExploring: boolean;
};
export type MyInterest =
  | { verified: false }
  | { verified: true; earlyAccess: InterestView | null; expansion: InterestView | null; marketingOptedIn: boolean };

export function parseInterestView(value: unknown): InterestView {
  const row = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (
    (row.kind !== "early_access" && row.kind !== "expansion") ||
    (row.status !== "active" && row.status !== "withdrawn") ||
    typeof row.zip_code !== "string" || !Array.isArray(row.service_ids) ||
    row.service_ids.some((id) => typeof id !== "string") || typeof row.still_exploring !== "boolean"
  ) {
    throw new EarlyAccessReadError("Your early-access details could not be read.");
  }
  return {
    kind: row.kind,
    status: row.status,
    firstName: typeof row.first_name === "string" ? row.first_name : null,
    zipCode: row.zip_code,
    serviceIds: row.service_ids as string[],
    stillExploring: row.still_exploring,
  };
}

/** Parses `r0_my_interest()`. A de-identified record never reaches the account. */
export function parseMyInterest(data: unknown): MyInterest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new EarlyAccessReadError("Your early-access details could not be read.");
  }
  const row = data as Record<string, unknown>;
  if (row.verified === false) return { verified: false };
  if (row.verified !== true || !Array.isArray(row.interests) || typeof row.marketing_opted_in !== "boolean") {
    throw new EarlyAccessReadError("Your early-access details could not be read.");
  }
  const interests = row.interests.map(parseInterestView);
  return {
    verified: true,
    earlyAccess: interests.find((item) => item.kind === "early_access") ?? null,
    expansion: interests.find((item) => item.kind === "expansion") ?? null,
    marketingOptedIn: row.marketing_opted_in,
  };
}

/** Outcome of POST /api/early-access (TRACE-102 route) as the form presents it. */
export type JoinOutcome =
  | { kind: "saved"; interestKind: InterestKind }
  | { kind: "boundary"; interestKind: InterestKind }
  | { kind: "invalid"; message: string }
  | { kind: "refused" }
  | { kind: "not_saved" };

export function joinOutcome(status: number, body: unknown): JoinOutcome {
  const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const interestKind: InterestKind | null = data.kind === "early_access" || data.kind === "expansion" ? data.kind : null;
  if (status === 201 && data.outcome === "saved" && interestKind) return { kind: "saved", interestKind };
  if (status === 409 && data.outcome === "boundary" && interestKind) return { kind: "boundary", interestKind };
  if (status === 400) {
    return { kind: "invalid", message: typeof data.error === "string" && data.error ? data.error : "Check the form and try again." };
  }
  if (status === 429) return { kind: "refused" };
  // A 5xx or anything unrecognized was not confirmed as saved.
  return { kind: "not_saved" };
}

/** Supabase Auth errors that would reveal an existing account on the public sign-up step. */
export function isExistingAccountSignUpError(error: { code?: unknown; message?: unknown } | null | undefined) {
  if (!error) return false;
  if (error.code === "user_already_exists" || error.code === "email_exists") return true;
  return typeof error.message === "string" && /already (registered|exists)/i.test(error.message);
}
