/* eslint-disable @next/next/no-img-element -- Vendor media uses signed Supabase Storage URLs. */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Award,
  Building2,
  Camera,
  Eye,
  EyeOff,
  ExternalLink,
  HandHeart,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  PenLine,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  clearVendorPasswordNudgeDismissal,
  PASSWORD_SET_BY_USER_KEY,
} from "@/lib/vendorPasswordNudge";
import {
  removeUploadedVendorMedia,
  uploadVendorMedia,
  validateVendorMediaFile,
  vendorMediaPathFromUrl,
} from "@/lib/vendorMedia";
import { calculateVendorProfileStrength, vendorBioPoints } from "@/lib/vendorProfileStrength";

type Profile = {
  id: string;
  name: string;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  services: string[];
  years_experience: number | null;
  special_offer: string | null;
  our_promise: string | null;
  verified_specialty: string | null;
  is_active: boolean | null;
  marketing_enabled: boolean | null;
};

type PageMode = "loading" | "live" | "unlinked" | "error";

type ContactRow = {
  email: string | null;
  phone: string | null;
};

type GalleryItem = {
  id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
};

type StrengthAction = {
  key: string;
  icon: typeof Tag;
  label: string;
  description: string;
  points: number;
  targetId?: string;
  href?: string;
};

type StrengthCategory = {
  key: "essentials" | "trust" | "visual" | "differentiation";
  label: string;
  earned: number;
  total: number;
  description: string;
  icon: typeof Tag;
};

type StrengthModel = {
  score: number;
  categories: StrengthCategory[];
  actions: StrengthAction[];
};

const textareaClass =
  "w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function VendorProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<PageMode>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [newService, setNewService] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [galleryUploadProgress, setGalleryUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [removingGalleryId, setRemovingGalleryId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setMode("loading");
    setErrorMessage("");

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contractors")
        .select(
          "id, name, logo_url, bio, location, services, years_experience, special_offer, our_promise, verified_specialty, is_active, marketing_enabled",
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setProfile(null);
        setMode("unlinked");
        return;
      }

      const [contactResult, galleryResult] = await Promise.all([
        supabase.rpc("get_contractor_contact", {
          _contractor_id: data.id,
        }),
        supabase
          .from("contractor_gallery")
          .select("id, image_url, caption, sort_order")
          .eq("contractor_id", data.id)
          .order("sort_order"),
      ]);

      if (contactResult.error) throw contactResult.error;
      const contactData = contactResult.data as unknown;
      const contact = (
        Array.isArray(contactData) ? contactData[0] : contactData
      ) as ContactRow | null;

      if (galleryResult.error) throw galleryResult.error;
      setGallery((galleryResult.data ?? []) as GalleryItem[]);

      setProfile({
        ...data,
        services: data.services ?? [],
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
      });
      setMode("live");
    } catch (error) {
      console.error("Unable to load vendor profile", error);
      setProfile(null);
      setGallery([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Your vendor profile could not be loaded.",
      );
      setMode("error");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // Load the contractor record linked to the authenticated vendor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile();
  }, [loadProfile, user]);

  useEffect(() => {
    if (mode !== "live" || !profile || window.location.hash !== "#password") return;
    window.requestAnimationFrame(() => {
      document.getElementById("password")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [mode, profile]);

  const strength = useMemo<StrengthModel>(
    () => buildStrength(profile, gallery.length),
    [gallery.length, profile],
  );

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }

  function focusField(id: string) {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus();
      }
    }, 400);
  }

  function addService() {
    const service = newService.trim();
    if (!profile || !service) return;
    if (
      profile.services.some(
        (existing) => existing.toLowerCase() === service.toLowerCase(),
      )
    ) {
      toast.info("That service is already listed");
      return;
    }
    update("services", [...profile.services, service]);
    setNewService("");
  }

  function removeService(service: string) {
    if (!profile) return;
    update(
      "services",
      profile.services.filter((item) => item !== service),
    );
  }

  async function replaceLogo(file: File) {
    if (!profile || !user || mode !== "live") return;

    try {
      validateVendorMediaFile(file, "logo");
    } catch (error) {
      toast.error("Choose a different logo", {
        description: error instanceof Error ? error.message : "The selected file is not supported.",
      });
      return;
    }

    setUploadingLogo(true);
    let uploadedPath: string | null = null;
    try {
      const previousUrl = profile.logo_url;
      const uploaded = await uploadVendorMedia(profile.id, file, "logo");
      uploadedPath = uploaded.path;

      const result = await createClient()
        .from("contractors")
        .update({ logo_url: uploaded.signedUrl })
        .eq("id", profile.id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (result.error) throw result.error;
      if (!result.data) throw new Error("Your linked contractor profile could not be verified.");

      update("logo_url", uploaded.signedUrl);
      uploadedPath = null;

      const previousPath = previousUrl ? vendorMediaPathFromUrl(previousUrl, profile.id) : null;
      if (previousPath && previousPath !== uploaded.path) {
        try {
          await removeUploadedVendorMedia(previousPath);
        } catch (cleanupError) {
          console.warn("Previous vendor logo could not be removed from Storage", cleanupError);
        }
      }

      toast.success(previousUrl ? "Logo replaced" : "Logo uploaded", {
        description: "Your public vendor profile has been updated.",
      });
    } catch (error) {
      if (uploadedPath) {
        try {
          await removeUploadedVendorMedia(uploadedPath);
        } catch (cleanupError) {
          console.warn("Incomplete vendor logo upload could not be cleaned up", cleanupError);
        }
      }
      toast.error("Logo could not be uploaded", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setUploadingLogo(false);
    }
  }

  async function removeLogo() {
    if (!profile?.logo_url || !user || mode !== "live") return;
    if (!window.confirm("Remove your business logo from the public profile?")) return;

    setRemovingLogo(true);
    try {
      const previousUrl = profile.logo_url;
      const result = await createClient()
        .from("contractors")
        .update({ logo_url: null })
        .eq("id", profile.id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (result.error) throw result.error;
      if (!result.data) throw new Error("Your linked contractor profile could not be verified.");

      update("logo_url", null);
      const path = vendorMediaPathFromUrl(previousUrl, profile.id);
      if (path) {
        try {
          await removeUploadedVendorMedia(path);
        } catch (cleanupError) {
          console.warn("Removed vendor logo could not be deleted from Storage", cleanupError);
        }
      }
      toast.success("Logo removed");
    } catch (error) {
      toast.error("Logo could not be removed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setRemovingLogo(false);
    }
  }

  async function addGalleryImages(files: FileList) {
    if (!profile || !user || mode !== "live") return;
    const selected = Array.from(files);
    if (!selected.length) return;
    if (selected.length > 10) {
      toast.error("Choose up to 10 images at a time.");
      return;
    }

    try {
      selected.forEach((file) => validateVendorMediaFile(file, "gallery"));
    } catch (error) {
      toast.error("Check the selected gallery images", {
        description: error instanceof Error ? error.message : "One or more files are not supported.",
      });
      return;
    }

    const created: GalleryItem[] = [];
    setGalleryUploadProgress({ completed: 0, total: selected.length });
    try {
      for (const [index, file] of selected.entries()) {
        const uploaded = await uploadVendorMedia(profile.id, file, "gallery");
        const insert = await createClient()
          .from("contractor_gallery")
          .insert({
            contractor_id: profile.id,
            image_url: uploaded.signedUrl,
            sort_order: gallery.length + index,
          })
          .select("id, image_url, caption, sort_order")
          .single();

        if (insert.error) {
          try {
            await removeUploadedVendorMedia(uploaded.path);
          } catch (cleanupError) {
            console.warn("Unlinked vendor gallery upload could not be cleaned up", cleanupError);
          }
          throw insert.error;
        }

        created.push(insert.data as GalleryItem);
        setGalleryUploadProgress({ completed: created.length, total: selected.length });
      }

      setGallery((current) => [...current, ...created]);
      toast.success(`${created.length} ${created.length === 1 ? "photo" : "photos"} added`, {
        description: "Your public project gallery has been updated.",
      });
    } catch (error) {
      if (created.length) setGallery((current) => [...current, ...created]);
      toast.error("Gallery upload stopped", {
        description: `${created.length ? `${created.length} ${created.length === 1 ? "photo was" : "photos were"} saved. ` : ""}${error instanceof Error ? error.message : "Please try again."}`,
      });
    } finally {
      setGalleryUploadProgress(null);
    }
  }

  async function removeGalleryImage(item: GalleryItem) {
    if (!profile || !user || mode !== "live") return;
    if (!window.confirm("Remove this image from your public project gallery?")) return;

    setRemovingGalleryId(item.id);
    try {
      const result = await createClient()
        .from("contractor_gallery")
        .delete()
        .eq("id", item.id)
        .eq("contractor_id", profile.id)
        .select("id")
        .maybeSingle();

      if (result.error) throw result.error;
      if (!result.data) throw new Error("That gallery image is no longer available to remove.");

      setGallery((current) => current.filter((image) => image.id !== item.id));
      const path = vendorMediaPathFromUrl(item.image_url, profile.id);
      if (path) {
        try {
          await removeUploadedVendorMedia(path);
        } catch (cleanupError) {
          console.warn("Removed vendor gallery image could not be deleted from Storage", cleanupError);
        }
      }
      toast.success("Gallery image removed");
    } catch (error) {
      toast.error("Gallery image could not be removed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setRemovingGalleryId(null);
    }
  }

  async function saveProfile() {
    if (!profile || !user || mode !== "live") return;

    const name = profile.name.trim();
    const location = profile.location?.trim() ?? "";
    const bio = profile.bio?.trim() ?? "";
    const services = profile.services
      .map((service) => service.trim())
      .filter(Boolean);

    if (!name || !location || services.length === 0) {
      toast.error("Complete the essential profile fields", {
        description:
          "Business name, location, and at least one service are required.",
      });
      return;
    }

    if (
      profile.years_experience !== null &&
      (profile.years_experience < 0 || profile.years_experience > 100)
    ) {
      toast.error("Check years of experience", {
        description: "Enter a value between 0 and 100.",
      });
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const payload = {
        name,
        location,
        bio,
        services,
        phone: profile.phone?.trim() || null,
        email: profile.email?.trim().toLowerCase() || null,
        years_experience: profile.years_experience,
        special_offer: profile.special_offer?.trim() || null,
        our_promise: profile.our_promise?.trim() || null,
      };
      const { data, error } = await supabase
        .from("contractors")
        .update(payload)
        .eq("id", profile.id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error(
          "The linked contractor record changed. Reload before saving again.",
        );
      }

      setProfile((current) =>
        current ? { ...current, ...payload } : current,
      );
      toast.success("Profile saved", {
        description: "Your vendor listing details have been updated.",
      });
    } catch (error) {
      toast.error("Unable to save profile", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");

    if (password.length < 8) {
      const message = "Use at least 8 characters.";
      setPasswordError(message);
      toast.error("Password is too short", { description: message });
      return;
    }
    if (password !== confirmPassword) {
      const message = "The passwords you entered do not match.";
      setPasswordError(message);
      toast.error("Passwords don’t match", { description: message });
      return;
    }

    setPasswordSaving(true);
    try {
      const { data, error } = await createClient().auth.updateUser({
        password,
        data: { [PASSWORD_SET_BY_USER_KEY]: true },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Your account could not be verified after the update.");

      clearVendorPasswordNudgeDismissal();
      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      toast.success("Password updated", {
        description: "Your new password is active. You’ll remain signed in to the vendor portal.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      setPasswordError(message);
      toast.error("Password could not be updated", { description: message });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (mode === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />
        Loading profile...
      </div>
    );
  }

  if (mode === "unlinked") {
    return (
      <StateCard
        icon={AlertCircle}
        title="No vendor profile linked"
        description="Your account has vendor access, but it is not linked to a contractor record. Contact Mercurius onboarding so the approved business record can be connected."
      >
        <Link
          href="/contact"
          className={buttonVariants({ variant: "outline" })}
        >
          Contact onboarding
        </Link>
      </StateCard>
    );
  }

  if (mode === "error") {
    return (
      <StateCard
        icon={AlertCircle}
        title="Your profile could not be loaded"
        description={
          "No preview profile has been substituted. " +
          (errorMessage || "Please try again.")
        }
      >
        <Button variant="outline" onClick={() => void loadProfile()}>
          <RefreshCw />
          Try again
        </Button>
      </StateCard>
    );
  }

  if (!profile) return null;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 md:p-8">
      <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Public presence
          </p>
          <h1 className="font-heading text-2xl font-semibold">Your Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Essentials appear on your public listing. Optional fields help you
            stand out.
          </p>
        </div>
        <Link
          href={`/providers/${profile.id}`}
          className={cn(buttonVariants(), "min-h-11 w-full shrink-0 sm:w-auto")}
        >
          <ExternalLink />
          View public storefront
        </Link>
      </header>

      <div className="space-y-6">
        <ProfileStrengthCard
          model={strength}
          onFocus={focusField}
        />

        <Card className="border-accent/25">
          <CardHeader>
            <CardTitle className="text-base">
              Essentials for your listing
            </CardTitle>
            <CardDescription>
              Business identity and services — the foundation customers need
              before requesting your business.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business Name" id="name" essential earned={profile.name.trim() ? 8 : 0} points={8}>
                <Input
                  id="name"
                  className="h-11"
                  value={profile.name}
                  onChange={(event) => update("name", event.target.value)}
                />
              </Field>
              <Field label="Location" id="location" essential earned={profile.location?.trim() ? 8 : 0} points={8}>
                <Input
                  id="location"
                  className="h-11"
                  placeholder="Cape Coral, FL"
                  value={profile.location ?? ""}
                  onChange={(event) => update("location", event.target.value)}
                />
              </Field>
            </div>

            <div id="services" className="space-y-2 scroll-mt-24">
              <FieldLabel essential earned={profile.services.length > 0 ? 10 : 0} points={10}>Services Offered</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {profile.services.map((service) => (
                  <Badge
                    key={service}
                    variant="secondary"
                    className="min-h-8 gap-1.5 pr-1"
                  >
                    {service}
                    <button
                      type="button"
                      onClick={() => removeService(service)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:text-destructive"
                      aria-label={"Remove " + service}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Badge>
                ))}
                {profile.services.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add at least one service customers can recognize.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="Add a service (e.g. Lawn Care)"
                  value={newService}
                  onChange={(event) => setNewService(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addService();
                    }
                  }}
                  className="h-11 w-full sm:max-w-xs"
                />
                <Button
                  variant="outline"
                  type="button"
                  className="min-h-11 w-full sm:w-auto"
                  onClick={addService}
                >
                  <Plus />
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card id="profile-media" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4 text-accent" />
              Visual Proof
              <ScorePill earned={(profile.logo_url ? 8 : 0) + Math.min(gallery.length, 3) * 4} total={20} />
            </CardTitle>
            <CardDescription>
              A real business logo and completed-project photos help homeowners recognize and evaluate your work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="rounded-2xl border bg-muted/20 p-4 sm:p-5" aria-labelledby="logo-heading">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-background shadow-sm">
                  {profile.logo_url ? (
                    <img src={profile.logo_url} alt={`${profile.name} business logo`} className="h-full w-full object-contain p-1" />
                  ) : (
                    <Building2 className="h-9 w-9 text-muted-foreground/70" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="logo-heading" className="text-sm font-semibold">Business logo</h3>
                    <ScorePill earned={profile.logo_url ? 8 : 0} total={8} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {profile.logo_url ? "This logo appears on your directory card and public storefront." : "Upload the logo homeowners should recognize. JPG, PNG, or WebP; 5 MB maximum."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingLogo || removingLogo}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {uploadingLogo ? <Loader2 className="animate-spin" /> : <Upload />}
                      {uploadingLogo ? "Uploading..." : profile.logo_url ? "Replace logo" : "Upload logo"}
                    </Button>
                    {profile.logo_url && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={uploadingLogo || removingLogo}
                        onClick={() => void removeLogo()}
                      >
                        {removingLogo ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        {removingLogo ? "Removing..." : "Remove"}
                      </Button>
                    )}
                  </div>
                  <input
                    ref={logoInputRef}
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void replaceLogo(file);
                      event.target.value = "";
                    }}
                  />
                </div>
              </div>
            </section>

            <section aria-labelledby="gallery-heading">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="gallery-heading" className="text-sm font-semibold">Project gallery</h3>
                    <ScorePill earned={Math.min(gallery.length, 3) * 4} total={12} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {gallery.length} {gallery.length === 1 ? "photo" : "photos"} saved. Up to three completed-project photos count toward profile strength.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={Boolean(galleryUploadProgress)}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  {galleryUploadProgress ? <Loader2 className="animate-spin" /> : <Plus />}
                  {galleryUploadProgress ? `${galleryUploadProgress.completed} of ${galleryUploadProgress.total}` : "Add photos"}
                </Button>
                <input
                  ref={galleryInputRef}
                  hidden
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={(event) => {
                    if (event.target.files?.length) void addGalleryImages(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>

              {gallery.length === 0 ? (
                <button
                  type="button"
                  className="mt-4 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-4 py-10 text-center transition-colors hover:border-accent/50 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={Boolean(galleryUploadProgress)}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <Camera className="h-7 w-7 text-accent" aria-hidden="true" />
                  <span className="mt-3 text-sm font-medium">Add completed-project photos</span>
                  <span className="mt-1 text-xs text-muted-foreground">JPG, PNG, or WebP; 10 MB maximum per image.</span>
                </button>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {gallery.map((item) => (
                    <figure key={item.id} className="group relative overflow-hidden rounded-xl border bg-muted shadow-sm">
                      <div className="aspect-square overflow-hidden">
                        <img src={item.image_url} alt={item.caption || `${profile.name} completed project`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                      </div>
                      {item.caption && <figcaption className="truncate border-t bg-background/95 px-3 py-2 text-xs text-muted-foreground">{item.caption}</figcaption>}
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-background/95 text-muted-foreground shadow-md transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                        disabled={removingGalleryId === item.id}
                        onClick={() => void removeGalleryImage(item)}
                        aria-label="Remove gallery image"
                      >
                        {removingGalleryId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </section>

            <p className="rounded-lg bg-accent/8 px-3 py-2 text-xs leading-5 text-muted-foreground">
              Media changes are saved immediately and reflected on your public profile. Only upload images you own or have permission to use.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Contact &amp; experience
            </CardTitle>
            <CardDescription>
              Helpful operational details. Contact information remains private
              to authorized Mercurius workflows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business Email" id="email" earned={profile.email?.trim() ? 7 : 0} points={7}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={profile.email ?? ""}
                  onChange={(event) => update("email", event.target.value)}
                />
              </Field>
              <Field label="Phone" id="phone" earned={profile.phone?.trim() ? 7 : 0} points={7}>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(239) 000-0000"
                  value={profile.phone ?? ""}
                  onChange={(event) => update("phone", event.target.value)}
                />
              </Field>
              <Field label="Years of Experience" id="years" earned={(profile.years_experience ?? 0) > 0 ? 10 : 0} points={10}>
                <Input
                  id="years"
                  type="number"
                  min={0}
                  max={100}
                  value={profile.years_experience ?? ""}
                  onChange={(event) =>
                    update(
                      "years_experience",
                      event.target.value === ""
                        ? null
                        : Number.parseInt(event.target.value, 10),
                    )
                  }
                />
              </Field>
              <Field label="Verified Specialty" id="verified_specialty" earned={profile.verified_specialty?.trim() ? 10 : 0} points={10}>
                <div className="relative">
                  <Award className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-700" />
                  <Input
                    id="verified_specialty"
                    className="pl-9"
                    readOnly
                    disabled
                    placeholder="Set by Mercurius after verification"
                    value={profile.verified_specialty ?? ""}
                  />
                </div>
                <p className="text-xs text-muted-foreground">This trust field is assigned by Mercurius after review. Contact onboarding to request verification.</p>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-accent" />
              Stand Out
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
              >
                Optional
              </Badge>
            </CardTitle>
            <CardDescription>
              These details help your listing attract more customers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Bio / About" id="bio" earned={vendorBioPoints(profile.bio)} points={10}>
              <textarea
                id="bio"
                rows={5}
                placeholder="Tell customers about your business..."
                value={profile.bio ?? ""}
                onChange={(event) => update("bio", event.target.value)}
                className={textareaClass}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {(profile.bio?.length ?? 0) < 80
                    ? "A clear bio earns partial credit; aim for 80+ characters for the full 10 points."
                    : "Your bio earns the full 10 points."
                  }
                </p>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {profile.bio?.length ?? 0}/80
                </span>
              </div>
            </Field>

            <Field label="Special Offer" id="special_offer" earned={profile.special_offer?.trim() ? 5 : 0} points={5}>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
                <Input
                  id="special_offer"
                  className="pl-9"
                  placeholder='e.g. "15% off first service"'
                  value={profile.special_offer ?? ""}
                  onChange={(event) =>
                    update("special_offer", event.target.value || null)
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                A limited-time promotion that creates urgency.
              </p>
            </Field>

            <Field label="Our Promise" id="our_promise" earned={profile.our_promise?.trim() ? 5 : 0} points={5}>
              <div className="relative">
                <HandHeart className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
                <Input
                  id="our_promise"
                  className="pl-9"
                  placeholder='e.g. "Done right or we come back free"'
                  value={profile.our_promise ?? ""}
                  onChange={(event) =>
                    update("our_promise", event.target.value || null)
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                A trust-building commitment that shows confidence.
              </p>
            </Field>

          </CardContent>
        </Card>

        <Card id="password" className="scroll-mt-24 overflow-hidden">
          <CardHeader className="border-b border-border bg-muted/20">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sage-dark">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <CardTitle className="text-base">Account password</CardTitle>
                <CardDescription className="mt-1">
                  Choose a password only you know. Saving it does not interrupt your portal session.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <form className="space-y-5" onSubmit={savePassword}>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vendor-new-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="vendor-new-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      minLength={8}
                      className="h-11 pr-11"
                      disabled={passwordSaving}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      disabled={passwordSaving}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor-confirm-password">Confirm new password</Label>
                  <Input
                    id="vendor-confirm-password"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    className="h-11"
                    disabled={passwordSaving}
                    required
                  />
                </div>
              </div>

              {passwordError && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{passwordError}</p>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
                  Supabase Auth securely updates your signed-in account.
                </div>
                <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={passwordSaving}>
                  {passwordSaving ? <Loader2 className="animate-spin" /> : <KeyRound />}
                  {passwordSaving ? "Updating..." : "Update password"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:justify-end">
          <Link
            href={`/providers/${profile.id}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-11 w-full sm:w-auto",
            )}
          >
            <ExternalLink />
            View public storefront
          </Link>
          <Button
            className="min-h-12 w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active sm:w-auto"
            onClick={() => void saveProfile()}
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProfileStrengthCard({
  model,
  onFocus,
}: {
  model: StrengthModel;
  onFocus: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden border-accent-border bg-card shadow-md">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-sage-dark" />
              Profile Strength
            </CardTitle>
            <CardDescription className="mt-1">
              A transparent completeness score based only on available vendor fields and media records.
            </CardDescription>
          </div>
          <div className="text-right"><div className="text-4xl font-semibold leading-none text-sage-dark tabular-nums">{model.score}</div><p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">out of 100</p></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className="h-3 w-full overflow-hidden rounded-full bg-accent-soft ring-1 ring-accent-border"
          role="progressbar"
          aria-valuenow={model.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile strength"
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-700"
            style={{ width: model.score + "%" }}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {model.categories.map((category) => {
            const Icon = category.icon;
            const complete = category.earned === category.total;
            return <div key={category.key} className={cn("rounded-xl border p-3", complete ? "border-accent-border bg-accent-subtle" : "border-border bg-background")}><div className="flex items-center justify-between gap-2"><span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", complete ? "bg-accent-soft text-sage-dark" : "bg-muted text-muted-foreground")}><Icon className="h-4 w-4" /></span><span className="text-sm font-semibold tabular-nums">{category.earned}/{category.total}</span></div><p className="mt-2 text-xs font-medium text-foreground">{category.label}</p><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{category.description}</p></div>;
          })}
        </div>

        {model.actions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next best actions
            </p>
            <ul className="space-y-2">
              {model.actions.slice(0, 4).map((action, index) => {
                const Icon = action.icon;
                const content = (
                  <>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sage-dark">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{action.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{action.description}</span></span>
                    <PointsPill>+{action.points} pts</PointsPill>
                    {(action.targetId || action.href) && (
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    )}
                  </>
                );

                return (
                  <li key={action.key}>
                    {action.targetId ? (
                      <button
                        type="button"
                        onClick={() => onFocus(action.targetId!)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                          index === 0
                            ? "border-accent-border bg-accent-subtle hover:bg-accent-soft"
                            : "border-border bg-background hover:bg-surface-hover",
                        )}
                      >
                        {content}
                      </button>
                    ) : action.href ? (
                      <Link href={action.href} className={cn("group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors", index === 0 ? "border-accent-border bg-accent-subtle hover:bg-accent-soft" : "border-border bg-background hover:bg-surface-hover")}>
                        {content}
                      </Link>
                    ) : (
                      <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-accent-border bg-accent-soft p-3 text-sm text-sage-dark">
            <Sparkles className="h-4 w-4" />
            Your profile has earned all 100 available points.
          </div>
        )}
        <p className="text-xs leading-5 text-muted-foreground">The score updates as you edit this form. Use Save Changes to publish supported field improvements to your live contractor record.</p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  id,
  essential,
  optional,
  earned,
  points,
  children,
}: {
  label: string;
  id: string;
  essential?: boolean;
  optional?: boolean;
  earned?: number;
  points?: number;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} essential={essential} optional={optional} earned={earned} points={points}>
        {label}
      </FieldLabel>
      {children}
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
  essential,
  optional,
  earned,
  points,
}: {
  htmlFor?: string;
  children: ReactNode;
  essential?: boolean;
  optional?: boolean;
  earned?: number;
  points?: number;
}) {
  return (
    <Label htmlFor={htmlFor} className="flex flex-wrap items-center gap-2">
      <span>{children}</span>
      {essential && (
        <Badge
          variant="secondary"
          className="px-1.5 py-0 text-[10px] font-normal"
        >
          Essential
        </Badge>
      )}
      {optional && (
        <Badge
          variant="outline"
          className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
        >
          Optional
        </Badge>
      )}
      {typeof points === "number" && typeof earned === "number" && <ScorePill earned={earned} total={points} />}
    </Label>
  );
}

function ScorePill({ earned, total }: { earned: number; total: number }) {
  const complete = earned >= total;
  return <span className={cn("ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums", complete ? "border-accent-border bg-accent-soft text-sage-dark" : "border-border bg-muted text-muted-foreground")}>{earned}/{total} pts</span>;
}

function PointsPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-medium text-sage-dark">
      {children}
    </span>
  );
}

function StateCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof AlertCircle;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-xl p-6 py-20 text-center">
      <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </span>
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <div className="mt-6 flex justify-center">{children}</div>
    </div>
  );
}

function buildStrength(profile: Profile | null, galleryCount: number | null): StrengthModel {
  if (!profile) {
    return {
      score: 0,
      categories: [
        { key: "essentials", label: "Essentials", earned: 0, total: 40, description: "Identity, services, and contact", icon: Building2 },
        { key: "trust", label: "Trust", earned: 0, total: 20, description: "Experience and verification", icon: ShieldCheck },
        { key: "visual", label: "Visual proof", earned: 0, total: 20, description: "Logo and project gallery", icon: Camera },
        { key: "differentiation", label: "Differentiation", earned: 0, total: 20, description: "Bio, offer, and promise", icon: Sparkles },
      ],
      actions: [],
    };
  }

  const galleryPhotos = Math.min(galleryCount ?? 0, 3);
  const breakdown = calculateVendorProfileStrength(profile, galleryPhotos);
  const categories: StrengthCategory[] = [
    { key: "essentials", label: "Essentials", earned: breakdown.essentials, total: 40, description: "Identity, services, and contact", icon: Building2 },
    { key: "trust", label: "Trust", earned: breakdown.trust, total: 20, description: "Experience and verification", icon: ShieldCheck },
    { key: "visual", label: "Visual proof", earned: breakdown.visual, total: 20, description: "Logo and up to 3 photos", icon: Camera },
    { key: "differentiation", label: "Differentiation", earned: breakdown.differentiation, total: 20, description: "Bio, offer, and promise", icon: Sparkles },
  ];

  const actions: StrengthAction[] = [];
  if (!profile.name.trim()) actions.push({ key: "name", icon: Building2, label: "Add your business name", description: "Give homeowners the verified name they should recognize.", points: 8, targetId: "name" });
  if (!profile.location?.trim()) actions.push({ key: "location", icon: MapPin, label: "Add your service location", description: "Clarify where your business serves homeowners.", points: 8, targetId: "location" });
  if (!profile.services.length) actions.push({ key: "services", icon: Sparkles, label: "List at least one service", description: "Services connect your profile to pricing and matching.", points: 10, targetId: "services" });
  if (!profile.email?.trim()) actions.push({ key: "email", icon: Mail, label: "Add a business email", description: "Private contact data supports Mercurius operations and coordination.", points: 7, targetId: "email" });
  if (!profile.phone?.trim()) actions.push({ key: "phone", icon: Phone, label: "Add a business phone", description: "Give authorized Mercurius workflows a reliable contact number.", points: 7, targetId: "phone" });
  if ((profile.years_experience ?? 0) <= 0) actions.push({ key: "experience", icon: Award, label: "Add years of experience", description: "Help homeowners understand your practical trade experience.", points: 10, targetId: "years" });

  const currentBioPoints = vendorBioPoints(profile.bio);
  if (currentBioPoints < 10) actions.push({ key: "bio", icon: PenLine, label: currentBioPoints ? "Strengthen your business bio" : "Add a business bio", description: "Aim for at least 80 useful characters to earn the full score.", points: 10 - currentBioPoints, targetId: "bio" });
  if (!profile.logo_url) actions.push({ key: "logo", icon: Building2, label: "Add your business logo", description: "Upload the logo homeowners should recognize on your listing.", points: 8, targetId: "profile-media" });
  if (galleryPhotos < 3) actions.push({ key: "gallery", icon: Camera, label: galleryPhotos ? `Add ${3 - galleryPhotos} more project ${3 - galleryPhotos === 1 ? "photo" : "photos"}` : "Add project gallery photos", description: "Up to three real completed-project photos count toward profile strength.", points: (3 - galleryPhotos) * 4, targetId: "profile-media" });
  if (!profile.verified_specialty?.trim()) actions.push({ key: "specialty", icon: ShieldCheck, label: "Request specialty verification", description: "Mercurius controls this field after reviewing the vendor’s specialty.", points: 10, href: "/contact" });
  if (!profile.special_offer?.trim()) actions.push({ key: "offer", icon: Tag, label: "Add a special offer", description: "Use a truthful, supportable offer that differentiates your listing.", points: 5, targetId: "special_offer" });
  if (!profile.our_promise?.trim()) actions.push({ key: "promise", icon: HandHeart, label: "Add your customer promise", description: "State a practical commitment your business can consistently honor.", points: 5, targetId: "our_promise" });

  return {
    score: breakdown.score,
    categories,
    actions,
  };
}
