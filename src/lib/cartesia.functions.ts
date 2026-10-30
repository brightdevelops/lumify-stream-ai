import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLONE_COST, MAX_CLONE_BYTES, createCartesiaWithTwin, createReplacement } from "@/lib/voice-cloning";
import { createElevenLabsTwin, deleteElevenLabsTwin } from "@/lib/voice-twins.server";

/**
 * Text-to-speech + cloning provider layer. User clones are TWINS: a Cartesia
 * voice (TTS) plus an ElevenLabs twin (live voice), paired in
 * user_cloned_voices.elevenlabs_voice_id. Ownership is enforced against that
 * table on every clone/TTS/delete call.
 */

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
  category?: "library" | "anime" | "mine";
  /** False when the ElevenLabs twin is missing — live voice offers a free retry. */
  live_ready?: boolean;
  cartesia_voice_id?: string;
  elevenlabs_voice_id?: string | null;
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
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = String(json.error ?? json.message ?? text ?? "");
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  return detail ? `${detail} (${res.status})` : `Cartesia request failed (${res.status})`;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
async function charge(userId: string, amount: number, description: string) {
  const sb = await admin();
  const { data } = await sb.rpc("api_charge_credits", { p_user_id: userId, p_amount: amount, p_description: description });
  return data === true;
}
async function refund(userId: string, amount: number, description: string) {
  try {
    const sb = await admin();
    await sb.rpc("api_refund_credits", { p_user_id: userId, p_amount: amount, p_description: description });
  } catch (e) {
    console.error("[voice] refund failed", { userId, amount, e });
  }
}

/** Rows in user_cloned_voices are private per user. Returns owner id or null when not a tracked clone. */
async function clonedVoiceOwner(voiceId: string): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb
    .from("user_cloned_voices")
    .select("user_id")
    .eq("cartesia_voice_id", voiceId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Throws when the voice is a clone owned by someone other than `userId`. */
async function assertVoiceAccess(voiceId: string, userId: string) {
  const owner = await clonedVoiceOwner(voiceId);
  if (owner && owner !== userId) {
    throw new Error("This cloned voice belongs to another user.");
  }
}

type ClonedRow = { user_id: string; elevenlabs_voice_id: string | null };

/**
 * Deletes a clone from BOTH providers plus its ownership row and stored clip.
 * The ElevenLabs twin delete is best-effort (logged + retried inside) and
 * never blocks the user.
 */
async function deleteOwnedClone(cartesiaId: string, userId: string) {
  const sb = await admin();
  const { data: row } = await sb
    .from("user_cloned_voices")
    .select("user_id, elevenlabs_voice_id")
    .eq("cartesia_voice_id", cartesiaId)
    .maybeSingle();
  const owned = (row as ClonedRow | null) ?? null;
  if (!owned || owned.user_id !== userId) {
    throw new Error("You can only delete voices you cloned.");
  }
  const res = await fetch(`${API}/voices/${encodeURIComponent(cartesiaId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(await cartesiaError(res));
  if (owned.elevenlabs_voice_id) await deleteElevenLabsTwin(owned.elevenlabs_voice_id);
  await sb.from("user_cloned_voices").delete().eq("cartesia_voice_id", cartesiaId);
  try {
    await sb.storage.from("voice-samples").remove([`${cartesiaId}.mp3`, `clips/${userId}/${cartesiaId}`]);
  } catch (e) {
    console.error("[voice-samples] cleanup failed", e);
  }
}

/** My voices — only the caller's own clones, with twin status for live voice. */
export const listMyClonedVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_cloned_voices")
      .select("cartesia_voice_id, name, language, created_at, elevenlabs_voice_id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      data: (data ?? []).map((r) => ({
        id: r.cartesia_voice_id,
        name: r.name,
        description: "Cloned voice",
        language: r.language ?? "",
        preview_file_url: "",
        category: "mine" as const,
        live_ready: Boolean(r.elevenlabs_voice_id),
        cartesia_voice_id: r.cartesia_voice_id,
        elevenlabs_voice_id: r.elevenlabs_voice_id,
      })) as VoiceSummary[],
      count: data?.length ?? 0,
    };
  });

/** Delete a clone the caller owns — Cartesia voice, ElevenLabs twin, row and clip. */
export const deleteClonedVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ voice_id: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    await deleteOwnedClone(data.voice_id, context.userId);
    return { ok: true };
  });

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
        category: "library" as const,
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

const speechCost = (chars: number) => Math.max(15, Math.ceil(chars / 10));

/**
 * Twin clone: one 150-credit charge creates the Cartesia voice (TTS) and its
 * ElevenLabs twin (live voice). Order: validate → lease + 24h window → charge
 * → delete old clone (both providers) → create. A Cartesia failure refunds and
 * creates nothing; a twin failure keeps the voice with a free retry later.
 */
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
  .handler(async ({ data, context }) => {
    const type = data.clipType.toLowerCase().split(";")[0];
    if (!ALLOWED_CLIP_TYPES.includes(type)) {
      throw new Error("Unsupported audio format. Use flac, mp3, ogg, wav or webm.");
    }
    const bytes = Uint8Array.from(atob(data.clipBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_CLONE_BYTES) throw new Error("Clip is larger than 3 MB.");

    const sb = await admin();
    const operationId = crypto.randomUUID();
    const { data: windowData, error: beginError } = await sb.rpc("begin_voice_clone", {
      p_user_id: context.userId,
      p_operation_id: operationId,
    });
    if (beginError) throw new Error(beginError.message);
    const window = z.object({ created_at: z.array(z.string()), now: z.string() }).parse(windowData);

    let twinId: string | null = null;
    let voiceId: string;
    try {
      voiceId = await createReplacement({
        createdAt: window.created_at,
        now: Date.parse(window.now),
        ownedVoiceIds: async () => {
          const { data: rows } = await sb
            .from("user_cloned_voices")
            .select("cartesia_voice_id")
            .eq("user_id", context.userId);
          return (rows ?? []).map((r) => r.cartesia_voice_id).filter((id): id is string => Boolean(id));
        },
        charge: () => charge(context.userId, CLONE_COST, `Voice clone · ${data.name}`),
        deleteOwned: (id) => deleteOwnedClone(id, context.userId),
        create: async () => {
          const result = await createCartesiaWithTwin({
            createCartesia: async () => {
              const form = new FormData();
              form.append("clip", new Blob([bytes as BlobPart], { type }), data.clipName);
              form.append("name", data.name);
              form.append("language", data.language);
              form.append("access", "private");
              if (data.description) form.append("description", data.description);
              const res = await fetch(`${API}/voices/clone`, {
                method: "POST",
                headers: authHeaders(),
                body: form,
                signal: AbortSignal.timeout(90_000),
              });
              if (!res.ok) throw new Error(await cartesiaError(res));
              return String(((await res.json()) as CartesiaVoice).id ?? "");
            },
            saveRow: async (cartesiaId) => {
              const { data: row, error: rpcErr } = await sb.rpc(
                "insert_cloned_voice_if_under_cap" as never,
                {
                  p_user_id: context.userId,
                  p_cartesia_voice_id: cartesiaId,
                  p_name: data.name,
                  p_language: data.language,
                  p_max: 1,
                } as never,
              );
              if (rpcErr) throw rpcErr;
              if (!row) throw new Error("Could not save your voice. Please try again.");
              // Keep the clip so a failed twin can be retried later at no charge.
              const { error: upErr } = await sb.storage
                .from("voice-samples")
                .upload(`clips/${context.userId}/${cartesiaId}`, bytes, { contentType: type, upsert: true });
              if (upErr) console.error("[voice-samples] clip store failed", { user_id: context.userId, cartesiaId, error: upErr });
            },
            createTwin: () =>
              createElevenLabsTwin({
                bytes,
                clipType: type,
                clipName: data.clipName,
                name: data.name,
                userId: context.userId,
                language: data.language,
              }),
            setTwin: async (cartesiaId, id) => {
              const { error } = await sb
                .from("user_cloned_voices")
                .update({ elevenlabs_voice_id: id })
                .eq("cartesia_voice_id", cartesiaId)
                .eq("user_id", context.userId);
              if (error) throw error;
            },
            cleanupCartesia: async (id) => {
              try {
                await fetch(`${API}/voices/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
              } catch (e) {
                console.error("[cartesia] orphan voice cleanup failed", { voice_id: id, error: e });
              }
            },
          });
          twinId = result.twinId;
          return result.id;
        },
        record: async (id) => {
          const { error } = await sb.rpc("finish_voice_clone", {
            p_user_id: context.userId,
            p_operation_id: operationId,
            p_voice_id: id,
          });
          if (error) throw new Error("Could not save your voice creation. Please try again.");
        },
        refund: () => refund(context.userId, CLONE_COST, "Voice clone refund (provider error)"),
      });
    } finally {
      const { error } = await sb.rpc("end_voice_clone", { p_user_id: context.userId, p_operation_id: operationId });
      if (error) console.error("[voice] clone lease release failed", error.code);
    }

    return {
      id: voiceId,
      name: data.name,
      description: "Cloned voice",
      language: data.language,
      preview_file_url: "",
      category: "mine" as const,
      live_ready: twinId !== null,
      cartesia_voice_id: voiceId,
      elevenlabs_voice_id: twinId,
      credits_charged: CLONE_COST,
    };
  });

/**
 * Free retry of a failed ElevenLabs twin. Uses the clip stored at clone time;
 * never charges. Ownership verified against user_cloned_voices.
 */
export const retryElevenLabsTwin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ voice_id: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = await admin();
    const { data: row } = await sb
      .from("user_cloned_voices")
      .select("user_id, name, language, elevenlabs_voice_id")
      .eq("cartesia_voice_id", data.voice_id)
      .maybeSingle();
    if (!row || row.user_id !== context.userId) {
      throw new Error("You can only retry voices you cloned.");
    }
    if (row.elevenlabs_voice_id) {
      return { ok: true, elevenlabs_voice_id: row.elevenlabs_voice_id, live_ready: true };
    }
    const clipPath = `clips/${context.userId}/${data.voice_id}`;
    const { data: file } = await sb.storage.from("voice-samples").download(clipPath);
    if (!file) {
      throw new Error("The original clip is no longer stored — please re-clone this voice.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const twinId = await createElevenLabsTwin({
      bytes,
      clipType: file.type || "audio/wav",
      clipName: "clip",
      name: row.name,
      userId: context.userId,
      language: row.language ?? undefined,
    });
    const { error } = await sb
      .from("user_cloned_voices")
      .update({ elevenlabs_voice_id: twinId })
      .eq("cartesia_voice_id", data.voice_id)
      .eq("user_id", context.userId);
    if (error) throw new Error("The twin was created but could not be saved. Please retry once more.");
    return { ok: true, elevenlabs_voice_id: twinId, live_ready: true };
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
        emotion: z.string().min(1).max(40).optional(),
        language: z.string().min(2).max(8).optional(),
        format: z.enum(["mp3", "wav"]),
        is_preview: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertVoiceAccess(data.voice_id, context.userId);

    const isPreview = data.is_preview === true && data.format === "mp3";
    const samplePath = `${data.voice_id}.mp3`;

    const toBase64 = (buf: Uint8Array) => {
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      return btoa(binary);
    };

    if (isPreview) {
      try {
        const sb = await admin();
        const { data: file } = await sb.storage.from("voice-samples").download(samplePath);
        if (file) {
          const cached = new Uint8Array(await file.arrayBuffer());
          if (cached.length > 0) {
            return { audioBase64: toBase64(cached), contentType: "audio/mpeg", bytes: cached.length, cached: true, credits_charged: 0, error: null as string | null };
          }
        }
      } catch {
        /* cache miss — fall through to generation */
      }
    }

    const cost = isPreview ? 0 : speechCost(data.transcript.length);
    if (cost > 0) {
      const charged = await charge(context.userId, cost, `Voice generation · ${data.transcript.length} characters`);
      if (!charged) {
        // Soft failure: an expected business outcome, not a crash.
        return {
          audioBase64: "",
          contentType: "",
          bytes: 0,
          cached: false,
          credits_charged: 0,
          error: `This generation costs ${cost} credits and your balance is too low. Top up your wallet to continue.`,
        };
      }
    }

    const generation_config: Record<string, unknown> = { speed: data.speed, volume: data.volume };
    if (data.emotion && data.emotion !== "neutral") generation_config["emotion"] = data.emotion;

    const output_format =
      data.format === "wav"
        ? { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 }
        : { container: "mp3", sample_rate: 44100, bit_rate: 128000 };

    let genRefunded = false;
    const refundGeneration = async (why: string) => {
      if (genRefunded || cost <= 0) return;
      genRefunded = true;
      await refund(context.userId, cost, `Voice generation refund (${why})`);
    };

    let buf: Uint8Array;
    try {
      const res = await fetch(`${API}/tts/bytes`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: "sonic-3.5",
          transcript: data.transcript,
          voice: { mode: "id", id: data.voice_id },
          ...(data.language ? { language: data.language } : {}),
          generation_config,
          output_format,
        }),
      });
      if (!res.ok) {
        const msg = await cartesiaError(res);
        await refundGeneration("provider error");
        throw new Error(msg);
      }
      buf = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      await refundGeneration("network error");
      throw e instanceof Error ? e : new Error("Voice generation failed. Please try again.");
    }

    if (!isPreview) {
      try {
        const sb = await admin();
        const { error: usageErr } = await sb.from("voice_usage").insert({
          user_id: context.userId,
          kind: "generation",
          characters: data.transcript.length,
          credits: cost,
          voice_id: data.voice_id,
          source: "dashboard",
        });
        if (usageErr) {
          console.error("[voice_usage] generation log failed", {
            user_id: context.userId,
            kind: "generation",
            voice_id: data.voice_id,
            error: usageErr,
          });
        }
      } catch (e) {
        console.error("[voice_usage] generation log failed", {
          user_id: context.userId,
          kind: "generation",
          voice_id: data.voice_id,
          error: e,
        });
      }
    }

    if (isPreview) {
      try {
        const sb = await admin();
        await sb.storage
          .from("voice-samples")
          .upload(samplePath, buf, { contentType: "audio/mpeg", upsert: true, cacheControl: "86400" });
      } catch (e) {
        console.error("[voice-samples] upload failed", e);
      }
    }

    return {
      audioBase64: toBase64(buf),
      contentType: data.format === "wav" ? "audio/wav" : "audio/mpeg",
      bytes: buf.length,
      cached: false,
      credits_charged: cost,
      error: null as string | null,
    };
  });
