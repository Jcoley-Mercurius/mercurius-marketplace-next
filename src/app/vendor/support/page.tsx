import { Suspense } from "react";
import { PageState } from "@/components/ui/page-state";
import { SupportCenter } from "@/components/support/SupportCenter";

export default function VendorSupportPage() {
  return <Suspense fallback={<div className="p-4 sm:p-6 md:p-8"><PageState kind="loading" title="Loading support" /></div>}>
    <SupportCenter audience="provider" />
  </Suspense>;
}
