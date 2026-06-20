import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const HEYGEN_API = "https://api.heygen.com";
const HEYGEN_UPLOAD = "https://upload.heygen.com";
const ELEVEN_API = "https://api.elevenlabs.io";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const AVATAR_COST = 200; // credits per generation

// ---------- 1. Create job: translate -> TTS -> upload to HeyGen -> submit ----------
export const createAvatarJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { portraitPath: string; script: string; sourceLang: string; targetLang: string; voiceId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Check credits
    const { data: cred } = await supabase.from("credits").select("balance").eq("user_id", userId).maybeSingle();
    if (!cred || (cred.balance ?? 0) < AVATAR_COST) {
      throw new Error(`Insufficient credits (need ${AVATAR_COST})`);
    }

    const heygenKey = process.env.HEYGEN_API_KEY;
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!heygenKey) throw new Error("HeyGen not configured");
    if (!elevenKey) throw new Error("ElevenLabs not configured");
    if (!lovableKey) throw new Error("Lovable AI not configured");

    // 2. Create job row
    const { data: job, error: jobErr } = await supabase
      .from("avatar_jobs")
      .insert({
        user_id: userId,
        status: "translating",
        portrait_path: data.portraitPath,
        script: data.script,
        source_lang: data.sourceLang,
        target_lang: data.targetLang,
        voice_id: data.voiceId,
      })
      .select()
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message || "Failed to create job");

    const fail = async (msg: string) => {
      await supabase.from("avatar_jobs").update({ status: "failed", error: msg }).eq("id", job.id);
      throw new Error(msg);
    };

    try {
      // 3. Translate (if needed)
      let finalScript = data.script;
      if (data.sourceLang !== data.targetLang) {
        const tr = await fetch(`${GATEWAY}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: `Translate the user's text to ${data.targetLang}. Output ONLY the translation, no preamble.` },
              { role: "user", content: data.script },
            ],
          }),
        });
        if (!tr.ok) await fail(`Translation failed: ${tr.status} ${await tr.text()}`);
        const trJson = await tr.json();
        finalScript = trJson.choices?.[0]?.message?.content?.trim() || data.script;
      }
      await supabase.from("avatar_jobs").update({ translated_script: finalScript, status: "generating_voice" }).eq("id", job.id);

      // 4. ElevenLabs TTS -> mp3 bytes
      const ttsRes = await fetch(`${ELEVEN_API}/v1/text-to-speech/${data.voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text: finalScript, model_id: "eleven_multilingual_v2" }),
      });
      if (!ttsRes.ok) await fail(`TTS failed: ${ttsRes.status} ${await ttsRes.text()}`);
      const audioBuf = await ttsRes.arrayBuffer();

      // 5. Upload audio to HeyGen (returns asset_id)
      const audioUp = await fetch(`${HEYGEN_UPLOAD}/v1/asset`, {
        method: "POST",
        headers: { "x-api-key": heygenKey, "Content-Type": "audio/mpeg" },
        body: audioBuf,
      });
      if (!audioUp.ok) await fail(`HeyGen audio upload failed: ${audioUp.status} ${await audioUp.text()}`);
      const audioJson = await audioUp.json() as { data?: { id?: string }; code?: number };
      const audioAssetId = audioJson.data?.id;
      if (!audioAssetId) await fail(`HeyGen audio upload: no asset id (${JSON.stringify(audioJson)})`);

      // 6. Download portrait from storage and upload to HeyGen as talking_photo
      const { data: portraitBlob, error: dlErr } = await supabase.storage.from("avatar-assets").download(data.portraitPath);
      if (dlErr || !portraitBlob) await fail(`Portrait download failed: ${dlErr?.message}`);
      const portraitBytes = await portraitBlob!.arrayBuffer();
      const contentType = portraitBlob!.type || "image/jpeg";

      const photoUp = await fetch(`${HEYGEN_UPLOAD}/v1/talking_photo`, {
        method: "POST",
        headers: { "x-api-key": heygenKey, "Content-Type": contentType },
        body: portraitBytes,
      });
      if (!photoUp.ok) await fail(`HeyGen photo upload failed: ${photoUp.status} ${await photoUp.text()}`);
      const photoJson = await photoUp.json() as { data?: { talking_photo_id?: string } };
      const talkingPhotoId = photoJson.data?.talking_photo_id;
      if (!talkingPhotoId) await fail(`HeyGen photo upload: no talking_photo_id (${JSON.stringify(photoJson)})`);

      // 7. Submit video generation
      const genRes = await fetch(`${HEYGEN_API}/v2/video/generate`, {
        method: "POST",
        headers: { "x-api-key": heygenKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          video_inputs: [
            {
              character: { type: "talking_photo", talking_photo_id: talkingPhotoId },
              voice: { type: "audio", audio_asset_id: audioAssetId },
            },
          ],
          dimension: { width: 720, height: 1280 },
        }),
      });
      if (!genRes.ok) await fail(`HeyGen generate failed: ${genRes.status} ${await genRes.text()}`);
      const genJson = await genRes.json() as { data?: { video_id?: string }; error?: unknown };
      const videoId = genJson.data?.video_id;
      if (!videoId) await fail(`HeyGen generate: no video_id (${JSON.stringify(genJson)})`);

      await supabase.from("avatar_jobs").update({
        status: "rendering",
        heygen_video_id: videoId,
      }).eq("id", job.id);

      return { jobId: job.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // fail() already updated status if it threw; guard idempotent.
      await supabase.from("avatar_jobs").update({ status: "failed", error: msg }).eq("id", job.id);
      throw e;
    }
  });

// ---------- 2. Poll job: check HeyGen, finalize on completion ----------
export const pollAvatarJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job, error } = await supabase.from("avatar_jobs").select("*").eq("id", data.jobId).eq("user_id", userId).maybeSingle();
    if (error || !job) throw new Error("Job not found");

    if (job.status === "done" || job.status === "failed") return job;
    if (!job.heygen_video_id) return job;

    const heygenKey = process.env.HEYGEN_API_KEY!;
    const statusRes = await fetch(`${HEYGEN_API}/v1/video_status.get?video_id=${job.heygen_video_id}`, {
      headers: { "x-api-key": heygenKey },
    });
    if (!statusRes.ok) return job;
    const sj = await statusRes.json() as { data?: { status?: string; video_url?: string; error?: { message?: string } } };
    const hgStatus = sj.data?.status;

    if (hgStatus === "completed" && sj.data?.video_url) {
      // Deduct credits via the SECURITY DEFINER function (runs as user)
      const { error: dedErr } = await supabase.rpc("deduct_credits", {
        p_credits: AVATAR_COST,
        p_amount: 0,
        p_description: "Avatar video generation",
        p_log_transaction: true,
      });
      if (dedErr) {
        await supabase.from("avatar_jobs").update({ status: "failed", error: `Credit deduction failed: ${dedErr.message}` }).eq("id", job.id);
        return { ...job, status: "failed", error: dedErr.message };
      }

      const { data: updated } = await supabase.from("avatar_jobs").update({
        status: "done",
        video_url: sj.data.video_url,
        credits_charged: AVATAR_COST,
      }).eq("id", job.id).select().single();
      return updated ?? job;
    }

    if (hgStatus === "failed") {
      const msg = sj.data?.error?.message || "HeyGen rendering failed";
      const { data: updated } = await supabase.from("avatar_jobs").update({ status: "failed", error: msg }).eq("id", job.id).select().single();
      return updated ?? job;
    }

    return job;
  });

// ---------- 3. List my jobs ----------
export const listAvatarJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("avatar_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
