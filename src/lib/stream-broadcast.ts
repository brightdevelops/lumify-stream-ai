// Cross-tab MediaStream sharing via BroadcastChannel signaling + WebRTC.
// Used to mirror the AI output stream from /stream to /output (e.g. for OBS).

const CHANNEL = "lumify-stream-output";
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type Signal =
  | { type: "viewer-ready"; viewerId: string }
  | { type: "offer"; viewerId: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; viewerId: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; viewerId: string; from: "broadcaster" | "viewer"; candidate: RTCIceCandidateInit }
  | { type: "broadcaster-online" }
  | { type: "broadcaster-offline" };

export function startBroadcaster(stream: MediaStream) {
  const channel = new BroadcastChannel(CHANNEL);
  const peers = new Map<string, RTCPeerConnection>();

  const createPeer = async (viewerId: string) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peers.set(viewerId, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        channel.postMessage({
          type: "ice",
          viewerId,
          from: "broadcaster",
          candidate: e.candidate.toJSON(),
        } satisfies Signal);
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
    channel.postMessage({ type: "offer", viewerId, sdp: offer } satisfies Signal);
  };

  channel.onmessage = async (e: MessageEvent<Signal>) => {
    const msg = e.data;
    if (msg.type === "viewer-ready") {
      await createPeer(msg.viewerId);
    } else if (msg.type === "answer") {
      const pc = peers.get(msg.viewerId);
      if (pc) await pc.setRemoteDescription(msg.sdp);
    } else if (msg.type === "ice" && msg.from === "viewer") {
      const pc = peers.get(msg.viewerId);
      if (pc && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {}
      }
    }
  };

  channel.postMessage({ type: "broadcaster-online" } satisfies Signal);

  return () => {
    channel.postMessage({ type: "broadcaster-offline" } satisfies Signal);
    peers.forEach((p) => p.close());
    peers.clear();
    channel.close();
  };
}

export function startViewer(onStream: (stream: MediaStream) => void) {
  const channel = new BroadcastChannel(CHANNEL);
  const viewerId = Math.random().toString(36).slice(2);
  let pc: RTCPeerConnection | null = null;

  const announce = () =>
    channel.postMessage({ type: "viewer-ready", viewerId } satisfies Signal);

  channel.onmessage = async (e: MessageEvent<Signal>) => {
    const msg = e.data;
    if (msg.type === "broadcaster-online") {
      announce();
    } else if (msg.type === "offer" && msg.viewerId === viewerId) {
      pc?.close();
      pc = new RTCPeerConnection(RTC_CONFIG);
      pc.ontrack = (ev) => {
        if (ev.streams[0]) onStream(ev.streams[0]);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          channel.postMessage({
            type: "ice",
            viewerId,
            from: "viewer",
            candidate: ev.candidate.toJSON(),
          } satisfies Signal);
        }
      };
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      channel.postMessage({ type: "answer", viewerId, sdp: answer } satisfies Signal);
    } else if (msg.type === "ice" && msg.from === "broadcaster" && msg.viewerId === viewerId) {
      if (pc && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {}
      }
    } else if (msg.type === "broadcaster-offline") {
      pc?.close();
      pc = null;
    }
  };

  // In case broadcaster is already running
  announce();

  return () => {
    pc?.close();
    channel.close();
  };
}
