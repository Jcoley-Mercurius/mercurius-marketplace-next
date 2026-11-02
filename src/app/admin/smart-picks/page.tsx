import { redirect } from "next/navigation";

// TRACE-136: Smart Picks are deferred (MPS §3) and no longer have an admin page. Operator-curated
// Spotlight placements live in Featured Providers.
export default function AdminSmartPicksPage() {
  redirect("/admin/featured");
}
