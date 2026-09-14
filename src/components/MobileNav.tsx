import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Video, Wallet, Receipt, Settings, LogOut, Shield, Wrench, Menu, GraduationCap, Mic, X, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/stream", label: "Start Stream", icon: Video },
  { to: "/credits", label: "Wallet", icon: Wallet },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/voice", label: "Voice Studio", icon: Mic },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/tutorial", label: "Tutorial", icon: GraduationCap },
] as const;

export function MobileNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isInventor, setIsInventor] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) { setIsAdmin(false); setIsInventor(false); setBalance(null); return; }
    let cancelled = false;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsAdmin(!!data); });
    supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsInventor(!!data?.is_admin); });
    supabase.from("credits").select("balance").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setBalance(data?.balance ?? 0); });
    return () => { cancelled = true; };
  }, [user, path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const navItems = [
    ...items,
    ...(isAdmin ? [{ to: "/admin" as const, label: "Admin", icon: Shield }] : []),
    ...(isInventor ? [{ to: "/inventor" as const, label: "Inventor", icon: Wrench }] : []),
  ];

  return (
    <>
      <header className="lumi-topbar">
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="lumi-tap grid place-items-center rounded-lg text-foreground hover:bg-card"
        >
          <Menu size={20} />
        </button>
        <div className="flex-1 grid place-items-center min-w-0">
          <Logo />
        </div>
        <Link
          to="/credits"
          className="shrink-0 rounded-full border border-[color:var(--border)] px-3 py-1.5 text-[12px] font-semibold text-primary"
        >
          {balance === null ? "—" : `${balance.toLocaleString()} cr`}
        </Link>
      </header>

      {open && (
        <div className="lumi-drawer-overlay" onClick={() => setOpen(false)} aria-hidden />
      )}
      <aside className="lumi-drawer" data-open={open} aria-hidden={!open}>
        <div className="flex items-center justify-between px-5 py-5">
          <Logo />
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="lumi-tap grid place-items-center rounded-lg text-[color:var(--muted-foreground)] hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((it) => {
            const active = path === it.to || path.startsWith(it.to + "/");
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                onClick={() => setOpen(false)}
                className={`flex h-12 items-center gap-3 rounded-full px-3.5 text-[14px] transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-[color:var(--muted-foreground)] hover:text-foreground hover:bg-card"
                }`}
              >
                <Icon size={17} strokeWidth={1.75} /> {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 space-y-2">
          <div className="rounded-2xl border border-[color:var(--border-soft)] bg-card p-3.5">
            <div className="eyebrow text-[10px]">Balance</div>
            <div className="mt-1 font-display text-xl text-foreground">
              {balance === null ? "—" : balance.toLocaleString()} <span className="text-[11px] text-[color:var(--faint)]">credits</span>
            </div>
            <Link to="/credits" onClick={() => setOpen(false)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
              <Plus size={13} /> Top up
            </Link>
          </div>
          <button
            onClick={async () => { setOpen(false); await signOut(); navigate({ to: "/" }); }}
            className="w-full flex h-12 items-center gap-3 rounded-full px-3.5 text-[14px] text-[color:var(--muted-foreground)] hover:text-foreground hover:bg-card"
          >
            <LogOut size={17} /> Log out
          </button>
        </div>
      </aside>
    </>
  );
}
