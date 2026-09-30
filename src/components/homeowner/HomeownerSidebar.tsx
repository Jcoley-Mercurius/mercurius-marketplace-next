"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  CalendarDays,
  CreditCard,
  History,
  Home,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  ReceiptText,
  Settings,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useHomeownerAccess } from "@/components/homeowner/HomeownerAccessProvider";
import { Button } from "@/components/ui/button";
import {
  type DashboardSection,
  dashboardSectionFromParam,
  dashboardSectionHref,
} from "@/lib/homeownerPortal";
import { cn } from "@/lib/utils";

const dashboardNavigation: Array<{
  label: string;
  section: DashboardSection;
  icon: typeof LayoutDashboard;
}> = [
  { label: "Overview", section: "overview", icon: LayoutDashboard },
  { label: "Upcoming", section: "upcoming", icon: CalendarDays },
  { label: "Past Services", section: "past", icon: History },
  { label: "Invoices", section: "invoices", icon: ReceiptText },
  { label: "Payment Methods", section: "payment-methods", icon: CreditCard },
];

const accountNavigation = [
  { label: "Messages", href: "/messages", icon: MessageSquare },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Account Settings", href: "/account", icon: Settings },
];

export function HomeownerSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { signOut } = useAuth();
  const access = useHomeownerAccess();
  // TRACE-103 (R0.3): Request Service only for an admitted account. A waiting account with
  // no history sees no empty job, invoice, payment or message areas; history keeps them.
  const canRequest = access.status === "ready" && access.booking === "invited";
  const waitingOnly = access.status === "ready" && access.booking !== "invited" && !access.hasHistory;
  const serviceLinks = waitingOnly ? dashboardNavigation.filter((item) => item.section === "overview") : dashboardNavigation;
  const accountLinks = waitingOnly ? accountNavigation.filter((item) => item.href !== "/messages") : accountNavigation;
  const activeSection = dashboardSectionFromParam(searchParams.get("tab"));

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
    <div className="flex h-full flex-col border-r border-border-strong bg-warm-white text-foreground shadow-sm">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex h-20 items-center gap-3 border-b border-border-strong px-5"
      >
        <Image
          src="/mercurius-logo.png"
          alt="Mercurius"
          width={44}
          height={44}
          className="h-11 w-11 object-contain dark:invert"
          priority
        />
        <div>
          <p className="font-semibold text-slate-dark">Homeowner Portal</p>
          <p className="text-xs text-muted-foreground">Mercurius</p>
        </div>
      </Link>

      <nav aria-label="homeowner navigation" className="min-h-0 flex-1 overflow-y-auto p-3">
        {canRequest && (
          <Link
            href="/request"
            onClick={onNavigate}
            className="mb-4 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover active:bg-accent-active"
          >
            <Plus className="h-4 w-4" />
            Request Service
          </Link>
        )}

        <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Services
        </p>
        <div className="space-y-1">
          {serviceLinks.map((item) => {
            const active =
              pathname === "/dashboard" && activeSection === item.section;
            const Icon = item.icon;
            return (
              <Link
                key={item.section}
                href={dashboardSectionHref(item.section)}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={navItemClass(active)}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active ? "text-commitment" : "text-muted-foreground",
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <p className="px-3 pb-2 pt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Account
        </p>
        <div className="space-y-1">
          {accountLinks.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={navItemClass(active)}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active ? "text-commitment" : "text-muted-foreground",
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="space-y-1 border-t border-border-strong p-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-slate-dark"
        >
          <Home className="h-5 w-5" />
          Main site
        </Link>
        <Button
          variant="ghost"
          disabled={isSigningOut}
          onClick={() => void handleSignOut()}
          className="h-11 w-full justify-start gap-3 text-muted-foreground hover:bg-surface-hover hover:text-slate-dark"
        >
          {isSigningOut ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <LogOut className="h-5 w-5" />
          )}
          {isSigningOut ? "Signing Out..." : "Sign Out"}
        </Button>
      </div>
    </div>
  );
}

function navItemClass(active: boolean) {
  return cn(
    "flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors",
    active
      ? "border-accent-border bg-accent-soft font-medium text-commitment shadow-sm"
      : "text-slate hover:bg-surface-hover hover:text-slate-dark",
  );
}
