import { redirect } from "next/navigation";

// TRACE-134 (6.11B): no vendor plans or subscriptions are offered (MPS §3, §7.3); the former Plans
// page sends an old link to the vendor overview.
export default function VendorPlanPage() {
  redirect("/vendor");
}
