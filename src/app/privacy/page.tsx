import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

const LAST_UPDATED = "March 25, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="bg-background py-16 md:py-24">
        <div className="container-wide max-w-3xl">
          <h1 className="mb-2 text-4xl font-bold text-foreground">Privacy Policy</h1>
          <p className="mb-12 text-muted-foreground">Last updated: {LAST_UPDATED}</p>

          <div className="prose prose-neutral max-w-none space-y-10 text-foreground/80 dark:prose-invert">
            <section>
              <h2 className="text-xl font-semibold text-foreground">1. Introduction</h2>
              <p>
                Mercurius (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) respects your privacy and is committed to protecting your
                personal information. This Privacy Policy explains how we collect, use, share, and
                safeguard data when you use the Mercurius platform, including our website and related
                services, in the Fort Myers and Cape Coral, Florida area.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">2. Information We Collect</h2>
              <p>We collect the following types of information:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li><strong>Account information:</strong> Name, email address, phone number, and password when you register.</li>
                <li><strong>Property details:</strong> Address, home type, square footage, and feature details you provide through your home profile.</li>
                <li><strong>Payment information:</strong> Billing address and payment method details, processed securely by our third-party payment provider.</li>
                <li><strong>Service history:</strong> Records of services booked, completed, and reviewed.</li>
                <li><strong>Communications:</strong> Messages exchanged between you and vendors or our support team through the platform.</li>
                <li><strong>Usage data:</strong> Pages visited, features used, device type, browser, IP address, and referring URLs.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">3. How We Use Your Information</h2>
              <ul className="list-disc space-y-1 pl-6">
                <li>Matching you with qualified, local service vendors</li>
                <li>Processing bookings, payments, and refunds</li>
                <li>Communicating about your services, account, and platform updates</li>
                <li>Improving our platform, features, and customer experience</li>
                <li>Preventing fraud, enforcing our terms, and maintaining platform security</li>
                <li>Sending promotional communications (with your consent; you can opt out at any time)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">4. How We Share Your Information</h2>
              <p>We do not sell your personal data. We share information only as needed:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li><strong>With vendors:</strong> Your name, address, and service details are shared with the assigned vendor so they can complete the job.</li>
                <li><strong>Payment processors:</strong> Payment details are shared with our secure payment provider to process transactions.</li>
                <li><strong>Service providers:</strong> We use third-party tools for analytics, email delivery, and customer support.</li>
                <li><strong>Legal requirements:</strong> We may disclose information if required by law, regulation, or legal process.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">5. Cookies &amp; Analytics</h2>
              <p>
                We use cookies and similar technologies to remember your preferences, analyze traffic
                patterns, and improve platform performance. You can manage cookie preferences through
                your browser settings. Disabling cookies may limit some platform functionality.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">6. Data Security</h2>
              <p>
                We implement industry-standard security measures, including encryption in transit and at
                rest, access controls, and regular security audits. While no system is completely secure,
                we take reasonable steps to protect your information from unauthorized access, alteration,
                or destruction.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">7. Your Rights</h2>
              <p>Depending on your location, you may have the right to:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li>Access the personal information we hold about you</li>
                <li>Request correction of inaccurate data</li>
                <li>Request deletion of your personal data</li>
                <li>Opt out of marketing communications</li>
                <li>Request a copy of your data in a portable format</li>
              </ul>
              <p>
                To exercise any of these rights, contact us at{" "}
                <a href="mailto:hello@mercurius.com" className="text-accent hover:underline">
                  hello@mercurius.com
                </a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">8. Data Retention</h2>
              <p>
                We retain your personal information for as long as your account is active or as needed to
                provide services. After account deletion, we may retain certain data for up to 3 years to
                comply with legal obligations, resolve disputes, and enforce our agreements.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">9. Children&apos;s Privacy</h2>
              <p>
                Mercurius is not directed at individuals under 18 years of age. We do not knowingly
                collect personal information from children. If we learn that we have collected data from
                a minor, we will delete it promptly.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">10. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. When we do, we will revise the
                &quot;Last updated&quot; date at the top. We encourage you to review this page periodically.
                Continued use of the platform after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">11. Contact Us</h2>
              <p>
                If you have questions or concerns about this Privacy Policy, please reach out at{" "}
                <a href="mailto:hello@mercurius.com" className="text-accent hover:underline">
                  hello@mercurius.com
                </a>{" "}
                or visit our Contact page.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
