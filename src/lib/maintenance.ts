// ── Maintenance flag ────────────────────────────────────────────────────────
// Flip STREAMING_PAUSED to false to re-enable streaming.
// When true:
//   - The "Start Stream" button is disabled on /stream.
//   - The Decart key server function refuses to issue a key, so no
//     Decart session can start and no credits are deducted.
// Existing credits, balances, login, dashboard, and credits page are unaffected.
export const STREAMING_PAUSED = true;

export const STREAMING_PAUSED_MESSAGE =
  "⚡ Lumify is leveling up.\n\nWe're rolling out backend upgrades to make your streams faster, smoother, and more reliable. During this short maintenance window, new credit purchases and live streaming are temporarily paused.\n\nYour credits are 100% safe. Every credit in your wallet is stored securely and will be exactly where you left it when we're back — nothing expires, nothing is lost.\n\nWe're a team that ships. Lumify isn't going anywhere — we're building this for the long run, and these upgrades are part of making it bulletproof. Thanks for streaming with us. We'll be back shortly. 🚀\n\n— The Lumify Team";
