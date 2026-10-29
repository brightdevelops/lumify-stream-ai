import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { elConvertSegment, type VoiceSummary } from "@/lib/elevenlabs.functions";
import { VOICE_LIVE_CREDITS_PER_SECOND } from "@/lib/pricing";

/* Segmentation constants — proven values, do not tune. */
const SILENCE_FLUSH_MS = 550;
const MAX_SEGMENT_MS = 6000;
const PREROLL_MS = 250;
const MIN_BURST_MS = 350;
const MAX_IN_FLIGHT = 3;
const TARGET_RATE = 16000;
const VOICE_RMS = 0.015;
const LOW_BALANCE = 60;

const CARD = "rounded-2xl border p-5";
const CARD_STYLE = { background: "#14170f", borderColor: "#262b1c" } as const;
const TITLE = "text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9aa08c]";

function resampleToPcm16(chunks: Float32Array[], fromRate: number): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const src = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { src.set(c, o); o += c.length; }
  const ratio = fromRate / TARGET_RATE;
  const outLen = Math.floor(total / ratio);
  const out = new DataView(new ArrayBuffer(outLen * 2));
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += src[j];
    const v = Math.max(-1, Math.min(1, end > start ? sum / (end - start) : src[start] ?? 0));
    out.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

function toBase64(buf: Uint8Array) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function LiveVoice({ renderPicker }: { renderPicker: (selected: VoiceSummary | null, onSelect: (v: VoiceSummary) => void) => ReactNode }) {
  const convert = useServerFn(elConvertSegment);
  const [voice, setVoice] = useState<VoiceSummary | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [spent, setSpent] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);
  const [hearMyself, setHearMyself] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);

  // The ONE element all converted audio plays through (its output device can be chosen later).
  const outRef = useRef<HTMLAudioElement | null>(null);
  const engine = useRef<{
    stream: MediaStream; ctx: AudioContext; proc: ScriptProcessorNode; src: MediaStreamAudioSourceNode;
  } | null>(null);
  const voiceRef = useRef<VoiceSummary | null>(null);
  voiceRef.current = voice;
  const sessionId = useRef("");
  const seqRef = useRef(0);
  const playSeq = useRef(0);
  const results = useRef(new Map<number, Blob | null>());
  const waiting = useRef<Array<{ seq: number; pcm: Uint8Array }>>([]);
  const flying = useRef(0);
  const playing = useRef(false);
  const recorded = useRef<Blob[]>([]);
  const activeRef = useRef(false);

  const refreshBalance = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase.from("credits").select("balance").eq("user_id", u.user.id).maybeSingle();
    setBalance(data?.balance ?? 0);
  }, []);
  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  const loadDevices = useCallback(async () => {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      setDevices(list);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void loadDevices(); }, [loadDevices]);

  useEffect(() => { if (outRef.current) outRef.current.volume = hearMyself ? 1 : 0; }, [hearMyself]);

  const playNext = useCallback(() => {
    const el = outRef.current;
    if (!el || playing.current) return;
    while (results.current.has(playSeq.current) && results.current.get(playSeq.current) === null) {
      results.current.delete(playSeq.current);
      playSeq.current++;
    }
    const blob = results.current.get(playSeq.current);
    if (!blob) return;
    results.current.delete(playSeq.current);
    playSeq.current++;
    playing.current = true;
    const url = URL.createObjectURL(blob);
    el.src = url;
    const done = () => { URL.revokeObjectURL(url); playing.current = false; playNext(); };
    el.onended = done;
    el.onerror = done;
    el.play().catch(done);
  }, []);

  const pump = useCallback(() => {
    while (flying.current < MAX_IN_FLIGHT && waiting.current.length) {
      const job = waiting.current.shift()!;
      const v = voiceRef.current;
      if (!v) { results.current.set(job.seq, null); continue; }
      flying.current++;
      setInFlight(flying.current);
      convert({ data: { pcmBase64: toBase64(job.pcm), voice_id: v.id, session_id: sessionId.current } })
        .then((res) => {
          if (res.error) {
            results.current.set(job.seq, null);
            setError(res.error);
            if (activeRef.current) stopRef.current?.();
            return;
          }
          const bin = atob(res.audioBase64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const blob = new Blob([arr], { type: "audio/mpeg" });
          results.current.set(job.seq, blob);
          recorded.current.push(blob);
          setSeconds((s) => s + res.seconds);
          setSpent((c) => c + res.credits_charged);
          setBalance((b) => (b === null ? b : b - res.credits_charged));
          window.dispatchEvent(new Event("lumify:credits-changed"));
        })
        .catch((e) => {
          results.current.set(job.seq, null);
          setError(e instanceof Error ? e.message : "Conversion failed.");
        })
        .finally(() => {
          flying.current--;
          setInFlight(flying.current);
          playNext();
          pump();
        });
    }
  }, [convert, playNext]);

  const stopRef = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    activeRef.current = false;
    const e = engine.current;
    engine.current = null;
    if (e) {
      e.proc.disconnect(); e.src.disconnect();
      e.stream.getTracks().forEach((t) => t.stop());
      void e.ctx.close();
    }
    setActive(false);
    setLevel(0);
    // Offer the clip once in-flight conversions land.
    const finish = () => {
      if (flying.current > 0 || waiting.current.length) { window.setTimeout(finish, 300); return; }
      if (recorded.current.length) setClipUrl(URL.createObjectURL(new Blob(recorded.current, { type: "audio/mpeg" })));
      void refreshBalance();
    };
    finish();
  }, [refreshBalance]);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current?.(), []);

  const start = async () => {
    if (!voice) { setError("Pick a voice on the left first."); return; }
    setError(null);
    setStarting(true);
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    setClipUrl(null);
    recorded.current = [];
    results.current.clear();
    waiting.current = [];
    seqRef.current = 0;
    playSeq.current = 0;
    setSeconds(0);
    setSpent(0);
    sessionId.current = crypto.randomUUID();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      void loadDevices();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const rate = ctx.sampleRate;
      const chunkMs = (2048 / rate) * 1000;
      const preroll: Float32Array[] = [];
      let seg: Float32Array[] | null = null;
      let segMs = 0;
      let voicedMs = 0;
      let silentMs = 0;

      const flush = () => {
        const chunks = seg;
        const voiced = voicedMs;
        seg = null; segMs = 0; voicedMs = 0; silentMs = 0;
        if (!chunks || voiced < MIN_BURST_MS) return;
        waiting.current.push({ seq: seqRef.current++, pcm: resampleToPcm16(chunks, rate) });
        pump();
      };

      proc.onaudioprocess = (ev) => {
        const input = new Float32Array(ev.inputBuffer.getChannelData(0));
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        setLevel(Math.min(1, rms * 8));
        const loud = rms > VOICE_RMS;
        if (!seg) {
          preroll.push(input);
          while (preroll.length * chunkMs > PREROLL_MS) preroll.shift();
          if (loud) {
            seg = [...preroll];
            segMs = preroll.length * chunkMs;
            preroll.length = 0;
            voicedMs = chunkMs;
          }
          return;
        }
        seg.push(input);
        segMs += chunkMs;
        if (loud) { voicedMs += chunkMs; silentMs = 0; } else silentMs += chunkMs;
        if (silentMs >= SILENCE_FLUSH_MS || segMs >= MAX_SEGMENT_MS) flush();
      };
      src.connect(proc);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      proc.connect(sink);
      sink.connect(ctx.destination);
      engine.current = { stream, ctx, proc, src };
      activeRef.current = true;
      setActive(true);
    } catch {
      setError("Microphone access was blocked. Allow it in your browser and try again.");
    } finally {
      setStarting(false);
    }
  };

  const low = balance !== null && balance < LOW_BALANCE;

  return (
    <div className="grid gap-4 min-[960px]:grid-cols-[400px_minmax(0,1fr)]">
      <section className={CARD} style={CARD_STYLE}>
        <div className={TITLE}>Voices</div>
        {renderPicker(voice, setVoice)}
      </section>

      <section className={`${CARD} space-y-4`} style={CARD_STYLE}>
        <div className={TITLE}>Live voice changer</div>

        <div>
          <label className="text-[11px] uppercase tracking-[0.12em] text-[#9aa08c]" htmlFor="live-mic">Microphone</label>
          <select
            id="live-mic"
            value={deviceId}
            disabled={active}
            onChange={(e) => setDeviceId(e.target.value)}
            className="mt-2 h-10 w-full rounded-[10px] border px-3 text-[13.5px] text-[#f2f4ec] outline-none transition-colors duration-150"
            style={{ background: "#101309", borderColor: "#262b1c" }}
          >
            <option value="">Default microphone</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
            ))}
          </select>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "#101309" }} aria-label="Input level">
            <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-150" style={{ width: `${Math.round(level * 100)}%`, background: "#c6f24e" }} />
          </div>
        </div>

        <button
          onClick={active ? stop : start}
          disabled={starting || (!active && !voice)}
          className="press-btn flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold uppercase transition-colors duration-150 disabled:opacity-40"
          style={{ background: "#c6f24e", color: "#111406" }}
        >
          {starting ? <Loader2 size={16} className="animate-spin" /> : active ? "⏹ Stop" : "● Go live voice"}
        </button>
        {!voice && !active && <div className="text-[12px] text-[#6b7160]">Pick a voice on the left to start.</div>}

        {active && (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: "#c6f24e", borderColor: "rgba(198,242,78,.3)", background: "rgba(198,242,78,.08)" }}>Listening</span>
            {inFlight > 0 && (
              <span className="rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: "#c6f24e", borderColor: "rgba(198,242,78,.3)", background: "rgba(198,242,78,.08)" }}>Converting {inFlight}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[#f2f4ec]">
          <span className="font-mono">{seconds.toFixed(1)}s converted · {spent} credits</span>
          {balance !== null && <span className="text-[12px] text-[#9aa08c]">{balance.toLocaleString()} credits left</span>}
        </div>

        {low && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[13px]" style={{ borderColor: "rgba(255,210,138,.35)", background: "rgba(255,210,138,.08)", color: "#ffd28a" }}>
            <span>Low balance — live voice stops when you run out.</span>
            <Link to="/credits" className="font-semibold underline">Buy credits</Link>
          </div>
        )}

        <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 text-[13px] text-[#f2f4ec]">
          Hear myself
          <input type="checkbox" checked={hearMyself} onChange={(e) => setHearMyself(e.target.checked)} className="h-5 w-5 accent-[#c6f24e]" />
        </label>

        <audio ref={outRef} className="hidden" />

        {clipUrl && !active && (
          <a href={clipUrl} download={`lumify-live-${Date.now()}.mp3`} className="press-btn inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold uppercase text-[#f2f4ec]" style={{ borderColor: "#262b1c" }}>
            <Download size={14} /> Download clip
          </a>
        )}

        {error && <div role="alert" className="text-[13px] text-[#ff7a6b]">{error}</div>}

        <div className="space-y-1 border-t pt-3 text-[12px] text-[#6b7160]" style={{ borderColor: "#262b1c" }}>
          <div>Speaks ~1–2 seconds behind you — made for streaming, not phone calls.</div>
          <div>{VOICE_LIVE_CREDITS_PER_SECOND} credit per converted second · cloning 150 credits</div>
        </div>
      </section>
    </div>
  );
}
