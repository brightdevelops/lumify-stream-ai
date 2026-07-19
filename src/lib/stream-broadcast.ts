// Cross-device MediaStream sharing via Supabase Realtime signaling + WebRTC.
// Broadcaster (logged-in user on /stream) publishes; viewer (OBS browser on
// /output?token=...) connects. The signaling channel is keyed by the user's
// revocable stream_token — rotating the token immediately cuts off any
// viewers still listening on the old channel, so a leaked user id alone is
// not enough to rejoin the live feed.

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const channelName = (streamToken: string) => `stream-output:${streamToken}`;


type Payload =
  | { kind: "viewer-ready"; viewerId: string }
  | { kind: "offer"; viewerId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; viewerId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; viewerId: string; from: "broadcaster" | "viewer"; candidate: RTCIceCandidateInit }
  | { kind: "broadcaster-online" }
  | { kind: "broadcaster-offline" };

const send = (ch: RealtimeChannel, payload: Payload) =>
  ch.send({ type: "broadcast", event: "signal", payload });

export function startBroadcaster(streamToken: string, stream: MediaStream) {
  const ch = supabase.channel(channelName(streamToken), {

    config: { broadcast: { self: false, ack: false } },
  });
  const peers = new Map<string, RTCPeerConnection>();

  const createPeer = async (viewerId: string) => {
    peers.get(viewerId)?.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peers.set(viewerId, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send(ch, {
          kind: "ice",
          viewerId,
          from: "broadcaster",
          candidate: e.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (["closed", "failed", "disconnected"].includes(pc.connectionState)) {
        pc.close();
        peers.delete(viewerId);
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send(ch, { kind: "offer", viewerId, sdp: offer });
  };

  ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
    const msg = payload as Payload;
    if (msg.kind === "viewer-ready") {
      await createPeer(msg.viewerId);
    } else if (msg.kind === "answer") {
      const pc = peers.get(msg.viewerId);
      if (pc) await pc.setRemoteDescription(msg.sdp);
    } else if (msg.kind === "ice" && msg.from === "viewer") {
      const pc = peers.get(msg.viewerId);
      if (pc && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {}
      }
    }
  });

  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      send(ch, { kind: "broadcaster-online" });
    }
  });

  return () => {
    try {
      send(ch, { kind: "broadcaster-offline" });
    } catch {}
    peers.forEach((p) => p.close());
    peers.clear();
    supabase.removeChannel(ch);
  };
}

export function startViewer(userId: string, onStream: (stream: MediaStream) => void) {
  const ch = supabase.channel(channelName(userId), {
    config: { broadcast: { self: false, ack: false } },
  });
  const viewerId = Math.random().toString(36).slice(2);
  let pc: RTCPeerConnection | null = null;

  const announce = () => send(ch, { kind: "viewer-ready", viewerId });

  ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
    const msg = payload as Payload;
    if (msg.kind === "broadcaster-online") {
      announce();
    } else if (msg.kind === "offer" && msg.viewerId === viewerId) {
      pc?.close();
      pc = new RTCPeerConnection(RTC_CONFIG);
      pc.ontrack = (ev) => {
        if (ev.streams[0]) onStream(ev.streams[0]);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          send(ch, {
            kind: "ice",
            viewerId,
            from: "viewer",
            candidate: ev.candidate.toJSON(),
          });
        }
      };
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send(ch, { kind: "answer", viewerId, sdp: answer });
    } else if (
      msg.kind === "ice" &&
      msg.from === "broadcaster" &&
      msg.viewerId === viewerId
    ) {
      if (pc && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {}
      }
    } else if (msg.kind === "broadcaster-offline") {
      pc?.close();
      pc = null;
    }
  });

  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      // In case broadcaster is already running
      announce();
    }
  });

  return () => {
    pc?.close();
    supabase.removeChannel(ch);
  };
}
