import { createFileRoute, Outlet, Link, redirect, useRouterState } from "@tanstack/react-router";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { amIInventor } from "@/lib/inventor.functions";

export const Route = createFileRoute("/inventor")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    try {
      const r = await amIInventor();
      if (!r.isAdmin) throw redirect({ to: "/dashboard" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/dashboard" });
    }
  },
  component: InventorLayout,
});

const TABS = [
  { to: "/inventor", label: "Overview" },
  { to: "/inventor/users", label: "Users" },
  { to: "/inventor/ledger", label: "Ledger" },
  { to: "/inventor/monitor", label: "Monitor" },
  { to: "/inventor/recordings", label: "Recordings" },
  { to: "/inventor/finance", label: "Finance" },
  { to: "/inventor/reconcile", label: "Reconcile" },
  { to: "/inventor/support", label: "Support" },
] as const;

function InventorLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-card/40">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">Inventor Console</h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  <ShieldCheck className="h-3 w-3" /> Admin
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Privileged controls — every action is audited.</p>
            </div>
            <Link to="/dashboard" className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40">
              <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
            </Link>
          </div>
          <nav className="mt-4 flex flex-wrap gap-1">
            {TABS.map((t) => {
              const active = pathname === t.to || (t.to !== "/inventor" && pathname.startsWith(t.to));
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={
                    "rounded-md px-3 py-1.5 text-sm transition " +
                    (active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground")
                  }
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
