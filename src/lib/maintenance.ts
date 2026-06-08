// ── Streaming maintenance flag ──────────────────────────────────────────────
// Flip STREAMING_PAUSED to false to re-enable streaming.
// When true:
//   - The "Start Stream" button is disabled on /stream.
//   - The Decart key server function refuses to issue a key, so no
//     Decart session can start and no credits are deducted.
// Existing credits, balances, login, dashboard, and credits page are unaffected.
export const STREAMING_PAUSED = false;

export const STREAMING_PAUSED_MESSAGE =
  "Streaming is temporarily paused for maintenance and will be back within 24 hours. Your credits are safe and will be exactly as you left them. Thanks for your patience! — The Lumify Team";
