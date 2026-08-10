"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, BarChart3, BookOpen, ChevronLeft, ClipboardList, DollarSign, FileText, House, LayoutDashboard, Loader2, LogOut, MapPin, MessageSquare, Receipt, Shield, ShieldCheck, Sparkles, Star, Ticket, TrendingUp, UserCheck, Zap } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Service Requests", href: "/admin/requests", icon: ClipboardList },
  { label: "Applications", href: "/admin/applications", icon: FileText },
  { label: "Vendors", href: "/admin/vendors", icon: UserCheck },
  { label: "Homeowners", href: "/admin/homeowners", icon: House },
  { label: "Invoices", href: "/admin/invoices", icon: Receipt },
  { label: "Service Catalog", href: "/admin/catalog", icon: BookOpen },
  { label: "Coverage Areas", href: "/admin/coverage", icon: MapPin },
  { label: "Pricing Templates", href: "/admin/pricing-templates", icon: TrendingUp },
  { label: "Package Reviews", href: "/admin/pricing-reviews", icon: DollarSign },
  { label: "Pricing Analytics", href: "/admin/pricing-analytics", icon: BarChart3 },
  { label: "Smart Picks", href: "/admin/smart-picks", icon: Zap },
  { label: "Featured Providers", href: "/admin/featured", icon: Sparkles },
  { label: "Reviews", href: "/admin/reviews", icon: Star },
  { label: "Disputes", href: "/admin/disputes", icon: AlertTriangle },
  { label: "Quality", href: "/admin/quality", icon: ShieldCheck },
  { label: "Support Tickets", href: "/admin/tickets", icon: Ticket },
  { label: "Message Audit", href: "/admin/messages", icon: MessageSquare },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
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
      router.replace("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <Link href="/admin" onClick={onNavigate} className="flex h-20 items-center gap-3 border-b border-border px-5">
        <Image src="/mercurius-logo.png" alt="Mercurius" width={40} height={40} className="h-10 w-10 object-contain" priority />
        <div className="min-w-0"><div className="flex items-center gap-2"><Shield className="h-4 w-4 text-accent" /><p className="font-semibold">Admin</p></div><p className="text-xs text-muted-foreground">Mercurius Back Office</p></div>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Platform</p>
        {navigation.map((item) => {
          const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors", active ? "bg-accent/10 font-medium text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="h-5 w-5" />{item.label}</Link>;
        })}
      </nav>

      <div className="space-y-1 border-t border-border p-3">
        <Link href="/" onClick={onNavigate} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronLeft className="h-5 w-5" />Back to site</Link>
        <Button variant="ghost" disabled={isSigningOut} onClick={() => void handleSignOut()} className="h-11 w-full justify-start gap-3 text-muted-foreground hover:text-foreground">
          {isSigningOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
          {isSigningOut ? "Signing Out..." : "Sign Out"}
        </Button>
      </div>
    </div>
  );
}
