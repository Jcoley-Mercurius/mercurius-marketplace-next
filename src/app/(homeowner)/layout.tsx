"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Menu } from "lucide-react";
import { HomeownerSidebar } from "@/components/homeowner/HomeownerSidebar";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { defaultPathForRoles, fetchRoles } from "@/lib/auth/roles";

type AccessState = "checking" | "allowed" | "denied" | "error";

export default function HomeownerPortalLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [accessError, setAccessError] = useState("");
  const { user, loading } = useAuth();
  const router = useRouter();

  const verifyHomeownerAccess = useCallback(async () => {
    if (!user) return;
    setAccessState("checking");
    setAccessError("");

    try {
      const roles = await fetchRoles(user.id);
      if (roles.includes("homeowner")) {
        setAccessState("allowed");
        return;
      }

      setAccessState("denied");
      if (roles.includes("admin") || roles.includes("vendor")) {
        router.replace(defaultPathForRoles(roles));
      }
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "Your homeowner access could not be verified.",
      );
      setAccessState("error");
    }
  }, [router, user]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      if (!user) {
        const destination = `${window.location.pathname}${window.location.search}`;
        router.replace(`/login?redirect=${encodeURIComponent(destination)}`);
        return;
      }
      void verifyHomeownerAccess();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loading, router, user, verifyHomeownerAccess]);

  if (loading || !user || accessState === "checking") {
    return <PortalLoading label="Checking homeowner access..." />;
  }

  if (accessState === "error") {
    return (
      <AccessStatePage
        title="We couldn’t verify your homeowner account"
        description={accessError || "Please try again."}
        action={
          <Button onClick={() => void verifyHomeownerAccess()}>Try again</Button>
        }
      />
    );
  }

  if (accessState === "denied") {
    return (
      <AccessStatePage
        title="Homeowner access required"
        description="This account does not currently have a homeowner role."
        action={
          <Link href="/" className={buttonVariants()}>
            Return to main site
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Suspense fallback={<SidebarLoading />}>
          <HomeownerSidebar />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger className="lg:hidden" render={<Button variant="ghost" size="icon" />} aria-label="Open homeowner menu"><Menu className="h-5 w-5" /></SheetTrigger>
            <SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Homeowner navigation</SheetTitle><SheetDescription className="sr-only">Navigate your Mercurius homeowner account.</SheetDescription>
              <Suspense fallback={<SidebarLoading />}>
                <HomeownerSidebar onNavigate={() => setMenuOpen(false)} />
              </Suspense>
            </SheetContent>
          </Sheet>
          <div className="ml-3 lg:ml-0">
            <p className="text-sm font-medium">Homeowner Portal</p>
            <p className="text-xs text-muted-foreground">
              Manage your Mercurius services
            </p>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
          <Suspense fallback={<PortalContentLoading />}>
            {children}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function PortalLoading({ label }: { label: string }) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />
      <span className="text-muted-foreground">{label}</span>
    </main>
  );
}

function PortalContentLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
      <span className="sr-only">Loading homeowner portal</span>
    </div>
  );
}

function SidebarLoading() {
  return <div className="h-full border-r border-border-strong bg-warm-white" />;
}

function AccessStatePage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
          <AlertCircle className="h-7 w-7 text-amber-700 dark:text-amber-300" />
        </span>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
        <div className="mt-6 flex justify-center">{action}</div>
      </div>
    </main>
  );
}
