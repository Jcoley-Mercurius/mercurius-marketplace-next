import { describe, expect, it, vi } from "vitest";
import {
  assignableOptions,
  assignNewPhoto,
  galleryPhotosFromRows,
  GENERAL_BUSINESS_LABEL,
  photoServiceLabel,
  savePhotoServices,
  type PhotoServiceOption,
} from "@/lib/providerProfile/photoServices";

type Client = Parameters<typeof savePhotoServices>[0];

const row = (links: unknown) => ({ id: "p1", image_url: "/p1.jpg", caption: null, sort_order: 0, contractor_gallery_services: links });
const options: PhotoServiceOption[] = [
  { service_id: "pool-service", service_name: "Pool service", is_applicable: true },
  { service_id: "gutter-cleaning", service_name: "Gutter cleaning", is_applicable: true },
  { service_id: "lawn-care", service_name: "Lawn care", is_applicable: false },
];
const rpcClient = (answer: { data?: unknown; error?: unknown }) => {
  const rpc = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  return { client: { rpc } as unknown as Client, rpc };
};

describe("gallery photo rows", () => {
  it("attaches saved links and keeps a photo with none as general", () => {
    expect(galleryPhotosFromRows([row([{ service_id: "pool-service" }, { service_id: "pool-service" }])])?.[0].service_ids).toEqual(["pool-service"]);
    expect(galleryPhotosFromRows([row([])])?.[0].service_ids).toEqual([]);
  });

  it.each([[undefined], [null], ["pool-service"], [[{}]], [[{ service_id: "" }]], [[null]]])("refuses unreadable links %j", (links) => {
    expect(galleryPhotosFromRows([row([]), row(links)])).toBeNull();
  });
});

describe("assignable services", () => {
  it("offers applicable services, and a withdrawn one only to a photo that already names it", () => {
    expect(assignableOptions(options).map((option) => option.service_id)).toEqual(["pool-service", "gutter-cleaning"]);
    expect(assignableOptions(options, ["lawn-care"]).map((option) => option.service_id)).toEqual(["pool-service", "gutter-cleaning", "lawn-care"]);
  });
});

describe("assignment labels", () => {
  it("names general business and sorted services", () => {
    expect(photoServiceLabel([], options)).toBe(GENERAL_BUSINESS_LABEL);
    expect(photoServiceLabel(["pool-service", "gutter-cleaning"], options)).toBe("Gutter cleaning, Pool service");
  });

  it("counts links it cannot name instead of guessing a name", () => {
    expect(photoServiceLabel(["pool-service"], [])).toBe("1 service");
    expect(photoServiceLabel(["pool-service", "unknown"], options)).toBe("2 services");
  });
});

describe("saving", () => {
  it("sends only the photo and the services: never an owner or a role", async () => {
    const { client, rpc } = rpcClient({ data: ["pool-service"] });
    await expect(savePhotoServices(client, "p1", ["pool-service"])).resolves.toEqual(["pool-service"]);
    expect(rpc).toHaveBeenCalledWith("set_contractor_gallery_photo_services", { p_gallery_id: "p1", p_service_ids: ["pool-service"] });
  });

  it("reports a refused save", async () => {
    const { client } = rpcClient({ error: { message: "refused" } });
    await expect(savePhotoServices(client, "p1", [])).rejects.toEqual({ message: "refused" });
  });
});

describe("a new upload", () => {
  it("makes no link call when no service was chosen", async () => {
    const { client, rpc } = rpcClient({});
    await expect(assignNewPhoto(client, row([]), [])).resolves.toMatchObject({ assigned: true, photo: { service_ids: [] } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the saved links", async () => {
    const { client } = rpcClient({ data: ["gutter-cleaning", "pool-service"] });
    await expect(assignNewPhoto(client, row([]), ["pool-service", "gutter-cleaning"])).resolves.toMatchObject({ assigned: true, photo: { service_ids: ["gutter-cleaning", "pool-service"] } });
  });

  it("keeps the photo as general business and says so when the links fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = rpcClient({ error: { message: "refused" } });
    await expect(assignNewPhoto(client, row([]), ["pool-service"])).resolves.toMatchObject({ assigned: false, photo: { id: "p1", service_ids: [] } });
    warn.mockRestore();
  });
});
