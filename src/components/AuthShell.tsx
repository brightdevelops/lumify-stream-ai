import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { parseStoredSupabaseSession } from "@/lib/supabase-session-storage";

const TURNSTILE_SITE_KEY = "0x4AAAAAAD77-FQ0SwtMxBSL";

async function flushExpiredStoredSession() {
  if (typeof window === "undefined") return;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
    const stored = parseStoredSupabaseSession(window.localStorage.getItem(key));
    const exp = (stored as any)?.expires_at as number | undefined;
    if (stored && typeof exp === "number" && exp * 1000 < Date.now()) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // ignore — best-effort flush
      }
      return;
    }
  }
}

export function AuthShell({
  mode,
  title,
  subtitle,
}: {
  mode: "login" | "signup";
  title: string;
  subtitle: string;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const captchaRequired =
    typeof window !== "undefined" &&
    (window.location.hostname === "lumifylive.com" ||
      window.location.hostname === "www.lumifylive.com");

  const resetCaptcha = () => {
    setCaptchaToken(null);
    turnstileRef.current?.reset();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && !acceptedTerms) {
      setError("You must accept the Terms of Service to create an account.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (captchaRequired && !captchaToken) {
      setError("Please complete the human verification.");
      return;
    }
    setLoading(true);
    try {
      await flushExpiredStoredSession();
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: name },
            ...(captchaToken ? { captchaToken } : {}),
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: captchaToken ? { captchaToken } : {},
        } as any);
        if (error) throw error;
        (supabase.rpc as any)("record_login").then(() => {}, () => {});
      }
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10"><Logo /></div>
        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <Field label="Full name">
                <input value={name} onChange={(e) => setName(e.target.value)} required className="input" placeholder="Ada Lovelace" />
              </Field>
            )}
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input" placeholder="you@studio.com" />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "signup" ? 8 : 6}
                  className="input pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "signup" && (
                <span className="mt-1 block text-xs text-muted-foreground">At least 8 characters</span>
              )}
            </Field>
            {mode === "login" && (
              <div className="text-right">
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
            )}
            {mode === "signup" && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  I agree to the{" "}
                  <Link to="/terms" target="_blank" className="text-primary hover:underline">
                    Terms of Service
                  </Link>
                  .
                </span>
              </label>
            )}
            <div className="flex justify-center">
              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                options={{ theme: "dark" }}
                onSuccess={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
                onError={() => setCaptchaToken(null)}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading || !captchaToken} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>

          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>New here? <Link to="/signup" className="text-primary hover:underline">Create an account</Link></>
            ) : (
              <>Already have an account? <Link to="/login" className="text-primary hover:underline">Log in</Link></>
            )}
          </p>
        </div>
        <style>{`.input { width:100%; background:transparent; border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; font-size:14px; color:var(--color-foreground); outline:none; } .input:focus { border-color: var(--color-primary); } input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear, input[type="password"]::-webkit-contacts-auto-fill-button, input[type="password"]::-webkit-credentials-auto-fill-button { display: none !important; visibility: hidden; pointer-events: none; }`}</style>
      </div>
    </div>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
  );
}
