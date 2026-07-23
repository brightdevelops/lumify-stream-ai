import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";

const TURNSTILE_SITE_KEY = "0x4AAAAAAD77-FQ0SwtMxBSL";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!captchaToken) {
      setError("Please complete the human verification.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken,
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10"><Logo /></div>
        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-3xl">Forgot password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email and we'll send you a reset link.
          </p>

          {sent ? (
            <div className="mt-8 space-y-4">
              <p className="text-sm text-foreground">
                Check your inbox at <span className="text-primary">{email}</span> for the reset link.
              </p>
              <Link to="/login" className="block text-center text-sm text-primary hover:underline">
                Back to log in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input"
                  placeholder="you@studio.com"
                />
              </label>
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
              <button
                type="submit"
                disabled={loading || !captchaToken}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                Remembered it? <Link to="/login" className="text-primary hover:underline">Log in</Link>
              </p>
            </form>
          )}
        </div>
        <style>{`.input { width:100%; background:transparent; border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; font-size:14px; color:var(--color-foreground); outline:none; } .input:focus { border-color: var(--color-primary); }`}</style>
      </div>
    </div>
  );
}
