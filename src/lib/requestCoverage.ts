export type RequestCoverageStatus =
  | "idle"
  | "checking"
  | "covered"
  | "waitlist"
  | "uncovered"
  | "error";

export type CoverageArea = {
  id: string;
  zip_code: string;
  city: string;
  state: string;
  is_active: boolean;
  has_waitlist: boolean;
};

export type RequestCoverageResult = {
  status: Exclude<RequestCoverageStatus, "idle" | "checking">;
  area: CoverageArea | null;
  checkedZip: string;
  message?: string;
};

export async function resolveRequestCoverage(
  location: { zipCode: string; city: string; state: string },
): Promise<RequestCoverageResult> {
  const zipCode = location.zipCode.trim().slice(0, 5);
  if (!/^\d{5}$/.test(zipCode)) {
    return {
      status: "error",
      area: null,
      checkedZip: zipCode,
      message: "Enter a valid five-digit ZIP code so we can verify service coverage.",
    };
  }

  try {
    const response = await fetch(`/api/request-coverage?zip=${encodeURIComponent(zipCode)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const result = await response.json() as RequestCoverageResult & { error?: string };
    if (!response.ok) throw new Error(result.error);
    return result;
  } catch (error) {
    return {
      status: "error",
      area: null,
      checkedZip: zipCode,
      message: error instanceof Error && error.message
        ? error.message
        : "We couldn’t verify the live service-area list right now.",
    };
  }
}
