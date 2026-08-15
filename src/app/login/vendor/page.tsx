"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchRoles,
  postLoginPathForRoles,
} from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function VendorLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { signIn, signOut } = useAuth();
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

      const supabase = createClient();
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult.user) {
        throw userError ?? new Error("Unable to verify your account.");
      }

      let roles: string[];
      try {
        roles = await fetchRoles(userResult.user.id);
      } catch {
        await signOut();
        toast.error("Unable to verify vendor access", {
          description: "Please try again or contact Mercurius support.",
        });
        return;
      }

      const requestedDestination = new URLSearchParams(
        window.location.search,
      ).get("redirect");
      const destination = postLoginPathForRoles(
        roles,
        requestedDestination,
      );

      if (!roles.includes("vendor")) {
        toast.info("This account does not have vendor access", {
          description: destination.startsWith("/admin")
            ? "We’ll take you to your admin portal instead."
            : destination.startsWith("/dashboard")
              ? "We’ll take you to your homeowner dashboard instead."
              : "We’ll continue to your requested page instead.",
        });
      }

      router.replace(destination);
      router.refresh();
    } catch (error) {
      toast.error("Unable to finish signing in", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="grid min-h-screen md:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)] xl:grid-cols-[1.15fr_0.85fr]">
        <section className="order-1 flex items-center justify-center bg-muted/60 px-4 py-8 sm:px-8 md:order-2 md:px-10 md:py-12 xl:px-16">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl sm:p-8 lg:p-10">
            <Link href="/" className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>

            <Link href="/" className="mb-8 flex w-fit items-center gap-2.5">
              <Image src="/mercurius-logo.png" alt="Mercurius" width={40} height={40} className="h-10 w-10 object-contain" priority />
              <span className="text-xl font-semibold text-foreground">Mercurius</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Vendor</span>
            </Link>

            <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">Vendor sign in</h1>
            <p className="mb-8 text-muted-foreground">Access your vendor portal and manage your business.</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="vendor-email">Email</Label>
                <Input id="vendor-email" type="email" inputMode="email" autoComplete="email" placeholder="you@yourbusiness.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isLoading} className="h-12 bg-background" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="vendor-password">Password</Label>
                  <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">Forgot password?</Link>
                </div>
                <div className="relative">
                  <Input id="vendor-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isLoading} className="h-12 bg-background pr-12" />
                  <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <Button type="submit" size="lg" disabled={isLoading} className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active">
                {isLoading ? <><LoaderLabel /> Signing in...</> : "Sign In to Portal"}
              </Button>
            </form>

            <div className="mt-6 rounded-xl border border-border bg-muted/50 p-4">
              <p className="text-sm font-medium">Not yet a vendor?</p>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">Vendor accounts are created after approval. Apply and our team will help you get set up.</p>
              <Link href="/vendors/apply" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 w-full border-accent text-accent hover:bg-accent hover:text-accent-foreground")}>Apply to become a vendor <ArrowRight className="h-3 w-3" /></Link>
            </div>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Looking for homeowner login? <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">Sign in here →</Link>
            </p>
          </div>
        </section>

        <section
          className="relative order-2 hidden min-h-screen overflow-hidden md:order-1 md:flex md:items-end"
          aria-label="Mercurius vendor services"
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
              <Image src="/mercurius-logo.png" alt="" width={40} height={40} className="h-10 w-10 object-contain" />
            </span>
            <span className="text-xl font-semibold text-primary-foreground">Mercurius</span>
          </Link>

          <div className="relative max-w-xl p-10 pb-14 xl:p-14 xl:pb-16">
            <h2 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-primary-foreground xl:text-5xl">
              Local work, clearly coordinated.
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-primary-foreground/80">
              Sign in to review matched opportunities, manage active jobs, and keep homeowner updates organized in one managed marketplace.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function LoaderLabel() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" aria-hidden="true" />;
}
