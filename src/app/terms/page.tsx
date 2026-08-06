import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

const LAST_UPDATED = "March 25, 2026";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="bg-background py-16 md:py-24">
        <div className="container-wide max-w-3xl">
          <h1 className="mb-2 text-4xl font-bold text-foreground">Terms &amp; Conditions</h1>
          <p className="mb-12 text-muted-foreground">Last updated: {LAST_UPDATED}</p>

          <div className="prose prose-neutral max-w-none space-y-10 text-foreground/80 dark:prose-invert">
            <section>
              <h2 className="text-xl font-semibold text-foreground">1. About Mercurius</h2>
              <p>
                Mercurius (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) operates a managed home services platform that connects homeowners
                in the Fort Myers and Cape Coral, Florida area with pre-vetted local service providers
                (&quot;vendors&quot;). We coordinate scheduling, communication, quality assurance, and payment processing on behalf
                of both parties. Mercurius is not itself a contractor or service provider.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">2. Acceptance of Terms</h2>
              <p>
                By accessing or using the Mercurius platform (website, mobile applications, or related
                services), you agree to be bound by these Terms &amp; Conditions. If you do not agree,
                please do not use our services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">3. User Accounts</h2>
              <p>
                You must provide accurate, complete information when creating an account. You are
                responsible for maintaining the confidentiality of your login credentials and for all
                activity under your account. Mercurius reserves the right to suspend or terminate
                accounts that violate these terms or engage in fraudulent activity.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">4. Services, Booking &amp; Pricing</h2>
              <p>
                All service pricing is displayed upfront before you confirm a booking. Prices include
                the service fee and a platform coordination fee. Once a booking is confirmed, the quoted
                price is locked unless the scope of work changes and both parties agree to an adjustment.
              </p>
              <p>
                Cancellations made more than 24 hours before a scheduled service are fully refundable.
                Late cancellations or no-shows may incur a fee as described in our Reschedule &amp;
                Cancellation Policy.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">5. Payments</h2>
              <p>
                Payments are processed securely through our third-party payment provider. By booking a
                service, you authorize Mercurius to charge the payment method on file. Vendors receive
                payouts after job completion and homeowner confirmation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">6. Vendor Relationship</h2>
              <p>
                Vendors listed on Mercurius are independent contractors, not employees of Mercurius.
                While we vet vendors for licensing, insurance, and quality standards, Mercurius does not
                directly supervise or control the work performed. Any warranties or guarantees provided
                are between you and the vendor, facilitated by our platform.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">7. Service Guarantee</h2>
              <p>
                We stand behind the quality of work coordinated through our platform. If a service does
                not meet the agreed-upon scope, contact us within 48 hours of completion. We will work
                with the vendor to resolve the issue or arrange a re-service at no additional cost.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">8. Photo Documentation</h2>
              <p>
                Vendors may take before-and-after photos of completed work for quality assurance
                purposes. These photos are visible to the homeowner and Mercurius staff. By using the
                platform, you consent to this documentation process.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">9. Prohibited Conduct</h2>
              <ul className="list-disc space-y-1 pl-6">
                <li>Contacting vendors outside the platform to circumvent fees</li>
                <li>Providing false or misleading information</li>
                <li>Harassing or threatening vendors, staff, or other users</li>
                <li>Using the platform for any unlawful purpose</li>
                <li>Attempting to reverse-engineer or disrupt the platform</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">10. Intellectual Property</h2>
              <p>
                All content on the Mercurius platform, including text, graphics, logos, and software, is
                owned by Mercurius or its licensors. You may not copy, modify, or distribute any content
                without prior written consent. Reviews and photos you submit may be used by Mercurius for
                marketing and quality purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">11. Limitation of Liability</h2>
              <p>
                To the fullest extent permitted by law, Mercurius is not liable for any indirect,
                incidental, special, or consequential damages arising from your use of the platform or
                services booked through it. Our total liability shall not exceed the amount you paid for
                the specific service giving rise to the claim.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">12. Dispute Resolution</h2>
              <p>
                If a dispute arises between you and a vendor, Mercurius will act as a mediator to find a
                fair resolution. If mediation is unsuccessful, disputes shall be resolved through binding
                arbitration in Lee County, Florida, in accordance with applicable rules.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">13. Changes to These Terms</h2>
              <p>
                We may update these Terms &amp; Conditions from time to time. When we do, we will revise the
                &quot;Last updated&quot; date at the top. Continued use of the platform after changes constitutes
                acceptance of the revised terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground">14. Contact Us</h2>
              <p>
                If you have questions about these terms, reach out to us at{" "}
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
