"use client";
/* eslint-disable @next/next/no-img-element -- User-managed portfolio assets. */

import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhotoServiceEditor, ServiceChecklist, type PhotoServiceOptions } from "./PhotoServiceAssignment";
import { assignableOptions, photoServiceLabel, type GalleryPhoto } from "@/lib/providerProfile/photoServices";
import { fetchGalleryPairs, filterGallery, orderedPhotos, withGalleryPairs, type GalleryPair } from "@/lib/providerProfile/galleryManagement";
import { createClient } from "@/lib/supabase/client";

const selectClass = "min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const failure = (reason: unknown) => (reason as { code?: string })?.code === "40001"
  ? "The gallery changed elsewhere. Your edits are kept here. Reload before trying again."
  : "This change could not be saved. Your edits are kept here. Please try again.";

function CaptionEditor({ photo, disabled, onSave }: { photo: GalleryPhoto; disabled: boolean; onSave: (caption: string) => Promise<void> }) {
  const [draft, setDraft] = useState(photo.caption ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const dirty = draft !== (photo.caption ?? "");
  return <form className="space-y-2" onSubmit={async (event) => {
    event.preventDefault();
    if (saving || disabled || !dirty) return;
    setSaving(true); setError("");
    try { await onSave(draft); setDraft(draft.trim()); } catch (reason) { setError(failure(reason)); } finally { setSaving(false); }
  }}>
    <Label htmlFor={id}>Caption</Label>
    <Input id={id} value={draft} maxLength={500} disabled={disabled || saving} aria-describedby={`${id}-status`} onChange={(event) => setDraft(event.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="outline" size="sm" className="min-h-10" disabled={disabled || saving || !dirty}>{saving ? "Saving…" : "Save caption"}</Button>
      <Button type="button" variant="ghost" size="sm" className="min-h-10" disabled={disabled || saving || !dirty} onClick={() => { setDraft(photo.caption ?? ""); setError(""); }}>Cancel</Button>
    </div>
    <p id={`${id}-status`} role={error ? "alert" : "status"} className="text-sm text-muted-foreground">{error || (saving ? "Saving caption…" : dirty ? "Unsaved caption." : "Caption saved.")}</p>
  </form>;
}

/** One management surface in both portals. Scope and authority are rechecked by each RPC. */
export function GalleryManager({ contractorId, photos, services, onChange, onRemove, onBusyChange, disabled = false }: {
  contractorId: string;
  photos: GalleryPhoto[];
  services: PhotoServiceOptions;
  onChange: Dispatch<SetStateAction<GalleryPhoto[]>>;
  onBusyChange: (busy: boolean) => void;
  onRemove: (photo: GalleryPhoto) => Promise<void>;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [mode, setMode] = useState("add");
  const [bulkServices, setBulkServices] = useState<string[]>([]);
  const [pairs, setPairs] = useState<GalleryPair[]>([]);
  const [pairsState, setPairsState] = useState<"loading" | "ready" | "error">("loading");
  const [pairVersion, setPairVersion] = useState(0);
  const [pairOpen, setPairOpen] = useState(false);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [title, setTitle] = useState("");
  const prefix = useId();
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const photoKey = photos.map((photo) => photo.id).sort().join(",");

  useEffect(() => {
    let current = true;
    fetchGalleryPairs(contractorId).then((result) => {
      if (!current) return;
      if (result === null) { setPairsState("error"); return; }
      setPairs(result); setPairsState("ready");
    }).catch(() => { if (current) setPairsState("error"); });
    return () => { current = false; };
  }, [contractorId, photoKey, pairVersion]);

  const sorted = orderedPhotos(photos);
  const visible = filterGallery(photos, filter);
  const chosen = selected.filter((id) => photos.some((p) => p.id === id));
  const selectedPhotos = sorted.filter((p) => chosen.includes(p.id));
  const options = assignableOptions(services.options);
  const paired = withGalleryPairs(sorted, pairs);
  const blocked = busy || disabled;

  async function run(action: () => Promise<void>, message: string) {
    if (lock.current || disabled) throw new Error("Another gallery change is in progress.");
    lock.current = true; setBusy(true); setError(""); setStatus("");
    try { await action(); setStatus(message); }
    catch (reason) { setError(failure(reason)); throw reason; }
    finally { lock.current = false; setBusy(false); }
  }

  async function move(photo: GalleryPhoto, direction: number) {
    const ids = sorted.map((p) => p.id);
    const position = ids.indexOf(photo.id);
    const next = [...ids];
    [next[position], next[position + direction]] = [next[position + direction], next[position]];
    await run(async () => {
      const { data, error } = await createClient().rpc("reorder_contractor_gallery", { p_contractor_id: contractorId, p_expected_ids: ids, p_ordered_ids: next });
      if (error) throw error;
      if (!data || data.length !== ids.length || data.some((id: string, index: number) => id !== next[index])) throw new Error("Order readback unavailable");
      onChange(data.map((id: string, sort_order: number) => ({ ...photos.find((p) => p.id === id)!, sort_order })));
    }, "Photo order saved.");
  }

  const safe = (promise: Promise<void>) => { void promise.catch(() => {}); };
  return <div data-gallery-manager className="min-w-0 space-y-4">
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <Label htmlFor={`${prefix}-filter`}>Filter photos</Label>
      <select id={`${prefix}-filter`} className={selectClass} value={filter} disabled={blocked} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">All photos ({photos.length})</option>
        <option value="general">General business ({photos.filter((p) => !p.service_ids.length).length})</option>
        {services.options.map((s) => <option key={s.service_id} value={s.service_id}>{s.service_name}{s.is_applicable ? "" : " (no longer offered)"} ({photos.filter((p) => p.service_ids.includes(s.service_id)).length})</option>)}
      </select>
      <p className="text-sm text-muted-foreground">Selections stay selected when you change the filter. Up to 100 photos per bulk edit.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-10" disabled={blocked || !visible.length || new Set([...chosen, ...visible.map((p) => p.id)]).size > 100} onClick={() => setSelected([...new Set([...chosen, ...visible.map((p) => p.id)])])}>Select visible photos</Button>
        <Button type="button" variant="ghost" className="min-h-10" disabled={blocked || !chosen.length} onClick={() => setSelected([])}>Clear selection</Button>
        <Button type="button" variant="outline" className="min-h-10" disabled={blocked || !chosen.length || services.status !== "ready"} onClick={() => { setMode("add"); setBulkServices([]); setError(""); setBulkOpen(true); }}>Edit selected services</Button>
        <Button type="button" variant="outline" className="min-h-10" disabled={blocked || chosen.length !== 2 || pairsState !== "ready" || chosen.some((id) => pairs.some((p) => p.before_id === id || p.after_id === id))} onClick={() => { setBeforeId(selectedPhotos[0].id); setAfterId(selectedPhotos[1].id); setTitle(""); setError(""); setPairOpen(true); }}>Pair before and after</Button>
      </div>
      <p role="status" className="text-sm">{chosen.length} selected · {visible.length} shown</p>
    </div>
    {pairsState === "error" && <div role="alert" className="space-y-2 text-sm"><p>Before and after projects could not be loaded. Photos are still available.</p><Button type="button" variant="outline" onClick={() => { setPairsState("loading"); setPairVersion((v) => v + 1); }}>Retry projects</Button></div>}
    <p role="status" className="text-sm text-muted-foreground">{busy ? "Saving gallery…" : status}</p>
    {error && !bulkOpen && !pairOpen && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {photos.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No gallery photos have been uploaded.</p> : !visible.length ? <p className="py-4 text-sm text-muted-foreground">No photos match this filter.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((photo) => {
        const details = paired.find((p) => p.id === photo.id);
        const position = sorted.findIndex((p) => p.id === photo.id);
        const name = photo.caption || `Photo ${position + 1}`;
        return <fieldset key={photo.id} disabled={blocked} data-gallery-photo={photo.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-3">
          <legend className="px-1 text-sm font-medium">Photo {position + 1}</legend>
          <Checkbox label={`Select ${name}`} checked={chosen.includes(photo.id)} disabled={blocked || (!chosen.includes(photo.id) && chosen.length >= 100)} onChange={(event) => setSelected(event.target.checked ? [...chosen, photo.id] : chosen.filter((id) => id !== photo.id))} />
          <div className="aspect-[4/3] overflow-hidden rounded-lg bg-secondary"><img src={photo.image_url} alt={name} className="h-full w-full object-contain" /></div>
          <CaptionEditor key={photo.id} photo={photo} disabled={blocked} onSave={(caption) => run(async () => {
            const { data, error } = await createClient().rpc("save_contractor_gallery_caption", { p_gallery_id: photo.id, p_caption: caption, p_expected_caption: photo.caption });
            if (error) throw error;
            onChange((current) => current.map((p) => p.id === photo.id ? { ...p, caption: data } : p));
          }, "Caption saved.")} />
          <div className="overflow-hidden rounded-lg border"><PhotoServiceEditor photoId={photo.id} imageUrl={photo.image_url} photoName={name} serviceIds={photo.service_ids} services={services} onSaved={(serviceIds) => onChange((current) => current.map((p) => p.id === photo.id ? { ...p, service_ids: serviceIds } : p))} /></div>
          {details?.pair_id && <div className="space-y-1 text-sm"><p><strong>{details.pair_role === "before" ? "Before" : "After"}:</strong> {details.project_title}</p><Button type="button" variant="outline" className="min-h-10" disabled={blocked} onClick={() => {
            if (!window.confirm("Remove this before and after pairing? Both photos will stay in the gallery.")) return;
            safe(run(async () => { const { error } = await createClient().rpc("remove_contractor_gallery_pair", { p_pair_id: details.pair_id! }); if (error) throw error; setPairs((p) => p.filter((item) => item.id !== details.pair_id)); }, "Pair removed. Both photos remain."));
          }}>Unpair project</Button></div>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-10" disabled={blocked || position === 0} aria-label={`Move ${name} earlier`} onClick={() => safe(move(photo, -1))}><ArrowUp className="size-4" />Earlier</Button>
            <Button type="button" variant="outline" className="min-h-10" disabled={blocked || position === sorted.length - 1} aria-label={`Move ${name} later`} onClick={() => safe(move(photo, 1))}><ArrowDown className="size-4" />Later</Button>
            <Button type="button" variant="ghost" className="min-h-10" disabled={blocked} aria-label={`Remove ${name}`} onClick={() => safe(run(() => onRemove(photo), "Photo removal finished."))}><Trash2 className="size-4" />Remove</Button>
          </div>
        </fieldset>;
      })}
    </div>}
    <Dialog open={bulkOpen} onOpenChange={(open) => { if (!busy) setBulkOpen(open); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Edit services for {chosen.length} photos</DialogTitle><DialogDescription>Review your selection. This changes photo labels only; it does not change the services the business offers.</DialogDescription></DialogHeader>
      <Label htmlFor={`${prefix}-mode`}>Assignment action</Label><select id={`${prefix}-mode`} value={mode} disabled={busy} className={selectClass} onChange={(event) => setMode(event.target.value)}><option value="add">Add services to existing labels</option><option value="replace">Replace all existing service labels</option><option value="clear">Clear labels: General business</option></select>
      {mode !== "clear" && <ServiceChecklist legend="Services to assign" options={options} selected={bulkServices} onChange={setBulkServices} disabled={busy} />}
      <p className="text-sm">{mode === "clear" ? "Every selected photo will become General business." : `${mode === "replace" ? "Replace existing labels with" : "Add"}: ${photoServiceLabel(bulkServices, options)}.`}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setBulkOpen(false)}>Cancel</Button><Button type="button" disabled={busy || !chosen.length || (mode !== "clear" && !bulkServices.length)} onClick={() => safe(run(async () => {
        const { data, error } = await createClient().rpc("bulk_contractor_gallery_services", { p_contractor_id: contractorId, p_gallery_ids: chosen, p_service_ids: mode === "clear" ? [] : bulkServices, p_mode: mode });
        if (error) throw error;
        if (!data || data.length !== chosen.length) throw new Error("Assignment readback unavailable");
        onChange((current) => current.map((photo) => { const saved = data.find((p: { gallery_id: string; service_ids: string[] }) => p.gallery_id === photo.id); return saved ? { ...photo, service_ids: saved.service_ids } : photo; }));
        setBulkOpen(false);
      }, "Selected photo services saved."))}>{busy && <Loader2 className="size-4 animate-spin" />}Save selected services</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={pairOpen} onOpenChange={(open) => { if (!busy) setPairOpen(open); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Pair before and after</DialogTitle><DialogDescription>Choose two photos of the same project. You confirm which shows before and which shows after. Service labels remain unchanged.</DialogDescription></DialogHeader>
      <Label htmlFor={`${prefix}-title`}>Project title</Label><Input id={`${prefix}-title`} maxLength={120} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      <Label htmlFor={`${prefix}-before`}>Before photo</Label><select id={`${prefix}-before`} value={beforeId} disabled={busy} className={selectClass} onChange={(event) => { setBeforeId(event.target.value); setAfterId(selectedPhotos.find((p) => p.id !== event.target.value)?.id ?? ""); }}>{selectedPhotos.map((p) => <option key={p.id} value={p.id}>{p.caption || `Photo ${sorted.indexOf(p) + 1}`}</option>)}</select>
      <div className="grid grid-cols-2 gap-3">{[beforeId, afterId].map((id, index) => <figure key={index} className="min-w-0 space-y-1"><figcaption className="text-sm font-medium">{index === 0 ? "Before" : "After"}</figcaption><div className="aspect-[4/3] rounded-lg bg-secondary"><img src={photos.find((p) => p.id === id)?.image_url} alt={index === 0 ? "Selected before photo" : "Selected after photo"} className="h-full w-full object-contain" /></div></figure>)}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setPairOpen(false)}>Cancel</Button><Button type="button" disabled={busy || !title.trim() || beforeId === afterId || chosen.length !== 2} onClick={() => safe(run(async () => {
        const { data, error } = await createClient().rpc("create_contractor_gallery_pair", { p_contractor_id: contractorId, p_before_id: beforeId, p_after_id: afterId, p_title: title }).single<GalleryPair>();
        if (error) throw error;
        if (!data?.id) throw new Error("Project readback unavailable");
        setPairs((current) => [...current, data]); setPairOpen(false);
      }, "Before and after project saved."))}>Save pair</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
