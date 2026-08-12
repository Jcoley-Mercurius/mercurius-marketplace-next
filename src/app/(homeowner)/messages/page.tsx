import { HomeownerMessagesExperience } from "@/components/homeowner/HomeownerMessagesExperience";

type MessagesPageProps = {
  searchParams: Promise<{ request?: string | string[] }>;
};

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  const params = await searchParams;
  const requestId =
    typeof params.request === "string" && params.request.trim()
      ? params.request.trim()
      : null;

  return <HomeownerMessagesExperience requestedRequestId={requestId} />;
}
