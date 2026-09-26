import { useEffect } from "react";
import { APP_VERSION } from "@/lib/app-version";

const CHECK_MS = 60 * 1000;

/**
 * Checks the server's app version; when it differs from the version this
 * page was loaded with, hard-reloads. Waits while a stream is live or the
 * user is typing, and retries on the next check.
 */
export function AutoRefresh() {
  useEffect(() => {
    let pending = false;

    const busy = () => {
      if (document.body.classList.contains("stream-live")) return true;
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
      }
      return false;
    };

    const check = async () => {
      try {
        if (!pending) {
          const res = await fetch(`/api/public/app-version?t=${Date.now()}`, { cache: "no-store" });
          if (!res.ok) return;
          const { version } = (await res.json()) as { version?: string };
          if (version && version !== APP_VERSION) pending = true;
        }
        if (pending && !busy()) window.location.reload();
      } catch {
        // ignore
      }
    };

    check();
    const id = window.setInterval(check, CHECK_MS);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}
