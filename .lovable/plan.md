Switch the Decart Lucy model from `lucy-latest` back to Lucy 2.0 and update the UI labels to match.

## Changes

**`src/routes/_app.stream.tsx`**
- Lines 253, 482, 528: replace `models.realtime("lucy-latest" as any)` with `models.realtime("lucy-2.0" as any)` (three call sites: initial start, restart, and reconnect paths).
- Line 918: change the connecting message from "Connecting to Lucy 2.5…" to "Connecting to Lucy 2.0…".
- Line 1047: change the info row from `<Row k="Model" v="Lucy 2.5" />` to `<Row k="Model" v="Lucy 2.0" />`.

No other files, no billing/streaming logic, no UI redesign.

## Note

If Decart's SDK rejects `lucy-2.0` as an unknown model id (same class of failure we hit when `lucy-v2v-720p-rt` was retired), I'll surface the exact id from their error and confirm with you before changing anything else.
