import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EARLY_ACCESS_CTA, EARLY_ACCESS_PATH } from "@/lib/earlyAccessExperience";
import { cn } from "@/lib/utils";

// TRACE-161: the page's one closing early-access block.
export function BookingOpensCta() {
  return (
    <section aria-labelledby="booking-opens-title" className="pb-16 pt-6 md:pb-20">
      <div className="container-wide">
        <div className="flex flex-col gap-5 rounded-2xl border border-accent-border bg-sage-light p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-8">
          <div className="flex items-center gap-4 sm:gap-6">
            <CalendarClock aria-hidden="true" className="size-9 shrink-0 text-commitment sm:size-10" />
            <span aria-hidden="true" className="hidden h-12 w-px bg-border-strong sm:block" />
            <h2 id="booking-opens-title" className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Want to know when booking opens?</h2>
          </div>
          <Link href={EARLY_ACCESS_PATH} className={cn(buttonVariants({ variant: "commitment", size: "lg" }), "h-12 shrink-0 px-7 text-base")}>
            {EARLY_ACCESS_CTA}<ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
