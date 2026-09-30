"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestContinuationPath } from "@/lib/auth/continuation";
import { EARLY_ACCESS_EMAIL_KEY, isExistingAccountSignUpError } from "@/lib/earlyAccessExperience";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signUp } = useAuth();
  const [continuation, setContinuation] = useState<"/request" | null>(null);
  const [sent, setSent] = useState(false);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const loginPath = continuation ? `/login?redirect=${encodeURIComponent(continuation)}` : "/login";

  useEffect(() => {
    // Read after mount so the server and client render the same link.
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContinuation(requestContinuationPath(params.get("redirect")));
    // TRACE-103: the address just joined in this tab, passed without putting it in a URL.
    if (params.get("from") === "early-access") {
      try {
        const joined = window.sessionStorage.getItem(EARLY_ACCESS_EMAIL_KEY);
        if (joined) setEmail(joined);
      } catch { /* The field stays empty. */ }
    }
  }, []);

  useEffect(() => { if (sent) sentHeading.current?.focus(); }, [sent]);

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
      // TRACE-103: new and existing addresses get the same answer, so this public step
      // never reveals whether an account exists. Other errors (such as a weak password) show.
      if (error && !isExistingAccountSignUpError(error as { code?: unknown; message?: unknown })) {
        toast.error("Sign up failed", { description: error.message });
        return;
      }
      try { window.sessionStorage.removeItem(EARLY_ACCESS_EMAIL_KEY); } catch { /* Nothing to clear. */ }
      setSent(true);
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

          {sent ? (
            <section aria-labelledby="register-sent-heading" role="status">
              <MailCheck aria-hidden="true" className="mb-4 h-9 w-9 text-sage-dark" />
              <h1 id="register-sent-heading" ref={sentHeading} tabIndex={-1} className="mb-3 text-3xl font-semibold tracking-tight text-foreground">Check your email</h1>
              <p className="text-muted-foreground">If this email address can be used for a new account, we’ve sent a verification link to it. Open the link, then sign in to see your early-access status.</p>
              <p className="mt-3 text-sm text-muted-foreground">Your account isn’t active until the email is verified. Didn’t get an email? Check spam, or sign in if you already have an account.</p>
              <Link href={loginPath} className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-4 font-medium text-accent-foreground hover:bg-accent-hover">Go to sign in</Link>
            </section>
          ) : <>
          <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">Create your homeowner account</h1>
          <p className="mb-2 text-muted-foreground">Keep your account ready and see your early-access status.</p>
          <p className="mb-8 text-sm text-muted-foreground">Booking opens by invitation. Creating an account doesn’t book a service or guarantee an invitation.</p>

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
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Not ready for an account? <Link href="/early-access" className="font-medium text-accent hover:underline">Join early access without one</Link>
          </p>
          </>}
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
              Explore local services now. Booking opens to invited Lee County homeowners in stages as approved providers become available.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
