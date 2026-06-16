// Stream recording helpers. Records a composite of the USER WEBCAM (their face)
// and the AI OUTPUT (the swap), side-by-side, plus an inset of the currently
// selected reference image (what they "swapped to"). Disclosed in Terms §5.
// Chunks every CHUNK_MS, uploads each chunk to the `stream-recordings` bucket,
// and inserts a stream_recordings row per chunk.

import { supabase } from "@/integrations/supabase/client";

const CHUNK_MS = 30_000; // 30 seconds per chunk
const CANVAS_W = 1280;
const CANVAS_H = 480;
const HALF_W = CANVAS_W / 2;

export type RecorderHandle = {
  stop: () => Promise<void>;
  setSessionId: (id: string | null) => void;
  setReferenceImage: (url: string | null) => void;
};

const pickMimeType = (): string => {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const t of candidates) {
    try {
      // @ts-ignore
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) return t;
    } catch {}
  }
  return "video/webm";
};

const extFromMime = (m: string) => (m.includes("mp4") ? "mp4" : "webm");

const videoFromStream = (stream: MediaStream): HTMLVideoElement => {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.srcObject = stream;
  v.play().catch(() => {});
  return v;
};

const drawCover = (
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) => {
  const sw = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || 0;
  const sh = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || 0;
  if (!sw || !sh) {
    ctx.fillStyle = "#111";
    ctx.fillRect(dx, dy, dw, dh);
    return;
  }
  const sr = sw / sh;
  const dr = dw / dh;
  let cw = sw;
  let ch = sh;
  if (sr > dr) {
    cw = sh * dr;
  } else {
    ch = sw / dr;
  }
  const sx = (sw - cw) / 2;
  const sy = (sh - ch) / 2;
  ctx.drawImage(el, sx, sy, cw, ch, dx, dy, dw, dh);
};

export function startSessionRecorder(opts: {
  userId: string;
  sessionId: string | null;
  webcamStream: MediaStream;
  outputStream: MediaStream;
  referenceImageUrl?: string | null;
}): RecorderHandle | null {
  if (typeof MediaRecorder === "undefined") return null;
  const { userId, webcamStream, outputStream } = opts;
  let sessionId: string | null = opts.sessionId ?? null;

  const webcamEl = videoFromStream(webcamStream);
  const outputEl = videoFromStream(outputStream);

  let refImg: HTMLImageElement | null = null;
  const setReferenceImage = (url: string | null) => {
    if (!url) {
      refImg = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      refImg = img;
    };
    img.onerror = () => {
      refImg = null;
    };
    img.src = url;
  };
  setReferenceImage(opts.referenceImageUrl ?? null);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let rafId = 0;
  let stoppedDraw = false;
  const draw = () => {
    if (stoppedDraw) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Left: webcam (user face). Right: AI output (swap).
    drawCover(ctx, webcamEl, 0, 0, HALF_W, CANVAS_H);
    drawCover(ctx, outputEl, HALF_W, 0, HALF_W, CANVAS_H);

    // Labels
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(8, 8, 110, 24);
    ctx.fillRect(HALF_W + 8, 8, 110, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("USER (cam)", 16, 25);
    ctx.fillText("AI OUTPUT", HALF_W + 16, 25);

    // Inset: swap-to reference image (top-right of right pane)
    if (refImg && refImg.naturalWidth > 0) {
      const iw = 180;
      const ih = 135;
      const ix = CANVAS_W - iw - 12;
      const iy = 40;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(ix - 4, iy - 4, iw + 8, ih + 8 + 18);
      drawCover(ctx, refImg, ix, iy, iw, ih);
      ctx.fillStyle = "#fff";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("SWAPPED TO", ix + 4, iy + ih + 14);
    }

    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  // @ts-ignore
  const compStream: MediaStream = canvas.captureStream(15);

  const mimeType = pickMimeType();
  const ext = extFromMime(mimeType);
  let chunkIndex = 0;
  let stopped = false;

  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(compStream, { mimeType, videoBitsPerSecond: 800_000 });
  } catch (e) {
    console.error("MediaRecorder init failed", e);
    cancelAnimationFrame(rafId);
    return null;
  }

  const uploadChunk = async (blob: Blob, idx: number, durationSec: number) => {
    if (!blob.size) return;
    const sid = sessionId ?? "no-session";
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${userId}/${sid}/${String(idx).padStart(4, "0")}-${ts}.${ext}`;
    try {
      const { error: upErr } = await supabase.storage
        .from("stream-recordings")
        .upload(path, blob, { contentType: mimeType, upsert: false });
      if (upErr) {
        console.error("stream-recordings upload failed", upErr);
        return;
      }
      await supabase.from("stream_recordings").insert({
        user_id: userId,
        session_id: sessionId,
        storage_path: path,
        chunk_index: idx,
        duration_seconds: Math.round(durationSec),
        size_bytes: blob.size,
        mime_type: mimeType,
      } as never);
    } catch (e) {
      console.error("stream-recordings persist failed", e);
    }
  };

  let chunkStart = Date.now();
  rec.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    const idx = chunkIndex++;
    const now = Date.now();
    const dur = (now - chunkStart) / 1000;
    chunkStart = now;
    void uploadChunk(e.data, idx, dur);
  };

  try {
    rec.start(CHUNK_MS);
  } catch (e) {
    console.error("MediaRecorder.start failed", e);
    cancelAnimationFrame(rafId);
    return null;
  }

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    stoppedDraw = true;
    cancelAnimationFrame(rafId);
    try {
      if (rec.state !== "inactive") {
        const done = new Promise<void>((resolve) => {
          rec.onstop = () => resolve();
        });
        rec.stop();
        await done;
      }
    } catch (e) {
      console.error("MediaRecorder.stop failed", e);
    }
    try {
      webcamEl.srcObject = null;
      outputEl.srcObject = null;
    } catch {}
  };

  return {
    stop,
    setSessionId: (id) => {
      sessionId = id;
    },
    setReferenceImage,
  };
}

// Upload the swap-to image to storage so admins can view exactly what the user
// uploaded as the reference. Returns the storage path (or null on failure).
export async function uploadSwapImage(args: {
  userId: string;
  sessionId: string | null;
  file: File;
}): Promise<string | null> {
  try {
    const sid = args.sessionId ?? "no-session";
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = (args.file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
    const path = `${args.userId}/${sid}/swap-${ts}.${ext}`;
    const { error } = await supabase.storage
      .from("stream-recordings")
      .upload(path, args.file, { contentType: args.file.type || "image/jpeg", upsert: false });
    if (error) {
      console.error("swap image upload failed", error);
      return null;
    }
    return path;
  } catch (e) {
    console.error("swap image upload threw", e);
    return null;
  }
}

// Lightweight event logger for prompt / style / mode swaps during a session.
export async function logStreamEvent(args: {
  userId: string;
  sessionId: string | null;
  eventType: "start" | "prompt_change" | "style_change" | "mode_change" | "image_change" | "stop";
  prompt?: string | null;
  style?: string | null;
  mode?: string | null;
  realism?: number | null;
  imageName?: string | null;
  imagePath?: string | null;
}) {
  try {
    await supabase.from("stream_events").insert({
      user_id: args.userId,
      session_id: args.sessionId,
      event_type: args.eventType,
      prompt: args.prompt ?? null,
      style: args.style ?? null,
      mode: args.mode ?? null,
      realism: args.realism ?? null,
      image_name: args.imageName ?? null,
      image_path: args.imagePath ?? null,
    } as never);
  } catch (e) {
    console.error("logStreamEvent failed", e);
  }
}
