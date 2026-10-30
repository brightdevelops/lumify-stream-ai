# Roadmap

## Current: One voice provider (ElevenLabs powers TTS + cloning + live)

- [ ] DB migration: user_cloned_voices.voice_id (the ElevenLabs clone id), deprecate cartesia_voice_id/elevenlabs_voice_id, voice_reclone_grants table, save/consume RPCs
- [ ] Data migration: twin rows keep ElevenLabs id as the clone; 223 Cartesia-only rows deleted with one free re-clone grant per user
- [ ] Provider cleanup: delete legacy Cartesia voices from the Cartesia account
- [ ] elevenlabs.functions.ts: single-provider clone (owner-tagged, 150 cr, 1 slot, 5/24h before charge, free re-clone path), list-mine from table, delete clears provider+row+clip, live access via voice_id, STS voice_settings 0.5/0.9
- [ ] voice page: ElevenLabs everywhere, speed+stability only (drop volume/emotion/WAV), remove twin retry UI, free re-clone notice + button
- [ ] Remove twin system (voice-twins.server.ts, createCartesiaWithTwin); Cartesia functions stay unreferenced
- [ ] Tests + typecheck + build
- [ ] Paid verification on test accounts (emekaihechi860@gmail.com funded?; brightcodes0@gmail.com isolation): clone once → same id serves preview/TTS/live; free re-clone path; charges exact

## Done

- [x] Twin restructure (superseded by the above)
- [x] Voice replacement + 5 clones per rolling 24h
- [x] Clone denial traced to provider 403; ownership helpers unified
- [x] TURN relay support (secrets still blocked — user declined)
- [x] DECART_API_KEY switch
