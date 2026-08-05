"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Home } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signUp } = useAuth();
  const router = useRouter();

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
        description: "We sent you a verification link. Please verify your email to sign in.",
      });
      router.replace("/login");
    } catch (error) {
      toast.error("Unable to create your account", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-muted">
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <Link href="/" className="mb-8 flex items-center space-x-2">
            <Image src="/mercurius-logo.png" alt="Mercurius" width={40} height={40} className="h-10 w-10 object-contain" priority />
            <span className="text-xl font-semibold text-foreground">Mercurius</span>
          </Link>

          <h1 className="mb-2 text-3xl font-semibold text-foreground">Create your homeowner account</h1>
          <p className="mb-8 text-muted-foreground">Manage your home services with Mercurius</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" autoComplete="given-name" placeholder="John" required disabled={isLoading} className="h-12" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" autoComplete="family-name" placeholder="Doe" required disabled={isLoading} className="h-12" value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" required disabled={isLoading} className="h-12" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} placeholder="••••••••" required disabled={isLoading} className="h-12 pr-12" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
            </div>

            <Button type="submit" size="lg" className="h-12 w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={isLoading}>
              {isLoading ? "Creating account..." : "Create Homeowner Account"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              By creating an account, you agree to our <Link href="/terms" className="text-accent hover:underline">Terms of Service</Link>{" "}
              and <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link>
            </p>
          </form>

          <p className="mt-8 text-center text-muted-foreground">
            Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
          </p>
        </div>
      </div>

      <div className="hidden flex-1 items-center justify-center bg-primary p-12 lg:flex">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-accent/20">
            <Home className="h-12 w-12 text-accent" />
          </div>
          <h2 className="mb-4 text-3xl font-semibold !text-primary-foreground">Your home, handled</h2>
          <p className="text-lg text-primary-foreground/70">
            Create your homeowner account to book trusted services and keep your home running smoothly.
          </p>
        </div>
      </div>
    </div>
  );
}
