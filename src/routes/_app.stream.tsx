import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Sparkles, Plus, X, Upload, Image as ImageIcon, Monitor, Copy, Check, ExternalLink } from "lucide-react";
import { createDecartClient, models } from "@decartai/sdk";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getDecartKey } from "@/lib/decart.functions";
import { startBroadcaster } from "@/lib/stream-broadcast";

const OUTPUT_URL = "lumify-stream-ai.lovable.app/output";


export const Route = createFileRoute("/_app/stream")({
  component: StreamPage,
});

const PRESETS = ["Cartoon", "Anime", "Oil Painting", "Cyberpunk", "Neon Glow", "Sketch"];
const RATE = 2; // credits/sec
const NAIRA_PER_CREDIT = 23;
const MIN_CREDITS_TO_START = 10;
// Decart API key is fetched at stream start from an authenticated server function.

const buildPrompt = (preset: string | null) =>
  preset ? `Transform into this character in ${preset} style` : "Transform into this character";

function StreamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const decartClientRef = useRef<Awaited<ReturnType<ReturnType<typeof createDecartClient>["realtime"]["connect"]>> | null>(null);
  const broadcasterStopRef = useRef<(() => void) | null>(null);
  const [copied, setCopied] = useState(false);

  const copyObsUrl = async () => {
    try {
      await navigator.clipboard.writeText(`https://${OUTPUT_URL}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [duration, setDuration] = useState(0);
  const [credits, setCredits] = useState(0);
  const [startingCredits, setStartingCredits] = useState(0);
  const [used, setUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showOutOfCredits, setShowOutOfCredits] = useState(false);

  const creditsRef = useRef(0);
  const usedRef = useRef(0);
  const durationRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("credits")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const bal = data?.balance ?? 0;
        setCredits(bal);
        setStartingCredits(bal || 1);
        creditsRef.current = bal;
      });
  }, [user]);

  useEffect(() => {
    return () => {
      teardownStream();
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Credit tick loop
  useEffect(() => {
    if (!streaming || !user) return;
    const id = setInterval(async () => {
      const { data, error: rpcErr } = await supabase.rpc("deduct_credits", {
        p_credits: RATE,
        p_amount: RATE * NAIRA_PER_CREDIT,
        p_description: undefined,
        p_log_transaction: false,
      });
      if (rpcErr) {
        console.error("deduct_credits failed", rpcErr);
        await endStream(false);
        return;
      }
      const newBalance = typeof data === "number" ? data : 0;
      creditsRef.current = newBalance;
      usedRef.current = usedRef.current + RATE;
      durationRef.current = durationRef.current + 1;
      setCredits(newBalance);
      setUsed(usedRef.current);
      setDuration(durationRef.current);

      if (newBalance <= 0) {
        await endStream(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [streaming, user]);

  const teardownStream = () => {
    try {
      broadcasterStopRef.current?.();
    } catch (e) {
      console.error("Broadcaster stop error", e);
    }
    broadcasterStopRef.current = null;
    try {
      decartClientRef.current?.disconnect?.();
    } catch (e) {
      console.error("Decart disconnect error", e);
    }
    decartClientRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (inputVideoRef.current) inputVideoRef.current.srcObject = null;
    if (outputVideoRef.current) outputVideoRef.current.srcObject = null;
  };

  const applyReference = async (preset: string | null, image: File | null) => {
    if (!decartClientRef.current || !image) return;
    try {
      await decartClientRef.current.set({
        prompt: buildPrompt(preset),
        image,
        enhance: true,
      } as never);
    } catch (e) {
      console.error("Decart set error", e);
    }
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!/image\/(jpeg|jpg|png)/i.test(file.type)) {
      setError("Please upload a JPG or PNG image");
      return;
    }
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReferenceImage(file);
    setReferenceUrl(URL.createObjectURL(file));
    setError(null);
    if (streaming) applyReference(selectedPreset, file);
  };

  const start = async () => {
    setError(null);
    if (!user) return;

    if (!referenceImage) {
      setError("Please upload a reference image first");
      return;
    }

    const { data } = await supabase
      .from("credits")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle();
    const bal = data?.balance ?? 0;
    if (bal < MIN_CREDITS_TO_START) {
      setError("Insufficient credits, please top up");
      return;
    }

    setConnecting(true);

    let stream: MediaStream;
    try {
      const model = models.realtime("lucy-2.1");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { frameRate: model.fps, width: model.width, height: model.height },
        audio: false,
      });
    } catch (e) {
      console.error(e);
      setConnecting(false);
      setError("Camera access was denied. Please allow camera access in your browser to start streaming.");
      return;
    }
    mediaStreamRef.current = stream;
    if (inputVideoRef.current) {
      inputVideoRef.current.srcObject = stream;
      inputVideoRef.current.play().catch(() => {});
    }

    try {
      const { apiKey } = await getDecartKey();
      const model = models.realtime("lucy-2.1");
      const client = createDecartClient({ apiKey });
      const realtimeClient = await client.realtime.connect(stream, {
        model,
        onRemoteStream: (transformedStream: MediaStream) => {
          if (outputVideoRef.current) {
            outputVideoRef.current.srcObject = transformedStream;
            outputVideoRef.current.play().catch(() => {});
          }
        },
      });
      decartClientRef.current = realtimeClient;

      const photo = fileInputRef.current?.files?.[0] ?? referenceImage;
      await realtimeClient.set({
        prompt: buildPrompt(selectedPreset),
        image: photo,
        enhance: true,
      } as never);
    } catch (e) {
      console.error("Decart connect failed", e);
      teardownStream();
      setConnecting(false);
      setError("Failed to connect to the AI transformation service. Please try again.");
      return;
    }

    setCredits(bal);
    setStartingCredits(bal);
    creditsRef.current = bal;
    usedRef.current = 0;
    durationRef.current = 0;
    setUsed(0);
    setDuration(0);
    setConnecting(false);
    setStreaming(true);
  };

  const endStream = async (outOfCredits = false) => {
    teardownStream();
    setStreaming(false);

    const totalUsed = usedRef.current;
    const totalSec = durationRef.current;
    if (user && totalUsed > 0) {
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      // Log a usage transaction (0 credits deducted since they were already deducted per-tick)
      await supabase.rpc("log_usage_transaction", {
        p_credits: totalUsed,
        p_amount: totalUsed * NAIRA_PER_CREDIT,
        p_description: `Stream session — ${mins} min ${secs} sec`,
      });
    }
    if (outOfCredits) setShowOutOfCredits(true);
  };

  const stop = () => {
    endStream(false);
  };

  const selectPreset = (p: string) => {
    const next = selectedPreset === p ? null : p;
    setSelectedPreset(next);
    setError(null);
    if (streaming) applyReference(next, referenceImage);
  };

  const clearReference = () => {
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReferenceImage(null);
    setReferenceUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const mmss = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const pct = startingCredits > 0 ? Math.max(0, Math.min(100, (credits / startingCredits) * 100)) : 0;
  const cost = used * NAIRA_PER_CREDIT;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl">Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload a reference image and watch your camera transform in real time.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel label="Your Camera">
              <video ref={inputVideoRef} muted playsInline className="h-full w-full object-cover bg-black" />
              {!streaming && <PanelEmpty hint="Camera off" />}
              {streaming && (
                <div className="absolute top-3 right-3 z-10 rounded-md bg-background/80 backdrop-blur px-2 py-1 text-xs font-mono text-primary">
                  {mmss(duration)}
                </div>
              )}
            </Panel>
            <Panel label="AI Output" accent>
              <video ref={outputVideoRef} muted playsInline className="h-full w-full object-cover bg-black" />
              {!streaming && <PanelEmpty hint="Waiting for stream" />}
              {connecting && (
                <div className="absolute inset-0 grid place-items-center bg-black/60">
                  <div className="text-center">
                    <Sparkles className="h-10 w-10 mx-auto text-primary animate-pulse" />
                    <div className="mt-2 text-xs text-muted-foreground">Connecting to Lucy 2.1…</div>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-2">Reference Image</label>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />

            {!referenceUrl ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-secondary/40"
                }`}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm">Drag and drop or <span className="text-primary">click to upload</span></div>
                <div className="text-xs text-muted-foreground">JPG or PNG</div>
              </div>
            ) : (
              <div className="flex items-center gap-4 rounded-lg border border-border bg-background/50 p-3">
                <img src={referenceUrl} alt="Reference" className="h-20 w-20 rounded-md object-cover border border-border" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium truncate">
                    <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                    <span className="truncate">{referenceImage?.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {referenceImage ? `${(referenceImage.size / 1024).toFixed(0)} KB` : ""}
                    {streaming && <span className="ml-2 text-primary">• Live</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs rounded border border-border px-2 py-1 hover:bg-secondary"
                    >
                      Change
                    </button>
                    {!streaming && (
                      <button
                        onClick={clearReference}
                        className="text-xs rounded border border-border px-2 py-1 hover:bg-secondary text-muted-foreground"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Style (optional)</div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => selectPreset(p)}
                    className={`rounded-full border px-3 py-1 text-xs ${selectedPreset === p ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <button onClick={start} disabled={streaming || connecting} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                <Play className="h-4 w-4" /> {connecting ? "Connecting…" : "Start Stream"}
              </button>
              <button onClick={stop} disabled={!streaming} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50">
                <Square className="h-4 w-4" /> Stop
              </button>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <SidePanel title="Credits Remaining">
            <div className="text-3xl font-display text-primary">{credits.toLocaleString()}</div>
            <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary transition-all duration-700 ease-linear" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">≈ {mmss(Math.floor(credits / RATE))} of streaming left</div>
          </SidePanel>

          <SidePanel title="Session Info">
            <Row k="Model" v="Lucy 2.1" />
            <Row k="Rate" v={`${RATE} credits/sec`} />
            <Row k="Quality" v="720p" />
            <Row k="Status" v={
              <span className="inline-flex items-center gap-1.5 text-primary">
                <span className={`h-1.5 w-1.5 rounded-full ${streaming ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                {streaming ? "Live" : "Idle"}
              </span>
            } />
          </SidePanel>

          <SidePanel title="This Session">
            <Row k="Duration" v={mmss(duration)} />
            <Row k="Credits Used" v={used.toLocaleString()} />
            <Row k="Cost so far" v={`₦${cost.toLocaleString()}`} />
          </SidePanel>

          <Link to="/credits" className="flex items-center justify-center gap-2 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Top Up Credits
          </Link>
        </aside>
      </div>

      {showOutOfCredits && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur p-4">
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <button
              onClick={() => setShowOutOfCredits(false)}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-xl font-display">Credits finished</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Top up to continue streaming.
            </p>
            <button
              onClick={() => {
                setShowOutOfCredits(false);
                navigate({ to: "/credits" });
              }}
              className="mt-5 inline-flex items-center justify-center gap-2 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Top Up Credits
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative rounded-xl border ${accent ? "border-primary/40" : "border-border"} bg-card overflow-hidden aspect-video`}>
      <div className="absolute top-3 left-3 z-10 rounded-md bg-background/70 backdrop-blur px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
function PanelEmpty({ hint }: { hint: string }) {
  return <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">{hint}</div>;
}
function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
