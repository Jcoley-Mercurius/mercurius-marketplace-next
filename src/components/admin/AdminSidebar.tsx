"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Archive, BadgePercent, BarChart3, BookOpen, CalendarClock, ChevronLeft, ClipboardList, DollarSign, FileText, House, LayoutDashboard, Loader2, LogOut, Mail, MapPin, MessageSquare, Radar, Receipt, Scale, Shield, ShieldCheck, Sparkles, Star, Tags, Ticket, TrendingUp, UserCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// MDS §6: admin navigation grouped by operator task (TRACE-136). Every route appears once.
type NavEntry = { label: string; href: string; icon: LucideIcon };
export const navigationGroups: { label: string; items: NavEntry[] }[] = [
  { label: "Marketplace Operations", items: [
    { label: "Service Requests", href: "/admin/requests", icon: ClipboardList },
    { label: "Applications", href: "/admin/applications", icon: FileText },
    { label: "Recruiting Readiness", href: "/admin/recruiting", icon: Radar },
    { label: "Vendors", href: "/admin/vendors", icon: UserCheck },
    { label: "Provider Compliance", href: "/admin/compliance", icon: ShieldCheck },
    { label: "Compliance Expiry", href: "/admin/compliance/renewals", icon: CalendarClock },
    { label: "Document Retention", href: "/admin/compliance/retention", icon: Archive },
    { label: "Homeowners", href: "/admin/homeowners", icon: House },
  ] },
  { label: "Catalog & Supply", items: [
    { label: "Service Catalog", href: "/admin/catalog", icon: BookOpen },
    { label: "Coverage Areas", href: "/admin/coverage", icon: MapPin },
    { label: "Pricing Templates", href: "/admin/pricing-templates", icon: TrendingUp },
    { label: "Vendor Prices", href: "/admin/vendor-prices", icon: Tags },
    { label: "Package Reviews", href: "/admin/pricing-reviews", icon: DollarSign },
  ] },
  { label: "Money", items: [
    { label: "Finance Reconciliation", href: "/admin/finance", icon: Scale },
    { label: "Disputes", href: "/admin/disputes", icon: AlertTriangle },
    { label: "Promotions", href: "/admin/promotions", icon: BadgePercent },
    { label: "Legacy Invoices", href: "/admin/invoices", icon: Receipt },
  ] },
  { label: "Trust & Support", items: [
    { label: "Support Tickets", href: "/admin/tickets", icon: Ticket },
    { label: "Owner Emails", href: "/admin/owner-emails", icon: Mail },
    { label: "Reviews", href: "/admin/reviews", icon: Star },
    { label: "Quality", href: "/admin/quality", icon: Shield },
    { label: "Message Audit", href: "/admin/messages", icon: MessageSquare },
  ] },
  { label: "Merchandising & Insights", items: [
    { label: "Featured Providers", href: "/admin/featured", icon: Sparkles },
    { label: "Pricing Analytics", href: "/admin/pricing-analytics", icon: BarChart3 },
  ] },
];
const overview: NavEntry = { label: "Overview", href: "/admin", icon: LayoutDashboard };
const allEntries: NavEntry[] = [overview, ...navigationGroups.flatMap((group) => group.items)];


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
        <Image src="/mercurius-logo.png" alt="Mercurius" width={40} height={40} className="h-10 w-10 object-contain dark:invert" priority />
        <div className="min-w-0"><div className="flex items-center gap-2"><Shield className="h-4 w-4 text-accent" /><p className="font-semibold">Admin</p></div><p className="text-xs text-muted-foreground">Mercurius Back Office</p></div>
      </Link>

      <nav aria-label="admin navigation" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <NavLink item={overview} pathname={pathname} onNavigate={onNavigate} />
        {navigationGroups.map((group) => {
          const id = `admin-nav-${group.label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
          return <section key={group.label} aria-labelledby={id}>
            <h2 id={id} className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</h2>
            <ul className="space-y-1">{group.items.map((item) => <li key={item.href}><NavLink item={item} pathname={pathname} onNavigate={onNavigate} /></li>)}</ul>
          </section>;
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

function NavLink({ item, pathname, onNavigate }: { item: NavEntry; pathname: string; onNavigate?: () => void }) {
  // The most specific matching entry wins, so a nested queue does not also mark its parent.
  const matches = (href: string) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const active = matches(item.href) && !allEntries.some((other) => other.href.length > item.href.length && other.href.startsWith(item.href) && matches(other.href));
  const Icon = item.icon;
  return <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors", active ? "bg-accent/10 font-medium text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="h-5 w-5" aria-hidden />{item.label}</Link>;
}
