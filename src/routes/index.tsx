import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import {
  Play, ArrowRight, Sparkles, Zap, Palette, Monitor, CreditCard, Lock,
  Camera, Wand2, Radio, Check, Plus, Minus,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Lumify — Transform your stream with intelligent light" },
      { name: "description", content: "Lumify turns your webcam into a real-time AI persona. Go live as a sharper, styled, or entirely new version of you — no green screen, no GPU, no editing." },
      { property: "og:title", content: "Lumify — Transform your stream with intelligent light" },
      { property: "og:description", content: "Real-time AI video for creators. Pay as you stream. Works with OBS out of the box." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://lumifylive.com/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://lumifylive.com/og-image.png" },
    ],
  }),
});

const PACKS = [
  { id: "starter",  name: "Starter",  credits: 500,  price: 11500, save: null },
  { id: "basic",    name: "Basic",    credits: 1000, price: 23000, save: null, popular: true },
  { id: "pro",      name: "Pro",      credits: 2000, price: 46000, save: null },
];

const FAQS = [
  { q: "Do I need a powerful computer?", a: "No. All the AI work happens on Lumify's servers. Any modern laptop and a webcam is enough — you just need a stable internet connection." },
  { q: "How much does it cost?", a: "Streaming costs 2 credits per second (₦46/sec). You only pay while you're live — there's no monthly fee and credits never expire." },
  { q: "Does it work with Twitch, YouTube, TikTok?", a: "Yes. Lumify gives you a private OBS Browser Source URL. Once it's in OBS, you can push to any platform OBS supports." },
  { q: "Is my camera feed stored?", a: "No. Your camera stream is processed in real time and not retained. Only your session metadata (duration, credits used) is stored for billing." },
  { q: "How do I pay?", a: "Top-ups are handled by Korapay — card, bank transfer, and mobile money in NGN. Payments are processed securely and credits are added the moment payment confirms." },
];

function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let sawInitialSession = false;
    const finishCheck = () => { if (!cancelled) setAuthChecked(true); };
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
      {/* NAV */}
      <header className={`sticky top-0 z-50 transition-colors ${scrolled ? "backdrop-blur border-b" : ""}`} style={{ background: scrolled ? "rgba(11,13,10,0.7)" : "transparent" }}>
        <div className="mx-auto max-w-[1160px] px-6 h-[68px] flex items-center justify-between">
          <Logo />
          <nav className="hidden md:flex items-center gap-8 text-[13px] text-[color:var(--muted-foreground)]">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden sm:inline-flex text-[13px] text-[color:var(--muted-foreground)] hover:text-foreground px-3 py-2">Log in</Link>
            <Link to="/signup" className="btn-primary text-[13px] px-4 py-2.5">Get started</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute left-1/2 top-16 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
               style={{ background: "radial-gradient(closest-side, rgba(198,242,78,0.25), transparent 70%)" }} />
        </div>
        <div className="mx-auto max-w-[900px] px-6 pt-16 pb-14 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            <span className="status-dot live" /> Live AI video · works with OBS
          </span>
          <h1 className="mt-6 font-display text-5xl md:text-[68px] leading-[1.05] tracking-tight">
            Transform your stream with{" "}
            <em className="not-italic italic text-primary">intelligent light</em>
          </h1>
          <p className="mx-auto mt-6 max-w-[640px] text-[16px] text-[color:var(--muted-foreground)]">
            Lumify turns your webcam into a real-time AI persona. Go live as a sharper, styled, or entirely new version of you — no green screen, no GPU, no editing.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className="btn-primary"><Play size={15} /> Start streaming free</Link>
            <a href="#how" className="btn-ghost">See how it works</a>
          </div>
          <p className="mt-5 text-[12px] text-[color:var(--faint)]">Pay as you stream · from ₦23 per credit · no subscription</p>
        </div>

        {/* Hero demo */}
        <div className="mx-auto max-w-[1080px] px-6 pb-20">
          <div className="rounded-2xl border bg-card overflow-hidden shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)]">
            <div className="flex items-center gap-1.5 border-b px-4 py-2.5 bg-[color:var(--sidebar)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f2b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f2b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f2b]" />
              <span className="ml-3 text-[11px] text-[color:var(--faint)]">lumify.live/studio</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-6 p-6 md:p-10">
              <DemoPanel variant="camera" />
              <div className="grid place-items-center rotate-90 md:rotate-0">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary text-[color:var(--primary-foreground)]"
                     style={{ boxShadow: "0 0 30px var(--accent-glow)" }}>
                  <ArrowRight size={18} />
                </div>
              </div>
              <DemoPanel variant="output" />
            </div>
          </div>

          {/* Stat strip */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { big: "< 120 ms", small: "added latency" },
              { big: "720p", small: "optimized output" },
              { big: "2 cr/sec", small: "simple usage pricing" },
              { big: "OBS-ready", small: "one URL, any platform" },
            ].map((s) => (
              <div key={s.small} className="card-surface text-center">
                <div className="font-display text-2xl text-foreground">{s.big}</div>
                <div className="mt-1 text-[12px] text-[color:var(--muted-foreground)]">{s.small}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-[1080px] px-6 py-20">
        <SectionHead eyebrow="How it works" title="Three steps to a new you on stream" />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            { n: 1, t: "Point your camera", d: "Plug in any webcam or use your laptop's camera. No special gear, no green screen." },
            { n: 2, t: "Choose your look", d: "Pick Realistic Mode for a polished you, or Stylized for creative presets. Adjust in real time." },
            { n: 3, t: "Go live anywhere", d: "Paste your Lumify URL into OBS as a Browser Source and stream to Twitch, YouTube, TikTok — anywhere OBS goes." },
          ].map((s) => (
            <div key={s.n} className="card-surface card-lift">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-[color:var(--primary-foreground)] font-display text-lg">
                {s.n}
              </div>
              <h3 className="mt-5 font-display text-[22px] text-foreground">{s.t}</h3>
              <p className="mt-2 text-[14px] text-[color:var(--muted-foreground)]">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="mx-auto max-w-[1080px] px-6 py-20">
        <SectionHead eyebrow="Features" title="Built for creators who go live" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: Zap, t: "Real-time transformation", d: "Sub-second AI processing keeps every frame in sync with your prompt. No lag, no jitter." },
            { icon: Camera, t: "Realistic mode", d: "Look sharper, better lit, more on-brand — while still unmistakably you." },
            { icon: Palette, t: "Stylized presets", d: "Anime, painterly, cinematic and more. Swap looks mid-stream in a click." },
            { icon: Monitor, t: "OBS in one URL", d: "Add a Browser Source, paste your private URL, done. Works with Twitch, YouTube, TikTok." },
            { icon: CreditCard, t: "Pay as you stream", d: "2 credits per second, only while you're live. No monthly fee. Credits never expire." },
            { icon: Lock, t: "Private by design", d: "Your camera feed is processed in real time and not retained. Only session metadata is stored." },
          ].map((f) => (
            <div key={f.t} className="card-surface card-lift">
              <div className="grid h-10 w-10 place-items-center rounded-lg" style={{ background: "var(--accent-soft)", color: "var(--primary)" }}>
                <f.icon size={18} />
              </div>
              <h3 className="mt-5 font-display text-[20px] text-foreground">{f.t}</h3>
              <p className="mt-2 text-[13.5px] text-[color:var(--muted-foreground)]">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-[1080px] px-6 py-20">
        <SectionHead eyebrow="Pricing" title="Top up, stream, come back later" />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PACKS.map((p) => {
            const mins = Math.round(p.credits / 2 / 60);
            const highlighted = "popular" in p && p.popular;
            return (
              <div key={p.id}
                   className={`relative rounded-2xl p-6 card-lift ${highlighted ? "accent-card" : "card-surface"}`}
                   style={highlighted ? { boxShadow: "0 0 0 1px var(--primary), 0 20px 60px -30px var(--accent-glow)" } : undefined}>
                {highlighted && (
                  <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--primary-foreground)]">
                    Most popular
                  </span>
                )}
                <div className="eyebrow">{p.name}</div>
                <div className="mt-3 font-display text-[42px] leading-none text-foreground">
                  {p.credits.toLocaleString()} <span className="text-[16px] text-[color:var(--muted-foreground)]">cr</span>
                </div>
                <div className="mt-2 text-[15px] text-foreground">₦{p.price.toLocaleString()}</div>
                <div className="mt-1 text-[12px] text-[color:var(--faint)]">≈ {mins} minutes of streaming</div>
                <ul className="mt-5 space-y-2 text-[13.5px] text-[color:var(--muted-foreground)]">
                  {["Credits never expire", "Realistic & Stylized modes", "OBS Browser Source URL", "Pause anytime"].map((x) => (
                    <li key={x} className="flex gap-2"><Check size={15} className="mt-0.5 text-primary shrink-0" /> {x}</li>
                  ))}
                </ul>
                <Link to="/signup" className={`mt-6 block w-full text-center ${highlighted ? "btn-primary" : "btn-ghost"}`}>
                  Top up
                </Link>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-[12px] text-[color:var(--faint)]">
          Streaming costs 2 credits/second. Credits never expire.
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-[780px] px-6 py-20">
        <SectionHead eyebrow="FAQ" title="Answers before you ask" />
        <div className="mt-10 divide-y divide-[color:var(--border-soft)] rounded-2xl border bg-card">
          {FAQS.map((f, i) => <FaqRow key={i} q={f.q} a={f.a} />)}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1080px] px-6 pb-24">
        <div className="accent-card rounded-2xl p-10 md:p-14 text-center" style={{ boxShadow: "0 30px 80px -40px var(--accent-glow)" }}>
          <Sparkles size={22} className="mx-auto text-primary" />
          <h2 className="mt-4 font-display text-4xl md:text-5xl">
            Your next stream, in a <em className="not-italic italic text-primary">new light</em>
          </h2>
          <p className="mt-3 text-[15px] text-[color:var(--muted-foreground)]">
            Sign up, top up a starter pack, and be live in under five minutes.
          </p>
          <Link to="/signup" className="btn-primary mt-7"><Play size={15} /> Start streaming free</Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t">
        <div className="mx-auto max-w-[1160px] px-6 py-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Logo />
            <p className="text-[12px] text-[color:var(--faint)]">© 2026 Lumify. Lagos, Nigeria.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[color:var(--muted-foreground)]">
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <a href="mailto:support@lumifylive.com" className="hover:text-foreground">Support</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="mt-3 font-display text-4xl md:text-[44px] tracking-tight">{title}</h2>
    </div>
  );
}

function DemoPanel({ variant }: { variant: "camera" | "output" }) {
  const isOutput = variant === "output";
  return (
    <div className="space-y-3">
      <div
        className={`relative rounded-xl border overflow-hidden ${isOutput ? "border-[color:var(--primary)]" : ""}`}
        style={{
          aspectRatio: "16 / 11",
          ...(isOutput
            ? { boxShadow: "0 0 40px -10px var(--accent-glow), inset 0 0 40px -20px var(--accent-glow)" }
            : {}),
        }}
      >
        {/* backdrop */}
        <div
          className="absolute inset-0"
          style={{
            background: isOutput
              ? "radial-gradient(70% 70% at 50% 45%, rgba(198,242,78,0.18), #0b0d0a 82%)"
              : "radial-gradient(70% 70% at 50% 45%, #1c2016 0%, #0b0d0a 85%)",
          }}
        />

        {/* silhouette */}
        <svg viewBox="0 0 160 110" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={`sil-${variant}`} x1="0" x2="0" y1="0" y2="1">
              {isOutput ? (
                <>
                  <stop offset="0%" stopColor="#c6f24e" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#3a5a12" stopOpacity="0.55" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#4a5240" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#1a1e14" stopOpacity="0.9" />
                </>
              )}
            </linearGradient>
          </defs>
          {/* head */}
          <circle cx="80" cy="46" r="20" fill={`url(#sil-${variant})`} stroke={isOutput ? "#c6f24e" : "none"} strokeWidth={isOutput ? 0.6 : 0} />
          {/* shoulders */}
          <path
            d="M40 110 C46 82, 68 70, 80 70 C92 70, 114 82, 120 110 Z"
            fill={`url(#sil-${variant})`}
            stroke={isOutput ? "#c6f24e" : "none"}
            strokeWidth={isOutput ? 0.6 : 0}
          />
          {isOutput && (
            <>
              <circle cx="55" cy="30" r="0.7" fill="#c6f24e" />
              <circle cx="120" cy="38" r="0.9" fill="#c6f24e" />
              <circle cx="112" cy="20" r="0.6" fill="#c6f24e" />
              <circle cx="42" cy="60" r="0.7" fill="#c6f24e" />
              <circle cx="135" cy="72" r="0.8" fill="#c6f24e" />
            </>
          )}
        </svg>

        {/* scanline overlay for camera */}
        {!isOutput && (
          <div
            className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)",
            }}
          />
        )}

        {/* corner label */}
        <div
          className={`absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
            isOutput
              ? "border border-[color:var(--primary)] bg-[color:var(--accent-soft)] text-primary"
              : "border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 text-[color:var(--muted-foreground)]"
          }`}
        >
          {isOutput ? "Lumify output" : "Your camera"}
        </div>

        {/* HUD chips */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {isOutput ? (
            <>
              <span className="rounded-md border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-widest text-primary">
                Lucy 2.5
              </span>
              <span className="rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-[color:var(--muted-foreground)]">
                &lt; 120 ms
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-widest text-[#ff7a6b]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ff7a6b] animate-pulse" /> Rec
              </span>
              <span className="rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-[color:var(--muted-foreground)]">
                720p
              </span>
            </>
          )}
        </div>
      </div>
      <p className="text-center text-[11.5px] text-[color:var(--faint)]">
        {isOutput ? "AI-enhanced, in real time" : "Plain webcam feed"}
      </p>
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="w-full text-left px-6 py-5"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-[15px] text-foreground">{q}</span>
        {open ? <Minus size={16} className="text-primary shrink-0" /> : <Plus size={16} className="text-[color:var(--muted-foreground)] shrink-0" />}
      </div>
      {open && <p className="mt-3 text-[14px] text-[color:var(--muted-foreground)]">{a}</p>}
    </button>
  );
}
