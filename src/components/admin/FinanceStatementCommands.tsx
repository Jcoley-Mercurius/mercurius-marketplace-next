"use client";

import { useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import type { Accepted, Run } from "@/components/admin/FinanceCommands";
import {
  fileFingerprint,
  guessMapping,
  mappingError,
  parseCsv,
  parseDate,
  periodDays,
  periodError,
  readRows,
  type ColumnMapping,
  type StatementLineInput,
} from "@/lib/bankStatementCsv";
import {
  bankLineStateLabel,
  bankMovementKindLabel,
  bankResolutionLabel,
  bankSuggestionLabel,
  blockerLabel,
  canDismissLine,
  formatDay,
  lineResolution,
  matchCandidates,
  parseCents,
  type BankMovement,
  type BankStatement,
  type FinanceOperations,
  type ReviewOperation,
  type StatementLine,
} from "@/lib/financeCommands";
import { formatCents } from "@/lib/financeReconciliation";
import { createClient } from "@/lib/supabase/client";

// TRACE-081 bank statement reconciliation. The bank's CSV is read in this browser and never
// uploaded; only the chosen lines' date, direction, amount and reference are sent. A line is
// evidence only: it changes nothing until an operator records the outcome it shows through the
// existing commands, matches it or dismisses it. Closing a statement needs a second operator.

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const stateTone: Record<StatementLine["state"], string> = {
  matched: "text-status-success",
  amount_mismatch: "text-status-danger",
  dismissed: "text-muted-foreground",
  unmatched: "text-status-warning",
};

const resolutionConsequence = {
  record_settled: "Records the transfer as settled under your name, with this statement line as its evidence, and posts the payout to the ledger. It cannot be undone here.",
  record_returned: "Records the return under your name, with this statement line as its evidence, and reverses the payout in the ledger. The payout can then be retried or withdrawn with a second operator.",
  request_late_settlement: "Creates a review request to record that the bank paid this withdrawn transfer, with this statement line as its evidence. A different finance operator must approve it within 24 hours; you then run it.",
} as const;

type SubmitRequest = (
  operation: ReviewOperation,
  entity: string,
  call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) => Promise<void>;

type Loaded = { name: string; rows: string[][]; fingerprint: string };

const columnOptions = (header: string[]) =>
  header.map((name, index) => ({ value: String(index), label: name.trim() || `Column ${index + 1}` }));

export function FinanceStatementCommands({
  ops,
  busy,
  run,
  accepted,
  submitRequest,
  commandKey,
}: {
  ops: FinanceOperations;
  busy: boolean;
  run: Run;
  accepted: Accepted;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
}) {
  const statements = ops.statements;
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [manual, setManual] = useState({ date: "", direction: "", amount: "", reference: "" });
  const [matchLine, setMatchLine] = useState("");
  const [matchMovement, setMatchMovement] = useState("");

  const days = periodDays(start, end);
  const periodProblem = !start || !end ? null : days === null ? "The period must end on or after its start." : days > 32 ? "A statement period is at most 32 days." : start > statements.today ? "The period cannot start after today." : null;
  const periodReady = Boolean(start && end) && periodProblem === null;
  const period = periodReady ? `${formatDay(start)} to ${formatDay(end)}` : "";

  const header = loaded?.rows[0] ?? [];
  const rows = loaded && mapping ? readRows(loaded.rows, mapping, hasHeader) : [];
  const mapProblem = mapping ? mappingError(mapping) : null;
  const usable = rows.filter((row) => row.line && (!periodReady || periodError(row.line, start, end) === null));
  const picked = usable.filter((row) => chosen.includes(row.row)).map((row) => row.line!) as StatementLineInput[];
  const debitTotal = picked.filter((line) => line.direction === "debit").reduce((sum, line) => sum + line.amount, 0);
  const creditTotal = picked.filter((line) => line.direction === "credit").reduce((sum, line) => sum + line.amount, 0);
  const mappedColumns = mapping ? [mapping.date, mapping.reference, mapping.amount, mapping.debit, mapping.credit, mapping.type] : [];

  const manualDate = parseDate(manual.date);
  const manualCents = manual.amount.trim() ? parseCents(manual.amount) : null;
  const manualLine: StatementLineInput | null =
    manualDate && (manual.direction === "debit" || manual.direction === "credit") && manualCents && manualCents > 0 && manual.reference.trim() && manual.reference.trim().length <= 200
      ? { posted_on: manualDate, direction: manual.direction, amount: manualCents, reference: manual.reference.trim() }
      : null;
  const manualProblem = manualLine && periodReady ? periodError(manualLine, start, end) : null;

  const allLines = statements.statements.flatMap((statement) => statement.lines.map((line) => ({ statement, line })));
  const matchable = allLines.filter(({ statement, line }) => !statement.closed && line.state === "unmatched" && matchCandidates(line, statements.unevidenced).length > 0);
  const matching = matchable.find(({ line }) => line.line_id === matchLine);
  const candidates = matching ? matchCandidates(matching.line, statements.unevidenced) : [];
  const movement = candidates.find((candidate) => candidate.movement === matchMovement);

  const lineLabel = (statement: BankStatement, line: StatementLine) =>
    `${formatDay(statement.period_start)} statement · line ${line.line_number} · ${line.direction} ${formatCents(line.amount)} · posted ${formatDay(line.posted_on)} · ref …${line.bank_reference_hint}`;
  const movementLabel = (item: BankMovement) =>
    `${bankMovementKindLabel[item.kind]} · ${item.invoice_number ?? `Obligation ${item.obligation_id.slice(0, 8)}`} · ${item.payee_name ?? "Provider"} · ${formatCents(item.amount)}${item.bank_reference_hint ? ` · ref …${item.bank_reference_hint}` : ""}`;

  const load = async (file: File | undefined) => {
    setLoaded(null);
    setMapping(null);
    setChosen([]);
    setFileError("");
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const parsed = parseCsv(new TextDecoder().decode(bytes));
      if (parsed.length === 0) {
        setFileError("The file has no rows.");
        return;
      }
      setLoaded({ name: file.name, rows: parsed, fingerprint: await fileFingerprint(bytes) });
      setHasHeader(true);
      setMapping(guessMapping(parsed[0]));
    } catch {
      setFileError("The file could not be read as CSV.");
    }
  };

  const importLines = (lines: StatementLineInput[], fingerprint: string | null, what: string) => {
    const [from, to] = [start, end];
    let statementId = "";
    return run(
      async () => {
        const data = await accepted(createClient().rpc("money_operator_import_bank_statement", {
          p_period_start: from, p_period_end: to, p_lines: lines, p_file_fingerprint: fingerprint ?? undefined,
          p_key: commandKey(`statement:${from}:${to}:${fingerprint ?? "manual"}:${lines.length}`),
        }));
        statementId = typeof data?.statement_id === "string" ? data.statement_id : "";
      },
      (next) => next.statements.statements.some((statement) => statement.statement_id === statementId),
      { title: "Statement lines imported", description: `${what} · ${formatDay(from)} to ${formatDay(to)}. Nothing was recorded on any transfer.` },
    );
  };

  const setColumn = (key: keyof Omit<ColumnMapping, "mode">) => (value: string) =>
    setMapping((current) => (current ? { ...current, [key]: value === "" ? null : Number(value) } : current));

  const columnSelect = (label: string, key: keyof Omit<ColumnMapping, "mode">) => (
    <FormField label={label} required>
      {(control) => (
        <select {...control} className={selectClass} value={mapping?.[key] ?? ""} disabled={busy} onChange={(event) => setColumn(key)(event.target.value)}>
          <option value="">Select a column</option>
          {columnOptions(hasHeader ? header : header.map((_, index) => `Column ${index + 1}`)).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
    </FormField>
  );

  return (
    <section aria-labelledby="finance-statements" className="space-y-4">
      <div>
        <h3 id="finance-statements" className="font-medium">Bank statements</h3>
        <p className="text-sm text-muted-foreground">
          Import the provider payout lines from the bank&apos;s statement: ACH payments to providers, and credits that are returns or provider repayments. Leave everything else out. The file is read in this browser and never uploaded; only each line&apos;s date, debit or credit, amount and reference are saved. A line never changes a transfer by itself. Close a statement once every line is resolved; a second finance operator approves.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-4">
        <h4 className="font-medium">Import statement lines</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Statement period starts" required>
            {(control) => <Input {...control} type="date" value={start} max={statements.today} disabled={busy} onChange={(event) => setStart(event.target.value)} />}
          </FormField>
          <FormField label="Statement period ends" required error={periodProblem ?? undefined} help="The dates printed on the bank statement. Import again into the same dates to add lines.">
            {(control) => <Input {...control} type="date" value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} />}
          </FormField>
        </div>

        <FormField label="Bank CSV export" error={fileError || undefined} help="Read here only. The file, its descriptions and any account details are never sent.">
          {(control) => <Input {...control} type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void load(event.target.files?.[0])} />}
        </FormField>

        {loaded && mapping && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={hasHeader} disabled={busy} onChange={(event) => { setHasHeader(event.target.checked); setChosen([]); }} />
              The first row is a header
            </label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {columnSelect("Date column", "date")}
              {columnSelect("Reference column", "reference")}
              <FormField label="How the amount is shown" required>
                {(control) => (
                  <select {...control} className={selectClass} value={mapping.mode} disabled={busy}
                    onChange={(event) => setMapping({ ...mapping, mode: event.target.value as ColumnMapping["mode"] })}>
                    <option value="signed">One amount column; money out is negative</option>
                    <option value="split">Separate debit and credit columns</option>
                    <option value="typed">Amount with a debit/credit type column</option>
                  </select>
                )}
              </FormField>
              {mapping.mode === "split" ? (
                <>
                  {columnSelect("Debit column", "debit")}
                  {columnSelect("Credit column", "credit")}
                </>
              ) : (
                columnSelect("Amount column", "amount")
              )}
              {mapping.mode === "typed" && columnSelect("Debit/credit type column", "type")}
            </div>
            {mapProblem ? (
              <p role="alert" className="text-sm text-destructive">{mapProblem}</p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Payout lines to import from {loaded.name} ({rows.length} rows)</legend>
                <p className="text-sm text-muted-foreground">Tick only provider ACH payments, returns and repayments. Details in grey stay on this screen.</p>
                <ul className="max-h-96 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {rows.map((row) => {
                    const outside = row.line && periodReady ? periodError(row.line, start, end) : null;
                    const problem = row.error ?? outside;
                    const details = row.cells.filter((_, index) => !mappedColumns.includes(index)).map((cell) => cell.trim()).filter(Boolean).join(" · ");
                    return (
                      <li key={row.row}>
                        <label className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={chosen.includes(row.row) && !problem}
                            disabled={busy || problem !== null}
                            onChange={(event) => setChosen((value) => event.target.checked ? [...value, row.row] : value.filter((item) => item !== row.row))}
                          />
                          <span className="flex min-w-0 flex-col">
                            {row.line ? (
                              <span className="tabular-nums">
                                Row {row.row} · {formatDay(row.line.posted_on)} · {row.line.direction === "debit" ? "Debit" : "Credit"} {formatCents(row.line.amount)} · ref {row.line.reference}
                              </span>
                            ) : (
                              <span>Row {row.row}</span>
                            )}
                            {details && <span className="text-xs text-muted-foreground">{details}</span>}
                            {problem && <span className="text-xs text-status-danger">{problem}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-3 text-sm">
                  <button type="button" className="underline underline-offset-4 disabled:opacity-50" disabled={busy || usable.length === 0}
                    onClick={() => setChosen(usable.filter((row) => row.line!.direction === "debit").map((row) => row.row))}>
                    Select all debits
                  </button>
                  <button type="button" className="underline underline-offset-4 disabled:opacity-50" disabled={busy || chosen.length === 0} onClick={() => setChosen([])}>
                    Clear
                  </button>
                </div>
              </fieldset>
            )}
            <p className="text-sm tabular-nums">
              {picked.length} line{picked.length === 1 ? "" : "s"} · debits {formatCents(debitTotal)} · credits {formatCents(creditTotal)}
            </p>
            <ConfirmAction
              disabled={busy || !periodReady || picked.length === 0}
              confirmationTone="commitment"
              triggerLabel={`Import ${picked.length} line${picked.length === 1 ? "" : "s"}`}
              title="Import these statement lines?"
              entity={`${period} · ${picked.length} line${picked.length === 1 ? "" : "s"} · debits ${formatCents(debitTotal)} · credits ${formatCents(creditTotal)}`}
              consequence="Saves each line's date, debit or credit, amount and reference to this statement, creating it if needed. Lines cannot be edited or removed; a line imported by mistake is dismissed with a reason. Nothing is recorded on any transfer."
              confirmLabel="Import"
              onConfirm={() => importLines(picked, loaded.fingerprint, `${picked.length} line${picked.length === 1 ? "" : "s"} from ${loaded.name}`)
                .then(() => { setChosen([]); setLoaded(null); setMapping(null); })}
            />
          </div>
        )}

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Enter one line by hand, or record a period with no payout lines</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FormField label="Posting date" required>
              {(control) => <Input {...control} type="date" value={manual.date} disabled={busy} onChange={(event) => setManual({ ...manual, date: event.target.value })} />}
            </FormField>
            <FormField label="Debit or credit" required>
              {(control) => (
                <select {...control} className={selectClass} value={manual.direction} disabled={busy} onChange={(event) => setManual({ ...manual, direction: event.target.value })}>
                  <option value="">Select</option>
                  <option value="debit">Debit (money out)</option>
                  <option value="credit">Credit (money in)</option>
                </select>
              )}
            </FormField>
            <FormField label="Line amount in USD" required>
              {(control) => <Input {...control} inputMode="decimal" placeholder="0.00" value={manual.amount} disabled={busy} onChange={(event) => setManual({ ...manual, amount: event.target.value })} />}
            </FormField>
            <FormField label="Bank reference on the line" required error={manualProblem ?? undefined} help="Such as the trace number. Never an account or routing number.">
              {(control) => <Input {...control} value={manual.reference} maxLength={200} disabled={busy} onChange={(event) => setManual({ ...manual, reference: event.target.value })} />}
            </FormField>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <ConfirmAction
              disabled={busy || !periodReady || !manualLine || manualProblem !== null}
              confirmationTone="commitment"
              triggerLabel="Import this line"
              title="Import this statement line?"
              entity={manualLine ? `${period} · ${manualLine.direction} ${formatCents(manualLine.amount)} · posted ${formatDay(manualLine.posted_on)} · ref ${manualLine.reference}` : ""}
              consequence="Saves the line to this statement, creating it if needed. It cannot be edited or removed. Nothing is recorded on any transfer."
              confirmLabel="Import"
              onConfirm={() => importLines([manualLine!], null, "1 line entered by hand").then(() => setManual({ date: "", direction: "", amount: "", reference: "" }))}
            />
            <ConfirmAction
              disabled={busy || !periodReady}
              confirmationTone="commitment"
              triggerLabel="Record no payout lines"
              title="Record that this period had no payout lines?"
              entity={period}
              consequence="Creates the statement for this period with no lines, so it can be closed once any recorded bank movement in the period is accounted for."
              confirmLabel="Record"
              onConfirm={() => importLines([], null, "No payout lines")}
            />
          </div>
        </details>
      </div>

      {statements.statements.length === 0 ? (
        <PageState kind="empty" title="No bank statements yet" description="Import the payout lines from a bank statement to check them against recorded transfers." />
      ) : (
        statements.statements.map((statement) => (
          <StatementCard key={statement.statement_id} statement={statement} busy={busy} run={run} accepted={accepted} submitRequest={submitRequest} commandKey={commandKey} lineLabel={lineLabel} />
        ))
      )}

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h4 className="font-medium">Match a line by hand</h4>
        <p className="text-sm text-muted-foreground">
          For a provider repayment, which has no transfer reference, or a payment the bank shows under a different reference. Only a recorded movement of the same direction and amount that no other line shows can be matched.
        </p>
        <FormField label="Unmatched statement line" required>
          {(control) => (
            <select {...control} className={selectClass} value={matchLine} disabled={busy || matchable.length === 0} onChange={(event) => { setMatchLine(event.target.value); setMatchMovement(""); }}>
              <option value="">{matchable.length ? "Select a line" : "No line has a recorded movement to match"}</option>
              {matchable.map(({ statement, line }) => <option key={line.line_id} value={line.line_id}>{lineLabel(statement, line)}</option>)}
            </select>
          )}
        </FormField>
        <FormField label="Recorded movement it shows" required>
          {(control) => (
            <select {...control} className={selectClass} value={matchMovement} disabled={busy || !matching} onChange={(event) => setMatchMovement(event.target.value)}>
              <option value="">{matching ? "Select a movement" : "Select a line first"}</option>
              {candidates.map((candidate) => <option key={candidate.movement} value={candidate.movement}>{movementLabel(candidate)}</option>)}
            </select>
          )}
        </FormField>
        <ConfirmAction
          disabled={busy || !matching || !movement}
          requireReason
          reasonLabel="Why they are the same"
          reasonHelp="For example, the repayment the provider told you they sent, or the bank's trace number for this transfer."
          confirmationTone="commitment"
          triggerLabel="Match line"
          title="Match this line to the movement?"
          entity={matching && movement ? `${lineLabel(matching.statement, matching.line)} → ${movementLabel(movement)}` : ""}
          consequence="Records that this statement line shows that movement. It cannot be undone here. Nothing is recorded on any transfer."
          confirmLabel="Match"
          onConfirm={(reason) => {
            const lineId = matching!.line.line_id;
            const target = movement!.movement;
            return run(
              async () => { await accepted(createClient().rpc("money_operator_match_bank_line", { p_line: lineId, p_movement: target, p_reason: reason })); },
              (next) => next.statements.statements.some((statement) => statement.lines.some((line) => line.line_id === lineId && line.match?.movement === target)),
              { title: "Statement line matched", description: movementLabel(movement!) },
            ).then(() => { setMatchLine(""); setMatchMovement(""); });
          }}
        />
      </div>

      <div className="space-y-3">
        <h4 className="font-medium">Recorded but not on a statement ({statements.unevidenced.length})</h4>
        <p className="text-sm text-muted-foreground">
          Settlements, returns, late payments and repayments no imported line shows. One dated inside an imported statement&apos;s period stops that statement from closing until its line is imported or matched.
        </p>
        {statements.unevidenced.length === 0 ? (
          <PageState kind="empty" title="Every recorded bank movement is on a statement" />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Recorded bank movements not on a statement"
              rows={statements.unevidenced}
              rowKey={(item) => item.movement}
              rowLabel={movementLabel}
              columns={[
                {
                  key: "movement",
                  label: "Movement",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="font-medium">{bankMovementKindLabel[item.kind]}</span>
                      <span className="text-xs text-muted-foreground">{item.invoice_number ?? `Obligation ${item.obligation_id.slice(0, 8)}`} · {item.payee_name ?? "Provider"}</span>
                    </span>
                  ),
                },
                {
                  key: "amount",
                  label: "Amount",
                  render: (item) => <span className="tabular-nums">{item.direction === "debit" ? "Debit" : "Credit"} {formatCents(item.amount)}{item.bank_reference_hint ? ` · ref …${item.bank_reference_hint}` : ""}</span>,
                },
                {
                  key: "recorded",
                  label: "Recorded",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5">
                      <span>{new Date(item.recorded_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                      <span className="text-xs text-muted-foreground">{item.statement_id ? "Inside an imported statement period" : "No imported statement covers this date yet"}</span>
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

function StatementCard({
  statement,
  busy,
  run,
  accepted,
  submitRequest,
  commandKey,
  lineLabel,
}: {
  statement: BankStatement;
  busy: boolean;
  run: Run;
  accepted: Accepted;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
  lineLabel: (statement: BankStatement, line: StatementLine) => string;
}) {
  const title = `Statement ${formatDay(statement.period_start)} to ${formatDay(statement.period_end)}`;
  const totals = `${statement.line_count} line${statement.line_count === 1 ? "" : "s"} · debits ${formatCents(statement.debit_total)} · credits ${formatCents(statement.credit_total)}`;
  const confirmedLine = (lineId: string, test: (line: StatementLine) => boolean) => (next: FinanceOperations) =>
    next.statements.statements.some((candidate) => candidate.lines.some((line) => line.line_id === lineId && test(line)));

  return (
    <details open={!statement.closed} className="rounded-xl border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
        <span className="font-medium">{title}</span>
        <span className={statement.closed ? "text-sm text-status-success" : statement.exceptions > 0 ? "text-sm text-status-warning" : "text-sm text-muted-foreground"}>
          {statement.closed ? "Closed" : statement.exceptions > 0 ? `${statement.exceptions} open exception${statement.exceptions === 1 ? "" : "s"}` : "Open, reconciled"}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">{totals}</span>
      </summary>
      <div className="space-y-3 border-t p-4">
        {statement.closed ? (
          <p className="text-sm text-muted-foreground">
            Closed {new Date(statement.closed.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{statement.closed.by_me ? " with you as an operator" : ""}: {statement.closed.reason}
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {statement.open_request_id ? "Close requested; see reviews." : statement.close_blocker ? blockerLabel[statement.close_blocker] : "Every line is resolved and every recorded movement in the period is on a line."}
            </p>
            <ConfirmAction
              disabled={busy || statement.close_blocker !== null || statement.open_request_id !== null}
              requireReason
              reasonLabel="Close reason"
              reasonHelp="For example, the statement you checked it against."
              confirmationTone="commitment"
              triggerLabel="Request close"
              title="Request to close this statement?"
              entity={`${title} · ${totals}`}
              consequence="Creates a review request bound to these lines and totals. A different finance operator must approve it within 24 hours; you then run it. A closed statement takes no more lines and cannot change. If a line is added first, it cannot run."
              confirmLabel="Request close"
              onConfirm={(reason) => submitRequest("bank_statement_close", title, () => createClient().rpc("money_operator_request_bank_statement_close", {
                p_statement: statement.statement_id, p_reason: reason, p_key: commandKey(`statement-close:${statement.statement_id}`),
              }))}
            />
          </div>
        )}
        {statement.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payout lines were imported for this period.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <ResponsiveDataList
              label={`${title} lines`}
              rows={statement.lines}
              rowKey={(line) => line.line_id}
              rowLabel={(line) => `Line ${line.line_number} · ${bankLineStateLabel[line.state]}`}
              columns={[
                {
                  key: "line",
                  label: "Line",
                  render: (line) => (
                    <span className="flex flex-col gap-0.5 tabular-nums">
                      <span className="font-medium">{line.line_number}. {line.direction === "debit" ? "Debit" : "Credit"} {formatCents(line.amount)}</span>
                      <span className="text-xs text-muted-foreground">Posted {formatDay(line.posted_on)} · ref …{line.bank_reference_hint}</span>
                    </span>
                  ),
                },
                {
                  key: "state",
                  label: "Shows",
                  render: (line) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className={`font-medium ${stateTone[line.state]}`}>{bankLineStateLabel[line.state]}</span>
                      {line.match && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {bankMovementKindLabel[line.match.kind]} · {line.match.invoice_number ?? "Payout"} · {line.match.payee_name ?? "Provider"}
                          {line.state === "amount_mismatch" ? ` · recorded ${formatCents(line.match.amount)}` : ""}
                          {line.match.how === "manual" ? " · matched by hand" : ""}
                        </span>
                      )}
                      {line.state === "unmatched" && line.suggestion && (
                        <span className="text-xs">
                          {bankSuggestionLabel[line.suggestion.action]}
                          {line.suggestion.invoice_number ? ` ${line.suggestion.invoice_number} · ${line.suggestion.payee_name ?? "Provider"}` : ""}
                          {line.suggestion.action === "amount_mismatch" && line.suggestion.amount ? ` Transfer ${formatCents(line.suggestion.amount)}.` : ""}
                        </span>
                      )}
                      {line.dismissal && <span className="text-xs text-muted-foreground">{line.dismissal.reason}</span>}
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "Action",
                  render: (line) => {
                    if (statement.closed) return <span className="text-muted-foreground">—</span>;
                    const resolution = lineResolution(line);
                    return (
                      <span className="flex flex-col items-start gap-2">
                        {resolution && (
                          <ConfirmAction
                            disabled={busy}
                            requireReason
                            reasonLabel="Note"
                            reasonHelp="Up to 500 characters, saved with the statement line as the evidence."
                            confirmationTone="commitment"
                            triggerLabel={bankResolutionLabel[resolution]}
                            title={`${bankResolutionLabel[resolution]} from this line?`}
                            entity={`${lineLabel(statement, line)} · ${line.suggestion?.invoice_number ?? "Payout"} · ${line.suggestion?.payee_name ?? "Provider"}`}
                            consequence={resolutionConsequence[resolution]}
                            confirmLabel={bankResolutionLabel[resolution]}
                            onConfirm={(note) => {
                              const call = () => createClient().rpc("money_operator_resolve_bank_line", {
                                p_line: line.line_id, p_action: resolution, p_note: note, p_key: commandKey(`statement-line:${line.line_id}:${resolution}`),
                              });
                              if (resolution === "request_late_settlement") return submitRequest("ach_late_settlement", lineLabel(statement, line), call);
                              return run(
                                async () => { await accepted(call()); },
                                confirmedLine(line.line_id, (next) => next.state === "matched"),
                                { title: "Bank outcome recorded", description: `${lineLabel(statement, line)}.` },
                              );
                            }}
                          />
                        )}
                        {canDismissLine(line) && (
                          <ConfirmAction
                            disabled={busy}
                            requireReason
                            reasonLabel="Why it is not a provider payout"
                            confirmationTone="destructive"
                            triggerLabel="Not a payout"
                            title="Dismiss this line as not a provider payout?"
                            entity={lineLabel(statement, line)}
                            consequence="Records that this line was imported by mistake and is not a provider payout, return or repayment. It cannot be undone here."
                            confirmLabel="Dismiss line"
                            onConfirm={(reason) => run(
                              async () => { await accepted(createClient().rpc("money_operator_dismiss_bank_line", { p_line: line.line_id, p_reason: reason })); },
                              confirmedLine(line.line_id, (next) => next.state === "dismissed"),
                              { title: "Statement line dismissed", description: `${lineLabel(statement, line)}.` },
                            )}
                          />
                        )}
                        {!resolution && !canDismissLine(line) && <span className="text-muted-foreground">—</span>}
                      </span>
                    );
                  },
                },
              ]}
            />
          </div>
        )}
      </div>
    </details>
  );
}
