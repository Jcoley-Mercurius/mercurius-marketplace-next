"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchRoles, postLoginPathForRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";

const PASSWORD_SET_BY_USER_KEY = "password_set_by_user";

type RecoveryResult = {
  sessionReady: boolean;
  errorMessage: string | null;
};

type PageState = "checking" | "ready" | "invalid" | "success";

// React Strict Mode may initialize the page twice in development. Sharing an
// in-flight exchange prevents a one-time PKCE code from being consumed twice.
let pendingRecoveryExchange: Promise<RecoveryResult> | null = null;

export default function SetPasswordPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("checking");
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const authError =
      url.searchParams.get("error_description") ??
      hashParams.get("error_description") ??
      url.searchParams.get("error") ??
      hashParams.get("error");

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !session || authError) return;
      setLinkError("");
      setPageState("ready");
    });

    async function initializeRecoverySession() {
      try {
        // Keep state changes asynchronous relative to effect setup.
        await Promise.resolve();
        if (authError) {
          if (!active) return;
          setLinkError(authError);
          setPageState("invalid");
          clearRecoveryCredentials();
          return;
        }

        // The Supabase browser client may already have consumed the URL and
        // persisted the recovery session during its own initialization.
        const { data: existing, error: sessionError } =
          await supabase.auth.getSession();
        if (existing.session) {
          if (!active) return;
          clearRecoveryCredentials();
          setPageState("ready");
          return;
        }

        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        let exchange: Promise<RecoveryResult> | null = null;

        if (code) {
          exchange = runRecoveryExchange(async () => {
            const { data, error } =
              await supabase.auth.exchangeCodeForSession(code);
            return {
              sessionReady: Boolean(data.session),
              errorMessage: error?.message ?? null,
            };
          });
        } else if (tokenHash && (type === "recovery" || type === "invite")) {
          exchange = runRecoveryExchange(async () => {
            const { data, error } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type,
            });
            return {
              sessionReady: Boolean(data.session),
              errorMessage: error?.message ?? null,
            };
          });
        } else if (accessToken && refreshToken) {
          exchange = runRecoveryExchange(async () => {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            return {
              sessionReady: Boolean(data.session),
              errorMessage: error?.message ?? null,
            };
          });
        }

        if (exchange) {
          const result = await exchange;
          clearRecoveryCredentials();
          if (!active) return;

          if (result.sessionReady) {
            setPageState("ready");
            return;
          }

          // Another Supabase client instance may have completed the exchange.
          const { data: fallback } = await supabase.auth.getSession();
          if (!active) return;
          if (fallback.session) {
            setPageState("ready");
            return;
          }

          setLinkError(result.errorMessage ?? "The recovery link is invalid or has expired.");
          setPageState("invalid");
          return;
        }

        if (!active) return;
        setLinkError(
          sessionError?.message ?? "The recovery link is invalid or has expired.",
        );
        setPageState("invalid");
      } catch (error) {
        if (!active) return;
        setLinkError(
          error instanceof Error
            ? error.message
            : "The recovery link could not be verified.",
        );
        setPageState("invalid");
      }
    }

    void initializeRecoverySession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError("");

    if (password.length < 8) {
      const message = "Use at least 8 characters.";
      setValidationError(message);
      toast.error("Password too short", { description: message });
      return;
    }

    if (password !== confirmPassword) {
      const message = "The passwords you entered do not match.";
      setValidationError(message);
      toast.error("Passwords don’t match", { description: message });
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    try {
      const { data, error } = await supabase.auth.updateUser({
        password,
        data: { [PASSWORD_SET_BY_USER_KEY]: true },
      });

      if (error) {
        setValidationError(error.message);
        toast.error("Couldn’t set password", { description: error.message });
        return;
      }

      if (!data.user) {
        throw new Error("Your account could not be verified after the update.");
      }

      let destination = "/";
      try {
        const roles = await fetchRoles(data.user.id);
        const requestedDestination = new URLSearchParams(
          window.location.search,
        ).get("redirect");
        destination = postLoginPathForRoles(roles, requestedDestination);
      } catch (error) {
        console.warn("Password updated, but roles could not be loaded", error);
      }

      const invitation = new URLSearchParams(window.location.search).get("invitation");
      if (invitation && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitation)) {
        destination = `/invitation?attempt=${invitation}`;
      }

      setPageState("success");
      toast.success("Password set", {
        description: "Your password has been updated and you’re signed in.",
      });

      window.setTimeout(() => {
        router.replace(destination);
        router.refresh();
      }, 900);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Please try again.";
      setValidationError(message);
      toast.error("Couldn’t set password", { description: message });
    } finally {
      setIsSaving(false);
    }
  }

  if (pageState === "checking") {
    return (
      <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-muted">
        <div className="text-center" aria-live="polite">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-accent" />
          <p className="mt-3 text-sm text-muted-foreground">
            Verifying your secure link...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-muted p-8">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center space-x-2">
          <Image
            src="/mercurius-logo.png"
            alt="Mercurius"
            width={40}
            height={40}
            className="h-10 w-10 object-contain dark:invert"
            priority
          />
          <span className="text-xl font-semibold text-foreground">
            Mercurius
          </span>
        </Link>

        {pageState === "invalid" ? (
          <div className="space-y-4 text-center" aria-live="polite">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              This link has expired
            </h1>
            <p className="text-muted-foreground">
              Password recovery links can expire or be used only once. Request
              a new secure link to continue.
            </p>
            {linkError && (
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                {linkError}
              </p>
            )}
            <Link
              href="/forgot-password"
              className="inline-block font-medium text-accent hover:underline"
            >
              Send me a new link
            </Link>
          </div>
        ) : pageState === "success" ? (
          <div className="space-y-4 text-center" aria-live="polite">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
              <CheckCircle2 className="h-8 w-8 text-accent" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              Password updated
            </h1>
            <p className="text-muted-foreground">
              Your account is ready. We’re taking you to your portal now.
            </p>
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
          </div>
        ) : (
          <>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
              <CheckCircle2 className="h-6 w-6 text-accent" />
            </div>
            <h1 className="mb-2 text-3xl font-semibold text-foreground">
              Set your password
            </h1>
            <p className="mb-8 text-muted-foreground">
              Choose a new password to finish securing your account.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    minLength={8}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setValidationError("");
                    }}
                    required
                    autoComplete="new-password"
                    disabled={isSaving}
                    aria-describedby="password-help password-error"
                    className="h-12 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p id="password-help" className="text-xs text-muted-foreground">
                  Use at least 8 characters.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setValidationError("");
                  }}
                  required
                  autoComplete="new-password"
                  disabled={isSaving}
                  aria-describedby="password-error"
                  aria-invalid={Boolean(validationError)}
                  className="h-12"
                />
              </div>

              {validationError && (
                <p
                  id="password-error"
                  className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {validationError}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin" /> Saving...
                  </>
                ) : (
                  "Set password & continue"
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

function runRecoveryExchange(
  exchange: () => Promise<RecoveryResult>,
): Promise<RecoveryResult> {
  if (!pendingRecoveryExchange) {
    pendingRecoveryExchange = exchange().finally(() => {
      pendingRecoveryExchange = null;
    });
  }
  return pendingRecoveryExchange;
}

function clearRecoveryCredentials() {
  const url = new URL(window.location.href);
  const sensitiveParams = [
    "code",
    "token_hash",
    "type",
    "error",
    "error_code",
    "error_description",
  ];

  sensitiveParams.forEach((param) => url.searchParams.delete(param));
  url.hash = "";
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}`,
  );
}
