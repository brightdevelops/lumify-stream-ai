import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "voice-generations";
const MAX_BYTES = 25 * 1024 * 1024;

export type SavedGeneration = {
  id: string;
  voice_id: string | null;
  voice_name: string | null;
  transcript_preview: string | null;
  characters: number | null;
  format: string | null;
  bytes: number | null;
  created_at: string;
  url: string | null;
};

/** Persist an already-generated (and already-paid-for) clip. No credit charge. */
export const saveGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        audioBase64: z.string().min(1),
        format: z.enum(["mp3", "wav"]),
        voice_id: z.string().max(200).optional(),
        voice_name: z.string().max(200).optional(),
        transcript: z.string().max(20000).default(""),
        characters: z.number().int().min(0).max(1000000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_BYTES) throw new Error("This clip is larger than 25 MB and can't be saved.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const id = crypto.randomUUID();
    const ext = data.format;
    const path = `${context.userId}/${id}.${ext}`;
    const contentType = ext === "wav" ? "audio/wav" : "audio/mpeg";

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: row, error: insErr } = await supabaseAdmin
      .from("voice_generations")
      .insert({
        id,
        user_id: context.userId,
        voice_id: data.voice_id ?? null,
        voice_name: data.voice_name ?? null,
        transcript_preview: data.transcript.slice(0, 300),
        characters: data.characters ?? data.transcript.length,
        format: ext,
        storage_path: path,
        bytes: bytes.byteLength,
      })
      .select("id, voice_id, voice_name, transcript_preview, characters, format, bytes, created_at")
      .single();

    if (insErr || !row) {
      try {
        await supabaseAdmin.storage.from(BUCKET).remove([path]);
      } catch (e) {
        console.error("[voice_generations] orphan cleanup failed", { path, error: e });
      }
      throw new Error(insErr?.message ?? "Could not save this generation.");
    }

    return row;
  });

/** The caller's saved generations, newest first, with fresh 1-hour signed URLs. */
export const listMyGenerations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("voice_generations")
      .select("id, voice_id, voice_name, transcript_preview, characters, format, bytes, created_at, storage_path")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    if (rows.length === 0) return { data: [] as SavedGeneration[] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path), 3600);

    const urlByPath = new Map<string, string>();
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    }

    return {
      data: rows.map(({ storage_path, ...r }) => ({
        ...r,
        url: urlByPath.get(storage_path) ?? null,
      })) as SavedGeneration[],
    };
  });

/** Delete a saved generation the caller owns (storage object first, then row). */
export const deleteGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("voice_generations")
      .select("id, user_id, storage_path")
      .eq("id", data.id)
      .maybeSingle();

    if (!row || row.user_id !== context.userId) {
      throw new Error("You can only delete your own saved generations.");
    }

    try {
      await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
    } catch (e) {
      console.error("[voice_generations] storage delete failed", { path: row.storage_path, error: e });
    }

    const { error } = await supabaseAdmin.from("voice_generations").delete().eq("id", row.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
