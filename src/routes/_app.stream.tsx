import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Sparkles, Plus, X, Upload, Image as ImageIcon, Monitor, Copy, Check, ExternalLink, Clock, Radio, AlertTriangle, Info, ChevronDown, Camera as CameraIcon, PictureInPicture2, Film, Repeat } from "lucide-react";
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
import { getLucyModel } from "@/lib/site-settings.functions";

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

const buildPrompt = (
  preset: string | null,
  mode: "realistic" | "stylized",
  realism: number,
  hasReference: boolean = false,
) => {
  if (mode === "realistic") {
    const base = `Keep a natural, human appearance. Strength ${realism}/10. photorealistic, natural human skin texture, realistic lighting, lifelike, high detail.`;
    return hasReference
      ? `${base} Keep transformations subtle and natural, avoid cartoon or anime effects.`
      : base;
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

  // ── Video-file input mode ───────────────────────────────────────────────
  const [inputSource, setInputSource] = useState<"camera" | "file">("camera");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFileUrl, setVideoFileUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [loopVideo, setLoopVideo] = useState(false);
  const [videoFileError, setVideoFileError] = useState<string | null>(null);
  const [dragVideoOver, setDragVideoOver] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRafRef = useRef<number | null>(null);
  const inputSourceRef = useRef<"camera" | "file">("camera");
  const loopVideoRef = useRef(false);
  useEffect(() => { inputSourceRef.current = inputSource; }, [inputSource]);
  useEffect(() => {
    loopVideoRef.current = loopVideo;
    if (inputSourceRef.current === "file" && inputVideoRef.current) {
      inputVideoRef.current.loop = loopVideo;
    }
  }, [loopVideo]);

  const creditsRef = useRef(0);
  const usedRef = useRef(0);
  const durationRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false); // re-entry guard for start()
  const lastTickAtRef = useRef<number>(0); // wall-clock anchor for metering
  const fractionalSecRef = useRef(0); // carries sub-second remainder between ticks
  const accessTokenRef = useRef<string | null>(null); // for keepalive end-session beacon
  const streamingRef = useRef(false);
  const lucyModelIdRef = useRef<string>("lucy-latest");

  // Always refetch the current Lucy model id right before starting/restarting
  // a session so an admin toggle in Inventor takes effect without a page reload.
  const refreshLucyModelId = async () => {
    try {
      const r = await getLucyModel();
      if (r?.modelId) lucyModelIdRef.current = r.modelId;
    } catch { /* keep last known */ }
  };

  useEffect(() => { refreshLucyModelId(); }, []);

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
      if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
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
      await refreshLucyModelId();
      const model = models.realtime("lucy-2.1" as any);
      const fps = Number.isFinite(Number(model.fps)) ? Number(model.fps) : 25;
      const width = Number.isFinite(Number(model.width)) ? Number(model.width) : 1280;
      const height = Number.isFinite(Number(model.height)) ? Number(model.height) : 720;
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          frameRate: { ideal: fps },
          width: { ideal: width },
          height: { ideal: height },
        },
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
    // Belt-and-braces: never charge without a session id — otherwise
    // deduct_and_mark_session can't bump stream_sessions.credits_used, which
    // makes endStream's log_usage_transaction double-charge via v_delta.
    if (!sessionIdRef.current) return;
    const now = Date.now();
    const elapsedSec = (now - lastTickAtRef.current) / 1000;
    if (elapsedSec <= 0) return;
    lastTickAtRef.current = now;
    fractionalSecRef.current += elapsedSec;
    const wholeSec = Math.floor(fractionalSecRef.current);
    if (wholeSec < 1) return;
    fractionalSecRef.current -= wholeSec;

    const credits = wholeSec * RATE;
    // Atomic: wallet deduction AND stream_sessions.credits_used bump happen in
    // one SQL transaction (Fix 2), so a crash between them can't leave the row
    // lying about how much was already charged.
    const { data, error: rpcErr } = await supabase.rpc("deduct_and_mark_session", {
      p_credits: credits,
      p_amount: credits * NAIRA_PER_CREDIT,
      p_session_id: sessionIdRef.current ?? undefined,
    });
    if (rpcErr) {
      console.error("deduct_and_mark_session failed", rpcErr);
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

  // Pause the calm app background animations while live so the GPU is dedicated to the stream.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (streaming) document.body.classList.add("stream-live");
    else document.body.classList.remove("stream-live");
    return () => document.body.classList.remove("stream-live");
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
    // Cancel the file->canvas paint loop and pause the file preview so the
    // hidden <video> stops decoding when the stream ends.
    if (canvasRafRef.current != null) {
      cancelAnimationFrame(canvasRafRef.current);
      canvasRafRef.current = null;
    }
    canvasRef.current = null;
    if (inputSourceRef.current === "file" && inputVideoRef.current) {
      try { inputVideoRef.current.pause(); } catch {}
    } else if (inputVideoRef.current) {
      inputVideoRef.current.srcObject = null;
    }
    if (outputVideoRef.current) outputVideoRef.current.srcObject = null;
  };

  // ── Video-file helpers ──────────────────────────────────────────────────
  const clearVideoFile = () => {
    if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
    setVideoFile(null);
    setVideoFileUrl(null);
    setVideoDuration(0);
    setVideoFileError(null);
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    if (inputVideoRef.current) {
      try {
        inputVideoRef.current.pause();
        inputVideoRef.current.removeAttribute("src");
        inputVideoRef.current.load();
      } catch {}
    }
  };

  const handleVideoFile = (file: File | null) => {
    if (!file) return;
    if (streaming) return;
    if (!/video\/(mp4|webm|quicktime)/i.test(file.type)) {
      setVideoFileError("Unsupported format — please use MP4, WebM, or MOV.");
      return;
    }
    if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoFileUrl(url);
    setVideoDuration(0);
    setVideoFileError(null);
    setError(null);
    const v = inputVideoRef.current;
    if (v) {
      v.srcObject = null;
      v.loop = loopVideoRef.current;
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      v.load();
    }
  };

  const changeInputSource = (src: "camera" | "file") => {
    if (streaming) return;
    setInputSource(src);
    inputSourceRef.current = src;
    setError(null);
    if (src === "camera") {
      clearVideoFile();
    } else if (inputVideoRef.current) {
      // Detach any camera preview stream so switching back-and-forth is clean.
      inputVideoRef.current.srcObject = null;
    }
  };

  const applyReference = async (preset: string | null, image: File | null) => {
    if (!decartClientRef.current || !image) return;
    try {
      await decartClientRef.current.set({
        prompt: buildPrompt(preset, mode, realism, !!image),
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
            prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage),
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

    const { data: sess } = await supabase.from("stream_sessions").insert({ user_id: user.id }).select("id").maybeSingle();
    sessionIdRef.current = sess?.id ?? null;
    try { recorderRef.current?.setSessionId(sessionIdRef.current); } catch {}

    setConnecting(true);


    let stream: MediaStream;
    // Resolve the model dims/fps up-front — used by both branches so the
    // canvas-captured file stream matches the camera path exactly.
    await refreshLucyModelId();
    const model = models.realtime("lucy-2.1" as any);
    const modelFps = Number.isFinite(Number(model.fps)) ? Number(model.fps) : 25;
    const modelWidth = Number.isFinite(Number(model.width)) ? Number(model.width) : 1280;
    const modelHeight = Number.isFinite(Number(model.height)) ? Number(model.height) : 720;

    if (inputSource === "file") {
      // ── Video-file path ────────────────────────────────────────────────
      if (!videoFile || !videoFileUrl) {
        setError("Please pick a video file first.");
        setConnecting(false);
        startingRef.current = false;
        return;
      }
      if (videoFileError) {
        setError(videoFileError);
        setConnecting(false);
        startingRef.current = false;
        return;
      }
      const vid = inputVideoRef.current;
      if (!vid) {
        setError("Preview element not ready — try again.");
        setConnecting(false);
        startingRef.current = false;
        return;
      }
      try {
        vid.loop = loopVideoRef.current;
        vid.muted = true;
        vid.currentTime = 0;
        // Same click gesture — autoplay is allowed here.
        await vid.play();
      } catch (e: any) {
        console.error("Video file play failed", e);
        setError("Could not play this video — try MP4 (H.264).");
        setConnecting(false);
        startingRef.current = false;
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = modelWidth;
      canvas.height = modelHeight;
      const ctx = canvas.getContext("2d");
      canvasRef.current = canvas;
      const draw = () => {
        if (!canvasRef.current || !ctx) return;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, modelWidth, modelHeight);
        const vw = vid.videoWidth;
        const vh = vid.videoHeight;
        if (vw > 0 && vh > 0) {
          const sc = Math.min(modelWidth / vw, modelHeight / vh);
          const dw = vw * sc;
          const dh = vh * sc;
          const dx = (modelWidth - dw) / 2;
          const dy = (modelHeight - dh) / 2;
          try { ctx.drawImage(vid, dx, dy, dw, dh); } catch {}
        }
        canvasRafRef.current = requestAnimationFrame(draw);
      };
      draw();
      try {
        stream = (canvas as unknown as HTMLCanvasElement).captureStream(modelFps);
      } catch (e: any) {
        console.error("canvas.captureStream failed", e);
        if (canvasRafRef.current != null) cancelAnimationFrame(canvasRafRef.current);
        canvasRafRef.current = null;
        canvasRef.current = null;
        setError("Your browser can't capture the video for streaming. Try the latest Chrome.");
        setConnecting(false);
        startingRef.current = false;
        return;
      }
    } else {
      // ── Camera path (unchanged behaviour) ──────────────────────────────
      try {
        const baseVideo: MediaTrackConstraints = {
          ...(selectedCameraId ? { deviceId: { ideal: selectedCameraId } } : {}),
          frameRate: { ideal: modelFps },
          width: { ideal: modelWidth },
          height: { ideal: modelHeight },
        };

        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: baseVideo, audio: false });
        } catch (inner: any) {
          if (inner?.name === "OverconstrainedError" || inner?.name === "NotReadableError" || inner?.name === "AbortError") {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          } else {
            throw inner;
          }
        }
      } catch (e: any) {
        console.error("getUserMedia failed", e?.name, e?.message, e);
        setConnecting(false);
        startingRef.current = false;
        const name = e?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError("Camera access was denied. Please allow camera access in your browser settings, then reload the page.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setError("No compatible camera was found. Try selecting a different camera from the dropdown.");
        } else if (name === "NotReadableError") {
          setError("Your camera is already in use by another app (Zoom, OBS, Teams, etc.). Close it and try again.");
        } else {
          setError(`Could not start camera: ${e?.message || name || "unknown error"}. Try reloading the page.`);
        }
        return;
      }
    }

    mediaStreamRef.current = stream;
    if (inputSource === "camera" && inputVideoRef.current) {
      inputVideoRef.current.srcObject = stream;
      inputVideoRef.current.play().catch(() => {});
    }



    try {
      const { apiKey } = await getDecartKey();
      await refreshLucyModelId();
      const model = models.realtime("lucy-2.1" as any);
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
            if (user && streamToken) {
              broadcasterStopRef.current = startBroadcaster(streamToken, transformedStream);
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
        prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage),
        image: photo,
        enhance: true,
      } as never);
    } catch (e) {
      console.error("Decart connect failed", e);
      teardownStream();
      setConnecting(false);
      startingRef.current = false;
      if (sessionIdRef.current) {
        const sid = sessionIdRef.current;
        sessionIdRef.current = null;
        void supabase.from("stream_sessions").update({ ended_at: new Date().toISOString() } as never).eq("id", sid);
      }
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (msg.includes("Insufficient credits")) {
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

    // sessionIdRef was set up-front by start_stream_session() before Decart
    // connected. Just record the initial image + start event now.
    if (user) {
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
        prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage),
        style: selectedPreset,
        mode,
        realism: mode === "realistic" ? realism : null,
        imageName: referenceImage?.name ?? null,
        imagePath: initialImagePath,
      });
    }

    streamingRef.current = true;
    setStreaming(true);
    startingRef.current = false;
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
        p_session_id: sessionIdRef.current ?? undefined,
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
          prompt: buildPrompt(next, mode, realism, !!referenceImage),
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
        prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage),
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
  const cost = used * NAIRA_PER_CREDIT;

  const secondsLeft = Math.floor(credits / RATE);
  const timeLeftLabel = formatTimeLeft(secondsLeft);
  // Meter represents how much of a 10-minute comfortable buffer remains.
  const bufferPct = Math.max(0, Math.min(100, (secondsLeft / 600) * 100));
  const underTenMin = secondsLeft > 0 && secondsLeft < 600;
  const lowBalance = streaming && secondsLeft > 0 && secondsLeft <= LOW_BALANCE_SECONDS;
  const preflightTime = formatTimeLeft(secondsLeft);

  // Video-file cost/duration derived values.
  const videoCredits = Math.max(0, Math.ceil(videoDuration * RATE));
  const videoAffordSec = Math.floor(credits / RATE);
  const videoOverBudget =
    inputSource === "file" && videoDuration > 0 && videoCredits > credits;

  return <FilmSet
    user={user}
    streaming={streaming}
    connecting={connecting}
    inputSource={inputSource}
    changeInputSource={changeInputSource}
    cameras={cameras}
    selectedCameraId={selectedCameraId}
    handleCameraChange={handleCameraChange}
    mode={mode}
    setMode={setMode}
    realism={realism}
    setRealism={setRealism}
    referenceImage={referenceImage}
    referenceUrl={referenceUrl}
    fileInputRef={fileInputRef}
    handleFile={handleFile}
    clearReference={clearReference}
    selectedPreset={selectedPreset}
    selectPreset={selectPreset}
    videoFile={videoFile}
    videoFileUrl={videoFileUrl}
    videoFileInputRef={videoFileInputRef}
    handleVideoFile={handleVideoFile}
    clearVideoFile={clearVideoFile}
    videoDuration={videoDuration}
    videoCredits={videoCredits}
    videoOverBudget={videoOverBudget}
    videoAffordSec={videoAffordSec}
    videoFileError={videoFileError}
    loopVideo={loopVideo}
    setLoopVideo={setLoopVideo}
    dragVideoOver={dragVideoOver}
    setDragVideoOver={setDragVideoOver}
    error={error}
    credits={credits}
    used={used}
    cost={cost}
    secondsLeft={secondsLeft}
    bufferPct={bufferPct}
    underTenMin={underTenMin}
    timeLeftLabel={timeLeftLabel}
    mmss={mmss}
    duration={duration}
    inputVideoRef={inputVideoRef}
    outputVideoRef={outputVideoRef}
    setVideoDuration={setVideoDuration}
    setVideoFileError={setVideoFileError}
    streamingRef={streamingRef}
    inputSourceRef={inputSourceRef}
    loopVideoRef={loopVideoRef}
    endStream={endStream}
    start={start}
    stop={stop}
    obsUrl={obsUrl}
    copyObsUrl={copyObsUrl}
    copied={copied}
    showOutOfCredits={showOutOfCredits}
    setShowOutOfCredits={setShowOutOfCredits}
    navigate={navigate}
  />;
}

function Panel({ label, accent, streaming, children }: { label: string; accent?: boolean; streaming?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden aspect-[16/10] bg-[#0b0d0a]"
      style={{
        borderRadius: 10,
        border: `1px solid ${accent ? "#2e3520" : "#262b1c"}`,
        boxShadow: accent ? "inset 0 0 0 1.5px rgba(198,242,78,0.2)" : undefined,
      }}
    >
      {/* corner label chip */}
      <div className={`absolute top-3 left-3 z-[4] inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
        accent
          ? "border border-[color:var(--primary)] bg-[color:var(--accent-soft)] text-primary"
          : "border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 text-[color:var(--muted-foreground)]"
      }`}>
        {label}
      </div>
      {/* HUD chips top-right */}
      <div className="absolute top-3 right-3 z-[4] flex items-center gap-1.5">
        {accent ? (
          <>
            <span className="rounded-md border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-widest text-primary">
              Lucy 2.5
            </span>
            <span className="rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-[color:var(--muted-foreground)]">
              &lt; 120 ms
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-widest text-[color:var(--destructive)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--destructive)] animate-pulse" /> Rec
            </span>
            <span className="rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-[color:var(--muted-foreground)]">
              720p
            </span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

function SilhouetteBg({ variant }: { variant: "camera" | "output" }) {
  const isOutput = variant === "output";
  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Base radial */}
      <div
        className="absolute inset-0"
        style={{
          background: isOutput
            ? "radial-gradient(70% 70% at 50% 40%, rgba(198,242,78,0.18), #0b0d0a 82%)"
            : "radial-gradient(70% 70% at 50% 40%, #1c2016 0%, #0b0d0a 85%)",
        }}
      />
      {/* Silhouette — fits fully inside with breathing room (no bleed) */}
      <svg
        viewBox="0 0 160 110"
        preserveAspectRatio="xMidYMax meet"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id={`stream-sil-${variant}`} x1="0" x2="0" y1="0" y2="1">
            {isOutput ? (
              <>
                <stop offset="0%" stopColor="#c6f24e" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#3a5a12" stopOpacity="0.45" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#4a5240" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#1a1e14" stopOpacity="0.8" />
              </>
            )}
          </linearGradient>
        </defs>
        {/* Head + shoulders scaled to fit inside 160x110 with margins */}
        <g transform="translate(80 58) scale(0.62) translate(-80 -55)">
          <circle
            cx="80"
            cy="40"
            r="18"
            fill={`url(#stream-sil-${variant})`}
            stroke={isOutput ? "#c6f24e" : "none"}
            strokeWidth={isOutput ? 0.6 : 0}
          />
          <path
            d="M46 100 C52 76, 70 66, 80 66 C90 66, 108 76, 114 100 Z"
            fill={`url(#stream-sil-${variant})`}
            stroke={isOutput ? "#c6f24e" : "none"}
            strokeWidth={isOutput ? 0.6 : 0}
          />
        </g>
        {isOutput && (
          <>
            {/* At most 2 sparkles, tucked into empty corners */}
            <circle cx="18" cy="20" r="0.9" fill="#c6f24e" opacity="0.85" />
            <circle cx="144" cy="24" r="0.7" fill="#c6f24e" opacity="0.7" />
          </>
        )}
      </svg>
      {!isOutput && (
        <div
          className="absolute inset-0 pointer-events-none opacity-25 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)",
          }}
        />
      )}
      {/* Scrim — guarantees text legibility over artwork */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,6,4,0.25), rgba(5,6,4,0.62))",
        }}
      />
    </div>
  );
}

function PanelEmpty({ icon, title, hint, accent }: { icon: React.ReactNode; title: string; hint?: string; accent?: boolean }) {
  return (
    <div className="absolute inset-0 z-[2] grid place-items-center p-6 text-center">
      <div className="flex flex-col items-center" style={{ gap: 8 }}>
        <div
          className={`grid place-items-center rounded-xl ${accent ? "text-primary" : "text-[color:var(--muted-foreground)]"}`}
          style={{
            width: 44,
            height: 44,
            background: accent ? "var(--accent-soft)" : "rgba(198,242,78,0.08)",
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>{title}</div>
        {hint && (
          <div style={{ fontSize: 12, color: "#6b7160", maxWidth: 230, lineHeight: 1.5 }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function CameraTips() {
  const STORAGE_KEY = "lumify_tips_collapsed";
  const [collapsed, setCollapsed] = useState<boolean>(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0") setCollapsed(false);
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
    <div className="card-surface p-0 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-[13.5px] font-semibold">
          <CameraIcon size={15} className="text-primary" />
          Best quality tips
        </span>
        <ChevronDown size={15} className={`text-[color:var(--muted-foreground)] transition-transform ${collapsed ? "" : "rotate-180"}`} />
      </button>
      {!collapsed && (
        <div className="grid gap-3 sm:grid-cols-3 px-5 pb-5">
          {[
            { t: "Light your face", d: "Face a window or lamp. Lighting matters more than the camera." },
            { t: "1080p is plenty", d: "Any 1080p webcam works. 4K adds nothing — output is optimized." },
            { t: "Step off the wall", d: "A little distance from the background gives cleaner transformations." },
          ].map((tip) => (
            <div key={tip.t} className="rounded-xl border bg-[color:var(--sidebar)] p-3">
              <div className="text-[13px] text-foreground">{tip.t}</div>
              <div className="mt-1 text-[11.5px] text-[color:var(--muted-foreground)]">{tip.d}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SidePanel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card-surface">
      <div className="eyebrow mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-[color:var(--muted-foreground)]">{k}</span>
      <span className="font-medium text-foreground">{v}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FILM-SET LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
type FilmSetProps = any;

function FilmSet(p: FilmSetProps) {
  const {
    user, streaming, connecting,
    inputSource, changeInputSource, cameras, selectedCameraId, handleCameraChange,
    mode, setMode, realism, setRealism,
    referenceImage, referenceUrl, fileInputRef, handleFile, clearReference,
    selectedPreset, selectPreset,
    videoFile, videoFileUrl, videoFileInputRef, handleVideoFile, clearVideoFile,
    videoDuration, videoCredits, videoOverBudget, videoAffordSec, videoFileError,
    loopVideo, setLoopVideo, dragVideoOver, setDragVideoOver,
    error, credits, used, cost, secondsLeft, bufferPct, underTenMin, timeLeftLabel,
    mmss, duration,
    inputVideoRef, outputVideoRef,
    setVideoDuration, setVideoFileError,
    streamingRef, inputSourceRef, loopVideoRef,
    endStream, start, stop,
    obsUrl, copyObsUrl, copied,
    showOutOfCredits, setShowOutOfCredits, navigate,
  } = p;

  // TAKE + SCENE tracking (persisted per user; SCENE resets daily)
  const [takeCount, setTakeCount] = useState(0);
  const [sceneCount, setSceneCount] = useState(1);
  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const rawT = localStorage.getItem(`lumi_take_${user.id}`);
      if (rawT) setTakeCount(parseInt(rawT, 10) || 0);
      const rawS = localStorage.getItem(`lumi_scene_${user.id}`);
      if (rawS) {
        const [d, n] = rawS.split("|");
        if (d === today) setSceneCount(parseInt(n, 10) || 1);
        else { setSceneCount(1); localStorage.setItem(`lumi_scene_${user.id}`, `${today}|1`); }
      } else {
        localStorage.setItem(`lumi_scene_${user.id}`, `${today}|1`);
      }
    } catch {}
  }, [user]);

  // Timecode HH:MM:SS:FF at 25fps — ticks while streaming, frozen at zero otherwise.
  const [timecode, setTimecode] = useState("00:00:00:00");
  useEffect(() => {
    if (!streaming) { setTimecode("00:00:00:00"); return; }
    const t0 = Date.now();
    let raf = 0;
    const FPS = 25;
    const tick = () => {
      const el = (Date.now() - t0) / 1000;
      const h = Math.floor(el / 3600);
      const m = Math.floor((el % 3600) / 60);
      const s = Math.floor(el % 60);
      const f = Math.floor((el - Math.floor(el)) * FPS);
      setTimecode(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streaming]);

  const handleAction = () => {
    if (streaming) { stop(); return; }
    // increment TAKE + SCENE on start (before the async start begins)
    if (user) {
      const nextTake = takeCount + 1;
      setTakeCount(nextTake);
      try { localStorage.setItem(`lumi_take_${user.id}`, String(nextTake)); } catch {}
      const today = new Date().toISOString().slice(0, 10);
      try {
        const rawS = localStorage.getItem(`lumi_scene_${user.id}`);
        const [d, n] = (rawS ?? "").split("|");
        const nextScene = d === today ? (parseInt(n, 10) || 0) + 1 : 1;
        setSceneCount(nextScene);
        localStorage.setItem(`lumi_scene_${user.id}`, `${today}|${nextScene}`);
      } catch {}
    }
    start();
  };

  const mono: React.CSSProperties = { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" };
  const cellLabel: React.CSSProperties = {
    ...mono,
    fontSize: 9,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#6b7160",
    lineHeight: 1,
  };
  const cellValue: React.CSSProperties = {
    fontFamily: "var(--font-display)",
    fontSize: 17,
    lineHeight: 1,
    color: "var(--foreground)",
    marginTop: 6,
  };
  const controlLabel: React.CSSProperties = {
    ...mono,
    fontSize: 10,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#6b7160",
  };

  return (
    <div style={{ position: "relative", maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
      {/* Key-light glow (paused with body.stream-live) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -120,
          left: -160,
          width: 640,
          height: 460,
          background: "radial-gradient(closest-side, rgba(198,242,78,0.05), transparent 70%)",
          filter: "blur(30px)",
          transform: "rotate(-15deg)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4" style={{ marginBottom: 24 }}>
        {/* Production slate */}
        <div
          className="flex flex-wrap"
          style={{ border: "1px solid #262b1c", borderRadius: 12, overflow: "hidden", background: "#14170f" }}
        >
          {[
            { l: "Production", v: <>Lum<em style={{ color: "var(--primary)", fontStyle: "italic" }}>ify</em></> },
            { l: "Scene", v: String(sceneCount).padStart(2, "0") },
            { l: "Take", v: String(takeCount).padStart(2, "0") },
            { l: "Camera", v: "Lucy 2.5" },
          ].map((c, i) => (
            <div
              key={c.l}
              style={{
                padding: "10px 16px",
                borderLeft: i === 0 ? "none" : "1px solid #1e2316",
                minWidth: 108,
              }}
            >
              <div style={cellLabel}>{c.l}</div>
              <div style={cellValue}>{c.v}</div>
            </div>
          ))}
        </div>

        {/* Film reel meter */}
        <div style={{ minWidth: 220 }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#9aa08c", display: "flex", alignItems: "center", gap: 6 }}>
            <span>Film remaining</span>
            <span>·</span>
            <span style={{ color: "var(--foreground)" }}>≈ {timeLeftLabel}</span>
            {underTenMin && (
              <span style={{ color: "var(--warning)", marginLeft: 4 }}>⚠ Short reel</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <div
              style={{
                width: 190,
                height: 8,
                borderRadius: 999,
                background: "#1e2316",
                overflow: "hidden",
                border: "1px solid #262b1c",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${bufferPct}%`,
                  background: underTenMin
                    ? "repeating-linear-gradient(90deg,#ffb75a 0 6px,#e79a3e 6px 8px)"
                    : "linear-gradient(90deg,#8fc233,#c6f24e)",
                  transition: "width 400ms ease",
                }}
              />
            </div>
            <Link
              to="/credits"
              style={{
                ...mono,
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--muted-foreground)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "6px 12px",
              }}
            >
              + More film
            </Link>
          </div>
        </div>
      </div>

      {STREAMING_PAUSED && (
        <div role="status" className="mb-4 rounded-2xl border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-5 py-4 text-[14px] whitespace-pre-line relative z-[1]">
          {STREAMING_PAUSED_MESSAGE}
        </div>
      )}

      {/* ── Viewfinder ─────────────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden"
        style={{
          aspectRatio: "16 / 8.4",
          borderRadius: 14,
          border: "1px solid #2e3520",
          boxShadow: "inset 0 0 0 1.5px rgba(198,242,78,.12)",
          background: "radial-gradient(80% 70% at 50% 45%, #191e0e 0%, #0c0e08 85%)",
        }}
      >
        {/* AI output video (fills when live) */}
        <video
          ref={outputVideoRef}
          muted
          playsInline
          className="absolute inset-0 z-[1] h-full w-full"
          style={{ objectFit: "cover" }}
        />

        {/* Rule-of-thirds grid */}
        <svg aria-hidden className="absolute inset-0 z-[3] h-full w-full pointer-events-none">
          <line x1="33.33%" y1="0" x2="33.33%" y2="100%" stroke="rgba(198,242,78,.07)" strokeWidth="1" />
          <line x1="66.66%" y1="0" x2="66.66%" y2="100%" stroke="rgba(198,242,78,.07)" strokeWidth="1" />
          <line x1="0" y1="33.33%" x2="100%" y2="33.33%" stroke="rgba(198,242,78,.07)" strokeWidth="1" />
          <line x1="0" y1="66.66%" x2="100%" y2="66.66%" stroke="rgba(198,242,78,.07)" strokeWidth="1" />
        </svg>

        {/* Corner brackets */}
        {[
          { top: 14, left: 14, borders: { borderTop: 1, borderLeft: 1 } },
          { top: 14, right: 14, borders: { borderTop: 1, borderRight: 1 } },
          { bottom: 14, left: 14, borders: { borderBottom: 1, borderLeft: 1 } },
          { bottom: 14, right: 14, borders: { borderBottom: 1, borderRight: 1 } },
        ].map((c, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute z-[3] pointer-events-none"
            style={{
              width: 30, height: 30,
              top: (c as any).top, left: (c as any).left,
              right: (c as any).right, bottom: (c as any).bottom,
              borderTopWidth: (c.borders as any).borderTop ? 1.5 : 0,
              borderRightWidth: (c.borders as any).borderRight ? 1.5 : 0,
              borderBottomWidth: (c.borders as any).borderBottom ? 1.5 : 0,
              borderLeftWidth: (c.borders as any).borderLeft ? 1.5 : 0,
              borderStyle: "solid",
              borderColor: "rgba(198,242,78,.4)",
            }}
          />
        ))}

        {/* Center crosshair */}
        <div
          aria-hidden
          className="absolute z-[3] pointer-events-none"
          style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 26, height: 26 }}
        >
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(198,242,78,.5)" }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(198,242,78,.5)" }} />
        </div>

        {/* Top-left A-CAM */}
        <div className="absolute top-3 left-3 z-[5]" style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
          A-CAM ▸ AI Output
        </div>

        {/* Top-right STANDBY / REC */}
        <div className="absolute top-3 right-3 z-[5]" style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" }}>
          {streaming ? (
            <span style={{ color: "var(--destructive)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: "var(--destructive)" }} />
              REC
            </span>
          ) : (
            <span style={{ color: "#6b7160" }}>Standby</span>
          )}
        </div>

        {/* Timecode top-center */}
        <div
          className="absolute z-[5]"
          style={{
            top: 12, left: "50%", transform: "translateX(-50%)",
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            ...mono,
            fontSize: 15,
            letterSpacing: "0.18em",
            color: "var(--foreground)",
          }}
        >
          {timecode.slice(0, 8)}
          <span style={{ color: "var(--primary)" }}>{timecode.slice(8)}</span>
        </div>

        {/* Empty state */}
        {!streaming && (
          <>
            {/* silhouette low in frame */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 z-[1] pointer-events-none"
              style={{ height: "55%", opacity: 0.35 }}
            >
              <svg viewBox="0 0 200 110" preserveAspectRatio="xMidYMax meet" className="h-full w-full">
                <defs>
                  <linearGradient id="fs-sil" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#4a5240" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#1a1e14" stopOpacity="0.9" />
                  </linearGradient>
                </defs>
                <g transform="translate(100 90) scale(0.55) translate(-100 -90)">
                  <circle cx="100" cy="55" r="22" fill="url(#fs-sil)" />
                  <path d="M55 130 C63 100, 85 88, 100 88 C115 88, 137 100, 145 130 Z" fill="url(#fs-sil)" />
                </g>
              </svg>
            </div>
            <div aria-hidden className="absolute inset-0 z-[2] pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(5,6,4,0.1), rgba(5,6,4,0.5))" }} />
            <div className="absolute inset-0 z-[4] grid place-items-center text-center pointer-events-none px-4">
              <div>
                <div className="font-display" style={{ fontSize: 22, lineHeight: 1.2, color: "var(--foreground)" }}>Quiet on set</div>
                <div style={{ fontSize: 12.5, color: "#9aa08c", marginTop: 8 }}>
                  Press ACTION and Lucy 2.5 puts your character in frame
                </div>
              </div>
            </div>
          </>
        )}

        {connecting && (
          <div className="absolute inset-0 z-[6] grid place-items-center bg-black/70">
            <div className="text-center">
              <Sparkles className="h-10 w-10 mx-auto text-primary animate-pulse" />
              <div className="mt-2 text-[12px] text-[color:var(--muted-foreground)]">Connecting to Lucy…</div>
            </div>
          </div>
        )}

        {/* Pop-out (admin only, kept) */}
        {streaming && user?.email === "brightsolutionslab@gmail.com" && (
          <button
            type="button"
            onClick={() => {
              if (!obsUrl) return;
              window.open(obsUrl, "lumify-ai-output",
                "popup=yes,width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,noopener,noreferrer");
            }}
            disabled={!obsUrl}
            title="Open AI output in a new window"
            className="absolute bottom-3 right-3 z-[6] inline-flex items-center gap-1.5 rounded-md border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary hover:bg-[color:var(--primary)]/20 transition disabled:opacity-50"
            style={mono}
          >
            <ExternalLink size={12} /> Pop out
          </button>
        )}

        {/* Behind the scenes PiP */}
        <div
          className="absolute z-[5] overflow-hidden"
          style={{
            bottom: 16, left: 16, width: 186, aspectRatio: "16 / 10",
            borderRadius: 10, border: "1px solid #262b1c",
            background: "#0b0d0a",
            boxShadow: "0 18px 40px -18px rgba(0,0,0,.85)",
          }}
        >
          <video
            ref={inputVideoRef}
            muted playsInline
            className="absolute inset-0 h-full w-full"
            style={{ objectFit: "cover", background: "#000" }}
            onLoadedMetadata={(e) => {
              if (inputSourceRef.current === "file") setVideoDuration(e.currentTarget.duration || 0);
            }}
            onError={() => {
              if (inputSourceRef.current === "file" && videoFileUrl) {
                setVideoFileError("This video can't play in the browser — try MP4 (H.264).");
              }
            }}
            onEnded={() => {
              if (inputSourceRef.current === "file" && streamingRef.current && !loopVideoRef.current) {
                endStream(false).catch(() => {});
              }
            }}
          />
          <div
            className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay"
            style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 3px)" }}
          />
          <span
            className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5"
            style={{ ...mono, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", background: "rgba(0,0,0,.6)", color: "var(--muted-foreground)" }}
          >
            Behind the scenes · You
          </span>
          {!streaming && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#6b7160" }}>Camera off</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Control slate ──────────────────────────────────────── */}
      <div
        className="relative z-[1]"
        style={{
          marginTop: 24, padding: 20, background: "#14170f",
          border: "1px solid #262b1c", borderRadius: 14,
        }}
      >
        <div className="flex flex-wrap" style={{ gap: 16, alignItems: "flex-end" }}>
          {/* CAMERA */}
          <div className="flex flex-col" style={{ gap: 8, minWidth: 205 }}>
            <span style={controlLabel}>Camera</span>
            {inputSource === "camera" ? (
              <select
                value={selectedCameraId}
                onChange={(e) => handleCameraChange(e.target.value)}
                className="rounded-lg border bg-[color:var(--sidebar)] px-3 text-[13px] focus:border-[color:var(--primary)]"
                style={{ height: 38, minWidth: 205 }}
              >
                {cameras.length === 0 && <option value="">No camera detected</option>}
                {cameras.map((cam: MediaDeviceInfo, i: number) => (
                  <option key={cam.deviceId || i} value={cam.deviceId}>{cam.label || `Camera ${i + 1}`}</option>
                ))}
              </select>
            ) : (
              <div className="segmented" style={{ height: 38 }}>
                <button type="button" disabled={streaming} data-active={false} onClick={() => changeInputSource("camera")}>
                  <CameraIcon size={12} className="inline mr-1 -mt-0.5" /> Camera
                </button>
                <button type="button" disabled={streaming} data-active={true} onClick={() => changeInputSource("file")}>
                  <Film size={12} className="inline mr-1 -mt-0.5" /> Video file
                </button>
              </div>
            )}
          </div>

          {/* INPUT source toggle (kept, shown only in camera mode) */}
          {inputSource === "camera" && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <span style={controlLabel}>Source</span>
              <div className="segmented" style={{ height: 38 }}>
                <button type="button" disabled={streaming} data-active={true} onClick={() => changeInputSource("camera")}>
                  <CameraIcon size={12} className="inline mr-1 -mt-0.5" /> Camera
                </button>
                <button type="button" disabled={streaming} data-active={false} onClick={() => changeInputSource("file")}>
                  <Film size={12} className="inline mr-1 -mt-0.5" /> Video
                </button>
              </div>
            </div>
          )}

          {/* LOOK */}
          <div className="flex flex-col" style={{ gap: 8 }}>
            <span style={controlLabel}>Look</span>
            <div className="segmented" style={{ height: 38 }}>
              <button type="button" data-active={mode === "realistic"} onClick={() => setMode("realistic")}>Realistic</button>
              <button type="button" data-active={mode === "stylized"} onClick={() => setMode("stylized")}>Stylized</button>
            </div>
          </div>

          {/* REALISM */}
          {mode === "realistic" && (
            <div className="flex flex-col flex-1" style={{ gap: 8, minWidth: 190 }}>
              <span style={controlLabel}>Realism</span>
              <div className="flex items-center gap-3" style={{ height: 38 }}>
                <input
                  type="range" min={1} max={10} step={1}
                  value={realism}
                  onChange={(e) => setRealism(Number(e.target.value))}
                  className="lime-range flex-1"
                  style={{ ["--val" as any]: `${((realism - 1) / 9) * 100}%`, minWidth: 190 }}
                />
                <span className="font-display text-primary text-right" style={{ width: 34, flexShrink: 0, fontSize: 15 }}>
                  {realism}/10
                </span>
              </div>
            </div>
          )}

          {/* WARDROBE */}
          <div className="flex flex-col" style={{ gap: 8 }}>
            <span style={controlLabel}>Wardrobe</span>
            <div className="flex items-center gap-2" style={{ height: 38 }}>
              <input
                ref={fileInputRef} type="file"
                accept="image/jpeg,image/png,image/jpg"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-transparent px-3 text-[color:var(--muted-foreground)] hover:text-foreground hover:border-[color:var(--primary)] transition"
                style={{ height: 38, fontSize: 12.5 }}
              >
                <Upload size={13} /> {referenceUrl ? "Change reference" : "⬆ Reference image"}
              </button>
              {referenceUrl && (
                <div className="inline-flex items-center gap-1.5 rounded-md border bg-[color:var(--sidebar)] pl-1 pr-2 py-1" style={{ maxWidth: 160 }}>
                  <img src={referenceUrl} alt="ref" className="h-6 w-6 rounded object-cover" />
                  <span className="truncate text-[11px] text-[color:var(--muted-foreground)]">{referenceImage?.name}</span>
                  {!streaming && (
                    <button onClick={clearReference} className="text-[color:var(--faint)] hover:text-[color:var(--destructive)]" aria-label="Remove">
                      <X size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stylized presets */}
        {mode === "stylized" && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((pr) => (
                <button
                  key={pr}
                  onClick={() => selectPreset(pr)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                    selectedPreset === pr
                      ? "border-[color:var(--primary)] text-primary bg-[color:var(--accent-soft)]"
                      : "border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:text-foreground"
                  }`}
                >
                  {pr}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Video file card (kept when file mode) */}
      {inputSource === "file" && (
        <div className="card-surface relative z-[1]" style={{ padding: 20, marginTop: 16 }}>
          <div className="flex items-center gap-2 mb-3">
            <Film size={14} className="text-primary" />
            <span style={controlLabel}>Video file</span>
            <span className="text-[11px] text-[color:var(--faint)]">· plays locally, never uploaded</span>
          </div>
          <input
            ref={videoFileInputRef} type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => handleVideoFile(e.target.files?.[0] ?? null)}
          />
          {!videoFileUrl ? (
            <div
              onClick={() => { if (!streaming) videoFileInputRef.current?.click(); }}
              onDragOver={(e) => { if (streaming) return; e.preventDefault(); setDragVideoOver(true); }}
              onDragLeave={() => setDragVideoOver(false)}
              onDrop={(e) => {
                if (streaming) return;
                e.preventDefault(); setDragVideoOver(false);
                handleVideoFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition-colors ${streaming ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              style={{
                borderColor: dragVideoOver ? "var(--primary)" : "var(--border)",
                background: dragVideoOver ? "var(--accent-soft)" : "transparent",
              }}
            >
              <Upload className="h-6 w-6 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-[13.5px] text-foreground">Drop a video here or <span className="text-primary">browse files</span></div>
                <div className="text-[11.5px] text-[color:var(--faint)]">MP4, WebM, or MOV · played from your device</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 rounded-xl border bg-[color:var(--sidebar)] p-3">
              <div className="grid h-16 w-16 place-items-center rounded-md border bg-black text-primary shrink-0">
                <Film size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[13.5px] truncate">
                  <span className="truncate">{videoFile?.name}</span>
                </div>
                <div className="text-[11.5px] text-[color:var(--muted-foreground)] mt-0.5">
                  {videoDuration > 0
                    ? `${mmss(Math.floor(videoDuration))} · ≈ ${videoCredits.toLocaleString()} credits`
                    : "Reading duration…"}
                  {streaming && <span className="ml-2 text-primary">• Live</span>}
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => { if (!streaming) videoFileInputRef.current?.click(); }} disabled={streaming} className="text-[11px] rounded border px-2 py-1 hover:bg-card disabled:opacity-50">Change</button>
                  {!streaming && (
                    <button onClick={clearVideoFile} className="text-[11px] rounded border px-2 py-1 hover:bg-card text-[color:var(--muted-foreground)]">Remove</button>
                  )}
                </div>
              </div>
            </div>
          )}
          {videoOverBudget && (
            <div className="mt-3 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-3 text-[12.5px] text-[color:var(--warning)]">
              <AlertTriangle size={13} className="inline mr-1" />
              Your balance covers about {mmss(Math.max(0, videoAffordSec))} of this video.
            </div>
          )}
          {videoFileError && (
            <div className="mt-3 rounded-lg border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-3 text-[12.5px] text-[color:var(--destructive)]">
              {videoFileError}
            </div>
          )}
          <label className="mt-4 flex items-start gap-3 rounded-xl border bg-[color:var(--sidebar)] p-3 cursor-pointer">
            <input type="checkbox" checked={loopVideo} onChange={(e) => setLoopVideo(e.target.checked)} className="mt-1 accent-[color:var(--primary)]" />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-[13px] text-foreground">
                <Repeat size={12} className="text-primary" /> Loop video
              </div>
              <div className="mt-0.5 text-[11.5px] text-[color:var(--muted-foreground)]">
                When off, your stream stops automatically when the video ends.
              </div>
            </div>
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 px-4 py-3 text-[13px] text-[color:var(--destructive)] relative z-[1]">
          {error}
        </div>
      )}

      {/* ── The button ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center relative z-[1]" style={{ marginTop: 32, gap: 12 }}>
        <button
          type="button"
          onClick={handleAction}
          disabled={connecting || (!streaming && (STREAMING_PAUSED || (inputSource === "file" && (!videoFile || !!videoFileError))))}
          className="disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            ...mono,
            fontSize: 14,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 700,
            padding: "16px 44px",
            borderRadius: 999,
            background: streaming ? "#ff7a6b" : "var(--primary)",
            color: streaming ? "#1a0806" : "#111406",
            border: "none",
            boxShadow: streaming
              ? "0 8px 32px -10px rgba(255,122,107,.7), 0 0 0 1px rgba(255,122,107,.35)"
              : "0 8px 32px -8px rgba(198,242,78,.6), 0 0 0 1px rgba(198,242,78,.3)",
            transition: "all 150ms ease",
          }}
        >
          {streaming ? "◼ Cut" : "▶ Action"}
        </button>
        <div style={{ ...mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7160", textAlign: "center" }}>
          Film burns at <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{RATE} cr/sec</span>
          {" "}·{" "}
          ≈ <span style={{ color: "var(--foreground)", fontWeight: 700 }}>{timeLeftLabel}</span> left on the reel
        </div>
      </div>

      {/* ── Footer HUD ─────────────────────────────────────────── */}
      <div
        className="relative z-[1] flex flex-wrap items-center justify-center"
        style={{
          ...mono,
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#6b7160",
          columnGap: 26,
          rowGap: 10,
          marginTop: 40,
          paddingTop: 20,
          borderTop: "1px solid #1e2316",
        }}
      >
        <span>Credits <span style={{ color: "var(--foreground)" }}>{credits.toLocaleString()}</span></span>
        <span>Cost <span style={{ color: "var(--foreground)" }}>₦{cost.toLocaleString()}</span></span>
        <span>
          OBS 1280×720 ·{" "}
          <button
            type="button"
            onClick={copyObsUrl}
            disabled={!obsUrl}
            style={{
              ...mono,
              color: "var(--primary)",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: obsUrl ? "pointer" : "not-allowed",
            }}
          >
            {copied ? "Copied ✓" : "Copy URL"}
          </button>
        </span>
        <span>Tip: Face a light source</span>
      </div>

      {showOutOfCredits && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur p-4">
          <div className="relative w-full max-w-md card-surface">
            <button
              onClick={() => setShowOutOfCredits(false)}
              className="absolute top-3 right-3 text-[color:var(--muted-foreground)] hover:text-foreground"
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <h2 className="font-display text-2xl">Credits finished</h2>
            <p className="mt-2 text-[13.5px] text-[color:var(--muted-foreground)]">Top up to continue streaming.</p>
            <button
              onClick={() => { setShowOutOfCredits(false); navigate({ to: "/credits" }); }}
              className="btn-primary w-full mt-5"
            >
              <Plus size={14} /> Top up credits
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
