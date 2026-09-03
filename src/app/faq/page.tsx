"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  ChevronDown,
  CircleHelp,
  Home as HomeIcon,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FAQItem = {
  q: string;
  a: string;
  href?: string;
  linkLabel?: string;
};

type FAQCategory = {
  category: string;
  icon: LucideIcon;
  questions: FAQItem[];
};

const faqs: FAQCategory[] = [
  {
    category: "About Mercurius",
    icon: HomeIcon,
    questions: [
      {
        q: "What is Mercurius?",
        a: "Mercurius is a managed home services platform for homeowners in Southwest Florida. You tell us what your home needs, and we help confirm the scope, pricing, availability, and fit with a local service provider. We stay involved in the service experience instead of simply giving you a list of contractors to contact on your own.",
      },
      {
        q: "Where is Mercurius available?",
        a: "We are launching in Cape Coral and Fort Myers, with selective coverage across Southwest Florida. Availability depends on the service, property location, and current provider capacity. Submitting a request lets us confirm coverage for your specific home; it does not guarantee that a provider is immediately available.",
      },
    ],
  },
  {
    category: "Requests, Pricing & Availability",
    icon: CalendarCheck,
    questions: [
      {
        q: "How does requesting a service work?",
        a: "Start by telling us what you need, where the service will take place, and your preferred timing. If the service has current provider-backed pricing, you can move toward booking more directly by confirming details such as the property, date, and time. If the service requires a quote or provider match, Mercurius coordinates the scope, availability, provider fit, and price with you before the booking is confirmed. We are building toward more automated, AI-assisted matching and booking over time, while keeping launch availability and confirmation steps clear.",
        href: "/request",
        linkLabel: "Start a service request",
      },
      {
        q: "What services can I request?",
        a: "Our service catalog includes recurring home care and one-time maintenance needs, but not every category has active coverage at launch. The Services and Pricing pages show what is currently available, what requires a quote or provider match, and what is not yet covered. You can still express interest in an unavailable service, and we will let you know whether we can source a qualified pro.",
        href: "/services",
        linkLabel: "Explore services",
      },
      {
        q: "How does pricing work?",
        a: "When a provider publishes a current rate for a service, we show that live pricing so you can proceed with fewer manual steps, typically confirming the service details and preferred schedule. Services with variable scope or limited coverage are marked as quote or matching required, which means more coordination is needed before booking. We encourage providers to publish pricing so more services can support a direct booking path, but we do not display estimated rates as if they were confirmed. Final scope and price are confirmed before work is scheduled, and any change should be approved before additional work proceeds.",
        href: "/pricing",
        linkLabel: "View pricing and availability",
      },
      {
        q: "What if a service is not available yet?",
        a: "You can still submit a request or register your interest. We may be able to source and review a local provider, but we cannot promise a match or a specific timeline. We will only move forward after availability, provider fit, scope, and pricing have been confirmed with you.",
      },
      {
        q: "Can I reschedule or cancel a confirmed service?",
        a: "Usually, but timing matters and fees or refund terms may apply. Review your booking confirmation and contact us as soon as possible if your plans change. Our Reschedule & Cancellation Policy explains the standard notice periods; any service-specific terms will be communicated before booking.",
        href: "/reschedule-policy",
        linkLabel: "Read the rescheduling policy",
      },
    ],
  },
  {
    category: "Provider Quality & Support",
    icon: ShieldCheck,
    questions: [
      {
        q: "How does Mercurius evaluate service providers?",
        a: "Providers apply to join the network and are reviewed for service fit, coverage area, experience, and business documentation. Licensing and insurance are checked where applicable to the work being offered. Because our launch network is intentionally limited, we focus on appropriate matches and managed oversight rather than presenting a large, uncurated directory.",
      },
      {
        q: "How do I get help with a request or service?",
        a: "Contact Mercurius with your request details and the best way to reach you. We can help clarify availability, booking details, scheduling changes, or concerns about an active service. For emergencies or conditions that could threaten health or property, contact the appropriate emergency service first.",
        href: "/contact",
        linkLabel: "Contact support",
      },
    ],
  },
  {
    category: "For Vendors",
    icon: Wrench,
    questions: [
      {
        q: "How can my company join the Mercurius network?",
        a: "Complete the vendor application with your company details, service categories, coverage area, experience, and required business documents. Our team reviews each application against current network needs. Applying does not guarantee approval, exclusivity, or a specific volume of jobs.",
        href: "/vendors/apply",
        linkLabel: "Apply to join the network",
      },
    ],
  },
];

export default function FAQPage() {
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  function toggleItem(id: string) {
    setOpenItems((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <section className="bg-hero relative overflow-hidden py-16 md:py-20 lg:py-24">
          <div className="bg-pattern absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute -left-28 top-10 h-80 w-80 rounded-full bg-sage/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -top-20 h-96 w-96 rounded-full bg-coral/10 blur-3xl" />
          <div className="container-wide relative">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark shadow-sm ring-1 ring-sage/20">
                <CircleHelp className="mr-2 h-4 w-4" />
                FAQ
              </span>
              <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
                Frequently Asked <span className="hero-gradient-text">Questions</span>
              </h1>
              <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                Straightforward answers about requesting service, local availability, pricing, and our provider network.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-2.5">
                {faqs.map(({ category, icon: Icon }) => (
                  <span key={category} className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-card/70 px-3.5 py-2 text-xs font-medium text-foreground shadow-sm backdrop-blur">
                    <Icon className="h-3.5 w-3.5 text-accent" />
                    {category}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/35 py-16 md:py-24">
          <div className="container-wide mx-auto max-w-4xl">
            <div className="space-y-14 md:space-y-16">
              {faqs.map((category, categoryIndex) => {
                const CategoryIcon = category.icon;
                return (
                <section key={category.category}>
                  <div className="mb-6 flex items-center gap-4 md:mb-7">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sage-light shadow-sm ring-1 ring-sage/15">
                      <CategoryIcon className="h-5 w-5 text-sage-dark" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-bold text-foreground md:text-3xl">{category.category}</h2>
                        <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border/50">
                          {category.questions.length} {category.questions.length === 1 ? "question" : "questions"}
                        </span>
                      </div>
                    </div>
                    <div className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent md:block" />
                  </div>
                  <div className="space-y-4">
                    {category.questions.map((item, index) => {
                      const id = `faq-${categoryIndex}-${index}`;
                      const isOpen = Boolean(openItems[id]);

                      return (
                        <div
                          key={id}
                          className={cn(
                            "overflow-hidden rounded-2xl border bg-card transition-all duration-300",
                            isOpen
                              ? "border-accent/25 shadow-lg shadow-accent/[0.06] ring-1 ring-accent/10"
                              : "border-border/40 shadow-sm hover:-translate-y-0.5 hover:border-border/70 hover:shadow-md",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleItem(id)}
                            aria-expanded={isOpen}
                            aria-controls={`${id}-answer`}
                            className="group flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-muted/35 sm:px-6"
                          >
                            <span className="flex min-w-0 items-center gap-4">
                              <span className={cn(
                                "hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold sm:flex",
                                isOpen ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
                              )}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="font-semibold leading-snug text-foreground">{item.q}</span>
                            </span>
                            <span className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                              isOpen ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground group-hover:text-foreground",
                            )}>
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 transition-transform duration-300",
                                  isOpen && "rotate-180",
                                )}
                              />
                            </span>
                          </button>
                          {isOpen && (
                            <div id={`${id}-answer`} className="animate-in fade-in-0 slide-in-from-top-1 border-t border-border/40 bg-gradient-to-br from-muted/30 to-background px-5 py-5 duration-200 sm:px-6 sm:pl-[5.5rem]">
                              <div className="max-w-2xl">
                                <p className="leading-7 text-muted-foreground">{item.a}</p>
                                {item.href && item.linkLabel && (
                                  <Link
                                    href={item.href}
                                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition-colors hover:text-accent/80"
                                  >
                                    {item.linkLabel} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                  </Link>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-cta-section relative overflow-hidden py-16 text-primary-foreground md:py-20">
          <div className="bg-pattern pointer-events-none absolute inset-0 opacity-10" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />
          <div className="container-narrow relative text-center">
            <span className="mb-5 inline-block rounded-full bg-primary-foreground/10 px-4 py-1.5 text-sm font-medium text-primary-foreground/80 ring-1 ring-primary-foreground/10">
              Need a little more help?
            </span>
            <h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl">Still Have Questions?</h2>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-primary-foreground/70">
              Tell us what you need help with and our team will follow up with the next practical step.
            </p>
            <Link href="/contact" className={cn(buttonVariants({ size: "lg" }), "btn-hero-primary h-11 px-8 shadow-lg shadow-accent/20")}>
              Contact Us <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
