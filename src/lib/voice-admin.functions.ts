import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VoiceAdminStats, VoiceRange } from "./voice-admin.server";

export type { VoiceAdminStats, VoiceRange, VoiceUsageRow } from "./voice-admin.server";

export const voiceAdminStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ range: z.enum(["today", "7d", "30d", "all"]) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<VoiceAdminStats> => {
    // Same admin check the existing Admin page uses — verified server-side.
    const adminEmail = process.env["ADMIN_EMAIL"] ?? "brightsolutionslab@gmail.com";
    const email = context.claims?.email as string | undefined;
    if (email !== adminEmail) throw new Error("Not authorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Not authorized");

    const { loadVoiceAdminStats } = await import("./voice-admin.server");
    return loadVoiceAdminStats(data.range as VoiceRange);
  });
