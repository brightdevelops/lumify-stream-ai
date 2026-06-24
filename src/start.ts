import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachStoredSupabaseAuth } from "@/lib/safe-auth-attacher";
// NOTE: Do NOT import or re-add `attachSupabaseAuth` from
// `@/integrations/supabase/auth-attacher` here. It calls
// supabase.auth.refreshSession() on near-expiry tokens and races the SDK's
// built-in autoRefresh, causing rotating-refresh-token revocation and
// force-logout right after login (especially on Windows Chrome/Edge).
// Use attachStoredSupabaseAuth only.


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
