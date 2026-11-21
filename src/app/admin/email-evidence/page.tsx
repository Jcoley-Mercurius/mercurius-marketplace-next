"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { formatEvidenceTime } from "@/components/admin/DeliveryEvidence";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import {
  PROBE_CHOICES,
  probeExpectation,
  probeVerdictLabel,
  type ProbeChoice,
  type ProbeReadback,
  type ProbeVerdict,
} from "@/lib/emailEvidence/acceptance";
import {
  ARMING_REASON_MAX,
  actorLabel,
  armAttestation,
  armingActionLabel,
  armingReason,
  purgeDutyLabel,
  type ArmingReadback,
} from "@/lib/emailEvidence/arming";
import { RETRY_HORIZON_HOURS, coverageLabel, evidenceFactLabel, type EvidenceCoverage } from "@/lib/emailEvidence/labels";
import {
  PURGE_BATCH_MAX,
  PURGE_UNREADABLE,
  classifyPurgeError,
  parsePurgeResult,
  purgeArgs,
  purgeDeletedLabel,
  purgeFailureMessage,
  purgeRemainingLabel,
  type PurgeResult,
} from "@/lib/emailEvidence/purge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// TRACE-155 (Phase 7.3D-1): delivery-evidence coverage windows for operators. The database decides
// who may act (operator only), records every coverage-window start and end with its time, operator
// and reason, and keeps the history; this page only shows it and asks. A recorded window is a
// declaration used for labels (7.3D-1 review fixes): recording a start or end does not turn
// webhook receipt on or off, register or remove the webhook, set or remove a secret, or send
// email, and it does not show that reports actually arrive. Receipt depends only on the deployed
// secret and the provider registration; stopping it is the separately authorized shutdown
// procedure. Test probes are off unless the deployment enables them, and prove only that Resend
// reports reach the receiver; they are never evidence for an owner, application or price email.
// Phase 7.3D-2: the operator purge of expired provider reports. One confirmation makes one call of
// the existing `email_provider_events_purge` with the largest batch it accepts; the page never
// repeats it, and nothing schedules it. A refusal and an unknown outcome are told apart, and a
// failed refresh afterwards never changes what the purge reported.

const COVERAGE_ORDER: EvidenceCoverage[] = ["before_first_arm", "collecting", "complete", "partial", "gap", "unknown"];

type ProbeResult = { state: "sent"; choice: ProbeChoice; readback: ProbeReadback | null; verdict: ProbeVerdict | null };
type ProbeFailure = { state: "failed" | "unknown"; message: string };
type PurgeOutcome = { result: PurgeResult; refresh: "pending" | "done" | "failed" };

function errorMessage(caught: unknown, fallback: string) {
  if (caught && typeof caught === "object" && "message" in caught && typeof caught.message === "string" && caught.message) return caught.message;
  return fallback;
}

async function fetchReadback() {
  const { data, error } = await createClient().rpc("email_evidence_arming_readback");
  if (error) throw error;
  return data as ArmingReadback;
}

export default function EmailEvidencePage() {
  const [data, setData] = useState<ArmingReadback | null>(null);
  const [error, setError] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [purge, setPurge] = useState<PurgeOutcome | null>(null);
  const generation = useRef(0);

  /** Reads the readback again. Resolves false only when this read failed. */
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setError("");
    try {
      const next = await fetchReadback();
      if (ticket === generation.current) setData(next);
      return true;
    } catch (caught) {
      if (ticket === generation.current) setError(errorMessage(caught, "Coverage window status could not be loaded."));
      return false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Only a first load that fails replaces the page; a later failed refresh keeps the last figures.
  if (!data && error) return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 md:p-8"><AdminError title="Email evidence could not be loaded" message={error} retry={() => void load()} /></div>;
  if (!data) return <AdminLoading label="Loading email evidence..." />;

  const transition = async (action: "arm" | "disarm", input: string) => {
    const reason = armingReason(input);
    if (!reason || reason.length > ARMING_REASON_MAX) throw new Error(`Give a reason of 1 to ${ARMING_REASON_MAX} characters.`);
    const { error: commandError } = await createClient().rpc(action === "arm" ? "email_evidence_arm" : "email_evidence_disarm", { p_reason: reason });
    await load();
    if (commandError) throw new Error(commandError.message);
  };

  const runProbe = async (choice: string) => {
    setProbe(null);
    let response: Response;
    try {
      response = await fetch("/api/admin/email-evidence-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      });
    } catch {
      throw new Error("The test could not be reached. Nothing is known to have been sent; check the Resend log before trying again.");
    }
    const body = (await response.json().catch(() => null)) as ((ProbeResult | ProbeFailure) & { error?: string }) | null;
    if (response.status === 404) throw new Error("Test probes are turned off on this deployment. Nothing was sent.");
    // A provider failure is shown in the dialog as it happened; it is never retried.
    if (body && (body.state === "failed" || body.state === "unknown")) throw new Error(body.message);
    if (!response.ok || !body || body.state !== "sent") throw new Error(body?.error ?? "The test was refused. Nothing was sent.");
    setProbe(body);
  };

  // One confirmed run: exactly one call, never repeated here. ConfirmAction keeps the dialog open
  // and its buttons disabled until this settles, so a second click cannot start another call.
  const runPurge = async () => {
    setPurge(null);
    let answer: { data: unknown; error: unknown };
    try {
      answer = await createClient().rpc("email_provider_events_purge", purgeArgs());
    } catch (caught) {
      answer = { data: null, error: { message: errorMessage(caught, "No answer was received") } };
    }
    if (answer.error) {
      await load();
      throw new Error(purgeFailureMessage(classifyPurgeError(answer.error)));
    }
    const result = parsePurgeResult(answer.data);
    if (!result) {
      await load();
      throw new Error(PURGE_UNREADABLE);
    }
    setPurge({ result, refresh: "pending" });
    const refreshed = await load();
    setPurge({ result, refresh: refreshed ? "done" : "failed" });
  };

  const history = [...data.history].reverse();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Support</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Email evidence</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            The coverage windows recorded for Resend&apos;s delivery reports, and what is stored. A window is a dated record used to label emails: recording its start or
            end does not turn report receipt on or off, register or remove the webhook, set or remove a secret, or send email, and does not show that reports are arriving.
            Checked {formatEvidenceTime(data.checked_at)}.
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => void load()}><RefreshCw />Refresh</Button>
      </header>

      {error && (
        <p role="alert" data-testid="refresh-error" className="rounded-lg border border-destructive/40 p-3 text-sm break-words text-destructive">
          The page could not be refreshed: {error}. The figures below are from {formatEvidenceTime(data.checked_at)}.
        </p>
      )}

      <Card className={cn(data.armed && "border-status-success")}>
        <CardHeader>
          <CardTitle className="text-lg">Coverage window</CardTitle>
          <CardDescription>
            Each recorded start and end keeps its time, the operator and the reason, and is never removed. An email&apos;s
            summary says whether it was sent inside a recorded window; recording an end never removes a report already received.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm font-medium" data-testid="collection-state">
            {data.armed && data.armed_at
              ? `A coverage window has been recorded as open since ${formatEvidenceTime(data.armed_at)}. This is a record, not a check that reports are arriving.`
              : data.history.length > 0
                ? "No coverage window is open. The last recorded window has ended."
                : "No coverage window has ever been recorded."}
          </p>
          {data.armed ? (
            <ConfirmAction
              triggerLabel="Record coverage window end"
              title="Record the end of the coverage window?"
              entity="Resend delivery reports"
              consequence={`Emails sent from now on will be labeled as sent with no coverage window recorded, and emails sent in the last ${RETRY_HORIZON_HOURS} hours as sent in a window that ended early. This only records the end: it does not stop Resend reports arriving, and it does not remove the webhook or its secret. Stopping receipt is the separately authorized shutdown procedure. Stored reports stay until purged.`}
              confirmLabel="Record end"
              requireReason
              reasonHelp={`One line, up to ${ARMING_REASON_MAX} characters. It is kept in the history.`}
              describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
              onConfirm={(reason) => transition("disarm", reason)}
            />
          ) : (
            <ConfirmAction
              triggerLabel="Record coverage window start"
              title="Record the start of a coverage window?"
              entity="Resend delivery reports"
              consequence="Emails sent from now on will be labeled as sent inside a recorded coverage window. This only records the start: it does not turn on report receipt, register the webhook or deploy its secret, which are separate owner-authorized steps. Record it only after they are done."
              confirmLabel="Record start"
              confirmationTone="commitment"
              attestation={armAttestation}
              requireReason
              reasonHelp={`One line, up to ${ARMING_REASON_MAX} characters. It is kept in the history.`}
              describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
              onConfirm={(reason) => transition("arm", reason)}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coverage window history</CardTitle>
          <CardDescription>Newest first. Every entry is kept.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coverage window has been recorded.</p>
          ) : (
            <ol aria-label="Coverage window history" className="divide-y divide-border">
              {history.map((event) => (
                <li key={event.seq} className="py-3 text-sm">
                  <p className="font-medium">{armingActionLabel[event.action]} · {formatEvidenceTime(event.occurred_at)}</p>
                  <p className="mt-1 break-words text-muted-foreground">{event.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{actorLabel(event.actor)}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What an email&apos;s coverage label means</CardTitle>
          <CardDescription>
            Read from the recorded windows and the time each email was sent. A window shows what was recorded, not that the receiver was available throughout it.
            The {RETRY_HORIZON_HOURS} hours follow Resend&apos;s documented retry schedule: they are how long a window must stay open, not proof that every report
            was collected. Reports Resend raises later, such as a late bounce, are outside them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {COVERAGE_ORDER.map((coverage) => <li key={coverage} className="break-words">{coverageLabel[coverage]}</li>)}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Stored provider reports</CardTitle>
          <CardDescription>
            Counts only. Recording a window end, stopping receipt or rolling back a release deletes nothing; only the operator purge does. The purge deletes
            expired reports only, up to {PURGE_BATCH_MAX.toLocaleString("en-US")} each time it is confirmed. Nothing runs it automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Count term="Stored reports" value={data.retention.retained} />
            <Count term="Matched to an email" value={data.retention.retained_linked} />
            <Count term="Not matched" value={data.retention.retained_unlinked} />
            <Count term="Expired, awaiting purge" value={data.retention.expired} />
          </dl>
          <p className={cn("text-sm", data.retention.purge_duty ? "text-status-warning" : "text-muted-foreground")} data-testid="purge-duty">
            {purgeDutyLabel(data.retention)}
          </p>
          {data.retention.latest_expires_at && (
            <p className="text-xs text-muted-foreground">Last stored report expires {formatEvidenceTime(data.retention.latest_expires_at)}.</p>
          )}
          <p className="text-xs text-muted-foreground">
            {data.retention.last_purge
              ? `Last purge ${formatEvidenceTime(data.retention.last_purge.ran_at)}: ${data.retention.last_purge.deleted} deleted, ${data.retention.last_purge.remaining_over_cap ? "over 10,000" : data.retention.last_purge.remaining_expired} expired left.`
              : "No purge has been run."}
          </p>
          <ConfirmAction
            triggerLabel="Purge expired reports"
            title="Permanently delete expired provider reports?"
            entity={`Up to ${PURGE_BATCH_MAX.toLocaleString("en-US")} expired Resend delivery reports`}
            consequence={`Deletes up to ${PURGE_BATCH_MAX.toLocaleString("en-US")} provider reports whose retention has expired, oldest first, in this one run. Deletion is permanent and cannot be undone. Reports that have not expired, email records and the coverage window history are not changed. If expired reports remain, the page says so; run it again to delete more.`}
            confirmLabel="Delete expired reports"
            describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
            onConfirm={() => runPurge()}
          />
          <div role="status" aria-live="polite" data-testid="purge-result" className="text-sm">
            {purge && (
              <div className="space-y-1">
                <p className="font-medium">{purgeDeletedLabel(purge.result)} · {formatEvidenceTime(purge.result.checked_at)}</p>
                <p className="break-words">{purgeRemainingLabel(purge.result, formatEvidenceTime)}</p>
                {purge.refresh === "pending" && <p className="text-muted-foreground">Refreshing the counts…</p>}
                {purge.refresh === "failed" && (
                  <p className="text-status-warning">The counts above were not refreshed after this purge. The deletion stands; use Refresh to read the current counts.</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test probes</CardTitle>
          <CardDescription>
            Sends one fixed test email to one of Resend&apos;s test addresses, then shows the reports received for it. Test reports are not matched to any email
            record: they show that Resend reports reach Mercurius, not that a customer or owner email was delivered. Off unless this deployment enables them.
            The same test on the same day repeats Resend&apos;s first answer instead of sending again, and a failed test is never retried.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ConfirmAction
            triggerLabel="Send a test email"
            title="Send one test email?"
            entity="Resend test address"
            consequence="Sends one fixed test email with no customer information to the chosen Resend test address. It counts against the Resend quota."
            confirmLabel="Send test"
            confirmationTone="commitment"
            choice={{ label: "Test address", options: PROBE_CHOICES.map((choice) => ({ value: choice, label: probeExpectation[choice].label })) }}
            describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
            onConfirm={(_reason, choice) => runProbe(choice)}
          />
          <div role="status" aria-live="polite" data-testid="probe-result" className="text-sm">
            {probe?.state === "sent" && (
              <div className="space-y-1">
                <p className="font-medium">
                  {probeExpectation[probe.choice].label}: {probe.verdict ? probeVerdictLabel[probe.verdict] : "Sent; its reports could not be read. Send the same test again today to read them without sending again."}
                </p>
                {!probeExpectation[probe.choice].documented && (
                  <p className="text-muted-foreground">Which report this address produces is not documented; record what arrives.</p>
                )}
                {probe.verdict !== "not_probe_evidence" && probe.readback?.receipts.filter((receipt) => receipt.state === "unlinked").map((receipt, index) => (
                  <p key={index} className="text-muted-foreground">
                    {receipt.fact ? evidenceFactLabel[receipt.fact] : "Unrecognized report"}
                    {" · "}Provider time {receipt.provider_created_at ? formatEvidenceTime(receipt.provider_created_at) : "not given"}
                  </p>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Count({ term, value }: { term: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="font-heading text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
