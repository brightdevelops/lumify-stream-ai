// Stream recording helpers. Records the AI OUTPUT stream (disclosed in Terms),
// chunks every CHUNK_MS, uploads each chunk to the `stream-recordings` bucket,
// and inserts a stream_recordings row per chunk.

import { supabase } from "@/integrations/supabase/client";

const CHUNK_MS = 30_000; // 30 seconds per chunk

export type RecorderHandle = {
  stop: () => Promise<void>;
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

export function startSessionRecorder(opts: {
  userId: string;
  sessionId: string | null;
  stream: MediaStream;
}): RecorderHandle | null {
  if (typeof MediaRecorder === "undefined") return null;
  const { userId, stream } = opts;
  let { sessionId } = opts;

  const mimeType = pickMimeType();
  const ext = extFromMime(mimeType);
  let chunkIndex = 0;
  let stopped = false;

  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 600_000 });
  } catch (e) {
    console.error("MediaRecorder init failed", e);
    return null;
  }

  const uploadChunk = async (blob: Blob, idx: number, durationSec: number) => {
    if (!blob.size) return;
    // sessionId may have arrived just after start; allow caller to update by closure
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
    return null;
  }

  const stop = async () => {
    if (stopped) return;
    stopped = true;
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
  };

  return {
    stop,
  };
}

// Allow late session-id assignment (session row insert happens after recorder starts).
export function attachSessionId(_handle: RecorderHandle | null, _sessionId: string) {
  // Closure-based update — kept for ergonomics; we use a mutable ref instead.
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
    } as never);
  } catch (e) {
    console.error("logStreamEvent failed", e);
  }
}
