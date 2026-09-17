"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { FinanceCommands } from "@/components/admin/FinanceCommands";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList, type DataColumn } from "@/components/ui/responsive-data-list";
import { createClient } from "@/lib/supabase/client";
import {
  accountLabel,
  bankStatusLabel,
  exceptionAmount,
  exceptionPresentation,
  formatCents,
  fundsStateLabel,
  fundsStateTone,
  issueLabel,
  labelOf,
  needsAttention,
  readbackLabel,
  reasonLabel,
  type FinanceException,
  type FinanceReconciliation,
  type FundsState,
  type ObligationReconciliation,
} from "@/lib/financeReconciliation";
import { cn } from "@/lib/utils";

// TRACE-075 finance reconciliation readback, with the TRACE-076 operator commands for refunds,
// payout holds, Stripe readbacks and events. Chargeback allocation and ACH outcomes are not here.

type Filter = "attention" | "all" | FundsState;

const tones = {
  neutral: "border-status-neutral bg-status-neutral-bg text-status-neutral",
  info: "border-status-info bg-status-info-bg text-status-info",
  success: "border-status-success bg-status-success-bg text-status-success",
  warning: "border-status-warning bg-status-warning-bg text-status-warning",
  danger: "border-status-danger bg-status-danger-bg text-status-danger",
};

const fundsOrder: FundsState[] = ["held", "payout_failed", "eligible", "scheduled", "not_eligible", "paid"];

function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const { message } = value as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function codeOf(value: unknown) {
  return typeof value === "object" && value !== null ? (value as { code?: unknown }).code : undefined;
}

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const shortId = (value: string) => value.slice(0, 8);

export default function FinanceReconciliationPage() {
  const [data, setData] = useState<FinanceReconciliation | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("attention");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result, error: rpcError } = await createClient().rpc("money_finance_reconciliation");
      if (rpcError) throw rpcError;
      setData(result as unknown as FinanceReconciliation);
      setDenied(false);
    } catch (reason) {
      if (codeOf(reason) === "42501") setDenied(true);
      setError(messageOf(reason, "The finance reconciliation could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const header = (
    <PageHeader
      eyebrow="Finance"
      title="Finance reconciliation"
      description={`Charges, refunds, earnings and provider payouts checked against the ledger. The platform fee is ${data?.fee_percent ?? 15}% of retained service, excluding tax and tips. Commands below are recorded as you; releases, readback resolutions and event exclusions need a second finance operator. Chargeback allocation and bank outcomes are not recorded here.`}
      actions={
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
      }
    />
  );

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
        {header}
        {denied ? (
          <PageState
            kind="permission"
            title="Finance authority required"
            description="Only admins who also hold restricted finance authority can see reconciled money. Ask the finance owner if you need access."
          />
        ) : error ? (
          <PageState
            kind="error"
            title="Finance reconciliation unavailable"
            description={error}
            action={
              <Button onClick={() => void load()}>
                <RefreshCw />
                Try again
              </Button>
            }
          />
        ) : (
          <PageState kind="loading" title="Loading finance reconciliation" />
        )}
      </div>
    );
  }

  const invoiceOf = new Map(data.obligations.map((row) => [row.obligation_id, row.invoice_number]));
  const attention = data.obligations.filter(needsAttention);
  const counts = new Map<FundsState, number>();
  for (const row of data.obligations) counts.set(row.payout.funds_state, (counts.get(row.payout.funds_state) ?? 0) + 1);
  const rows =
    filter === "all" ? data.obligations
      : filter === "attention" ? attention
        : data.obligations.filter((row) => row.payout.funds_state === filter);

  const reference = (obligationId: string | null) =>
    obligationId ? (invoiceOf.get(obligationId) ?? `Obligation ${shortId(obligationId)}`) : "No invoice linked";

  const exceptionColumns: DataColumn<FinanceException>[] = [
    {
      key: "exception",
      label: "Exception",
      render: (exception) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{exceptionPresentation(exception).title}</span>
          <span className="text-xs text-muted-foreground">{reference(exception.obligation_id)}</span>
        </span>
      ),
    },
    {
      key: "detail",
      label: "Detail",
      render: (exception) => <ExceptionDetail exception={exception} />,
    },
    {
      key: "amount",
      label: "Amount",
      render: (exception) => {
        const amount = exceptionAmount(exception);
        return <span className="tabular-nums">{amount === null ? "—" : formatCents(amount)}</span>;
      },
    },
    { key: "since", label: "Since", render: (exception) => formatDate(exception.since) },
    { key: "next", label: "Next action", render: (exception) => exceptionPresentation(exception).action },
  ];

  const obligationColumns: DataColumn<ObligationReconciliation>[] = [
    {
      key: "invoice",
      label: "Invoice",
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium tabular-nums">{row.invoice_number ?? `Obligation ${shortId(row.obligation_id)}`}</span>
          <Link
            href={`/admin/vendors/${row.payee.contractor_id}`}
            className="text-sm text-foreground underline underline-offset-4 hover:text-accent"
          >
            {row.payee.name ?? "Provider"}
          </Link>
          {row.payee.reassigned && <span className="text-xs text-muted-foreground">Reassigned replacement provider</span>}
        </span>
      ),
    },
    {
      key: "charges",
      label: "Charges and refunds",
      render: (row) => (
        <dl className="grid grid-cols-[auto_auto] justify-start gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="text-muted-foreground">Captured</dt>
          <dd>{formatCents(row.charges.captured)}{row.terms && !row.charges.fully_captured ? ` of ${formatCents(row.terms.total)}` : ""}</dd>
          <dt className="text-muted-foreground">Refunded</dt>
          <dd>
            {formatCents(row.refunds.service + row.refunds.tax + row.refunds.tip)}
            {row.refunds.pending > 0 ? ` (${row.refunds.pending} pending)` : ""}
          </dd>
        </dl>
      ),
    },
    {
      key: "earnings",
      label: "Earnings",
      render: (row) => (
        <dl className="grid grid-cols-[auto_auto] justify-start gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="text-muted-foreground">Platform fee</dt>
          <dd>{formatCents(row.earnings.platform_fee_ledger)}</dd>
          <dt className="text-muted-foreground">Provider proceeds</dt>
          <dd>{formatCents(row.earnings.provider_proceeds)}</dd>
          <dt className="text-muted-foreground">Tax</dt>
          <dd>{formatCents(row.earnings.tax_ledger)}</dd>
        </dl>
      ),
    },
    {
      key: "payout",
      label: "Provider funds",
      render: (row) => <FundsDetail row={row} />,
    },
    {
      key: "ledger",
      label: "Ledger",
      render: (row) => (
        <span className="flex flex-col gap-1">
          {row.issues.length === 0 ? (
            <span className="font-medium text-status-success">Reconciled</span>
          ) : (
            <ul className="list-disc space-y-0.5 pl-4 text-status-danger">
              {row.issues.map((issue) => <li key={issue}>{labelOf(issueLabel, issue)}</li>)}
            </ul>
          )}
          <span className={cn("text-xs", row.readback.state === "mismatch" ? "text-status-danger" : "text-muted-foreground")}>
            {readbackLabel(row.readback)}
          </span>
        </span>
      ),
    },
  ];

  const accountRows = data.accounts;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      {header}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} The figures below are from the last successful load.
        </p>
      )}

      {data.global_event_holds > 0 && (
        <p role="alert" className="rounded-xl border border-status-danger bg-status-danger-bg p-4 text-sm font-medium text-status-danger">
          {data.global_event_holds === 1 ? "An unsupported Stripe event is" : `${data.global_event_holds} unsupported Stripe events are`}{" "}
          unresolved. Every provider payout is held until it is read back and excluded.
        </p>
      )}

      <section aria-label="Ledger totals" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Total label="Captured" value={formatCents(data.totals.captured)} />
        <Total label="Refunded" value={formatCents(data.totals.refunded)} />
        <Total label="Platform fee earned" value={formatCents(data.totals.platform_fee)} />
        <Total label="Tax collected" value={formatCents(data.totals.tax)} />
        <Total label="Provider payable" value={formatCents(data.totals.provider_payable)} />
        <Total label="Paid out" value={formatCents(data.totals.paid_out)} />
        <Total label="Processor costs" value={formatCents(data.totals.processor_costs)} />
        <Total label="Chargeback suspense" value={formatCents(data.totals.chargeback_suspense)} tone={data.totals.chargeback_suspense ? "warning" : undefined} />
        <Total label="Invoices with ledger issues" value={String(data.totals.with_issues)} tone={data.totals.with_issues ? "danger" : undefined} />
        <Total label="Open exceptions" value={String(data.exceptions.length)} tone={data.exceptions.length ? "warning" : undefined} />
        <div className="bg-card p-4 sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">Evaluated</p>
          <p className="mt-1 text-sm font-medium">{formatDate(data.evaluated_at)}</p>
        </div>
      </section>

      <section aria-labelledby="finance-exceptions" className="space-y-3">
        <h2 id="finance-exceptions" className="text-lg font-semibold">Exceptions ({data.exceptions.length})</h2>
        {data.exceptions.length === 0 ? (
          <PageState kind="empty" title="No open exceptions" description="No payment, refund, chargeback, readback, hold or bank outcome needs action." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Finance exceptions"
              rows={data.exceptions}
              columns={exceptionColumns}
              rowKey={(exception) => `${exception.kind}:${exceptionKey(exception)}`}
              rowLabel={(exception) => `${exceptionPresentation(exception).title} · ${reference(exception.obligation_id)}`}
            />
          </div>
        )}
      </section>

      <FinanceCommands obligations={data.obligations} onChanged={load} />

      <section aria-labelledby="finance-invoices" className="space-y-3">
        <h2 id="finance-invoices" className="text-lg font-semibold">Invoices</h2>
        {data.obligation_count > data.obligations.length && (
          <p className="text-sm text-muted-foreground">
            Showing {data.obligations.length} of {data.obligation_count} invoices: every invoice with a ledger issue first, then the newest. Totals and exceptions cover all of them.
          </p>
        )}
        <div role="group" aria-label="Filter invoices" className="flex flex-wrap gap-2">
          {(
            [
              ["attention", `Needs attention (${attention.length})`],
              ["all", `All (${data.obligations.length})`],
              ...fundsOrder.filter((state) => counts.get(state)).map((state) => [state, `${fundsStateLabel[state]} (${counts.get(state)})`]),
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              className="min-h-10"
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {data.obligations.length === 0 ? (
          <PageState kind="empty" title="No invoices yet" description="Reviewed commercial snapshots appear here once they exist." />
        ) : rows.length === 0 ? (
          <PageState kind="empty" title="Nothing in this view" description="Choose another filter to see the other invoices." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Invoice reconciliation"
              rows={rows}
              columns={obligationColumns}
              rowKey={(row) => row.obligation_id}
              rowLabel={(row) => `${row.invoice_number ?? `Obligation ${shortId(row.obligation_id)}`} · ${fundsStateLabel[row.payout.funds_state]}`}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="finance-accounts" className="space-y-3">
        <h2 id="finance-accounts" className="text-lg font-semibold">Ledger accounts</h2>
        <p className="text-sm text-muted-foreground">Every journal balances, so total debits equal total credits across all accounts.</p>
        {accountRows.length === 0 ? (
          <PageState kind="empty" title="No journal postings yet" />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Ledger accounts"
              rows={accountRows}
              columns={[
                { key: "account", label: "Account", render: (row) => labelOf(accountLabel, row.account) },
                { key: "debit", label: "Debits", render: (row) => <span className="tabular-nums">{formatCents(row.debit)}</span> },
                { key: "credit", label: "Credits", render: (row) => <span className="tabular-nums">{formatCents(row.credit)}</span> },
              ]}
              rowKey={(row) => row.account}
              rowLabel={(row) => labelOf(accountLabel, row.account)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function exceptionKey(exception: FinanceException) {
  switch (exception.kind) {
    case "provider_event": return exception.event_id;
    case "checkout_reconcile": return exception.attempt_id;
    case "refund_pending": return exception.authorization_id;
    case "chargeback": return exception.dispute_id;
    case "payout_hold": return exception.hold_id;
    case "bank_outcome": return exception.item_id;
    default: return exception.obligation_id;
  }
}

function ExceptionDetail({ exception }: { exception: FinanceException }) {
  const lines: string[] = [];
  switch (exception.kind) {
    case "ledger_mismatch":
      lines.push(...exception.codes.map((code) => labelOf(issueLabel, code)));
      break;
    case "provider_event":
      lines.push(`${exception.event_id} · ${exception.event_type}`, `${exception.status === "dead_letter" ? "Stopped retrying" : exception.status} after ${exception.attempts} attempt${exception.attempts === 1 ? "" : "s"}`);
      if (exception.error_code) lines.push(`Error ${exception.error_code}`);
      break;
    case "checkout_reconcile":
      lines.push(`${exception.mode} checkout`);
      if (exception.error_code) lines.push(`Error ${exception.error_code}`);
      break;
    case "refund_pending":
      lines.push(exception.payment_id, exception.attempt_status === "not_started" ? "Not sent to Stripe" : `Stripe attempt ${exception.attempt_status}`);
      break;
    case "chargeback":
      lines.push(`${exception.dispute_id} on ${exception.payment_id}`);
      break;
    case "bank_outcome":
      lines.push(`ACH attempt ${exception.attempt_number}`);
      break;
    default:
      break;
  }
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
      {lines.map((line, index) => <span key={index} className={index ? "text-xs text-muted-foreground" : undefined}>{line}</span>)}
    </span>
  );
}

function FundsDetail({ row }: { row: ObligationReconciliation }) {
  const { payout } = row;
  const reasons = [...payout.not_eligible, ...payout.held];
  return (
    <span className="flex flex-col items-start gap-1">
      <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium", tones[fundsStateTone[payout.funds_state]])}>
        {fundsStateLabel[payout.funds_state]}
      </span>
      {payout.statement && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatCents(payout.statement.amount)} · week of {payout.statement.period_start} · attempt {payout.statement.attempt_number} {labelOf(bankStatusLabel, payout.statement.bank_status)}
        </span>
      )}
      {reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>
              {labelOf(reasonLabel, reason)}
              {reason === "confirmation_window" && payout.eligible_at ? ` (eligible ${formatDate(payout.eligible_at)})` : ""}
            </li>
          ))}
        </ul>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">Payable {formatCents(payout.payable_ledger)}</span>
    </span>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "warning" && "text-status-warning",
          tone === "danger" && "text-status-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}
