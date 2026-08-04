import { createFileRoute } from "@tanstack/react-router";

const CARTESIA_VERSION = "2026-03-01";
const CARTESIA_API = "https://api.cartesia.ai";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

type ErrCode =
  | "invalid_api_key"
  | "insufficient_scope"
  | "insufficient_credits"
  | "rate_limited"
  | "invalid_request"
  | "upstream_error"
  | "not_found";

function errorResponse(status: number, code: ErrCode, message: string, extra?: Record<string, string>) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...(extra ?? {}) },
  });
}

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...(extra ?? {}) },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pathAfterBase(url: URL) {
  const idx = url.pathname.indexOf("/api-v1");
  const rest = idx === -1 ? url.pathname : url.pathname.slice(idx + "/api-v1".length);
  return rest.replace(/\/+$/, "") || "/";
}

async function cartesiaError(res: Response) {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = String(json.error ?? json.message ?? text ?? "");
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  return detail ? `${detail} (${res.status})` : `Cartesia request failed (${res.status})`;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = pathAfterBase(url);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // ---- auth ----
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("lumify_live_")) {
    return errorResponse(401, "invalid_api_key", "Missing or malformed API key.");
  }

  const keyHash = await sha256Hex(token);
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, name, scopes, last_used_at")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (!keyRow) return errorResponse(401, "invalid_api_key", "This API key is invalid or has been revoked.");

  const isVoicePath = path === "/v1/voices" || path === "/v1/voice/speech";
  if (isVoicePath && !(keyRow.scopes ?? []).includes("voice")) {
    return errorResponse(403, "insufficient_scope", "This key does not have the 'voice' scope.");
  }

  const log = async (status: number, credits: number) => {
    await supabaseAdmin.from("api_requests").insert({
      api_key_id: keyRow.id,
      user_id: keyRow.user_id,
      endpoint: path,
      status_code: status,
      credits_charged: credits,
    });
  };

  // ---- rate limits ----
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("api_requests")
    .select("endpoint")
    .eq("api_key_id", keyRow.id)
    .gte("created_at", since);
  const total = recent?.length ?? 0;
  const speechCount = (recent ?? []).filter((r) => r.endpoint === "/v1/voice/speech").length;
  if (total >= 60 || (path === "/v1/voice/speech" && speechCount >= 10)) {
    await log(429, 0);
    return errorResponse(429, "rate_limited", "Too many requests. Slow down and retry shortly.", {
      "Retry-After": "60",
    });
  }

  // ---- last_used_at ----
  const last = keyRow.last_used_at ? new Date(keyRow.last_used_at).getTime() : 0;
  if (!last || Date.now() - last > 60_000) {
    await supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);
  }

  const cartesiaKey = process.env["CARTESIA_API_KEY"];
  const cartesiaHeaders = {
    Authorization: `Bearer ${cartesiaKey ?? ""}`,
    "Cartesia-Version": CARTESIA_VERSION,
  };

  // ---- routes ----
  if (path === "/v1/me" && request.method === "GET") {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", keyRow.user_id)
      .maybeSingle();
    await log(200, 0);
    return jsonResponse(200, {
      user_id: keyRow.user_id,
      email: profile?.email ?? null,
      key_name: keyRow.name,
      scopes: keyRow.scopes,
    });
  }

  if (path === "/v1/voices" && request.method === "GET") {
    if (!cartesiaKey) {
      await log(502, 0);
      return errorResponse(502, "upstream_error", "Voice provider is not configured.");
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? 30);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 30, 1), 100);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    for (const p of ["starting_after", "q", "language"]) {
      const v = url.searchParams.get(p);
      if (v) params.set(p, v);
    }
    if (url.searchParams.get("is_owner") === "true") params.set("is_owner", "true");

    const res = await fetch(`${CARTESIA_API}/voices?${params.toString()}`, { headers: cartesiaHeaders });
    if (!res.ok) {
      const msg = await cartesiaError(res);
      await log(502, 0);
      return errorResponse(502, "upstream_error", msg);
    }
    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
      has_more?: boolean;
      next_page?: string | null;
    };
    // Hide clones that belong to other Lumify users; keep library voices for all.
    const ids = (json.data ?? []).map((v) => String(v["id"] ?? "")).filter(Boolean);
    const { data: clonedRows } = await supabaseAdmin
      .from("user_cloned_voices")
      .select("cartesia_voice_id, user_id")
      .in("cartesia_voice_id", ids.length ? ids : ["__none__"]);
    const foreignClones = new Set(
      (clonedRows ?? []).filter((r) => r.user_id !== keyRow.user_id).map((r) => r.cartesia_voice_id),
    );

    await log(200, 0);
    return jsonResponse(200, {
      data: (json.data ?? []).filter((v) => !foreignClones.has(String(v["id"] ?? ""))).map((v) => ({
        id: String(v["id"] ?? ""),
        name: String(v["name"] ?? "Untitled"),
        description: v["description"] ? String(v["description"]) : "",
        language: v["language"] ? String(v["language"]) : "",
        is_owner: Boolean(v["is_owner"] ?? false),
      })),
      has_more: Boolean(json.has_more),
      next_page: json.next_page ?? null,
    });
  }

  if (path === "/v1/voice/speech" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      await log(400, 0);
      return errorResponse(400, "invalid_request", "Body must be valid JSON.");
    }

    const text = body["text"];
    if (typeof text !== "string" || text.length < 1 || text.length > 5000) {
      await log(400, 0);
      return errorResponse(400, "invalid_request", "Field 'text' must be a string of 1–5000 characters.");
    }
    const voice_id = body["voice_id"];
    if (typeof voice_id !== "string" || !voice_id.trim()) {
      await log(400, 0);
      return errorResponse(400, "invalid_request", "Field 'voice_id' is required.");
    }
    const speed = body["speed"] === undefined ? 1.0 : Number(body["speed"]);
    if (!Number.isFinite(speed) || speed < 0.6 || speed > 1.5) {
      await log(400, 0);
      return errorResponse(400, "invalid_request", "Field 'speed' must be between 0.6 and 1.5.");
    }
    const volume = body["volume"] === undefined ? 1.0 : Number(body["volume"]);
    if (!Number.isFinite(volume) || volume < 0.5 || volume > 2.0) {
      await log(400, 0);
      return errorResponse(400, "invalid_request", "Field 'volume' must be between 0.5 and 2.0.");
    }
    const format = body["format"] === undefined ? "mp3" : String(body["format"]);
    if (format !== "mp3" && format !== "wav") {
      await log(400, 0);
      return errorResponse(400, "invalid_request", "Field 'format' must be 'mp3' or 'wav'.");
    }
    const emotion = typeof body["emotion"] === "string" ? (body["emotion"] as string) : undefined;

    if (!cartesiaKey) {
      await log(502, 0);
      return errorResponse(502, "upstream_error", "Voice provider is not configured.");
    }

    const { data: ownerRow } = await supabaseAdmin
      .from("user_cloned_voices")
      .select("user_id")
      .eq("cartesia_voice_id", voice_id)
      .maybeSingle();
    if (ownerRow && ownerRow.user_id !== keyRow.user_id) {
      await log(403, 0);
      return errorResponse(403, "insufficient_scope", "This cloned voice belongs to another user.");
    }

    const cost = Math.max(15, Math.ceil(text.length / 10));
    const { data: charged } = await supabaseAdmin.rpc("api_charge_credits", {
      p_user_id: keyRow.user_id,
      p_amount: cost,
      p_description: `API speech · ${text.length} characters`,
    });
    if (charged !== true) {
      await log(402, 0);
      return errorResponse(
        402,
        "insufficient_credits",
        `This request costs ${cost} credits but your balance is lower. Top up your wallet at lumifylive.com/wallet.`,
      );
    }

    const generation_config: Record<string, unknown> = { speed, volume };
    if (emotion && emotion !== "neutral") generation_config["emotion"] = emotion;
    const output_format =
      format === "wav"
        ? { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 }
        : { container: "mp3", sample_rate: 44100, bit_rate: 128000 };

    const res = await fetch(`${CARTESIA_API}/tts/bytes`, {
      method: "POST",
      headers: { ...cartesiaHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "sonic-3.5",
        transcript: text,
        voice: { mode: "id", id: voice_id },
        generation_config,
        output_format,
      }),
    });

    if (!res.ok) {
      const msg = await cartesiaError(res);
      await supabaseAdmin.rpc("api_refund_credits", {
        p_user_id: keyRow.user_id,
        p_amount: cost,
        p_description: "API speech refund (provider error)",
      });
      await log(502, 0);
      return errorResponse(502, "upstream_error", msg);
    }

    const bytes = await res.arrayBuffer();
    await log(200, cost);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
        "X-Credits-Charged": String(cost),
        "X-Characters": String(text.length),
      },
    });
  }

  await log(404, 0);
  return errorResponse(404, "not_found", "Unknown endpoint");
}

export const Route = createFileRoute("/api/public/api-v1/$")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
