"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Award,
  Camera,
  ExternalLink,
  HandHeart,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  TrendingUp,
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

type Profile = {
  id: string;
  name: string;
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

type StrengthAction = {
  key: string;
  icon: typeof Tag;
  label: string;
  points: string;
  targetId?: string;
};

const textareaClass =
  "w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function VendorProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<PageMode>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [galleryCount, setGalleryCount] = useState<number | null>(null);
  const [newService, setNewService] = useState("");
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setMode("loading");
    setErrorMessage("");

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contractors")
        .select(
          "id, name, bio, location, services, years_experience, special_offer, our_promise, verified_specialty, is_active, marketing_enabled",
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
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", data.id),
      ]);

      if (contactResult.error) throw contactResult.error;
      const contactData = contactResult.data as unknown;
      const contact = (
        Array.isArray(contactData) ? contactData[0] : contactData
      ) as ContactRow | null;

      if (galleryResult.error) {
        console.warn("Unable to load profile gallery count", galleryResult.error);
        setGalleryCount(null);
      } else {
        setGalleryCount(galleryResult.count ?? 0);
      }

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
      setGalleryCount(null);
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

  const strength = useMemo(
    () => calculateStrength(profile, galleryCount),
    [galleryCount, profile],
  );

  const strengthActions = useMemo(
    () => getStrengthActions(profile, galleryCount),
    [galleryCount, profile],
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

  async function saveProfile() {
    if (!profile || !user || mode !== "live") return;

    const name = profile.name.trim();
    const location = profile.location?.trim() ?? "";
    const bio = profile.bio?.trim() ?? "";
    const services = profile.services
      .map((service) => service.trim())
      .filter(Boolean);

    if (!name || !location || !bio || services.length === 0) {
      toast.error("Complete the essential profile fields", {
        description:
          "Business name, location, bio, and at least one service are required.",
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
          score={strength}
          actions={strengthActions}
          onFocus={focusField}
        />

        <Card className="border-accent/25">
          <CardHeader>
            <CardTitle className="text-base">
              Essentials for your listing
            </CardTitle>
            <CardDescription>
              Name, location, bio, and services — what customers need to trust
              and request your business.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business Name" id="name" essential>
                <Input
                  id="name"
                  className="h-11"
                  value={profile.name}
                  onChange={(event) => update("name", event.target.value)}
                />
              </Field>
              <Field label="Location" id="location" essential>
                <Input
                  id="location"
                  className="h-11"
                  placeholder="Cape Coral, FL"
                  value={profile.location ?? ""}
                  onChange={(event) => update("location", event.target.value)}
                />
              </Field>
            </div>

            <Field label="Bio / About" id="bio" essential>
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
                    ? "A longer bio converts better — aim for 80+ characters."
                    : "Nice — your bio is a good length."}
                </p>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {profile.bio?.length ?? 0}/80
                </span>
              </div>
            </Field>

            <div className="space-y-2">
              <FieldLabel essential>Services Offered</FieldLabel>
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
              <Field label="Business Email" id="email" optional>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={profile.email ?? ""}
                  onChange={(event) => update("email", event.target.value)}
                />
              </Field>
              <Field label="Phone" id="phone" optional>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(239) 000-0000"
                  value={profile.phone ?? ""}
                  onChange={(event) => update("phone", event.target.value)}
                />
              </Field>
              <Field label="Years of Experience" id="years" optional>
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
            <Field label="Special Offer" id="special_offer">
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

            <Field label="Our Promise" id="our_promise">
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

            <Field label="Verified Specialty" id="verified_specialty">
              <div className="relative">
                <Award className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-700" />
                <Input
                  id="verified_specialty"
                  className="pl-9"
                  readOnly
                  disabled
                  placeholder="Set by the Mercurius team after verification"
                  value={profile.verified_specialty ?? ""}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Verified and assigned by Mercurius. Contact support to request a
                review or change.
              </p>
            </Field>
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
            className="min-h-12 w-full bg-accent text-accent-foreground hover:bg-accent/90 sm:w-auto"
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
  score,
  actions,
  onFocus,
}: {
  score: number;
  actions: StrengthAction[];
  onFocus: (id: string) => void;
}) {
  return (
    <Card className="border-sage/30 bg-sage/5 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-sage-dark" />
              Profile Strength
            </CardTitle>
            <CardDescription className="mt-1">
              Complete your profile to improve visibility and help customers
              choose confidently.
            </CardDescription>
          </div>
          <div className="text-4xl font-semibold leading-none text-sage-dark tabular-nums">
            {score}%
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-sage/15"
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile strength"
        >
          <div
            className="h-full rounded-full bg-sage transition-all duration-700"
            style={{ width: score + "%" }}
          />
        </div>

        {actions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next best actions
            </p>
            <ul className="space-y-2">
              {actions.slice(0, 3).map((action, index) => {
                const Icon = action.icon;
                const content = (
                  <>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sage/15 text-sage-dark">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-foreground">
                      {action.label}
                    </span>
                    <PointsPill>{action.points}</PointsPill>
                    {action.targetId && (
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
                            ? "border-sage/40 bg-background hover:bg-sage/10"
                            : "border-border/60 bg-background/60 hover:bg-muted/50",
                        )}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                        {content}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <Sparkles className="h-4 w-4" />
            Your listing profile is complete.
          </div>
        )}

        {actions.find((action) => action.targetId) && (
          <Button
            type="button"
            onClick={() =>
              onFocus(
                actions.find((action) => action.targetId)?.targetId ??
                  "special_offer",
              )
            }
            className="min-h-11 w-full sm:w-auto"
          >
            Improve your profile
            <ArrowRight />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  id,
  essential,
  optional,
  children,
}: {
  label: string;
  id: string;
  essential?: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} essential={essential} optional={optional}>
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
}: {
  htmlFor?: string;
  children: ReactNode;
  essential?: boolean;
  optional?: boolean;
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
    </Label>
  );
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

function calculateStrength(profile: Profile | null, galleryCount: number | null) {
  if (!profile) return 0;
  let score = 0;
  let possible = 90;
  if (profile.name.trim()) score += 10;
  if (profile.location?.trim()) score += 10;
  if ((profile.bio?.trim().length ?? 0) >= 80) {
    score += 15;
  } else if (profile.bio?.trim()) {
    score += 8;
  }
  if (profile.services.length > 0) score += 15;
  if (profile.phone?.trim()) score += 8;
  if (profile.email?.trim()) score += 8;
  if ((profile.years_experience ?? 0) > 0) score += 6;
  if (profile.special_offer?.trim()) score += 8;
  if (profile.our_promise?.trim()) score += 6;
  if (profile.verified_specialty?.trim()) score += 4;
  if (galleryCount !== null) {
    possible += 10;
    score += Math.round((Math.min(galleryCount, 3) / 3) * 10);
  }
  return Math.min(100, Math.round((score / possible) * 100));
}

function getStrengthActions(
  profile: Profile | null,
  galleryCount: number | null,
): StrengthAction[] {
  if (!profile) return [];
  const actions: StrengthAction[] = [];

  if (!profile.special_offer?.trim()) {
    actions.push({
      key: "offer",
      icon: Tag,
      label: "Add a Special Offer",
      points: "+8 pts",
      targetId: "special_offer",
    });
  }
  if (galleryCount !== null && galleryCount < 3) {
    actions.push({
      key: "photos",
      icon: Camera,
      label:
        galleryCount === 0
          ? "Upload 3 before/after photos"
          : "Add " + (3 - galleryCount) + " more project photos",
      points: "+" + Math.round(((3 - galleryCount) / 3) * 10) + " pts",
    });
  }
  if ((profile.bio?.trim().length ?? 0) < 80) {
    actions.push({
      key: "bio",
      icon: PenLine,
      label: "Strengthen your bio (aim for 80+ characters)",
      points: "+7 pts",
      targetId: "bio",
    });
  }
  if (!profile.our_promise?.trim()) {
    actions.push({
      key: "promise",
      icon: HandHeart,
      label: "Add your customer promise",
      points: "+6 pts",
      targetId: "our_promise",
    });
  }
  if (!profile.location?.trim()) {
    actions.push({
      key: "location",
      icon: Award,
      label: "Add your service location",
      points: "+10 pts",
      targetId: "location",
    });
  }
  return actions;
}
