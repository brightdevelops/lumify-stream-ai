import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RecordingRow = {
  session_id: string;
  user_id: string;
  user_email: string | null;
  started_at: string;
  ended_at: string;
  chunk_count: number;
  total_bytes: number;
  total_duration_seconds: number;
  last_recording_at: string;
  is_vpn: boolean | null;
  last_country: string | null;
};

export type SessionDetail = {
  chunks: Array<{
    id: string;
    storage_path: string;
    chunk_index: number;
    duration_seconds: number | null;
    size_bytes: number | null;
    created_at: string;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    prompt: string | null;
    style: string | null;
    mode: string | null;
    realism: number | null;
    image_name: string | null;
    image_path: string | null;
    created_at: string;
  }>;
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.is_admin) throw new Error("not authorized");
}

export const inventorListRecordings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_stream_recordings", {
      p_limit: 200,
    });
    if (error) throw new Error(error.message);
    return { sessions: (data ?? []) as RecordingRow[] };
  });

export const inventorGetSessionDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ session_id: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: detail, error } = await context.supabase.rpc("admin_get_session_detail", {
      p_session_id: data.session_id as string,
    });
    if (error) throw new Error(error.message);
    return { detail: (detail ?? { chunks: [], events: [] }) as SessionDetail };
  });

// Returns short-lived signed URLs for a list of storage paths. Admin only.
export const inventorSignRecordingUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        paths: z.array(z.string().min(1).max(512)).min(1).max(200),
        expires_in: z.number().int().min(60).max(3600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("stream-recordings")
      .createSignedUrls(data.paths, data.expires_in ?? 600);
    if (error) throw new Error(error.message);
    return {
      urls: (signed ?? []).map((s) => ({ path: s.path ?? "", signedUrl: s.signedUrl ?? null })),
    };
  });

// Admin-only: delete all recordings for a session (storage objects + DB rows).
export const inventorDeleteSessionRecordings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ session_id: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = supabaseAdmin.from("stream_recordings").select("storage_path");
    const { data: rows } = data.session_id == null
      ? await q.is("session_id", null)
      : await q.eq("session_id", data.session_id);
    const paths = (rows ?? []).map((r: { storage_path: string }) => r.storage_path);
    if (paths.length) {
      await supabaseAdmin.storage.from("stream-recordings").remove(paths);
    }
    const del = supabaseAdmin.from("stream_recordings").delete();
    if (data.session_id == null) await del.is("session_id", null);
    else await del.eq("session_id", data.session_id);
    return { ok: true, removed: paths.length };
  });
