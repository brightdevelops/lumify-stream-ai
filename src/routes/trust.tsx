import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { ShieldCheck, Lock, Database, KeyRound, Mail, FileText } from "lucide-react";

export const Route = createFileRoute("/trust")({
  component: TrustPage,
  head: () => ({
    meta: [
      { title: "Trust & Security — Lumify" },
      {
        name: "description",
        content:
          "How Lumify protects your account, data, and payments. Maintained by the Lumify team.",
      },
      { property: "og:title", content: "Trust & Security — Lumify" },
      {
        property: "og:description",
        content:
          "Authentication, data handling, payment security, and how to contact us about a security concern.",
      },
    ],
  }),
});

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function TrustPage() {
  const updated = "June 22, 2026";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/"><Logo /></Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Home
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-display">Trust & Security</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        <p className="mt-6 text-sm text-muted-foreground max-w-2xl">
          This page is maintained by the Lumify team to answer common security and
          privacy questions about Lumify. It describes controls that are currently
          enabled in the product. It is not an independent certification or audit.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <Section icon={ShieldCheck} title="Account & access">
            <p>
              Accounts are protected by email + password authentication. Sessions are stored in
              your browser and refreshed automatically; you can sign out from Settings at any time.
            </p>
          </Section>


          <Section icon={Database} title="Your data">
            <p>
              Each user can only read and modify their own profile, credit balance,
              transactions, support messages, and stream sessions. These rules are
              enforced in the database, not just the UI.
            </p>
          </Section>


          <Section icon={Lock} title="Payments">
            <p>
              Card and bank payments are processed by Flutterwave. Lumify never sees full card
              numbers. Every successful payment is verified server-side against Flutterwave before
              credits are issued, and webhook callbacks are signature-checked.
            </p>
          </Section>

          <Section icon={KeyRound} title="Secrets & stream tokens">
            <p>
              API keys for payment, AI, and storage providers are stored as server-only
              secrets and never shipped to the browser.
            </p>
            <p>
              Your personal OBS stream token grants access to your live output feed.
              Keep it private — anyone with the link can view your output. You can
              regenerate it from Settings at any time to revoke prior links.
            </p>
          </Section>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              Report a security issue
            </h2>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            If you believe you have found a vulnerability, please contact us through the
            in-app{" "}
            <Link to="/" className="text-primary underline">
              support widget
            </Link>{" "}
            or email the address listed on our home page. Please do not publicly
            disclose the issue until we have had a chance to investigate.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <FileText className="h-4 w-4" />
          <Link to="/terms" className="hover:text-foreground underline">
            Terms of Service
          </Link>
        </div>
      </main>
    </div>
  );
}
