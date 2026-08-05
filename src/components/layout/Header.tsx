"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, ChevronDown, Wrench, Home, UserPlus } from "lucide-react";

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const navigation = [
    { name: "For Homeowners", href: "/homeowners" },
    { name: "Find a Pro", href: "/providers" },
    { name: "For Vendors", href: "/vendors" },
  ];

  const isActive = (path: string) => pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
      <div className="container mx-auto flex h-16 items-center px-4 relative">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2 flex-shrink-0">
          <img
            src="/mercurius-logo.png"
            alt="Mercurius"
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
                  ? "text-primary bg-muted"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {item.name}
            </Link>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
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
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1">
              <Button variant="ghost">
                Sign In <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>
                <Link href="/login" className="w-full flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                    <Home className="h-3.5 w-3.5 text-primary" />
                  </div>
                  Homeowner Sign In
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/login?type=vendor" className="w-full flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                    <Wrench className="h-3.5 w-3.5 text-primary" />
                  </div>
                  Vendor Sign In
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/register" className="w-full flex items-center gap-2 font-medium text-accent">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10">
                    <UserPlus className="h-3.5 w-3.5 text-accent" />
                  </div>
                  Create Homeowner Account
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-full" asChild>
            <Link href="/request">Get Started</Link>
          </Button>
        </div>

        {/* Mobile Menu */}
        <div className="md:hidden ml-auto">
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
                          ? "text-primary bg-muted"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      {item.name}
                    </Link>
                  ))}
                  <Link href="/how-it-works" onClick={() => setIsOpen(false)} className="px-4 py-3 text-base font-medium hover:bg-muted rounded-lg">
                    How It Works
                  </Link>
                  <Link href="/services" onClick={() => setIsOpen(false)} className="px-4 py-3 text-base font-medium hover:bg-muted rounded-lg">
                    Services
                  </Link>
                  <Link href="/pricing" onClick={() => setIsOpen(false)} className="px-4 py-3 text-base font-medium hover:bg-muted rounded-lg">
                    Pricing
                  </Link>
                  <Link href="/faq" onClick={() => setIsOpen(false)} className="px-4 py-3 text-base font-medium hover:bg-muted rounded-lg">
                    FAQ
                  </Link>
                  <Link href="/contact" onClick={() => setIsOpen(false)} className="px-4 py-3 text-base font-medium hover:bg-muted rounded-lg">
                    Contact
                  </Link>
                </nav>

                <div className="flex flex-col space-y-3 pt-4 border-t">
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/login" onClick={() => setIsOpen(false)}>
                      Homeowner Sign In
                    </Link>
                  </Button>
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/login?type=vendor" onClick={() => setIsOpen(false)}>
                      Vendor Sign In
                    </Link>
                  </Button>
                  <Link
                    href="/register"
                    onClick={() => setIsOpen(false)}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90"
                  >
                    <UserPlus className="h-4 w-4" />
                    Create Homeowner Account
                  </Link>
                  <Button className="w-full bg-accent hover:bg-accent/90 text-accent-foreground rounded-full" asChild>
                    <Link href="/request" onClick={() => setIsOpen(false)}>
                      Request Service
                    </Link>
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
