import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "@/hooks/use-auth";
import { useRouterState } from "@tanstack/react-router";

const TOUR_KEY = "lumify_tour_v3_dashboard_stream_completed";
const AUTO_TOUR_PATHS = new Set(["/stream", "/dashboard"]);
const TOUR_TARGET_BY_PATH: Record<string, string> = {
  "/stream": '[data-tour="stream"]',
  "/dashboard": '[data-tour="dashboard"]',
};

let tourRunning = false;

export function startTour() {
  if (tourRunning || document.querySelector(".driver-popover")) return;
  tourRunning = true;
  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.7,
    popoverClass: "lumify-tour-popover",
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Got it",
    steps: [
      {
        popover: {
          title: "Welcome to Lumify 👋",
          description:
            "Lumify turns your camera into an AI persona you can stream anywhere. Let's take a quick 45-second tour.",
        },
      },
      {
        element: '[data-tour="dashboard"]',
        popover: {
          title: "Your dashboard",
          description: "See your recent sessions, credit usage and quick stats.",
        },
      },
      {
        element: '[data-tour="stream"]',
        popover: {
          title: "Start a stream",
          description:
            "This is where you go live. Pick a persona, tune the realism, and copy the OBS browser source URL.",
        },
      },
      {
        element: '[data-tour="credits"]',
        popover: {
          title: "Wallet",
          description: "Top up credits here. Credits are what keep your stream running.",
        },
      },
      {
        element: '[data-tour="billing"]',
        popover: {
          title: "Billing",
          description: "Every purchase and refund shows up here for your records.",
        },
      },
      {
        element: '[data-tour="tutorial"]',
        popover: {
          title: "Tutorials",
          description: "Watch short videos on setup, OBS, and getting the best look on camera.",
        },
      },
      {
        element: '[data-tour="balance"]',
        popover: {
          title: "Your balance",
          description: "Your current credit balance lives here — hit Top up any time to add more.",
        },
      },
      {
        element: '[data-tour="support"]',
        popover: {
          title: "Need help?",
          description: "Tap the chat bubble to reach us any time. We reply fast.",
          side: "left",
        },
      },
      {
        popover: {
          title: "You're set 🎉",
          description:
            "Head to Start Stream when you're ready. You can replay this tour any time from Settings.",
        },
      },
    ],
    onDestroyed: () => {
      tourRunning = false;
      try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* noop */ }
    },
  });
  d.drive();
}

export function resetTour() {
  try { localStorage.removeItem(TOUR_KEY); } catch { /* noop */ }
}

export function AppTour() {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (!AUTO_TOUR_PATHS.has(pathname)) return;
    let done = "1";
    try { done = localStorage.getItem(TOUR_KEY) ?? ""; } catch { /* noop */ }
    if (done === "1") return;
    let attempts = 0;
    const target = TOUR_TARGET_BY_PATH[pathname];
    const t = window.setInterval(() => {
      attempts += 1;
      if (target && document.querySelector(target)) {
        window.clearInterval(t);
        startTour();
      }
      if (attempts >= 20) window.clearInterval(t);
    }, 250);
    return () => window.clearInterval(t);
  }, [user, loading, pathname]);

  return null;
}
