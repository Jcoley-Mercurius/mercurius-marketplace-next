"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { earningsToneClass, useVendorEarnings } from "@/components/vendor/VendorEarningsSummary";
import { formatEasternDate } from "@/lib/vendorCompliance";
import {
  earningsStateDetail,
  earningsStateLabel,
  earningsStateTone,
  formatCents,
  formatWeek,
  holdCategoryLabel,
  summarizeEarnings,
  transferStatusLabel,
  transferStatusTone,
  type EarningsJob,
  type Statement,
} from "@/lib/vendorEarnings";
import { cn } from "@/lib/utils";

// TRACE-135 (Phase 6.12B, DEC-2026-056): a provider's own earnings, payout states and weekly
// statements, read from vendor_own_earnings. It shows what Mercurius recorded; it prepares, sends,
// holds or retries nothing, and never shows bank details.

function Amounts({ amounts }: { amounts: NonNullable<EarningsJob["amounts"]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
      <div><dt className="text-muted-foreground">Service</dt><dd className="tabular-nums">{formatCents(amounts.service)}</dd></div>
      <div><dt className="text-muted-foreground">Platform fee</dt><dd className="tabular-nums">−{formatCents(amounts.platform_fee)}</dd></div>
      {amounts.platform_subsidy > 0 && (
        <div><dt className="text-muted-foreground">Mercurius-funded discount</dt><dd className="tabular-nums">{formatCents(amounts.platform_subsidy)}</dd></div>
      )}
      <div><dt className="text-muted-foreground">Tips</dt><dd className="tabular-nums">{formatCents(amounts.tips)}</dd></div>
      <div><dt className="font-medium text-foreground">Your payout</dt><dd className="font-semibold tabular-nums">{formatCents(amounts.payout)}</dd></div>
    </dl>
  );
}

function JobRow({ job }: { job: EarningsJob }) {
  return (
    <li className="min-w-0 space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words font-medium">
          {job.service}
          {job.invoice_number ? <span className="font-normal text-muted-foreground"> · {job.invoice_number}</span> : null}
        </span>
        <Badge variant="outline" className={earningsToneClass[earningsStateTone[job.state]]}>{earningsStateLabel[job.state]}</Badge>
      </div>
      {job.completed_at && (
        <p className="text-xs text-muted-foreground">Completed {formatEasternDate(job.completed_at)}</p>
      )}
      <p className="text-sm text-foreground">{earningsStateDetail(job)}</p>
      {job.state === "held" && job.holds.length > 0 && (
        <ul aria-label="Hold reasons" className="flex flex-wrap gap-2">
          {job.holds.map((hold) => (
            <li key={hold}><Badge variant="outline" className={earningsToneClass.warning}>{holdCategoryLabel[hold]}</Badge></li>
          ))}
        </ul>
      )}
      {job.amounts ? <Amounts amounts={job.amounts} /> : null}
    </li>
  );
}

function StatementCard({ statement }: { statement: Statement }) {
  const title = `Week of ${formatWeek(statement.week_start, statement.week_end)}`;
  const id = `statement-${statement.week_start}`;
  const subsidy = statement.items.some((item) => item.platform_subsidy > 0);
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={id} className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">
          Transfer total {formatCents(statement.payout_total)} · paid {formatCents(statement.paid_total)}
        </p>
      </div>
      {/* Keyboard users can scroll a wide statement on a narrow screen. */}
      <div tabIndex={0} role="group" aria-label={`${title} statement table`} className="overflow-x-auto rounded focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">{title} statement</caption>
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Job</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Service</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Platform fee</th>
              {subsidy && <th scope="col" className="py-2 pr-3 text-right font-medium">Mercurius-funded discount</th>}
              <th scope="col" className="py-2 pr-3 text-right font-medium">Tips</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Payout</th>
              <th scope="col" className="py-2 font-medium">Transfer</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {statement.items.map((item) => (
              <tr key={`${item.invoice_number}-${item.job_id}`}>
                <td className="py-2 pr-3"><span className="block">{item.service}</span><span className="text-xs text-muted-foreground">{item.invoice_number}</span></td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatCents(item.service_amount)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">−{formatCents(item.platform_fee)}</td>
                {subsidy && <td className="py-2 pr-3 text-right tabular-nums">{formatCents(item.platform_subsidy)}</td>}
                <td className="py-2 pr-3 text-right tabular-nums">{formatCents(item.tips)}</td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">{formatCents(item.payout)}</td>
                <td className="py-2"><Badge variant="outline" className={earningsToneClass[transferStatusTone[item.status]]}>{transferStatusLabel[item.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function VendorEarningsPage() {
  const { earnings, error, loading, load } = useVendorEarnings();

  const header = (
    <PageHeader
      eyebrow="Earnings"
      title="Earnings & payouts"
      description="Payouts from payments Mercurius has collected for your jobs. A payout becomes eligible 48 hours after the homeowner confirms the work is complete and is paid by weekly direct deposit (ACH) that Mercurius prepares."
    />
  );

  if (!earnings) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        {header}
        {error && !loading ? (
          <PageState
            kind="error"
            title="Earnings unavailable"
            description="Your earnings could not be loaded. No amount is estimated."
            action={<Button onClick={() => void load()}><RefreshCw />Try again</Button>}
          />
        ) : (
          <PageState kind="loading" title="Loading your earnings" />
        )}
      </div>
    );
  }

  if (!earnings.provider_found) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        {header}
        <PageState
          kind="permission"
          title="No provider account linked"
          description="This sign-in is not linked to a provider record, so there are no earnings to show."
          action={<Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>Contact Mercurius</Link>}
        />
      </div>
    );
  }

  const summary = summarizeEarnings(earnings.totals);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      {header}
      {error && (
        <p role="alert" className="text-sm text-destructive">Your earnings could not be refreshed. This page shows the last successful load.</p>
      )}

      {!earnings.payout_onboarding_current && (
        <div className={cn("space-y-2 rounded-xl border p-4 text-sm", earningsToneClass.warning)}>
          <p className="font-medium">Payouts are held until your payout onboarding is current.</p>
          <p className="text-foreground">Contact Mercurius to renew it. Do not send bank details by message or upload.</p>
          <Link href="/vendor/compliance" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 bg-background")}>Your checklist</Link>
        </div>
      )}

      <section aria-labelledby="earnings-summary-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="earnings-summary-title" className="text-lg font-semibold">Summary</h2>
          <p className="text-xs text-muted-foreground">Checked {formatEasternDate(earnings.evaluated_at)} (Eastern Time)</p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Paid to you", formatCents(summary.paid)],
            ["Eligible", formatCents(summary.eligible)],
            ["On the way", formatCents(summary.onTheWay)],
            ["On hold", formatCents(summary.held)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          Not yet eligible: {formatCents(summary.notYetEligible)}.
          {summary.waitingPayment > 0 ? ` ${summary.waitingPayment} ${summary.waitingPayment === 1 ? "job is" : "jobs are"} waiting for the homeowner's payment.` : ""}
          {" "}Transfers that are sent or being confirmed are not counted as paid.
        </p>
      </section>

      <section aria-labelledby="earnings-jobs-title" className="space-y-3">
        <h2 id="earnings-jobs-title" className="text-lg font-semibold">Jobs</h2>
        {earnings.jobs.length === 0 ? (
          <PageState kind="empty" title="No payouts yet" description="Jobs appear here once a homeowner pays for work assigned to you." />
        ) : (
          <ul aria-label="Job payouts" className="divide-y rounded-xl border bg-card text-card-foreground">
            {earnings.jobs.map((job) => <JobRow key={job.job_id} job={job} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="earnings-statements-title" className="space-y-3">
        <h2 id="earnings-statements-title" className="text-lg font-semibold">Weekly statements</h2>
        {earnings.statements.length === 0 ? (
          <PageState kind="empty" title="No statements yet" description="A statement appears for each weekly transfer that includes your payouts." />
        ) : (
          earnings.statements.map((statement) => <StatementCard key={statement.week_start} statement={statement} />)
        )}
      </section>
    </div>
  );
}
