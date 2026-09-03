"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Menu, Shield } from "lucide-react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    let active = true;
    async function verifyAdmin() {
      if (!user) {
        router.replace("/login?redirect=/admin");
        if (active) setAccess("denied");
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (active) setAccess(!error && Boolean(data) ? "allowed" : "denied");
    }
    void verifyAdmin();
    return () => { active = false; };
  }, [loading, router, user]);

  if (loading || access === "checking" || (!user && access === "denied")) {
    return <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Checking admin access...</span></main>;
  }
  if (access === "denied") {
    return <main id="main-content" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-muted p-6"><div className="max-w-md text-center"><span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-100"><AlertTriangle className="h-7 w-7 text-red-700" /></span><h1 className="text-2xl font-semibold">Admin access required</h1><p className="mt-2 text-muted-foreground">This account does not have permission to use the Mercurius back office.</p><Link href="/dashboard" className={`${buttonVariants({ variant: "outline" })} mt-6`}>Return to Dashboard</Link></div></main>;
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><AdminSidebar /></aside>
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger className="lg:hidden" render={<Button variant="ghost" size="icon" />} aria-label="Open admin menu"><Menu className="h-5 w-5" /></SheetTrigger>
            <SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">Admin navigation</SheetTitle><SheetDescription className="sr-only">Navigate your Mercurius admin account.</SheetDescription><AdminSidebar onNavigate={() => setMenuOpen(false)} /></SheetContent>
          </Sheet>
          <div className="ml-3 flex items-center gap-2 lg:ml-0"><Shield className="h-4 w-4 text-accent" /><div><p className="text-sm font-medium">Mercurius Admin</p><p className="text-xs text-muted-foreground">Platform operations</p></div></div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
