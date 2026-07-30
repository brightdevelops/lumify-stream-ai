import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import cameraVideo from "@/assets/site-camera-loop.webm.asset.json";
import charactersVideo from "@/assets/site-characters-loop.webm.asset.json";
import cameraPoster from "@/assets/site-camera-poster.jpg.asset.json";
import charactersPoster from "@/assets/site-characters-poster.jpg.asset.json";

/**
 * Videos are drawn to <canvas> instead of using visible <video> elements so
 * that download-manager browser extensions (IDM, Video DownloadHelper, etc.)
 * don't attach their "download this video" overlays. The <video> elements
 * are created off-DOM (never appended to document.body) and used purely as
 * a frame source.
 */
export function HeroDemo() {
  const leftCanvas = useRef<HTMLCanvasElement | null>(null);
  const rightCanvas = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const leftC = leftCanvas.current;
    const rightC = rightCanvas.current;
    const root = rootRef.current;
    if (!leftC || !rightC || !root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Off-DOM video elements — never appended to the document, so extension
    // content scripts scanning document.querySelectorAll('video') won't find them.
    const left = document.createElement("video");
    const right = document.createElement("video");
    for (const v of [left, right]) {
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.crossOrigin = "anonymous";
      // Only metadata upfront — actual bytes stream when we assign src after visible.
      v.preload = "metadata";
    }


    const lctx = leftC.getContext("2d");
    const rctx = rightC.getContext("2d");
    if (!lctx || !rctx) return;

    let raf = 0;
    const draw = () => {
      // Match canvas backing store to displayed size for crispness.
      const fit = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, video: HTMLVideoElement) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        if (!video.videoWidth || !video.videoHeight) return;
        // object-fit: cover math
        const cRatio = w / h;
        const vRatio = video.videoWidth / video.videoHeight;
        let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
        if (vRatio > cRatio) {
          sw = video.videoHeight * cRatio;
          sx = (video.videoWidth - sw) / 2;
        } else {
          sh = video.videoWidth / cRatio;
          sy = (video.videoHeight - sh) / 2;
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      };
      fit(leftC, lctx, left);
      fit(rightC, rctx, right);
      raf = requestAnimationFrame(draw);
    };

    // Defer assigning video src (and starting playback) until the hero enters
    // the viewport. This keeps the initial page load fast — the poster JPG is
    // shown immediately from CSS background, and video bytes only start
    // streaming when the user actually sees the panel.
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      left.src = cameraVideo.url;
      right.src = charactersVideo.url;
      if (reduced) {
        left.pause();
        right.pause();
      } else {
        left.play().catch(() => {});
        right.play().catch(() => {});
        raf = requestAnimationFrame(draw);
      }
    };

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          start();
          io.disconnect();
          break;
        }
      }
    }, { rootMargin: "200px" });
    io.observe(root);

    // Sync guard: right is master clock.
    const LEFT_DURATION = 8.48;
    const interval = window.setInterval(() => {
      if (reduced || !started) return;
      if (!left.duration || !right.duration) return;
      const target = right.currentTime % LEFT_DURATION;
      if (Math.abs(left.currentTime - target) > 0.15) {
        try { left.currentTime = target; } catch { /* noop */ }
      }
    }, 2000);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
      left.pause();
      right.pause();
      left.src = "";
      right.src = "";
    };
  }, []);

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[1360px] px-4">
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
          <div
            className="relative min-[720px]:border-r border-b min-[720px]:border-b-0"
            style={{
              aspectRatio: "16 / 11",
              backgroundImage: `url(${cameraPoster.url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <canvas
              ref={leftCanvas}
              className="absolute inset-0 h-full w-full block"
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Live camera preview"
              role="img"
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
            style={{
              aspectRatio: "16 / 11",
              boxShadow: "inset 0 0 0 1.5px rgba(198,242,78,0.35)",
              backgroundImage: `url(${charactersPoster.url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <canvas
              ref={rightCanvas}
              className="absolute inset-0 h-full w-full block"
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Live Lumify output preview"
              role="img"
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
        .rec-dot {
          display: inline-block;
          width: 7px; height: 7px; border-radius: 9999px;
          background: #ff7a6b; margin-right: 6px;
        }
        @media (max-width: 719px) {
          .hero-demo-badge { transform: translate(-50%, -50%) rotate(90deg); }
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
