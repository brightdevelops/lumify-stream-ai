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

/** Rows in user_cloned_voices are private per user. Returns owner id or null when not a tracked clone. */
async function clonedVoiceOwner(voiceId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
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

/** My voices tab — only the caller's own clones. */
export const listMyClonedVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_cloned_voices")
      .select("cartesia_voice_id, name, language, created_at")
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
      })) as VoiceSummary[],
      count: data?.length ?? 0,
    };
  });

/** Delete a clone the caller owns (ours first, then Cartesia). */
export const deleteClonedVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ voice_id: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const owner = await clonedVoiceOwner(data.voice_id);
    if (!owner || owner !== context.userId) {
      throw new Error("You can only delete voices you cloned.");
    }
    const res = await fetch(`${API}/voices/${encodeURIComponent(data.voice_id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok && res.status !== 404) throw new Error(await cartesiaError(res));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_cloned_voices").delete().eq("cartesia_voice_id", data.voice_id);
    try {
      await supabaseAdmin.storage.from("voice-samples").remove([`${data.voice_id}.mp3`]);
    } catch (e) {
      console.error("[voice-samples] cleanup failed", e);
    }
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

const CLONE_COST = 150;
const MAX_CLONES = 5;
const speechCost = (chars: number) => Math.max(15, Math.ceil(chars / 10));



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
  .handler(async ({ data, context }) => {
    if (!ALLOWED_CLIP_TYPES.includes(data.clipType.toLowerCase().split(";")[0])) {
      throw new Error("Unsupported audio format. Use flac, mp3, ogg, wav or webm.");
    }
    const bytes = Uint8Array.from(atob(data.clipBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_CLIP_BYTES) throw new Error("Clip is larger than 15 MB.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // (a) best-effort cap check BEFORE charging
    const { count: ownedCount } = await supabaseAdmin
      .from("user_cloned_voices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if ((ownedCount ?? 0) >= MAX_CLONES) {
      throw new Error(`You can save up to ${MAX_CLONES} cloned voices. Delete one to make room.`);
    }

    const form = new FormData();
    form.append("clip", new Blob([bytes], { type: data.clipType }), data.clipName);
    form.append("name", data.name);
    form.append("language", data.language);
    form.append("access", "private");
    if (data.description) form.append("description", data.description);

    // (b) charge
    const { data: charged } = await supabaseAdmin.rpc("api_charge_credits", {
      p_user_id: context.userId,
      p_amount: CLONE_COST,
      p_description: `Voice clone · ${data.name}`,
    });
    if (charged !== true) {
      throw new Error(`Voice cloning costs ${CLONE_COST} credits and your balance is too low. Top up your wallet to continue.`);
    }

    let refunded = false;
    const refundClone = async (why: string) => {
      if (refunded) return;
      refunded = true;
      try {
        await supabaseAdmin.rpc("api_refund_credits", {
          p_user_id: context.userId,
          p_amount: CLONE_COST,
          p_description: `Voice clone refund (${why})`,
        });
      } catch (e) {
        console.error("[cartesia] clone refund failed", { user_id: context.userId, why, error: e });
      }
    };

    // (c) call Cartesia — any throw, timeout or non-OK status refunds exactly once
    let v: CartesiaVoice;
    try {
      const res = await fetch(`${API}/voices/clone`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const msg = await cartesiaError(res);
        await refundClone("provider error");
        throw new Error(msg);
      }
      v = (await res.json()) as CartesiaVoice;
    } catch (e) {
      await refundClone("network error");
      throw e instanceof Error ? e : new Error("Voice cloning failed. Please try again.");
    }

    const voiceId = String(v.id ?? "");

    // (d) atomic ownership insert under the cap
    let inserted = false;
    try {
      const { data: row, error: rpcErr } = await supabaseAdmin.rpc(
        "insert_cloned_voice_if_under_cap" as never,
        {
          p_user_id: context.userId,
          p_cartesia_voice_id: voiceId,
          p_name: String(v.name ?? data.name),
          p_language: v.language ? String(v.language) : data.language,
          p_max: MAX_CLONES,
        } as never,
      );
      if (rpcErr) throw rpcErr;
      inserted = Boolean(row);
    } catch (e) {
      console.error("[user_cloned_voices] insert failed", { user_id: context.userId, voice_id: voiceId, error: e });
      inserted = false;
    }

    // (e) compensate: remove the orphan upstream voice + refund
    if (!inserted) {
      if (voiceId) {
        try {
          await fetch(`${API}/voices/${encodeURIComponent(voiceId)}`, {
            method: "DELETE",
            headers: authHeaders(),
          });
        } catch (e) {
          console.error("[cartesia] orphan voice cleanup failed", { voice_id: voiceId, error: e });
        }
      }
      await refundClone("could not save voice");
      throw new Error(
        `We couldn't save this voice (limit is ${MAX_CLONES}). You were not charged — delete a voice and try again.`,
      );
    }

    try {
      const { error: usageErr } = await supabaseAdmin.from("voice_usage").insert({
        user_id: context.userId,
        kind: "clone",
        characters: 0,
        credits: CLONE_COST,
        voice_id: voiceId || null,
        source: "dashboard",
      });
      if (usageErr) {
        console.error("[voice_usage] clone log failed", {
          user_id: context.userId,
          kind: "clone",
          voice_id: voiceId,
          error: usageErr,
        });
      }
    } catch (e) {
      console.error("[voice_usage] clone log failed", {
        user_id: context.userId,
        kind: "clone",
        voice_id: voiceId,
        error: e,
      });
    }

    return {
      id: voiceId,
      name: String(v.name ?? "Untitled"),
      description: v.description ? String(v.description) : "",
      language: v.language ? String(v.language) : "",
      preview_file_url: v.preview_file_url ? String(v.preview_file_url) : "",
      credits_charged: CLONE_COST,
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
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: file } = await supabaseAdmin.storage.from("voice-samples").download(samplePath);
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: charged } = await supabaseAdmin.rpc("api_charge_credits", {
        p_user_id: context.userId,
        p_amount: cost,
        p_description: `Voice generation · ${data.transcript.length} characters`,
      });
      if (charged !== true) {
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
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.rpc("api_refund_credits", {
          p_user_id: context.userId,
          p_amount: cost,
          p_description: `Voice generation refund (${why})`,
        });
      } catch (e) {
        console.error("[cartesia] generation refund failed", { user_id: context.userId, why, error: e });
      }
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
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: usageErr } = await supabaseAdmin.from("voice_usage").insert({
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
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.storage
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

