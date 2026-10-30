# Roadmap

## Current: One voice provider (ElevenLabs powers TTS + cloning + live)

- [x] DB migration: user_cloned_voices.voice_id (the ElevenLabs clone id), deprecated cartesia_voice_id/elevenlabs_voice_id, voice_reclone_grants table, save_el_cloned_voice + consume_reclone_grant RPCs
- [x] Data migration: owner's twin row kept (voice_id = ElevenLabs id); 223 Cartesia-only rows deleted, 179 users granted one free re-clone
- [x] Provider cleanup: 1,100 orphaned voices deleted from the Cartesia account (0 failures)
- [x] elevenlabs.functions.ts: single-provider clone (owner-tagged, 150 cr, 1 slot, 5/24h before charge, free re-clone path), list-mine from table, delete clears provider+row+clip, live access via voice_id, STS voice_settings 0.5/0.9
- [x] Voice page: ElevenLabs everywhere, speed+stability only (volume/emotion/WAV removed), twin retry UI removed, free re-clone notice + "Clone voice · free" button
- [x] Twin system removed from the live path; Cartesia functions + voice-twins.server.ts kept unreferenced for rollback (still compile)
- [x] Tests (23 pass) + typecheck + build OK; page verified rendering in both modes
- [ ] Paid verification on test accounts (BLOCKED: emekaihechi860@gmail.com has 0 credits — user said they funded 1,000 but it never arrived; brightcodes0@gmail.com designated for isolation): clone once → same id serves preview/TTS/live; free re-clone path; charges exact

## Done

- [x] Twin restructure (superseded by the above)
- [x] Voice replacement + 5 clones per rolling 24h
- [x] Clone denial traced to provider 403; ownership helpers unified
- [x] TURN relay support (secrets still blocked — user declined)
- [x] DECART_API_KEY switch
