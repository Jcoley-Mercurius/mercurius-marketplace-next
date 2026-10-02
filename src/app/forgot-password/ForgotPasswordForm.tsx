"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ResetAudience = "homeowner" | "vendor";

// TRACE-105: vendors reach this page from the vendor sign-in and from expired
// provider links, so the page names the portal they will return to.
const audienceCopy = {
  homeowner: {
    badge: "Homeowner",
    signIn: "/login",
    placeholder: "you@example.com",
    tagline: "Request a secure reset link, then return to the home-service details and updates kept in your account.",
  },
  vendor: {
    badge: "Vendor",
    signIn: "/login/vendor",
    placeholder: "you@yourbusiness.com",
    tagline: "Request a secure reset link, then return to your vendor portal.",
  },
} as const;

export function ForgotPasswordForm({ audience }: { audience: ResetAudience }) {
  const copy = audienceCopy[audience];
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { resetPassword } = useAuth();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      toast.error("Email is required");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await resetPassword(normalizedEmail);

      if (error) {
        toast.error("Unable to send reset link", {
          description: error.message,
        });
        return;
      }

      setEmail(normalizedEmail);
      setSent(true);
    } catch (error) {
      toast.error("Unable to send reset link", {
        description:
          error instanceof Error ? error.message : "Please try again.",
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
            <Link href="/" className="mb-7 flex w-fit items-center gap-2.5">
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
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{copy.badge}</span>
            </Link>

            {sent ? (
              <div className="space-y-4 text-center" aria-live="polite">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
                  <CheckCircle2 className="h-8 w-8 text-accent" />
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  Check your email
                </h1>
                <p className="text-muted-foreground">
                  We sent a password reset link to <strong>{email}</strong>. Click
                  the link in the email to reset your password.
                </p>
                <Link
                  href={copy.signIn}
                  className="inline-flex min-h-11 items-center gap-2 font-medium text-accent hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </Link>
              </div>
            ) : (
              <>
                <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">
                  Reset your password
                </h1>
                <p className="mb-8 text-muted-foreground">
                  Enter your email and we&apos;ll send you a link to reset your
                  password.
                </p>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={copy.placeholder}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      disabled={isLoading}
                      className="h-12 bg-background"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
                    disabled={isLoading}
                  >
                    {isLoading ? "Sending..." : "Send Reset Link"}
                  </Button>
                </form>

                <p className="mt-8 text-center text-muted-foreground">
                  <Link
                    href={copy.signIn}
                    className="inline-flex min-h-11 items-center gap-2 font-medium text-accent hover:underline"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back to sign in
                  </Link>
                </p>
              </>
            )}
          </div>
        </section>

        <section
          className="relative order-2 hidden min-h-screen overflow-hidden md:order-1 md:flex md:items-end"
          aria-label="Mercurius account access"
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
              A simple path back to your account.
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-primary-foreground/80">
              {copy.tagline}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
