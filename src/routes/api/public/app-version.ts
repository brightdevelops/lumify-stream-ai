import { createFileRoute } from "@tanstack/react-router";
import { APP_VERSION } from "@/lib/app-version";

export const Route = createFileRoute("/api/public/app-version")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ version: APP_VERSION }), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        }),
    },
  },
});
