"use client";
/* eslint-disable @next/next/no-img-element -- Gallery URLs are user-managed assets. */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  assignableOptions,
  fetchPhotoServiceOptions,
  GENERAL_BUSINESS_LABEL,
  photoServiceLabel,
  savePhotoServices,
  type PhotoServiceOption,
} from "@/lib/providerProfile/photoServices";
import { createClient } from "@/lib/supabase/client";

export type PhotoServiceOptions = {
  status: "loading" | "ready" | "error";
  options: PhotoServiceOption[];
  reload: () => void;
};

/** The services this provider's photos can be linked to, as the server reports them. */
export function usePhotoServiceOptions(contractorId: string | null): PhotoServiceOptions {
  const [result, setResult] = useState<{ key: string; contractorId: string; status: "ready" | "error"; options: PhotoServiceOption[] } | null>(null);
  const [version, setVersion] = useState(0);
  const key = `${contractorId}:${version}`;

  useEffect(() => {
    if (!contractorId) return;
    let current = true;
    fetchPhotoServiceOptions(createClient(), contractorId)
      .then((options) => { if (current) setResult({ key, contractorId, status: "ready", options }); })
      .catch((reason) => {
        console.warn("Photo service options are unavailable", reason);
        if (current) setResult((previous) => ({ key, contractorId, status: "error", options: previous?.contractorId === contractorId ? previous.options : [] }));
      });
    return () => { current = false; };
  }, [contractorId, key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  // A reload keeps the last answer on screen until the new one arrives.
  if (!result || result.contractorId !== contractorId) return { status: "loading", options: [], reload };
  return { status: result.key === key || result.status === "ready" ? result.status : "loading", options: result.options, reload };
}

export function ServiceChecklist({ legend, options, selected, onChange, disabled }: {
  legend: string;
  options: readonly PhotoServiceOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return <fieldset className="min-w-0" disabled={disabled}>
    <legend className="text-sm font-medium">{legend}</legend>
    <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
      {options.map((option) => <Checkbox
        key={option.service_id}
        label={option.is_applicable ? option.service_name : `${option.service_name} (no longer offered)`}
        className="[overflow-wrap:anywhere]"
        checked={selected.includes(option.service_id)}
        onChange={(event) => onChange(event.target.checked
          ? [...selected, option.service_id]
          : selected.filter((id) => id !== option.service_id))}
      />)}
    </div>
  </fieldset>;
}

function OptionsRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
    <p>{message}</p>
    <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0" onClick={onRetry}>Try again</Button>
  </div>;
}

/** Chosen before adding photos. Every photo in the batch is saved with these services. */
export function NewPhotoServicePicker({ services, selected, onChange, disabled }: {
  services: PhotoServiceOptions;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const options = assignableOptions(services.options);
  return <div data-new-photo-services className="mt-4 rounded-xl border bg-muted/20 p-3">
    {services.status === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading services…</p>}
    {services.status === "error" && <OptionsRetry message={`Services could not be loaded. New photos will be saved as ${GENERAL_BUSINESS_LABEL}.`} onRetry={services.reload} />}
    {services.status === "ready" && options.length === 0 && <p className="text-sm text-muted-foreground">No services to choose yet. New photos will be saved as {GENERAL_BUSINESS_LABEL}.</p>}
    {services.status === "ready" && options.length > 0 && <>
      <ServiceChecklist legend="Services for new photos" options={options} selected={selected} onChange={onChange} disabled={disabled} />
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {selected.length === 0
          ? `Nothing selected: new photos will be saved as ${GENERAL_BUSINESS_LABEL}.`
          : `New photos will be saved for: ${photoServiceLabel(selected, options)}.`}
      </p>
    </>}
  </div>;
}

/** Shows what one saved photo is assigned to, and edits it in a dialog. */
export function PhotoServiceEditor({ photoId, imageUrl, photoName, serviceIds, services, onSaved }: {
  photoId: string;
  imageUrl: string;
  photoName: string;
  serviceIds: readonly string[];
  services: PhotoServiceOptions;
  onSaved: (serviceIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = assignableOptions(services.options, serviceIds);

  const edit = () => {
    setDraft([...serviceIds]);
    setError("");
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await savePhotoServices(createClient(), photoId, draft));
      setOpen(false);
    } catch (reason) {
      console.warn("Photo services could not be saved", reason);
      setError("These services could not be saved. The photo is unchanged. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="flex flex-1 flex-col gap-2 border-t bg-background px-3 py-2">
    <p data-photo-services className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
      <span className="font-medium text-foreground">Shown for: </span>{photoServiceLabel(serviceIds, services.options)}
    </p>
    <Button type="button" variant="outline" size="sm" className="mt-auto min-h-11 w-full" aria-label={`Edit services for ${photoName}`} onClick={edit}>Edit services</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Services in this photo</DialogTitle>
          <DialogDescription>Choose every service this photo shows. With none selected, it is a {GENERAL_BUSINESS_LABEL} photo.</DialogDescription>
        </DialogHeader>
        <div className="aspect-[16/9] overflow-hidden rounded-lg bg-secondary">
          <img src={imageUrl} alt={photoName} className="h-full w-full object-contain" />
        </div>
        {services.status === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading services…</p>}
        {services.status === "error" && options.length === 0 && <OptionsRetry message="Services could not be loaded." onRetry={services.reload} />}
        {services.status === "ready" && options.length === 0 && <p className="text-sm text-muted-foreground">No services to choose yet. This photo stays {GENERAL_BUSINESS_LABEL}.</p>}
        {options.length > 0 && <ServiceChecklist legend="Services" options={options} selected={draft} onChange={setDraft} disabled={saving} />}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" className="min-h-11" disabled={saving || options.length === 0} onClick={() => void save()}>
            {saving && <Loader2 aria-hidden="true" className="animate-spin" />}Save services
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
