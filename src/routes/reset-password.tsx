import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate({ to: "/dashboard" }), 1500);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-10"><Logo /></div>
        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-3xl">Set new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose a strong password you haven't used before.</p>

          {done ? (
            <p className="mt-8 text-sm text-foreground">Password updated. Redirecting…</p>
          ) : !ready ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Open this page from the reset link in your email. If you got here by mistake,{" "}
              <Link to="/forgot-password" className="text-primary hover:underline">request a new link</Link>.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <label className="block">
                <span className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">New password</span>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
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
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        <style>{`.input { width:100%; background:transparent; border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; font-size:14px; color:var(--color-foreground); outline:none; } .input:focus { border-color: var(--color-primary); } input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear, input[type="password"]::-webkit-contacts-auto-fill-button, input[type="password"]::-webkit-credentials-auto-fill-button { display: none !important; visibility: hidden; pointer-events: none; }`}</style>
        <style>{`.input { width:100%; background:transparent; border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; font-size:14px; color:var(--color-foreground); outline:none; } .input:focus { border-color: var(--color-primary); }`}</style>
      </div>
    </div>
  );
}
