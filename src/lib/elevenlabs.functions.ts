import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VOICE_LIVE_CREDITS_PER_SECOND } from "@/lib/pricing";
import { CLONE_COST, MAX_CLONE_BYTES, createReplacement } from "@/lib/voice-cloning";
import { canDelete, canUse, createRawVoiceCache, ownerDescription, ownerOf, type RawVoice } from "@/lib/voice-access";

/**
 * Voice Studio provider layer — ElevenLabs powers everything: text to speech,
 * cloning and live voice. A user's clone is ONE ElevenLabs voice, tagged with
 * `lumify-owner:<user_id>` in its description and tracked in
 * user_cloned_voices.voice_id (the ownership source of truth).
 */

const API = "https://api.elevenlabs.io";
const TTS_MODEL = "eleven_flash_v2_5"; // cost decision: flash tier, NOT multilingual v2
const STS_MODEL = "eleven_multilingual_sts_v2";
const MAX_SEGMENT_SECONDS = 15;
const speechCost = (chars: number) => Math.max(15, Math.ceil(chars / 10));

export type VoiceCategory = "library" | "anime" | "mine";
export type VoiceSummary = {
  id: string;
  name: string;
  description: string;
  language: string;
  preview_file_url: string;
  category?: VoiceCategory;
};

/** Curated anime-style library voices (mixed EN/JP, male/female). */
const ANIME_VOICES: VoiceSummary[] = [
  { id: "S0ypc51SmsvcKXTWvjqJ", name: "Kai — Energetic Anime Hero", language: "en", description: "Male · energetic" },
  { id: "unWb9iRIK7Xxf4A5Hfis", name: "Valf — Charismatic Protagonist", language: "en", description: "Male · charismatic" },
  { id: "X6VIT9ZXy5Nr7EmuLOGz", name: "Daria — Mysterious Villain", language: "en", description: "Female · soft, villain" },
  { id: "OSwaPSNdfituxkWcjlkR", name: "Kano — Cute & Anime", language: "ja", description: "Female · cute" },
  { id: "Y1JL3teRC0POFnlfftJe", name: "Ayame — Anime", language: "ja", description: "Female · bright" },
  { id: "oAlEJuW30knHWhA6cF0e", name: "Itsuki — Energetic", language: "ja", description: "Female · energetic" },
  { id: "A4AyGcPAjb1pHgflyZZp", name: "Ritsuto — Anime Prince", language: "ja", description: "Male · princely" },
  { id: "UUpoAQhpz37lNIWNVLoF", name: "Kuro — Mature Gentleman", language: "ja", description: "Male · mature" },
].map((v) => ({ ...v, preview_file_url: "", category: "anime" as const }));
const ANIME_IDS = new Set(ANIME_VOICES.map((v) => v.id));

function apiKey() {
  const key = process.env["ELEVENLABS_API_KEY"];
  if (!key) throw new Error("Voice Studio is not configured yet. (code: not_configured)");
  return key;
}

/** User-facing provider failure: reason code only, never the provider name. */
type VoiceAccessDiagnostic = { voiceId: string; rawDescription: string | null; ownerTag: string | null; requestingUserId: string; localAccessAllowed: boolean };
function accessDiagnostic(voiceId: string, voice: RawVoice | undefined, userId: string): VoiceAccessDiagnostic {
  return { voiceId, rawDescription: voice?.description ?? null, ownerTag: voice ? ownerOf(voice) : null, requestingUserId: userId, localAccessAllowed: canUse(voice, userId) };
}
async function providerError(res: Response, what: string, access?: VoiceAccessDiagnostic) {
  let code = `http_${res.status}`;
  try {
    const j = (await res.json()) as { detail?: { status?: string; code?: string } | string };
    if (j.detail && typeof j.detail === "object") code = String(j.detail.code ?? j.detail.status ?? code);
  } catch {
    /* ignore */
  }
  console.error(`[voice] ${what} failed`, res.status, code);
  if (code === "voice_access_denied" && access) {
    // Server logs only: do not expose another user's owner tag in client errors.
    console.error("[voice-access-denied]", JSON.stringify({ source: "provider", status: res.status, code, ...access }));
  }
  return new Error(`${what} failed. Please try again. (code: ${code})`);
}

const voiceCache = createRawVoiceCache(async () => {
  const voices: RawVoice[] = [];
  let nextPageToken: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100", include_total_count: "false" });
    if (nextPageToken) query.set("next_page_token", nextPageToken);
    const res = await fetch(`${API}/v2/voices?${query}`, { headers: { "xi-api-key": apiKey() } });
    if (!res.ok) throw await providerError(res, "Loading voices");
    const page = (await res.json()) as { voices?: RawVoice[]; has_more?: boolean; next_page_token?: string };
    voices.push(...(page.voices ?? []));
    if (page.has_more && (!page.next_page_token || page.next_page_token === nextPageToken)) throw new Error("Could not load all voices. Please try again.");
    nextPageToken = page.has_more ? page.next_page_token : undefined;
  } while (nextPageToken);
  return voices;
});
const accountVoices = (force = false) => voiceCache.get(force);
const toSummary = (v: RawVoice, category: VoiceCategory): VoiceSummary => ({
  id: v.voice_id,
  name: v.name ?? "Untitled",
  description: category === "mine" ? "Cloned voice" : (v.labels?.["description"] ?? v.labels?.["accent"] ?? ""),
  language: v.labels?.["language"] ?? v.fine_tuning?.language ?? "",
  preview_file_url: v.preview_url ?? "",
  category,
});

/** Throws if the voice is a clone tagged for another user. */
async function assertVoiceAccess(voiceId: string, userId: string) {
  // Authorization cannot trust a list cached by a different Worker before a replacement.
  const v = ANIME_IDS.has(voiceId)
    ? { voice_id: voiceId, category: "premade" }
    : (await accountVoices(true)).find((x) => x.voice_id === voiceId);
  const access = accessDiagnostic(voiceId, v, userId);
  if (!canUse(v, userId)) {
    console.error("[voice-access-denied]", JSON.stringify({ source: "local", ...access }));
    throw new Error("This voice isn't available to you.");
  }
  return access;
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
async function logUsage(row: { user_id: string; kind: "generation" | "clone" | "live_convert"; characters: number; credits: number; voice_id: string | null }) {
  try {
    const sb = await admin();
    const { error } = await sb.from("voice_usage").insert({ ...row, source: "dashboard" });
    if (error) console.error("[voice_usage] log failed", row.kind, error);
  } catch (e) {
    console.error("[voice_usage] log failed", row.kind, e);
  }
}
function toBase64(buf: Uint8Array) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Voices this user may use, grouped by category. */
export const elListVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ category: z.enum(["library", "anime", "mine"]), q: z.string().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const q = (data.q ?? "").toLowerCase();
    const match = (v: VoiceSummary) => !q || v.name.toLowerCase().includes(q);
    if (data.category === "anime") return { data: ANIME_VOICES.filter(match), count: 0 };
    if (data.category === "mine") {
      const mine = await myCloneRows(context.userId);
      const list = mine.map((r) => ({ id: r.voice_id, name: r.name, description: "Cloned voice", language: r.language ?? "", preview_file_url: "", category: "mine" as const }));
      return { data: list.filter(match), count: list.length };
    }
    const all = await accountVoices();
    const lib = all.filter((v) => ownerOf(v) === null && canUse(v, context.userId) && !ANIME_IDS.has(v.voice_id)).map((v) => toSummary(v, "library"));
    return { data: lib.filter(match), count: 0 };
  });

type CloneRow = { voice_id: string; name: string; language: string | null };
async function myCloneRows(userId: string): Promise<CloneRow[]> {
  const sb = await admin();
  const { data, error } = await sb.from("user_cloned_voices").select("voice_id, name, language").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((r): r is CloneRow & { voice_id: string } => Boolean(r.voice_id));
}

/** My voices — the caller's own clones — plus whether a free re-clone is available. */
export const listMyClonedVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await myCloneRows(context.userId);
    const sb = await admin();
    const { data: grant } = await sb.from("voice_reclone_grants").select("used_at").eq("user_id", context.userId).maybeSingle();
    return {
      data: rows.map((r) => ({ id: r.voice_id, name: r.name, description: "Cloned voice", language: r.language ?? "", preview_file_url: "", category: "mine" as const })) as VoiceSummary[],
      count: rows.length,
      free_reclone: Boolean(grant && !grant.used_at),
    };
  });

export const elTextToSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        transcript: z.string().min(1).max(5000),
        voice_id: z.string().min(1),
        speed: z.number().min(0.7).max(1.2).optional(),
        stability: z.number().min(0).max(1).optional(),
        is_preview: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const access = await assertVoiceAccess(data.voice_id, context.userId);
    const isPreview = data.is_preview === true;
    const samplePath = `el/${data.voice_id}.mp3`;
    if (isPreview) {
      try {
        const { data: file } = await (await admin()).storage.from("voice-samples").download(samplePath);
        if (file) {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (buf.length) return { audioBase64: toBase64(buf), contentType: "audio/mpeg", bytes: buf.length, credits_charged: 0, error: null as string | null };
        }
      } catch {
        /* miss */
      }
    }
    const cost = isPreview ? 0 : speechCost(data.transcript.length);
    if (cost > 0 && !(await charge(context.userId, cost, `Voice generation · ${data.transcript.length} characters`))) {
      return { audioBase64: "", contentType: "", bytes: 0, credits_charged: 0, error: `This generation costs ${cost} credits and your balance is too low. Top up your wallet to continue.` };
    }
    let buf: Uint8Array;
    try {
      const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(data.voice_id)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify({
          text: data.transcript,
          model_id: TTS_MODEL,
          voice_settings: { stability: data.stability ?? 0.5, similarity_boost: 0.75, speed: data.speed ?? 1.0 },
        }),
      });
      if (!res.ok) throw await providerError(res, "Voice generation", access);
      buf = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (cost > 0) await refund(context.userId, cost, "Voice generation refund (provider error)");
      throw e instanceof Error ? e : new Error("Voice generation failed.");
    }
    if (isPreview) {
      try {
        await (await admin()).storage.from("voice-samples").upload(samplePath, buf, { contentType: "audio/mpeg", upsert: true });
      } catch {
        /* ignore */
      }
    } else {
      await logUsage({ user_id: context.userId, kind: "generation", characters: data.transcript.length, credits: cost, voice_id: data.voice_id });
    }
    return { audioBase64: toBase64(buf), contentType: "audio/mpeg", bytes: buf.length, credits_charged: cost, error: null as string | null };
  });

const CLONE_TYPES = ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac"];

/** Delete a clone the user owns: provider voice, ownership row, stored clip and cached sample. */
async function deleteOwnedClone(voiceId: string, userId: string) {
  const sb = await admin();
  const { data: row } = await sb.from("user_cloned_voices").select("user_id").eq("voice_id", voiceId).maybeSingle();
  const voice = (await accountVoices(true)).find((v) => v.voice_id === voiceId);
  if ((!row || row.user_id !== userId) && !canDelete(voice, userId)) {
    console.error("[voice-access-denied]", JSON.stringify({ source: "local-delete", ...accessDiagnostic(voiceId, voice, userId) }));
    throw new Error("You can only delete voices you cloned.");
  }
  const res = await fetch(`${API}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE", headers: { "xi-api-key": apiKey() }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok && res.status !== 404) throw await providerError(res, "Deleting voice", accessDiagnostic(voiceId, voice, userId));
  voiceCache.invalidate();
  await sb.from("user_cloned_voices").delete().eq("voice_id", voiceId);
  try {
    await sb.storage.from("voice-samples").remove([`el/${voiceId}.mp3`, `clips/${userId}/${voiceId}`]);
  } catch (e) {
    console.error("[voice-samples] cleanup failed", e);
  }
}

/**
 * Single-provider clone: one ElevenLabs voice, owner-tagged, tracked in
 * user_cloned_voices.voice_id. Order: validate → lease + ownership/slot →
 * 24h window → charge (skipped for a free re-clone grant) → delete old →
 * create → save row + clip. Failures after charging refund (or restore the
 * grant) automatically.
 */
export const elCloneVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ clipBase64: z.string().min(1), clipType: z.string().min(1), clipName: z.string().min(1).max(200), name: z.string().min(1).max(60), language: z.string().max(8).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const type = data.clipType.toLowerCase().split(";")[0];
    if (!CLONE_TYPES.includes(type)) throw new Error("Unsupported audio format. Use wav, mp3, m4a, aac, ogg, webm or flac.");
    const bytes = fromBase64(data.clipBase64);
    if (bytes.byteLength > MAX_CLONE_BYTES) throw new Error("Clip is larger than 3 MB.");
    const form = new FormData();
    form.append("name", data.name);
    form.append("description", ownerDescription(context.userId));
    form.append("remove_background_noise", "true");
    if (data.language) form.append("labels", JSON.stringify({ language: data.language }));
    form.append("files", new Blob([bytes], { type }), data.clipName);
    const sb = await admin();
    const operationId = crypto.randomUUID();
    const { data: windowData, error: beginError } = await sb.rpc("begin_voice_clone", { p_user_id: context.userId, p_operation_id: operationId });
    if (beginError) throw new Error(beginError.message);
    const window = z.object({ created_at: z.array(z.string()), now: z.string() }).parse(windowData);

    // A legacy-upgrade grant makes this one creation free; it is consumed up
    // front and restored if the clone fails.
    const { data: freeData, error: grantError } = await sb.rpc("consume_reclone_grant", { p_user_id: context.userId });
    if (grantError) console.error("[voice] re-clone grant check failed", grantError);
    const free = !grantError && freeData === true;
    const restoreGrant = async () => {
      try {
        await sb.from("voice_reclone_grants").update({ used_at: null }).eq("user_id", context.userId);
      } catch (e) {
        console.error("[voice] re-clone grant restore failed", e);
      }
    };

    let voiceId: string;
    try {
      voiceId = await createReplacement({
        // Free re-clones are a migration courtesy: they never count toward the 5/24h window.
        createdAt: free ? [] : window.created_at,
        now: Date.parse(window.now),
        ownedVoiceIds: async () => (await myCloneRows(context.userId)).map((r) => r.voice_id),
        charge: free ? async () => true : () => charge(context.userId, CLONE_COST, `Voice clone · ${data.name}`),
        deleteOwned: (id) => deleteOwnedClone(id, context.userId),
        create: async () => {
          const res = await fetch(`${API}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": apiKey() }, body: form, signal: AbortSignal.timeout(90_000) });
          if (!res.ok) throw await providerError(res, "Voice cloning");
          voiceCache.invalidate();
          return String(((await res.json()) as { voice_id?: string }).voice_id ?? "");
        },
        record: async (id) => {
          const { error: saveError } = await sb.rpc("save_el_cloned_voice", { p_user_id: context.userId, p_voice_id: id, p_name: data.name, p_language: data.language ?? null, p_max: 1 });
          if (saveError) throw new Error("Could not save your voice creation. Please try again.");
          // Keep the clip so a future re-clone can reuse it.
          const { error: upErr } = await sb.storage.from("voice-samples").upload(`clips/${context.userId}/${id}`, bytes, { contentType: type, upsert: true });
          if (upErr) console.error("[voice-samples] clip store failed", { user_id: context.userId, voice_id: id, error: upErr });
          if (free) {
            await logUsage({ user_id: context.userId, kind: "clone", characters: 0, credits: 0, voice_id: id });
          } else {
            const { error } = await sb.rpc("finish_voice_clone", { p_user_id: context.userId, p_operation_id: operationId, p_voice_id: id });
            if (error) throw new Error("Could not save your voice creation. Please try again.");
          }
        },
        refund: free ? restoreGrant : () => refund(context.userId, CLONE_COST, "Voice clone refund (provider error)"),
      });
    } finally {
      voiceCache.invalidate();
      const { error } = await sb.rpc("end_voice_clone", { p_user_id: context.userId, p_operation_id: operationId });
      if (error) console.error("[voice] clone lease release failed", error.code);
    }
    return { id: voiceId, name: data.name, description: "Cloned voice", language: data.language ?? "", preview_file_url: "", category: "mine" as const, credits_charged: free ? 0 : CLONE_COST };
  });

export const elDeleteVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ voice_id: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    await deleteOwnedClone(data.voice_id, context.userId);
    return { ok: true };
  });

/**
 * Live-convert access: a clone is authorized against the user_cloned_voices
 * row (the ownership source of truth), not just the provider tag.
 * Anime/library voices keep the tag-based check.
 */
async function assertLiveVoiceAccess(voiceId: string, userId: string) {
  const sb = await admin();
  const { data: row } = await sb
    .from("user_cloned_voices")
    .select("user_id")
    .eq("voice_id", voiceId)
    .maybeSingle();
  if (row) {
    if (row.user_id !== userId) {
      console.error("[voice-access-denied]", JSON.stringify({ source: "clone-table", voiceId, requestingUserId: userId }));
      throw new Error("This voice isn't available to you.");
    }
    return undefined;
  }
  return assertVoiceAccess(voiceId, userId);
}

/** Live voice changer: one 16kHz mono s16le segment (≤15s) → converted mp3. */
export const elConvertSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pcmBase64: z.string().min(1).max(1_400_000), voice_id: z.string().min(1), session_id: z.string().min(1).max(80) }).parse(i))
  .handler(async ({ data, context }) => {
    const pcm = fromBase64(data.pcmBase64);
    const seconds = pcm.byteLength / 32000;
    if (seconds > MAX_SEGMENT_SECONDS) throw new Error("Segment too long (max 15 seconds).");
    if (seconds <= 0) throw new Error("Empty segment.");
    const access = await assertLiveVoiceAccess(data.voice_id, context.userId);
    const cost = Math.ceil(seconds * VOICE_LIVE_CREDITS_PER_SECOND);
    if (!(await charge(context.userId, cost, `Live voice · ${seconds.toFixed(1)}s`))) {
      return { audioBase64: "", seconds, credits_charged: 0, error: "Your balance is too low. Top up your wallet to continue." };
    }
    let buf: Uint8Array;
    try {
      const form = new FormData();
      form.append("audio", new Blob([pcm], { type: "application/octet-stream" }), "segment.pcm");
      form.append("model_id", STS_MODEL);
      form.append("file_format", "pcm_s16le_16");
      form.append("remove_background_noise", "true");
      form.append("voice_settings", JSON.stringify({ stability: 0.5, similarity_boost: 0.9 }));
      const res = await fetch(`${API}/v1/speech-to-speech/${encodeURIComponent(data.voice_id)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": apiKey() },
        body: form,
      });
      if (!res.ok) throw await providerError(res, "Voice conversion", access);
      buf = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      await refund(context.userId, cost, "Live voice refund (provider error)");
      throw e instanceof Error ? e : new Error("Voice conversion failed.");
    }
    await logUsage({ user_id: context.userId, kind: "live_convert", characters: Math.round(seconds * 1000), credits: cost, voice_id: data.voice_id });
    return { audioBase64: toBase64(buf), seconds, credits_charged: cost, error: null as string | null };
  });
