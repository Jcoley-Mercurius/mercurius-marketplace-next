"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Mail, MapPin, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const supabase = createClient();
      const { error } = await supabase.from("contact_submissions").insert({
        first_name: String(formData.get("firstName") ?? "").trim(),
        last_name: String(formData.get("lastName") ?? "").trim(),
        email: String(formData.get("email") ?? "").trim(),
        phone: String(formData.get("phone") ?? "").trim() || null,
        subject: String(formData.get("subject") ?? "").trim(),
        message: String(formData.get("message") ?? "").trim(),
      });

      if (error) throw error;

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
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-hero py-16 md:py-20">
          <div className="container-wide text-center">
            <span className="mb-6 inline-block rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark">
              Contact Us
            </span>
            <h1 className="mb-6 text-foreground">Get in Touch</h1>
            <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
              Have questions? We&apos;re here to help. Reach out and our team will respond promptly.
            </p>
          </div>
        </section>

        <section className="section bg-background">
          <div className="container-wide">
            <div className="grid gap-12 lg:grid-cols-2">
              <div className="rounded-2xl border border-border/30 bg-card p-8">
                {isSubmitted ? (
                  <div className="py-12 text-center">
                    <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-sage-light">
                      <CheckCircle2 className="h-8 w-8 text-sage" />
                    </div>
                    <h3 className="mb-4 text-2xl font-semibold text-foreground">Message Sent!</h3>
                    <p className="mb-6 text-muted-foreground">
                      Thank you for reaching out. We&apos;ll get back to you within 1 business day.
                    </p>
                    <Button variant="outline" onClick={() => setIsSubmitted(false)}>
                      Send Another Message
                    </Button>
                  </div>
                ) : (
                  <>
                    <h2 className="mb-6 text-2xl font-semibold text-foreground">Send Us a Message</h2>
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input id="firstName" name="firstName" placeholder="John" required />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input id="lastName" name="lastName" placeholder="Doe" required />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" type="email" placeholder="john@example.com" required />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone (optional)</Label>
                        <Input id="phone" name="phone" type="tel" placeholder="(555) 123-4567" />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="subject">Subject</Label>
                        <Input id="subject" name="subject" placeholder="How can we help?" required />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="message">Message</Label>
                        <textarea
                          id="message"
                          name="message"
                          placeholder="Tell us more about your question or concern..."
                          rows={5}
                          required
                          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
                        />
                      </div>

                      <Button
                        type="submit"
                        size="lg"
                        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Sending..." : "Send Message"}
                        <Send className="ml-2 h-4 w-4" />
                      </Button>
                    </form>
                  </>
                )}
              </div>

              <div className="space-y-8">
                <div>
                  <h2 className="mb-6 text-2xl font-semibold text-foreground">Contact Information</h2>
                  <div className="space-y-6">
                    <ContactItem icon={Mail} title="Email">
                      <a href="mailto:hello@mercurius.com" className="text-muted-foreground transition-colors hover:text-accent">
                        hello@mercurius.com
                      </a>
                      <p className="mt-1 text-sm text-muted-foreground">We respond within 24 hours</p>
                    </ContactItem>

                    <ContactItem icon={Phone} title="Phone">
                      <p className="text-muted-foreground">Coming soon</p>
                      <p className="mt-1 text-sm text-muted-foreground">Mon-Fri, 8am-6pm EST</p>
                    </ContactItem>

                    <ContactItem icon={MapPin} title="Service Areas">
                      <p className="text-muted-foreground">Cape Coral &amp; Fort Myers, FL</p>
                      <Link href="/#bundle-builder" className="mt-1 inline-block text-sm text-accent hover:underline">
                        Check if we&apos;re in your area →
                      </Link>
                    </ContactItem>

                    <ContactItem icon={Clock} title="Business Hours">
                      <p className="text-muted-foreground">Monday - Friday: 8am - 6pm EST</p>
                      <p className="text-muted-foreground">Saturday: 9am - 2pm EST</p>
                      <p className="text-muted-foreground">Sunday: Closed</p>
                    </ContactItem>
                  </div>
                </div>

                <div className="rounded-2xl bg-sage-light p-6">
                  <h3 className="mb-2 font-semibold text-sage-dark">For Vendors</h3>
                  <p className="mb-4 text-sage-dark/80">
                    Interested in joining our network? Visit our vendor page to learn more and apply.
                  </p>
                  <Link
                    href="/vendors"
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "border-sage-dark/30 bg-transparent text-sage-dark hover:bg-sage-dark/10",
                    )}
                  >
                    Vendor Information
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
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
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sage-light">
        <Icon className="h-5 w-5 text-sage" />
      </div>
      <div>
        <h4 className="mb-1 font-semibold text-foreground">{title}</h4>
        {children}
      </div>
    </div>
  );
}
