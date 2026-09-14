import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { startViewer } from "@/lib/stream-broadcast";

export const Route = createFileRoute("/output")({
  validateSearch: (search) =>
    z.object({ token: z.string().optional() }).parse(search),
  component: OutputPage,
  head: () => ({
    meta: [
      { title: "Lumify Stream Output" },
      { name: "robots", content: "noindex" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
    ],
  }),
});

type Status = "waiting" | "live" | "reconnecting";

function OutputPage() {
  const { token } = Route.useSearch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stopViewerRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<Status>("waiting");
  const [playing, setPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [controlsVisible, setControlsVisible] = useState(true);

  // Ensure viewport-fit=cover even if the root meta wins the merge.
  useEffect(() => {
    const tag = document.querySelector('meta[name="viewport"]');
    const prev = tag?.getAttribute("content") ?? null;
    tag?.setAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    return () => {
      if (tag && prev) tag.setAttribute("content", prev);
    };
  }, []);

  // ── Wake lock ────────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as any;
      if (!nav.wakeLock?.request) return;
      if (wakeLockRef.current) return;
      wakeLockRef.current = await nav.wakeLock.request("screen");
      wakeLockRef.current.addEventListener?.("release", () => {
        wakeLockRef.current = null;
      });
    } catch (e) {
      console.debug("wake lock unavailable", e);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    try {
      wakeLockRef.current?.release?.();
    } catch (e) {
      console.debug("wake lock release failed", e);
    }
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && playing) void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [playing, acquireWakeLock]);

  useEffect(() => releaseWakeLock, [releaseWakeLock]);

  // ── Auto-hiding controls ─────────────────────────────────────────────────
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (playing) pokeControls();
    else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, pokeControls]);

  // ── Play helpers ─────────────────────────────────────────────────────────
  const tryPlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return false;
    try {
      v.muted = true;
      await v.play();
      setNeedsTap(false);
      setPlaying(true);
      void acquireWakeLock();
      return true;
    } catch (e) {
      console.debug("autoplay blocked", e);
      setNeedsTap(true);
      return false;
    }
  }, [acquireWakeLock]);

  const handleTap = useCallback(async () => {
    const ok = await tryPlay();
    if (ok) {
      try {
        await containerRef.current?.requestFullscreen?.();
      } catch (e) {
        console.debug("fullscreen unavailable", e);
      }
    }
  }, [tryPlay]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen?.();
    } catch (e) {
      console.debug("fullscreen toggle failed", e);
    }
  }, []);

  // ── Viewer connection (+ auto retry) ─────────────────────────────────────
  useEffect(() => {
    if (!token) {
      console.error("output: missing stream token");
      return;
    }
    let cancelled = false;

    const attachStream = (stream: MediaStream) => {
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      setStatus("live");
      void tryPlay();
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onmute = () => {
          if (!cancelled) {
            setStatus("reconnecting");
            scheduleRetry();
          }
        };
        track.onunmute = () => {
          if (!cancelled) setStatus("live");
        };
        track.onended = () => {
          if (!cancelled) {
            setStatus("reconnecting");
            scheduleRetry();
          }
        };
      }
    };

    const connect = () => {
      try {
        stopViewerRef.current?.();
      } catch (e) {
        console.debug("viewer teardown", e);
      }
      stopViewerRef.current = startViewer(token, (stream) => {
        if (!cancelled) attachStream(stream);
      });
    };

    const scheduleRetry = () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => {
        if (cancelled) return;
        connect();
        scheduleRetry();
      }, 3000);
    };

    (async () => {
      try {
        const res = await fetch(
          `/api/public/resolve-stream-token?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) throw new Error("Invalid stream token");
        if (cancelled) return;
        connect();
      } catch (e) {
        console.error("output: token resolution failed", e);
      }
    })();

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      try {
        stopViewerRef.current?.();
      } catch (e) {
        console.debug("viewer teardown", e);
      }
      stopViewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const statusLabel = status === "live" ? "LIVE" : "WAITING FOR BROADCASTER";

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (playing) pokeControls();
      }}
      onTouchStart={() => {
        if (playing) pokeControls();
      }}
      onMouseMove={() => {
        if (playing) pokeControls();
      }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100dvw",
        height: "100dvh",
        background: playing ? "#000" : "#0b0d0a",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        {...({ "webkit-playsinline": "true" } as Record<string, string>)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          background: "#000",
          display: playing ? "block" : "none",
        }}
      />

      {/* Tap-to-start / waiting state */}
      {!playing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            gap: 14,
            background: "#0b0d0a",
          }}
        >
          <div style={{ display: "grid", justifyItems: "center", gap: 14 }}>
            {needsTap || status === "live" ? (
              <>
                <button
                  type="button"
                  onClick={handleTap}
                  aria-label="Tap to watch"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 999,
                    background: "rgba(198,242,78,.12)",
                    border: "1px solid rgba(198,242,78,.35)",
                    color: "#c6f24e",
                    fontSize: 24,
                    display: "grid",
                    placeItems: "center",
                    transition: "all 150ms ease",
                  }}
                >
                  ▶
                </button>
                <span style={{ fontSize: 14, color: "#9aa08c", fontFamily: "system-ui, sans-serif" }}>
                  Tap to watch
                </span>
              </>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: "#6b7160",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                <span className="status-dot" style={{ opacity: 0.6 }} />
                {status === "reconnecting" ? "Reconnecting…" : "Waiting for broadcaster…"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Auto-hiding control bar */}
      {playing && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px calc(14px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left))",
            background: "rgba(0,0,0,.55)",
            backdropFilter: "blur(8px)",
            opacity: controlsVisible ? 1 : 0,
            pointerEvents: controlsVisible ? "auto" : "none",
            transition: "opacity 150ms ease",
            fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: "0.12em", color: "#9aa08c" }}>
            <span className={`status-dot ${status === "live" ? "live" : ""}`} />
            {status === "reconnecting" ? "RECONNECTING" : statusLabel}
          </span>

          <div
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              border: "1px solid rgba(255,255,255,.14)",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            {(["contain", "cover"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFit(f);
                  pokeControls();
                }}
                style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  padding: "8px 12px",
                  minHeight: 36,
                  background: fit === f ? "#c6f24e" : "transparent",
                  color: fit === f ? "#111406" : "#9aa08c",
                  fontWeight: fit === f ? 700 : 500,
                  transition: "all 150ms ease",
                }}
              >
                {f === "contain" ? "CONTAIN" : "FILL"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void toggleFullscreen();
              pokeControls();
            }}
            aria-label="Toggle fullscreen"
            style={{
              fontSize: 14,
              minWidth: 40,
              minHeight: 36,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.14)",
              color: "#9aa08c",
              background: "transparent",
              transition: "all 150ms ease",
            }}
          >
            ⛶
          </button>
        </div>
      )}
    </div>
  );
}
