import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { SupportWidget } from "@/components/SupportWidget";
import SideRays from "@/components/SideRays";
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

  // Heartbeat last_seen every 60s while signed in and tab is visible
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
      <div className="pointer-events-none fixed inset-0 z-0">
        <SideRays
          speed={2.5}
          rayColor1="#A8E063"
          rayColor2="#96c8ff"
          intensity={1.4}
          spread={2}
          origin="top-right"
          tilt={0}
          saturation={1.3}
          blend={0.65}
          falloff={1.8}
          opacity={0.55}
        />
      </div>
      <div className="relative z-10 flex w-full">
        <AppSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <MobileNav />
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
        <SupportWidget />
      </div>
    </div>
  );
}
