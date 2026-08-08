import Image from "next/image";
import Link from "next/link";
import { Mail, MapPin } from "lucide-react";

const footerLinks = {
  services: [
    { name: "Lawn Care", href: "/services" },
    { name: "Pool Service", href: "/services" },
    { name: "House Cleaning", href: "/services" },
    { name: "Handyman", href: "/services" },
    { name: "All Services", href: "/services" },
  ],
  company: [
    { name: "How It Works", href: "/how-it-works" },
    { name: "Services", href: "/services" },
    { name: "Pricing", href: "/pricing" },
    { name: "For Homeowners", href: "/homeowners" },
    { name: "Find a Provider", href: "/providers" },
    { name: "For Vendors", href: "/vendors" },
    { name: "FAQ", href: "/faq" },
  ],
  support: [
    { name: "Contact Us", href: "/contact" },
    { name: "Help Center", href: "/faq" },
    { name: "Reschedule Policy", href: "/reschedule-policy" },
    { name: "Privacy Policy", href: "/privacy" },
    { name: "Terms of Service", href: "/terms" },
  ],
};

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative border-t border-accent-border bg-warm-white text-foreground shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-to-r before:from-transparent before:via-sage before:to-transparent">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5 lg:gap-12">
          <div className="lg:col-span-2">
            <Link href="/" className="mb-4 flex items-center space-x-2">
              <Image
                src="/mercurius-logo.png"
                alt="Mercurius"
                width={36}
                height={36}
                className="h-9 w-9 object-contain"
              />
              <span className="text-xl font-semibold text-slate-dark">Mercurius</span>
            </Link>
            <p className="mb-6 max-w-sm leading-relaxed text-muted-foreground">
              One home. Everything handled. We manage your home services so you
              don&apos;t have to.
            </p>
            <div className="space-y-3">
              <div className="flex items-center space-x-3 text-sm text-slate">
                <Mail className="h-4 w-4 text-sage-dark" />
                <span>hello@mercurius.com</span>
              </div>
              <div className="flex items-center space-x-3 text-sm text-slate">
                <MapPin className="h-4 w-4 text-sage-dark" />
                <span>Cape Coral &amp; Fort Myers, FL</span>
              </div>
            </div>
          </div>

          <FooterColumn title="Services" links={footerLinks.services} />
          <FooterColumn title="Company" links={footerLinks.company} />
          <FooterColumn title="Support" links={footerLinks.support} />
        </div>

        <div className="mt-12 border-t border-border-strong pt-8">
          <div className="flex flex-col items-center justify-between space-y-4 md:flex-row md:space-y-0">
            <p className="text-sm text-muted-foreground">
              © {currentYear} Mercurius. All rights reserved.
            </p>
            <div className="flex space-x-6">
              <Link
                href="/privacy"
                className="text-sm text-muted-foreground transition-colors hover:text-sage-dark"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-sm text-muted-foreground transition-colors hover:text-sage-dark"
              >
                Terms
              </Link>
              <Link
                href="/admin"
                className="text-sm text-muted-foreground/60 transition-colors hover:text-slate"
              >
                Admin
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

type FooterColumnProps = {
  title: string;
  links: ReadonlyArray<{ name: string; href: string }>;
};

function FooterColumn({ title, links }: FooterColumnProps) {
  return (
    <div>
      <h4 className="mb-4 text-xs font-semibold uppercase tracking-widest text-sage-dark">
        {title}
      </h4>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link.name}>
            <Link
              href={link.href}
              className="text-slate transition-colors hover:text-sage-dark"
            >
              {link.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
