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
  background: string = "",
) => {
  let base: string;
  if (mode === "realistic") {
    const realisticBase = `Keep a natural, human appearance. Strength ${realism}/10. photorealistic, natural human skin texture, realistic lighting, lifelike, high detail.`;
    base = hasReference
      ? `${realisticBase} Keep transformations subtle and natural, avoid cartoon or anime effects.`
      : realisticBase;
  } else {
    base = preset
      ? `Transform into this character in ${preset} style.`
      : "Transform into this character.";
  }
  const bg = background.trim();
  return bg
    ? `${base} Change the background to: ${bg}. Keep the person's face, body, and identity unchanged.`
    : base;
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
      const model = models.realtime("lucy-2.5" as any);
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
        prompt: buildPrompt(preset, mode, realism, !!image, background),
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
            prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage, background),
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
    const model = models.realtime("lucy-2.5" as any);
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
      const model = models.realtime("lucy-2.5" as any);
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
        prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage, background),
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
        prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage, background),
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
          prompt: buildPrompt(next, mode, realism, !!referenceImage, background),
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
        prompt: buildPrompt(selectedPreset, mode, realism, !!referenceImage, background),
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

  return <StudioLayout
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
// STUDIO LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
type StudioProps = any;

const MONO: React.CSSProperties = { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" };

function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9aa08c" }}>
        {children}
      </div>
      {right}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#14170f",
  border: "1px solid #262b1c",
  borderRadius: 16,
  padding: 20,
};

function Chip({ children, accent, danger }: { children: React.ReactNode; accent?: boolean; danger?: boolean }) {
  return (
    <span
      style={{
        ...MONO,
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "3px 7px",
        borderRadius: 6,
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(6px)",
        border: `1px solid ${accent ? "rgba(198,242,78,.45)" : danger ? "rgba(255,122,107,.45)" : "rgba(255,255,255,.14)"}`,
        color: accent ? "var(--primary)" : danger ? "var(--destructive)" : "var(--muted-foreground)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function StudioLayout(p: StudioProps) {
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

  const [dragOver, setDragOver] = useState(false);

  const fieldLabel: React.CSSProperties = {
    ...MONO,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#6b7160",
  };

  const truncatedUrl = obsUrl
    ? obsUrl.length > 46
      ? `${obsUrl.slice(0, 34)}…${obsUrl.slice(-8)}`
      : obsUrl
    : "Generating your private URL…";

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 30px" }}>
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="font-display" style={{ fontSize: 29, fontWeight: 400, lineHeight: 1.15 }}>
            Start a stream
          </h1>
          <p style={{ fontSize: 13.5, color: "#9aa08c", marginTop: 8, maxWidth: 560 }}>
            Turn your webcam into a live AI persona. Pick a mode, check your preview, and go live.
          </p>
        </div>
        <div
          className="inline-flex items-center"
          style={{
            gap: 8,
            background: "#14170f",
            border: "1px solid #262b1c",
            borderRadius: 999,
            padding: "8px 14px",
            fontSize: 12.5,
            color: streaming ? "var(--foreground)" : "#9aa08c",
          }}
        >
          <span className={`status-dot ${streaming ? "live" : ""}`} />
          {streaming ? `Live — ${RATE} credits/sec` : "Idle — not charging"}
        </div>
      </div>

      {STREAMING_PAUSED && (
        <div role="status" className="mb-6 rounded-2xl border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-5 py-4 text-[14px] whitespace-pre-line">
          {STREAMING_PAUSED_MESSAGE}
        </div>
      )}

      {/* ── Two columns ─────────────────────────────────────────── */}
      <div className="lumi-studio-grid">
        {/* ══════════ MAIN COLUMN ══════════ */}
        <div className="flex flex-col" style={{ gap: 16 }}>
          {/* 1. Live preview */}
          <div style={cardStyle}>
            <div className="lumi-preview-grid">
              {/* YOUR CAMERA */}
              <div
                className="relative overflow-hidden"
                style={{ aspectRatio: "16 / 10", borderRadius: 10, border: "1px solid #262b1c", background: "#0b0d0a" }}
              >
                {!streaming && <SilhouetteBg variant="camera" />}
                <video
                  ref={inputVideoRef}
                  muted
                  playsInline
                  className="absolute inset-0 z-[1] h-full w-full"
                  style={{ objectFit: "cover", background: "#000", opacity: streaming ? 1 : 0 }}
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
                <div className="absolute top-3 left-3 z-[4]">
                  <Chip>Your camera</Chip>
                </div>
                <div className="absolute top-3 right-3 z-[4] flex items-center gap-1.5">
                  <Chip danger>
                    <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--destructive)" }} />
                    Rec
                  </Chip>
                  <Chip>720p</Chip>
                </div>
                {!streaming && (
                  <PanelEmpty
                    icon={<CameraIcon size={19} />}
                    title="Camera off"
                    hint="Face a window or lamp for the best AI output"
                  />
                )}
              </div>

              {/* AI OUTPUT */}
              <div
                className="relative overflow-hidden"
                style={{
                  aspectRatio: "16 / 10",
                  borderRadius: 10,
                  border: "1px solid #2e3520",
                  background: "#0b0d0a",
                  boxShadow: "inset 0 0 0 1.5px rgba(198,242,78,.2)",
                }}
              >
                {!streaming && <SilhouetteBg variant="output" />}
                <video
                  ref={outputVideoRef}
                  muted
                  playsInline
                  className="absolute inset-0 z-[1] h-full w-full"
                  style={{ objectFit: "cover", opacity: streaming ? 1 : 0 }}
                />
                <div className="absolute top-3 left-3 z-[4]">
                  <Chip accent>AI output</Chip>
                </div>
                <div className="absolute top-3 right-3 z-[4] flex items-center gap-1.5">
                  <Chip accent>Lucy 2.5</Chip>
                  <Chip>&lt; 120 ms</Chip>
                </div>
                {!streaming && !connecting && (
                  <PanelEmpty
                    accent
                    icon={<Sparkles size={19} />}
                    title="Waiting for stream"
                    hint="Your transformed feed appears here in real time"
                  />
                )}
                {connecting && (
                  <div className="absolute inset-0 z-[6] grid place-items-center bg-black/70">
                    <div className="text-center">
                      <Sparkles className="h-9 w-9 mx-auto text-primary animate-pulse" />
                      <div className="mt-2 text-[12px] text-[color:var(--muted-foreground)]">Connecting to Lucy…</div>
                    </div>
                  </div>
                )}
                {streaming && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!obsUrl) return;
                      window.open(obsUrl, "lumify-ai-output",
                        "popup=yes,width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,noopener,noreferrer");
                    }}
                    disabled={!obsUrl}
                    title="Open AI output in a new window"
                    className="absolute bottom-3 right-3 z-[6] inline-flex items-center gap-1.5 rounded-md border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary transition"
                    style={MONO}
                  >
                    <ExternalLink size={12} /> Pop out
                  </button>
                )}
              </div>
            </div>

            {/* Controls row */}
            <div style={{ borderTop: "1px solid #1e2316", marginTop: 20, paddingTop: 20 }}>
              <div className="flex flex-wrap items-end" style={{ gap: 16 }}>
                {/* CAMERA / SOURCE */}
                <div className="flex flex-col" style={{ gap: 8, minWidth: 210 }}>
                  <span style={fieldLabel} className="inline-flex items-center gap-1.5">
                    Camera
                    <Info size={11} aria-label="Pick the device Lumify should capture">
                      <title>Pick the device Lumify should capture</title>
                    </Info>
                  </span>
                  {inputSource === "camera" ? (
                    <select
                      value={selectedCameraId}
                      onChange={(e) => handleCameraChange(e.target.value)}
                      title="Pick the device Lumify should capture"
                      className="rounded-lg border bg-[color:var(--sidebar)] px-3 text-[13px] focus:border-[color:var(--primary)]"
                      style={{ height: 40, minWidth: 210 }}
                    >
                      {cameras.length === 0 && <option value="">No camera detected</option>}
                      {cameras.map((cam: MediaDeviceInfo, i: number) => (
                        <option key={cam.deviceId || i} value={cam.deviceId}>{cam.label || `Camera ${i + 1}`}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="segmented items-center" style={{ height: 40 }}>
                      <button type="button" disabled={streaming} data-active={false} onClick={() => changeInputSource("camera")}>
                        <CameraIcon size={12} className="inline mr-1 -mt-0.5" /> Camera
                      </button>
                      <button type="button" disabled={streaming} data-active={true} onClick={() => changeInputSource("file")}>
                        <Film size={12} className="inline mr-1 -mt-0.5" /> Video file
                      </button>
                    </div>
                  )}
                </div>

                {inputSource === "camera" && (
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    <span style={fieldLabel}>Source</span>
                    <div className="segmented items-center" style={{ height: 40 }}>
                      <button type="button" disabled={streaming} data-active={true} onClick={() => changeInputSource("camera")}>
                        <CameraIcon size={12} className="inline mr-1 -mt-0.5" /> Camera
                      </button>
                      <button type="button" disabled={streaming} data-active={false} onClick={() => changeInputSource("file")}>
                        <Film size={12} className="inline mr-1 -mt-0.5" /> Video
                      </button>
                    </div>
                  </div>
                )}

                {/* MODE */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={fieldLabel}>Mode</span>
                  <div className="segmented items-center" style={{ height: 40 }}>
                    <button type="button" data-active={mode === "realistic"} onClick={() => setMode("realistic")}>Realistic</button>
                    <button type="button" data-active={mode === "stylized"} onClick={() => setMode("stylized")}>Stylized</button>
                  </div>
                </div>

                {/* POP OUT */}
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <span style={fieldLabel}>Preview</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!obsUrl) return;
                      window.open(obsUrl, "lumify-ai-output",
                        "popup=yes,width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,noopener,noreferrer");
                    }}
                    disabled={!obsUrl}
                    title={obsUrl ? "Open AI output in a new window" : "Available once your stream link is ready"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-3 text-[11px] font-semibold uppercase tracking-widest text-primary transition disabled:opacity-45"
                    style={{ ...MONO, height: 40 }}
                  >
                    <ExternalLink size={13} /> Pop out
                  </button>
                </div>


                {/* REALISM */}
                {mode === "realistic" && (
                  <div className="flex flex-col flex-1" style={{ gap: 8, minWidth: 210 }}>
                    <span style={fieldLabel}>Realism</span>
                    <div className="flex items-center gap-3" style={{ height: 40 }}>
                      <input
                        type="range" min={1} max={10} step={1}
                        value={realism}
                        onChange={(e) => setRealism(Number(e.target.value))}
                        className="lime-range"
                        style={{ ["--val" as any]: `${((realism - 1) / 9) * 100}%`, flex: "1 1 auto", width: "100%" }}
                      />
                      <span className="font-display text-primary text-right" style={{ width: 38, flexShrink: 0, fontSize: 15 }}>
                        {realism}/10
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 12, color: "#6b7160", marginTop: 12 }}>
                {mode === "realistic"
                  ? "Keeps the person looking human and natural — style presets are disabled."
                  : "Unlocks creative presets — anime, painterly, cinematic and more."}
              </div>

              {mode === "stylized" && (
                <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
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
              )}
            </div>
          </div>

          {/* 2. Reference image */}
          <div style={cardStyle}>
            <CardTitle>Reference image · optional</CardTitle>
            <input
              ref={fileInputRef} type="file"
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0] ?? null); }}
              className="grid place-items-center text-center cursor-pointer"
              style={{
                border: `1.5px dashed ${dragOver ? "var(--primary)" : "#333a24"}`,
                borderRadius: 10,
                minHeight: 176,
                padding: 20,
                background: dragOver ? "rgba(198,242,78,.06)" : "transparent",
                transition: "all 150ms ease",
              }}
            >
              {referenceUrl ? (
                <div className="flex flex-col items-center" style={{ gap: 10 }}>
                  <img src={referenceUrl} alt="Reference preview" style={{ height: 96, borderRadius: 8, objectFit: "cover" }} />
                  <div className="flex items-center gap-2 text-[12.5px] text-[color:var(--muted-foreground)]">
                    <span className="truncate" style={{ maxWidth: 220 }}>{referenceImage?.name}</span>
                    {!streaming && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); clearReference(); }}
                        className="text-[color:var(--faint)] hover:text-[color:var(--destructive)]"
                        aria-label="Remove reference image"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center" style={{ gap: 8 }}>
                  <Upload className="h-6 w-6 text-primary" />
                  <div style={{ fontSize: 13.5 }}>
                    <strong style={{ fontWeight: 600 }}>Drop an image here</strong>{" "}
                    <span className="text-primary">or browse files</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7160" }}>
                    JPG or PNG · guides the AI toward a specific look
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Video file card (file input mode) */}
          {inputSource === "file" && (
            <div style={cardStyle}>
              <CardTitle>Video file · plays locally, never uploaded</CardTitle>
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
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${streaming ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  style={{
                    border: `1.5px dashed ${dragVideoOver ? "var(--primary)" : "#333a24"}`,
                    borderRadius: 10,
                    background: dragVideoOver ? "rgba(198,242,78,.06)" : "transparent",
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
                    <div className="text-[13.5px] truncate">{videoFile?.name}</div>
                    <div className="text-[11.5px] text-[color:var(--muted-foreground)] mt-0.5">
                      {videoDuration > 0
                        ? `${mmss(Math.floor(videoDuration))} · ≈ ${videoCredits.toLocaleString()} credits`
                        : "Reading duration…"}
                      {streaming && <span className="ml-2 text-primary">• Live</span>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => { if (!streaming) videoFileInputRef.current?.click(); }} disabled={streaming} className="text-[11px] rounded border px-2 py-1 disabled:opacity-50">Change</button>
                      {!streaming && (
                        <button onClick={clearVideoFile} className="text-[11px] rounded border px-2 py-1 text-[color:var(--muted-foreground)]">Remove</button>
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
            <div className="rounded-xl border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 px-4 py-3 text-[13px] text-[color:var(--destructive)]">
              {error}
            </div>
          )}

          {/* 3. Action bar */}
          <div style={cardStyle}>
            <div className="flex flex-wrap items-center justify-between" style={{ gap: 16 }}>
              <div className="flex items-center" style={{ gap: 12 }}>
                <button
                  type="button"
                  onClick={streaming ? stop : start}
                  disabled={connecting || (!streaming && (STREAMING_PAUSED || (inputSource === "file" && (!videoFile || !!videoFileError))))}
                  className="inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    background: "var(--primary)",
                    color: "#111406",
                    fontWeight: 700,
                    fontSize: 14,
                    borderRadius: 12,
                    padding: "14px 28px",
                    boxShadow: "0 8px 28px -12px rgba(198,242,78,.65)",
                    transition: "all 150ms ease",
                  }}
                >
                  {streaming ? <><Square size={14} /> Streaming…</> : <><Play size={14} /> Start stream</>}
                </button>
                <button
                  type="button"
                  onClick={stop}
                  disabled={!streaming}
                  className="btn-ghost disabled:opacity-50"
                  style={{ padding: "14px 22px", transition: "all 150ms ease" }}
                >
                  Stop
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: "#9aa08c" }}>
                Costs <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>{RATE} credits/sec</strong> · ≈{" "}
                <strong style={{ color: "var(--foreground)", fontWeight: 700 }}>{timeLeftLabel}</strong> on your balance
              </div>
            </div>
          </div>

          {/* 4. Tips */}
          <CameraTips />
        </div>

        {/* ══════════ RIGHT RAIL ══════════ */}
        <div className="flex flex-col" style={{ gap: 16 }}>
          {/* Balance */}
          <div style={{ ...cardStyle, background: "linear-gradient(150deg,#1a2010,#14170f 60%)", border: "1px solid #2c3519" }}>
            <CardTitle>Balance</CardTitle>
            <div className="font-display" style={{ fontSize: 32, lineHeight: 1.1 }}>
              ≈ {timeLeftLabel}{" "}
              <span style={{ fontSize: 15, color: "#9aa08c", letterSpacing: "0.08em" }}>LEFT</span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: "#1e2316",
                overflow: "hidden",
                marginTop: 16,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${bufferPct}%`,
                  borderRadius: 999,
                  background: underTenMin
                    ? "linear-gradient(90deg,#ffb75a,#ffd98a)"
                    : "linear-gradient(90deg,#8fc233,#c6f24e)",
                  transition: "width 400ms ease",
                }}
              />
            </div>
            {underTenMin && (
              <div
                className="flex items-start gap-2"
                style={{
                  marginTop: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(255,210,138,.35)",
                  background: "rgba(255,210,138,.1)",
                  padding: 12,
                  fontSize: 12,
                  color: "var(--warning)",
                }}
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>Under 10 minutes of stream time left. Top up to avoid an interruption mid-stream.</span>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: "#9aa08c", marginTop: 16 }}>
              {credits.toLocaleString()} credits · {RATE} credits/sec
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/credits" })}
              className="inline-flex w-full items-center justify-center gap-2"
              style={{
                marginTop: 16,
                background: "var(--primary)",
                color: "#111406",
                fontWeight: 700,
                fontSize: 13.5,
                borderRadius: 12,
                padding: "12px 20px",
                boxShadow: "0 6px 20px -10px rgba(198,242,78,.55)",
                transition: "all 150ms ease",
              }}
            >
              <Plus size={14} /> Buy credits
            </button>
          </div>

          {/* Session */}
          <div style={cardStyle}>
            <CardTitle>Session</CardTitle>
            <div>
              {[
                {
                  k: "Status",
                  v: (
                    <span className="inline-flex items-center gap-2">
                      <span className={`status-dot ${streaming ? "live" : ""}`} />
                      {streaming ? "Live" : connecting ? "Connecting" : "Idle"}
                    </span>
                  ),
                },
                { k: "Model", v: "Lucy 2.5" },
                { k: "Quality", v: "720p" },
                { k: "Duration", v: mmss(duration) },
                { k: "Credits used", v: used.toLocaleString() },
                { k: "Cost so far", v: `₦${cost.toLocaleString()}` },
              ].map((r, i) => (
                <div
                  key={r.k}
                  className="flex items-center justify-between"
                  style={{
                    fontSize: 13,
                    padding: "10px 0",
                    borderTop: i === 0 ? "none" : "1px solid #1e2316",
                  }}
                >
                  <span style={{ color: "#9aa08c" }}>{r.k}</span>
                  <span style={{ fontWeight: 500 }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* OBS setup */}
          <div style={cardStyle}>
            <CardTitle
              right={
                <span
                  style={{
                    ...MONO,
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--primary)",
                    border: "1px solid rgba(198,242,78,.45)",
                    background: "var(--accent-soft)",
                    borderRadius: 6,
                    padding: "3px 7px",
                  }}
                >
                  Live
                </span>
              }
            >
              OBS setup
            </CardTitle>
            <div className="flex flex-col" style={{ gap: 12 }}>
              {[
                <>Start your stream on <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>Lumify</strong></>,
                <>In OBS, add a <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>Browser Source</strong></>,
                <>Paste the URL below, set <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>1280 × 720</strong></>,
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3" style={{ fontSize: 12.5, color: "#9aa08c" }}>
                  <span
                    className="grid place-items-center shrink-0"
                    style={{
                      width: 18, height: 18, borderRadius: 5,
                      background: "var(--accent-soft)",
                      color: "var(--primary)",
                      fontSize: 10.5, fontWeight: 700,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
            <div
              className="flex items-center gap-2"
              style={{
                marginTop: 16,
                background: "#0b0d0a",
                border: "1px solid #262b1c",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              <Monitor size={13} className="text-[color:var(--faint)] shrink-0" />
              <span className="truncate" style={{ ...MONO, fontSize: 11, color: "#9aa08c" }}>{truncatedUrl}</span>
              <button
                type="button"
                onClick={copyObsUrl}
                disabled={!obsUrl}
                className="ml-auto inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
                style={{
                  background: "var(--primary)",
                  color: "#111406",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 7,
                  padding: "5px 10px",
                  transition: "all 150ms ease",
                }}
              >
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "#6b7160", marginTop: 10, lineHeight: 1.5 }}>
              This URL is private and permanent. Regenerate it in Settings to revoke OBS access.
            </div>
            <a
              href={obsUrl || undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-primary"
              style={{ fontSize: 12, marginTop: 12, pointerEvents: obsUrl ? "auto" : "none", opacity: obsUrl ? 1 : 0.5 }}
            >
              <ExternalLink size={12} /> Open output preview
            </a>
          </div>
        </div>
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

