import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getCreditBalance from "./tools/get-credit-balance";
import listRecentStreams from "./tools/list-recent-streams";
import getProfile from "./tools/get-profile";

// The OAuth issuer MUST be the direct Supabase host, not the .lovable.cloud
// proxy that SUPABASE_URL becomes on publish. Read the project ref from the
// Vite-inlined literal so the value survives publish.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "lumify-mcp",
  title: "Lumify Live",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in Lumify user. Use `get_credit_balance` to check remaining stream credits, `list_recent_streams` to review recent sessions, and `get_profile` for account info.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getCreditBalance, listRecentStreams, getProfile],
});
