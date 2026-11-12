// Phase 7.2B / TRACE-153 (DEC-2026-065): controlled wording for in-app notices shown to vendors.
//
// The stored title and body are never rendered on the vendor page. The stored `type` and the exact
// title a producer writes are used only to recognize which recorded event a row is; the copy shown
// is fixed here and interpolates nothing from the row (no reasons, notes, names, amounts, times or
// ticket numbers). A title that differs in any way from a known producer title is not recognized and
// gets its category's generic copy; an unknown type gets the generic notice.
//
// Every description describes an update that was recorded, then points to the surface with the
// current details. None says that an offer is still open, that an appointment currently exists, or
// that a payment or payout happened: a vendor can read notices of any age (DEC-2026-065 item 1).
//
// Producers and stored records are unchanged. This is presentation only.

export type VendorNoticeCategory =
  | "offer"
  | "quote"
  | "terms"
  | "appointment"
  | "service"
  | "completion"
  | "cancellation"
  | "replacement"
  | "pricing"
  | "support"
  | "general";

export type VendorNoticePresentation = {
  /** Stable identifier of the recognized event, or of the fallback used. */
  key: string;
  category: VendorNoticeCategory;
  title: string;
  description: string;
  /** False when only the category, or nothing, was recognized. */
  recognized: boolean;
};

type Copy = Omit<VendorNoticePresentation, "recognized">;

const JOBS = "Check Jobs & Requests";
const jobs = "check Jobs & Requests";

const offer: Copy = {
  key: "offer",
  category: "offer",
  title: "Job offer recorded",
  description:
    `Mercurius offered you a job. Offers close at their response deadline, so ${jobs} to see whether this one is still open.`,
};

// type → exact producer title → copy. Titles are the literal strings in the live producers
// (governance/PHASE-7-NOTIFICATION-CONTRACT.md §5; event IDs in comments).
const BY_TITLE: Record<string, Record<string, Copy>> = {
  job_offer: {
    // N-REQ-01 (create_job_offer_internal).
    "New job offer — respond within four hours": offer,
    // N-REQ-05 legacy trigger text (dormant; any historical row shows the same neutral copy).
    "New job offer — respond within 24 hours": { ...offer, key: "offer_legacy" },
  },
  job_status: {
    // N-QTE-02.
    "Your quote proposal was returned": {
      key: "quote_returned",
      category: "quote",
      title: "Quote proposal returned",
      description:
        `Mercurius returned a quote proposal you made without sending it. ${JOBS} for the job's current details.`,
    },
    // N-QTE-04.
    "Your quote was sent": {
      key: "quote_sent",
      category: "quote",
      title: "Quote sent to the homeowner",
      description: `Mercurius sent a quote based on your proposal. ${JOBS} for the quote's current status.`,
    },
    "Your quote was corrected and sent": {
      key: "quote_corrected",
      category: "quote",
      title: "Quote corrected and sent",
      description:
        `Mercurius corrected your proposal before sending it to the homeowner. ${JOBS} for the items and the quote's current status.`,
    },
    // N-QTE-10 (DEC-2026-063).
    "Homeowner accepted your terms": {
      key: "terms_accepted",
      category: "terms",
      title: "Homeowner accepted your terms",
      description:
        `The homeowner accepted the terms you accepted for a job. ${JOBS} for the job's current status and appointment.`,
    },
    "Homeowner declined your terms": {
      key: "terms_declined",
      category: "terms",
      title: "Homeowner declined your terms",
      description:
        `The homeowner declined the terms you accepted for a job, and the request was unassigned from you. ${JOBS} for your current work.`,
    },
    // N-APT-01 (the stored body carries the time and the operator's reason; neither is shown).
    "Appointment recorded": appointment("appointment_recorded"),
    "Appointment changed": appointment("appointment_changed"),
    "Appointment unchanged": appointment("appointment_unchanged"),
    // N-APT-02, N-FUL-07, N-CXL-01/02 (the stored body carries the actor's reason; not shown).
    "Service update": {
      key: "service_update",
      category: "service",
      title: "Service update recorded",
      description: `A service update was recorded for one of your jobs. ${JOBS} for the job's current details.`,
    },
    // N-APT-03.
    "Proposed time accepted": {
      key: "proposed_time_accepted",
      category: "appointment",
      title: "Homeowner accepted a proposed time",
      description:
        `The homeowner accepted a proposed appointment time. An appointment changes only when Mercurius records it, so ${jobs} for the current time.`,
    },
    "Proposed time declined": {
      key: "proposed_time_declined",
      category: "appointment",
      title: "Homeowner declined a proposed time",
      description: `The homeowner declined a proposed appointment time. ${JOBS} for the current appointment.`,
    },
    // N-FUL-03.
    "Homeowner confirmed the job": {
      key: "homeowner_confirmed",
      category: "completion",
      title: "Homeowner confirmed completion",
      description:
        "The homeowner confirmed your completed work. Check Earnings & Payouts for its payout status, which is tracked separately.",
    },
    // N-FUL-04.
    "Job completed": {
      key: "job_completed",
      category: "completion",
      title: "Job closed out",
      description: "A job was recorded as complete. Check Earnings & Payouts for its payout status, which is tracked separately.",
    },
    // N-CXL-01.
    "Job cancelled": {
      key: "job_cancelled",
      category: "cancellation",
      title: "Job cancellation recorded",
      description: `A job assigned to you was recorded as cancelled. ${JOBS} for your current work.`,
    },
    // N-CXL-05.
    "Replacement accepted": {
      key: "replacement_accepted",
      category: "replacement",
      title: "Homeowner accepted a replacement",
      description:
        `The homeowner accepted a replacement proposal naming you. ${JOBS} for the job's current status and appointment.`,
    },
    "Replacement declined": {
      key: "replacement_declined",
      category: "replacement",
      title: "Homeowner declined a replacement",
      description: `The homeowner declined a replacement proposal naming you. ${JOBS} for your current work.`,
    },
  },
  pricing: {
    // N-PRC-01.
    "A price is waiting for your approval": {
      key: "price_approval",
      category: "pricing",
      title: "Price sent for your approval",
      description:
        "Mercurius sent a price for your review. Check Pricing & Packages to see whether it still needs your answer.",
    },
    // N-PRC-02.
    "An offer is waiting for your approval": {
      key: "offer_approval",
      category: "pricing",
      title: "Offer sent for your approval",
      description:
        "Mercurius sent an offer you would fund for your review. Check Pricing & Packages to see whether it still needs your answer.",
    },
    // N-PRC-03 (the stored body carries the operator's reason; not shown).
    "Mercurius paused one of your prices": {
      key: "price_paused",
      category: "pricing",
      title: "Price paused",
      description: "Mercurius paused one of your prices. Check Pricing & Packages for your current prices.",
    },
    // N-PRC-04.
    "Your approved price is live": pricePublished("price_published_approved"),
    "Mercurius published a price for you": pricePublished("price_published"),
  },
};

// N-SUP-03: "Mercurius replied on <ticket number>". Only the fixed prefix is matched; the ticket
// number and subject are not shown.
const SUPPORT_REPLY_PREFIX = "Mercurius replied on ";
const supportReply: Copy = {
  key: "support_reply",
  category: "support",
  title: "Support reply",
  description: "Mercurius replied to one of your support requests. Open Support to read it.",
};

const BY_TYPE: Record<string, Copy> = {
  job_offer: offer,
  job_status: jobFallback("job_update"),
  job_confirmation: jobFallback("job_confirmation"),
  dispute: jobFallback("job_dispute"),
  pricing: {
    key: "pricing_update",
    category: "pricing",
    title: "Pricing update recorded",
    description: "An update was recorded for your prices. Check Pricing & Packages for current details.",
  },
  support: {
    key: "support_update",
    category: "support",
    title: "Support update",
    description: "An update was recorded for one of your support requests. Open Support for current details.",
  },
};

export const GENERIC_VENDOR_NOTICE: Copy = {
  key: "generic",
  category: "general",
  title: "Account update recorded",
  description: "An update was recorded for your vendor account. Open it to see the current details.",
};

export function presentVendorNotification(notification: {
  type: string | null;
  title: string | null;
}): VendorNoticePresentation {
  const type = typeof notification.type === "string" ? notification.type : "";
  const title = typeof notification.title === "string" ? notification.title : "";

  const exact = Object.hasOwn(BY_TITLE, type) && Object.hasOwn(BY_TITLE[type], title)
    ? BY_TITLE[type][title]
    : undefined;
  if (exact) return { ...exact, recognized: true };
  if (type === "support" && title.startsWith(SUPPORT_REPLY_PREFIX)) return { ...supportReply, recognized: true };
  if (Object.hasOwn(BY_TYPE, type)) return { ...BY_TYPE[type], recognized: false };
  return { ...GENERIC_VENDOR_NOTICE, recognized: false };
}

function appointment(key: string): Copy {
  return {
    key,
    category: "appointment",
    title: "Appointment update recorded",
    description:
      `Mercurius recorded an appointment update for one of your jobs. Appointments can change, so ${jobs} for the current time.`,
  };
}

function pricePublished(key: string): Copy {
  return {
    key,
    category: "pricing",
    title: "Price published",
    description: "Mercurius published a price for you. Check Pricing & Packages for your current prices.",
  };
}

function jobFallback(key: string): Copy {
  return {
    key,
    category: "service",
    title: "Job update recorded",
    description: `An update was recorded for one of your jobs. ${JOBS} for current details.`,
  };
}
