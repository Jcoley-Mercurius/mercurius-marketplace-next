"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Menu } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { VendorSidebar } from "@/components/vendor/VendorSidebar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";

export default function VendorLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleState, setRoleState] = useState<"checking" | "allowed" | "denied">("checking");
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    let active = true;

    async function verifyVendorAccess() {
      if (!user) {
        router.replace("/login/vendor");
        if (active) setRoleState("denied");
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "vendor",
      });
      if (!active) return;
      setRoleState(!error && Boolean(data) ? "allowed" : "denied");
    }

    void verifyVendorAccess();
    return () => { active = false; };
  }, [loading, router, user]);

  if (loading || roleState === "checking" || (!user && roleState === "denied")) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Checking vendor access...</span></div>;
  }

  if (roleState === "denied") {
    return <div className="flex min-h-screen items-center justify-center bg-muted p-6"><div className="w-full max-w-md text-center"><span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100"><AlertCircle className="h-7 w-7 text-amber-700" /></span><h1 className="text-2xl font-semibold">Vendor access required</h1><p className="mt-2 text-muted-foreground">This account is not linked to an approved vendor profile.</p><div className="mt-6 flex justify-center gap-3"><Link href="/vendors/apply" className={buttonVariants()}>Apply as a Vendor</Link><Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>Homeowner Dashboard</Link></div></div></div>;
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><VendorSidebar /></aside>
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger className="lg:hidden"><Button variant="ghost" size="icon" aria-label="Open vendor menu"><Menu className="h-5 w-5" /></Button></SheetTrigger>
            <SheetContent side="left" className="w-72 p-0"><VendorSidebar onNavigate={() => setMenuOpen(false)} /></SheetContent>
          </Sheet>
          <div className="ml-3 lg:ml-0"><p className="text-sm font-medium">Vendor Portal</p><p className="text-xs text-muted-foreground">Manage your Mercurius business</p></div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
