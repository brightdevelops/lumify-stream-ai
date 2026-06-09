import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";

// ── Edit / remove this banner here ──────────────────────────────────────────
// To take the banner down: set ANNOUNCEMENT to null.
// To change the message: update `message` AND bump `id` (so previously
// dismissed users see the new one).
// To change where it shows: edit `showOnPaths`.
const ANNOUNCEMENT: {
  id: string;
  message: string;
  showOnPaths: string[];
} | null = {
  id: "maintenance-2026-06-09",
  message:
    "⚡ Lumify is leveling up.\n\nWe're rolling out backend upgrades to make your streams faster, smoother, and more reliable. During this short maintenance window, new credit purchases and live streaming are temporarily paused.\n\nYour credits are 100% safe. Every credit in your wallet is stored securely and will be exactly where you left it when we're back — nothing expires, nothing is lost.\n\nWe're a team that ships. Lumify isn't going anywhere — we're building this for the long run, and these upgrades are part of making it bulletproof. Thanks for streaming with us. We'll be back shortly. 🚀\n\n— The Lumify Team",
  showOnPaths: ["/dashboard", "/stream"],
};
// ────────────────────────────────────────────────────────────────────────────

export function AnnouncementBanner() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [dismissed, setDismissed] = useState(true);

  const storageKey = ANNOUNCEMENT ? `lumify-banner-dismissed:${ANNOUNCEMENT.id}` : "";

  useEffect(() => {
    if (!ANNOUNCEMENT) return;
    setDismissed(localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (!ANNOUNCEMENT) return null;
  if (dismissed) return null;
  if (!ANNOUNCEMENT.showOnPaths.some((p) => path === p || path.startsWith(p + "/"))) return null;

  return (
    <div className="border-b border-primary/30 bg-primary/10 text-foreground">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex items-start gap-3">
        <p className="flex-1 text-sm leading-relaxed whitespace-pre-line">{ANNOUNCEMENT.message}</p>
        <button
          onClick={() => {
            localStorage.setItem(storageKey, "1");
            setDismissed(true);
          }}
          aria-label="Dismiss announcement"
          className="shrink-0 -mr-1 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
