import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { SupportWidget } from "@/components/SupportWidget";
import { AppTour } from "@/components/AppTour";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AppBackground } from "@/components/app/AppBackground";
import { supabase } from "@/integrations/supabase/client";

import { AuthProvider, useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_app")({
  component: () => (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  ),
});

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      window.setTimeout(() => navigate({ to: "/login" }), 0);
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void supabase.rpc("record_login");
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [user]);

  if (loading || !user) {
    return <div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex w-full bg-background relative">
      <AppBackground />
      <AppSidebar />
      <div className="flex-1 min-w-0 flex flex-col relative z-10">
        <MobileNav />
        <main className="flex-1 min-w-0">
          <PageShell />
        </main>
      </div>
      <SupportWidget />
      <AppTour />
      <AutoRefresh />

    </div>
  );
}

function PageShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={pathname} className="mx-auto w-full max-w-[1220px] px-5 md:px-[34px] py-8 md:py-10 app-page-enter">
      <Outlet />
    </div>
  );
}
