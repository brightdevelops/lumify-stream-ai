import { useEffect } from "react";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Periodically reloads the page so users never sit on a stale view.
 * Skips the reload while a stream is live, while the tab is hidden,
 * or while the user is typing / has unsaved focus in an input.
 */
export function AutoRefresh() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const shouldSkip = () => {
      if (document.visibilityState !== "visible") return true;
      if (document.body.classList.contains("stream-live")) return true;
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
      }
      return false;
    };

    const id = window.setInterval(() => {
      if (shouldSkip()) return;
      window.location.reload();
    }, INTERVAL_MS);

    return () => window.clearInterval(id);
  }, []);

  return null;
}
