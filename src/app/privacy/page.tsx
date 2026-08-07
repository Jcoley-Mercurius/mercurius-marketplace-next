import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

const LAST_UPDATED = "August 5, 2026";

const sections = [
  ["scope", "1. Scope of This Policy"],
  ["information", "2. Information We Collect"],
  ["sources", "3. How We Collect Information"],
  ["uses", "4. How We Use Information"],
  ["sharing", "5. How We Share Information"],
  ["cookies", "6. Cookies & Similar Technologies"],
  ["choices", "7. Your Choices & Privacy Requests"],
  ["retention", "8. Data Retention"],
  ["security", "9. Data Security"],
  ["children", "10. Children’s Privacy"],
  ["third-party", "11. Third-Party Services"],
  ["changes", "12. Changes to This Policy"],
  ["contact", "13. Contact Us"],
] as const;

export default function PrivacyPolicyPage() {
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
                <ShieldCheck className="mr-2 h-4 w-4" /> Privacy &amp; Data
              </span>
              <h1 className="mb-5 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
                Privacy <span className="hero-gradient-text">Policy</span>
              </h1>
              <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground">
                How Mercurius collects, uses, and shares information when you use our managed home-services platform.
              </p>
              <p className="mt-6 text-sm font-medium text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            </div>
          </div>
        </section>

        <section className="bg-muted/35 py-12 md:py-16">
          <div className="container-wide grid max-w-6xl items-start gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
            <aside className="hidden lg:sticky lg:top-24 lg:block">
              <nav aria-label="Privacy Policy sections" className="rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
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
              <PolicySection id="scope" title="1. Scope of This Policy">
                <p>
                  Mercurius (&quot;Mercurius,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates a managed home-services platform serving Cape Coral, Fort Myers, and select areas of Southwest Florida. This Privacy Policy explains how we handle personal information when homeowners, service providers, vendor applicants, and website visitors use our website, accounts, service-request tools, vendor application, and related support services (collectively, the &quot;Platform&quot;).
                </p>
                <p>This Policy applies only to information handled by Mercurius. A service provider may have separate privacy practices for information it collects independently.</p>
              </PolicySection>

              <PolicySection id="information" title="2. Information We Collect">
                <p>Depending on how you use the Platform, we may collect:</p>
                <ul>
                  <li><strong>Account and contact information:</strong> Name, email address, phone number, account role, and authentication-related identifiers. Our authentication provider handles account credentials; we do not need access to your plain-text password.</li>
                  <li><strong>Property and service-request information:</strong> Service address, property details, requested services, preferred dates, access instructions, descriptions, and photos or files you choose to provide.</li>
                  <li><strong>Booking and service records:</strong> Provider matches, quotes, scheduled services, status updates, completion information, reviews, support issues, and related communications.</li>
                  <li><strong>Transaction information:</strong> Amounts, payment status, billing contact details, and limited transaction references when payment features are used. Payment-card details are handled by the applicable payment processor rather than stored directly by Mercurius.</li>
                  <li><strong>Vendor and applicant information:</strong> Business and owner contact details, service categories, coverage areas, credentials, insurance or license information, experience, references, availability, and application materials.</li>
                  <li><strong>Communications:</strong> Messages sent through forms, email, support channels, or service workflows, including communication preferences and SMS consent when provided.</li>
                  <li><strong>Device and usage information:</strong> IP address, browser and device information, pages viewed, referring pages, and diagnostic or security events generated when you use the Platform.</li>
                </ul>
              </PolicySection>

              <PolicySection id="sources" title="3. How We Collect Information">
                <p>We collect information directly from you, automatically through the technology used to operate the Platform, and from other people involved in a service or application. For example, an assigned provider may submit job-status updates or completion documentation, and service vendors may provide business information during onboarding.</p>
              </PolicySection>

              <PolicySection id="uses" title="4. How We Use Information">
                <p>We use personal information to:</p>
                <ul>
                  <li>Create and administer accounts;</li>
                  <li>Review requests, check coverage, suggest or coordinate provider matches, and manage bookings;</li>
                  <li>Prepare or communicate pricing, quotes, schedules, and service updates;</li>
                  <li>Process transactions and maintain business records when payment features are used;</li>
                  <li>Review vendor applications and administer provider relationships;</li>
                  <li>Respond to questions, support requests, and quality concerns;</li>
                  <li>Operate, secure, troubleshoot, and improve the Platform;</li>
                  <li>Detect misuse, enforce our terms, and comply with legal obligations; and</li>
                  <li>Send marketing communications where permitted. You may opt out of marketing without affecting service-related messages.</li>
                </ul>
              </PolicySection>

              <PolicySection id="sharing" title="5. How We Share Information">
                <p>We do not sell personal information for money. We may share information in the following circumstances:</p>
                <ul>
                  <li><strong>Service providers and applicants:</strong> We share the information reasonably needed to evaluate, match, schedule, or complete a service. We do not make homeowner contact or property details publicly available through the provider directory.</li>
                  <li><strong>Homeowners:</strong> We may share relevant provider profile, credential, quote, scheduling, and service information needed to evaluate or manage a request.</li>
                  <li><strong>Technology and operations vendors:</strong> Companies that support hosting, authentication, database services, communications, analytics, customer support, file storage, or other Platform operations may process information for us.</li>
                  <li><strong>Payment processors:</strong> When payments are available and used, transaction information is shared as needed to authorize, process, refund, or reconcile payments.</li>
                  <li><strong>Legal, safety, and compliance purposes:</strong> We may disclose information when reasonably necessary to comply with law, respond to lawful requests, protect people or property, investigate fraud or misuse, or enforce agreements.</li>
                  <li><strong>Business changes:</strong> Information may be transferred as part of a merger, financing, acquisition, reorganization, or sale of all or part of the business, subject to applicable law.</li>
                </ul>
                <p>Vendor public profiles may display business information that the vendor has provided or approved for marketing use, such as business name, service area, services, logo, and professional description.</p>
              </PolicySection>

              <PolicySection id="cookies" title="6. Cookies & Similar Technologies">
                <p>
                  We and the providers that help operate the Platform may use cookies, local storage, and similar technologies for authentication, security, preferences, performance, and basic usage measurement. Browser controls may allow you to block or delete these technologies, but disabling essential storage may prevent account or Platform features from working correctly.
                </p>
              </PolicySection>

              <PolicySection id="choices" title="7. Your Choices & Privacy Requests">
                <p>Depending on applicable law and the nature of your request, you may ask us to access, correct, delete, or provide a copy of personal information associated with you. We may need to verify your identity and may retain information where required or permitted by law.</p>
                <ul>
                  <li>You can unsubscribe from promotional email using the instructions in the message or by contacting us.</li>
                  <li>If you opt in to SMS updates, you can withdraw that consent using the instructions provided in the messages or by contacting us. Service-related communications may still be sent through other available channels.</li>
                  <li>You may update certain account information through the Platform when those controls are available.</li>
                </ul>
                <p>
                  Submit a privacy request by emailing <a href="mailto:hello@mercurius.com">hello@mercurius.com</a> or using our <Link href="/contact">Contact page</Link>. If applicable law provides an appeal process, you may use the same contact methods to ask us to reconsider a decision.
                </p>
              </PolicySection>

              <PolicySection id="retention" title="8. Data Retention">
                <p>
                  We retain personal information only for as long as reasonably needed for the purposes described in this Policy, including maintaining accounts and service records, completing transactions, resolving disputes, meeting tax or legal obligations, preventing fraud, and enforcing agreements. Retention periods vary based on the type of information and why it was collected. We may delete or de-identify information when it is no longer needed, subject to backup and legal-retention requirements.
                </p>
              </PolicySection>

              <PolicySection id="security" title="9. Data Security">
                <p>
                  We use reasonable administrative, technical, and organizational measures designed to protect personal information based on the nature of the information and our operations. No website, transmission, or storage system is completely secure, so we cannot guarantee absolute security. Please use a unique password and notify us if you believe your account or information has been compromised.
                </p>
              </PolicySection>

              <PolicySection id="children" title="10. Children’s Privacy">
                <p>
                  The Platform is intended for adults and is not directed to children under 18. We do not knowingly collect personal information directly from children. If you believe a child has provided personal information through the Platform, contact us so we can review and address the request.
                </p>
              </PolicySection>

              <PolicySection id="third-party" title="11. Third-Party Services">
                <p>
                  The Platform may link to or integrate with services operated by others. Their privacy practices are governed by their own policies, and we encourage you to review those policies before providing information directly to them.
                </p>
              </PolicySection>

              <PolicySection id="changes" title="12. Changes to This Policy">
                <p>
                  We may update this Privacy Policy as the Platform, our practices, or applicable requirements change. We will post the revised Policy and update the date above. If a change materially affects how we use personal information, we will provide additional notice when appropriate.
                </p>
              </PolicySection>

              <PolicySection id="contact" title="13. Contact Us" last>
                <p>
                  Questions or privacy requests can be sent to <a href="mailto:hello@mercurius.com">hello@mercurius.com</a> or through our <Link href="/contact">Contact page</Link>.
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
