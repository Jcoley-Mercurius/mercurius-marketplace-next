"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
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
  questions: FAQItem[];
};

const faqs: FAQCategory[] = [
  {
    category: "About Mercurius",
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
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-hero py-16 md:py-20">
          <div className="container-narrow text-center">
            <span className="mb-6 inline-block rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark">
              FAQ
            </span>
            <h1 className="mb-6 text-foreground">Frequently Asked Questions</h1>
            <p className="text-xl text-muted-foreground">
              Straightforward answers about requesting service, local availability, pricing, and our provider network.
            </p>
          </div>
        </section>

        <section className="section bg-background">
          <div className="container-narrow">
            <div className="space-y-12">
              {faqs.map((category) => (
                <section key={category.category}>
                  <h2 className="mb-6 text-2xl font-semibold text-foreground">{category.category}</h2>
                  <div className="space-y-3">
                    {category.questions.map((item, index) => {
                      const id = `${category.category}-${index}`;
                      const isOpen = Boolean(openItems[id]);

                      return (
                        <div key={id} className="overflow-hidden rounded-xl border border-border/30 bg-card">
                          <button
                            type="button"
                            onClick={() => toggleItem(id)}
                            aria-expanded={isOpen}
                            aria-controls={`${id}-answer`}
                            className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-muted/50"
                          >
                            <span className="pr-4 font-medium text-foreground">{item.q}</span>
                            <ChevronDown
                              className={cn(
                                "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                                isOpen && "rotate-180",
                              )}
                            />
                          </button>
                          {isOpen && (
                            <div id={`${id}-answer`} className="px-5 pb-5 pt-0">
                              <p className="leading-relaxed text-muted-foreground">{item.a}</p>
                              {item.href && item.linkLabel && (
                                <Link
                                  href={item.href}
                                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                                >
                                  {item.linkLabel} <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="section bg-muted">
          <div className="container-narrow text-center">
            <h2 className="mb-4 text-foreground">Still Have Questions?</h2>
            <p className="mb-8 text-lg text-muted-foreground">
              Tell us what you need help with and our team will follow up with the next practical step.
            </p>
            <Link
              href="/contact"
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-accent text-accent-foreground hover:bg-accent/90",
              )}
            >
              Contact Us <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
