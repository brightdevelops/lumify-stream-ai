import { createMiddleware } from "@tanstack/react-start";
import { getStoredSupabaseAccessToken } from "@/lib/supabase-session-storage";

export const attachStoredSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const accessToken = getStoredSupabaseAccessToken();
  if (!accessToken) throw new Error("Not authenticated.");

  return next({
    headers: { Authorization: `Bearer ${accessToken}` },
  });
});