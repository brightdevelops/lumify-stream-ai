import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function randomKey() {
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `lumify_live_${out}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const listMyApiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("api_keys")
      .select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        product: z.enum(["voice", "face"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count, error: countError } = await supabaseAdmin
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .is("revoked_at", null);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= 10) throw new Error("You already have 10 active API keys. Revoke one first.");

    const key = randomKey();
    const key_hash = await sha256Hex(key);

    const { data: row, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        user_id: context.userId,
        name: data.name,
        key_prefix: key.slice(0, 16),
        key_hash,
        scopes: ["voice"],
      })
      .select("id, name, key_prefix")
      .single();
    if (error) throw new Error(error.message);

    return { id: row.id, name: row.name, key_prefix: row.key_prefix, key };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ key_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.key_id)
      .eq("user_id", context.userId)
      .select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Key not found.");
    return row;
  });

export const deleteApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ key_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: findError } = await supabaseAdmin
      .from("api_keys")
      .select("id, revoked_at")
      .eq("id", data.key_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (!existing) throw new Error("Key not found.");
    if (!existing.revoked_at) throw new Error("Revoke the key first, then delete it.");

    const { error } = await supabaseAdmin
      .from("api_keys")
      .delete()
      .eq("id", data.key_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { id: data.key_id };
  });
