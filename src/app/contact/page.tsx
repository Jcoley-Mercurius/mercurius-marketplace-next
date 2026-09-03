"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock, FileText, Loader2, Mail, MapPin, MessageCircle, Phone, Send, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeRequestId } from "@/lib/requestContext";
import { cn } from "@/lib/utils";

export default function ContactPage() {
  return (
    <Suspense fallback={<ContactPageLoading />}>
      <ContactPageContent />
    </Suspense>
  );
}

function ContactPageContent() {
  const searchParams = useSearchParams();
  const requestId = normalizeRequestId(searchParams.get("request"));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch("/api/contact-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: String(formData.get("firstName") ?? "").trim(),
          last_name: String(formData.get("lastName") ?? "").trim(),
          email: String(formData.get("email") ?? "").trim(),
          phone: String(formData.get("phone") ?? "").trim() || null,
          subject: String(formData.get("subject") ?? "").trim(),
          message: String(formData.get("message") ?? "").trim(),
          request_id: requestId,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Your message could not be submitted.");
      }

      form.reset();
      setIsSubmitted(true);
      toast.success("Message sent!", {
        description: "We'll get back to you within 1 business day.",
      });
    } catch (error) {
      console.error("Unable to submit contact form", error);
      toast.error("Something went wrong", {
        description: "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main-content" tabIndex={-1} className="flex-1">
        <section className="bg-hero relative overflow-hidden pb-28 pt-16 md:pb-36 md:pt-20 lg:pt-24">
          <div className="bg-pattern absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute -left-32 top-16 h-80 w-80 rounded-full bg-sage/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-coral/10 blur-3xl" />
          <div className="container-wide relative">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark shadow-sm ring-1 ring-sage/20">
                <MessageCircle className="mr-2 h-4 w-4" />
                Contact Us
              </span>
              <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
                Get in <span className="hero-gradient-text">Touch</span>
              </h1>
              <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                Have a question about Mercurius or need help with a service? Tell us what you need and our team will help with the next step.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span>Homeowner questions</span>
                <span className="hidden text-border sm:inline">•</span>
                <span>Service support</span>
                <span className="hidden text-border sm:inline">•</span>
                <span>Vendor inquiries</span>
              </div>
            </div>
          </div>
        </section>

        <section className="relative bg-muted/35 pb-20 md:pb-28">
          <div className="container-wide relative -mt-16 md:-mt-20">
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)] lg:gap-10">
              <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-card p-6 shadow-xl shadow-foreground/[0.06] ring-1 ring-white/70 sm:p-8 md:p-10">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sage via-accent to-coral" />
                {isSubmitted ? (
                  <div className="flex min-h-[38rem] flex-col items-center justify-center py-12 text-center">
                    <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-2xl bg-sage-light shadow-sm ring-8 ring-sage-light/40">
                      <CheckCircle2 className="h-10 w-10 text-sage" />
                    </div>
                    <span className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-accent">Thank you</span>
                    <h2 className="mb-4 text-3xl font-bold text-foreground">Message Sent!</h2>
                    <p className="mb-8 max-w-md text-base leading-relaxed text-muted-foreground">
                      Thank you for reaching out. We&apos;ll get back to you within 1 business day.
                    </p>
                    <Button variant="outline" size="lg" className="h-11 px-6" onClick={() => setIsSubmitted(false)}>
                      Send Another Message
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-8 flex items-start gap-4 border-b border-border/50 pb-7">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 ring-1 ring-accent/15">
                        <Send className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-foreground md:text-3xl">Send Us a Message</h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          Tell us what you need help with. All fields are required unless marked optional.
                        </p>
                      </div>
                    </div>
                    {requestId && (
                      <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent-border bg-accent-subtle px-4 py-3 text-sm">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        <div className="min-w-0">
                          <p className="break-all font-medium text-foreground">
                            Regarding request {requestId}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            This request ID will be included with your message so
                            our team can find the correct service history.
                          </p>
                        </div>
                      </div>
                    )}
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="firstName" className="text-sm font-medium">First Name</Label>
                          <Input id="firstName" name="firstName" autoComplete="given-name" placeholder="John" className="h-12 rounded-xl border-border/60 bg-background px-4 shadow-sm" required />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName" className="text-sm font-medium">Last Name</Label>
                          <Input id="lastName" name="lastName" autoComplete="family-name" placeholder="Doe" className="h-12 rounded-xl border-border/60 bg-background px-4 shadow-sm" required />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                        <Input id="email" name="email" type="email" autoComplete="email" placeholder="john@example.com" className="h-12 rounded-xl border-border/60 bg-background px-4 shadow-sm" required />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label htmlFor="phone" className="text-sm font-medium">Phone</Label>
                          <span className="text-xs text-muted-foreground">Optional</span>
                        </div>
                        <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="Your phone number" className="h-12 rounded-xl border-border/60 bg-background px-4 shadow-sm" />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="subject" className="text-sm font-medium">Subject</Label>
                        <Input id="subject" name="subject" placeholder="How can we help?" className="h-12 rounded-xl border-border/60 bg-background px-4 shadow-sm" required />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="message" className="text-sm font-medium">Message</Label>
                        <textarea
                          id="message"
                          name="message"
                          placeholder="Tell us more about your question or concern..."
                          rows={5}
                          required
                          className="min-h-40 w-full resize-y rounded-xl border border-border/60 bg-background px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
                        />
                      </div>

                      <Button
                        type="submit"
                        size="lg"
                        className="btn-hero-primary h-12 w-full rounded-xl text-base shadow-lg shadow-accent/20"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</>
                        ) : (
                          <>Send Message <Send className="ml-2 h-4 w-4" /></>
                        )}
                      </Button>
                    </form>
                  </>
                )}
              </div>

              <aside className="space-y-6 lg:sticky lg:top-28">
                <div className="bg-cta-section relative overflow-hidden rounded-3xl border border-primary-foreground/10 p-6 text-primary-foreground shadow-xl shadow-foreground/10 sm:p-8">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-accent/15 blur-3xl" />
                  <div className="relative mb-8">
                    <span className="mb-3 inline-block text-xs font-semibold uppercase tracking-[0.18em] text-accent">We&apos;re here to help</span>
                    <h2 className="text-2xl font-bold text-primary-foreground md:text-3xl">Contact Information</h2>
                    <p className="mt-2 text-sm leading-relaxed text-primary-foreground/60">Ways to reach us and when our team is available.</p>
                  </div>
                  <div className="relative divide-y divide-primary-foreground/10">
                    <ContactItem icon={Mail} title="Email">
                      <a href="mailto:hello@mercurius.com" className="text-primary-foreground/80 transition-colors hover:text-accent">
                        hello@mercurius.com
                      </a>
                      <p className="mt-1 text-sm text-primary-foreground/50">We respond within 24 hours</p>
                    </ContactItem>

                    <ContactItem icon={Phone} title="Phone">
                      <a href="tel:+12393393895" className="text-primary-foreground/80 transition-colors hover:text-accent">
                        239-339-3895
                      </a>
                      <p className="mt-1 text-sm text-primary-foreground/50">Monday - Friday: 8am - 6pm EST</p>
                      <p className="text-sm text-primary-foreground/50">Saturday: 9am - 2pm EST</p>
                      <p className="text-sm text-primary-foreground/50">Sunday: Closed</p>
                    </ContactItem>

                    <ContactItem icon={MapPin} title="Service Areas">
                      <p className="text-primary-foreground/80">Cape Coral &amp; Fort Myers, FL</p>
                      <Link href="/#bundle-builder" className="mt-1 inline-block text-sm font-medium text-accent hover:underline">
                        Check if we&apos;re in your area →
                      </Link>
                    </ContactItem>

                    <ContactItem icon={Clock} title="Business Hours">
                      <p className="text-primary-foreground/80">Monday - Friday: 8am - 6pm EST</p>
                      <p className="text-primary-foreground/80">Saturday: 9am - 2pm EST</p>
                      <p className="text-primary-foreground/80">Sunday: Closed</p>
                    </ContactItem>
                  </div>
                </div>

                <div className="rounded-3xl border border-sage/20 bg-sage-light/70 p-6 shadow-sm sm:p-7">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card shadow-sm ring-1 ring-sage/15">
                      <Wrench className="h-5 w-5 text-sage-dark" />
                    </div>
                    <div>
                      <h3 className="mb-2 text-lg font-semibold text-sage-dark">For Vendors</h3>
                      <p className="mb-5 text-sm leading-relaxed text-sage-dark/80">
                        Interested in joining our network? Visit our vendor page to learn more and apply.
                      </p>
                      <Link
                        href="/vendors"
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          "h-10 border-sage-dark/25 bg-card/70 px-4 text-sage-dark shadow-sm hover:bg-card",
                        )}
                      >
                        Vendor Information <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ContactPageLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <span className="sr-only">Loading contact form</span>
      </main>
      <Footer />
    </div>
  );
}

function ContactItem({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Mail;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 py-6 first:pt-0 last:pb-0">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/10 ring-1 ring-primary-foreground/10">
        <Icon className="h-5 w-5 text-accent" />
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-primary-foreground">{title}</h3>
        {children}
      </div>
    </div>
  );
}
