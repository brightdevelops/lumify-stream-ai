import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of Service — Lumify" },
      { name: "description", content: "Terms of Service for Lumify, including session recording and acceptable use." },
    ],
  }),
});

function TermsPage() {
  const updated = "June 15, 2026";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/"><Logo /></Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Home</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-display">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-xl text-foreground">1. Acceptance</h2>
            <p className="mt-3">
              By creating an account or using Lumify ("the Service"), you agree to these Terms of
              Service. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">2. The Service</h2>
            <p className="mt-3">
              Lumify provides AI-powered real-time video transformation. You provide an input video
              feed and prompts/styles; the Service returns a transformed output stream. Credits are
              consumed while a stream is active at the rates published on the Buy Credits page.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">3. Account &amp; Eligibility</h2>
            <p className="mt-3">
              You must be at least 18 years old to use the Service. You are responsible for
              activity under your account and for keeping your credentials secure. We may suspend
              or terminate accounts that violate these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">4. Acceptable Use</h2>
            <p className="mt-3">You may not use the Service to generate, distribute, or attempt to generate:</p>
            <ul className="mt-3 list-disc pl-6 space-y-1">
              <li>Sexual content involving minors, or any content that sexualises minors.</li>
              <li>Non-consensual sexual content, "deepfake" pornography, or intimate imagery of real people without consent.</li>
              <li>Content used to defraud, impersonate, scam, blackmail, or extort another person.</li>
              <li>Content depicting graphic real-world violence, terrorism, or incitement of violence.</li>
              <li>Content that infringes intellectual property, privacy, or publicity rights.</li>
              <li>Any content that violates the laws of your jurisdiction or Nigeria.</li>
            </ul>
            <p className="mt-3">
              Violations may result in immediate account termination, forfeiture of unused credits,
              and reporting to law enforcement where required.
            </p>
          </section>


          <section>
            <h2 className="text-xl text-foreground">6. Payments &amp; Credits</h2>
            <p className="mt-3">
              Credits are sold in fixed packs in Nigerian Naira (NGN) via Paystack. Credits never
              expire but are non-refundable except where required by law. Prices and credit-burn
              rates may change with notice on the Buy Credits page.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">7. Privacy</h2>
            <p className="mt-3">
              We collect the data described above (account info, payment records, IP and country,
              session recordings, and style logs) to operate the Service, prevent abuse, and comply
              with the law. We do not sell your personal data. You may request deletion of your
              account by contacting support; deletion removes your profile, recordings, and logs
              within 30 days, except where retention is required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">8. Disclaimers</h2>
            <p className="mt-3">
              The Service is provided "as is" without warranties of any kind. Lumify is not liable
              for indirect or consequential damages. Our maximum liability is limited to the
              amounts you paid us in the 30 days preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">9. Changes</h2>
            <p className="mt-3">
              We may update these Terms from time to time. Continued use of the Service after an
              update constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">10. Contact</h2>
            <p className="mt-3">
              For questions about these Terms or to report abuse, contact us through the support
              channel listed on lumifylive.com.
            </p>
          </section>
        </div>

        <div className="mt-12">
          <Link to="/signup" className="text-sm text-primary hover:underline">← Back to sign up</Link>
        </div>
      </main>
    </div>
  );
}
