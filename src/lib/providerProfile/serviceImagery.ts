/**
 * Illustrative service photos for provider profiles (TRACE-156 P2C).
 *
 * Each photo is mapped to one catalog service by its exact id. Nothing is inferred from captions,
 * names or tags, and a service with no entry shows no illustrative photo. The files are reviewed
 * static assets; provenance, licence and approval status are recorded in
 * docs/imagery/service-imagery-manifest.json.
 *
 * These photos support the service description only. They are never the provider's portfolio,
 * team, completed work, customer results or before-and-after evidence.
 */

export const ILLUSTRATIVE_PHOTO_LABEL = "Illustrative service photo";

const ALT_TEXT: Readonly<Record<string, string>> = {
  "ac-maintenance": "Illustrative photo of an outdoor air conditioning unit mounted on a metal roof.",
  "deep-cleaning": "Illustrative photo of a bright, tidy bedroom with white bedding and sheer curtains.",
  "gutter-cleaning": "Illustrative photo of a metal rain gutter along a tiled roof edge, with a small bird perched on it.",
  handyman: "Illustrative photo of a drill, tape measure, level, screws and wall anchors on printed floor plans.",
  "house-cleaning": "Illustrative photo of a tidy white kitchen with a farmhouse sink below a bay window.",
  "lawn-mowing": "Illustrative photo of a wide, well-kept green lawn in front of a white house.",
  "painting-interior": "Illustrative photo of a painter, seen from behind, holding a roller in front of a yellow and white striped wall.",
  "plumbing-repair": "Illustrative photo of a close-up metal faucet on a sink.",
  "pool-service": "Illustrative photo of a clear blue swimming pool in a paved courtyard with palm trees.",
  "shrub-hedge-trimming": "Illustrative photo of a neatly trimmed hedge along a paved drive lined with palm trees.",
  "trash-can-cleaning": "Illustrative photo of four wheeled waste bins lined up in front of green trees.",
};

export const SERVICE_IMAGE_WIDTHS = { wide: [480, 720, 960], compact: [320, 480, 640] } as const;

export type ServiceImage = {
  serviceId: string;
  alt: string;
  /** 16:9, for phones. */
  wide: { src: string; srcSet: string; width: number; height: number };
  /** 4:3, beside the caption from 640 px. */
  compact: { srcSet: string; width: number; height: number };
};

const fileFor = (serviceId: string, crop: "wide" | "compact", width: number) => `/images/services/${serviceId}-${crop}-${width}.webp`;
const srcSetFor = (serviceId: string, crop: "wide" | "compact") =>
  SERVICE_IMAGE_WIDTHS[crop].map((width) => `${fileFor(serviceId, crop, width)} ${width}w`).join(", ");

/** The ids that have a mapped photo. */
export const mappedServiceImageIds = (): string[] => Object.keys(ALT_TEXT);

/** The photo mapped to exactly this service id. The id may come from a link, so only own entries count. */
export function serviceImageFor(serviceId: string): ServiceImage | null {
  if (!Object.hasOwn(ALT_TEXT, serviceId)) return null;
  return {
    serviceId,
    alt: ALT_TEXT[serviceId],
    wide: { src: fileFor(serviceId, "wide", 720), srcSet: srcSetFor(serviceId, "wide"), width: 960, height: 540 },
    compact: { srcSet: srcSetFor(serviceId, "compact"), width: 640, height: 480 },
  };
}

/**
 * The illustrative photo for a selected service. Provider media linked to that service always
 * takes its place; All services never shows one.
 */
export function serviceIllustration(serviceId: string | null, providerMediaIsGeneral: boolean): ServiceImage | null {
  if (!serviceId || !providerMediaIsGeneral) return null;
  return serviceImageFor(serviceId);
}
