# Architecture rules

- Voice cloning business rules live in a browser-safe module shared with focused tests; provider requests stay in the authenticated ElevenLabs server function, so pricing and window rules can be tested without spending real credits.
- Serialize paid clone replacements per user with a database operation lease and record successful paid creations before releasing it; stateless server instances must not bypass the one-slot and rolling-window limits through concurrent requests.
- Voice ownership parsing, writing and access decisions use the shared voice-access module; cache only complete raw provider lists, invalidate on mutation, and read fresh metadata for private lists and authorization so another Worker cannot authorize a replaced voice from stale metadata.