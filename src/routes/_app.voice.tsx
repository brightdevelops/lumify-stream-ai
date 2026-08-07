import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Upload, Play, Pause, Download, Loader2, X, Check, Sparkles, Trash2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listCartesiaVoices,
  cloneCartesiaVoice,
  generateCartesiaSpeech,
  listMyClonedVoices,
  deleteClonedVoice,
  type VoiceSummary,
} from "@/lib/cartesia.functions";

export const Route = createFileRoute("/_app/voice")({
  head: () => ({
    meta: [
      { title: "Voice Studio — Lumify" },
      { name: "description", content: "Clone a voice from a short clip, type anything and hear it speak in studio quality." },
      { property: "og:title", content: "Voice Studio — Lumify" },
      { property: "og:description", content: "Clone a voice from a short clip, type anything and hear it speak in studio quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoiceStudio,
});

/* ---------------- tokens ---------------- */
const CARD = "rounded-2xl border p-5";
const CARD_STYLE = { background: "#14170f", borderColor: "#262b1c" } as const;
const TITLE = "text-[11px] uppercase tracking-[0.12em] text-[#9aa08c]";
const FIELD_LABEL = "text-[11px] uppercase tracking-[0.12em] text-[#9aa08c]";
const INPUT =
  "h-10 w-full rounded-[10px] border px-3 text-[13.5px] text-[#f2f4ec] outline-none transition-colors duration-150 placeholder:text-[#6b7160] focus:border-[#3a4229]";
const INPUT_STYLE = { background: "#101309", borderColor: "#262b1c" } as const;

const LANGS: Array<[string, string]> = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
  ["pt", "Portuguese"], ["hi", "Hindi"], ["zh", "Chinese"], ["ja", "Japanese"],
  ["ko", "Korean"], ["ar", "Arabic"],
];

const EMOTIONS = ["neutral", "calm", "happy", "excited", "content", "contemplative", "surprised", "sad", "angry", "scared"];

const AUDIO_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
/** Build a 16-bit PCM mono WAV blob from raw little-endian PCM bytes. */
function pcmToWavBlob(pcm: Uint8Array, sampleRate: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const wstr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wstr(36, "data");
  view.setUint32(40, pcm.length, true);
  return new Blob([header, pcm.slice().buffer as ArrayBuffer], { type: "audio/wav" });
}
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(blob);
  });
}

/** Downmix an AudioBuffer to a mono 16-bit PCM WAV blob (first `maxSec` seconds). */
function bufferToWav(buffer: AudioBuffer, maxSec = 30): Blob {
  const rate = 44100;
  const srcRate = buffer.sampleRate;
  const frames = Math.min(buffer.length, Math.floor(maxSec * srcRate));
  const outFrames = Math.floor((frames / srcRate) * rate);
  const chans: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));

  const data = new Int16Array(outFrames);
  for (let i = 0; i < outFrames; i++) {
    const srcIdx = Math.min(frames - 1, Math.floor((i * srcRate) / rate));
    let sum = 0;
    for (let c = 0; c < chans.length; c++) sum += chans[c][srcIdx] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, chans.length)));
    data[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }

  const bytes = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(bytes);
  const wr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); view.setUint32(4, 36 + data.length * 2, true); wr(8, "WAVE");
  wr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  wr(36, "data"); view.setUint32(40, data.length * 2, true);
  new Int16Array(bytes, 44).set(data);
  return new Blob([bytes], { type: "audio/wav" });
}

type Clip = { blob: Blob; name: string; url: string; duration: number; fromVideo: boolean };
type Generation = { id: string; transcript: string; voiceName: string; url: string; filename: string; summary: string };

function PricingNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      const seen = (data.user?.user_metadata as Record<string, unknown> | undefined)?.["voice_pricing_seen"];
      setShow(seen !== true);
    });
    return () => { alive = false; };
  }, []);

  if (!show) return null;

  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl border p-4"
      style={{ background: "#14170f", borderColor: "#262b1c", borderLeft: "3px solid #c6f24e" }}
    >
      <p className="flex-1 text-[13px] leading-relaxed text-[#f2f4ec]">
        Voice Studio uses your Lumify credits: 1 credit per 10 characters of speech (min 15), 150 credits to clone a
        voice. Previews are always free.
      </p>
      <button
        onClick={() => {
          setShow(false);
          void supabase.auth.updateUser({ data: { voice_pricing_seen: true } });
        }}
        className="shrink-0 rounded-full border px-3 py-1.5 text-[12px] text-[#9aa08c] transition-colors duration-150 hover:text-[#f2f4ec]"
        style={{ borderColor: "#262b1c" }}
      >
        Got it
      </button>
    </div>
  );
}

function PricingCard() {
  const rows: Array<{ icon: React.ReactNode; title: string; desc: string }> = [
    {
      icon: <Sparkles size={14} color="#c6f24e" />,
      title: "Generate speech",
      desc: "1 credit per 10 characters, minimum 15 credits per generation. A 1,000-character script costs 100 credits.",
    },
    {
      icon: <Mic size={14} color="#c6f24e" />,
      title: "Clone a voice",
      desc: "One-time 150 credits per voice. Keep up to 5 — deleting a voice frees a slot.",
    },
    {
      icon: <Play size={14} color="#c6f24e" />,
      title: "Previews & downloads",
      desc: "Always free. Listen to any voice and download your audio at no extra cost.",
    },
  ];


  return (
    <section className={CARD} style={CARD_STYLE}>
      <div className={TITLE}>How pricing works</div>
      <div className="mt-4 space-y-3.5">
        {rows.map((r) => (
          <div key={r.title} className="flex items-start gap-3">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
              style={{ background: "rgba(198,242,78,.12)" }}
            >
              {r.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] text-[#f2f4ec]">{r.title}</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-[#9aa08c]">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t pt-3 text-[11px] leading-relaxed text-[#6b7160]" style={{ borderColor: "#262b1c" }}>
        Charges come from the same credit balance you use for streaming. Top up in your{" "}
        <Link to="/credits" className="underline" style={{ color: "#9aa08c" }}>wallet</Link>.
      </div>
    </section>
  );
}

function VoiceStudio() {
  const [tab, setTab] = useState<"library" | "mine" | "clone">("library");
  const [selected, setSelected] = useState<VoiceSummary | null>(null);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-7">
      <header className="mb-6">
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400 }} className="text-[#f2f4ec]">
          Voice Studio
        </h1>
        <p className="mt-1 text-[13px] text-[#6b7160]">Clone a voice. Type anything. Hear it speak.</p>
      </header>

      <PricingNotice />

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <VoicePicker tab={tab} setTab={setTab} selected={selected} setSelected={setSelected} />
          <PricingCard />
        </div>
        <Composer selected={selected} />
      </div>
    </div>
  );
}


/* ---------------- left column ---------------- */

function VoicePicker(props: {
  tab: "library" | "mine" | "clone";
  setTab: (t: "library" | "mine" | "clone") => void;
  selected: VoiceSummary | null;
  setSelected: (v: VoiceSummary | null) => void;
}) {
  const { tab, setTab, selected, setSelected } = props;
  const [mineCount, setMineCount] = useState<number | null>(null);
  return (
    <section className={CARD} style={CARD_STYLE}>
      <div className="flex items-center justify-between">
        <div className={TITLE}>Voices</div>
        {mineCount !== null && (
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] text-[#9aa08c]"
            style={{ background: "#101309", borderColor: "#262b1c" }}
          >
            {mineCount}/5 slots
          </span>
        )}
      </div>
      <div className="mt-3 flex rounded-full p-[3px]" style={{ background: "#101309" }}>
        {([["library", "Library"], ["mine", "My voices"], ["clone", "Clone new"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="flex-1 rounded-full py-1.5 text-[12px] font-semibold transition-colors duration-150"
            style={tab === k ? { background: "#c6f24e", color: "#111406" } : { color: "#9aa08c" }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== "clone" && (
        <div className="mt-2 text-[11px] text-[#6b7160]">
          Press ▶ to hear a voice · click a row to use it
        </div>
      )}

      {tab === "clone" ? (
        <CloneForm
          onCloned={(v) => { setSelected(v); setTab("mine"); }}
        />
      ) : (
        <VoiceList
          key={tab}
          owner={tab === "mine"}
          selected={selected}
          onSelect={setSelected}
          onCloneCta={() => setTab("clone")}
          onCount={setMineCount}
          onDeleted={(id) => { if (selected?.id === id) setSelected(null); }}
        />
      )}
    </section>
  );
}

/** In-memory preview audio cache (object URLs), keyed by voice id. */
const PREVIEW_CACHE = new Map<string, string>();

function VoiceList(props: {
  owner: boolean;
  selected: VoiceSummary | null;
  onSelect: (v: VoiceSummary) => void;
  onCloneCta: () => void;
  onCount?: (n: number) => void;
  onDeleted?: (id: string) => void;
}) {
  const { owner, selected, onSelect, onCloneCta, onCount, onDeleted } = props;
  const fetchVoices = useServerFn(listCartesiaVoices);
  const fetchMine = useServerFn(listMyClonedVoices);
  const removeVoice = useServerFn(deleteClonedVoice);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmVoice, setConfirmVoice] = useState<VoiceSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tts = useServerFn(generateCartesiaSpeech);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [language, setLanguage] = useState("");
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewSeq = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!previewError) return;
    const t = window.setTimeout(() => setPreviewError(null), 4000);
    return () => window.clearTimeout(t);
  }, [previewError]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const load = useCallback(
    async (startingAfter?: string) => {
      setLoading(true);
      setError(null);
      try {
        if (owner) {
          // Clones are private to the user who made them — read our own ownership table.
          const mine = await fetchMine({});
          const q = debounced.toLowerCase();
          const filtered = mine.data.filter(
            (v) =>
              (!q || v.name.toLowerCase().includes(q)) &&
              (!language || (v.language || "").toLowerCase().startsWith(language)),
          );
          setVoices(filtered);
          setHasMore(false);
          setCursor(null);
          onCount?.(mine.count);
          return;
        }
        const res = await fetchVoices({
          data: {
            limit: 30,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
            ...(debounced ? { q: debounced } : {}),
            ...(language ? { language } : {}),
            
          },
        });
        setVoices((prev) => (startingAfter ? [...prev, ...res.data] : res.data));
        setHasMore(Boolean(res.has_more));
        setCursor(res.next_page ?? (res.data.length ? res.data[res.data.length - 1].id : null));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load voices.");
        if (!startingAfter) setVoices([]);
      } finally {
        setLoading(false);
      }
    },
    [fetchVoices, fetchMine, debounced, language, owner, onCount],
  );

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  /** Play a URL through the one shared Audio element. Resolves true on success. */
  const playUrl = (id: string, url: string) =>
    new Promise<boolean>((resolve) => {
      audioRef.current?.pause();
      const a = new Audio(url);
      audioRef.current = a;
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      a.onended = () => setPlayingId((p) => (p === id ? null : p));
      a.onpause = () => setPlayingId((p) => (p === id ? null : p));
      a.onerror = () => { setPlayingId((p) => (p === id ? null : p)); done(false); };
      a.onplaying = () => done(true);
      setPlayingId(id);
      a.play().then(() => done(true)).catch((err) => {
        console.error(`[voice-preview] playback failed for ${id}`, err);
        setPlayingId((p) => (p === id ? null : p));
        done(false);
      });
    });

  const SAMPLE_LINES: Record<string, string> = {
    en: "Hey, this is my voice on Lumify. Let's make something great.",
    es: "Hola, esta es mi voz en Lumify.",
    fr: "Salut, voici ma voix sur Lumify.",
    de: "Hallo, das ist meine Stimme auf Lumify.",
    pt: "Olá, esta é a minha voz no Lumify.",
    hi: "नमस्ते, यह Lumify पर मेरी आवाज़ है।",
  };

  const togglePreview = async (v: VoiceSummary) => {
    if (playingId === v.id) { audioRef.current?.pause(); setPlayingId(null); return; }
    audioRef.current?.pause();
    setPlayingId(null);

    const seq = ++previewSeq.current;
    setLoadingId(null);

    // Cached sample → instant, no spinner.
    const cached = PREVIEW_CACHE.get(v.id);
    if (cached) { void playUrl(v.id, cached); return; }

    // 1) Provider preview URL.
    if (v.preview_file_url) {
      const ok = await playUrl(v.id, v.preview_file_url);
      if (ok || previewSeq.current !== seq) return;
      console.error(`[voice-preview] preview_file_url failed for ${v.id}`, v.preview_file_url);
    }
    if (previewSeq.current !== seq) return;

    // 2) Generate a sample via TTS.
    setLoadingId(v.id);
    try {
      const lang = (v.language || "en").slice(0, 2).toLowerCase();
      const res = await tts({
        data: {
          transcript: SAMPLE_LINES[lang] ?? SAMPLE_LINES["en"],
          voice_id: v.id,
          speed: 1.0,
          volume: 1.0,
          language: lang,
          format: "mp3" as const,
          is_preview: true,
        },
      });
      if (previewSeq.current !== seq) return;
      if (res.error) {
        setPreviewError(res.error);
        setPlayingId(null);
        return;
      }
      const bin = atob(res.audioBase64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: res.contentType }));
      PREVIEW_CACHE.set(v.id, url);
      const ok = await playUrl(v.id, url);
      if (!ok && previewSeq.current === seq) {
        setPreviewError("Couldn't preview this voice — audio could not be played.");
      }
    } catch (e) {
      // 3) Total failure → visible error.
      console.error(`[voice-preview] sample generation failed for ${v.id}`, e);
      if (previewSeq.current === seq) {
        const msg = e instanceof Error ? e.message : String(e);
        setPreviewError(`Couldn't preview this voice — ${msg}`);
        setPlayingId(null);
      }
    } finally {
      if (previewSeq.current === seq) setLoadingId(null);
    }
  };

  const confirmDelete = async () => {
    const v = confirmVoice;
    if (!v) return;
    setDeletingId(v.id);
    try {
      await removeVoice({ data: { voice_id: v.id } });
      if (playingId === v.id) { audioRef.current?.pause(); setPlayingId(null); }
      const cached = PREVIEW_CACHE.get(v.id);
      if (cached) { URL.revokeObjectURL(cached); PREVIEW_CACHE.delete(v.id); }
      setVoices((prev) => {
        const next = prev.filter((x) => x.id !== v.id);
        onCount?.(next.length);
        return next;
      });
      onDeleted?.(v.id);
      setConfirmVoice(null);
      setNotice("Voice deleted");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Could not delete this voice.");
      setConfirmVoice(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mt-4">
      {previewError && (
        <div
          role="alert"
          className="fixed bottom-5 right-5 z-50 max-w-[340px] rounded-xl border px-4 py-3 text-[13px] shadow-lg"
          style={{ background: "#14170f", borderColor: "#2a2f22", color: "#ff7a6b" }}
        >
          {previewError}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search voices…"
          className={`${INPUT} w-full min-w-0`}
          style={INPUT_STYLE}
        />
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className={`${INPUT} w-full min-w-0 sm:w-[132px] sm:shrink-0`}
          style={INPUT_STYLE}
        >
          <option value="">All languages</option>
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1 md:max-h-[520px]">
        {loading && voices.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[58px] animate-pulse rounded-xl" style={{ background: "#181c11" }} />
          ))
        ) : error ? (
          <div className="rounded-xl p-3 text-[12px]" style={{ background: "rgba(255,122,107,.12)", color: "#ff7a6b" }}>{error}</div>
        ) : voices.length === 0 ? (
          owner ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="grid h-[52px] w-[52px] place-items-center rounded-xl" style={{ background: "rgba(198,242,78,.12)" }}>
                <Mic size={22} color="#c6f24e" />
              </div>
              <div className="text-[15px] font-semibold text-[#f2f4ec]">No cloned voices yet</div>
              <div className="text-[12.5px] text-[#6b7160]">Clone your first voice from a 10–20 second clip</div>
              <button
                onClick={onCloneCta}
                className="mt-1 rounded-full border px-4 py-2 text-[12.5px] text-[#f2f4ec] transition-colors duration-150 hover:border-[#3a4229]"
                style={{ borderColor: "#262b1c" }}
              >
                Clone a voice
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-10 text-center">
              <MicOff size={22} color="#6b7160" />
              <div className="text-[13px] text-[#f2f4ec]">No voices match</div>
              <div className="text-[12px] text-[#6b7160]">Try a different search or language</div>
            </div>
          )
        ) : (
          voices.map((v) => {
            const isSel = selected?.id === v.id;
            return (
              <div
                key={v.id}
                onClick={() => onSelect(v)}
                className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-150"
                style={
                  isSel
                    ? { background: "rgba(198,242,78,.12)", borderColor: "rgba(198,242,78,.3)" }
                    : { background: "#101309", borderColor: "#262b1c" }
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-[#f2f4ec]">{v.name}</span>
                    {playingId === v.id && (
                      <span className="voice-eq" aria-hidden="true"><i /><i /><i /></span>
                    )}
                    {isSel && (
                      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em]" style={{ background: "rgba(198,242,78,.2)", color: "#c6f24e" }}>
                        SELECTED
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12px] text-[#9aa08c]">{v.description || "—"}</div>
                </div>
                {v.language && (
                  <span
                    className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#9aa08c]"
                    style={{ background: "rgba(0,0,0,.55)", borderColor: "#262b1c" }}
                  >
                    {v.language}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); void togglePreview(v); }}
                  aria-label="Preview voice"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors duration-150"
                  style={
                    playingId === v.id
                      ? { background: "#c6f24e", borderColor: "#c6f24e", color: "#111406" }
                      : { borderColor: "#262b1c", color: "#9aa08c" }
                  }
                >
                  {loadingId === v.id ? <Loader2 size={12} className="animate-spin" /> : playingId === v.id ? <Pause size={12} /> : <Play size={12} />}
                </button>
                {owner && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmVoice(v); }}
                    aria-label={`Delete ${v.name}`}
                    className="voice-del grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors duration-150"
                    style={{ borderColor: "#262b1c", color: "#6b7160" }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })
        )}

        {hasMore && !loading && (
          <button
            onClick={() => cursor && load(cursor)}
            className="w-full rounded-full border py-2 text-[12.5px] text-[#9aa08c] transition-colors duration-150 hover:text-[#f2f4ec]"
            style={{ borderColor: "#262b1c" }}
          >
            Load more
          </button>
        )}
        {loading && voices.length > 0 && (
          <div className="py-2 text-center text-[12px] text-[#6b7160]">Loading…</div>
        )}
      </div>

      {confirmVoice && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(0,0,0,.65)" }}
          onClick={() => { if (!deletingId) setConfirmVoice(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-2xl border p-5"
            style={{ background: "#14170f", borderColor: "#262b1c" }}
          >
            <div className="text-[16px] font-semibold text-[#f2f4ec]">Delete this voice?</div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#9aa08c]">
              &ldquo;{confirmVoice.name}&rdquo; will be deleted permanently. This can&rsquo;t be undone, and no
              credits are refunded — but it frees one of your 5 slots.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmVoice(null)}
                disabled={Boolean(deletingId)}
                className="rounded-full border px-4 py-2 text-[12.5px] text-[#9aa08c] transition-colors duration-150 hover:text-[#f2f4ec] disabled:opacity-50"
                style={{ borderColor: "#262b1c" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={Boolean(deletingId)}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-opacity duration-150 disabled:opacity-60"
                style={{ background: "#ff7a6b", color: "#1a0b09" }}
              >
                {deletingId ? <Loader2 size={13} className="animate-spin" /> : null}
                Delete voice
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[60] rounded-xl border px-4 py-3 text-[13px] shadow-lg"
          style={{ background: "#14170f", borderColor: "#2a2f22", color: "#c6f24e" }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}

function CloneForm({ onCloned }: { onCloned: (v: VoiceSummary) => void }) {
  const clone = useServerFn(cloneCartesiaVoice);
  const [clip, setClip] = useState<Clip | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const setClipFromBlob = async (blob: Blob, fname: string, fromVideo: boolean) => {
    const url = URL.createObjectURL(blob);
    const duration = await new Promise<number>((resolve) => {
      const a = new Audio(url);
      a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => resolve(0);
    });
    setClip({ blob, name: fname, url, duration, fromVideo });
  };

  const handleFile = async (file: File) => {
    setError(null);
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && file.size > AUDIO_MAX) { setError("Audio clips must be under 15 MB."); return; }
    if (isVideo && file.size > VIDEO_MAX) { setError("Video files must be under 100 MB."); return; }

    if (!isVideo) { await setClipFromBlob(file, file.name, false); return; }

    setExtracting(true);
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      await ctx.close();
      if (!buf.length || buf.numberOfChannels === 0) throw new Error("no-audio");
      const wav = bufferToWav(buf, 30);
      await setClipFromBlob(wav, file.name.replace(/\.[^.]+$/, "") + ".wav", true);
    } catch {
      setError("This video has no audio track.");
    } finally {
      setExtracting(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await setClipFromBlob(new Blob(chunks, { type: "audio/webm" }), "recording.webm", false);
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSec(0);
    } catch {
      setError("Microphone access was blocked.");
    }
  };

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setRecSec((s) => {
        if (s + 1 >= 30) { recRef.current?.stop(); return 30; }
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const canClone = Boolean(clip && name.trim() && consent && !busy && !extracting);

  const submit = async () => {
    if (!clip || !canClone) return;
    setBusy(true);
    setError(null);
    try {
      const created = await clone({
        data: {
          clipBase64: await blobToBase64(clip.blob),
          clipType: clip.blob.type || "audio/wav",
          clipName: clip.name,
          name: name.trim(),
          language,
        },
      });
      window.dispatchEvent(new Event("lumify:credits-changed"));
      setToast(true);
      window.setTimeout(() => setToast(false), 3000);
      onCloned(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cloning failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
      />

      {!clip && (
        <div
          onClick={() => !extracting && fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
          className="cursor-pointer rounded-xl border border-dashed p-6 text-center transition-colors duration-150"
          style={{ borderColor: "#262b1c" }}
        >
          {extracting ? (
            <>
              <Loader2 size={20} className="mx-auto animate-spin" color="#9aa08c" />
              <div className="mt-2 text-[13px] text-[#f2f4ec]">Extracting audio from video…</div>
            </>
          ) : (
            <>
              <Upload size={20} className="mx-auto" color="#9aa08c" />
              <div className="mt-2 text-[13px] text-[#f2f4ec]">Drop audio or video, or click to browse</div>
              <div className="mt-1 text-[11px] text-[#6b7160]">
                mp3, wav, ogg, flac, webm audio · mp4, mov, webm video · 10–20 seconds of clear speech is ideal
              </div>
            </>
          )}
        </div>
      )}

      {!clip && !extracting && (
        <button
          onClick={() => (recording ? recRef.current?.stop() : void startRecording())}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full border text-[12.5px] transition-colors duration-150"
          style={{ borderColor: "#262b1c", color: recording ? "#ff7a6b" : "#9aa08c" }}
        >
          {recording ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "#ff7a6b" }} />
              <span className="font-mono">{fmtTime(recSec)}</span> Stop
            </>
          ) : (
            <>● Record</>
          )}
        </button>
      )}

      {clip && (
        <div className="rounded-xl border p-3" style={{ background: "#101309", borderColor: "#262b1c" }}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#f2f4ec]">{clip.name}</span>
            <span className="font-mono text-[11px] text-[#6b7160]">{fmtTime(clip.duration)}</span>
            <button onClick={() => setClip(null)} aria-label="Remove clip" className="text-[#9aa08c] hover:text-[#f2f4ec]">
              <X size={14} />
            </button>
          </div>
          <audio controls src={clip.url} className="mt-2 w-full" style={{ height: 36 }} />
          {clip.fromVideo && <div className="mt-1 text-[11px] text-[#6b7160]">Audio extracted from video · first 30 s</div>}
        </div>
      )}

      <div>
        <label className={FIELD_LABEL}>Voice name</label>
        <input
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Naira"
          className={`${INPUT} mt-2`}
          style={INPUT_STYLE}
        />
      </div>

      <div>
        <label className={FIELD_LABEL}>Language</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${INPUT} mt-2`} style={INPUT_STYLE}>
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <button onClick={() => setConsent((c) => !c)} className="flex items-start gap-2 text-left">
        <span
          className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors duration-150"
          style={consent ? { background: "#c6f24e", borderColor: "#c6f24e" } : { borderColor: "#262b1c", background: "#101309" }}
        >
          {consent && <Check size={12} color="#111406" strokeWidth={3} />}
        </span>
        <span className="text-[12px] leading-snug text-[#9aa08c]">
          I have permission to clone this voice — it&apos;s my voice or the speaker has consented.
        </span>
      </button>

      <div className="text-[11px] leading-relaxed text-[#6b7160]">
        One-time 150 credits per voice · keep up to 5 · deleting frees a slot.
      </div>


      {error && (
        <div className="rounded-xl p-3 text-[12px]" style={{ background: "rgba(255,122,107,.12)", color: "#ff7a6b" }}>{error}</div>
      )}

      <button
        onClick={submit}
        disabled={!canClone}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold transition-colors duration-150 disabled:opacity-40"
        style={{ background: "#c6f24e", color: "#111406", boxShadow: "0 6px 24px -6px rgba(198,242,78,.25)" }}
      >
        {busy ? (<><Loader2 size={15} className="animate-spin" /> Cloning…</>) : "Clone voice · 150 credits"}
      </button>

      {toast && (
        <div className="flex items-center gap-2 rounded-xl border p-3 text-[12.5px] text-[#f2f4ec]" style={{ background: "#14170f", borderColor: "#262b1c" }}>
          <Check size={14} color="#c6f24e" /> Voice cloned ✓
        </div>
      )}
    </div>
  );
}

/* ---------------- right column ---------------- */

function Composer({ selected }: { selected: VoiceSummary | null }) {
  const tts = useServerFn(generateCartesiaSpeech);
  const [transcript, setTranscript] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [emotion, setEmotion] = useState("neutral");
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [autoplay, setAutoplay] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [ttfa, setTtfa] = useState<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [tipOpen, setTipOpen] = useState(false);
  const canGenerate = Boolean(selected && transcript.trim() && !busy);
  const estimatedCost = useMemo(
    () => Math.max(15, Math.ceil(transcript.trim().length / 10)),
    [transcript],
  );

  const finish = (blob: Blob, ext: string, sizeLabel: number, voiceName: string, text: string) => {
    const gen: Generation = {
      id: `${Date.now()}`,
      transcript: text,
      voiceName,
      url: URL.createObjectURL(blob),
      filename: `lumify-voice-${voiceName.replace(/\s+/g, "-").toLowerCase()}-${stamp()}.${ext}`,
      summary: `${voiceName} · ${emotion[0].toUpperCase()}${emotion.slice(1)} · ${speed.toFixed(1)}× · ${ext.toUpperCase()} · ${fmtSize(sizeLabel)}`,
    };
    window.dispatchEvent(new Event("lumify:credits-changed"));
    setCurrent(gen);
    setHistory((h) => [gen, ...h].slice(0, 5));
    return gen;
  };

  /** Fallback: existing blocking bytes path. */
  const generateBytes = async (text: string, voice: VoiceSummary) => {
    const res = await tts({
      data: { transcript: text, voice_id: voice.id, speed, volume, emotion, format },
    });
    if (res.error) {
      setError(res.error);
      setCurrent(null);
      return;
    }
    const bin = atob(res.audioBase64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    finish(new Blob([arr], { type: res.contentType }), format, res.bytes, voice.name, text);
    setAutoplay(true);
  };

  const generate = async () => {
    if (!selected || !canGenerate) return;
    const voice = selected;
    const text = transcript.trim();
    setBusy(true);
    setError(null);
    setTtfa(null);

    let started = false;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("no-session");

      const t0 = performance.now();
      const res = await fetch("/api/voice/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ transcript: text, voice_id: voice.id, speed, volume, emotion }),
      });

      if (!res.ok || !res.body) {
        if (res.status === 402 || res.status === 403) {
          let msg = "Generation failed.";
          try {
            msg = String(((await res.json()) as { error?: string }).error ?? msg);
          } catch {
            /* ignore */
          }
          setError(msg);
          setCurrent(null);
          return;
        }
        throw new Error("stream-unavailable");
      }

      started = true;
      setStreaming(true);

      const sampleRate = Number(res.headers.get("X-Sample-Rate") ?? 44100) || 44100;
      const ctx =
        audioCtxRef.current && audioCtxRef.current.state !== "closed"
          ? audioCtxRef.current
          : new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      let playhead = ctx.currentTime + 0.12;
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let carry = new Uint8Array(0);
      let total = 0;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        if (ttfa === null && total === 0) setTtfa(Math.round(performance.now() - t0));

        let bytes = value;
        if (carry.length) {
          const merged = new Uint8Array(carry.length + value.length);
          merged.set(carry, 0);
          merged.set(value, carry.length);
          bytes = merged;
          carry = new Uint8Array(0);
        }
        if (bytes.length % 2 === 1) {
          carry = bytes.slice(bytes.length - 1);
          bytes = bytes.slice(0, bytes.length - 1);
        }
        if (!bytes.length) continue;

        parts.push(bytes);
        total += bytes.length;

        const samples = bytes.length / 2;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const buffer = ctx.createBuffer(1, samples, sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) channel[i] = dv.getInt16(i * 2, true) / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        const startAt = Math.max(playhead, ctx.currentTime + 0.02);
        src.start(startAt);
        playhead = startAt + buffer.duration;
      }

      if (total === 0) throw new Error("stream-empty");

      const pcm = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        pcm.set(p, off);
        off += p.length;
      }
      finish(pcmToWavBlob(pcm, sampleRate), "wav", pcm.length + 44, voice.name, text);
    } catch (e) {
      if (started) {
        setError(e instanceof Error && e.message !== "stream-empty" ? e.message : "Generation failed.");
        setCurrent(null);
      } else {
        try {
          await generateBytes(text, voice);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Generation failed.");
          setCurrent(null);
        }
      }
    } finally {
      setStreaming(false);
      setBusy(false);
    }
  };


  const counterColor = transcript.length > 4500 ? "#ffd28a" : "#6b7160";

  return (
    <div className="space-y-4">
      <section className={CARD} style={CARD_STYLE}>
        <div className={TITLE}>Script</div>
        <div className="mt-3">
          <span
            className="inline-block rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]"
            style={
              selected
                ? { color: "#c6f24e", borderColor: "rgba(198,242,78,.3)", background: "rgba(198,242,78,.08)" }
                : { color: "#6b7160", borderColor: "#262b1c" }
            }
          >
            {selected ? `◉ Voice — ${selected.name}${selected.language ? ` (${selected.language})` : ""}` : "Select a voice on the left"}
          </span>
        </div>
        <textarea
          value={transcript}
          maxLength={5000}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Type what you want this voice to say…"
          className="mt-3 min-h-[180px] w-full rounded-xl border p-[14px] text-[15px] leading-[1.6] text-[#f2f4ec] outline-none transition-colors duration-150 placeholder:text-[#6b7160] focus:border-[#3a4229]"
          style={INPUT_STYLE}
        />
        <div className="mt-1 text-right font-mono text-[11px]" style={{ color: counterColor }}>
          {transcript.length} / 5000
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <div className="voice-dock flex flex-wrap items-end gap-4">
          <SliderField label="Speed" value={speed} min={0.6} max={1.5} step={0.05} onChange={setSpeed} disabled={busy} />
          <SliderField label="Volume" value={volume} min={0.5} max={2.0} step={0.1} onChange={setVolume} disabled={busy} />
          <div className="shrink-0">
            <div className={FIELD_LABEL}>Emotion</div>
            <select
              value={emotion}
              disabled={busy}
              onChange={(e) => setEmotion(e.target.value)}
              className={`${INPUT} mt-2 w-[150px]`}
              style={INPUT_STYLE}
            >
              {EMOTIONS.map((e) => (
                <option key={e} value={e}>{e[0].toUpperCase() + e.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="voice-dock-divider h-10 w-px self-end" style={{ background: "#262b1c" }} />
          <div className="shrink-0">
            <div className={FIELD_LABEL}>Format</div>
            <div className="mt-2 flex h-10 items-center rounded-full p-[3px]" style={{ background: "#101309" }}>
              {(["mp3", "wav"] as const).map((f) => (
                <button
                  key={f}
                  disabled={busy}
                  onClick={() => setFormat(f)}
                  className="h-full rounded-full px-4 text-[12px] font-semibold uppercase transition-colors duration-150"
                  style={format === f ? { background: "#c6f24e", color: "#111406" } : { color: "#9aa08c" }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-[30px] py-[14px] text-[15px] font-bold transition-colors duration-150 disabled:opacity-40 md:w-auto"
            style={{ background: "#c6f24e", color: "#111406", boxShadow: "0 6px 24px -6px rgba(198,242,78,.25)" }}
          >
            {busy ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Sparkles size={16} /> Generate speech</>}
          </button>
          <span className="flex items-center gap-1.5 text-[12px] text-[#9aa08c]">
            ≈ {estimatedCost} credits
            <span className="group relative inline-flex" tabIndex={0} onClick={() => setTipOpen((v: boolean) => !v)}>
              <Info size={12} color="#6b7160" className="cursor-pointer" />
              <span
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] text-[#f2f4ec] group-hover:block"
                style={{ background: "#101309", borderColor: "#262b1c", display: tipOpen ? "block" : undefined }}
                data-tip
              >
                1 credit per 10 characters · 15 credit minimum
              </span>
            </span>
          </span>
        </div>
        
      </div>


      {(current || error) && (
        <section className={CARD} style={CARD_STYLE}>
          <div className={TITLE}>Output</div>
          {error ? (
            <div className="mt-3 rounded-xl p-3 text-[12px]" style={{ background: "rgba(255,122,107,.12)", color: "#ff7a6b" }}>{error}</div>
          ) : current ? (
            <>
              <AudioPlayer key={current.id} src={current.url} autoPlay={autoplay} onAutoPlayed={() => setAutoplay(false)} filename={current.filename} />
              <div className="mt-2 text-[12px] text-[#6b7160]">{current.summary}</div>
            </>
          ) : null}
        </section>
      )}

      {history.length >= 2 && (
        <section className={CARD} style={CARD_STYLE}>
          <div className={TITLE}>This session</div>
          <div className="mt-3 space-y-2">
            {history.map((g) => (
              <div key={g.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ background: "#101309", borderColor: "#262b1c" }}>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#f2f4ec]">{g.transcript}</span>
                <span className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#9aa08c]" style={{ borderColor: "#262b1c", background: "rgba(0,0,0,.55)" }}>
                  {g.voiceName}
                </span>
                <button
                  aria-label="Play"
                  onClick={() => { const a = new Audio(g.url); void a.play(); }}
                  className="grid h-7 w-7 place-items-center rounded-full border text-[#9aa08c] transition-colors duration-150 hover:text-[#f2f4ec]"
                  style={{ borderColor: "#262b1c" }}
                >
                  <Play size={12} />
                </button>
                <a
                  href={g.url}
                  download={g.filename}
                  aria-label="Download"
                  className="grid h-7 w-7 place-items-center rounded-full border text-[#9aa08c] transition-colors duration-150 hover:text-[#f2f4ec]"
                  style={{ borderColor: "#262b1c" }}
                >
                  <Download size={12} />
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SliderField(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  const { label, value, min, max, step, onChange, disabled } = props;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ flex: "1 1 180px", minWidth: 180 }}>
      <div className={FIELD_LABEL}>{label}</div>
      <div className="mt-2 flex h-10 items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="voice-slider min-w-0 flex-1"
          style={{ background: `linear-gradient(to right, #c6f24e ${pct}%, #262b1c ${pct}%)` }}
        />

        <span className="w-[44px] text-[13px] text-[#f2f4ec]" style={{ fontFamily: "Georgia, serif" }}>
          {value.toFixed(1)}×
        </span>
      </div>
    </div>
  );
}

function AudioPlayer({ src, autoPlay, onAutoPlayed, filename }: { src: string; autoPlay: boolean; onAutoPlayed: () => void; filename: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    if (!autoPlay) return;
    void ref.current?.play().catch(() => undefined);
    onAutoPlayed();
  }, [autoPlay, onAutoPlayed]);

  const pct = dur ? (time / dur) * 100 : 0;

  return (
    <div className="mt-3 flex items-center gap-3">
      <audio
        ref={ref}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <button
        onClick={() => (playing ? ref.current?.pause() : void ref.current?.play())}
        aria-label={playing ? "Pause" : "Play"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
        style={{ background: "rgba(198,242,78,.12)", color: "#c6f24e" }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div
        className="h-1 min-w-0 flex-1 cursor-pointer rounded-full"
        style={{ background: "#262b1c" }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (ref.current && dur) ref.current.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#c6f24e" }} />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-[#9aa08c]">{fmtTime(time)} / {fmtTime(dur)}</span>
      <a
        href={src}
        download={filename}
        className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] text-[#f2f4ec] transition-colors duration-150"
        style={{ borderColor: "rgba(198,242,78,.45)" }}
      >
        <Download size={13} /> Download
      </a>
    </div>
  );
}
