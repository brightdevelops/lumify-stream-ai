import { createMiddleware } from "@tanstack/react-start";
import { ensureFreshSupabaseSession } from "@/lib/auth-session";

export const attachFreshSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const session = await ensureFreshSupabaseSession({ redirectToLogin: true });

  if (!session) return next();

  return next({
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
});