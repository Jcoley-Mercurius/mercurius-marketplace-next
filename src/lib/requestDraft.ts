// TRACE-098: the homeowner intake draft kept in this browser tab. Everything restored here is
// untrusted: invalid, stale or foreign fields are dropped rather than trusted, promotion terms
// are never restored (DEC-2026-015), and storage failures are reported instead of hidden.

import { isSubmissionKey, parseSubmissionResult, type SubmissionPayload, type SubmissionResult } from "./requestSubmission";
import { isPricingFrequency, type PackageQualifyingQuestion, type PricingFrequency, type PublicPackageSelection } from "./vendorPricing";

export const REQUEST_DRAFT_KEY = "nextRequestFlowState";
export const REQUEST_DRAFT_VERSION = 2;
export const MAX_DRAFT_SERVICES = 20;

export type DraftStep = "services" | "details" | "contact";
export type TimeOfDay = "morning" | "afternoon" | "anytime";
export type AccessMethod = "someone-home" | "coordinate" | "gate" | "lockbox" | "other";
export type PetStatus = "none" | "secured" | "on-property";

/** Imported catalog presentation. Prices here are display hints only; the database decides. */
export type DraftServiceOverride = {
  name?: string;
  description?: string;
  defaultFrequency?: PricingFrequency;
  frequencies?: PricingFrequency[];
  livePrices?: Partial<Record<PricingFrequency, number>>;
  availability?: "fixed" | "quote" | "sourcing";
  packageSelections?: Partial<Record<PricingFrequency, PublicPackageSelection>>;
};

/** An accepted submission. Its payload and request identities are locked for recovery. */
export type SavedSubmission = {
  actorId: string;
  submissionKey: string;
  payload: SubmissionPayload;
  result: SubmissionResult;
  serviceNames: Record<string, string>;
  preferredProviderNames: Record<string, string>;
  /** Photos chosen for this submission that are not yet confirmed as attached. */
  photosPending: number;
  savedAt: string;
};

export type RequestDraft = {
  version: typeof REQUEST_DRAFT_VERSION;
  /** The signed-in account that owns this draft; null until someone signs in. */
  ownerId: string | null;
  step: DraftStep;
  selectedIds: string[];
  frequencies: Record<string, PricingFrequency>;
  streetAddress: string;
  city: string;
  stateCode: string;
  zipCode: string;
  preferredDate: string;
  preferredEndDate: string;
  timeOfDay: TimeOfDay;
  description: string;
  otherServiceDetails: string;
  accessMethod: AccessMethod;
  petStatus: PetStatus;
  entryInstructions: string;
  parkingNotes: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  smsUpdates: boolean;
  serviceOverrides: Record<string, DraftServiceOverride>;
  preferredProviders: Record<string, string>;
  preferredProviderNames: Record<string, string>;
  /** Only offerings the homeowner chose explicitly (plan builder or provider page). */
  packageSelections: Record<string, PublicPackageSelection>;
  questionAnswers: Record<string, Record<string, string>>;
  submissionKey: string;
  /** The exact payload last sent without a confirmed answer; a retry resends it unchanged. */
  inFlight: SubmissionPayload | null;
  saved: SavedSubmission | null;
};

export function emptyDraft(submissionKey: string): RequestDraft {
  return {
    version: REQUEST_DRAFT_VERSION, ownerId: null, step: "services", selectedIds: [], frequencies: {},
    streetAddress: "", city: "Cape Coral", stateCode: "FL", zipCode: "", preferredDate: "", preferredEndDate: "",
    timeOfDay: "anytime", description: "", otherServiceDetails: "", accessMethod: "someone-home", petStatus: "none",
    entryInstructions: "", parkingNotes: "", firstName: "", lastName: "", email: "", phone: "", smsUpdates: false,
    serviceOverrides: {}, preferredProviders: {}, preferredProviderNames: {}, packageSelections: {}, questionAnswers: {},
    submissionKey, inFlight: null, saved: null,
  };
}

const idPattern = /^[a-z0-9-]{1,100}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const steps: DraftStep[] = ["services", "details", "contact"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : undefined;
const pick = <T extends string>(value: unknown, allowed: readonly T[]) =>
  allowed.includes(value as T) ? value as T : undefined;

function stringMap(value: unknown, keyOk: (key: string) => boolean, valueOk: (item: string) => boolean, max = 200) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => keyOk(key) && typeof item === "string" && valueOk(item))
    .map(([key, item]) => [key, (item as string).slice(0, max)]));
}

function questions(value: unknown): PackageQualifyingQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is PackageQualifyingQuestion => isRecord(item)
    && typeof item.question_key === "string" && typeof item.question_label === "string"
    && ["number", "select", "text"].includes(String(item.input_type)));
}

export function parsePackageSelection(value: unknown): PublicPackageSelection | undefined {
  if (!isRecord(value) || typeof value.packageId !== "string" || !uuidPattern.test(value.packageId)) return undefined;
  const pricingMode = pick(value.pricingMode, ["fixed", "deposit_quote", "custom_quote"] as const);
  if (!pricingMode) return undefined;
  const tierId = typeof value.tierId === "string" && uuidPattern.test(value.tierId) ? value.tierId : undefined;
  return {
    packageId: value.packageId, tierId, pricingMode, questions: questions(value.questions),
    packageName: text(value.packageName, 200), packageDescription: text(value.packageDescription, 2000) ?? null,
    tierName: text(value.tierName, 200),
    tierIncludes: Array.isArray(value.tierIncludes) ? value.tierIncludes.filter((item): item is string => typeof item === "string").slice(0, 30) : undefined,
  };
}

function priceMap(value: unknown) {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key, amount]) =>
    isPricingFrequency(key) && typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) as Partial<Record<PricingFrequency, number>>;
}

/** Promotion labels, ids and base (strike-through) prices are intentionally not restored. */
function serviceOverride(value: unknown): DraftServiceOverride | undefined {
  if (!isRecord(value)) return undefined;
  const frequencies = Array.isArray(value.frequencies) ? value.frequencies.filter(isPricingFrequency) : undefined;
  const selections = isRecord(value.packageSelections)
    ? Object.fromEntries(Object.entries(value.packageSelections).flatMap(([frequency, selection]) => {
        const parsed = isPricingFrequency(frequency) ? parsePackageSelection(selection) : undefined;
        return parsed ? [[frequency, parsed]] : [];
      }))
    : undefined;
  return {
    name: text(value.name, 200), description: text(value.description, 500),
    defaultFrequency: isPricingFrequency(value.defaultFrequency) ? value.defaultFrequency : undefined,
    frequencies: frequencies?.length ? frequencies : undefined,
    livePrices: priceMap(value.livePrices),
    availability: pick(value.availability, ["fixed", "quote", "sourcing"] as const),
    packageSelections: selections,
  };
}

function parseSaved(value: unknown): SavedSubmission | null {
  if (!isRecord(value) || typeof value.actorId !== "string" || !isSubmissionKey(value.submissionKey) || !isRecord(value.payload)) return null;
  try {
    const result = parseSubmissionResult(value.result);
    if (result.status !== "submitted") return null;
    return {
      actorId: value.actorId, submissionKey: value.submissionKey, payload: value.payload as SubmissionPayload, result,
      serviceNames: stringMap(value.serviceNames, (key) => idPattern.test(key), () => true),
      preferredProviderNames: stringMap(value.preferredProviderNames, (key) => idPattern.test(key), () => true),
      photosPending: typeof value.photosPending === "number" && value.photosPending >= 0 ? Math.floor(value.photosPending) : 0,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export type DraftRestore = { draft: RequestDraft; dropped: string[] };

/**
 * Restores a stored draft field by field. Unknown, malformed or stale values fall back to the
 * empty draft and are listed in `dropped`, so the page can say what it could not restore.
 */
export function parseDraft(raw: string | null, fallbackKey: string, today: string): DraftRestore {
  const draft = emptyDraft(fallbackKey);
  if (!raw) return { draft, dropped: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { draft, dropped: ["draft"] };
  }
  if (!isRecord(value)) return { draft, dropped: ["draft"] };
  const dropped: string[] = [];
  const keep = <K extends keyof RequestDraft>(key: K, parsed: RequestDraft[K] | undefined) => {
    if (parsed !== undefined) draft[key] = parsed;
    else if (value && (value as Record<string, unknown>)[key] !== undefined) dropped.push(key);
  };

  keep("ownerId", typeof value.ownerId === "string" && uuidPattern.test(value.ownerId) ? value.ownerId : value.ownerId === null ? null : undefined);
  keep("step", pick(value.step, steps));
  keep("selectedIds", Array.isArray(value.selectedIds)
    ? [...new Set(value.selectedIds.filter((id): id is string => typeof id === "string" && idPattern.test(id)))].slice(0, MAX_DRAFT_SERVICES)
    : undefined);
  keep("frequencies", isRecord(value.frequencies)
    ? Object.fromEntries(Object.entries(value.frequencies).filter(([id, frequency]) => idPattern.test(id) && isPricingFrequency(frequency))) as Record<string, PricingFrequency>
    : undefined);
  keep("streetAddress", text(value.streetAddress, 200));
  keep("city", text(value.city, 100));
  keep("stateCode", typeof value.stateCode === "string" && /^[A-Za-z]{0,2}$/.test(value.stateCode) ? value.stateCode : undefined);
  keep("zipCode", typeof value.zipCode === "string" && /^[\d-]{0,10}$/.test(value.zipCode) ? value.zipCode : undefined);
  // A preference window that has already started is stale; the page proposes a new one.
  keep("preferredDate", typeof value.preferredDate === "string" && datePattern.test(value.preferredDate) && value.preferredDate >= today ? value.preferredDate : undefined);
  keep("preferredEndDate", typeof value.preferredEndDate === "string" && datePattern.test(value.preferredEndDate) && value.preferredEndDate >= today ? value.preferredEndDate : undefined);
  keep("timeOfDay", pick(value.timeOfDay, ["morning", "afternoon", "anytime"] as const));
  keep("description", text(value.description, 4000));
  keep("otherServiceDetails", text(value.otherServiceDetails, 1000));
  keep("accessMethod", pick(value.accessMethod, ["someone-home", "coordinate", "gate", "lockbox", "other"] as const));
  keep("petStatus", pick(value.petStatus, ["none", "secured", "on-property"] as const));
  keep("entryInstructions", text(value.entryInstructions, 1000));
  keep("parkingNotes", text(value.parkingNotes, 1000));
  keep("firstName", text(value.firstName, 100));
  keep("lastName", text(value.lastName, 100));
  keep("email", text(value.email, 254));
  keep("phone", text(value.phone, 50));
  keep("smsUpdates", typeof value.smsUpdates === "boolean" ? value.smsUpdates : undefined);
  keep("serviceOverrides", isRecord(value.serviceOverrides)
    ? Object.fromEntries(Object.entries(value.serviceOverrides).flatMap(([id, item]) => {
        const parsed = idPattern.test(id) ? serviceOverride(item) : undefined;
        return parsed ? [[id, parsed]] : [];
      }))
    : undefined);
  keep("preferredProviders", isRecord(value.preferredProviders)
    ? stringMap(value.preferredProviders, (key) => idPattern.test(key), (item) => uuidPattern.test(item)) : undefined);
  keep("preferredProviderNames", isRecord(value.preferredProviderNames)
    ? stringMap(value.preferredProviderNames, (key) => idPattern.test(key), () => true) : undefined);
  keep("packageSelections", isRecord(value.packageSelections)
    ? Object.fromEntries(Object.entries(value.packageSelections).flatMap(([id, selection]) => {
        const parsed = idPattern.test(id) ? parsePackageSelection(selection) : undefined;
        return parsed ? [[id, parsed]] : [];
      }))
    : undefined);
  keep("questionAnswers", isRecord(value.questionAnswers)
    ? Object.fromEntries(Object.entries(value.questionAnswers).filter(([id]) => idPattern.test(id)).map(([id, answers]) =>
        [id, stringMap(answers, (key) => key.length <= 100, () => true)]))
    : undefined);
  keep("submissionKey", isSubmissionKey(value.submissionKey) ? value.submissionKey : undefined);
  keep("inFlight", isRecord(value.inFlight) && Array.isArray(value.inFlight.selections) ? value.inFlight as SubmissionPayload : value.inFlight === null ? null : undefined);
  keep("saved", value.saved === null ? null : parseSaved(value.saved) ?? undefined);

  // A saved submission keeps its own key; a draft never reuses it for different details.
  if (draft.saved) draft.submissionKey = draft.saved.submissionKey;
  if (draft.preferredEndDate && draft.preferredDate && draft.preferredEndDate < draft.preferredDate) {
    draft.preferredEndDate = "";
    dropped.push("preferredEndDate");
  }
  return { draft, dropped };
}

export type ActorDecision =
  | { action: "keep"; draft: RequestDraft }
  | { action: "adopt"; draft: RequestDraft }
  | { action: "hold" }
  | { action: "discard" };

/**
 * Binds a draft to the account that continues it. An anonymous draft is adopted by the first
 * account that signs in; a draft or saved result belonging to another account is discarded,
 * never shown. A signed-out visitor sees neither: the draft is held for its owner (an expired
 * session must not lose it) until that account returns or the visitor starts over.
 * Callers must wait until the session is known before deciding.
 */
export function reconcileDraftActor(draft: RequestDraft, userId: string | null): ActorDecision {
  const owner = draft.saved?.actorId ?? draft.ownerId;
  if (owner && userId && owner !== userId) return { action: "discard" };
  if (owner && !userId) return { action: "hold" };
  if (!owner && userId) return { action: "adopt", draft: { ...draft, ownerId: userId } };
  return { action: "keep", draft };
}

export type StorageOutcome = { ok: true } | { ok: false };

export function readDraftStorage(storage: Pick<Storage, "getItem"> | null): { raw: string | null; available: boolean } {
  try {
    return { raw: storage?.getItem(REQUEST_DRAFT_KEY) ?? null, available: Boolean(storage) };
  } catch {
    return { raw: null, available: false };
  }
}

export function writeDraftStorage(storage: Pick<Storage, "setItem"> | null, draft: RequestDraft): StorageOutcome {
  try {
    if (!storage) return { ok: false };
    storage.setItem(REQUEST_DRAFT_KEY, JSON.stringify(draft));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function clearDraftStorage(storage: Pick<Storage, "removeItem"> | null): StorageOutcome {
  try {
    storage?.removeItem(REQUEST_DRAFT_KEY);
    return { ok: Boolean(storage) };
  } catch {
    return { ok: false };
  }
}

/** Today's date in Eastern time, which the submission command uses for preference windows. */
export function easternDateValue(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
