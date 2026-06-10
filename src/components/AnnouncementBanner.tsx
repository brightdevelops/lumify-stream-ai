import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";

// ── Edit / remove this banner here ──────────────────────────────────────────
// To take the banner down: set ANNOUNCEMENT to null.
// To change the message: update `message` AND bump `id` (so previously
// dismissed users see the new one).
const ANNOUNCEMENT: {
  id: string;
  message: string;
  showOnPaths: string[];
} | null = {
  id: "back-online-2026-06-10",
  message:
    "We're back online! Streaming is fully restored — thank you for your patience. 💚 — The Lumify Team",
  showOnPaths: ["/dashboard", "/stream", "/credits"],
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
