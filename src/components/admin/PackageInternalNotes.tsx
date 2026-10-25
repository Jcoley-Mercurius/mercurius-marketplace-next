"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { draftErrorMessage, INTERNAL_NOTES_LABEL } from "@/lib/packageDrafts";
import type { CorrectablePackage } from "@/lib/packagePriceCorrections";
import { createClient } from "@/lib/supabase/client";

// TRACE-122 (DEC-2026-047 item 1): a package's internal notes are edited in place. They belong
// to the package across its versions, so saving creates no version, needs no republishing and
// notifies no one. Homeowners never see them.

export function PackageInternalNotes({ pkg, onSaved }: { pkg: CorrectablePackage; onSaved: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const current = pkg.internalNotes?.notes ?? "";

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function save() {
    if (pending) return;
    setError("");
    setPending(true);
    const { error: rpcError } = await createClient().rpc("admin_set_package_internal_notes", { p_package: pkg.id, p_notes: notes.trim() });
    setPending(false);
    if (rpcError) { setError(draftErrorMessage(rpcError)); return; }
    setOpen(false);
    toast.success(notes.trim() ? "Internal notes saved" : "Internal notes cleared", { description: "No new version was created and the vendor was not notified." });
    await onSaved();
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) { setNotes(current); setError(""); }
  }}>
    <DialogTrigger render={<Button variant="ghost" className="min-h-10" />}>{current ? "Edit internal notes" : "Add internal notes"}</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Internal notes</DialogTitle>
        <DialogDescription>{pkg.contractorName} · {pkg.name}. For Mercurius only and kept with every version of this package. Saving creates no new version, needs no republishing and does not notify the vendor.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <FormField id={`internal-notes-${pkg.id}`} label={INTERNAL_NOTES_LABEL} help="Up to 2000 characters. Leave empty to remove them.">
          {(control) => <Textarea {...control} value={notes} maxLength={2000} disabled={pending} onChange={(event) => setNotes(event.target.value)} />}
        </FormField>
        {pkg.internalNotes?.updatedAt && <p className="text-xs text-muted-foreground">Last changed {new Date(pkg.internalNotes.updatedAt).toLocaleString()}{pkg.internalNotes.updatedByEmail ? ` by ${pkg.internalNotes.updatedByEmail}` : ""}.</p>}
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Saving internal notes…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void save()}>{pending ? "Saving…" : "Save notes"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
