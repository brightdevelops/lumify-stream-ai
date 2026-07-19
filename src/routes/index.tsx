import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { Zap, CreditCard, Wand2, Check } from "lucide-react";


export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Lumify — Transform your stream with intelligent light" },
      { name: "description", content: "Real-time AI video transformation. Pay as you stream. Prompt-based control." },
    ],
  }),
});

const packages = [
  { name: "Starter", credits: 500, price: "₦11,500" },
  { name: "Basic", credits: 1000, price: "₦23,000", popular: true },
  { name: "Pro", credits: 2000, price: "₦46,000" },
  { name: "Enterprise", credits: 5000, price: "₦115,000" },
];

const features = [
  { icon: Zap, title: "Real-time transformation", body: "Sub-second AI processing keeps every frame of your stream synced to the prompt — no lag, no jitter." },
  { icon: CreditCard, title: "Pay as you stream", body: "2 credits per second (₦46/sec) · 1 credit = ₦23. No subscriptions, no surprises. Credits never expire." },
  { icon: Wand2, title: "Prompt-based control", body: "Switch from cyberpunk to oil painting with a sentence. Save presets, recall them instantly mid-stream." },
];

function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let sawInitialSession = false;
    const finishCheck = () => {
      if (!cancelled) setAuthChecked(true);
    };

    // Let Supabase emit INITIAL_SESSION instead of calling getSession() here.
    // getSession() can proactively refresh near-expiry tokens and compete with
    // the SDK startup refresh, which was revoking refresh tokens for some users.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session) {
        setHasSession(true);
        navigate({ to: "/dashboard", replace: true });
      } else if (event === "INITIAL_SESSION") {
        sawInitialSession = true;
        finishCheck();
      } else if (sawInitialSession) {
        finishCheck();
      }
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!authChecked || hasSession) return null;



  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className={`sticky top-0 z-50 transition-colors ${scrolled ? "bg-background/80 backdrop-blur border-b border-border" : ""}`}>
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Logo />
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden sm:inline-flex rounded-md px-4 py-2 text-sm text-foreground hover:bg-secondary">Log in</Link>
            <Link to="/signup" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Sign up</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-24 pb-28 text-center">
        <h1 className="mt-6 text-5xl md:text-7xl leading-[1.05] tracking-tight">
          Transform your stream <br /> with <span className="text-primary">intelligent light</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Lumify reimagines your camera feed in real time. Describe a look, and your live video becomes it — frame by frame, latency-free.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link to="/signup" className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">Get Started</Link>
          <a href="#features" className="rounded-md border border-border bg-card px-6 py-3 text-sm font-medium text-foreground hover:bg-secondary">See it live</a>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-5 md:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-8">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-6 text-xl">{f.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-32">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-4xl md:text-5xl">Simple, transparent credits</h2>
          <p className="mt-4 text-muted-foreground">2 credits per second (₦46/sec) · 1 credit = ₦23 · Credits never expire.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {packages.map((p) => (
            <div key={p.name} className={`relative rounded-xl border bg-card p-6 ${p.popular ? "border-primary" : "border-border"}`}>
              {p.popular && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground">Most popular</span>
              )}
              <div className="text-sm text-muted-foreground">{p.name}</div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl text-primary font-display">{p.credits.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground">credits</span>
              </div>
              <div className="mt-1 text-2xl">{p.price}</div>
              <div className="mt-1 text-xs text-muted-foreground">≈ {Math.round(p.credits / 2 / 60)} minutes of streaming</div>
              <Link to="/signup" className="mt-6 block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:opacity-90">
                Buy {p.name}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Logo />
            <p className="text-xs text-muted-foreground">
              Support:{" "}
              <a href="mailto:support@lumifylive.com" className="hover:text-foreground">
                support@lumifylive.com
              </a>
            </p>
            <p className="text-xs text-muted-foreground">© 2026 Bright Solutionslab (BN 9689076). Lumify is a product of Bright Solutionslab.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/refunds" className="hover:text-foreground">Refunds</Link>
            <Link to="/trust" className="hover:text-foreground">Trust &amp; Security</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
