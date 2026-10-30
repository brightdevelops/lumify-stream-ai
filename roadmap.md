# Roadmap

- [ ] Restructure Voice Studio providers: Cartesia for TTS + cloning, ElevenLabs only for Live Voice; twin clones in both providers (elevenlabs_voice_id on user_cloned_voices, retry-twin path, dual delete, live picker from user_cloned_voices)
- [ ] Paid verification of twin flow on test accounts (blocked: emekaihechi860@gmail.com has 0 credits; second designated test account needed)
- [x] Trace reported clone denial to provider 403; confirm owner UUID matches raw description, unify ownership helpers, strengthen raw cache and pass 21 focused tests
- [ ] Resolve provider voice_access_denied and verify paid owner/replacement/isolation matrix (blocked: designated test wallet emekaihechi860@gmail.com has 0 credits; second designated test account needed for authenticated isolation)

- [x] Implement and verify voice replacement and five successful clones per rolling 24 hours (five live creations, sixth refused; 24-hour aging boundary tested automatically)

- [x] TURN relay support for WebRTC streaming (ICE servers from server, viewer retry on ICE failure)
- [x] Switch DECART_API_KEY to the new key
- [ ] Add TURN_URL / TURN_USERNAME / TURN_CREDENTIAL values (blocked: user declined the form for now)
