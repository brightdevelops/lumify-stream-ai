import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { startViewer } from "@/lib/stream-broadcast";
import { resolveStreamToken } from "@/lib/stream-token.functions";

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

function OutputPage() {
  const { token } = Route.useSearch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Missing stream token");
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { userId } = await resolveStreamToken({ data: { token } });
        if (cancelled) return;
        stop = startViewer(userId, (stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
            setHasStream(true);
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid stream token");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [token]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        margin: 0,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000",
        }}
      />
      {!hasStream && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: error ? "#b00" : "#555",
            fontFamily: "system-ui, sans-serif",
            fontSize: 14,
          }}
        >
          {error ?? "Waiting for stream…"}
        </div>
      )}
    </div>
  );
}
