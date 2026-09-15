# Roadmap

- [x] TURN relay support for WebRTC streaming (ICE servers from server, viewer retry on ICE failure)
- [x] Switch DECART_API_KEY to the new key
- [ ] Add TURN_URL / TURN_USERNAME / TURN_CREDENTIAL values (blocked: user declined the form for now)

- Engine swap: Decart -> Xmax (x2.0) done in src/routes/_app.stream.tsx + src/lib/xmax.functions.ts. Decart files/secret kept for rollback. Needs one live stream test.
