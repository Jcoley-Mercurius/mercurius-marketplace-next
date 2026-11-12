"use client";

import { useRef, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { ContactSubmissionDetail as Detail } from "@/lib/ownerEmails";

// DEC-2026-066 (O-1): an operator opens one tracked contact submission on demand. Nothing is
// prefetched; the database operator guard decides access; the ID travels in the RPC body,
// never in a URL; closing the dialog discards the content; nothing here is logged.
type View =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; detail: Detail }
  | { status: "error"; message: string };

function refusal(code: string | undefined) {
  if (code === "42501") return "You do not have access to this submission.";
  if (code === "P0002") return "This submission is not tracked or no longer exists.";
  return "The submission could not be loaded. Close this and try again.";
}

export function ContactSubmissionDetail({ sourceId, reference }: { sourceId: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ status: "idle" });
  // A response that arrives after the dialog closed (or reopened) is discarded.
  const request = useRef(0);

  async function load() {
    const ticket = ++request.current;
    setView({ status: "loading" });
    try {
      const { data, error } = await createClient().rpc("owner_email_contact_submission", { p_source: sourceId });
      if (ticket !== request.current) return;
      if (error || !data) setView({ status: "error", message: refusal(error?.code) });
      else setView({ status: "loaded", detail: data as Detail });
    } catch {
      if (ticket === request.current) setView({ status: "error", message: refusal(undefined) });
    }
  }

  function change(next: boolean) {
    setOpen(next);
    request.current += 1;
    if (next) void load();
    else setView({ status: "idle" });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button variant="outline" className="min-h-11" />}>
        <Eye />View submission
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="pr-12">Contact submission</DialogTitle>
        <DialogDescription>Ref {reference}. Stored content, for handling this message only. Don&apos;t copy it into notes or reasons.</DialogDescription>
        {view.status === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading submission…</p>}
        {view.status === "error" && <p role="alert" className="text-sm text-destructive">{view.message}</p>}
        {view.status === "loaded" && (
          <dl className="grid gap-3 text-sm">
            <Field label="Submitted" value={formatDateTime(view.detail.submitted_at)} />
            <Field label="Name" value={`${view.detail.first_name} ${view.detail.last_name ?? ""}`.trim()} />
            <Field label="Email" value={view.detail.email} />
            <Field label="Phone" value={view.detail.phone ?? "Not provided"} />
            <Field label="Subject" value={view.detail.subject} />
            <Field label="Message" value={view.detail.message} multiline />
          </dl>
        )}
        <DialogClose render={<Button variant="outline" className="min-h-11" />}>Close</DialogClose>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={multiline ? "mt-1 whitespace-pre-wrap break-words" : "mt-0.5 break-words"}>{value}</dd>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
}
