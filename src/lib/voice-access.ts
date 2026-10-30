/** Provider metadata stays server-side; summaries must never be used for access checks. */
export type RawVoice = {
  voice_id: string;
  name?: string;
  description?: string | null;
  category?: string;
  preview_url?: string | null;
  labels?: Record<string, string>;
  fine_tuning?: { language?: string };
};

const OWNER_TAG = "lumify-owner:";
export function ownerDescription(userId: string) {
  return `${OWNER_TAG}${userId}`;
}
export function ownerOf(voice: RawVoice) {
  const description = voice.description ?? "";
  const index = description.indexOf(OWNER_TAG);
  if (index < 0) return null;
  // A malformed tag is not a public voice; empty string deliberately differs from null.
  return description.slice(index + OWNER_TAG.length).trimStart().split(/\s/)[0].toLowerCase();
}
export function canUse(voice: RawVoice | undefined, userId: string) {
  if (!voice) return false;
  const owner = ownerOf(voice);
  if (owner !== null) return owner === userId.toLowerCase();
  // Never treat untagged private clones as shared library voices.
  return voice.category !== "cloned" && voice.category !== "professional";
}
export function canDelete(voice: RawVoice | undefined, userId: string) {
  return !!voice && ownerOf(voice) === userId.toLowerCase() && canUse(voice, userId);
}

/** Cache only RAW, unfiltered metadata. Invalidation also fences in-flight stale loads. */
export function createRawVoiceCache(load: () => Promise<RawVoice[]>, now = Date.now) {
  let cached: { at: number; voices: RawVoice[] } | null = null;
  let generation = 0;
  return {
    invalidate() { generation += 1; cached = null; },
    async get(force = false): Promise<RawVoice[]> {
      if (!force && cached && now() - cached.at < 60_000) return cached.voices;
      const started = generation;
      const voices = await load();
      if (started !== generation) return this.get(true);
      cached = { at: now(), voices };
      return voices;
    },
  };
}