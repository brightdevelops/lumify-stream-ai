import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

// Shared builder — never exposed to the client bundle directly.
export function buildIceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const url = process.env["TURN_URL"];
  const username = process.env["TURN_USERNAME"];
  const credential = process.env["TURN_CREDENTIAL"];
  if (url && username && credential) {
    servers.push({ urls: url, username, credential });
  }
  return servers;
}

// Authenticated: used by the broadcaster (signed-in user on /stream).
export const getIceServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ iceServers: buildIceServers() }));
