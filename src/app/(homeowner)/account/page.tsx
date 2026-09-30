"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultPathForRoles, fetchRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import { EmailPreferences } from "@/components/early-access/EmailPreferences";

const PASSWORD_SET_BY_USER_KEY = "password_set_by_user";

type AccessState = "checking" | "allowed" | "denied" | "error";
type ProfileState = "loading" | "ready" | "error";
type Notice = { tone: "success" | "warning"; message: string } | null;

type ProfileRow = {
  full_name: string | null;
  phone: string | null;
};

export default function AccountPage() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const router = useRouter();
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [accessError, setAccessError] = useState("");
  const [profileState, setProfileState] = useState<ProfileState>("loading");
  const [profileError, setProfileError] = useState("");
  const [profileMissing, setProfileMissing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);

  const metadataFullName = useMemo(() => {
    const value = user?.user_metadata?.full_name;
    return typeof value === "string" ? value.trim() : "";
  }, [user?.user_metadata?.full_name]);

  const checkAccess = useCallback(async () => {
    if (!userId) return;
    setAccessState("checking");
    setAccessError("");

    try {
      const roles = await fetchRoles(userId);
      if (!roles.includes("homeowner")) {
        setAccessState("denied");
        router.replace(defaultPathForRoles(roles));
        return;
      }
      setAccessState("allowed");
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "Your homeowner access could not be verified.",
      );
      setAccessState("error");
    }
  }, [router, userId]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => {
      if (!user) {
        router.replace("/login?redirect=%2Faccount");
        return;
      }
      void checkAccess();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, checkAccess, router, user]);

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    setProfileState("loading");
    setProfileError("");

    const supabase = createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>();

    if (error) {
      setProfileError(error.message);
      setProfileState("error");
      return;
    }

    setProfileMissing(!data);
    setFullName(data?.full_name?.trim() || metadataFullName);
    setPhone(data?.phone?.trim() || "");
    setProfileState("ready");
  }, [metadataFullName, userId]);

  useEffect(() => {
    if (accessState !== "allowed") return;
    const timer = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timer);
  }, [accessState, loadProfile]);

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    const normalizedName = fullName.trim();
    const normalizedPhone = phone.trim();
    setProfileNotice(null);

    if (!normalizedName) {
      toast.error("Full name is required");
      return;
    }
    if (normalizedName.length > 200) {
      toast.error("Full name is too long", {
        description: "Use 200 characters or fewer.",
      });
      return;
    }
    if (normalizedPhone.length > 50) {
      toast.error("Phone number is too long", {
        description: "Use 50 characters or fewer.",
      });
      return;
    }

    setProfileSaving(true);
    const supabase = createClient();

    try {
      const { data, error } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: user.id,
            full_name: normalizedName,
            phone: normalizedPhone || null,
          },
          { onConflict: "user_id" },
        )
        .select("full_name, phone")
        .single<ProfileRow>();

      if (error) throw error;

      setFullName(data.full_name?.trim() || normalizedName);
      setPhone(data.phone?.trim() || "");
      setProfileMissing(false);

      const { error: metadataError } = await supabase.auth.updateUser({
        data: { full_name: normalizedName },
      });

      if (metadataError) {
        const message =
          "Your profile was saved, but the name in the account menu may take longer to update.";
        setProfileNotice({ tone: "warning", message });
        toast.warning("Profile saved with a display delay", {
          description: message,
        });
        return;
      }

      const message = "Your contact details are up to date.";
      setProfileNotice({ tone: "success", message });
      toast.success("Profile saved", { description: message });
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Please try again.";
      toast.error("Profile could not be saved", { description: message });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice(null);

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
    const supabase = createClient();

    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { [PASSWORD_SET_BY_USER_KEY]: true },
      });
      if (error) throw error;

      setPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      const message = "Your new password is active now.";
      setPasswordNotice({ tone: "success", message });
      toast.success("Password updated", { description: message });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Please try again.";
      setPasswordError(message);
      toast.error("Password could not be updated", { description: message });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (
    authLoading ||
    !user ||
    accessState === "checking" ||
    accessState === "denied"
  ) {
    return <FullPageLoading />;
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 md:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
              Homeowner account
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Account settings
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Keep your basic contact details current, manage the password you
              use to sign in, and choose which emails you get.
            </p>
          </div>

          {accessState === "error" ? (
            <StateCard
              title="We couldn’t verify your homeowner account"
              description={accessError}
              actionLabel="Try again"
              onAction={() => void checkAccess()}
            />
          ) : profileState === "loading" ? (
            <Card className="mt-8">
              <CardContent className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                Loading account details…
              </CardContent>
            </Card>
          ) : profileState === "error" ? (
            <StateCard
              title="Your account details could not be loaded"
              description={profileError}
              actionLabel="Try again"
              onAction={() => void loadProfile()}
            />
          ) : (
            <div className="mt-8 grid gap-6">
              <Card className="shadow-sm">
                <CardHeader className="border-b">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Profile and contact</CardTitle>
                      <CardDescription className="mt-1">
                        These details help Mercurius coordinate your service
                        requests.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {profileMissing && (
                    <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        No profile details are stored yet. Saving this form will
                        create your homeowner profile.
                      </p>
                    </div>
                  )}

                  <form className="space-y-5" onSubmit={handleProfileSave}>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="account-full-name">Full name</Label>
                        <Input
                          id="account-full-name"
                          name="fullName"
                          autoComplete="name"
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                          maxLength={200}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="account-phone">Phone</Label>
                        <Input
                          id="account-phone"
                          name="phone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="Optional"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          maxLength={50}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="account-email">Email address</Label>
                      <Input
                        id="account-email"
                        type="email"
                        value={user.email ?? ""}
                        readOnly
                        aria-describedby="account-email-note"
                        className="bg-muted/50 text-muted-foreground"
                      />
                      <p
                        id="account-email-note"
                        className="text-xs leading-5 text-muted-foreground"
                      >
                        Email is read-only here because changing a sign-in address
                        requires a separate verification flow. Contact support if
                        you need help changing it.
                      </p>
                    </div>

                    {profileNotice && <InlineNotice notice={profileNotice} />}

                    <div className="flex justify-end">
                      <Button type="submit" disabled={profileSaving}>
                        {profileSaving ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Save />
                        )}
                        {profileSaving ? "Saving…" : "Save profile"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="border-b">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-soft text-foreground">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Change password</CardTitle>
                      <CardDescription className="mt-1">
                        Choose a new password for your current Mercurius account.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handlePasswordSave}>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="account-password">New password</Label>
                        <div className="relative">
                          <Input
                            id="account-password"
                            name="password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            minLength={8}
                            className="pr-11"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((visible) => !visible)}
                            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Use at least 8 characters.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="account-confirm-password">
                          Confirm new password
                        </Label>
                        <Input
                          id="account-confirm-password"
                          name="confirmPassword"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(event) =>
                            setConfirmPassword(event.target.value)
                          }
                          minLength={8}
                          required
                        />
                      </div>
                    </div>

                    {passwordError && (
                      <div
                        role="alert"
                        className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{passwordError}</p>
                      </div>
                    )}
                    {passwordNotice && <InlineNotice notice={passwordNotice} />}

                    <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
                        Supabase Auth securely applies this change to your signed-in account.
                      </div>
                      <Button type="submit" disabled={passwordSaving}>
                        {passwordSaving ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <KeyRound />
                        )}
                        {passwordSaving ? "Updating…" : "Update password"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
              <EmailPreferences />
            </div>
          )}
    </div>
  );
}

function InlineNotice({ notice }: { notice: Exclude<Notice, null> }) {
  const isSuccess = notice.tone === "success";
  return (
    <div
      role="status"
      className={
        isSuccess
          ? "flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100"
          : "flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
      }
    >
      {isSuccess ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <p>{notice.message}</p>
    </div>
  );
}

function StateCard({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card className="mt-8">
      <CardContent className="py-14 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
          {description || "Please try again."}
        </p>
        <Button variant="outline" className="mt-5" onClick={onAction}>
          <RefreshCw />
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

function FullPageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-background">
      <Loader2 className="h-7 w-7 animate-spin text-accent" />
      <span className="sr-only">Loading account settings</span>
    </div>
  );
}
