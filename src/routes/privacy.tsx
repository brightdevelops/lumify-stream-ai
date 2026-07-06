import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy — Lumify" },
      { name: "description", content: "How Lumify collects, uses, stores, and protects your personal information." },
      { property: "og:title", content: "Privacy Policy — Lumify" },
      { property: "og:description", content: "How Lumify collects, uses, stores, and protects your personal information." },
    ],
  }),
});

const SUPPORT_EMAIL = "support@lumifylive.com";

function PrivacyPage() {
  const updated = "July 6, 2026";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/"><Logo /></Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Home</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-display">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-xl text-foreground">1. Who we are</h2>
            <p className="mt-3">
              Lumify ("we", "us") operates the AI real-time video transformation service at
              lumifylive.com. This policy explains what personal information we collect, how we
              use it, and the choices you have.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">2. Information we collect</h2>
            <ul className="mt-3 list-disc pl-6 space-y-2">
              <li><span className="text-foreground">Account data:</span> email address, password hash, display name, and (if you sign in with Google) the basic profile information Google shares with us.</li>
              <li><span className="text-foreground">Billing data:</span> the amount, currency, pack purchased, and a payment reference returned by Flutterwave. We do not receive or store card numbers.</li>
              <li><span className="text-foreground">Usage data:</span> credit balance, transaction history, stream sessions (start/end time, credits consumed), prompts you submit, and support messages you send us.</li>
              
            </ul>
          </section>

          <section>
            <h2 className="text-xl text-foreground">3. How we use it</h2>
            <ul className="mt-3 list-disc pl-6 space-y-2">
              <li>Providing the Service — authenticating you, running transformations, tracking credits, and delivering your output stream.</li>
              <li>Processing payments and issuing credits via Flutterwave.</li>
              <li>Preventing fraud, abuse, and violations of our Terms of Service.</li>
              <li>Responding to your support requests.</li>
              <li>Improving reliability and performance of the Service.</li>
            </ul>
            <p className="mt-3">
              We do not sell your personal information. We do not use your prompts or stream input to train AI models.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">4. Cookies &amp; local storage</h2>
            <p className="mt-3">
              We use strictly necessary cookies and browser local storage to keep you signed in and
              to remember basic preferences (such as your session and interface settings). We do not
              use advertising cookies or third-party tracking cookies. You can clear this data at any
              time from your browser settings; doing so will sign you out.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">5. Retention</h2>
            <p className="mt-3">
              Account and billing records are retained while your account is active and for a
              reasonable period afterwards to meet legal and accounting obligations. Stream
              recordings are retained until you delete them from your account. You can delete
              your account at any time from Settings; residual backup copies are purged on our
              normal backup rotation.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">6. Security</h2>
            <p className="mt-3">
              We use row-level access controls in the database, server-side role checks for
              administrative actions, private storage buckets for recordings, and signed webhooks
              for payment callbacks. See our <Link to="/trust" className="text-primary hover:underline">Trust &amp; Security</Link> page
              for more detail. No system is perfectly secure; you are responsible for keeping your
              password and OBS stream token private.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">7. Your rights</h2>
            <p className="mt-3">
              You may request access to, correction of, or deletion of your personal information
              by emailing <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
              We will respond within a reasonable time. Deleting your account removes your profile
              and stream sessions; anonymised transaction records may be retained for
              accounting purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">8. Nigeria Data Protection Act (NDPA)</h2>
            <p className="mt-3">
              Lumify is operated from Nigeria and processes personal data in line with the Nigeria
              Data Protection Act, 2023 (NDPA) and guidance issued by the Nigeria Data Protection
              Commission (NDPC). If you are a data subject in Nigeria, you have the right to access,
              rectify, delete, restrict, or object to the processing of your personal data, and to
              lodge a complaint with the NDPC. To exercise any of these rights, email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">9. Children</h2>
            <p className="mt-3">
              Lumify is not intended for anyone under 18. We do not knowingly collect information
              from children. If you believe a child has created an account, contact us and we will
              remove it.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">10. Changes</h2>
            <p className="mt-3">
              We may update this policy from time to time. Material changes will be announced on
              this page with a new "Last updated" date.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">11. Contact</h2>
            <p className="mt-3">
              Questions about this policy? Email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
            </p>
          </section>

        </div>

        <div className="mt-12 flex gap-6 text-sm">
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link to="/refunds" className="text-primary hover:underline">Refund Policy</Link>
          <Link to="/trust" className="text-primary hover:underline">Trust &amp; Security</Link>
        </div>
      </main>
    </div>
  );
}
