import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import cameraVideo from "@/assets/site-camera-loop.mp4.asset.json";
import charactersVideo from "@/assets/site-characters-loop.mp4.asset.json";
import cameraPoster from "@/assets/site-camera-poster.jpg.asset.json";
import charactersPoster from "@/assets/site-characters-poster.jpg.asset.json";

export function HeroDemo() {
  const leftRef = useRef<HTMLVideoElement | null>(null);
  const rightRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      left.pause();
      right.pause();
      return;
    }

    // Right is master clock; left cycles once per right-loop segment.
    const LEFT_DURATION = 8.48; // seconds, matches one loop of the camera clip
    const interval = window.setInterval(() => {
      if (!left.duration || !right.duration) return;
      const target = right.currentTime % LEFT_DURATION;
      if (Math.abs(left.currentTime - target) > 0.15) {
        try { left.currentTime = target; } catch { /* noop */ }
      }
    }, 2000);

    const kick = () => { left.play().catch(() => {}); right.play().catch(() => {}); };
    kick();

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4">
      <div className="rounded-[20px] border bg-card overflow-hidden shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 border-b px-4 py-2.5 bg-[color:var(--sidebar)]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f2b]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f2b]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#3a3f2b]" />
          <span className="ml-3 text-[11px] text-[color:var(--faint)]">lumify.live/studio</span>
        </div>

        {/* Two-panel grid */}
        <div className="relative grid grid-cols-1 min-[720px]:grid-cols-2">
          {/* Left panel */}
          <div className="relative min-[720px]:border-r border-b min-[720px]:border-b-0" style={{ aspectRatio: "16 / 11" }}>
            <video
              ref={leftRef}
              src={cameraVideo.url}
              poster={cameraPoster.url}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              onContextMenu={(e) => e.preventDefault()}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: "center" }}
            />

            {/* Scanlines */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0 1px, transparent 1px 2px)" }}
              aria-hidden
            />
            <div className="absolute top-3 left-3 z-10"><Chip>YOUR CAMERA</Chip></div>
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
              <Chip><span className="rec-dot" /> REC</Chip>
              <Chip>720p</Chip>
            </div>
            <div className="absolute inset-x-0 bottom-4 z-10 text-center">
              <span className="text-[13px] text-white" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>
                The real you, live
              </span>
            </div>
          </div>

          {/* Right panel */}
          <div
            className="relative"
            style={{ aspectRatio: "16 / 11", boxShadow: "inset 0 0 0 1.5px rgba(198,242,78,0.35)" }}
          >
            <video
              ref={rightRef}
              src={charactersVideo.url}
              poster={charactersPoster.url}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
              onContextMenu={(e) => e.preventDefault()}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: "center" }}
            />

            <div className="absolute top-3 left-3 z-10"><Chip lime>LUMIFY OUTPUT</Chip></div>
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
              <Chip lime>LUCY 2.5</Chip>
              <Chip>&lt; 120 ms</Chip>
            </div>
            <div className="absolute inset-x-0 bottom-4 z-10 text-center">
              <span className="text-[13px] text-white" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}>
                Your character, live — one of many
              </span>
            </div>
          </div>

          {/* Center arrow badge */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 grid place-items-center rounded-full bg-primary text-[color:var(--primary-foreground)] hero-demo-badge"
            style={{ width: 44, height: 44, boxShadow: "0 0 28px rgba(198,242,78,0.55)" }}
            aria-hidden
          >
            <ArrowRight size={18} />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes rec-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        .rec-dot {
          display: inline-block;
          width: 7px; height: 7px; border-radius: 9999px;
          background: #ff5a4a; margin-right: 6px;
          animation: rec-blink 1.4s steps(2, end) infinite;
        }
        @media (max-width: 719px) {
          .hero-demo-badge { transform: translate(-50%, -50%) rotate(90deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rec-dot { animation: none; }
        }
      `}</style>
    </div>
  );
}

function Chip({ children, lime = false }: { children: React.ReactNode; lime?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: `1px solid ${lime ? "rgba(198,242,78,0.45)" : "rgba(255,255,255,0.18)"}`,
        color: lime ? "#c6f24e" : "rgba(255,255,255,0.85)",
      }}
    >
      {children}
    </span>
  );
}
