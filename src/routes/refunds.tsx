import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/refunds")({
  component: RefundsPage,
  head: () => ({
    meta: [
      { title: "Refund Policy — Lumify" },
      { name: "description", content: "Lumify credit refund policy. All credit purchases are final and non-refundable." },
      { property: "og:title", content: "Refund Policy — Lumify" },
      { property: "og:description", content: "Lumify credit purchases are final and non-refundable, except where required by law." },
    ],
  }),
});

const SUPPORT_EMAIL = "support@lumifylive.com";

function RefundsPage() {
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
        <h1 className="text-4xl font-display">Refund Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="mt-10 space-y-10 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-xl text-foreground">1. All sales are final</h2>
            <p className="mt-3">
              Lumify credits are a prepaid consumable used to pay for AI compute time. All credit
              purchases are <span className="text-foreground">final and non-refundable</span> once
              credits have been issued to your account, except where a refund is required by
              applicable law.
            </p>
            <p className="mt-3">
              Credits never expire. Unused credits remain in your account and can be spent at any
              time on any future stream.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">2. Failed or duplicate payments</h2>
            <p className="mt-3">
              If your card was charged but credits were not added to your account, or if you were
              charged twice for the same order, email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>{" "}
              with your Flutterwave transaction reference. We will investigate, credit the missing
              balance, and — for confirmed duplicates — reverse the extra charge through
              Flutterwave.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">3. Service outages</h2>
            <p className="mt-3">
              Credits are only consumed while a stream is actively running. Credits are not
              deducted for time a stream was down due to an outage on our side. If you believe
              credits were incorrectly deducted during an outage, contact support with the session
              date and approximate time and we will review the session log.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">4. Chargebacks</h2>
            <p className="mt-3">
              Please contact us before filing a chargeback — most billing issues can be resolved
              directly and much faster. Accounts with unresolved chargebacks may be suspended and
              any remaining credits forfeited.
            </p>
          </section>

          <section>
            <h2 className="text-xl text-foreground">5. How to contact us</h2>
            <p className="mt-3">
              Email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>{" "}
              with your account email and the Flutterwave transaction reference. We aim to respond
              within 2 business days.
            </p>
          </section>
        </div>

        <div className="mt-12 flex gap-6 text-sm">
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link to="/trust" className="text-primary hover:underline">Trust &amp; Security</Link>
        </div>
      </main>
    </div>
  );
}
