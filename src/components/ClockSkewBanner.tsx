import { useSyncExternalStore } from "react";
import { getAuthGuardBanner, subscribeAuthGuard } from "@/lib/auth-guard";

const MESSAGES = {
  clock_skew:
    "Your computer's clock looks wrong, which breaks secure sign-in. Turn on 'Set time automatically' in your date & time settings, then reload.",
  refresh_loop:
    "We paused sign-in refreshing because something went wrong with your session. Check that your computer's date & time are set automatically, then reload.",
} as const;

export function ClockSkewBanner() {
  const banner = useSyncExternalStore(subscribeAuthGuard, getAuthGuardBanner, () => null);
  if (!banner) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 border-b border-destructive/40 bg-destructive px-4 py-3 text-center text-sm text-destructive-foreground"
    >
      <span>{MESSAGES[banner.kind]}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md border border-destructive-foreground/40 px-3 py-1 font-medium"
      >
        Reload
      </button>
    </div>
  );
}
