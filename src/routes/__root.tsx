import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStoredSupabaseAccessToken } from "@/lib/supabase-session-storage";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AnnouncementPopup } from "@/components/AnnouncementPopup";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl text-foreground">404</h1>
        <p className="mt-3 text-muted-foreground">This page drifted into the void.</p>
        <Link to="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Back home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl text-foreground">Something broke.</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again or head back.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-border px-4 py-2 text-sm">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      
      { title: "Lumify — Real-time AI video transformation" },
      { name: "description", content: "Lumify transforms your live stream with intelligent light. Real-time AI video, pay as you stream." },
      { property: "og:title", content: "Lumify — Real-time AI video transformation" },
      { property: "og:description", content: "Lumify transforms your live stream with intelligent light. Real-time AI video, pay as you stream." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Lumify — Real-time AI video transformation" },
      { name: "twitter:description", content: "Lumify transforms your live stream with intelligent light. Real-time AI video, pay as you stream." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/a1e23754-9480-4238-bc33-7c0b93e18543" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/a1e23754-9480-4238-bc33-7c0b93e18543" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <VisitTracker />
      <AnnouncementBanner />
      <AnnouncementPopup />
      <Outlet />
    </QueryClientProvider>
  );
}

function VisitTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    (async () => {
      try {
        const token = getStoredSupabaseAccessToken();
        await fetch("/api/public/track-visit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            path: pathname,
            referrer: document.referrer || null,
          }),
          keepalive: true,
        });
      } catch {
        // ignore
      }
    })();
  }, [pathname]);

  // site_visits heartbeat: powers Inventor "Active now"
  // Throttled to 5min and only when the tab is visible to keep the table small.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let sid = window.localStorage.getItem("lumify_site_session");
    if (!sid) {
      sid = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      window.localStorage.setItem("lumify_site_session", sid);
    }
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { data } = await supabase.auth.getUser();
        await supabase.from("site_visits").insert({ session_id: sid, user_id: data.user?.id ?? null });
      } catch {
        // ignore
      }
    };
    beat();
    const id = setInterval(beat, 5 * 60_000);
    return () => clearInterval(id);
  }, []);


  return null;
}
