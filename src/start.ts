import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachStoredSupabaseAuth } from "@/lib/safe-auth-attacher";
// DO NOT re-add `attachSupabaseAuth` from `@/integrations/supabase/auth-attacher`.
// It is auto-generated and calls supabase.auth.refreshSession() on near-expiry
// tokens. Running it alongside attachStoredSupabaseAuth means every server
// function performs the auth dance twice, which races the SDK's own autoRefresh
// against rotating refresh tokens and force-logs users out.
// `attachStoredSupabaseAuth` is expiry-aware and is the ONLY auth middleware
// this app should register. If a regeneration re-adds the import, remove it again.



const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/lovable/")) {
    return next();
  }

  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachStoredSupabaseAuth],
}));
