"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, Plus, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Profile = { id: string; name: string; bio: string | null; location: string | null; services: string[]; years_experience: number | null; special_offer: string | null; our_promise: string | null; phone: string | null; email: string | null };
const textareaClass = "w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";

export default function VendorProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<"loading" | "live" | "preview" | "unlinked">("loading");
  const [newService, setNewService] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadProfile() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from("contractors").select("id, name, bio, location, services, years_experience, special_offer, our_promise, phone, email").eq("user_id", user!.id).maybeSingle();
        if (error) throw error;
        if (!active) return;
        if (!data) { setMode("unlinked"); return; }
        setProfile({ ...data, services: data.services ?? [] });
        setMode("live");
      } catch {
        if (!active) return;
        setProfile({ id: "preview", name: "Your Service Business", bio: "Trusted Southwest Florida home-service professionals focused on reliable scheduling and quality workmanship.", location: "Cape Coral, FL", services: ["Home Maintenance"], years_experience: 5, special_offer: null, our_promise: "Clear communication and work done right.", phone: user!.phone ?? null, email: user!.email ?? null });
        setMode("preview");
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [user]);

  const profileStrength = useMemo(() => {
    if (!profile) return 0;
    const fields = [profile.name, profile.location, profile.bio, profile.services.length > 0, profile.phone, profile.years_experience, profile.special_offer, profile.our_promise];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [profile]);

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => current ? { ...current, [key]: value } : current);
  }

  function addService() {
    const value = newService.trim();
    if (!profile || !value || profile.services.includes(value)) return;
    update("services", [...profile.services, value]);
    setNewService("");
  }

  async function saveProfile() {
    if (!profile || mode !== "live") return;
    if (!profile.name.trim() || !profile.location?.trim() || !profile.bio?.trim() || profile.services.length === 0) {
      toast.error("Complete the essential profile fields");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("contractors").update({ name: profile.name.trim(), bio: profile.bio?.trim() || null, location: profile.location?.trim() || null, services: profile.services, years_experience: profile.years_experience, special_offer: profile.special_offer?.trim() || null, our_promise: profile.our_promise?.trim() || null, phone: profile.phone?.trim() || null, email: profile.email?.trim() || null }).eq("id", profile.id);
      if (error) throw error;
      toast.success("Profile saved", { description: "Your vendor listing has been updated." });
    } catch (error) {
      toast.error("Unable to save profile", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  if (mode === "loading") return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading profile...</div>;
  if (mode === "unlinked") return <div className="mx-auto max-w-lg px-6 py-20 text-center"><AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-xl font-semibold">No vendor profile linked</h1><p className="mt-2 text-sm text-muted-foreground">Your approved contractor record will appear here after onboarding.</p><Link href="/vendors/apply" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>Contact onboarding</Link></div>;
  if (!profile) return null;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 md:p-8">
      <div className="mb-7 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Your Profile</h1><p className="mt-1 text-sm text-muted-foreground">These details shape the business listing homeowners see.</p></div>{mode === "preview" && <Badge className="bg-blue-100 text-blue-800">Preview only</Badge>}</div>

      <Card className="mb-6 border-accent/30 bg-accent/5 ring-accent/20"><CardContent><div className="flex items-center justify-between gap-4"><div><p className="font-medium">Profile strength</p><p className="text-sm text-muted-foreground">Complete profiles help homeowners choose with confidence.</p></div><p className="text-2xl font-bold text-accent">{profileStrength}%</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent" style={{ width: `${profileStrength}%` }} /></div></CardContent></Card>

      <div className="space-y-6">
        <Card><CardHeader><CardTitle>Essentials for your listing</CardTitle><CardDescription>Name, location, bio, and services are the foundation of your public profile.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Business Name *" id="name"><Input id="name" className="h-11" value={profile.name} onChange={(event) => update("name", event.target.value)} /></Field><Field label="Location *" id="location"><Input id="location" className="h-11" value={profile.location ?? ""} onChange={(event) => update("location", event.target.value)} placeholder="Cape Coral, FL" /></Field></div><Field label="Bio / About *" id="bio"><textarea id="bio" rows={5} value={profile.bio ?? ""} onChange={(event) => update("bio", event.target.value)} className={textareaClass} placeholder="Tell homeowners about your business and experience..." /><div className="flex justify-between text-xs text-muted-foreground"><span>{(profile.bio?.length ?? 0) < 80 ? "Aim for at least 80 characters." : "Your bio is a helpful length."}</span><span>{profile.bio?.length ?? 0} characters</span></div></Field><div className="space-y-2"><Label>Services Offered *</Label><div className="flex flex-wrap gap-2">{profile.services.map((service) => <Badge key={service} variant="secondary" className="min-h-8 gap-1 pr-1">{service}<button type="button" onClick={() => update("services", profile.services.filter((item) => item !== service))} aria-label={`Remove ${service}`} className="flex h-7 w-7 items-center justify-center rounded hover:text-destructive"><X className="h-3.5 w-3.5" /></button></Badge>)}</div><div className="flex flex-col gap-2 sm:flex-row"><Input value={newService} onChange={(event) => setNewService(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addService(); } }} placeholder="Add a service" className="h-11" /><Button type="button" variant="outline" onClick={addService} className="h-11"><Plus className="h-4 w-4" />Add</Button></div></div></CardContent></Card>

        <Card><CardHeader><CardTitle>Contact &amp; experience</CardTitle><CardDescription>Help customers and the Mercurius team reach you.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Field label="Email" id="email"><Input id="email" type="email" value={profile.email ?? ""} onChange={(event) => update("email", event.target.value)} /></Field><Field label="Phone" id="phone"><Input id="phone" type="tel" value={profile.phone ?? ""} onChange={(event) => update("phone", event.target.value)} /></Field><Field label="Years of Experience" id="years"><Input id="years" type="number" min={0} value={profile.years_experience ?? ""} onChange={(event) => update("years_experience", Number.parseInt(event.target.value, 10) || null)} /></Field></CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" />Stand Out</CardTitle><CardDescription>Optional details that build trust and give homeowners a reason to choose you.</CardDescription></CardHeader><CardContent className="space-y-5"><Field label="Special Offer" id="offer"><Input id="offer" value={profile.special_offer ?? ""} onChange={(event) => update("special_offer", event.target.value)} placeholder="15% off first service" /></Field><Field label="Our Promise" id="promise"><Input id="promise" value={profile.our_promise ?? ""} onChange={(event) => update("our_promise", event.target.value)} placeholder="Done right or we come back free" /></Field></CardContent></Card>

        <div className="flex justify-end pb-4"><Button onClick={saveProfile} disabled={saving || mode !== "live"} className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent/90 sm:w-auto"><Save className="h-4 w-4" />{saving ? "Saving..." : mode === "preview" ? "Preview cannot be saved" : "Save Changes"}</Button></div>
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>; }
