import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

// Authenticated: used by the broadcaster (signed-in user on /stream).
export const getIceServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { buildIceServers } = await import("@/lib/ice.server");
    return { iceServers: buildIceServers() as IceServer[] };
  });
