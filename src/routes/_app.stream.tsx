import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Sparkles, Plus, X, Upload, Image as ImageIcon, Monitor, Copy, Check, ExternalLink, Clock, Radio, AlertTriangle, Info, ChevronDown, Camera as CameraIcon, PictureInPicture2 } from "lucide-react";
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
    try {
      await refreshLucyModelId();
      const model = models.realtime("lucy-2.1" as any);
      const fps = Number.isFinite(Number(model.fps)) ? Number(model.fps) : 25;
      const width = Number.isFinite(Number(model.width)) ? Number(model.width) : 1280;
      const height = Number.isFinite(Number(model.height)) ? Number(model.height) : 720;
      const baseVideo: MediaTrackConstraints = {
        ...(selectedCameraId ? { deviceId: { ideal: selectedCameraId } } : {}),
        frameRate: { ideal: fps },
        width: { ideal: width },
        height: { ideal: height },
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: baseVideo, audio: false });
      } catch (inner: any) {
        // OverconstrainedError / NotReadableError — retry with permissive constraints
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

    mediaStreamRef.current = stream;
    if (inputVideoRef.current) {
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
  const pct = startingCredits > 0 ? Math.max(0, Math.min(100, (credits / startingCredits) * 100)) : 0;
  const cost = used * NAIRA_PER_CREDIT;

  const secondsLeft = Math.floor(credits / RATE);
  const timeLeftLabel = formatTimeLeft(secondsLeft);
  const lowBalance = streaming && secondsLeft > 0 && secondsLeft <= LOW_BALANCE_SECONDS;
  const preflightTime = formatTimeLeft(secondsLeft);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[38px] leading-tight">Start a stream</h1>
          <p className="mt-1 text-[14px] text-[color:var(--muted-foreground)]">
            Turn your webcam into a live AI persona. Pick a mode, check your preview, and go live.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-[12.5px] self-start">
          <span className={`status-dot ${streaming ? "live" : ""}`} />
          {streaming ? (
            <span className="text-primary font-semibold">Live — {RATE} credits/sec</span>
          ) : (
            <span className="text-[color:var(--muted-foreground)]">Idle — not charging</span>
          )}
        </div>
      </div>

      {STREAMING_PAUSED && (
        <div role="status" className="mb-6 rounded-2xl border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-5 py-4 text-[14px] whitespace-pre-line">
          {STREAMING_PAUSED_MESSAGE}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* LEFT */}
        <div className="space-y-5">
          {/* Live preview */}
          <div className="card-surface p-0 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              <Panel label="Your camera" streaming={streaming}>
                {!streaming && <SilhouetteBg variant="camera" />}
                <video ref={inputVideoRef} muted playsInline className="relative z-[1] h-full w-full object-cover" />
                {!streaming && <PanelEmpty icon={<CameraIcon size={22} />} title="Camera off" hint="Face a window or lamp for the best AI output" />}
              </Panel>
              <Panel label="AI output" accent streaming={streaming}>
                {!streaming && <SilhouetteBg variant="output" />}
                <video ref={outputVideoRef} muted playsInline className="relative z-[1] h-full w-full object-cover" />
                {!streaming && <PanelEmpty icon={<Sparkles size={22} />} title="Waiting for stream" hint="Your transformed feed appears here in real time" accent />}
                {streaming && (
                  <button
                    type="button"
                    onClick={async () => {
                      const v = outputVideoRef.current;
                      try {
                        if (v && document.pictureInPictureEnabled && !v.disablePictureInPicture) {
                          if (document.pictureInPictureElement === v) {
                            await document.exitPictureInPicture();
                          } else {
                            await v.requestPictureInPicture();
                          }
                          return;
                        }
                      } catch {
                        /* fall through to popup */
                      }
                      if (obsUrl) {
                        window.open(obsUrl, "lumify-ai-output", "popup=yes,width=720,height=450,noopener,noreferrer");
                      }
                    }}
                    title="Pop out AI output"
                    className="absolute bottom-3 right-3 z-[4] inline-flex items-center gap-1.5 rounded-md border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary hover:bg-[color:var(--primary)]/20 transition"
                  >
                    <PictureInPicture2 size={12} /> Pop out
                  </button>
                )}
                {connecting && (
                  <div className="absolute inset-0 z-[3] grid place-items-center bg-black/70">
                    <div className="text-center">
                      <Sparkles className="h-10 w-10 mx-auto text-primary animate-pulse" />
                      <div className="mt-2 text-[12px] text-[color:var(--muted-foreground)]">Connecting to Lucy…</div>
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            {/* Control strip */}
            <div className="border-t border-[color:var(--border-soft)] p-4 flex flex-wrap items-center gap-4">
              {cameras.length > 0 && (
                <label className="flex items-center gap-2">
                  <span className="eyebrow" title="Any 1080p camera works. Lighting matters most.">Camera <Info size={12} className="inline text-[color:var(--faint)]" /></span>
                  <select
                    value={selectedCameraId}
                    onChange={(e) => handleCameraChange(e.target.value)}
                    className="rounded-lg border bg-[color:var(--sidebar)] px-3 py-1.5 text-[13px] focus:border-[color:var(--primary)]"
                  >
                    {cameras.map((cam, i) => (
                      <option key={cam.deviceId || i} value={cam.deviceId}>{cam.label || `Camera ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex items-center gap-3">
                <span className="eyebrow">Mode</span>
                <div className="segmented">
                  <button type="button" data-active={mode === "realistic"} onClick={() => setMode("realistic")}>Realistic</button>
                  <button type="button" data-active={mode === "stylized"} onClick={() => setMode("stylized")}>Stylized</button>
                </div>
              </div>

              {mode === "realistic" && (
                <div className="flex items-center gap-3 min-w-[220px]">
                  <span className="eyebrow">Realism</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={realism}
                    onChange={(e) => setRealism(Number(e.target.value))}
                    className="lime-range flex-1"
                    style={{ ["--val" as any]: `${((realism - 1) / 9) * 100}%` }}
                  />
                  <span className="font-display text-[18px] text-primary min-w-[38px] text-right">{realism}/10</span>
                </div>
              )}
            </div>
            <div className="px-4 pb-4 text-[12px] text-[color:var(--muted-foreground)]">
              {mode === "realistic"
                ? "Keeps the person looking human and natural — style presets are disabled."
                : "Unlocks creative presets — anime, painterly, cinematic and more."}
            </div>
          </div>

          {/* Reference image */}
          <div className="card-surface">
            <div className="flex items-center gap-2 mb-3">
              <span className="eyebrow">Reference image</span>
              <span className="text-[11px] text-[color:var(--faint)]">· optional</span>
            </div>

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
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0] ?? null); }}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors"
                style={{
                  borderColor: dragOver ? "var(--primary)" : "var(--border)",
                  background: dragOver ? "var(--accent-soft)" : "transparent",
                }}
              >
                <Upload className="h-7 w-7 text-primary" />
                <div className="text-[14px] text-foreground">Drop an image here or <span className="text-primary">browse files</span></div>
                <div className="text-[12px] text-[color:var(--faint)]">JPG or PNG · guides the AI toward a specific look</div>
              </div>
            ) : (
              <div className="flex items-center gap-4 rounded-xl border bg-[color:var(--sidebar)] p-3">
                <img src={referenceUrl} alt="Reference" className="h-20 w-20 rounded-md object-cover border" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[14px] truncate">
                    <ImageIcon size={14} className="text-primary shrink-0" />
                    <span className="truncate">{referenceImage?.name}</span>
                  </div>
                  <div className="text-[11.5px] text-[color:var(--faint)] mt-0.5">
                    {referenceImage ? `${(referenceImage.size / 1024).toFixed(0)} KB` : ""}
                    {streaming && <span className="ml-2 text-primary">• Live</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => fileInputRef.current?.click()} className="text-[11px] rounded border px-2 py-1 hover:bg-card">Change</button>
                    {!streaming && (
                      <button onClick={clearReference} className="text-[11px] rounded border px-2 py-1 hover:bg-card text-[color:var(--muted-foreground)]">Remove</button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {mode === "stylized" && (
              <div className="mt-4">
                <div className="eyebrow mb-2">Style (optional)</div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => selectPreset(p)}
                      className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                        selectedPreset === p
                          ? "border-[color:var(--primary)] text-primary bg-[color:var(--accent-soft)]"
                          : "border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 px-4 py-3 text-[13px] text-[color:var(--destructive)]">
              {error}
            </div>
          )}

          {/* Action bar */}
          <div className="card-surface flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-3">
              <button
                onClick={start}
                disabled={streaming || connecting || STREAMING_PAUSED}
                className="btn-primary"
              >
                {streaming ? <><Square size={14} /> Streaming…</> : <><Play size={14} /> Start stream</>}
              </button>
              <button onClick={stop} disabled={!streaming} className="btn-ghost disabled:opacity-50">
                <Square size={14} /> Stop
              </button>
            </div>
            <div className="text-[12.5px] text-[color:var(--muted-foreground)]">
              Costs <span className="text-foreground font-semibold">{RATE} credits/sec</span> · ≈ <span className="text-foreground">{timeLeftLabel}</span> on your balance
            </div>
          </div>

          <CameraTips />
        </div>

        {/* RIGHT RAIL */}
        <aside className="space-y-5">
          {/* Balance */}
          <div className="accent-card rounded-2xl p-5" style={{ boxShadow: "0 20px 60px -30px var(--accent-glow)" }}>
            <div className="eyebrow">Balance</div>
            <div className="mt-2 font-display text-[28px] leading-none text-foreground">
              ≈ {timeLeftLabel} <span className="text-[12px] text-[color:var(--muted-foreground)] font-sans">LEFT</span>
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-[color:var(--border)] overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${pct}%`, background: lowBalance ? "var(--warning)" : "var(--primary)" }}
              />
            </div>
            <div className="mt-2 text-[12px] text-[color:var(--muted-foreground)]">
              {credits.toLocaleString()} credits · {RATE} credits/sec
            </div>
            {lowBalance && (
              <div className="mt-3 rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 p-3 text-[12.5px] text-[color:var(--warning)]">
                <AlertTriangle size={13} className="inline mr-1" />
                Under 10 minutes of stream time left. Top up to avoid an interruption mid-stream.
              </div>
            )}
            <Link to="/credits" className="btn-primary w-full mt-4">
              <Plus size={14} /> Buy credits
            </Link>
          </div>

          {/* Session */}
          <SidePanel title="Session">
            <Row k="Status" v={
              <span className="inline-flex items-center gap-2 text-[13px]">
                <span className={`status-dot ${streaming ? "live" : ""}`} />
                {streaming ? "Live" : "Idle"}
              </span>
            } />
            <Row k="Model" v="Lucy 2.5" />
            <Row k="Quality" v="720p" />
            <Row k="Duration" v={mmss(duration)} />
            <Row k="Credits used" v={used.toLocaleString()} />
            <Row k="Cost so far" v={`₦${cost.toLocaleString()}`} />
          </SidePanel>

          {/* OBS */}
          <div className="card-surface">
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={14} className="text-primary" />
              <span className="eyebrow">OBS Setup</span>
              <span className="badge badge-success">Live</span>
            </div>
            <ol className="space-y-2 text-[13px]">
              {[
                "Start your stream on Lumify",
                "In OBS, add a Browser Source",
                "Paste the URL below, set 1280 × 720",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-primary text-[color:var(--primary-foreground)] text-[11px] font-bold">{i + 1}</span>
                  <span className="text-foreground">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex items-center gap-2 rounded-lg border bg-[color:var(--sidebar)] p-2">
              <code className="flex-1 truncate text-[11px] font-mono text-[color:var(--muted-foreground)]">
                {obsUrl || "Loading…"}
              </code>
              <button
                onClick={copyObsUrl}
                disabled={!obsUrl}
                className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-[11px] font-semibold text-primary hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
              >
                {copied ? <><Check size={12} /> Copied ✓</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[color:var(--faint)]">
              This URL is private and permanent. Regenerate it in Settings to revoke OBS access.
            </p>
            {obsUrl && (
              <a href={obsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline">
                <ExternalLink size={11} /> Open output preview
              </a>
            )}
          </div>
        </aside>
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

function Panel({ label, accent, streaming, children }: { label: string; accent?: boolean; streaming?: boolean; children: React.ReactNode }) {
  return (
    <div className={`relative overflow-hidden aspect-[16/10] bg-[#0b0d0a] ${accent ? "md:border-l" : ""}`}>
      {/* corner label chip */}
      <div className={`absolute top-3 left-3 z-[4] inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
        accent
          ? "border border-[color:var(--primary)] bg-[color:var(--accent-soft)] text-primary"
          : "border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 text-[color:var(--muted-foreground)]"
      }`}>
        {label}
      </div>
      {/* HUD chips top-right — persist over live video too */}
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
            {streaming && (
              <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--sidebar)]/80 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-widest text-[color:var(--destructive)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--destructive)] animate-pulse" /> Rec
              </span>
            )}
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
    <div className="absolute inset-0 z-0">
      <div
        className="absolute inset-0"
        style={{
          background: isOutput
            ? "radial-gradient(70% 70% at 50% 45%, rgba(198,242,78,0.18), #0b0d0a 82%)"
            : "radial-gradient(70% 70% at 50% 45%, #1c2016 0%, #0b0d0a 85%)",
        }}
      />
      <svg viewBox="0 0 160 110" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`stream-sil-${variant}`} x1="0" x2="0" y1="0" y2="1">
            {isOutput ? (
              <>
                <stop offset="0%" stopColor="#c6f24e" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#3a5a12" stopOpacity="0.55" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#4a5240" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#1a1e14" stopOpacity="0.9" />
              </>
            )}
          </linearGradient>
        </defs>
        <circle cx="80" cy="46" r="20" fill={`url(#stream-sil-${variant})`} stroke={isOutput ? "#c6f24e" : "none"} strokeWidth={isOutput ? 0.6 : 0} />
        <path
          d="M40 110 C46 82, 68 70, 80 70 C92 70, 114 82, 120 110 Z"
          fill={`url(#stream-sil-${variant})`}
          stroke={isOutput ? "#c6f24e" : "none"}
          strokeWidth={isOutput ? 0.6 : 0}
        />
        {isOutput && (
          <>
            <circle cx="55" cy="30" r="0.7" fill="#c6f24e" />
            <circle cx="120" cy="38" r="0.9" fill="#c6f24e" />
            <circle cx="112" cy="20" r="0.6" fill="#c6f24e" />
            <circle cx="42" cy="60" r="0.7" fill="#c6f24e" />
            <circle cx="135" cy="72" r="0.8" fill="#c6f24e" />
          </>
        )}
      </svg>
      {!isOutput && (
        <div
          className="absolute inset-0 pointer-events-none opacity-30 mix-blend-overlay"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)",
          }}
        />
      )}
    </div>
  );
}

function PanelEmpty({ icon, title, hint, accent }: { icon: React.ReactNode; title: string; hint?: string; accent?: boolean }) {
  return (
    <div className="absolute inset-0 z-[2] grid place-items-center p-6 text-center">
      <div className="max-w-[240px]">
        <div className={`mx-auto grid h-11 w-11 place-items-center rounded-xl ${accent ? "bg-[color:var(--accent-soft)] text-primary" : "bg-[color:var(--sidebar)] text-[color:var(--muted-foreground)]"}`}>
          {icon}
        </div>
        <div className="mt-3 text-[13.5px] text-foreground">{title}</div>
        {hint && <div className="mt-1 text-[11.5px] text-[color:var(--faint)] leading-relaxed">{hint}</div>}
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
