import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

const LAST_UPDATED = "August 5, 2026";

const sections = [
  ["about", "1. About Mercurius"],
  ["acceptance", "2. Acceptance & Eligibility"],
  ["accounts", "3. Accounts"],
  ["requests", "4. Requests, Matching & Booking"],
  ["pricing", "5. Pricing & Scope Changes"],
  ["payments", "6. Payments"],
  ["changes", "7. Rescheduling & Cancellation"],
  ["providers", "8. Service Providers"],
  ["responsibilities", "9. Homeowner Responsibilities"],
  ["quality", "10. Quality Concerns"],
  ["content", "11. Photos, Reviews & Communications"],
  ["conduct", "12. Prohibited Conduct"],
  ["property", "13. Intellectual Property"],
  ["availability", "14. Platform Availability & Disclaimers"],
  ["liability", "15. Limitation of Liability"],
  ["suspension", "16. Suspension & Termination"],
  ["law", "17. Governing Law & Disputes"],
  ["updates", "18. Changes to These Terms"],
  ["contact", "19. Contact Us"],
] as const;

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1">
        <section className="bg-hero relative overflow-hidden py-16 md:py-20 lg:py-24">
          <div className="bg-pattern absolute inset-0 opacity-30" />
          <div className="pointer-events-none absolute -left-24 top-10 h-80 w-80 rounded-full bg-sage/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -top-20 h-96 w-96 rounded-full bg-coral/10 blur-3xl" />
          <div className="container-wide relative">
            <div className="mx-auto max-w-3xl text-center">
              <span className="mb-6 inline-flex items-center rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark shadow-sm ring-1 ring-sage/20">
                <FileText className="mr-2 h-4 w-4" /> Platform Terms
              </span>
              <h1 className="mb-5 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
                Terms &amp; <span className="hero-gradient-text">Conditions</span>
              </h1>
              <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground">
                Practical terms for using Mercurius to request, coordinate, and manage home services.
              </p>
              <p className="mt-6 text-sm font-medium text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            </div>
          </div>
        </section>

        <section className="bg-muted/35 py-12 md:py-16">
          <div className="container-wide grid max-w-6xl items-start gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
            <aside className="hidden lg:sticky lg:top-24 lg:block">
              <nav aria-label="Terms and Conditions sections" className="max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">On this page</p>
                <ol className="space-y-2.5">
                  {sections.map(([id, label]) => (
                    <li key={id}>
                      <a href={`#${id}`} className="text-sm leading-snug text-muted-foreground transition-colors hover:text-accent">
                        {label}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>

            <article className="rounded-3xl border border-border/40 bg-card px-6 py-2 shadow-xl shadow-foreground/[0.04] sm:px-8 md:px-12">
              <PolicySection id="about" title="1. About Mercurius">
                <p>
                  Mercurius (&quot;Mercurius,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates a managed home-services platform serving Cape Coral, Fort Myers, and select areas of Southwest Florida. The Platform helps homeowners request services and helps coordinate provider matching, scope, pricing, scheduling, status updates, and support.
                </p>
                <p>Mercurius is not the contractor performing the underlying home service. Services are performed by independent businesses or professionals (&quot;Service Providers&quot;).</p>
              </PolicySection>

              <PolicySection id="acceptance" title="2. Acceptance & Eligibility">
                <p>
                  These Terms govern your access to the Mercurius website, accounts, request tools, dashboards, and related services (collectively, the &quot;Platform&quot;). By creating an account, submitting a request or application, confirming a booking, or otherwise using the Platform, you agree to these Terms and our <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use the Platform.
                </p>
                <p>You must be at least 18 years old and able to enter into a binding agreement. If you use the Platform for a company or property owner, you represent that you have authority to act for that person or organization.</p>
              </PolicySection>

              <PolicySection id="accounts" title="3. Accounts">
                <p>
                  You must provide accurate, current information and keep it reasonably up to date. You are responsible for safeguarding your login credentials and for activity under your account. Notify us promptly if you suspect unauthorized access. We may require identity or account verification before making sensitive changes or responding to certain requests.
                </p>
              </PolicySection>

              <PolicySection id="requests" title="4. Requests, Matching & Booking">
                <p>
                  Submitting a service request tells us what you would like to arrange; it is not automatically a confirmed booking. Availability depends on location, service category, provider capacity, timing, property conditions, and scope.
                </p>
                <p>
                  When a service has current provider-backed pricing and coverage, the Platform may offer a more direct path to booking after you confirm details such as the property, date, and time. Quote-based or matching-based services require additional coordination before a booking is confirmed. A booking is confirmed only when the provider, scope, schedule, and price have been communicated and accepted through the applicable workflow.
                </p>
                <p>We may use software-assisted tools to organize requests or suggest potential matches, but we do not promise fully automated matching or immediate availability.</p>
              </PolicySection>

              <PolicySection id="pricing" title="5. Pricing & Scope Changes">
                <p>
                  Pricing shown as live or available is based on current information published or approved for the applicable provider and service. Other services may show &quot;quote required,&quot; &quot;matching required,&quot; or an unavailable state. Estimates, previews, or starting prices are not final unless the booking flow clearly identifies them as confirmed.
                </p>
                <p>
                  Before a booking is confirmed, you will be told the applicable service price and any fees or taxes collected through the Platform. If conditions at the property or requested work differ materially from the confirmed scope, the Service Provider or Mercurius may propose a revised scope or price. Additional work should not proceed through Mercurius without your approval.
                </p>
              </PolicySection>

              <PolicySection id="payments" title="6. Payments">
                <p>
                  When payment functionality is offered for a booking, payments may be processed by a third-party payment processor. By authorizing payment, you permit the applicable amount to be charged using your selected method. Payment timing, deposits, authorization holds, refunds, and provider payouts may vary by service and will be communicated through the applicable booking or provider terms.
                </p>
                <p>You are responsible for providing valid billing information and for charges you authorize. Mercurius does not require you to send full payment-card details by email or through a general contact form.</p>
              </PolicySection>

              <PolicySection id="changes" title="7. Rescheduling & Cancellation">
                <p>
                  Rescheduling, cancellation, refund, and no-show terms depend on notice, provider commitments, and the service involved. The standard notice periods and fees are described in our <Link href="/reschedule-policy">Reschedule &amp; Cancellation Policy</Link>. Service-specific terms communicated before confirmation control if they differ. Contact us as soon as possible when plans change.
                </p>
              </PolicySection>

              <PolicySection id="providers" title="8. Service Providers">
                <p>
                  Service Providers are independent businesses and are not employees, agents, or partners of Mercurius. We review provider-supplied information for service fit, coverage, experience, and business documentation, and we may review licensing and insurance where applicable to the offered work. Credentials, availability, and legal requirements can change, and our review is not a guarantee of any provider&apos;s work, conduct, or continued eligibility.
                </p>
                <p>Service Providers are responsible for performing their work safely, lawfully, and in accordance with the confirmed scope. Any provider-specific warranty will be identified separately.</p>
              </PolicySection>

              <PolicySection id="responsibilities" title="9. Homeowner Responsibilities">
                <p>You agree to:</p>
                <ul>
                  <li>Provide accurate property, contact, access, and service information;</li>
                  <li>Have authority to request work at the service location;</li>
                  <li>Disclose known hazards, restricted access, pets, utilities, or conditions that may affect safe performance;</li>
                  <li>Provide safe and timely access at the confirmed appointment time;</li>
                  <li>Review the confirmed scope and promptly raise questions or errors; and</li>
                  <li>Treat Service Providers and Mercurius personnel respectfully.</li>
                </ul>
                <p>A provider may pause or decline work when conditions are unsafe, materially different from the request, outside the provider&apos;s qualifications, or unlawful.</p>
              </PolicySection>

              <PolicySection id="quality" title="10. Quality Concerns">
                <p>
                  Mercurius provides a managed point of contact for concerns involving services coordinated through the Platform. Notify us promptly with the request or booking details and a clear description of the issue. We may review communications, service records, photos, and provider information and work with the parties toward a reasonable resolution.
                </p>
                <p>The available resolution depends on the circumstances, confirmed scope, provider terms, and applicable policy. A refund, credit, or re-service is not automatic unless expressly included in the confirmed booking or required by law.</p>
              </PolicySection>

              <PolicySection id="content" title="11. Photos, Reviews & Communications">
                <p>
                  You or a Service Provider may submit photos, descriptions, reviews, or other content related to a request. You must have the right to provide that content and must not include unlawful material or information unrelated to the service. Service documentation may be used to coordinate work, verify status, address quality concerns, maintain records, and operate the Platform.
                </p>
                <p>
                  Reviews must reflect honest experiences. You retain ownership of content you submit, but grant Mercurius a non-exclusive license to store, reproduce, and display it as reasonably needed to operate the Platform. We will seek appropriate permission before using identifiable homeowner photos or statements in public marketing, except where content was knowingly submitted for public display.
                </p>
                <p>If you opt in to SMS updates, standard message and data rates may apply. Consent to marketing texts is not required to request a service, and you may withdraw consent using the instructions in the messages or by contacting us.</p>
              </PolicySection>

              <PolicySection id="conduct" title="12. Prohibited Conduct">
                <p>You may not:</p>
                <ul>
                  <li>Use the Platform for unlawful, fraudulent, deceptive, or harmful activity;</li>
                  <li>Provide false information, impersonate another person, or submit requests without authority;</li>
                  <li>Harass, threaten, discriminate against, or endanger another user, provider, or Mercurius personnel;</li>
                  <li>Interfere with Platform security, access another account, scrape protected information, or introduce malicious code;</li>
                  <li>Use provider or homeowner information obtained through the Platform for unrelated solicitation; or</li>
                  <li>Use the Platform to deliberately avoid an agreed fee or payment obligation associated with a Mercurius-coordinated service.</li>
                </ul>
              </PolicySection>

              <PolicySection id="property" title="13. Intellectual Property">
                <p>
                  The Platform, branding, software, design, and Mercurius-created content are owned by Mercurius or its licensors and are protected by applicable intellectual-property laws. Subject to these Terms, you may use the Platform only for its intended personal or business purpose. These Terms do not transfer ownership of Mercurius intellectual property to you.
                </p>
              </PolicySection>

              <PolicySection id="availability" title="14. Platform Availability & Disclaimers">
                <p>
                  The Platform is provided on an &quot;as available&quot; basis. We work to keep information useful and current, but we do not guarantee uninterrupted access, error-free operation, provider availability, a particular match, a specific completion time, or that every listed service is available in every location. Emergency services are not offered through the Platform; contact the appropriate emergency authority when health, safety, or property is at immediate risk.
                </p>
              </PolicySection>

              <PolicySection id="liability" title="15. Limitation of Liability">
                <p>
                  To the extent permitted by law, Mercurius is not responsible for indirect, incidental, special, or consequential losses arising from use of the Platform or a Service Provider&apos;s work. Nothing in these Terms excludes or limits liability that cannot lawfully be excluded, or affects non-waivable consumer rights. Any responsibility Mercurius has will be evaluated based on the specific facts and applicable law.
                </p>
              </PolicySection>

              <PolicySection id="suspension" title="16. Suspension & Termination">
                <p>
                  You may stop using the Platform at any time. We may restrict or suspend access when reasonably necessary to protect users or the Platform, investigate misuse, comply with law, address nonpayment, or enforce these Terms. Provisions that by their nature should continue—such as payment obligations, intellectual-property terms, and limitations of liability—survive termination.
                </p>
              </PolicySection>

              <PolicySection id="law" title="17. Governing Law & Disputes">
                <p>
                  If a concern arises, please contact us first so we can try to resolve it informally. These Terms are governed by Florida law, without regard to conflict-of-law principles. Any court proceeding relating to these Terms will be brought in a court with jurisdiction in or serving Lee County, Florida, unless applicable law requires a different venue. Nothing here prevents either party from using an available small-claims process or exercising rights that cannot be waived under applicable law.
                </p>
              </PolicySection>

              <PolicySection id="updates" title="18. Changes to These Terms">
                <p>
                  We may update these Terms as the Platform or our practices change. We will post the revised Terms and update the date above. If a change is material, we will provide additional notice when appropriate. Changes apply prospectively from their effective date.
                </p>
              </PolicySection>

              <PolicySection id="contact" title="19. Contact Us" last>
                <p>
                  Questions about these Terms can be sent to <a href="mailto:hello@mercurius.com">hello@mercurius.com</a> or through our <Link href="/contact">Contact page</Link>.
                </p>
                <Link href="/contact" className="mt-2 inline-flex items-center gap-1.5 font-semibold text-accent hover:text-accent/80">
                  Contact Mercurius <ArrowRight className="h-4 w-4" />
                </Link>
              </PolicySection>
            </article>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function PolicySection({ id, title, children, last = false }: { id: string; title: string; children: ReactNode; last?: boolean }) {
  return (
    <section id={id} className={`scroll-mt-24 py-8 md:py-10 ${last ? "" : "border-b border-border/50"}`}>
      <h2 className="text-xl font-bold text-foreground md:text-2xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-7 text-foreground/75 [&_a]:font-medium [&_a]:text-accent [&_a]:hover:underline [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}
