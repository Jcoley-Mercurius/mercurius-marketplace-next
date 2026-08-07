"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, CreditCard, DollarSign, Home, LayoutDashboard, Loader2, LogOut, Megaphone, MessageSquare, User } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Overview", href: "/vendor", icon: LayoutDashboard },
  { label: "Jobs & Requests", href: "/vendor/jobs", icon: Briefcase },
  { label: "Messages", href: "/vendor/messages", icon: MessageSquare },
  { label: "Pricing & Packages", href: "/vendor/packages", icon: DollarSign },
  { label: "Marketing", href: "/vendor/marketing", icon: Megaphone },
  { label: "Plan", href: "/vendor/plan", icon: CreditCard },
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
    <div className="flex h-full flex-col bg-primary text-primary-foreground">
      <Link href="/vendor" onClick={onNavigate} className="flex h-20 items-center gap-3 border-b border-primary-foreground/10 px-5">
        <Image src="/mercurius-logo.png" alt="Mercurius" width={44} height={44} className="h-11 w-11 object-contain" priority />
        <div><p className="font-semibold">Vendor Portal</p><p className="text-xs text-primary-foreground/50">Mercurius</p></div>
      </Link>

      <nav className="flex-1 space-y-1 p-3">
        <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/40">Navigation</p>
        {navigation.map((item) => {
          const active = item.href === "/vendor"
            ? pathname === item.href
            : item.href === "/vendor/packages"
              ? pathname.startsWith("/vendor/packages") || pathname.startsWith("/vendor/pricing")
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors", active ? "bg-primary-foreground/12 font-medium text-primary-foreground" : "text-primary-foreground/65 hover:bg-primary-foreground/8 hover:text-primary-foreground")}><Icon className="h-5 w-5" />{item.label}</Link>;
        })}
      </nav>

      <div className="space-y-1 border-t border-primary-foreground/10 p-3">
        <Link href="/" onClick={onNavigate} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-primary-foreground/60 hover:bg-primary-foreground/8 hover:text-primary-foreground"><Home className="h-5 w-5" />Main site</Link>
        <Button variant="ghost" disabled={isSigningOut} onClick={() => void handleSignOut()} className="h-11 w-full justify-start gap-3 text-primary-foreground/60 hover:bg-primary-foreground/8 hover:text-primary-foreground">
          {isSigningOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
          {isSigningOut ? "Signing Out..." : "Sign Out"}
        </Button>
      </div>
    </div>
  );
}
