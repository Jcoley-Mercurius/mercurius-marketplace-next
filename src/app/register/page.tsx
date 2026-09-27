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
import { requestContinuationPath } from "@/lib/auth/continuation";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signUp } = useAuth();
  const router = useRouter();
  const [continuation, setContinuation] = useState<"/request" | null>(null);
  const loginPath = continuation ? `/login?redirect=${encodeURIComponent(continuation)}` : "/login";

  useEffect(() => {
    // Read after mount so the server and client render the same link.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContinuation(requestContinuationPath(new URLSearchParams(window.location.search).get("redirect")));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Password too short", { description: "Must be at least 8 characters" });
      return;
    }

    setIsLoading(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const { error } = await signUp(email.trim(), password, fullName);
      if (error) {
        toast.error("Sign up failed", { description: error.message });
        return;
      }
      toast.success("Check your email", {
        description: continuation
          ? "We sent you a verification link. After you verify, sign in here to finish your request; keep this tab open."
          : "We sent you a verification link. Please verify your email to sign in.",
      });
      router.replace(loginPath);
    } catch (error) {
      toast.error("Unable to create your account", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-background">
      <div className="grid min-h-screen md:grid-cols-[minmax(0,1fr)_minmax(28rem,0.9fr)] xl:grid-cols-[1.15fr_0.85fr]">
        <section className="order-1 flex items-center justify-center bg-muted/60 px-4 py-8 sm:px-8 md:order-2 md:px-10 md:py-12 xl:px-16">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl sm:p-8 lg:p-10">
          <Link href="/" className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <Link href="/" className="mb-8 flex w-fit items-center gap-2.5">
            <Image src="/mercurius-logo.png" alt="Mercurius" width={40} height={40} className="h-10 w-10 object-contain dark:invert" priority />
            <span className="text-xl font-semibold text-foreground">Mercurius</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Homeowner</span>
          </Link>

          <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">Create your homeowner account</h1>
          <p className="mb-8 text-muted-foreground">Manage your home services with Mercurius</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" autoComplete="given-name" placeholder="John" required disabled={isLoading} className="h-12 bg-background" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" autoComplete="family-name" placeholder="Doe" required disabled={isLoading} className="h-12 bg-background" value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" required disabled={isLoading} className="h-12 bg-background" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} placeholder="••••••••" required disabled={isLoading} className="h-12 bg-background pr-12" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
            </div>

            <Button type="submit" size="lg" className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active" disabled={isLoading}>
              {isLoading ? "Creating account..." : "Create Homeowner Account"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              By creating an account, you agree to our <Link href="/terms" className="text-accent hover:underline">Terms of Service</Link>{" "}
              and <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link>
            </p>
          </form>

          <p className="mt-8 text-center text-muted-foreground">
            Already have an account? <Link href={loginPath} className="font-medium text-accent hover:underline">Sign in</Link>
          </p>
          </div>
        </section>

        <section
          className="relative order-2 hidden min-h-screen overflow-hidden md:order-1 md:flex md:items-end"
          aria-label="Mercurius homeowner services"
        >
          <Image src="/hero-home-duotone.jpg" alt="" fill sizes="(min-width: 1280px) 58vw, 50vw" className="object-cover object-center" priority />
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/55 to-primary/15" />

          <Link href="/" className="absolute left-10 top-10 flex items-center gap-3 xl:left-14 xl:top-12">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-card shadow-md">
              <Image src="/mercurius-logo.png" alt="" width={40} height={40} className="h-10 w-10 object-contain dark:invert" />
            </span>
            <span className="text-xl font-semibold text-primary-foreground">Mercurius</span>
          </Link>

          <div className="relative max-w-xl p-10 pb-14 xl:p-14 xl:pb-16">
            <h2 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-primary-foreground xl:text-5xl">
              A clearer way to care for your home.
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-primary-foreground/80">
              Create your account to request local services, follow confirmed work, and keep important home-service details organized.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
