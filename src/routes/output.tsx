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

    const attachStream = (stream: MediaStream) => {
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      setStatus("live");
      tryPlay();
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

    let iceServers: RTCIceServer[] | undefined;

    const connect = () => {
      try {
        stopViewerRef.current?.();
      } catch (e) {
        console.debug("viewer teardown", e);
      }
      stopViewerRef.current = startViewer(
        token,
        (stream) => {
          if (!cancelled) attachStream(stream);
        },
        {
          iceServers,
          onIceFailed: () => {
            if (cancelled) return;
            console.warn("output: ICE connection failed — retrying");
            setStatus("reconnecting");
            scheduleRetry();
          },
        },
      );
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
          {status === "reconnecting" ? "Reconnecting…" : "Waiting for broadcaster…"}
        </div>
      )}
    </div>
  );
}
