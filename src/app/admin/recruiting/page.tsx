"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Mail, RefreshCw, Store, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import {
  invitationReasonLabel,
  listingBlockers,
  notificationStateLabel,
  notificationNeedsConfirmation,
  type InvitationAttention,
  type ListingInventoryItem,
  type NotificationItem,
} from "@/lib/recruitingReadiness";
import { cn } from "@/lib/utils";

// TRACE-105: existing providers reaching their profile through an owner-confirmed contact.
type AccessItem = {
  contractor_id: string;
  name: string;
  email: string;
  account_linked: boolean;
  bound_by_access: boolean;
  attempt_id: string | null;
  mode: "new_account" | "existing_account" | null;
  status: string | null;
  dispatch_state: string | null;
  expires_at: string | null;
  accepted: boolean;
  attention: "uncertain" | "refused" | "awaiting_binding" | "expired" | "link_lapsed" | null;
};

const accessAttentionLabel: Record<NonNullable<AccessItem["attention"]>, string> = {
  uncertain: "Send result unknown — reconcile",
  refused: "Refused: address already has an account",
  awaiting_binding: "Accepted — review and bind",
  expired: "Invitation expired",
  link_lapsed: "3-hour link lapsed without acceptance",
};

function accessStateLabel(item: AccessItem) {
  if (item.bound_by_access) return "Bound — profile setup access";
  if (item.account_linked) return "Linked outside this path";
  if (!item.status) return "Contact confirmed — not prepared";
  if (item.status === "prepared") return "Prepared — nothing sent";
  if (item.status === "submitted")
    return item.dispatch_state === "provider_accepted" ? "Accepted by Auth — delivery not confirmed" : "Send reserved";
  return item.status.charAt(0).toUpperCase() + item.status.slice(1);
}

type Data = {
  access: AccessItem[];
  notifications: NotificationItem[];
  invitations: InvitationAttention[];
  listings: ListingInventoryItem[];
  checkedAt: string;
};

const notificationTone: Record<string, string> = {
  sent: "border-status-success bg-status-success-bg text-status-success",
  acknowledged: "border-border bg-muted text-muted-foreground",
  pending: "border-border bg-muted text-muted-foreground",
  sending: "border-border bg-muted text-muted-foreground",
};

// TRACE-104 (R0.4): the operator's daily recruiting check. Every read and command is
// admin-only in the database; this page only presents it.
export default function AdminRecruitingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [showAllListings, setShowAllListings] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const supabase = createClient();
    try {
      const [notifications, invitations, listings, access] = await Promise.all([
        supabase.rpc("r0_application_notification_overview"),
        supabase.rpc("r0_invitation_attention"),
        supabase.rpc("r0_public_listing_inventory"),
        supabase.rpc("r0_provider_access_queue"),
      ]);
      const failure = notifications.error ?? invitations.error ?? listings.error ?? access.error;
      if (failure) throw failure;
      const read = (value: unknown) => ((value as { items?: unknown[] } | null)?.items ?? []);
      setData({
        access: read(access.data) as AccessItem[],
        notifications: read(notifications.data) as NotificationItem[],
        invitations: read(invitations.data) as InvitationAttention[],
        listings: read(listings.data) as ListingInventoryItem[],
        checkedAt: (notifications.data as { checked_at?: string } | null)?.checked_at ?? new Date().toISOString(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recruiting readiness could not be loaded.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const attention = useMemo(() => data?.notifications.filter((item) => item.needs_attention) ?? [], [data]);
  const visibleNotifications = showAllNotifications ? data?.notifications ?? [] : attention;
  const listed = useMemo(() => data?.listings.filter((item) => item.listable) ?? [], [data]);
  const review = useMemo(
    () => data?.listings.filter((item) => item.test_signal && !item.excluded) ?? [],
    [data],
  );
  const visibleListings = showAllListings ? data?.listings ?? [] : [...review, ...listed.filter((item) => !review.includes(item))];

  if (error) return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 md:p-8"><AdminError title="Recruiting readiness could not be loaded" message={error} retry={() => void load()} /></div>;
  if (!data) return <AdminLoading label="Loading recruiting readiness..." />;

  const resend = async (item: NotificationItem) => {
    const response = await fetch("/api/admin/application-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: item.application_id, confirmUnknown: notificationNeedsConfirmation(item.state) }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string; state?: string } | null;
    await load();
    if (!response.ok) {
      toast.error("Notification was not resent", { description: body?.error ?? body?.message ?? "Refresh and try again." });
      throw new Error(body?.error ?? "Resend refused");
    }
    (body?.state === "sent" ? toast.success : toast.warning)("Resend recorded", { description: body?.message });
  };

  const acknowledge = async (item: NotificationItem, reason: string) => {
    const { error: ackError } = await createClient().rpc("r0_acknowledge_application_notification", {
      p_application: item.application_id,
      p_reason: reason,
    });
    await load();
    if (ackError) {
      toast.error("Not acknowledged", { description: ackError.message });
      throw ackError;
    }
    toast.success("Acknowledged", { description: "The application stays in the queue; no email was sent." });
  };

  const setExcluded = async (item: ListingInventoryItem, excluded: boolean, reason: string) => {
    const { error: listingError } = await createClient().rpc("r0_set_public_listing_exclusion", {
      p_contractor: item.contractor_id,
      p_excluded: excluded,
      p_reason: reason,
    });
    await load();
    if (listingError) {
      toast.error("Listing not changed", { description: listingError.message });
      throw listingError;
    }
    toast.success(excluded ? "Hidden from public listing and matching" : "Exclusion removed", {
      description: "No record or history was deleted.",
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Vendor operations</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Recruiting readiness</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Daily check for missed application emails, invitations that need follow-up and what the public can see.
            Checked {formatDateTime(data.checkedAt)}.
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => void load()}><RefreshCw />Refresh</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="Application emails needing attention" value={attention.length} alert={attention.length > 0} />
        <Summary label="Invitations needing follow-up" value={data.invitations.length} alert={data.invitations.length > 0} />
        <Summary label="Providers listed publicly" value={listed.length} note={review.length ? `${review.length} to review` : undefined} alert={review.length > 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Mail className="h-5 w-5 text-accent" />Application emails</CardTitle>
          <CardDescription>
            Every saved application stays in the queue whatever happens to its email. “Sent” means Resend accepted it, not that it reached the inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle shown={showAllNotifications} onChange={setShowAllNotifications} all={data.notifications.length} label="applications" />
          {visibleNotifications.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {showAllNotifications ? "No vendor applications yet." : "No application emails need attention."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {visibleNotifications.map((item) => (
                <li key={item.application_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-medium">{item.business_name}</p>
                      <Badge className={cn("border", notificationTone[item.state] ?? "border-status-warning bg-status-warning-bg text-status-warning")}>
                        {notificationStateLabel[item.state] ?? item.state}
                      </Badge>
                      <Badge variant="outline" className="capitalize">{item.application_status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Submitted {formatDateTime(item.submitted_at)} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}
                      {item.sent_at ? ` · accepted ${formatDateTime(item.sent_at)}` : ""}
                      {item.acknowledged_at ? ` · acknowledged ${formatDateTime(item.acknowledged_at)}` : ""}
                    </p>
                    {item.last_error && <p className="mt-1 break-words text-xs text-destructive">{item.last_error}</p>}
                    {item.acknowledged_reason && <p className="mt-1 break-words text-xs text-muted-foreground">Reason: {item.acknowledged_reason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/applications?application=${item.application_id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-muted">
                      <Eye className="h-4 w-4" />Open application
                    </Link>
                    {item.needs_attention && (
                      <>
                        <ConfirmAction
                          triggerLabel="Resend email"
                          title="Resend the owner email?"
                          entity={item.business_name}
                          consequence={notificationNeedsConfirmation(item.state)
                            ? "An earlier email may already have arrived. Resend only after checking the owner inbox and the Resend log. This sends one owner email; it creates no application, account or access."
                            : "Sends one owner email for this saved application. It creates no application, account or access."}
                          confirmLabel="Resend"
                          confirmationTone="commitment"
                          onConfirm={() => resend(item)}
                        />
                        <ConfirmAction
                          triggerLabel="Acknowledge"
                          title="Acknowledge without email?"
                          entity={item.business_name}
                          consequence="Records that you have seen this application in the queue, so no email is needed. Nothing is sent."
                          confirmLabel="Acknowledge"
                          confirmationTone="commitment"
                          requireReason
                          onConfirm={(reason) => acknowledge(item, reason)}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><UserPlus className="h-5 w-5 text-accent" />Provider invitations</CardTitle>
          <CardDescription>
            Account invitations go through Supabase Auth, separately from application emails. Reconcile, revoke or prepare a new invitation from the application&apos;s Provider invitation panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.invitations.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No invitations need follow-up.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {data.invitations.map((item) => (
                <li key={item.attempt_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-medium">{item.business_name}</p>
                      <Badge className="border border-status-warning bg-status-warning-bg text-status-warning">{invitationReasonLabel[item.reason].title}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {invitationReasonLabel[item.reason].help} Prepared {formatDateTime(item.created_at)} · expires {formatDateTime(item.expires_at)}.
                    </p>
                  </div>
                  <Link href={`/admin/applications?application=${item.application_id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-muted">
                    Open invitation<ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><UserPlus className="h-5 w-5 text-accent" />Existing provider access</CardTitle>
          <CardDescription>
            Existing profiles without an application reach their owner through an owner-confirmed contact. Sent means accepted by Auth, not
            delivered. Binding gives profile-setup access only; approval, listing and work stay separate. Act from the provider&apos;s profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.access.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No existing provider has a confirmed contact yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {data.access.map((item) => (
                <li key={item.contractor_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-medium">{item.name}</p>
                      <Badge variant="outline">{accessStateLabel(item)}</Badge>
                      {item.attention && (
                        <Badge className="border border-status-warning bg-status-warning-bg text-status-warning">{accessAttentionLabel[item.attention]}</Badge>
                      )}
                    </div>
                    <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                      {item.email}
                      {item.expires_at ? ` · expires ${formatDateTime(item.expires_at)}` : ""}
                    </p>
                  </div>
                  <Link href={`/admin/vendors/${item.contractor_id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-muted">
                    Open profile<ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Store className="h-5 w-5 text-accent" />Public listings</CardTitle>
          <CardDescription>
            A provider is public only when approved and eligible, active, accepting work, and has a name, description and a live catalog service.
            Hiding a test or duplicate record also removes it from matching. Nothing is deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle shown={showAllListings} onChange={setShowAllListings} all={data.listings.length} label="providers" />
          {visibleListings.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {showAllListings ? "No provider records." : "No provider is listed publicly and none is flagged for review."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {visibleListings.map((item) => {
                const blockers = listingBlockers(item);
                const history = item.request_count + item.invoice_count + item.review_count;
                return (
                  <li key={item.contractor_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words font-medium">{item.name || "Unnamed provider"}</p>
                        {item.listable
                          ? <Badge className="border border-status-success bg-status-success-bg text-status-success">Listed</Badge>
                          : <Badge variant="outline">Not listed</Badge>}
                        {item.test_signal && !item.excluded && <Badge className="border border-status-warning bg-status-warning-bg text-status-warning">Looks like a test record</Badge>}
                        {item.featured && <Badge variant="secondary">Featured placement</Badge>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {blockers.length ? blockers.join(" · ") : "Meets every listing requirement."}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        History: {item.request_count} request{item.request_count === 1 ? "" : "s"}, {item.invoice_count} invoice{item.invoice_count === 1 ? "" : "s"}, {item.review_count} review{item.review_count === 1 ? "" : "s"}
                        {history > 0 ? " — kept whatever the listing state." : ""}
                      </p>
                      {item.excluded && item.exclusion_reason && <p className="mt-0.5 break-words text-xs text-muted-foreground">Hidden: {item.exclusion_reason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.excluded ? (
                        <ConfirmAction
                          triggerLabel="Remove exclusion"
                          title="Remove the exclusion?"
                          entity={item.name}
                          consequence="The provider becomes eligible for public listing and matching again if it meets every other requirement."
                          confirmLabel="Remove exclusion"
                          confirmationTone="commitment"
                          requireReason
                          onConfirm={(reason) => setExcluded(item, false, reason)}
                        />
                      ) : (
                        <ConfirmAction
                          triggerLabel="Hide as test or duplicate"
                          title="Hide this provider?"
                          entity={item.name}
                          consequence="Removes the provider from public listings, public prices and matching. Records, history and documents are kept."
                          confirmLabel="Hide provider"
                          requireReason
                          onConfirm={(reason) => setExcluded(item, true, reason)}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value, note, alert }: { label: string; value: number; note?: string; alert?: boolean }) {
  return (
    <Card className={cn(alert && "border-status-warning")}>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div><p className="text-sm font-medium">{label}</p>{note && <p className="text-xs text-status-warning">{note}</p>}</div>
        <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function Toggle({ shown, onChange, all, label }: { shown: boolean; onChange: (value: boolean) => void; all: number; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="min-h-11" aria-pressed={shown} onClick={() => onChange(!shown)}>
      {shown ? <EyeOff /> : <Eye />}
      {shown ? "Show only items to review" : `Show all ${all} ${label}`}
    </Button>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
}
