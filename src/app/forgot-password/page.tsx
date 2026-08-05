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

export default function ForgotPasswordPage() {
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
    <div className="flex min-h-screen items-center justify-center bg-muted p-8">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center space-x-2">
          <Image
            src="/mercurius-logo.png"
            alt="Mercurius"
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
            priority
          />
          <span className="text-xl font-semibold text-foreground">
            Mercurius
          </span>
        </Link>

        {sent ? (
          <div className="space-y-4 text-center" aria-live="polite">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
              <CheckCircle2 className="h-8 w-8 text-accent" />
            </div>
            <h1 className="text-3xl font-semibold text-foreground">
              Check your email
            </h1>
            <p className="text-muted-foreground">
              We sent a password reset link to <strong>{email}</strong>. Click
              the link in the email to reset your password.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
            >
              <ArrowLeft className="h-4 w-4" /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-2 text-3xl font-semibold text-foreground">
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
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={isLoading}
                  className="h-12"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={isLoading}
              >
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>

            <p className="mt-8 text-center text-muted-foreground">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 font-medium text-accent hover:underline"
              >
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
