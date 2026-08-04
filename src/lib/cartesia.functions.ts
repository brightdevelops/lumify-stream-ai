import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CARTESIA_VERSION = "2026-03-01";
const API = "https://api.cartesia.ai";

type CartesiaVoice = {
  id?: string;
  name?: string;
  description?: string | null;
  language?: string | null;
  preview_file_url?: string | null;
};

export type VoiceSummary = {
  id: string;
  name: string;
  description: string;
  language: string;
  preview_file_url: string;
};

function authHeaders() {
  const key = process.env["CARTESIA_API_KEY"];
  if (!key) throw new Error("Voice Studio is not configured yet (missing Cartesia API key).");
  return {
    Authorization: `Bearer ${key}`,
    "Cartesia-Version": CARTESIA_VERSION,
  };
}

async function cartesiaError(res: Response) {
  let message = `Cartesia request failed (${res.status})`;
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      message = json.error ?? json.message ?? text ?? message;
    } catch {
      if (text) message = text;
    }
  } catch {
    /* ignore */
  }
  return message;
}

/** GET /voices — library + owned voices. */
export const listCartesiaVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(100).optional(),
        starting_after: z.string().optional(),
        q: z.string().optional(),
        gender: z.string().optional(),
        language: z.string().optional(),
        is_owner: z.boolean().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const params = new URLSearchParams();
    params.set("limit", String(data.limit ?? 30));
    if (data.starting_after) params.set("starting_after", data.starting_after);
    if (data.q) params.set("q", data.q);
    if (data.gender) params.set("gender", data.gender);
    if (data.language) params.set("language", data.language);
    if (data.is_owner) params.set("is_owner", "true");
    params.append("expand[]", "preview_file_url");

    const res = await fetch(`${API}/voices?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(await cartesiaError(res));
    const json = (await res.json()) as {
      data?: CartesiaVoice[];
      has_more?: boolean;
      next_page?: string | null;
    };
    return {
      data: (json.data ?? []).map((v) => ({
        id: String(v.id ?? ""),
        name: String(v.name ?? "Untitled"),
        description: v.description ? String(v.description) : "",
        language: v.language ? String(v.language) : "",
        preview_file_url: v.preview_file_url ? String(v.preview_file_url) : "",
      })),
      has_more: Boolean(json.has_more),
      next_page: json.next_page ?? null,
    };
  });

const ALLOWED_CLIP_TYPES = [
  "audio/flac",
  "audio/mp3",
  "audio/mpeg",
  "audio/mpga",
  "audio/oga",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
];

const MAX_CLIP_BYTES = 15 * 1024 * 1024;

/** POST /voices/clone — clip arrives base64-encoded from the browser. */
export const cloneCartesiaVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clipBase64: z.string().min(1),
        clipType: z.string().min(1),
        clipName: z.string().min(1).max(200),
        name: z.string().min(1).max(60),
        language: z.string().min(2).max(8),
        description: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!ALLOWED_CLIP_TYPES.includes(data.clipType.toLowerCase().split(";")[0])) {
      throw new Error("Unsupported audio format. Use flac, mp3, ogg, wav or webm.");
    }
    const bytes = Uint8Array.from(atob(data.clipBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_CLIP_BYTES) throw new Error("Clip is larger than 15 MB.");

    const form = new FormData();
    form.append("clip", new Blob([bytes], { type: data.clipType }), data.clipName);
    form.append("name", data.name);
    form.append("language", data.language);
    form.append("access", "private");
    if (data.description) form.append("description", data.description);

    const res = await fetch(`${API}/voices/clone`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(await cartesiaError(res));
    const v = (await res.json()) as CartesiaVoice;
    return {
      id: String(v.id ?? ""),
      name: String(v.name ?? "Untitled"),
      description: v.description ? String(v.description) : "",
      language: v.language ? String(v.language) : "",
      preview_file_url: v.preview_file_url ? String(v.preview_file_url) : "",
    };
  });

/** POST /tts/bytes — returns base64 audio for the browser to turn into a Blob. */
export const generateCartesiaSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transcript: z.string().min(1).max(5000),
        voice_id: z.string().min(1),
        speed: z.number().min(0.6).max(1.5),
        volume: z.number().min(0.5).max(2.0),
        emotion: z.string().min(1).max(40),
        format: z.enum(["mp3", "wav"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const generation_config: Record<string, unknown> = { speed: data.speed, volume: data.volume };
    if (data.emotion && data.emotion !== "neutral") generation_config["emotion"] = data.emotion;

    const output_format =
      data.format === "wav"
        ? { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 }
        : { container: "mp3", sample_rate: 44100, bit_rate: 128000 };

    const res = await fetch(`${API}/tts/bytes`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "sonic-3.5",
        transcript: data.transcript,
        voice: { mode: "id", id: data.voice_id },
        generation_config,
        output_format,
      }),
    });
    if (!res.ok) throw new Error(await cartesiaError(res));

    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return {
      audioBase64: btoa(binary),
      contentType: data.format === "wav" ? "audio/wav" : "audio/mpeg",
      bytes: buf.length,
    };
  });
