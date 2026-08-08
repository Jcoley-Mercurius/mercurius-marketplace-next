import { VendorMessagesExperience } from "@/components/vendor/VendorMessagesExperience";

type VendorMessagesPageProps = {
  searchParams: Promise<{ request?: string | string[] }>;
};

export default async function VendorMessagesPage({ searchParams }: VendorMessagesPageProps) {
  const params = await searchParams;
  const requestId = typeof params.request === "string" && params.request.trim()
    ? params.request.trim()
    : null;

  return <VendorMessagesExperience requestedRequestId={requestId} />;
}
