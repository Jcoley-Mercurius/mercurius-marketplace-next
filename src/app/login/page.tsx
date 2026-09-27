"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchRoles,
  postLoginPathForRoles,
} from "@/lib/auth/roles";
import { requestContinuationPath } from "@/lib/auth/continuation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const [continuation, setContinuation] = useState<"/request" | null>(null);

  useEffect(() => {
    // Read after mount so the server and client render the same link.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContinuation(requestContinuationPath(new URLSearchParams(window.location.search).get("redirect")));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password) {
      toast.error("Email and password are required");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await signIn(email.trim(), password);

      if (error) {
        toast.error("Sign in failed", { description: error.message });
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const requestedDestination = searchParams.get("redirect");
      const supabase = createClient();
      const { data: userResult, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userResult.user) {
        throw userError ?? new Error("Unable to verify your account.");
      }

      const roles = await fetchRoles(userResult.user.id);
      const destination = postLoginPathForRoles(
        roles,
        requestedDestination,
      );

      router.replace(destination);
      router.refresh();
    } catch (error) {
      toast.error("Unable to finish signing in", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="grid min-h-screen md:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)] xl:grid-cols-[1.15fr_0.85fr]">
        <section className="order-1 flex items-center justify-center bg-muted/60 px-4 py-8 sm:px-8 md:order-2 md:px-10 md:py-12 xl:px-16">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl sm:p-8 lg:p-10">
            <Link
              href="/"
              className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>

            <Link href="/" className="mb-8 flex w-fit items-center gap-2.5">
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
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Homeowner</span>
            </Link>

            <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p className="mb-8 text-muted-foreground">
              Sign in to access your account
            </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={isLoading}
                className="h-12 bg-background"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="inline-flex min-h-11 items-center text-sm text-accent hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={isLoading}
                  className="h-12 bg-background pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
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
            </div>

            <Button
              type="submit"
              size="lg"
              className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
              disabled={isLoading}
            >
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <p className="mt-8 text-center text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href={continuation ? `/register?redirect=${encodeURIComponent(continuation)}` : "/register"}
              className="font-medium text-accent hover:underline"
            >
              Create one
            </Link>
          </p>
          </div>
        </section>

        <section
          className="relative order-2 hidden min-h-screen overflow-hidden md:order-1 md:flex md:items-end"
          aria-label="Mercurius homeowner services"
        >
          <Image
            src="/hero-home-duotone.jpg"
            alt=""
            fill
            sizes="(min-width: 1280px) 58vw, 50vw"
            className="object-cover object-center"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/55 to-primary/15" />

          <Link href="/" className="absolute left-10 top-10 flex items-center gap-3 xl:left-14 xl:top-12">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-card shadow-md">
              <Image
                src="/mercurius-logo.png"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 object-contain dark:invert"
              />
            </span>
            <span className="text-xl font-semibold text-primary-foreground">Mercurius</span>
          </Link>

          <div className="relative max-w-xl p-10 pb-14 xl:p-14 xl:pb-16">
            <h2 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-primary-foreground xl:text-5xl">
              Home care, clearly coordinated.
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-primary-foreground/80">
              Sign in to review service requests, follow job progress, and keep important home-service details in one place.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
