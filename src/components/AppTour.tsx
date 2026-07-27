import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "@/hooks/use-auth";

const TOUR_KEY = "lumify_tour_v1_completed";

export function startTour() {
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

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    let done = "1";
    try { done = localStorage.getItem(TOUR_KEY) ?? ""; } catch { /* noop */ }
    if (done === "1") return;
    // Wait for sidebar/support widget to mount
    const t = window.setTimeout(() => {
      if (document.querySelector('[data-tour="dashboard"]')) startTour();
    }, 800);
    return () => window.clearTimeout(t);
  }, [user, loading]);

  return null;
}
