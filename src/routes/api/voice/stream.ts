import { createFileRoute } from "@tanstack/react-router";

const CARTESIA_VERSION = "2026-03-01";
const CARTESIA_API = "https://api.cartesia.ai";
const SAMPLE_RATE = 44100;
const MAX_SEGMENT_CHARS = 500;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authHeaders() {
  const key = process.env["CARTESIA_API_KEY"];
  if (!key) return null;
  return {
    Authorization: `Bearer ${key}`,
    "Cartesia-Version": CARTESIA_VERSION,
  };
}

/** Split into <=500 char segments on sentence boundaries; hard-split oversized sentences. */
export function splitTranscript(text: string, max = MAX_SEGMENT_CHARS): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = "";
  };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      for (let i = 0; i < s.length; i += max) {
        const piece = s.slice(i, i + max).trim();
        if (piece) out.push(piece);
      }
      continue;
    }
    if ((buf + s).length > max) push();
    buf += s;
  }
  push();
  return out.length ? out : [text.trim()];
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function handle(request: Request): Promise<Response> {
  const { createClient } = await import("@supabase/supabase-js");
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return json(500, { error: "Backend is not configured." });
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json(401, { error: "Not signed in." });

  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsErr || !userId) return json(401, { error: "Not signed in." });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "Body must be valid JSON." });
  }

  const transcript = typeof body["transcript"] === "string" ? (body["transcript"] as string).trim() : "";
  if (transcript.length < 1 || transcript.length > 20000) {
    return json(400, { error: "Field 'transcript' must be 1–20000 characters." });
  }
  const voice_id = typeof body["voice_id"] === "string" ? (body["voice_id"] as string).trim() : "";
  if (!voice_id) return json(400, { error: "Field 'voice_id' is required." });

  const speed = body["speed"] === undefined ? 1.0 : Number(body["speed"]);
  if (!Number.isFinite(speed) || speed < 0.6 || speed > 1.5) {
    return json(400, { error: "Field 'speed' must be between 0.6 and 1.5." });
  }
  const volume = body["volume"] === undefined ? 1.0 : Number(body["volume"]);
  if (!Number.isFinite(volume) || volume < 0.5 || volume > 2.0) {
    return json(400, { error: "Field 'volume' must be between 0.5 and 2.0." });
  }
  const emotion = typeof body["emotion"] === "string" ? (body["emotion"] as string) : undefined;
  const language = typeof body["language"] === "string" ? (body["language"] as string) : undefined;

  const headers = authHeaders();
  if (!headers) return json(502, { error: "Voice provider is not configured." });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // ownership guard — clones are private to their owner
  const { data: ownerRow } = await supabaseAdmin
    .from("user_cloned_voices")
    .select("user_id")
    .eq("cartesia_voice_id", voice_id)
    .maybeSingle();
  if (ownerRow && ownerRow.user_id !== userId) {
    return json(403, { error: "This cloned voice belongs to another user." });
  }

  const totalChars = transcript.length;
  const cost = Math.max(15, Math.ceil(totalChars / 10));
  const { data: charged } = await supabaseAdmin.rpc("api_charge_credits", {
    p_user_id: userId,
    p_amount: cost,
    p_description: `Voice generation · ${totalChars} characters`,
  });
  if (charged !== true) {
    return json(402, {
      error: `This generation costs ${cost} credits and your balance is too low. Top up your wallet to continue.`,
    });
  }

  let refunded = false;
  const refund = async (why: string) => {
    if (refunded) return;
    refunded = true;
    try {
      await supabaseAdmin.rpc("api_refund_credits", {
        p_user_id: userId,
        p_amount: cost,
        p_description: `Voice generation refund (${why})`,
      });
    } catch (e) {
      console.error("[cartesia] stream refund failed", { user_id: userId, why, error: e });
    }
  };

  const generation_config: Record<string, unknown> = { speed, volume };
  if (emotion && emotion !== "neutral") generation_config["emotion"] = emotion;

  const segments = splitTranscript(transcript);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let bytesOut = 0;

  const pump = async () => {
    try {
      for (const segment of segments) {
        const res = await fetch(`${CARTESIA_API}/tts/sse`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model_id: "sonic-3.5",
            transcript: segment,
            voice: { mode: "id", id: voice_id },
            ...(language ? { language } : {}),
            generation_config,
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
          }),
        });
        if (!res.ok || !res.body) {
          console.error("[cartesia] sse segment failed", { user_id: userId, status: res.status });
          break;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let done = false;
        while (!done) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let evt: { type?: string; data?: string };
            try {
              evt = JSON.parse(payload) as { type?: string; data?: string };
            } catch {
              continue;
            }
            if (evt.type === "chunk" && typeof evt.data === "string") {
              const bytes = b64ToBytes(evt.data);
              if (bytes.length) {
                bytesOut += bytes.length;
                await writer.write(bytes);
              }
            } else if (evt.type === "done" || evt.type === "error") {
              if (evt.type === "error") {
                console.error("[cartesia] sse error event", { user_id: userId, payload });
              }
              done = true;
              break;
            }
          }
        }
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.error("[cartesia] stream failed", { user_id: userId, error: e });
    } finally {
      if (bytesOut === 0) {
        await refund("no audio produced");
      } else {
        try {
          const { error: usageErr } = await supabaseAdmin.from("voice_usage").insert({
            user_id: userId,
            kind: "generation",
            characters: totalChars,
            credits: cost,
            voice_id,
            source: "dashboard",
          });
          if (usageErr) {
            console.error("[voice_usage] stream log failed", {
              user_id: userId,
              kind: "generation",
              voice_id,
              error: usageErr,
            });
          }
        } catch (e) {
          console.error("[voice_usage] stream log failed", {
            user_id: userId,
            kind: "generation",
            voice_id,
            error: e,
          });
        }
      }
      try {
        await writer.close();
      } catch {
        /* ignore */
      }
    }
  };

  void pump();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Sample-Rate": String(SAMPLE_RATE),
      "X-Credits-Charged": String(cost),
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/voice/stream")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
});
