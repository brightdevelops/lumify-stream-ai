import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Pricing: 40 credits per minute of generated audio (≈ ₦920/min).
// 1 credit = ₦23 (matches the rest of the app).
const CREDITS_PER_MINUTE = 40;
const NAIRA_PER_CREDIT = 23;

// MP3 @ 128 kbps ≈ 16,000 bytes/sec → use to estimate duration from byte length.
const MP3_BYTES_PER_SECOND = 16000;

// Languages supported by ElevenLabs eleven_multilingual_v2 / eleven_turbo_v2_5.
// (Stable, well-known list — surfacing all of them via the selector.)
export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese (Mandarin)" },
  { code: "es", name: "Spanish" },
  { code: "hi", name: "Hindi" },
  { code: "pt", name: "Portuguese" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ar", name: "Arabic" },
  { code: "ko", name: "Korean" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "fil", name: "Filipino" },
  { code: "ms", name: "Malay" },
  { code: "ro", name: "Romanian" },
  { code: "uk", name: "Ukrainian" },
  { code: "el", name: "Greek" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "bg", name: "Bulgarian" },
  { code: "hr", name: "Croatian" },
  { code: "sk", name: "Slovak" },
  { code: "ta", name: "Tamil" },
  { code: "hu", name: "Hungarian" },
  { code: "no", name: "Norwegian" },
  { code: "vi", name: "Vietnamese" },
  { code: "ru", name: "Russian" },
] as const;

// Character-style voices (NOT impersonations of real people / copyrighted characters).
// All voices use the eleven_multilingual_v2 model, which speaks every supported language.
export const VOICE_STYLES = [
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Natural", description: "Warm, conversational voice" },
  { id: "e79twtVS2278lVZZQiAD", label: "Child", description: "Bright, youthful voice" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "Young Lady", description: "Friendly young female voice" },
  { id: "SAhdygBsjizE9aIj39dz", label: "Old Lady", description: "Warm older female voice" },
  { id: "IKne3meq5aSn9XLyUdCD", label: "Young Man", description: "Casual young male voice" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Old Man", description: "Deep older male voice" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Deep", description: "Deep, authoritative voice" },
  { id: "kPtEHAvRnjUJFv7SK9WI", label: "Robotic", description: "Synthetic, processed voice" },
] as const;

const VOICE_IDS: Set<string> = new Set(VOICE_STYLES.map((v) => v.id));
const LANG_CODES: Set<string> = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

const languageName = (code: string) =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;

export const getVoiceConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    languages: SUPPORTED_LANGUAGES.map((l) => ({ ...l })),
    voices: VOICE_STYLES.map((v) => ({ ...v })),
    creditsPerMinute: CREDITS_PER_MINUTE,
    nairaPerCredit: NAIRA_PER_CREDIT,
  };
});

// Conservative pre-flight estimate so the UI can warn before any spend.
// ~14 characters/sec of English speech is a reasonable upper-bound.
function estimateDurationSec(text: string) {
  return Math.max(2, Math.ceil(text.length / 14));
}
function creditsForSeconds(seconds: number) {
  return Math.max(1, Math.ceil((seconds / 60) * CREDITS_PER_MINUTE));
}

export const estimateVoiceCost = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ text: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const seconds = estimateDurationSec(data.text);
    const credits = creditsForSeconds(seconds);
    return { estimatedSeconds: seconds, estimatedCredits: credits };
  });

async function translateToLanguage(text: string, targetCode: string): Promise<string> {
  if (targetCode === "en") return text;
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("Translation service is not configured");

  const target = languageName(targetCode);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content:
            "You are a professional translator. Translate the user's text into the requested target language. Output ONLY the translated text — no commentary, no quotes, no transliteration.",
        },
        { role: "user", content: `Target language: ${target}\n\nText:\n${text}` },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Translation failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const translated = json.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error("Translation returned an empty result");
  return translated;
}

export const generateVoiceClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        text: z.string().min(1).max(2000),
        languageCode: z.string().min(2).max(8),
        voiceId: z.string().min(8).max(64),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!LANG_CODES.has(data.languageCode)) {
      throw new Error("Unsupported language");
    }
    if (!VOICE_IDS.has(data.voiceId)) {
      throw new Error("Unsupported voice");
    }

    const { supabase, userId } = context;
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("Voice service is not configured");

    // Pre-flight credit check — never start a paid generation we can't bill for.
    const estSeconds = estimateDurationSec(data.text);
    const estCredits = creditsForSeconds(estSeconds);
    const { data: bal } = await supabase
      .from("credits")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    const balance = bal?.balance ?? 0;
    if (balance < estCredits) {
      throw new Error(
        `Not enough credits. Estimated cost: ${estCredits} credits, balance: ${balance}. Top up to continue.`,
      );
    }

    // 1) Translate if needed.
    const speakText = await translateToLanguage(data.text, data.languageCode);

    // 2) Generate audio via ElevenLabs.
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(data.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: speakText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.4,
            use_speaker_boost: true,
            speed: 1.0,
          },
        }),
      },
    );
    if (!ttsRes.ok) {
      const body = await ttsRes.text().catch(() => "");
      throw new Error(
        `Voice generation failed (${ttsRes.status}). ${body.slice(0, 160) || "Please try again."}`,
      );
    }
    const audioBuf = await ttsRes.arrayBuffer();
    if (!audioBuf.byteLength) throw new Error("Voice service returned empty audio");

    // 3) Compute actual duration from the returned MP3 bytes (128 kbps CBR).
    const actualSeconds = Math.max(1, Math.round(audioBuf.byteLength / MP3_BYTES_PER_SECOND));
    const credits = creditsForSeconds(actualSeconds);
    const amountNaira = credits * NAIRA_PER_CREDIT;

    // 4) Deduct credits + log transaction atomically via the existing RPC.
    const langName = languageName(data.languageCode);
    const { error: deductErr } = await supabase.rpc("deduct_credits", {
      p_credits: credits,
      p_amount: amountNaira,
      p_description: `Voice clip — ${langName} · ${actualSeconds}s`,
      p_log_transaction: true,
    });
    if (deductErr) throw new Error(deductErr.message);

    // 5) Return audio as base64 for the client to play + pipe into the stream.
    const base64 = Buffer.from(audioBuf).toString("base64");
    return {
      audioBase64: base64,
      mimeType: "audio/mpeg",
      durationSeconds: actualSeconds,
      creditsDeducted: credits,
      translatedText: speakText,
    };
  });
