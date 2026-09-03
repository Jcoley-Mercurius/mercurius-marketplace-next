"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BadgePercent, Briefcase, DollarSign, Home, LayoutDashboard, Loader2, LogOut, Megaphone, MessageSquare, User } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Overview", href: "/vendor", icon: LayoutDashboard },
  { label: "Jobs & Requests", href: "/vendor/jobs", icon: Briefcase },
  { label: "Messages", href: "/vendor/messages", icon: MessageSquare },
  { label: "Pricing & Packages", href: "/vendor/packages", icon: DollarSign },
  { label: "Marketing Tools", href: "/vendor/marketing", icon: Megaphone },
  { label: "Plans", href: "/vendor/plan", icon: BadgePercent, note: "Free" },
  { label: "Profile", href: "/vendor/profile", icon: User },
];

export function VendorSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      onNavigate?.();
      router.replace("/login/vendor");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col border-r border-border-strong bg-warm-white text-foreground shadow-sm">
      <Link href="/vendor" onClick={onNavigate} className="flex h-20 items-center gap-3 border-b border-border-strong px-5">
        <Image src="/mercurius-logo.png" alt="Mercurius" width={44} height={44} className="h-11 w-11 object-contain dark:invert" priority />
        <div><p className="font-semibold text-slate-dark">Vendor Portal</p><p className="text-xs text-muted-foreground">Mercurius</p></div>
      </Link>

      <nav aria-label="vendor navigation" className="min-h-0 overflow-y-auto flex-1 space-y-1 p-3">
        <p className="px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Navigation</p>
        {navigation.map((item) => {
          const active = item.href === "/vendor"
            ? pathname === item.href
            : item.href === "/vendor/packages"
              ? pathname.startsWith("/vendor/packages") || pathname.startsWith("/vendor/pricing")
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors", active ? "border-accent-border bg-accent-soft font-medium text-sage-dark shadow-sm" : "text-slate hover:bg-surface-hover hover:text-slate-dark")}><Icon className={cn("h-5 w-5", active ? "text-sage-dark" : "text-muted-foreground")} /><span className="min-w-0 flex-1">{item.label}</span>{item.note && <span className={cn("rounded-full border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide", active ? "border-accent-border bg-background text-sage-dark" : "border-border-strong bg-muted/50 text-muted-foreground")}>{item.note}</span>}</Link>;
        })}
      </nav>

      <div className="space-y-1 border-t border-border-strong p-3">
        <Link href="/" onClick={onNavigate} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-slate-dark"><Home className="h-5 w-5" />Main site</Link>
        <Button variant="ghost" disabled={isSigningOut} onClick={() => void handleSignOut()} className="h-11 w-full justify-start gap-3 text-muted-foreground hover:bg-surface-hover hover:text-slate-dark">
          {isSigningOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
          {isSigningOut ? "Signing Out..." : "Sign Out"}
        </Button>
      </div>
    </div>
  );
}
