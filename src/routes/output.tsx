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
    ],
  }),
});

type Status = "waiting" | "live" | "reconnecting";

function OutputPage() {
  const { token } = Route.useSearch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopViewerRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingRef = useRef(false);

  const [status, setStatus] = useState<Status>("waiting");

  // Autoplay muted — OBS browser sources cannot click.
  const tryPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch((e) => console.debug("autoplay blocked", e));
  }, []);

  useEffect(() => {
    if (!token) {
      console.error("output: missing stream token");
      return;
    }
    let cancelled = false;

    const clearTimers = () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      if (disconnectedRef.current) {
        clearTimeout(disconnectedRef.current);
        disconnectedRef.current = null;
      }
    };

    // Connection is healthy — no retry may remain armed.
    const markHealthy = () => {
      if (cancelled) return;
      clearTimers();
      reconnectingRef.current = false;
      setStatus("live");
    };

    const attachStream = (stream: MediaStream) => {
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      markHealthy();
      tryPlay();
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onunmute = () => {
          if (!cancelled) markHealthy();
        };
        track.onmute = () => {
          if (!cancelled) scheduleRetry();
        };
        track.onended = () => {
          if (!cancelled) scheduleRetry();
        };
      }
    };

    let iceServers: RTCIceServer[] | undefined;

    const connect = () => {
      try {
        stopViewerRef.current?.();
      } catch (e) {
        console.debug("viewer teardown", e);
      }
      stopViewerRef.current = null;

      stopViewerRef.current = startViewer(
        token,
        (stream) => {
          if (!cancelled) attachStream(stream);
        },
        {
          iceServers,
          onConnectionState: (state) => {
            if (cancelled) return;
            console.debug("output: connection state", state);
            if (state === "connected" || state === "completed") {
              markHealthy();
              return;
            }
            if (state === "disconnected") {
              // Transient blips recover on their own — wait 5s.
              if (disconnectedRef.current) return;
              disconnectedRef.current = setTimeout(() => {
                disconnectedRef.current = null;
                if (!cancelled) scheduleRetry();
              }, 5000);
            }
          },
          onIceFailed: () => {
            if (cancelled) return;
            console.warn("output: connection failed — retrying");
            scheduleRetry();
          },
        },
      );
    };

    // Arms a single reconnect attempt; never a periodic interval.
    const scheduleRetry = () => {
      if (cancelled || reconnectingRef.current) return;
      reconnectingRef.current = true;
      clearTimers();
      setStatus("reconnecting");
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (cancelled) return;
        connect();
        // Allow another attempt only if this one does not become healthy.
        retryRef.current = setTimeout(() => {
          retryRef.current = null;
          reconnectingRef.current = false;
          if (!cancelled && videoRef.current?.srcObject == null) scheduleRetry();
        }, 8000);
      }, 3000);
    };

    (async () => {
      try {
        const res = await fetch(
          `/api/public/resolve-stream-token?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) throw new Error("Invalid stream token");
        const body = (await res.json()) as { iceServers?: RTCIceServer[] };
        if (body.iceServers?.length) iceServers = body.iceServers;
        if (cancelled) return;
        connect();
      } catch (e) {
        console.error("output: token resolution failed", e);
      }
    })();

    return () => {
      cancelled = true;
      clearTimers();
      reconnectingRef.current = false;
      try {
        stopViewerRef.current?.();
      } catch (e) {
        console.debug("viewer teardown", e);
      }
      stopViewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const live = status === "live";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#000",
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
          objectFit: "contain",
          background: "#000",
          display: live ? "block" : "none",
        }}
      />

      {!live && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "#0b0d0a",
            fontSize: 14,
            color: "#6b7160",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {status === "reconnecting" ? "Reconnecting…" : "Waiting for stream…"}
        </div>
      )}
    </div>
  );
}
