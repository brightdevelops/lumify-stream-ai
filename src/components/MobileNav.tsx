import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Video, Wallet, Receipt, Settings, LogOut, Shield, Menu, LifeBuoy } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/stream", label: "Start Stream", icon: Video },
  { to: "/credits", label: "Wallet", icon: Wallet },
  { to: "/billing", label: "Billing", icon: Receipt },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/support", label: "Support", icon: LifeBuoy },
] as const;

export function MobileNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    let cancelled = false;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsAdmin(!!data); });
    return () => { cancelled = true; };
  }, [user]);

  const navItems = isAdmin
    ? [...items, { to: "/admin" as const, label: "Admin", icon: Shield }]
    : items;

  return (
    <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 h-14 px-4 border-b bg-[color:var(--sidebar)]">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button aria-label="Open menu" className="p-2 -ml-2 rounded-md text-foreground hover:bg-card">
            <Menu size={20} />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0 bg-[color:var(--sidebar)] border-border flex flex-col">
          <div className="px-6 py-6"><Logo /></div>
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navItems.map((it) => {
              const active = path === it.to || path.startsWith(it.to + "/");
              const Icon = it.icon;
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition-colors ${
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
          <div className="p-3 border-t">
            <button
              onClick={async () => { setOpen(false); await signOut(); navigate({ to: "/" }); }}
              className="w-full flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm text-[color:var(--muted-foreground)] hover:text-foreground hover:bg-card"
            >
              <LogOut size={17} /> Log out
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <Logo />
    </header>
  );
}
