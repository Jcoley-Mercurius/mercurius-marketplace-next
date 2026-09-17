"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import {
  blockerLabel,
  canReadBackRefund,
  canSendRefund,
  commandErrorMessage,
  operationLabel,
  parseCents,
  refundAttemptLabel,
  refundErrorMessage,
  reviewAction,
  reviewStateLabel,
  type FinanceOperations,
  type PendingRefund,
  type ReviewOperation,
  type ReviewRequest,
} from "@/lib/financeCommands";
import { formatCents, type ObligationReconciliation } from "@/lib/financeReconciliation";
import { paymentFunctionError } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";

// TRACE-076 finance operator commands. The signed-in session is the actor; the database refuses
// anyone without finance authority, binds second-person commands to their exact text and picks
// the approver. Every command is confirmed by re-reading the server before it is reported done.

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const shortId = (value: string) => value.slice(0, 8);

export function FinanceCommands({
  obligations,
  onChanged,
}: {
  obligations: ObligationReconciliation[];
  onChanged: () => Promise<void>;
}) {
  const [ops, setOps] = useState<FinanceOperations | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  // One key per confirmed command: a retry after a lost response replays instead of repeating.
  const [nonce] = useState(() => crypto.randomUUID());
  const [sequence, setSequence] = useState(0);
  const key = (operation: string) => `finance:${nonce}:${sequence}:${operation}`;

  const [holdInvoice, setHoldInvoice] = useState("");
  const [holdEvidence, setHoldEvidence] = useState("");
  const [releaseHold, setReleaseHold] = useState("");
  const [releaseEvidence, setReleaseEvidence] = useState("");
  const [readbackInvoice, setReadbackInvoice] = useState("");
  const [readbackAmount, setReadbackAmount] = useState("");
  const [readbackEvidence, setReadbackEvidence] = useState("");
  const [excludeEvent, setExcludeEvent] = useState("");
  const [excludeEvidence, setExcludeEvidence] = useState("");

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc("money_finance_operations");
    if (error) throw new Error(error.message);
    return data as unknown as FinanceOperations;
  }, []);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      setOps(await read());
    } catch {
      setLoadError("Finance commands could not be loaded. Refresh before acting.");
    }
  }, [read]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const run = async (
    call: () => Promise<void>,
    confirmed: (next: FinanceOperations) => boolean,
    success: { title: string; description: string },
  ) => {
    setPending(true);
    try {
      await call();
      const next = await read();
      setOps(next);
      void onChanged();
      if (!confirmed(next)) throw new Error("The server did not confirm this command. Review the current state before retrying.");
      setSequence((value) => value + 1);
      toast.success(success.title, { description: success.description });
    } catch (error) {
      toast.error("Finance command not completed", {
        description: error instanceof Error ? error.message : "Refresh the page before trying again.",
      });
      void refresh();
      throw error;
    } finally {
      setPending(false);
    }
  };

  // The Supabase RPC builder is a thenable; every command shares one refusal wording.
  const accepted = async <T,>(call: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await call;
    if (error) throw new Error(commandErrorMessage(error.message));
    return data as unknown as Record<string, unknown> | null;
  };

  const refund = async (body: Record<string, unknown>) => {
    const { data, error } = await createClient().functions.invoke("refund-invoice", { body });
    if (error) {
      // The HTTP error's context is the Response; paymentFunctionError reads its stream as the body.
      const response = (error as { context?: unknown }).context;
      const payload = response instanceof Response ? await response.clone().json().catch(() => null) : null;
      const code = typeof payload?.error === "string" ? payload.error : (await paymentFunctionError(error)).code;
      throw new Error(refundErrorMessage(code));
    }
    return data as { status?: string; found?: boolean; provider_status?: string | null };
  };

  if (!ops) {
    return loadError ? (
      <PageState
        kind="error"
        title="Finance commands unavailable"
        description={loadError}
        action={<Button onClick={() => void refresh()}><RefreshCw />Try again</Button>}
      />
    ) : (
      <PageState kind="loading" title="Loading finance commands" />
    );
  }

  const invoiceLabel = (id: string | null, invoice: string | null) =>
    invoice ?? (id ? `Obligation ${shortId(id)}` : "No invoice linked");
  const holdable = obligations.filter((row) => !row.payout.statement);
  const amountCents = parseCents(readbackAmount);
  const busy = pending;

  const requestReview = (operation: ReviewOperation, subject: string, evidence: string | null, entity: string) =>
    async (reason: string) => {
      const businessKey = key(`${operation}:${subject}`);
      let requestId = "";
      await run(
        async () => {
          const data = await accepted(createClient().rpc("money_operator_request_review", {
            p_operation: operation, p_subject: subject, p_reason: reason, p_key: businessKey, p_evidence: evidence ?? undefined,
          }));
          requestId = typeof data?.request_id === "string" ? data.request_id : "";
        },
        (next) => next.requests.some((item) => item.request_id === requestId && item.requested_by_me),
        { title: "Review requested", description: `${operationLabel[operation]} · ${entity}. A different finance operator must approve it before you run it.` },
      );
    };

  const reviewEntity = (request: ReviewRequest) =>
    request.operation === "event_exclusion"
      ? `${request.subject}${request.obligation_id ? ` · ${invoiceLabel(request.obligation_id, request.invoice_number)}` : ""}`
      : invoiceLabel(request.obligation_id, request.invoice_number);

  return (
    <section aria-labelledby="finance-commands" className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="finance-commands" className="text-lg font-semibold">Finance commands</h2>
          <p className="text-sm text-muted-foreground">
            Recorded as you, with your finance authority. Releasing a hold, resolving a readback and excluding a Stripe event need a different finance operator to approve the exact command in their own session; you then run it.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw />Refresh commands</Button>
      </div>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}

      <div className="space-y-3">
        <h3 className="font-medium">Second-person reviews ({ops.requests.filter((item) => item.state !== "executed").length} open)</h3>
        {ops.requests.length === 0 ? (
          <PageState kind="empty" title="No review requests" description="Requests to release holds, resolve readbacks or exclude events appear here for a second operator." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Second-person reviews"
              rows={ops.requests}
              rowKey={(item) => item.request_id}
              rowLabel={(item) => `${operationLabel[item.operation]} · ${reviewEntity(item)}`}
              columns={[
                {
                  key: "command",
                  label: "Command",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="font-medium">{operationLabel[item.operation]}</span>
                      <span className="text-xs text-muted-foreground">{reviewEntity(item)}</span>
                      <span className="text-xs text-muted-foreground">Requested {item.requested_by_me ? "by you" : "by another operator"} · {formatDate(item.created_at)}</span>
                    </span>
                  ),
                },
                {
                  key: "why",
                  label: "Reason and evidence",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span>{item.reason}</span>
                      {item.evidence && <span className="text-xs text-muted-foreground">Evidence: {item.evidence}</span>}
                    </span>
                  ),
                },
                {
                  key: "state",
                  label: "Status",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{reviewStateLabel[item.state]}</span>
                      <span className="text-xs text-muted-foreground">{reviewAction(item).note}</span>
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => {
                    const action = reviewAction(item);
                    if (action.kind === "approve") {
                      return (
                        <ConfirmAction
                          disabled={busy}
                          requireReason
                          reasonLabel="Approval note"
                          reasonHelp="What you checked, for example the Stripe or ticket reference you read."
                          confirmationTone="commitment"
                          triggerLabel="Approve"
                          title={`Approve: ${operationLabel[item.operation].toLowerCase()}?`}
                          entity={reviewEntity(item)}
                          consequence={`Approves exactly this command as a second finance operator: "${item.reason}"${item.evidence ? ` with evidence "${item.evidence}"` : ""}. Nothing changes until the requester runs it, and it cannot run if anything has changed.`}
                          confirmLabel="Approve"
                          onConfirm={(note) => run(
                            async () => { await accepted(createClient().rpc("money_operator_approve_review", { p_request: item.request_id, p_reason: note })); },
                            (next) => next.requests.some((candidate) => candidate.request_id === item.request_id && candidate.approved_by_me),
                            { title: "Command approved", description: `${operationLabel[item.operation]} · ${reviewEntity(item)}. The requester can now run it.` },
                          )}
                        />
                      );
                    }
                    if (action.kind === "execute") {
                      return (
                        <ConfirmAction
                          disabled={busy}
                          confirmationTone={item.operation === "hold_resolution" ? "commitment" : "destructive"}
                          triggerLabel="Run approved command"
                          title={`Run: ${operationLabel[item.operation].toLowerCase()}?`}
                          entity={reviewEntity(item)}
                          consequence={
                            item.operation === "hold_resolution"
                              ? "Releases this payout hold. The payout still needs every other check before ACH preparation."
                              : item.operation === "reconciliation_resolution"
                                ? "Closes the Stripe readback hold for this invoice. Other holds stay in place."
                                : "Excludes this Stripe event permanently. It will never be processed or replayed, and it stops holding payouts."
                          }
                          confirmLabel="Run"
                          onConfirm={() => run(
                            async () => { await accepted(createClient().rpc("money_operator_execute_review", { p_request: item.request_id })); },
                            (next) => next.requests.some((candidate) => candidate.request_id === item.request_id && candidate.state === "executed"),
                            { title: "Approved command run", description: `${operationLabel[item.operation]} · ${reviewEntity(item)}.` },
                          )}
                        />
                      );
                    }
                    return <span className="text-muted-foreground">—</span>;
                  },
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Place a payout hold</h3>
          <p className="text-sm text-muted-foreground">Stops ACH preparation for one invoice. A payout already on an ACH statement cannot be held.</p>
          <FormField label="Invoice" required>
            {(control) => (
              <select {...control} className={selectClass} value={holdInvoice} disabled={busy} onChange={(event) => setHoldInvoice(event.target.value)}>
                <option value="">{holdable.length ? "Select an invoice" : "No invoice can be held"}</option>
                {holdable.map((row) => <option key={row.obligation_id} value={row.obligation_id}>{invoiceLabel(row.obligation_id, row.invoice_number)} · {row.payee.name ?? "Provider"}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Evidence" required help="Ticket, dispute or message reference that supports the hold.">
            {(control) => <Input {...control} value={holdEvidence} maxLength={1000} disabled={busy} onChange={(event) => setHoldEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !holdInvoice || !holdEvidence.trim()}
            requireReason
            reasonLabel="Hold reason"
            triggerLabel="Place hold"
            title="Hold this provider payout?"
            entity={invoiceLabel(holdInvoice, holdable.find((row) => row.obligation_id === holdInvoice)?.invoice_number ?? null)}
            consequence="Stops ACH preparation for this invoice until a second finance operator approves its release. The provider is not notified by this action."
            confirmLabel="Place hold"
            onConfirm={(reason) => {
              const invoice = holdInvoice;
              const evidence = holdEvidence.trim();
              return run(
                async () => { await accepted(createClient().rpc("money_operator_place_hold", { p_obligation: invoice, p_reason: reason, p_evidence: evidence, p_key: key(`hold:${invoice}`) })); },
                (next) => next.holds.some((hold) => hold.obligation_id === invoice && hold.placed_by_me && hold.evidence === evidence && hold.reason === reason),
                { title: "Payout hold placed", description: "ACH preparation is stopped for this invoice." },
              ).then(() => { setHoldInvoice(""); setHoldEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Request a hold release</h3>
          <p className="text-sm text-muted-foreground">
            {ops.holds.length === 0 ? "No payout hold is open." : `${ops.holds.length} open hold${ops.holds.length === 1 ? "" : "s"}.`} A different finance operator approves the release.
          </p>
          <FormField label="Hold" required>
            {(control) => (
              <select {...control} className={selectClass} value={releaseHold} disabled={busy || ops.holds.length === 0} onChange={(event) => setReleaseHold(event.target.value)}>
                <option value="">{ops.holds.length ? "Select a hold" : "No open holds"}</option>
                {ops.holds.map((hold) => <option key={hold.hold_id} value={hold.hold_id}>{invoiceLabel(hold.obligation_id, hold.invoice_number)} · {hold.reason}</option>)}
              </select>
            )}
          </FormField>
          {releaseHold && (() => {
            const hold = ops.holds.find((item) => item.hold_id === releaseHold);
            return hold ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Placed {hold.placed_by_me ? "by you" : "by another operator"} {formatDate(hold.created_at)} · Evidence: {hold.evidence}</p> : null;
          })()}
          <FormField label="Release evidence" required help="What shows the cause is cleared.">
            {(control) => <Input {...control} value={releaseEvidence} maxLength={1000} disabled={busy} onChange={(event) => setReleaseEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !releaseHold || !releaseEvidence.trim()}
            requireReason
            reasonLabel="Release reason"
            confirmationTone="commitment"
            triggerLabel="Request release"
            title="Request release of this hold?"
            entity={invoiceLabel(ops.holds.find((hold) => hold.hold_id === releaseHold)?.obligation_id ?? null, ops.holds.find((hold) => hold.hold_id === releaseHold)?.invoice_number ?? null)}
            consequence="Creates a review request. The hold stays in place until a different finance operator approves this exact reason and evidence and you run it."
            confirmLabel="Request release"
            onConfirm={(reason) => requestReview("hold_resolution", releaseHold, releaseEvidence.trim(), "payout hold")(reason).then(() => { setReleaseHold(""); setReleaseEvidence(""); })}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Record a Stripe readback</h3>
          <p className="text-sm text-muted-foreground">Enter what Stripe shows as collected for the invoice after refunds. A mismatch holds the payout; a match never clears a hold on its own.</p>
          <FormField label="Invoice" required>
            {(control) => (
              <select {...control} className={selectClass} value={readbackInvoice} disabled={busy} onChange={(event) => setReadbackInvoice(event.target.value)}>
                <option value="">{obligations.length ? "Select an invoice" : "No invoices"}</option>
                {obligations.map((row) => <option key={row.obligation_id} value={row.obligation_id}>{invoiceLabel(row.obligation_id, row.invoice_number)} · ledger {formatCents(row.charges.captured - row.refunds.service - row.refunds.tax - row.refunds.tip)}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Amount at Stripe (USD)" required help="Collected less refunded, for example 117.00." error={readbackAmount && amountCents === null ? "Enter dollars and cents, for example 117.00." : undefined}>
            {(control) => <Input {...control} inputMode="decimal" value={readbackAmount} disabled={busy} onChange={(event) => setReadbackAmount(event.target.value)} />}
          </FormField>
          <FormField label="Stripe reference" required help="The payment or balance transaction you read, for example pi_…">
            {(control) => <Input {...control} value={readbackEvidence} maxLength={1000} disabled={busy} onChange={(event) => setReadbackEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !readbackInvoice || amountCents === null || !readbackEvidence.trim()}
            confirmationTone="commitment"
            triggerLabel="Record readback"
            title="Record this Stripe readback?"
            entity={`${invoiceLabel(readbackInvoice, obligations.find((row) => row.obligation_id === readbackInvoice)?.invoice_number ?? null)} · ${amountCents === null ? "" : formatCents(amountCents)}`}
            consequence="Records the amount as observed at Stripe under your name. If it differs from the ledger, the payout is held until a matching readback is resolved by two operators."
            confirmLabel="Record"
            onConfirm={() => {
              const invoice = readbackInvoice;
              const observed = amountCents!;
              const evidence = readbackEvidence.trim();
              let matched = false;
              return run(
                async () => {
                  const data = await accepted(createClient().rpc("money_operator_record_readback", {
                    p_obligation: invoice, p_observed: observed, p_currency: "usd", p_evidence: evidence, p_key: key(`readback:${invoice}`),
                  }));
                  matched = data?.matched === true;
                },
                (next) => matched || next.readbacks.some((item) => item.obligation_id === invoice && item.observed === observed && item.recorded_by_me === true),
                { title: "Stripe readback recorded", description: "Check the invoice's readback state below." },
              ).then(() => { setReadbackInvoice(""); setReadbackAmount(""); setReadbackEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Request a Stripe event exclusion</h3>
          <p className="text-sm text-muted-foreground">Only for a failed event you have read back at Stripe that moved no money. An unsupported event holds every payout until it is excluded.</p>
          <FormField label="Event" required>
            {(control) => (
              <select {...control} className={selectClass} value={excludeEvent} disabled={busy || ops.events.length === 0} onChange={(event) => setExcludeEvent(event.target.value)}>
                <option value="">{ops.events.length ? "Select an event" : "No unprocessed events"}</option>
                {ops.events.map((event) => <option key={event.event_id} value={event.event_id} disabled={event.exclusion_blocker !== null}>{event.event_id} · {event.event_type}{event.exclusion_blocker ? " (not excludable)" : ""}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Stripe readback evidence" required help="What Stripe shows for this event and why it moved no money.">
            {(control) => <Input {...control} value={excludeEvidence} maxLength={1000} disabled={busy} onChange={(event) => setExcludeEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !excludeEvent || !excludeEvidence.trim()}
            requireReason
            reasonLabel="Exclusion reason"
            triggerLabel="Request exclusion"
            title="Request exclusion of this Stripe event?"
            entity={excludeEvent}
            consequence="Creates a review request. Once a different finance operator approves it and you run it, the event is never processed or replayed."
            confirmLabel="Request exclusion"
            onConfirm={(reason) => requestReview("event_exclusion", excludeEvent, excludeEvidence.trim(), excludeEvent)(reason).then(() => { setExcludeEvent(""); setExcludeEvidence(""); })}
          />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Stripe readbacks needing resolution ({ops.readbacks.length})</h3>
        {ops.readbacks.length === 0 ? (
          <PageState kind="empty" title="No open readback holds" description="Invoices with a Stripe readback mismatch or an open reconciliation appear here." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Stripe readbacks"
              rows={ops.readbacks}
              rowKey={(item) => item.obligation_id}
              rowLabel={(item) => invoiceLabel(item.obligation_id, item.invoice_number)}
              columns={[
                { key: "invoice", label: "Invoice", render: (item) => <span className="font-medium tabular-nums">{invoiceLabel(item.obligation_id, item.invoice_number)}</span> },
                {
                  key: "readback",
                  label: "Latest readback",
                  render: (item) => item.observation_id === null ? <span className="text-muted-foreground">None recorded</span> : (
                    <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                      <span>Stripe {formatCents(item.observed ?? 0)} · ledger then {formatCents(item.expected ?? 0)} · now {formatCents(item.net_collected)}</span>
                      <span className="text-xs text-muted-foreground">{item.evidence} · {item.attributed ? (item.recorded_by_me ? "recorded by you" : "recorded by another operator") : "recorded by an automated path"}{item.recorded_at ? ` · ${formatDate(item.recorded_at)}` : ""}</span>
                    </span>
                  ),
                },
                { key: "state", label: "Resolution", render: (item) => item.resolution_blocker ? <span className="text-muted-foreground">{blockerLabel[item.resolution_blocker]}</span> : <span>Ready to request resolution</span> },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => item.resolution_blocker || !item.observation_id ? <span className="text-muted-foreground">—</span> : (
                    <ConfirmAction
                      disabled={busy}
                      requireReason
                      reasonLabel="Resolution reason"
                      confirmationTone="commitment"
                      triggerLabel="Request resolution"
                      title="Request resolution of this readback?"
                      entity={invoiceLabel(item.obligation_id, item.invoice_number)}
                      consequence={`Creates a review request to close the readback hold on the matching ${formatCents(item.observed ?? 0)} readback. ${item.recorded_by_me ? "You recorded it, so a different operator must approve." : "A different finance operator must approve."}`}
                      confirmLabel="Request resolution"
                      onConfirm={requestReview("reconciliation_resolution", item.observation_id, null, invoiceLabel(item.obligation_id, item.invoice_number))}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Unprocessed Stripe events ({ops.events.length})</h3>
        {ops.events.length === 0 ? (
          <PageState kind="empty" title="No unprocessed Stripe events" description="Every received Stripe event is processed or excluded." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Unprocessed Stripe events"
              rows={ops.events}
              rowKey={(item) => item.event_id}
              rowLabel={(item) => `${item.event_id} · ${item.event_type}`}
              columns={[
                {
                  key: "event",
                  label: "Event",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="font-medium">{item.event_id}</span>
                      <span className="text-xs text-muted-foreground">{item.event_type}{item.holds_all_payouts ? " · holds every payout" : ""}</span>
                    </span>
                  ),
                },
                { key: "status", label: "Status", render: (item) => `${item.status === "dead_letter" ? "Stopped retrying" : item.status} after ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}` },
                { key: "exclusion", label: "Exclusion", render: (item) => item.exclusion_blocker ? <span className="text-muted-foreground">{blockerLabel[item.exclusion_blocker]}</span> : "Can be requested" },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => (
                    <ConfirmAction
                      disabled={busy}
                      requireReason
                      reasonLabel="Replay reason"
                      confirmationTone="commitment"
                      triggerLabel="Replay event"
                      title="Replay this Stripe event?"
                      entity={item.event_id}
                      consequence={item.holds_all_payouts
                        ? "Runs the stored event through processing again. An unsupported event cannot be processed, so it will fail again; exclusion is how it stops holding payouts."
                        : "Runs the stored event through processing again. Processing re-checks the event, so a replay applies it only if it now matches the ledger."}
                      confirmLabel="Replay"
                      onConfirm={(reason) => {
                        const attempts = item.attempts;
                        return run(
                          async () => { await accepted(createClient().rpc("money_operator_replay_event", { p_event: item.event_id, p_reason: reason })); },
                          (next) => {
                            const after = next.events.find((candidate) => candidate.event_id === item.event_id);
                            return !after || after.attempts > attempts;
                          },
                          { title: "Stripe event replayed", description: `${item.event_id}. Check whether it is still listed.` },
                        );
                      }}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Reviewed refunds not settled ({ops.refunds.length})</h3>
        {ops.refunds.length === 0 ? (
          <PageState kind="empty" title="No unsettled refunds" description="Separately approved refunds appear here until Stripe's refund event settles them." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Unsettled refunds"
              rows={ops.refunds}
              rowKey={(item) => item.authorization_id}
              rowLabel={(item) => `${invoiceLabel(item.obligation_id, item.invoice_number)} · ${formatCents(item.amount)}`}
              columns={[
                {
                  key: "refund",
                  label: "Refund",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                      <span className="font-medium">{invoiceLabel(item.obligation_id, item.invoice_number)} · {formatCents(item.amount)}</span>
                      <span className="text-xs text-muted-foreground">{item.payment_id}{item.provider_reference ? ` · ${item.provider_reference}` : ""}</span>
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5">
                      <span>{refundAttemptLabel[item.attempt_status]}</span>
                      {item.last_readback && (
                        <span className="text-xs text-muted-foreground">
                          Last Stripe readback {formatDate(item.last_readback.created_at)}: {item.last_readback.found ? `Stripe status ${item.last_readback.provider_status}` : "not found at Stripe"}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => (
                    <span className="flex flex-col items-start gap-2">
                      {canSendRefund(item) && <RefundSend item={item} busy={busy} run={run} refund={refund} />}
                      {canReadBackRefund(item) && <RefundReadback item={item} busy={busy} run={run} refund={refund} />}
                      {!canSendRefund(item) && !canReadBackRefund(item) && <span className="text-muted-foreground">Only the refund&apos;s author or approver can send it.</span>}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>
    </section>
  );
}

type Run = (
  call: () => Promise<void>,
  confirmed: (next: FinanceOperations) => boolean,
  success: { title: string; description: string },
) => Promise<void>;
type Refund = (body: Record<string, unknown>) => Promise<{ status?: string; found?: boolean; provider_status?: string | null }>;

function RefundSend({ item, busy, run, refund }: { item: PendingRefund; busy: boolean; run: Run; refund: Refund }) {
  return (
    <ConfirmAction
      disabled={busy}
      triggerLabel="Send refund to Stripe"
      title="Send this refund to Stripe?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Asks Stripe to refund the separately approved amount to the customer's original payment. It is recorded as settled only when Stripe's refund event arrives."
      confirmLabel="Send refund"
      onConfirm={() => run(
        async () => {
          const result = await refund({ action: "send", authorization_id: item.authorization_id });
          if (result.status !== "awaiting_webhook" && result.status !== "succeeded") {
            throw new Error("Stripe was not asked again: this refund's outcome is uncertain. Read it back from Stripe; do not create a second refund.");
          }
        },
        (next) => !next.refunds.some((candidate) => candidate.authorization_id === item.authorization_id && candidate.attempt_status === "not_started"),
        { title: "Refund sent to Stripe", description: "Waiting for Stripe's refund event to settle it." },
      )}
    />
  );
}

function RefundReadback({ item, busy, run, refund }: { item: PendingRefund; busy: boolean; run: Run; refund: Refund }) {
  return (
    <ConfirmAction
      disabled={busy}
      confirmationTone="commitment"
      triggerLabel="Read back from Stripe"
      title="Read this refund back from Stripe?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Looks up this refund at Stripe and records what Stripe shows under your name. It never creates a refund and never marks one settled."
      confirmLabel="Read back"
      onConfirm={() => {
        const previous = item.last_readback?.created_at ?? null;
        return run(
          async () => { await refund({ action: "readback", authorization_id: item.authorization_id }); },
          (next) => {
            const after = next.refunds.find((candidate) => candidate.authorization_id === item.authorization_id);
            return !after || (after.last_readback !== null && after.last_readback.created_at !== previous);
          },
          { title: "Stripe refund read back", description: "The refund's Stripe status is recorded." },
        );
      }}
    />
  );
}
