import { CheckoutReview } from "@/features/payments/checkout-review";

export default async function CheckoutPage({ params, searchParams }: {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<{ mode?: string; submitted?: string }>;
}) {
  const { snapshotId } = await params;
  const { mode: requestedMode, submitted } = await searchParams;
  const mode = requestedMode === "deposit" || requestedMode === "balance" ? requestedMode : "full";
  return <CheckoutReview key={snapshotId} snapshotId={snapshotId} mode={mode} submitted={submitted === "1"} />;
}
