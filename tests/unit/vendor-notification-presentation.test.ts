import { describe, expect, it } from "vitest";
import { GENERIC_VENDOR_NOTICE, presentVendorNotification } from "@/lib/vendorNotificationPresentation";

// Phase 7.2B / TRACE-153 (DEC-2026-065 item 2): vendors see controlled wording, never the stored
// title or body, and nothing interpolated from them.

// Every (type, title) a live producer writes to a vendor recipient (PHASE-7-NOTIFICATION-CONTRACT §5,
// rechecked against pg_get_functiondef on the local replay of all 226 migrations), plus the dormant
// legacy offer text.
const producerTitles: Array<[type: string, title: string, key: string]> = [
  ["job_offer", "New job offer — respond within four hours", "offer"],
  ["job_offer", "New job offer — respond within 24 hours", "offer_legacy"],
  ["job_status", "Your quote proposal was returned", "quote_returned"],
  ["job_status", "Your quote was sent", "quote_sent"],
  ["job_status", "Your quote was corrected and sent", "quote_corrected"],
  ["job_status", "Homeowner accepted your terms", "terms_accepted"],
  ["job_status", "Homeowner declined your terms", "terms_declined"],
  ["job_status", "Appointment recorded", "appointment_recorded"],
  ["job_status", "Appointment changed", "appointment_changed"],
  ["job_status", "Appointment unchanged", "appointment_unchanged"],
  ["job_status", "Service update", "service_update"],
  ["job_status", "Proposed time accepted", "proposed_time_accepted"],
  ["job_status", "Proposed time declined", "proposed_time_declined"],
  ["job_status", "Homeowner confirmed the job", "homeowner_confirmed"],
  ["job_status", "Job completed", "job_completed"],
  ["job_status", "Job cancelled", "job_cancelled"],
  ["job_status", "Replacement accepted", "replacement_accepted"],
  ["job_status", "Replacement declined", "replacement_declined"],
  ["pricing", "A price is waiting for your approval", "price_approval"],
  ["pricing", "An offer is waiting for your approval", "offer_approval"],
  ["pricing", "Mercurius paused one of your prices", "price_paused"],
  ["pricing", "Your approved price is live", "price_published_approved"],
  ["pricing", "Mercurius published a price for you", "price_published"],
  ["support", "Mercurius replied on MS-000123", "support_reply"],
];

const sensitive = [
  "Homeowner said: gate code 4471, call 239-555-0100",
  "<img src=x onerror=alert(1)>",
  "Operator note: refund $412.50 to card ending 4242",
  "jane.doe@example.invalid",
  "Reason: the homeowner was rude",
];

const text = (p: { title: string; description: string }) => `${p.title}\n${p.description}`;

describe("recognized producer events", () => {
  for (const [type, title, key] of producerTitles) {
    it(`${type} / ${title}`, () => {
      const presentation = presentVendorNotification({ type, title });
      expect(presentation.recognized).toBe(true);
      expect(presentation.key).toBe(key);
    });
  }

  it("never shows the support ticket number", () => {
    expect(text(presentVendorNotification({ type: "support", title: "Mercurius replied on MS-000123" }))).not.toContain("MS-000123");
  });
});

describe("stored text never reaches the vendor", () => {
  it("does not render injected text appended to, or replacing, a stored title", () => {
    for (const [type, title] of producerTitles) {
      for (const secret of sensitive) {
        for (const stored of [`${title} ${secret}`, secret, `${secret} ${title}`]) {
          const presentation = presentVendorNotification({ type, title: stored });
          expect(text(presentation)).not.toContain(secret);
          if (!(type === "support" && stored.startsWith("Mercurius replied on "))) expect(presentation.recognized).toBe(false);
        }
      }
    }
  });

  it("produces the same copy whatever the stored body, link or severity", () => {
    for (const [type, title] of producerTitles) {
      const plain = presentVendorNotification({ type, title });
      for (const secret of sensitive) {
        const row = { type, title, body: secret, link: `https://evil.example/${secret}`, severity: "critical" };
        expect(presentVendorNotification(row)).toEqual(plain);
      }
    }
  });

  it("copy is fixed text: no stored word that is not in the controlled vocabulary appears", () => {
    const all = producerTitles.map(([type, title]) => text(presentVendorNotification({ type, title }))).join("\n");
    for (const secret of sensitive) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/[<>]|\$\d|@/);
  });
});

describe("historical-safe wording", () => {
  const copies = [
    ...producerTitles.map(([type, title]) => presentVendorNotification({ type, title })),
    ...["job_offer", "job_status", "job_confirmation", "dispute", "pricing", "support", "unknown_type"].map((type) =>
      presentVendorNotification({ type, title: "unrecognized" })),
  ];

  it("never says an offer is open, an appointment exists, or money moved", () => {
    for (const copy of copies) {
      const words = text(copy);
      expect(words, copy.key).not.toMatch(/respond within|four hours|24 hours|before (its|the) deadline|is scheduled|are scheduled|confirmed and scheduled/i);
      expect(words, copy.key).not.toMatch(/\b(paid|charged|refunded|released|deposited|transferred)\b/i);
      expect(words, copy.key).not.toMatch(/payout (is|was|has been) (sent|made|scheduled|on its way)/i);
      expect(words, copy.key).not.toMatch(/\byour appointment is\b/i);
    }
  });

  it("each description points to where the current details are", () => {
    for (const copy of copies) {
      expect(copy.description, copy.key).toMatch(/\b(check|open) /i);
    }
  });
});

describe("unknown and legacy notices", () => {
  it("an unknown type gets the generic notice", () => {
    for (const type of ["legacy_vendor_note", "", "JOB_STATUS", "__proto__", "constructor", "toString"]) {
      expect(presentVendorNotification({ type, title: "Anything at all" })).toEqual({ ...GENERIC_VENDOR_NOTICE, recognized: false });
    }
  });

  it("a known type with an unknown title gets its category's generic copy", () => {
    expect(presentVendorNotification({ type: "job_status", title: "Provider accepted your service" })).toMatchObject({ key: "job_update", recognized: false });
    expect(presentVendorNotification({ type: "pricing", title: "Old pricing text" })).toMatchObject({ key: "pricing_update", recognized: false });
    expect(presentVendorNotification({ type: "support", title: "Support request MS-1" })).toMatchObject({ key: "support_update", recognized: false });
    expect(presentVendorNotification({ type: "job_offer", title: "Old offer text" })).toMatchObject({ key: "offer", recognized: false });
  });

  it("tolerates missing fields and prototype keys", () => {
    expect(presentVendorNotification({ type: null, title: null }).key).toBe("generic");
    expect(presentVendorNotification({ type: "job_status", title: "__proto__" }).key).toBe("job_update");
    expect(presentVendorNotification({ type: "job_status", title: "constructor" }).key).toBe("job_update");
  });
});
