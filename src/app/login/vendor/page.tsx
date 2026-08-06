"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Eye,
  EyeOff,
  Inbox,
  LayoutDashboard,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const benefits = [
  "Consistent job flow, no cold outreach",
  "Platform-managed scheduling and payments",
  "Photo documentation protects your work",
  "A professional profile built to convert",
];

const portalFeatures = [
  { icon: LayoutDashboard, label: "Overview Dashboard", description: "Your business at a glance" },
  { icon: Inbox, label: "Incoming Requests", description: "Review new opportunities" },
  { icon: Briefcase, label: "Job Management", description: "Track active and completed work" },
  { icon: TrendingUp, label: "Growth Tools", description: "Strengthen your profile" },
];

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

      const { data: isVendor, error: roleError } = await supabase.rpc("has_role", {
        _user_id: userResult.user.id,
        _role: "vendor",
      });

      if (roleError) {
        await signOut();
        toast.error("Unable to verify vendor access", {
          description: "Please try again or contact Mercurius support.",
        });
        return;
      }

      if (!isVendor) {
        toast.info("This account does not have vendor access", {
          description: "We’ll take you to your homeowner dashboard instead.",
        });
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      router.replace("/vendor");
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
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden flex-1 overflow-hidden bg-cta-section p-12 lg:flex lg:items-center lg:justify-center">
        <div className="pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-accent/20 blur-[100px]" />
        <div className="relative max-w-lg">
          <Image src="/mercurius-logo.png" alt="Mercurius" width={56} height={56} className="mb-8 h-14 w-14 object-contain" priority />
          <h2 className="mb-4 text-4xl font-semibold leading-tight !text-primary-foreground">
            Focus on the Work.<br />We Handle the Business.
          </h2>
          <p className="mb-9 text-lg text-primary-foreground/60">
            No cold outreach. No chasing payments. Just consistent jobs,
            managed scheduling, and tools to grow.
          </p>

          <ul className="mb-9 space-y-3">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3 text-primary-foreground/80">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                {benefit}
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-2 gap-3">
            {portalFeatures.map(({ icon: Icon, label, description }) => (
              <div key={label} className="rounded-xl border border-primary-foreground/10 bg-primary-foreground/5 p-4">
                <Icon className="mb-2 h-5 w-5 text-accent" />
                <p className="text-sm font-medium text-primary-foreground">{label}</p>
                <p className="mt-0.5 text-xs text-primary-foreground/50">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>

          <Link href="/" className="mb-8 flex items-center gap-2">
            <Image src="/mercurius-logo.png" alt="Mercurius" width={40} height={40} className="h-10 w-10 object-contain" />
            <span className="text-xl font-semibold">Mercurius</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Vendor</span>
          </Link>

          <h1 className="mb-2 text-3xl font-semibold">Vendor sign in</h1>
          <p className="mb-8 text-muted-foreground">Access your vendor portal and manage your business.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="vendor-email">Email</Label>
              <Input id="vendor-email" type="email" inputMode="email" autoComplete="email" placeholder="you@yourbusiness.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isLoading} className="h-12" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="vendor-password">Password</Label>
                <Link href="/forgot-password" className="text-sm text-accent hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Input id="vendor-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isLoading} className="h-12 pr-12" />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" disabled={isLoading} className="h-12 w-full bg-primary text-primary-foreground hover:bg-primary/90">
              {isLoading ? <><LoaderLabel /> Signing in...</> : "Sign In to Portal"}
            </Button>
          </form>

          <div className="mt-6 rounded-xl border border-border bg-muted/50 p-4">
            <p className="text-sm font-medium">Not yet a vendor?</p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">Vendor accounts are created after approval. Apply and our team will help you get set up.</p>
            <Link href="/vendors/apply" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full border-accent text-accent hover:bg-accent hover:text-accent-foreground")}>Apply to become a vendor <ArrowRight className="h-3 w-3" /></Link>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Looking for homeowner login? <Link href="/login" className="font-medium text-accent hover:underline">Sign in here →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function LoaderLabel() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" aria-hidden="true" />;
}
