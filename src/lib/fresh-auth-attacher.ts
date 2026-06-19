import { createMiddleware } from "@tanstack/react-start";
import { ensureFreshSupabaseSession } from "@/lib/auth-session";

export const attachFreshSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const session = await ensureFreshSupabaseSession({ redirectToLogin: true });

  if (!session) throw new Error("Session expired. Please sign in again.");

  return next({
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
});