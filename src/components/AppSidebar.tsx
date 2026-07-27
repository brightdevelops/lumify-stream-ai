import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Video, Wallet, Receipt, Settings, LogOut, Shield, Wrench, GraduationCap, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/stream", label: "Start Stream", icon: Video },
  { to: "/credits", label: "Wallet", icon: Wallet },
  { to: "/billing", label: "Billing", icon: Receipt },
] as const;

const secondary = [
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/tutorial", label: "Tutorial", icon: GraduationCap },
] as const;

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isInventor, setIsInventor] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

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

  const adminExtras = [
    ...(isAdmin ? [{ to: "/admin" as const, label: "Admin", icon: Shield }] : []),
    ...(isInventor ? [{ to: "/inventor" as const, label: "Inventor", icon: Wrench }] : []),
  ];

  const renderItem = (it: { to: string; label: string; icon: any }) => {
    const active = path === it.to || path.startsWith(it.to + "/");
    const Icon = it.icon;
    return (
      <Link
        key={it.to}
        to={it.to}
        className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[13.5px] transition-colors ${
          active
            ? "bg-primary text-primary-foreground font-semibold"
            : "text-[color:var(--muted-foreground)] hover:text-foreground hover:bg-card"
        }`}
      >
        <Icon size={17} strokeWidth={1.75} />
        {it.label}
      </Link>
    );
  };

  return (
    <aside className="hidden md:flex h-screen sticky top-0 w-[225px] shrink-0 flex-col border-r bg-[color:var(--sidebar)]">
      <div className="px-6 py-6">
        <Logo />
      </div>
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {items.map(renderItem)}
        <div className="my-3 h-px bg-[color:var(--border-soft)] mx-2" />
        {secondary.map(renderItem)}
        {adminExtras.length > 0 && (
          <>
            <div className="my-3 h-px bg-[color:var(--border-soft)] mx-2" />
            {adminExtras.map(renderItem)}
          </>
        )}
      </nav>
      <div className="p-3 space-y-2">
        <div className="rounded-2xl border border-[color:var(--border-soft)] bg-card p-3.5">
          <div className="eyebrow text-[10px]">Balance</div>
          <div className="mt-1 font-display text-xl text-foreground">
            {balance === null ? "—" : balance.toLocaleString()} <span className="text-[11px] text-[color:var(--faint)]">credits</span>
          </div>
          <Link to="/credits" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:opacity-80">
            <Plus size={13} /> Top up
          </Link>
        </div>
        <button
          onClick={async () => { await signOut(); navigate({ to: "/" }); }}
          className="w-full flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[13.5px] text-[color:var(--muted-foreground)] hover:text-foreground hover:bg-card transition-colors"
        >
          <LogOut size={17} strokeWidth={1.75} /> Log out
        </button>
      </div>
    </aside>
  );
}
