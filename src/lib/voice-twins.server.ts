/**
 * DEPRECATED — kept for rollback safety only. The twin system was removed:
 * ElevenLabs now powers TTS, cloning and live voice, and a clone is ONE
 * ElevenLabs voice (user_cloned_voices.voice_id). This module is referenced
 * only by the unreferenced Cartesia rollback path (src/lib/cartesia.functions.ts).
 */
import { ownerDescription } from "@/lib/voice-access";

const API = "https://api.elevenlabs.io";

function apiKey() {
  const key = process.env["ELEVENLABS_API_KEY"];
  if (!key) throw new Error("Voice Studio is not configured yet. (code: not_configured)");
  return key;
}

/** Creates the ElevenLabs twin of a clone. Throws with a reason code on failure. */
export async function createElevenLabsTwin(deps: {
  bytes: Uint8Array;
  clipType: string;
  clipName: string;
  name: string;
  userId: string;
  language?: string;
}): Promise<string> {
  const form = new FormData();
  form.append("name", deps.name);
  form.append("description", ownerDescription(deps.userId));
  form.append("remove_background_noise", "true");
  if (deps.language) form.append("labels", JSON.stringify({ language: deps.language }));
  form.append("files", new Blob([deps.bytes as BlobPart], { type: deps.clipType }), deps.clipName);
  const res = await fetch(`${API}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const j = (await res.json()) as { detail?: { status?: string; code?: string } | string };
      if (j.detail && typeof j.detail === "object") code = String(j.detail.code ?? j.detail.status ?? code);
    } catch {
      /* ignore */
    }
    console.error("[voice-twin] create failed", res.status, code);
    throw new Error(code);
  }
  const id = String(((await res.json()) as { voice_id?: string }).voice_id ?? "");
  if (!id) throw new Error("no_voice_id");
  return id;
}

/** Best-effort twin delete: one retry, logs, never throws or blocks the user. */
export async function deleteElevenLabsTwin(voiceId: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API}/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE",
        headers: { "xi-api-key": apiKey() },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || res.status === 404) return;
      console.error("[voice-twin] delete failed", voiceId, res.status);
    } catch (e) {
      console.error("[voice-twin] delete error", voiceId, e);
    }
  }
}
