import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { startViewer } from "@/lib/stream-broadcast";

export const Route = createFileRoute("/output")({
  component: OutputPage,
  head: () => ({
    meta: [
      { title: "Lumify Stream Output" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function OutputPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    const stop = startViewer((stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
        setHasStream(true);
      }
    });
    return stop;
  }, []);

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
            color: "#555",
            fontFamily: "system-ui, sans-serif",
            fontSize: 14,
          }}
        >
          Waiting for stream…
        </div>
      )}
    </div>
  );
}
