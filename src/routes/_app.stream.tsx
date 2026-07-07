import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Sparkles, Plus, X, Upload, Image as ImageIcon, Monitor, Copy, Check, ExternalLink, Clock, Radio, AlertTriangle, Info, ChevronDown, Camera as CameraIcon } from "lucide-react";
import { createDecartClient, models } from "@decartai/sdk";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getDecartKey } from "@/lib/decart.functions";
import { STREAMING_PAUSED, STREAMING_PAUSED_MESSAGE } from "@/lib/maintenance";
import { useMaintenanceMode, MAINTENANCE_STREAMING_MESSAGE } from "@/hooks/use-maintenance-mode";
import { startBroadcaster } from "@/lib/stream-broadcast";
import { getMyStreamToken } from "@/lib/stream-token.functions";
import { startSessionRecorder, logStreamEvent, uploadSwapImage, type RecorderHandle } from "@/lib/stream-recorder";
import { getStoredSupabaseAccessToken } from "@/lib/supabase-session-storage";

const OUTPUT_ORIGIN = "https://lumifylive.com";


export const Route = createFileRoute("/_app/stream")({
  component: StreamPage,
});

const PRESETS = ["Cartoon", "Anime", "Oil Painting", "Cyberpunk", "Neon Glow", "Sketch"];
const RATE = 2; // credits/sec
const NAIRA_PER_CREDIT = 23;
const MIN_CREDITS_TO_START = 10;
const LOW_BALANCE_SECONDS = 60; // warn when ~1 min of stream time left
// Decart API key is fetched at stream start from an authenticated server function.

const REALISM_KEYWORDS = "photorealistic, natural human skin texture, realistic lighting, high detail, lifelike";

const buildPrompt = (
  preset: string | null,
  mode: "realistic" | "stylized",
  realism: number,
) => {
  if (mode === "realistic") {
    return `Transform into this character while keeping a natural, human appearance. Strength ${realism}/10. ${REALISM_KEYWORDS}. Keep transformations subtle and natural, avoid cartoon or anime effects.`;
  }
  return preset
    ? `Transform into this character in ${preset} style.`
    : "Transform into this character.";
};



// Human-friendly time-left formatter: "7 min 30 sec", "45 sec", "1 hr 5 min"
const formatTimeLeft = (totalSec: number) => {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s} sec`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} hr ${m} min`;
  if (m < 10) return `${m} min ${sec} sec`;
  return `${m} min`;
};

function StreamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { enabled: maintenanceOn } = useMaintenanceMode();
  const streamingPaused = STREAMING_PAUSED || maintenanceOn;
  const streamingPausedMessage = maintenanceOn ? MAINTENANCE_STREAMING_MESSAGE : STREAMING_PAUSED_MESSAGE;
  const inputVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const decartClientRef = useRef<Awaited<ReturnType<ReturnType<typeof createDecartClient>["realtime"]["connect"]>> | null>(null);
  const broadcasterStopRef = useRef<(() => void) | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [copied, setCopied] = useState(false);
  const [streamToken, setStreamToken] = useState<string | null>(null);

  const obsUrl = streamToken ? `${OUTPUT_ORIGIN}/output?token=${streamToken}` : "";

  const copyObsUrl = async () => {
    if (!obsUrl) return;
    try {
      await navigator.clipboard.writeText(obsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  useEffect(() => {
    if (!user) return;
    getMyStreamToken()
      .then(({ token }) => token && setStreamToken(token))
      .catch(() => {});
  }, [user]);

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
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [mode, setMode] = useState<"realistic" | "stylized">("realistic");
  const [realism, setRealism] = useState<number>(8);

  const creditsRef = useRef(0);
  const usedRef = useRef(0);
  const durationRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false); // re-entry guard for start()
  const lastTickAtRef = useRef<number>(0); // wall-clock anchor for metering
  const fractionalSecRef = useRef(0); // carries sub-second remainder between ticks
  const accessTokenRef = useRef<string | null>(null); // for keepalive end-session beacon
  const streamingRef = useRef(false);

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
      // React unmount (route nav): tear down peer AND finalize session in DB.
      if (streamingRef.current) {
        endStream(false).catch(() => {});
      } else {
        teardownStream();
      }
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab close / refresh / browser crash: synchronously disconnect the Decart
  // peer and mark the DB session ended via a keepalive fetch (regular
  // supabase-js calls do NOT survive unload).
  useEffect(() => {
    const sendEndBeacon = () => {
      const sid = sessionIdRef.current;
      const token = accessTokenRef.current;
      if (!sid || !token) return;
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/stream_sessions?id=eq.${sid}`;
        const body = JSON.stringify({
          ended_at: new Date().toISOString(),
          credits_used: usedRef.current,
        });
        // keepalive lets the request finish after the page is gone.
        fetch(url, {
          method: "PATCH",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
            Authorization: `Bearer ${token}`,
            Prefer: "return=minimal",
          },
          body,
        }).catch(() => {});
      } catch {}
    };

    const handleUnload = () => {
      if (!streamingRef.current) return;
      // Tear down peer + tracks synchronously so Decart stops billing now.
      try {
        decartClientRef.current?.disconnect();
      } catch {}
      try {
        broadcasterStopRef.current?.();
      } catch {}
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      sendEndBeacon();
    };

    // pagehide covers tab close, refresh, and bfcache eviction across browsers.
    // beforeunload is a belt-and-suspenders fallback (some mobile browsers).
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  // Enumerate available cameras
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;

    const loadCameras = async () => {
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let videoInputs = devices.filter((d) => d.kind === "videoinput");
        if (videoInputs.length > 0 && videoInputs.every((d) => !d.label)) {
          try {
            const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            tmp.getTracks().forEach((t) => t.stop());
            devices = await navigator.mediaDevices.enumerateDevices();
            videoInputs = devices.filter((d) => d.kind === "videoinput");
          } catch {}
        }
        setCameras(videoInputs);
        setSelectedCameraId((prev) => prev || videoInputs[0]?.deviceId || "");
      } catch (e) {
        console.error("enumerateDevices failed", e);
      }
    };

    loadCameras();
    navigator.mediaDevices.addEventListener?.("devicechange", loadCameras);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", loadCameras);
  }, []);

  const findPeerConnection = (): RTCPeerConnection | null => {
    const client = decartClientRef.current as unknown as Record<string, unknown> | null;
    if (!client) return null;
    const seen = new Set<unknown>();
    const walk = (obj: unknown, depth: number): RTCPeerConnection | null => {
      if (!obj || depth > 4 || seen.has(obj)) return null;
      if (typeof obj !== "object") return null;
      seen.add(obj);
      if (typeof RTCPeerConnection !== "undefined" && obj instanceof RTCPeerConnection) return obj;
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        try {
          const found = walk((obj as Record<string, unknown>)[key], depth + 1);
          if (found) return found;
        } catch {}
      }
      return null;
    };
    return walk(client, 0);
  };

  const handleCameraChange = async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    if (!mediaStreamRef.current) return;

    try {
      const model = models.realtime("lucy-2.1");
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, frameRate: model.fps, width: model.width, height: model.height },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      const pc = findPeerConnection();
      if (pc) {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(newTrack);
      }

      const oldStream = mediaStreamRef.current;
      oldStream.getVideoTracks().forEach((t) => {
        oldStream.removeTrack(t);
        t.stop();
      });
      oldStream.addTrack(newTrack);
      if (inputVideoRef.current) {
        inputVideoRef.current.srcObject = oldStream;
        inputVideoRef.current.play().catch(() => {});
      }
    } catch (e) {
      console.error("Camera switch failed", e);
      setError("Could not switch to that camera.");
    }
  };


  // Wall-clock metering: charges for actual elapsed time, not assumed 1-sec
  // ticks. This is critical because browsers throttle setInterval to as
  // little as once/minute when the tab is backgrounded — without delta-based
  // accounting, the user is undercharged while Decart keeps billing us.
  const runMeterTick = async () => {
    if (!user || !streamingRef.current) return;
    const now = Date.now();
    const elapsedSec = (now - lastTickAtRef.current) / 1000;
    if (elapsedSec <= 0) return;
    lastTickAtRef.current = now;
    fractionalSecRef.current += elapsedSec;
    const wholeSec = Math.floor(fractionalSecRef.current);
    if (wholeSec < 1) return;
    fractionalSecRef.current -= wholeSec;

    const credits = wholeSec * RATE;
    const { data, error: rpcErr } = await supabase.rpc("deduct_credits", {
      p_credits: credits,
      p_amount: credits * NAIRA_PER_CREDIT,
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
    usedRef.current += credits;
    durationRef.current += wholeSec;
    setCredits(newBalance);
    setUsed(usedRef.current);
    setDuration(durationRef.current);

    if (sessionIdRef.current) {
      supabase
        .from("stream_sessions")
        .update({
          last_heartbeat: new Date().toISOString(),
          credits_used: usedRef.current,
        })
        .eq("id", sessionIdRef.current)
        .then(() => {});
    }
    if (newBalance <= 0) {
      await endStream(true);
    }
  };

  // Credit tick loop (foreground ~1s; throttled in background — runMeterTick
  // catches up using wall-clock delta).
  useEffect(() => {
    if (!streaming || !user) return;
    const id = setInterval(() => {
      runMeterTick();
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, user]);

  // When the tab becomes visible again, immediately reconcile so we charge
  // for the time spent backgrounded without waiting for the next throttled tick.
  useEffect(() => {
    if (!streaming) return;
    const onVis = () => {
      if (document.visibilityState === "visible") runMeterTick();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const teardownStream = () => {
    try {
      broadcasterStopRef.current?.();
    } catch (e) {
      console.error("Broadcaster stop error", e);
    }
    broadcasterStopRef.current = null;
    // Stop the session recorder (fires final ondataavailable and uploads).
    try {
      void recorderRef.current?.stop();
    } catch (e) {
      console.error("Recorder stop error", e);
    }
    recorderRef.current = null;
    // Decart SDK exposes `disconnect()` (verified against the type defs);
    // call it directly so a missing method becomes a visible error rather
    // than a silent leak.
    const client = decartClientRef.current;
    if (client) {
      try {
        client.disconnect();
      } catch (e) {
        console.error("Decart disconnect error", e);
      }
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
        prompt: buildPrompt(preset, mode, realism),
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
    const url = URL.createObjectURL(file);
    setReferenceImage(file);
    setReferenceUrl(url);
    setError(null);
    // Push the new swap image into the active recorder composite immediately.
    try {
      recorderRef.current?.setReferenceImage(url);
    } catch {}
    if (streaming) {
      applyReference(selectedPreset, file);
      if (user) {
        void (async () => {
          const imagePath = await uploadSwapImage({
            userId: user.id,
            sessionId: sessionIdRef.current,
            file,
          });
          await logStreamEvent({
            userId: user.id,
            sessionId: sessionIdRef.current,
            eventType: "image_change",
            imageName: file.name,
            imagePath,
            prompt: buildPrompt(selectedPreset, mode, realism),
          });
        })();
      }
    }
  };

  const start = async () => {
    setError(null);
    if (!user) return;

    // Re-entry guard: double-clicking Start, or a slow connect followed by
    // another click, must NOT open a second Decart peer.
    if (startingRef.current || streamingRef.current) return;
    startingRef.current = true;

    if (!referenceImage) {
      setError("Please upload a reference image first");
      startingRef.current = false;
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
      startingRef.current = false;
      return;
    }

    setConnecting(true);

    let stream: MediaStream;
    try {
      const model = models.realtime("lucy-2.1");
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : {}),
          frameRate: model.fps,
          width: model.width,
          height: model.height,
        },
        audio: false,
      });
    } catch (e) {
      console.error(e);
      setConnecting(false);
      startingRef.current = false;
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
          try {
            broadcasterStopRef.current?.();
            if (user) {
              broadcasterStopRef.current = startBroadcaster(user.id, transformedStream);
            }
          } catch (e) {
            console.error("Broadcaster start failed", e);
          }
          // Start session recording: webcam + AI output composite (disclosed in Terms).
          try {
            recorderRef.current?.stop();
          } catch {}
          if (user && mediaStreamRef.current) {
            recorderRef.current = startSessionRecorder({
              userId: user.id,
              sessionId: sessionIdRef.current,
              webcamStream: mediaStreamRef.current,
              outputStream: transformedStream,
              referenceImageUrl: referenceUrl,
            });
          }
        },
        // If the Decart peer drops (network loss, server-side close), stop
        // immediately so the meter doesn't keep ticking against nothing AND
        // we don't leave an orphan session locally.
        onConnectionChange: (state) => {
          if (state === "disconnected" && streamingRef.current) {
            endStream(false).catch(() => {});
          }
        },
      });
      decartClientRef.current = realtimeClient;

      const photo = fileInputRef.current?.files?.[0] ?? referenceImage;
      await realtimeClient.set({
        prompt: buildPrompt(selectedPreset, mode, realism),
        image: photo,
        enhance: true,
      } as never);
    } catch (e) {
      console.error("Decart connect failed", e);
      teardownStream();
      setConnecting(false);
      startingRef.current = false;
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (msg.includes("Another stream is already active") || msg.includes("Insufficient credits")) {
        setError(msg);
      } else {
        setError(
          `Failed to connect to the AI transformation service. This is usually caused by your network or browser blocking WebRTC (common on corporate/school Wi-Fi, VPNs, or strict ad-blockers). Try: (1) a different network or mobile hotspot, (2) Chrome incognito with extensions disabled, (3) disabling VPN/ad-blocker. Technical details: ${msg || "unknown error"}`,
        );
      }
      return;
    }

    // Capture the access token so the pagehide beacon can finalize the
    // session row even after supabase-js shuts down on unload.
    try {
      accessTokenRef.current = getStoredSupabaseAccessToken();
    } catch {
      accessTokenRef.current = null;
    }

    setCredits(bal);
    setStartingCredits(bal);
    creditsRef.current = bal;
    usedRef.current = 0;
    durationRef.current = 0;
    fractionalSecRef.current = 0;
    lastTickAtRef.current = Date.now();
    setUsed(0);
    setDuration(0);
    setConnecting(false);
    streamingRef.current = true;
    setStreaming(true);
    startingRef.current = false;

    if (user) {
      const { data: sess } = await supabase.from("stream_sessions").insert({
        user_id: user.id,
      } as never).select("id").maybeSingle();
      sessionIdRef.current = (sess as { id?: string } | null)?.id ?? null;
      try {
        recorderRef.current?.setSessionId(sessionIdRef.current);
      } catch {}
      let initialImagePath: string | null = null;
      if (referenceImage) {
        initialImagePath = await uploadSwapImage({
          userId: user.id,
          sessionId: sessionIdRef.current,
          file: referenceImage,
        });
      }
      void logStreamEvent({
        userId: user.id,
        sessionId: sessionIdRef.current,
        eventType: "start",
        prompt: buildPrompt(selectedPreset, mode, realism),
        style: selectedPreset,
        mode,
        realism: mode === "realistic" ? realism : null,
        imageName: referenceImage?.name ?? null,
        imagePath: initialImagePath,
      });
    }
  };

  const endStream = async (outOfCredits = false) => {
    if (!streamingRef.current && !decartClientRef.current) {
      // Already ended (e.g. by pagehide + onConnectionChange racing). Avoid
      // double-logging the usage transaction.
      return;
    }
    streamingRef.current = false;
    teardownStream();
    setStreaming(false);
    accessTokenRef.current = null;

    const totalUsed = usedRef.current;
    const totalSec = durationRef.current;
    if (user && totalUsed > 0) {
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      await supabase.rpc("log_usage_transaction", {
        p_credits: totalUsed,
        p_amount: totalUsed * NAIRA_PER_CREDIT,
        p_description: `Stream session — ${mins} min ${secs} sec`,
      });
    }
    if (sessionIdRef.current) {
      await supabase.from("stream_sessions").update({
        ended_at: new Date().toISOString(),
        credits_used: totalUsed,
      }).eq("id", sessionIdRef.current);
      sessionIdRef.current = null;
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
    if (streaming) {
      applyReference(next, referenceImage);
      if (user) {
        void logStreamEvent({
          userId: user.id,
          sessionId: sessionIdRef.current,
          eventType: "style_change",
          style: next,
          mode,
          prompt: buildPrompt(next, mode, realism),
        });
      }
    }
  };

  useEffect(() => {
    if (streaming && referenceImage) applyReference(selectedPreset, referenceImage);
    if (streaming && user) {
      void logStreamEvent({
        userId: user.id,
        sessionId: sessionIdRef.current,
        eventType: "mode_change",
        mode,
        realism: mode === "realistic" ? realism : null,
        style: selectedPreset,
        prompt: buildPrompt(selectedPreset, mode, realism),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, realism]);




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

  const secondsLeft = Math.floor(credits / RATE);
  const timeLeftLabel = formatTimeLeft(secondsLeft);
  const lowBalance = streaming && secondsLeft > 0 && secondsLeft <= LOW_BALANCE_SECONDS;
  const preflightTime = formatTimeLeft(secondsLeft);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl">Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload a reference image and watch your camera transform in real time.</p>
      </div>

      {STREAMING_PAUSED && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-primary/30 bg-primary/10 px-5 py-4 text-sm leading-relaxed text-foreground whitespace-pre-line"
        >
          {STREAMING_PAUSED_MESSAGE}
        </div>
      )}



      {/* Prominent time-left banner */}
      <div className={`mb-6 rounded-xl border p-5 ${
        streaming
          ? lowBalance
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-primary/30 bg-primary/5"
          : "border-border bg-card"
      }`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`shrink-0 grid place-items-center h-12 w-12 rounded-lg ${
              streaming ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
            }`}>
              <Clock className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {streaming ? "Stream time left" : "Stream time available"}
              </div>
              <div className="mt-1 text-3xl md:text-4xl font-display text-foreground leading-tight">
                ≈ {timeLeftLabel}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {credits.toLocaleString()} credits · {RATE} credits/sec while streaming
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2">
            {streaming ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                <Radio className="h-3.5 w-3.5 animate-pulse" />
                Charging now · meter runs only while live
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
                <Radio className="h-3.5 w-3.5" />
                Not streaming — no credits being used
              </span>
            )}
            {!streaming && credits > 0 && (
              <span className="text-[11px] text-muted-foreground">
                Your balance gives you about <span className="text-foreground font-medium">{preflightTime}</span> of streaming.
              </span>
            )}
          </div>
        </div>

        {lowBalance && (
          <div className="mt-4 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              About 1 minute of streaming left — top up to keep going.
            </div>
            <Link
              to="/credits"
              className="shrink-0 inline-flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/30"
            >
              <Plus className="h-3 w-3" /> Top up
            </Link>
          </div>
        )}
      </div>

      {/* Realistic vs Stylized mode toggle */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Output Mode</div>
          <div className="inline-flex rounded-md border border-border bg-background/60 p-1">
            <button
              type="button"
              onClick={() => setMode("realistic")}
              className={`px-4 py-1.5 text-sm rounded ${mode === "realistic" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Realistic Mode
            </button>
            <button
              type="button"
              onClick={() => setMode("stylized")}
              className={`px-4 py-1.5 text-sm rounded ${mode === "stylized" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Stylized Mode
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground max-w-md">
            {mode === "realistic"
              ? "Keeps the person looking human and natural."
              : "Allows cartoon, anime, and other stylized effects."}
          </p>
        </div>

        {mode === "realistic" && (
          <div className="sm:w-72">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground mb-2">
              <span>Realism Strength</span>
              <span className="text-primary font-mono">{realism}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={realism}
              onChange={(e) => setRealism(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Subtle</span>
              <span>Most realistic</span>
            </div>
          </div>
        )}
      </div>


      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

        <div className="space-y-5">

          {cameras.length > 1 && (
            <div>
              <label htmlFor="camera-select" className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Select Camera
                <span
                  tabIndex={0}
                  role="img"
                  aria-label="Any 1080p camera works great. Lighting matters most — face a window or lamp."
                  title="Any 1080p camera works great. Lighting matters most — face a window or lamp."
                  className="inline-flex items-center text-muted-foreground/70 hover:text-foreground cursor-help"
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </label>
              <select
                id="camera-select"
                value={selectedCameraId}
                onChange={(e) => handleCameraChange(e.target.value)}
                className="w-full sm:w-auto min-w-[260px] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary hover:border-primary/60 transition-colors"
              >
                {cameras.map((cam, i) => (
                  <option key={cam.deviceId || i} value={cam.deviceId}>
                    {cam.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel label="Your Camera">
              <video ref={inputVideoRef} muted playsInline className="h-full w-full object-cover bg-black" />
              {!streaming && <PanelEmpty hint="Camera off" tip="Tip: face a window or lamp for the best AI output" />}
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

          <CameraTips />

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

            {mode === "stylized" ? (
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
            ) : (
              <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                Realistic Mode is on — style presets are disabled to keep the result natural and human.
              </div>
            )}





            {error && (
              <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <button
                onClick={start}
                disabled={streaming || connecting || STREAMING_PAUSED}
                title={STREAMING_PAUSED ? "Streaming is temporarily paused for maintenance" : undefined}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="h-4 w-4" /> {STREAMING_PAUSED ? "Streaming paused for maintenance" : connecting ? "Connecting…" : "Start Stream"}
              </button>
              <button onClick={stop} disabled={!streaming} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50">
                <Square className="h-4 w-4" /> Stop
              </button>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <SidePanel title="Balance">
            <div className="text-2xl font-display text-foreground">
              ≈ {timeLeftLabel}
              <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">left</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full transition-all duration-700 ease-linear ${lowBalance ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{credits.toLocaleString()} credits</div>
          </SidePanel>

          <SidePanel title="Session Info">
            <Row k="Model" v="Lucy 2.1" />
            <Row k="Rate" v={`${RATE} credits/sec`} />
            <Row k="Quality" v="720p" />
            <Row k="Status" v={
              <span className="inline-flex items-center gap-1.5 text-primary">
                <span className={`h-1.5 w-1.5 rounded-full ${streaming ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                {streaming ? "Live · charging" : "Idle · not charging"}
              </span>
            } />
          </SidePanel>

          <SidePanel title="This Session">
            <Row k="Duration" v={mmss(duration)} />
            <Row k="Credits Used" v={used.toLocaleString()} />
            <Row k="Cost so far" v={`₦${cost.toLocaleString()}`} />
          </SidePanel>

          <SidePanel title={
            <span className="inline-flex items-center gap-1.5">
              <Monitor className="h-3.5 w-3.5 text-primary" /> OBS Setup
              <span className="ml-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">Live</span>
            </span>
          }>
            <p className="text-xs text-muted-foreground -mt-1 mb-2">Pipe your AI face into OBS as a Browser Source.</p>
            <ol className="text-xs text-foreground/90 space-y-1.5 list-decimal pl-4">
              <li>Start your stream on Lumify</li>
              <li>Open OBS</li>
              <li>Click <span className="font-mono text-primary">+</span> under Sources</li>
              <li>Select <span className="font-medium">Browser Source</span></li>
              <li>Paste the URL below</li>
              <li>Set width <span className="font-mono">1280</span> height <span className="font-mono">720</span></li>
              <li>Click <span className="font-medium">OK</span> — your AI face is now in OBS</li>
            </ol>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background/60 p-2">
              <code className="flex-1 truncate text-[11px] font-mono text-muted-foreground">
                {obsUrl || "Loading your unique URL…"}
              </code>
              <button
                onClick={copyObsUrl}
                disabled={!obsUrl}
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] hover:bg-secondary disabled:opacity-50"
                title="Copy OBS URL"
              >
                {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              This URL is private to you and permanent. Regenerate it from Settings if you ever need to revoke OBS access.
            </p>
            {obsUrl && (
              <a
                href={obsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open output preview
              </a>
            )}
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
function PanelEmpty({ hint, tip }: { hint: string; tip?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground p-4">
      <div className="text-center space-y-2 max-w-[240px]">
        <div>{hint}</div>
        {tip && <div className="text-[11px] text-muted-foreground/80 leading-relaxed">{tip}</div>}
      </div>
    </div>
  );
}

function CameraTips() {
  const STORAGE_KEY = "lumify_tips_collapsed";
  const [collapsed, setCollapsed] = useState<boolean>(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "1") setCollapsed(true);
      else if (v === null && typeof window !== "undefined" && window.innerWidth < 640) setCollapsed(true);
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <CameraIcon className="h-4 w-4 text-primary" />
          Best quality tips
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {!collapsed && (
        <ul className="px-4 pb-4 space-y-2 text-xs text-muted-foreground list-disc pl-8">
          <li>Face a light source — good lighting improves AI output more than an expensive camera.</li>
          <li>Any 1080p webcam or phone camera works great. 4K adds nothing — Lumify processes video at an optimized resolution.</li>
          <li>Keep some distance between you and your background for cleaner transformations.</li>
        </ul>
      )}
    </div>
  );
}
function SidePanel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
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
