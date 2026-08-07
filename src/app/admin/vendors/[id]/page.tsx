/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Briefcase,
  CheckCircle2,
  Eye,
  ImageIcon,
  Link2,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Star,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { ManagedPricingEditor } from "@/components/vendor/ManagedPricingEditor";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type VendorForm = {
  id: string;
  name: string;
  tagline: string | null;
  bio: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  video_url: string | null;
  logo_url: string | null;
  services: string[];
  badges: string[];
  years_experience: number | null;
  jobs_completed: number | null;
  rating: number | null;
  special_offer: string | null;
  our_promise: string | null;
  verified_specialty: string | null;
  is_active: boolean;
  marketing_enabled: boolean;
};

type GalleryItem = { id: string; image_url: string; caption: string | null; sort_order: number };
type Service = { id: string; name: string };
type CoverageArea = { zip_code: string; city: string; state: string };
type Mode = "loading" | "ready" | "error" | "missing";

const AVAILABLE_BADGES = ["Licensed", "Insured", "Background Checked", "24/7 Available", "Emergency Services", "Eco-Friendly", "Satisfaction Guaranteed", "Top Rated"];
const SAFE_SELECT = "id, name, tagline, bio, location, website, video_url, logo_url, services, badges, years_experience, jobs_completed, rating, special_offer, our_promise, verified_specialty, is_active, marketing_enabled";
const MEDIA_BUCKET = "vendor-media";

export default function AdminVendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<VendorForm | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [serviceZips, setServiceZips] = useState<Set<string>>(new Set());
  const [services, setServices] = useState<Service[]>([]);
  const [areas, setAreas] = useState<CoverageArea[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setMode("loading");
    setError("");
    const supabase = createClient();
    try {
      const [vendorResult, galleryResult, zipResult, serviceResult, areaResult, contactResult] = await Promise.all([
        supabase.from("contractors").select(SAFE_SELECT).eq("id", id).maybeSingle(),
        supabase.from("contractor_gallery").select("id, image_url, caption, sort_order").eq("contractor_id", id).order("sort_order"),
        supabase.from("contractor_service_zips").select("zip_code").eq("contractor_id", id),
        supabase.from("services_catalog").select("id, name").eq("is_active", true).order("name"),
        supabase.from("coverage_areas").select("zip_code, city, state").eq("is_active", true).order("city").order("zip_code"),
        supabase.rpc("get_contractor_contact", { _contractor_id: id }),
      ]);
      const firstError = vendorResult.error ?? galleryResult.error ?? zipResult.error ?? serviceResult.error ?? areaResult.error ?? contactResult.error;
      if (firstError) throw firstError;
      if (!vendorResult.data) {
        setForm(null);
        setMode("missing");
        return;
      }
      const contactRows = (contactResult.data ?? []) as { email: string | null; phone: string | null }[];
      const contact = Array.isArray(contactResult.data) ? contactRows[0] : contactResult.data as { email: string | null; phone: string | null } | null;
      const vendor = vendorResult.data as Omit<VendorForm, "email" | "phone">;
      setForm({ ...vendor, email: contact?.email ?? null, phone: contact?.phone ?? null, services: vendor.services ?? [], badges: vendor.badges ?? [], is_active: Boolean(vendor.is_active), marketing_enabled: Boolean(vendor.marketing_enabled) });
      setGallery((galleryResult.data ?? []) as GalleryItem[]);
      setServiceZips(new Set(((zipResult.data ?? []) as { zip_code: string }[]).map((row) => row.zip_code)));
      setServices((serviceResult.data ?? []) as Service[]);
      setAreas((areaResult.data ?? []) as CoverageArea[]);
      setMode("ready");
    } catch (reason) {
      console.error("Unable to load vendor profile", reason);
      setError(reason instanceof Error ? reason.message : "The vendor profile could not be loaded.");
      setMode("error");
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const update = (patch: Partial<VendorForm>) => setForm((current) => current ? { ...current, ...patch } : current);

  const uploadMedia = async (file: File, kind: "logo" | "gallery") => {
    if (!form) return null;
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Images must be smaller than 10 MB.");
    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${form.id}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${extension}`;
    const supabase = createClient();
    const upload = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (upload.error) throw upload.error;
    const signed = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("The image link could not be created.");
    return signed.data.signedUrl;
  };

  const changeLogo = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadMedia(file, "logo");
      if (url) update({ logo_url: url });
      toast.success("Logo uploaded", { description: "Publish changes to save it to the vendor profile." });
    } catch (reason) {
      toast.error("Logo upload failed", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally { setUploading(false); }
  };

  const addGallery = async (files: FileList) => {
    if (!form) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const imageUrl = await uploadMedia(file, "gallery");
        if (!imageUrl) continue;
        const result = await createClient().from("contractor_gallery").insert({ contractor_id: form.id, image_url: imageUrl, sort_order: gallery.length }).select("id, image_url, caption, sort_order").single();
        if (result.error) throw result.error;
        setGallery((current) => [...current, result.data as GalleryItem]);
      }
      toast.success("Gallery updated");
    } catch (reason) {
      toast.error("Gallery upload failed", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally { setUploading(false); }
  };

  const removeGallery = async (item: GalleryItem) => {
    if (!window.confirm("Remove this image from the vendor gallery?")) return;
    const result = await createClient().from("contractor_gallery").delete().eq("id", item.id);
    if (result.error) return toast.error("Image could not be removed", { description: result.error.message });
    setGallery((current) => current.filter((image) => image.id !== item.id));
    toast.success("Image removed");
  };

  const saveCaption = async (item: GalleryItem, caption: string) => {
    setGallery((current) => current.map((image) => image.id === item.id ? { ...image, caption } : image));
    const result = await createClient().from("contractor_gallery").update({ caption: caption.trim() || null }).eq("id", item.id);
    if (result.error) toast.error("Caption could not be saved", { description: result.error.message });
  };

  const save = async () => {
    if (!form || !id) return;
    if (!form.name.trim()) return toast.error("Business name is required.");
    setSaving(true);
    const supabase = createClient();
    try {
      const vendorResult = await supabase.from("contractors").update({
        name: form.name.trim(), tagline: clean(form.tagline), bio: clean(form.bio), location: clean(form.location), email: clean(form.email), phone: clean(form.phone), website: clean(form.website), video_url: clean(form.video_url), logo_url: clean(form.logo_url), services: form.services, badges: form.badges, years_experience: form.years_experience, jobs_completed: form.jobs_completed, rating: form.rating, special_offer: clean(form.special_offer), our_promise: clean(form.our_promise), verified_specialty: clean(form.verified_specialty), is_active: form.is_active, marketing_enabled: form.marketing_enabled,
      }).eq("id", id);
      if (vendorResult.error) throw vendorResult.error;
      const clearZips = await supabase.from("contractor_service_zips").delete().eq("contractor_id", id);
      if (clearZips.error) throw clearZips.error;
      if (serviceZips.size) {
        const insertZips = await supabase.from("contractor_service_zips").insert(Array.from(serviceZips).map((zip_code) => ({ contractor_id: id, zip_code })));
        if (insertZips.error) throw insertZips.error;
      }
      toast.success("Profile published", { description: "Vendor details and service coverage are now live." });
      await load();
    } catch (reason) {
      toast.error("Profile could not be fully published", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally { setSaving(false); }
  };

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <Failure message={error} retry={() => void load()} />;
  if (mode === "missing" || !form) return <Missing />;

  return (
    <div className="min-h-full bg-background pb-20">
      <div className="sticky top-16 z-10 border-b bg-background/95 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 md:px-8"><Link href="/admin/vendors" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />Back to Vendors</Link><div className="flex flex-wrap items-center gap-2"><Link href={`/providers/${form.id}`} target="_blank" className={buttonVariants({ variant: "outline", size: "sm" })}><Eye />Preview Storefront</Link><Toggle checked={form.is_active} onChange={(checked) => update({ is_active: checked })} label={form.is_active ? "Active" : "Hidden"} /><Button disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? "Publishing..." : "Publish"}</Button></div></div></div>

      <section className="border-b bg-gradient-to-br from-primary/8 via-background to-accent/8"><div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:px-6 md:px-8"><div className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="flex h-full w-full items-center justify-center">{form.logo_url ? <img src={form.logo_url} alt={`${form.name} logo`} className="h-full w-full object-contain" /> : <span className="text-3xl font-bold text-muted-foreground">{form.name.charAt(0)}</span>}</div><button type="button" disabled={uploading} onClick={() => logoInput.current?.click()} className="absolute inset-0 flex items-center justify-center bg-black/65 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"><Upload className="mr-1 h-4 w-4" />Change</button><input ref={logoInput} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void changeLogo(file); event.target.value = ""; }} /></div><div className="w-full flex-1 space-y-3"><Input value={form.name} onChange={(event) => update({ name: event.target.value })} className="h-12 bg-card text-2xl font-semibold" placeholder="Business name" /><Input value={form.tagline ?? ""} onChange={(event) => update({ tagline: event.target.value })} className="bg-card" placeholder="Short vendor tagline" /><div className="grid gap-3 sm:grid-cols-3"><IconField icon={MapPin}><Input value={form.location ?? ""} onChange={(event) => update({ location: event.target.value })} placeholder="Location" /></IconField><IconField icon={Star}><Input type="number" min="0" max="5" step="0.1" value={form.rating ?? ""} onChange={(event) => update({ rating: optionalNumber(event.target.value) })} placeholder="Rating" /></IconField><IconField icon={Briefcase}><Input type="number" min="0" value={form.jobs_completed ?? ""} onChange={(event) => update({ jobs_completed: optionalInteger(event.target.value) })} placeholder="Jobs" /></IconField></div></div></div></section>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-3 md:px-8"><div className="space-y-6 md:col-span-2"><Card><CardHeader><CardTitle>About</CardTitle><CardDescription>Business details visible to homeowners and used by operations.</CardDescription></CardHeader><CardContent className="space-y-4"><Field label="Business description"><textarea rows={5} value={form.bio ?? ""} onChange={(event) => update({ bio: event.target.value })} placeholder="Tell homeowners about this vendor..." className={textareaClass} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Years of experience"><Input type="number" min="0" value={form.years_experience ?? ""} onChange={(event) => update({ years_experience: optionalInteger(event.target.value) })} /></Field><Field label="Website"><Input type="url" value={form.website ?? ""} onChange={(event) => update({ website: event.target.value })} placeholder="https://..." /></Field><Field label="Email"><Input type="email" value={form.email ?? ""} onChange={(event) => update({ email: event.target.value })} /></Field><Field label="Phone"><Input value={form.phone ?? ""} onChange={(event) => update({ phone: event.target.value })} /></Field></div></CardContent></Card>

        <Card><CardHeader><CardTitle>Services Offered</CardTitle><CardDescription>Select catalog services this vendor can perform.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-2">{services.length ? services.map((service) => { const checked = form.services.includes(service.id); return <button key={service.id} type="button" onClick={() => update({ services: checked ? form.services.filter((id) => id !== service.id) : [...form.services, service.id] })} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", checked ? "border-accent bg-accent text-accent-foreground" : "border-border bg-muted text-muted-foreground hover:border-accent/50")}>{service.name}</button>; }) : <p className="text-sm text-muted-foreground">No active catalog services are available.</p>}</div></CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" />Credentials</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-2">{AVAILABLE_BADGES.map((badge) => { const checked = form.badges.includes(badge); return <button key={badge} type="button" onClick={() => update({ badges: checked ? form.badges.filter((item) => item !== badge) : [...form.badges, badge] })} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", checked ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-border bg-muted text-muted-foreground hover:border-emerald-300")}>{badge}</button>; })}</div></CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Award className="h-4 w-4" />Stand Out</CardTitle><CardDescription>Optional promotion and trust messaging shown with this provider.</CardDescription></CardHeader><CardContent className="space-y-4"><Field label="Special offer"><Input value={form.special_offer ?? ""} onChange={(event) => update({ special_offer: event.target.value })} placeholder='"15% off first service"' /></Field><Field label="Our promise"><Input value={form.our_promise ?? ""} onChange={(event) => update({ our_promise: event.target.value })} placeholder='"Done right or we come back free"' /></Field><Field label="Verified specialty"><Input value={form.verified_specialty ?? ""} onChange={(event) => update({ verified_specialty: event.target.value })} placeholder='"Pet-safe products only"' /></Field><Field label="Promotional video URL"><Input value={form.video_url ?? ""} onChange={(event) => update({ video_url: event.target.value })} placeholder="YouTube or Vimeo URL" /></Field></CardContent></Card>

        <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><ImageIcon className="h-4 w-4" />Before &amp; After Gallery</CardTitle><CardDescription>Operationally managed public portfolio images.</CardDescription></div><Button variant="outline" size="sm" disabled={uploading} onClick={() => galleryInput.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Plus />}Add Photos</Button><input ref={galleryInput} hidden type="file" accept="image/*" multiple onChange={(event) => { if (event.target.files?.length) void addGallery(event.target.files); event.target.value = ""; }} /></div></CardHeader><CardContent>{gallery.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No gallery photos have been uploaded.</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{gallery.map((item) => <div key={item.id} className="space-y-2"><div className="group relative aspect-square overflow-hidden rounded-xl bg-muted"><img src={item.image_url} alt={item.caption || "Vendor project"} className="h-full w-full object-cover" /><button type="button" onClick={() => void removeGallery(item)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label="Remove image"><Trash2 className="h-4 w-4" /></button></div><Input defaultValue={item.caption ?? ""} onBlur={(event) => void saveCaption(item, event.target.value)} placeholder="Caption" className="h-8 text-xs" /></div>)}</div>}</CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4" />Managed Pricing</CardTitle><CardDescription>Activate Mercurius templates and publish provider-backed prices used by the public catalog.</CardDescription></CardHeader><CardContent><ManagedPricingEditor contractorId={id} /></CardContent></Card>
      </div>

      <aside className="space-y-6"><Card><CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" />Service Area</CardTitle><CardDescription>Select supported ZIP codes for matching.</CardDescription></CardHeader><CardContent><div className="max-h-80 space-y-2 overflow-y-auto pr-1">{areas.length ? areas.map((area) => { const checked = serviceZips.has(area.zip_code); return <button key={area.zip_code} type="button" onClick={() => setServiceZips((current) => { const next = new Set(current); if (next.has(area.zip_code)) next.delete(area.zip_code); else next.add(area.zip_code); return next; })} className={cn("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors", checked ? "border-accent bg-accent/10" : "border-border bg-muted/40 text-muted-foreground hover:border-accent/40")}><span><strong>{area.zip_code}</strong><span className="ml-2 text-xs">{area.city}, {area.state}</span></span>{checked && <Badge variant="outline">Covered</Badge>}</button>; }) : <p className="text-sm text-muted-foreground">No active coverage areas have been configured.</p>}</div><p className="mt-3 text-xs text-muted-foreground">{serviceZips.size} ZIP code{serviceZips.size === 1 ? "" : "s"} selected</p></CardContent></Card>

        <Card><CardHeader><CardTitle>Visibility</CardTitle></CardHeader><CardContent className="space-y-4"><Setting label="Active on platform" description="Inactive vendors are hidden from directories and matching."><Toggle checked={form.is_active} onChange={(checked) => update({ is_active: checked })} /></Setting><Setting label="Marketing enabled" description="Eligible for featured placements and spotlights."><Toggle checked={form.marketing_enabled} onChange={(checked) => update({ marketing_enabled: checked })} /></Setting></CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" />Vendor Account</CardTitle><CardDescription>Link an existing authenticated account to this contractor.</CardDescription></CardHeader><CardContent><VendorAccountLink contractorId={id} /></CardContent></Card>
      </aside></main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 py-3 backdrop-blur lg:left-64"><div className="mx-auto flex max-w-7xl justify-end px-4 sm:px-6 md:px-8"><Button disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? "Publishing..." : "Publish Changes"}</Button></div></div>
    </div>
  );
}

function VendorAccountLink({ contractorId }: { contractorId: string }) {
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const result = await createClient().rpc("admin_get_contractor_linked_email", { _contractor_id: contractorId });
    if (result.error) setError(result.error.message); else setLinkedEmail((result.data as string | null) || null);
    setLoading(false);
  }, [contractorId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const link = async () => {
    if (!email.trim()) return; setBusy(true);
    const result = await createClient().rpc("admin_link_contractor_to_user", { _contractor_id: contractorId, _email: email.trim() });
    setBusy(false);
    if (result.error) return toast.error("Account could not be linked", { description: result.error.message });
    toast.success("Account linked", { description: `${email.trim()} now has vendor access for this contractor.` }); setEmail(""); await load();
  };
  const unlink = async () => {
    if (!window.confirm("Unlink this account? The user will lose access to this vendor portal.")) return; setBusy(true);
    const result = await createClient().rpc("admin_unlink_contractor", { _contractor_id: contractorId }); setBusy(false);
    if (result.error) return toast.error("Account could not be unlinked", { description: result.error.message });
    toast.success("Account unlinked"); await load();
  };
  if (loading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" />Loading account...</p>;
  if (error) return <div className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Retry</Button></div>;
  return linkedEmail ? <div className="space-y-3"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /><div className="min-w-0"><p className="text-sm font-medium">Linked account</p><p className="break-all text-sm text-muted-foreground">{linkedEmail}</p><Badge variant="secondary" className="mt-2">Vendor role granted</Badge></div></div><Button variant="outline" className="w-full" disabled={busy} onClick={() => void unlink()}>{busy ? <Loader2 className="animate-spin" /> : <Unlink />}Unlink Account</Button></div> : <div className="space-y-3"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 text-amber-600" /><p className="text-xs text-muted-foreground">No account is linked. The user must already have a Mercurius login before it can be linked.</p></div><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vendor@example.com" /><Button className="w-full" disabled={busy || !email.trim()} onClick={() => void link()}>{busy ? <Loader2 className="animate-spin" /> : <Link2 />}{busy ? "Linking..." : "Link Account"}</Button></div>;
}

const textareaClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
function clean(value: string | null) { return value?.trim() || null; }
function optionalNumber(value: string) { const number = Number(value); return value === "" || !Number.isFinite(number) ? null : number; }
function optionalInteger(value: string) { const number = Number(value); return value === "" || !Number.isFinite(number) ? null : Math.max(0, Math.round(number)); }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function IconField({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) { return <div className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" />{children}</div>; }
function Setting({ label, description, children }: { label: string; description: string; children: ReactNode }) { return <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{label}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>{children}</div>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) { return <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("relative h-6 w-11 rounded-full transition-colors", checked ? "bg-accent" : "bg-muted-foreground/30")}><span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "left-5" : "left-0.5")} /></button>{label}</label>; }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading vendor profile...</span></div>; }
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Vendor profile could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function Missing() { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h1 className="font-heading text-xl font-semibold">Vendor not found</h1><p className="mt-2 text-sm text-muted-foreground">This contractor record does not exist or is no longer available.</p><Link href="/admin/vendors" className={cn(buttonVariants(), "mt-5")}>Return to Vendors</Link></CardContent></Card></div>; }
