"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { adminActionError } from "@/lib/adminOperations";

/**
 * DEC-2026-057 item 2: CFG-002 keeps every catalog service visible. Hiding one takes a reason and
 * the owner's approval note; restoring takes a reason. Both are recorded and bound to the
 * visibility the operator saw, so a change made from an out-of-date list is refused.
 */
export function CatalogVisibility({ service, onChanged }: { service: { id: string; name: string; is_active: boolean }; onChanged: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<{ fingerprint: string; key: string } | null>(null);
  const hiding = service.is_active;
  const ready = reason.trim() && (!hiding || approval.trim());

  const submit = async () => {
    if (!ready || saving) return;
    const fingerprint = JSON.stringify([service.id, service.is_active, reason.trim(), approval.trim()]);
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, key: crypto.randomUUID() };
    setSaving(true);
    setError("");
    const result = await createClient().rpc("admin_set_catalog_service_visibility", {
      p_service: service.id, p_expected_active: service.is_active, p_active: !service.is_active,
      p_reason: reason.trim(), p_owner_approval: hiding ? approval.trim() : null, p_key: key.current.key,
    });
    setSaving(false);
    if (result.error) { setError(adminActionError(result.error, "This service changed since you opened the list — refresh and review it.")); return; }
    key.current = null;
    setOpen(false);
    onChanged(!service.is_active);
  };

  return <>
    <Button variant="outline" size="sm" aria-label={`${hiding ? "Hide" : "Restore"} ${service.name}`} onClick={() => { setReason(""); setApproval(""); setError(""); setOpen(true); }}>{hiding ? "Visible" : "Hidden"}</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{hiding ? `Hide ${service.name}?` : `Restore ${service.name}?`}</DialogTitle>
          <DialogDescription>{hiding ? "Every catalog service stays visible unless the owner approves hiding it (CFG-002). A hidden service can’t be requested." : "The service shows on the site again."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Reason" required>{(control) => <Textarea {...control} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />}</FormField>
          {hiding && <FormField label="Owner approval" required help="Who approved hiding this service, and when.">{(control) => <Textarea {...control} rows={2} maxLength={500} value={approval} onChange={(event) => setApproval(event.target.value)} />}</FormField>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant={hiding ? "destructive" : "default"} disabled={saving || !ready} onClick={() => void submit()}>{saving && <Loader2 className="animate-spin" />}{hiding ? "Hide service" : "Restore service"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
