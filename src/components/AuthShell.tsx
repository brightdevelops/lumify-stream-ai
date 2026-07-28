import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
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

  // Preserve a same-origin relative `next` (e.g. OAuth consent URL) through
  // every sign-in path so the user returns to the original destination.
  const nextParam = (() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("next");
    if (!raw) return null;
    // Only allow same-origin relative paths.
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    return raw;
  })();
  const postAuthRedirect = () => {
    if (nextParam) {
      window.location.href = nextParam;
    } else {
      navigate({ to: "/dashboard" });
    }
  };

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
            emailRedirectTo: `${window.location.origin}${nextParam ?? "/dashboard"}`,
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
      postAuthRedirect();
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
            {captchaRequired && (
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
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading || (captchaRequired && !captchaToken)} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>

          </form>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              setLoading(true);
              try {
                const result = await lovable.auth.signInWithOAuth("google", {
                  redirect_uri: window.location.origin,
                });
                if (result.error) throw result.error;
                if (result.redirected) return;
                navigate({ to: "/dashboard" });
              } catch (err: any) {
                setError(err?.message ?? "Google sign-in failed");
                setLoading(false);
              }
            }}
            disabled={loading}
            className="mt-4 w-full rounded-md border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 16.1 4 9.3 8.5 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.6 0 10.7-2.1 14.5-5.6l-6.7-5.5c-2.1 1.5-4.8 2.4-7.8 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.6 5.1C9.2 39.5 16 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.7 5.5C41.4 36.5 44 30.7 44 24c0-1.2-.1-2.3-.4-3.5z"/>
            </svg>
            Continue with Google
          </button>

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
