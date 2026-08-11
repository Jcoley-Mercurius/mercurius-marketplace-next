"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  CircleUserRound,
  Home,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  UserPlus,
  Wrench,
} from "lucide-react";
import { fetchRoles } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useNotifications } from "@/hooks/useNotifications";

const accountPortals = [
  {
    role: "admin",
    roleLabel: "Admin",
    linkLabel: "Admin Portal",
    href: "/admin",
    icon: Shield,
  },
  {
    role: "vendor",
    roleLabel: "Vendor",
    linkLabel: "Vendor Portal",
    href: "/vendor",
    icon: Wrench,
  },
  {
    role: "homeowner",
    roleLabel: "Homeowner",
    linkLabel: "Homeowner Dashboard",
    href: "/dashboard",
    icon: Home,
  },
] as const;

type RoleState = {
  userId: string;
  roles: string[];
  status: "loaded" | "error";
};

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [roleState, setRoleState] = useState<RoleState | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;

    void fetchRoles(userId)
      .then((roles) => {
        if (active) {
          setRoleState({ userId, roles, status: "loaded" });
        }
      })
      .catch((error) => {
        console.error("Unable to load Header account roles", error);
        if (active) {
          setRoleState({ userId, roles: [], status: "error" });
        }
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const currentRoleState =
    userId && roleState?.userId === userId ? roleState : null;
  const rolesLoading = Boolean(userId && !currentRoleState);
  const portalLinks = accountPortals.filter(({ role }) =>
    currentRoleState?.roles.includes(role),
  );
  const isHomeowner = Boolean(currentRoleState?.roles.includes("homeowner"));
  const {
    unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    realtimeError: notificationsRealtimeError,
  } = useNotifications(20, isHomeowner, "header");
  const metadataName =
    typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : "";
  const displayName = metadataName || user?.email || "Signed in";

  const navigation = [
    { name: "For Homeowners", href: "/homeowners" },
    { name: "Find a Pro", href: "/providers" },
    { name: "For Vendors", href: "/vendors" },
  ];

  const isActive = (path: string) => pathname === path;

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      setIsOpen(false);
      router.replace("/login");
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border-strong bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto flex h-16 items-center px-4 relative">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2 flex-shrink-0">
          <Image
            src="/mercurius-logo.png"
            alt="Mercurius"
            width={64}
            height={64}
            className="h-14 w-14 md:h-16 md:w-16 object-contain"
          />
          <span className="text-xl font-semibold text-foreground">Mercurius</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-1 absolute left-1/2 -translate-x-1/2">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                isActive(item.href)
                  ? "bg-slate-soft text-foreground"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              {item.name}
            </Link>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
              More <ChevronDown className="ml-1 h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>
                <Link href="/how-it-works" className="w-full">How It Works</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/services" className="w-full">Services</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/pricing" className="w-full">Pricing</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/faq" className="w-full">FAQ</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/contact" className="w-full">Contact</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center space-x-3 ml-auto">
          {isHomeowner && (
            <NotificationBell
              unreadCount={unreadCount}
              loading={notificationsLoading}
              unavailable={Boolean(notificationsError || notificationsRealtimeError)}
            />
          )}
          <ThemeToggle />
          {authLoading ? (
            <Button variant="ghost" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
              Account
            </Button>
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" />}
                className="flex items-center gap-1"
              >
                <CircleUserRound className="h-4 w-4" />
                Account <ChevronDown className="h-4 w-4 ml-1" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-2 py-2.5">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {displayName}
                  </p>
                  {metadataName && user.email ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rolesLoading ? (
                      <span className="text-xs text-muted-foreground">
                        Loading roles...
                      </span>
                    ) : portalLinks.length > 0 ? (
                      portalLinks.map(({ role, roleLabel }) => (
                        <span
                          key={role}
                          className="rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-sage-dark"
                        >
                          {roleLabel}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {currentRoleState?.status === "error"
                          ? "Roles unavailable"
                          : "Account"}
                      </span>
                    )}
                  </div>
                </div>
                {portalLinks.map(({ role, linkLabel, href, icon: Icon }) => (
                  <DropdownMenuItem
                    key={role}
                    render={<Link href={href} />}
                    className="cursor-pointer px-2 py-2"
                  >
                    <Icon />
                    {linkLabel}
                  </DropdownMenuItem>
                ))}
                {isHomeowner && (
                  <>
                    <DropdownMenuItem
                      render={<Link href="/messages" />}
                      className="cursor-pointer px-2 py-2"
                    >
                      <MessageSquare />
                      Messages
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      render={<Link href="/account" />}
                      className="cursor-pointer px-2 py-2"
                    >
                      <Settings />
                      Account Settings
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isSigningOut}
                  onClick={() => void handleSignOut()}
                  className="mt-1 cursor-pointer border-t border-border px-2 py-2"
                >
                  {isSigningOut ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <LogOut />
                  )}
                  {isSigningOut ? "Signing Out..." : "Sign Out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" />}
                className="flex items-center gap-1"
              >
                Sign In <ChevronDown className="h-4 w-4 ml-1" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem>
                  <Link href="/login" className="w-full flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-soft">
                      <Home className="h-3.5 w-3.5 text-foreground" />
                    </div>
                    Homeowner Sign In
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Link href="/login/vendor" className="w-full flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-soft">
                      <Wrench className="h-3.5 w-3.5 text-foreground" />
                    </div>
                    Vendor Sign In
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Link href="/register" className="w-full flex items-center gap-2 font-medium text-accent">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md border border-accent-border bg-accent-soft">
                      <UserPlus className="h-3.5 w-3.5 text-accent" />
                    </div>
                    Create Homeowner Account
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Link href="/request" className={cn(buttonVariants(), "rounded-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active")}>Get Started</Link>
        </div>

        {/* Mobile Menu */}
        <div className="ml-auto flex items-center gap-1 md:hidden">
          {isHomeowner && (
            <NotificationBell
              unreadCount={unreadCount}
              loading={notificationsLoading}
              unavailable={Boolean(notificationsError || notificationsRealtimeError)}
            />
          )}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <div className="flex flex-col space-y-6 mt-8">
                <nav className="flex flex-col space-y-1">
                  {navigation.map((item) => (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className={`px-4 py-3 text-base font-medium rounded-lg transition-colors ${
                        isActive(item.href)
                          ? "bg-slate-soft text-foreground"
                          : "text-foreground hover:bg-surface-hover"
                      }`}
                    >
                      {item.name}
                    </Link>
                  ))}
                  <Link href="/how-it-works" onClick={() => setIsOpen(false)} className="rounded-lg px-4 py-3 text-base font-medium hover:bg-surface-hover">
                    How It Works
                  </Link>
                  <Link href="/services" onClick={() => setIsOpen(false)} className="rounded-lg px-4 py-3 text-base font-medium hover:bg-surface-hover">
                    Services
                  </Link>
                  <Link href="/pricing" onClick={() => setIsOpen(false)} className="rounded-lg px-4 py-3 text-base font-medium hover:bg-surface-hover">
                    Pricing
                  </Link>
                  <Link href="/faq" onClick={() => setIsOpen(false)} className="rounded-lg px-4 py-3 text-base font-medium hover:bg-surface-hover">
                    FAQ
                  </Link>
                  <Link href="/contact" onClick={() => setIsOpen(false)} className="rounded-lg px-4 py-3 text-base font-medium hover:bg-surface-hover">
                    Contact
                  </Link>
                </nav>

                <ThemeToggle
                  showLabel
                  className="h-11 w-full rounded-xl border border-slate-border bg-slate-soft px-4"
                />

                <div className="flex flex-col space-y-3 pt-4 border-t">
                  {!authLoading && user ? (
                    <>
                      <div className="rounded-xl border border-slate-border bg-slate-soft p-4">
                        <p className="truncate font-semibold text-foreground">
                          {displayName}
                        </p>
                        {metadataName && user.email ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {rolesLoading ? (
                            <span className="text-xs text-muted-foreground">
                              Loading roles...
                            </span>
                          ) : portalLinks.length > 0 ? (
                            portalLinks.map(({ role, roleLabel }) => (
                              <span
                                key={role}
                                className="rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-sage-dark"
                              >
                                {roleLabel}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {currentRoleState?.status === "error"
                                ? "Roles unavailable"
                                : "Account"}
                            </span>
                          )}
                        </div>
                      </div>
                      {portalLinks.map(
                        ({ role, linkLabel, href, icon: Icon }) => (
                          <Link
                            key={role}
                            href={href}
                            onClick={() => setIsOpen(false)}
                            className={cn(
                              buttonVariants({ variant: "outline" }),
                              "w-full justify-start gap-2",
                            )}
                          >
                            <Icon />
                            {linkLabel}
                          </Link>
                        ),
                      )}
                      {isHomeowner && (
                        <>
                          <Link
                            href="/messages"
                            onClick={() => setIsOpen(false)}
                            className={cn(
                              buttonVariants({ variant: "outline" }),
                              "w-full justify-start gap-2",
                            )}
                          >
                            <MessageSquare />
                            Messages
                          </Link>
                          <Link
                            href="/account"
                            onClick={() => setIsOpen(false)}
                            className={cn(
                              buttonVariants({ variant: "outline" }),
                              "w-full justify-start gap-2",
                            )}
                          >
                            <Settings />
                            Account Settings
                          </Link>
                        </>
                      )}
                      <Button
                        variant="outline"
                        className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isSigningOut}
                        onClick={() => void handleSignOut()}
                      >
                        {isSigningOut ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <LogOut />
                        )}
                        {isSigningOut ? "Signing Out..." : "Sign Out"}
                      </Button>
                    </>
                  ) : !authLoading ? (
                    <>
                      <Link href="/login" onClick={() => setIsOpen(false)} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>Homeowner Sign In</Link>
                      <Link href="/login/vendor" onClick={() => setIsOpen(false)} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>Vendor Sign In</Link>
                      <Link
                        href="/register"
                        onClick={() => setIsOpen(false)}
                        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover active:bg-accent-active"
                      >
                        <UserPlus className="h-4 w-4" />
                        Create Homeowner Account
                      </Link>
                    </>
                  ) : (
                    <Button variant="outline" disabled className="w-full">
                      <Loader2 className="animate-spin" />
                      Loading Account...
                    </Button>
                  )}
                  <Link href="/request" onClick={() => setIsOpen(false)} className={cn(buttonVariants(), "w-full rounded-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active")}>Request Service</Link>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
