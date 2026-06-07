import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
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
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav />
        <AnnouncementBanner />
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
