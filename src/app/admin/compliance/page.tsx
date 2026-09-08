"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Provider = {
  id: string;
  name: string;
  active: boolean;
  marketing_enabled: boolean;
  onboarding_status: string | null;
  onboarding_revision: number | null;
  application_id: string | null;
  documents: string[];
  generic_current: boolean;
  scoped_current: boolean;
  decision: "included" | "excluded" | null;
  decision_reason: string | null;
  service_ids: string[];
  zip_codes: string[];
};
type EvidenceKind = "license" | "insurance";
type Requirement = {
  id: string;
  service_id: string;
  service_name: string;
  zip_code: string;
  kind: EvidenceKind;
  version: string;
  description: string;
  effective_at: string;
  expires_at: string | null;
};
type Binding = {
  requirement_id: string;
  contractor_id: string;
  evidence_id: string;
  evidence_ref: string;
  accepted_at: string;
  expires_at: string | null;
  current: boolean;
};
type Evidence = {
  current: boolean;
  id: string;
  contractor_id: string;
  kind: EvidenceKind;
  requirement_version: string;
  evidence_ref: string;
  accepted_at: string;
  expires_at: string | null;
};
type Dashboard = {
  evaluated_at: string;
  control: {
    enforced: boolean;
    finalized_at: string | null;
    reason: string | null;
  };
  providers: Provider[];
  requirements: Requirement[];
  bindings: Binding[];
  evidence: Evidence[];
  services: { id: string; name: string }[];
  areas: { zip_code: string; city: string }[];
};
const EMPTY: Dashboard = {
  evaluated_at: "1970-01-01T00:00:00Z",
  control: { enforced: false, finalized_at: null, reason: null },
  providers: [],
  requirements: [],
  bindings: [],
  evidence: [],
  services: [],
  areas: [],
};

export default function ComplianceOperationsPage() {
  const [data, setData] = useState<Dashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [requirement, setRequirement] = useState<{
    service_id: string;
    zip_code: string;
    kind: EvidenceKind;
    version: string;
    description: string;
    effective_at: string;
    expires_at: string;
  }>({
    service_id: "",
    zip_code: "",
    kind: "license",
    version: "",
    description: "",
    effective_at: localDateTime(),
    expires_at: "",
  });
  const [evidence, setEvidence] = useState({
    requirement_id: "",
    document: "",
    accepted_at: localDateTime(),
    expires_at: "",
  });
  const load = useCallback(async () => {
    setError("");
    try {
      const result = await createClient().rpc("vendor_compliance_operations");
      if (result.error) throw result.error;
      const next = (result.data ?? EMPTY) as unknown as Dashboard;
      setData(next);
      setSelectedId((current) =>
        current && next.providers.some((p) => p.id === current)
          ? current
          : (next.providers[0]?.id ?? ""),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Compliance operations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const selected = data.providers.find((p) => p.id === selectedId) ?? null;
  const bindings = new Map(
    data.bindings
      .filter((binding) => binding.current)
      .map((binding) => [
        `${binding.contractor_id}:${binding.requirement_id}`,
        binding,
      ]),
  );
  const applicable = selected
    ? data.requirements.filter(
        (r) =>
          selected.service_ids.includes(r.service_id) &&
          selected.zip_codes.includes(r.zip_code) &&
          new Date(r.effective_at).getTime() <=
            new Date(data.evaluated_at).getTime() &&
          (!r.expires_at ||
            new Date(r.expires_at).getTime() >
              new Date(data.evaluated_at).getTime()),
      )
    : [];
  const participating = data.providers.filter(
    (p) => p.active && p.marketing_enabled,
  );
  const undecided = participating.filter((p) => !p.decision).length;
  const incomplete = data.providers.filter(
    (p) =>
      p.decision === "included" && (!p.generic_current || !p.scoped_current),
  ).length;
  const ready = undecided === 0 && incomplete === 0;
  const chosenRequirement = applicable.find(
    (item) => item.id === evidence.requirement_id,
  );
  const currentEvidence = data.evidence.find(
    (item) =>
      item.contractor_id === selectedId &&
      item.kind === chosenRequirement?.kind,
  );
  async function mutate(
    run: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) {
    setBusy(true);
    try {
      const result = await run();
      if (result.error) throw result.error;
      toast.success(success);
      await load();
    } catch (reason) {
      toast.error("Action could not be completed", {
        description:
          reason instanceof Error
            ? reason.message
            : "Review the current state and try again.",
      });
      throw reason;
    } finally {
      setBusy(false);
    }
  }
  async function createRequirement() {
    if (
      !requirement.service_id ||
      !requirement.zip_code ||
      !requirement.version.trim() ||
      !requirement.description.trim()
    )
      return;
    await mutate(
      () =>
        createClient().rpc("vendor_create_compliance_requirement", {
          p_service: requirement.service_id,
          p_zip: requirement.zip_code,
          p_kind: requirement.kind,
          p_requirement_version: requirement.version.trim(),
          p_description: requirement.description.trim(),
          p_effective: new Date(requirement.effective_at).toISOString(),
          p_expires: requirement.expires_at
            ? new Date(requirement.expires_at).toISOString()
            : null,
        }),
      "Compliance requirement recorded",
    );
    setRequirement((current) => ({
      ...current,
      version: "",
      description: "",
      expires_at: "",
    }));
  }
  async function bindDocument() {
    if (
      !selected ||
      !evidence.requirement_id ||
      !evidence.document ||
      !evidence.expires_at
    )
      return;
    await mutate(
      () =>
        createClient().rpc("vendor_record_requirement_document", {
          p_contractor: selected.id,
          p_requirement: evidence.requirement_id,
          p_document_path: evidence.document,
          p_accepted: new Date(evidence.accepted_at).toISOString(),
          p_expires: new Date(evidence.expires_at).toISOString(),
          p_supersedes: currentEvidence?.id ?? null,
        }),
      "Private evidence reviewed and bound",
    );
  }
  async function reuseEvidence() {
    if (!selected || !currentEvidence || !chosenRequirement) return;
    await mutate(
      () =>
        createClient().rpc("vendor_bind_requirement_evidence", {
          p_contractor: selected.id,
          p_requirement: chosenRequirement.id,
          p_evidence: currentEvidence.id,
        }),
      "Current evidence bound to requirement",
    );
  }
  async function decide(disposition: "included" | "excluded", reason: string) {
    if (!selected) return;
    await mutate(
      () =>
        createClient().rpc("vendor_record_cutover_decision", {
          p_contractor: selected.id,
          p_disposition: disposition,
          p_reason: reason,
        }),
      `Provider ${disposition}`,
    );
  }
  async function finalize(reason: string) {
    await mutate(
      () => createClient().rpc("vendor_finalize_cutover", { p_reason: reason }),
      "Strict provider cutover finalized",
    );
  }
  if (loading)
    return <State icon={Loader2} title="Loading compliance operations" spin />;
  if (error)
    return (
      <State
        icon={AlertCircle}
        title="Compliance operations unavailable"
        detail={error}
        action={
          <Button
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <RefreshCw />
            Try again
          </Button>
        }
      />
    );
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Provider compliance
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Review private evidence, decide beta participation, and verify
            readiness before strict matching begins.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
      </header>
      <section
        aria-label="Cutover readiness"
        className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4"
      >
        <Metric label="Participating providers" value={participating.length} />
        <Metric
          label="Awaiting decision"
          value={undecided}
          tone={undecided ? "warning" : "success"}
        />
        <Metric
          label="Included but incomplete"
          value={incomplete}
          tone={incomplete ? "danger" : "success"}
        />
        <Metric
          label="Matching mode"
          value={data.control.enforced ? "Strict" : "Compatibility"}
          tone={data.control.enforced ? "success" : "warning"}
        />
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,2fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Provider queue</CardTitle>
            <CardDescription>Choose a provider to review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            {data.providers.length ? (
              data.providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(provider.id);
                    setEvidence((current) => ({
                      ...current,
                      requirement_id: "",
                      document: "",
                    }));
                  }}
                  className={cn(
                    "w-full rounded-lg px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedId === provider.id
                      ? "bg-accent/10"
                      : "hover:bg-muted",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{provider.name}</strong>
                    <Status provider={provider} />
                  </span>
                  <span className="mt-1 block text-xs text-foreground/75">
                    {provider.onboarding_status ?? "No onboarding"} ·{" "}
                    {provider.documents.length} private document
                    {provider.documents.length === 1 ? "" : "s"}
                  </span>
                </button>
              ))
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                No providers need compliance review.
              </p>
            )}
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-6">
          {selected ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{selected.name}</CardTitle>
                      <CardDescription>
                        {selected.service_ids.length} service
                        {selected.service_ids.length === 1
                          ? ""
                          : "s"} across {selected.zip_codes.length} ZIP code
                        {selected.zip_codes.length === 1 ? "" : "s"}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant={
                          selected.generic_current ? "secondary" : "outline"
                        }
                      >
                        {selected.generic_current
                          ? "Onboarding current"
                          : "Onboarding incomplete"}
                      </Badge>
                      <Badge
                        variant={
                          selected.scoped_current ? "secondary" : "outline"
                        }
                      >
                        {selected.scoped_current
                          ? "Scoped evidence current"
                          : "Scoped evidence incomplete"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <h2 className="text-sm font-semibold">Required evidence</h2>
                    <div className="mt-3 divide-y rounded-xl border">
                      {applicable.length ? (
                        applicable.map((item) => {
                          const binding = bindings.get(
                            `${selected.id}:${item.id}`,
                          );
                          return (
                            <div
                              key={item.id}
                              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="text-sm font-medium">
                                  {item.service_name} · {item.zip_code} ·{" "}
                                  {item.kind}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {item.description} · {item.version}
                                </p>
                              </div>
                              <Badge
                                variant={binding ? "secondary" : "outline"}
                              >
                                {binding ? "Evidence bound" : "Needs evidence"}
                              </Badge>
                            </div>
                          );
                        })
                      ) : (
                        <p className="p-4 text-sm text-muted-foreground">
                          No active requirements match this provider’s service
                          area. Add both license and insurance requirements
                          before inclusion.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="evidence-requirement" label="Requirement">
                      <select
                        id="evidence-requirement"
                        className={selectClass}
                        value={evidence.requirement_id}
                        onChange={(event) =>
                          setEvidence({
                            ...evidence,
                            requirement_id: event.target.value,
                          })
                        }
                      >
                        <option value="">Select requirement</option>
                        {applicable.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.service_name} · {item.zip_code} · {item.kind}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      id="evidence-document"
                      label="Private application document"
                    >
                      <select
                        id="evidence-document"
                        className={selectClass}
                        value={evidence.document}
                        onChange={(event) =>
                          setEvidence({
                            ...evidence,
                            document: event.target.value,
                          })
                        }
                      >
                        <option value="">Select verified document</option>
                        {selected.documents.map((path) => (
                          <option key={path} value={path}>
                            {path.split("/").at(-1)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        <Link
                          className="underline underline-offset-4"
                          href="/admin/applications"
                        >
                          Review source files in Applications
                        </Link>
                      </p>
                    </Field>
                    <Field id="evidence-reviewed-at" label="Reviewed at">
                      <Input
                        id="evidence-reviewed-at"
                        type="datetime-local"
                        value={evidence.accepted_at}
                        onChange={(event) =>
                          setEvidence({
                            ...evidence,
                            accepted_at: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field id="evidence-expires-at" label="Evidence expires">
                      <Input
                        id="evidence-expires-at"
                        type="datetime-local"
                        value={evidence.expires_at}
                        onChange={(event) =>
                          setEvidence({
                            ...evidence,
                            expires_at: event.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Button
                    disabled={
                      busy ||
                      !evidence.accepted_at ||
                      !evidence.requirement_id ||
                      !evidence.document ||
                      !evidence.expires_at
                    }
                    onClick={() => void bindDocument().catch(() => undefined)}
                  >
                    <FileCheck2 />
                    Record reviewed evidence
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Recording replacement evidence supersedes the previous
                    record for this evidence kind. Rebind other requirements to
                    the new evidence as needed.
                  </p>
                  {currentEvidence?.current &&
                    currentEvidence.requirement_version ===
                      chosenRequirement?.version && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void reuseEvidence().catch(() => undefined)
                        }
                      >
                        Reuse current {currentEvidence.kind} evidence
                      </Button>
                    )}
                  <div className="flex flex-wrap gap-3 border-t pt-5">
                    <ConfirmAction
                      disabled={
                        busy ||
                        !selected.generic_current ||
                        !selected.scoped_current ||
                        Boolean(selected.decision)
                      }
                      requireReason
                      confirmationTone="commitment"
                      triggerLabel="Include in beta"
                      title="Include this provider?"
                      entity={selected.name}
                      consequence="This immutable decision allows the provider to remain eligible after strict cutover while all evidence stays current."
                      confirmLabel="Include provider"
                      onConfirm={(reason) => decide("included", reason)}
                    />
                    <ConfirmAction
                      disabled={busy || Boolean(selected.decision)}
                      requireReason
                      triggerLabel="Exclude from beta"
                      title="Exclude this provider?"
                      entity={selected.name}
                      consequence="This immutable decision removes the provider when strict cutover is finalized."
                      confirmLabel="Exclude provider"
                      onConfirm={(reason) => decide("excluded", reason)}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <State
              icon={ShieldCheck}
              title="Choose a provider"
              detail="Select a provider from the queue to review their compliance evidence."
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Define a compliance requirement</CardTitle>
              <CardDescription>
                Record reviewed requirements for an exact catalog service and
                Lee County ZIP. These values must come from approved operational
                guidance.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="requirement-service" label="Service">
                <select
                  id="requirement-service"
                  className={selectClass}
                  value={requirement.service_id}
                  onChange={(e) =>
                    setRequirement({
                      ...requirement,
                      service_id: e.target.value,
                    })
                  }
                >
                  <option value="">Select service</option>
                  {data.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="requirement-zip" label="ZIP jurisdiction">
                <select
                  id="requirement-zip"
                  className={selectClass}
                  value={requirement.zip_code}
                  onChange={(e) =>
                    setRequirement({ ...requirement, zip_code: e.target.value })
                  }
                >
                  <option value="">Select ZIP</option>
                  {data.areas.map((a) => (
                    <option key={a.zip_code} value={a.zip_code}>
                      {a.zip_code} · {a.city}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="requirement-kind" label="Evidence kind">
                <select
                  id="requirement-kind"
                  className={selectClass}
                  value={requirement.kind}
                  onChange={(e) =>
                    setRequirement({
                      ...requirement,
                      kind: e.target.value as EvidenceKind,
                    })
                  }
                >
                  <option value="license">License</option>
                  <option value="insurance">Insurance</option>
                </select>
              </Field>
              <Field id="requirement-version" label="Requirement version">
                <Input
                  id="requirement-version"
                  value={requirement.version}
                  onChange={(e) =>
                    setRequirement({ ...requirement, version: e.target.value })
                  }
                  placeholder="Reviewed policy version"
                />
              </Field>
              <Field id="requirement-effective-at" label="Effective at">
                <Input
                  id="requirement-effective-at"
                  type="datetime-local"
                  value={requirement.effective_at}
                  onChange={(e) =>
                    setRequirement({
                      ...requirement,
                      effective_at: e.target.value,
                    })
                  }
                />
              </Field>
              <Field
                id="requirement-expires-at"
                label="Requirement expires (optional)"
              >
                <Input
                  id="requirement-expires-at"
                  type="datetime-local"
                  value={requirement.expires_at}
                  onChange={(e) =>
                    setRequirement({
                      ...requirement,
                      expires_at: e.target.value,
                    })
                  }
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  id="requirement-description"
                  label="Requirement description"
                >
                  <Input
                    id="requirement-description"
                    value={requirement.description}
                    onChange={(e) =>
                      setRequirement({
                        ...requirement,
                        description: e.target.value,
                      })
                    }
                    placeholder="State the reviewed evidence requirement"
                  />
                </Field>
              </div>
              <Button
                className="sm:col-span-2 sm:w-fit"
                disabled={
                  busy ||
                  !requirement.effective_at ||
                  !requirement.service_id ||
                  !requirement.zip_code ||
                  !requirement.version.trim() ||
                  !requirement.description.trim()
                }
                onClick={() => void createRequirement().catch(() => undefined)}
              >
                Record requirement
              </Button>
            </CardContent>
          </Card>
          <section className="rounded-xl border bg-muted/30 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Finalize strict matching</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {data.control.enforced
                    ? "Strict matching is active. Legacy flags cannot admit a provider."
                    : "Every participating provider needs an immutable decision, and every included provider needs current evidence."}
                </p>
              </div>
              {data.control.enforced ? (
                <Badge className="w-fit">
                  <CheckCircle2 />
                  Finalized
                </Badge>
              ) : (
                <ConfirmAction
                  disabled={busy || !ready}
                  requireReason
                  confirmationTone="commitment"
                  triggerLabel="Finalize cutover"
                  title="Enable strict provider matching?"
                  entity={`${participating.length} participating providers`}
                  consequence="Matching will require an included cutover decision and current onboarding, license, and insurance evidence. This cannot be disabled from the browser."
                  confirmLabel="Finalize strict matching"
                  onConfirm={finalize}
                />
              )}
            </div>
            {!data.control.enforced && !ready && (
              <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">
                Resolve {undecided} undecided and {incomplete} incomplete
                provider{undecided + incomplete === 1 ? "" : "s"} before
                finalization.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold",
          tone === "success" && "text-emerald-700 dark:text-emerald-300",
          tone === "warning" && "text-amber-700 dark:text-amber-300",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
function Status({ provider }: { provider: Provider }) {
  const label =
    provider.decision ??
    (provider.generic_current && provider.scoped_current
      ? "Ready"
      : "Needs review");
  return (
    <Badge variant={provider.decision === "included" ? "secondary" : "outline"}>
      {label}
    </Badge>
  );
}
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
function State({
  icon: Icon,
  title,
  detail,
  action,
  spin,
}: {
  icon: typeof AlertCircle;
  title: string;
  detail?: string;
  action?: ReactNode;
  spin?: boolean;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Icon
          className={cn(
            "mx-auto h-9 w-9 text-muted-foreground",
            spin && "animate-spin",
          )}
        />
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        {detail && (
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
