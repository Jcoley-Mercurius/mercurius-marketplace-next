import { describe, expect, it, vi } from "vitest";
import {
  REQUEST_DRAFT_KEY,
  addDays,
  clearDraftStorage,
  easternDateValue,
  emptyDraft,
  parseDraft,
  readDraftStorage,
  reconcileDraftActor,
  writeDraftStorage,
  type SavedSubmission,
} from "../../src/lib/requestDraft";
import {
  parsePreviewResult,
  planIsSubmittable,
  previewSignature,
  serviceAvailability,
  type PreviewOutcome,
} from "../../src/lib/requestPreview";
import { describeConfirmation, intakeCheckoutAllowed, intakeMatchingAllowed, type RequestReadback } from "../../src/lib/requestConfirmation";
import {
  MAX_REQUEST_PHOTOS,
  RequestPhotoError,
  attachRequestPhotos,
  discardUnattachedRequestPhotos,
  requestPhotoPath,
  selectRequestPhotos,
  type RequestPhotoDraft,
} from "../../src/lib/requestPhotos";
import type { SubmittedRequest } from "../../src/lib/requestSubmission";

const today = "2026-09-27";
const key = "synthetic-key-0000000001";
const owner = "00000000-0000-4000-8000-0000000000a1";
const other = "00000000-0000-4000-8000-0000000000b2";
const money = (value: number) => `$${value.toFixed(2)}`;

describe("draft restoration", () => {
  it("starts empty without storage", () => {
    expect(parseDraft(null, key, today)).toEqual({ draft: emptyDraft(key), dropped: [] });
  });

  it("treats malformed JSON and non-objects as a fresh start", () => {
    expect(parseDraft("{nope", key, today).dropped).toEqual(["draft"]);
    expect(parseDraft("[1,2]", key, today).dropped).toEqual(["draft"]);
    expect(parseDraft("null", key, today).draft).toEqual(emptyDraft(key));
  });

  it("keeps valid fields and drops invalid ones individually", () => {
    const { draft, dropped } = parseDraft(JSON.stringify({
      step: "contact", selectedIds: ["lawn-mowing", "BAD ID", 3, "lawn-mowing"], frequencies: { "lawn-mowing": "weekly", pool: "hourly" },
      zipCode: "33904", stateCode: "Florida", timeOfDay: "midnight", smsUpdates: "yes", submissionKey: "short",
      preferredProviders: { "lawn-mowing": "not-a-uuid", "pool-service": "00000000-0000-4000-8000-000000000002" },
    }), key, today);
    expect(draft.step).toBe("contact");
    expect(draft.selectedIds).toEqual(["lawn-mowing"]);
    expect(draft.frequencies).toEqual({ "lawn-mowing": "weekly" });
    expect(draft.zipCode).toBe("33904");
    expect(draft.preferredProviders).toEqual({ "pool-service": "00000000-0000-4000-8000-000000000002" });
    expect(draft.submissionKey).toBe(key);
    expect(dropped).toEqual(expect.arrayContaining(["stateCode", "timeOfDay", "smsUpdates", "submissionKey"]));
  });

  it("drops a preference window that has already started", () => {
    const { draft, dropped } = parseDraft(JSON.stringify({ preferredDate: "2026-09-20", preferredEndDate: "2026-09-30" }), key, today);
    expect(draft.preferredDate).toBe("");
    expect(draft.preferredEndDate).toBe("2026-09-30");
    expect(dropped).toContain("preferredDate");
    expect(parseDraft(JSON.stringify({ preferredDate: "2026-10-05", preferredEndDate: "2026-10-01" }), key, today).draft.preferredEndDate).toBe("");
  });

  it("never restores promotion terms from an imported plan", () => {
    const { draft } = parseDraft(JSON.stringify({ serviceOverrides: { "lawn-mowing": {
      name: "Lawn", livePrices: { "one-time": 50, weekly: -1 }, promotionIds: { "one-time": "p" }, promotionLabels: { "one-time": "50% off" }, basePrices: { "one-time": 100 },
    } } }), key, today);
    expect(draft.serviceOverrides["lawn-mowing"]).toEqual({ name: "Lawn", description: undefined, defaultFrequency: undefined, frequencies: undefined, livePrices: { "one-time": 50 }, availability: undefined, packageSelections: undefined });
    expect(JSON.stringify(draft)).not.toMatch(/promotion|basePrices|50% off/);
  });

  it("keeps only well-formed offerings", () => {
    const { draft } = parseDraft(JSON.stringify({ packageSelections: {
      "lawn-mowing": { packageId: "00000000-0000-4000-8000-000000000003", tierId: "x", pricingMode: "fixed" },
      "pool-service": { packageId: "nope", pricingMode: "fixed" },
      "pest-control": { packageId: "00000000-0000-4000-8000-000000000004", pricingMode: "free" },
    } }), key, today);
    expect(Object.keys(draft.packageSelections)).toEqual(["lawn-mowing"]);
    expect(draft.packageSelections["lawn-mowing"].tierId).toBeUndefined();
  });

  it("locks a saved submission to its own key", () => {
    const saved = savedRecord();
    const { draft } = parseDraft(JSON.stringify({ submissionKey: "synthetic-key-9999999999", saved }), key, today);
    expect(draft.saved?.result.requests[0].request_id).toBe(saved.result.requests[0].request_id);
    expect(draft.submissionKey).toBe(saved.submissionKey);
  });

  it("rejects a saved record whose result is not a submitted plan", () => {
    const saved = { ...savedRecord(), result: { status: "refused", coverage: "covered", outcomes: [], requests: [] } };
    expect(parseDraft(JSON.stringify({ saved }), key, today).draft.saved).toBeNull();
  });
});

describe("actor isolation", () => {
  it("lets the first account adopt an anonymous draft", () => {
    const decision = reconcileDraftActor(emptyDraft(key), owner);
    expect(decision).toEqual({ action: "adopt", draft: { ...emptyDraft(key), ownerId: owner } });
  });
  it("discards another account's draft or saved result", () => {
    expect(reconcileDraftActor({ ...emptyDraft(key), ownerId: owner }, other)).toEqual({ action: "discard" });
    expect(reconcileDraftActor({ ...emptyDraft(key), saved: savedRecord() }, other)).toEqual({ action: "discard" });
  });
  it("holds a signed-in account's draft while signed out", () => {
    expect(reconcileDraftActor({ ...emptyDraft(key), ownerId: owner }, null)).toEqual({ action: "hold" });
  });
  it("keeps the owner's own draft", () => {
    expect(reconcileDraftActor({ ...emptyDraft(key), ownerId: owner }, owner).action).toBe("keep");
    expect(reconcileDraftActor(emptyDraft(key), null).action).toBe("keep");
  });
});

describe("draft storage", () => {
  it("reports unavailable or failing storage instead of pretending to save", () => {
    expect(readDraftStorage(null)).toEqual({ raw: null, available: false });
    expect(readDraftStorage({ getItem: () => { throw new Error("denied"); } })).toEqual({ raw: null, available: false });
    expect(writeDraftStorage({ setItem: () => { throw new Error("quota"); } }, emptyDraft(key))).toEqual({ ok: false });
    expect(clearDraftStorage({ removeItem: () => { throw new Error("denied"); } })).toEqual({ ok: false });
  });
  it("round-trips a draft", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (name: string) => store.get(name) ?? null, setItem: (name: string, value: string) => void store.set(name, value), removeItem: (name: string) => void store.delete(name) };
    const draft = { ...emptyDraft(key), selectedIds: ["lawn-mowing"], preferredDate: "2026-10-01" };
    expect(writeDraftStorage(storage, draft)).toEqual({ ok: true });
    expect(parseDraft(readDraftStorage(storage).raw, "synthetic-key-other00000", today).draft).toEqual(draft);
    expect(clearDraftStorage(storage)).toEqual({ ok: true });
    expect(store.has(REQUEST_DRAFT_KEY)).toBe(false);
  });
});

describe("Eastern dates", () => {
  it("uses the Eastern calendar day", () => {
    expect(easternDateValue(new Date("2026-09-28T03:30:00Z"))).toBe("2026-09-27");
    expect(easternDateValue(new Date("2026-09-28T04:30:00Z"))).toBe("2026-09-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

const outcome = (value: Partial<PreviewOutcome>): PreviewOutcome => ({ selection_index: 0, service_id: "lawn-mowing", outcome: "eligible_fixed", pricing_mode: "fixed", total: 100, ...value });

describe("preview responses", () => {
  it("accepts a covered result with one outcome per selection", () => {
    expect(parsePreviewResult({ stage: "final", coverage: "covered", outcomes: [outcome({})] }, 1).outcomes).toHaveLength(1);
    expect(parsePreviewResult({ stage: "final", coverage: "uncovered", outcomes: [] }, 2).coverage).toBe("uncovered");
  });
  it.each([
    null, {}, { stage: "final", coverage: "covered", outcomes: [] },
    { stage: "final", coverage: "maybe", outcomes: [] },
    { stage: "final", coverage: "covered", outcomes: [outcome({ outcome: "booked" as never })] },
  ])("treats %j as a verification error", (value) => {
    expect(() => parsePreviewResult(value, 1)).toThrow("unexpected response");
  });

  it("maps outcomes to intake states without inventing prices", () => {
    expect(serviceAvailability(outcome({}))).toMatchObject({ kind: "fixed", total: 100, exact: true });
    expect(serviceAvailability(outcome({ total: null, from_total: 80, depends_on_answers: true }))).toMatchObject({ kind: "fixed", total: 80, exact: false });
    expect(serviceAvailability(outcome({ total: null }))).toMatchObject({ kind: "needs_attention" });
    expect(serviceAvailability(outcome({ outcome: "eligible_quote", pricing_mode: "quote", offering_mode: "deposit_quote", total: null }))).toMatchObject({ kind: "quote", offeringMode: "deposit_quote" });
    expect(serviceAvailability(outcome({ outcome: "eligible_quote", pricing_mode: "quote", total: null }))).toMatchObject({ kind: "quote", offeringMode: "custom_quote" });
    expect(serviceAvailability(outcome({ promotion: true }))).toMatchObject({ kind: "promotion" });
    expect(serviceAvailability(outcome({ outcome: "unavailable" }))).toMatchObject({ kind: "unavailable" });
    expect(serviceAvailability(outcome({ outcome: "preferred_provider_unavailable" }))).toMatchObject({ kind: "needs_attention" });
  });

  it("submits only a plan where every selection is exactly eligible", () => {
    const plan = (...outcomes: PreviewOutcome[]) => ({ stage: "final" as const, coverage: "covered" as const, outcomes });
    expect(planIsSubmittable(plan(outcome({}), outcome({ selection_index: 1, outcome: "eligible_quote", pricing_mode: "quote", total: null })))).toBe(true);
    expect(planIsSubmittable(plan(outcome({}), outcome({ selection_index: 1, outcome: "unavailable" })))).toBe(false);
    expect(planIsSubmittable(plan(outcome({ total: null, from_total: 80 })))).toBe(false);
    expect(planIsSubmittable(plan(outcome({ promotion: true })))).toBe(false);
    expect(planIsSubmittable({ stage: "final", coverage: "waitlist", outcomes: [] })).toBe(false);
  });

  it("changes signature when any input changes", () => {
    const base = previewSignature("final", "33904", [{ service_id: "lawn-mowing", frequency: "one-time" }]);
    expect(previewSignature("final", "33904-1234", [{ service_id: "lawn-mowing", frequency: "one-time" }])).toBe(base);
    expect(previewSignature("final", "33905", [{ service_id: "lawn-mowing", frequency: "one-time" }])).not.toBe(base);
    expect(previewSignature("final", "33904", [{ service_id: "lawn-mowing", frequency: "one-time", answers: { sqft: "1" } }])).not.toBe(base);
    expect(previewSignature("availability", "33904", [{ service_id: "lawn-mowing", frequency: "one-time" }])).not.toBe(base);
  });
});

const request = (value: Partial<SubmittedRequest>): SubmittedRequest => ({ selection_index: 0, request_id: "r1", service_id: "lawn-mowing", pricing_mode: "fixed", quote_only: false, total_amount: 100, package_id: "p", package_tier_id: "t", ...value });
const row = (value: Partial<RequestReadback>): RequestReadback => ({ id: "r1", status: "pending", matching_status: "awaiting_match", pricing_mode: "fixed", total_amount: 100, contractor_id: null, payment_status: "pending", quote_status: null, quote_amount: null, ...value });
const confirm = (requests: SubmittedRequest[], readback: RequestReadback[] | null, extra: Partial<Parameters<typeof describeConfirmation>[0]> = {}) => describeConfirmation({
  requests, serviceNames: { "lawn-mowing": "Lawn care", "house-cleaning": "House cleaning" }, preferredProviderNames: {}, readback, matching: {}, checkout: { kind: "pending" }, formatMoney: money, ...extra,
});

describe("honest confirmation", () => {
  it("never calls a fixed request awaiting operations matching", () => {
    const [service] = confirm([request({})], [row({})]);
    expect(service.status).toBe("submitted");
    expect(service.summary).toContain("none is assigned yet");
    expect(service.summary).not.toMatch(/matching/i);
    expect(service.payment).toBe("$100.00 fixed price. Payment isn’t complete until secure checkout confirms it.");
  });

  it("treats a preferred provider as a preference", () => {
    const [service] = confirm([request({})], [row({})], { preferredProviderNames: { "lawn-mowing": "Synthetic Pro" } });
    expect(service.provider).toBe("Preferred provider: Synthetic Pro. This is a preference, not an assignment.");
  });

  it("reports quote dispatch as it is", () => {
    const quote = request({ pricing_mode: "custom_quote", quote_only: true, total_amount: null, package_id: null, package_tier_id: null });
    expect(confirm([quote], [row({ pricing_mode: "custom_quote", status: "matched", matching_status: "offered" })])[0]).toMatchObject({ status: "matching", summary: "Offered to an eligible provider for a quote. No provider has accepted yet." });
    expect(confirm([quote], [row({ pricing_mode: "custom_quote", matching_status: "exhausted" })])[0]).toMatchObject({ status: "unavailable" });
    expect(confirm([quote], [row({ pricing_mode: "custom_quote" })], { matching: { r1: "failed" } })[0]).toMatchObject({ status: "submitted", canRetryMatching: true });
    expect(confirm([quote], [row({ pricing_mode: "custom_quote", matching_status: "awaiting_consent" })])[0].summary).toContain("without your consent");
    expect(confirm([quote], [row({ pricing_mode: "custom_quote" })])[0].payment).toBe("Quote required. No amount is set yet and nothing has been charged.");
    expect(confirm([request({ pricing_mode: "deposit_quote", total_amount: null })], [row({})])[0].payment).toContain("Any deposit is set only when you accept a quote");
  });

  it("reports an accepted provider only when the database says so", () => {
    expect(confirm([request({})], [row({ matching_status: "matched", contractor_id: "c" })])[0]).toMatchObject({ status: "provider_confirmed", provider: "A provider accepted this request." });
    expect(confirm([request({})], [row({ matching_status: "matched", contractor_id: null })])[0].status).toBe("submitted");
  });

  it("does not guess when the read-back failed", () => {
    expect(confirm([request({})], null)[0]).toMatchObject({ status: "submitted", summary: expect.stringContaining("couldn’t load its current status") });
  });

  it("uses known payment state and never infers non-payment from a failed checkout", () => {
    expect(confirm([request({})], [row({ payment_status: "captured" })])[0].payment).toBe("Payment confirmed.");
    const failed = confirm([request({})], [row({})], { checkout: { kind: "failed" } })[0].payment;
    expect(failed).toContain("Check this request in your dashboard before paying");
    expect(failed).not.toMatch(/no payment was collected/i);
    expect(confirm([request({}), request({ request_id: "r2", service_id: "house-cleaning", selection_index: 1 })], [row({}), row({ id: "r2" })], { checkout: { kind: "not_offered", reason: "multiple" } })[0].payment).toContain("payment wasn’t requested");
  });
});

// P6-R2 (Codex review of TRACE-098): the saved intake reports the current lifecycle, not the
// initial acceptance, and never repeats submission-time payment claims after later activity.
describe("saved confirmation follows the current lifecycle", () => {
  const assigned = { matching_status: "matched", contractor_id: "c", payment_status: "captured" } as const;
  for (const [stored, expected] of [
    ["cancelled", "cancelled"], ["scheduled", "scheduled"], ["in_progress", "in_progress"],
    ["homeowner_confirmed", "completed"], ["vendor_completed", "completion_pending"],
    ["closed", "closed"], ["disputed", "disputed"], ["resolved", "resolved"],
  ] as const) {
    it(`shows ${stored} as ${expected}, not the initial acceptance`, () => {
      const [service] = confirm([request({})], [row({ ...assigned, status: stored })]);
      expect(service.status).toBe(expected);
      expect(service.summary).not.toBe("A provider accepted this request.");
      expect(service.canRetryMatching).toBe(false);
    });
  }

  it("does not fall back to submitted or quote copy for later states without a match", () => {
    const quoteRequest = request({ pricing_mode: "custom_quote", total_amount: null });
    expect(confirm([quoteRequest], [row({ status: "scheduled", matching_status: "awaiting_match" })])[0]).toMatchObject({ status: "scheduled" });
    expect(confirm([request({})], [row({ status: "cancelled" })])[0]).toMatchObject({ status: "cancelled", provider: "No provider will visit for this request." });
  });

  it("reports quote activity from the current readback", () => {
    const quoteRequest = request({ pricing_mode: "custom_quote", quote_only: true, total_amount: null, package_id: null, package_tier_id: null });
    const open = confirm([quoteRequest], [row({ pricing_mode: "custom_quote", status: "matched", matching_status: "matched", contractor_id: "c", quote_status: "submitted", quote_amount: 240 })])[0];
    expect(open).toMatchObject({ status: "quote_required" });
    expect(open.payment).toBe("Quote: $240.00. See your dashboard for the current price and payment status.");
    const accepted = confirm([quoteRequest], [row({ pricing_mode: "custom_quote", status: "matched", matching_status: "matched", contractor_id: "c", quote_status: "accepted", quote_amount: 240 })])[0];
    expect(accepted).toMatchObject({ status: "provider_confirmed", summary: expect.stringContaining("You accepted a quote") });
    expect(accepted.payment).toBe("Accepted quote: $240.00. See your dashboard for the current price and payment status.");
    for (const service of [open, accepted]) expect(service.payment).not.toMatch(/nothing has been charged|no amount is set/i);
    expect(confirm([quoteRequest], [row({ pricing_mode: "custom_quote", quote_status: "declined" })])[0].summary).toContain("hasn’t been cancelled");
  });

  it("names paid and refunded payment and treats other states as unknown after intake", () => {
    expect(confirm([request({})], [row({ payment_status: "released", status: "completed" })])[0].payment).toBe("Payment confirmed.");
    expect(confirm([request({})], [row({ payment_status: "refunded", status: "cancelled" })])[0].payment).toBe("Payment refunded. See your dashboard for details.");
    const later = confirm([request({})], [row({ status: "scheduled" })])[0].payment;
    expect(later).toBe("Submitted at $100.00 fixed price. See your dashboard for the current price and payment status.");
    const quoteLater = confirm([request({ pricing_mode: "deposit_quote", total_amount: null })], [row({ status: "in_progress" })])[0].payment;
    expect(quoteLater).not.toMatch(/nothing has been charged/i);
    expect(confirm([request({ pricing_mode: "custom_quote", total_amount: null })], null)[0].payment).not.toMatch(/nothing has been charged/i);
  });

  it("offers checkout and matching retry only while the request is still at intake", () => {
    expect(intakeCheckoutAllowed(row({}))).toBe(true);
    expect(intakeCheckoutAllowed(row({ status: "matched", matching_status: "matched", contractor_id: "c" }))).toBe(true);
    for (const value of [{ status: "scheduled" }, { status: "cancelled" }, { payment_status: "captured" }, { payment_status: "refunded" }, { quote_status: "accepted" }] as const) {
      expect(intakeCheckoutAllowed(row(value))).toBe(false);
    }
    expect(intakeCheckoutAllowed(null)).toBe(false);
    expect(intakeMatchingAllowed(row({}))).toBe(true);
    expect(intakeMatchingAllowed(row({ status: "cancelled" }))).toBe(false);
    expect(intakeMatchingAllowed(row({ matching_status: "offered" }))).toBe(false);
    const quoteRequest = request({ pricing_mode: "custom_quote", total_amount: null });
    expect(confirm([quoteRequest], [row({ status: "cancelled" })], { matching: { r1: "failed" } })[0].canRetryMatching).toBe(false);
  });
});

function photo(name = "a.png", type = "image/png", size = 10): RequestPhotoDraft {
  return { id: `id-${name}`, file: new File([new Uint8Array(size)], name, { type }), previewUrl: `blob:${name}` };
}

describe("photo selection", () => {
  it("applies type, size and count limits", () => {
    const files = [
      new File([new Uint8Array(1)], "ok.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array(1)], "doc.pdf", { type: "application/pdf" }),
      new File([], "empty.png", { type: "image/png" }),
      new File([new Uint8Array(1)], "b.webp", { type: "image/webp" }),
    ];
    const result = selectRequestPhotos(files, MAX_REQUEST_PHOTOS - 1);
    expect(result.accepted.map((file) => file.name)).toEqual(["ok.jpg"]);
    expect(result.rejected).toEqual(["doc.pdf: choose a JPG, PNG, or WebP image.", "empty.png: this image is empty."]);
    expect(result.overLimit).toBe(1);
  });
  it("rejects files over 8 MB", () => {
    const big = { name: "big.png", type: "image/png", size: 8 * 1024 * 1024 + 1 } as File;
    expect(selectRequestPhotos([big], 0).rejected).toEqual(["big.png: images must be 8 MB or smaller."]);
  });
});

// A scripted Supabase double: job_photos rows, storage objects and injectable failures.
function fakeSupabase({ links = [] as [string, string][], failUpload = false, insertError = null as null | "definitive" | "lost", readFailsAfterInsert = false, objects = [] as string[] } = {}) {
  const rows = new Set(links.map(([request, path]) => `${request}|${path}`));
  const stored = new Set(objects);
  const removed: string[] = [];
  const uploads: string[] = [];
  let inserts = 0;
  let reads = 0;
  const client = {
    from: () => ({
      select: () => {
        const filter = { requests: [] as string[], paths: [] as string[] };
        const query = {
          in(column: string, values: string[]) { if (column === "service_request_id") filter.requests = values; else filter.paths = values; return query; },
          eq() {
            reads += 1;
            if (readFailsAfterInsert && inserts > 0) return Promise.resolve({ data: null, error: { message: "offline" } });
            const data = [...rows].map((row) => row.split("|")).filter(([request, path]) => filter.requests.includes(request) && filter.paths.includes(path)).map(([service_request_id, photo_url]) => ({ service_request_id, photo_url }));
            return Promise.resolve({ data, error: null });
          },
        };
        return query;
      },
      insert: (values: { service_request_id: string; photo_url: string }[]) => {
        inserts += 1;
        if (insertError === "definitive") return Promise.resolve({ error: { code: "42501", message: "denied" } });
        values.forEach((value) => rows.add(`${value.service_request_id}|${value.photo_url}`));
        return Promise.resolve({ error: insertError === "lost" ? { message: "TypeError: Failed to fetch" } : null });
      },
    }),
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploads.push(path);
          if (failUpload) return Promise.resolve({ error: { statusCode: "500", message: "Synthetic" } });
          if (stored.has(path)) return Promise.resolve({ error: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } });
          stored.add(path);
          return Promise.resolve({ error: null });
        },
        remove: (paths: string[]) => { paths.forEach((path) => { removed.push(path); stored.delete(path); }); return Promise.resolve({ error: null }); },
        list: (folder: string) => Promise.resolve({ data: [...stored].filter((path) => path.startsWith(`${folder}/`)).map((path) => ({ name: path.slice(folder.length + 1) })), error: null }),
      }),
    },
  };
  return { client: client as never, rows, stored, removed, uploads, counts: () => ({ inserts, reads }) };
}

describe("photo attachment", () => {
  const userId = owner;
  const requestIds = ["r1", "r2"];
  const photos = [photo("a.png"), photo("b.jpg", "image/jpeg")];
  const paths = photos.map((item) => requestPhotoPath(userId, requestIds, item));

  it("uses one stable object per photo in the owner's folder", () => {
    expect(paths).toEqual([`${userId}/r1/intake-id-a.png.png`, `${userId}/r1/intake-id-b.jpg.jpg`]);
  });

  it("links every photo to every request in the plan", async () => {
    const fake = fakeSupabase();
    const progress = vi.fn();
    expect(await attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos, onProgress: progress })).toEqual({ linked: 4, uploaded: 2, alreadyLinked: 0 });
    expect(fake.rows.size).toBe(4);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("a retry after full success changes nothing", async () => {
    const fake = fakeSupabase({ links: requestIds.flatMap((id) => paths.map((path) => [id, path] as [string, string])) });
    expect(await attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos })).toEqual({ linked: 4, uploaded: 0, alreadyLinked: 4 });
    expect(fake.uploads).toEqual([]);
    expect(fake.counts().inserts).toBe(0);
  });

  it("completes a partial earlier attempt without duplicates", async () => {
    const fake = fakeSupabase({ links: [["r1", paths[0]]], objects: [paths[0], paths[1]] });
    await attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos });
    expect([...fake.rows].sort()).toEqual([`r1|${paths[0]}`, `r1|${paths[1]}`, `r2|${paths[0]}`, `r2|${paths[1]}`].sort());
    expect(fake.uploads).toEqual([paths[1]]);
  });

  it("recognizes an upload whose response was lost", async () => {
    const fake = fakeSupabase({ objects: [paths[0]] });
    expect((await attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos })).uploaded).toBe(1);
    expect(fake.rows.size).toBe(4);
  });

  it("an association that committed despite a failed response is success", async () => {
    const fake = fakeSupabase({ insertError: "lost" });
    await expect(attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos })).resolves.toMatchObject({ linked: 4 });
    expect(fake.removed).toEqual([]);
  });

  it("cleans up only unlinked objects after a definitive association failure", async () => {
    const fake = fakeSupabase({ insertError: "definitive" });
    await expect(attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos })).rejects.toMatchObject({ kind: "association" });
    expect(fake.removed.sort()).toEqual([...paths].sort());
  });

  it("keeps objects when it can't confirm the association", async () => {
    const fake = fakeSupabase({ insertError: "lost", readFailsAfterInsert: true });
    await expect(attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos })).rejects.toMatchObject({ kind: "uncertain" });
    expect(fake.removed).toEqual([]);
  });

  it("removes this attempt's uploads after an upload failure", async () => {
    const fake = fakeSupabase({ failUpload: true });
    const error = await attachRequestPhotos({ supabase: fake.client, userId, requestIds, photos }).catch((reason) => reason);
    expect(error).toBeInstanceOf(RequestPhotoError);
    expect(error.kind).toBe("upload");
    expect(fake.rows.size).toBe(0);
  });

  it("discard removes every unlinked intake object in the plan folder, including earlier attempts", async () => {
    const stale = `${userId}/r1/intake-stale.png`;
    const fake = fakeSupabase({ links: [["r1", paths[0]], ["r2", paths[0]]], objects: [paths[0], stale, `${userId}/r1/completion.png`] });
    expect(await discardUnattachedRequestPhotos({ supabase: fake.client, userId, requestIds })).toEqual([stale]);
    expect(fake.stored.has(paths[0])).toBe(true);
  });
});

function savedRecord(): SavedSubmission {
  return {
    actorId: owner,
    submissionKey: "synthetic-key-saved000001",
    payload: { location: { address: "1", city: "c", state: "FL", zip_code: "33904" }, selections: [] },
    result: { status: "submitted", coverage: "covered", reused: false, outcomes: [], requests: [request({ request_id: "00000000-0000-4000-8000-000000000050" })] },
    serviceNames: { "lawn-mowing": "Lawn care" },
    preferredProviderNames: {},
    photosPending: 0,
    savedAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("sign-up continuation", () => {
  it("carries only the request intake", async () => {
    const { requestContinuationPath } = await import("../../src/lib/auth/continuation");
    expect(requestContinuationPath("/request")).toBe("/request");
    for (const value of [null, "", "/dashboard", "/request?x=1", "//evil.example", "https://evil.example/request"]) {
      expect(requestContinuationPath(value)).toBeNull();
    }
  });
});
