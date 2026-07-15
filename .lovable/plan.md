
# Auto-reply for support chat

## What the user will experience
When a visitor sends a message in the floating chat bubble, the system tries to answer in ~1–2 seconds. If it can't answer confidently, it stays silent and you get the email notification (from feature #1) to reply yourself.

Every auto-reply is clearly badged **"🤖 Auto-reply"** so users know it's automated and expect a human follow-up if needed.

## How replies get generated (two layers)

**Layer 1 — Keyword rules (instant, free)**
A small table of trigger phrases → canned answers, checked first. Starter set:
- greeting (hi/hello/hey) → warm intro + "an inventor will follow up shortly"
- pricing/cost/how much → link to pricing
- refund/money back → refund policy + ask for order ID
- password/login/can't sign in → password reset link
- payment failed/declined → link to payment issues + ask for transaction ID
- crypto/paystack → payment method info
- streaming/live/broadcast → how streams work
- thank you/thanks → "you're welcome" closer (no handoff needed)

Rules live in `localStorage` under `lumify_autoreply_rules` (same pattern as Quick Replies) so you can edit them from the admin inbox — add/remove/edit trigger + response pairs.

**Layer 2 — Lovable AI fallback (smart, cheap)**
If no keyword matches, call Lovable AI (`google/gemini-3.1-flash-lite` — fast, cheap, free-tier friendly) with:
- A system prompt describing Lumify (streaming platform, credits, payments, inventor role, etc.)
- Last ~6 messages of the conversation for context
- Instruction: "Answer only if you can confidently help from the knowledge base. If the question needs a human (account-specific issue, refund decision, custom request, complaint), respond with exactly `HANDOFF` and nothing else."

If the model returns `HANDOFF` → we post nothing, you get the email.
Otherwise → we post the reply with the auto-reply badge.

## Safety rails
- **Never auto-reply to admin messages** (only when the user is the sender).
- **Cool-down**: max 1 auto-reply per conversation per 2 minutes, to prevent loops if the user keeps typing.
- **Stop after handoff**: once you (admin) reply manually in a conversation, auto-reply pauses for that conversation for 30 minutes so the AI doesn't talk over you.
- **Kill switch**: a toggle in the admin inbox header ("Auto-reply: On/Off") stored in `site_settings` so you can disable it globally when you want.
- **Conversation history**: auto-reply messages are saved to `support_messages` with `role: 'assistant'` and a new `is_auto_reply: true` flag so the widget can render the badge and you can distinguish them in the inbox.

## Technical details

**Database migration**
- Add `is_auto_reply boolean default false` column to `support_messages`.

**New TanStack server function** `src/lib/support-autoreply.functions.ts`:
- Input: `{ conversationId, latestMessageText }`
- Steps:
  1. Load global on/off from `site_settings`; bail if off.
  2. Check cool-down + recent-admin-reply guard (query last messages).
  3. Match keyword rules (rules passed in from client, since they live in localStorage — or move to `site_settings` if you'd rather manage them server-side; recommend `site_settings` so rules survive across devices/browsers).
  4. If match → insert auto-reply message directly.
  5. Else call Lovable AI with system prompt + last 6 messages.
  6. If response === `HANDOFF` → do nothing.
  7. Else → insert auto-reply message with `is_auto_reply: true`.
- Uses `supabaseAdmin` (inside the handler) to insert as the "assistant" without requiring an admin session.

**Frontend changes**
- `src/components/SupportWidget.tsx`: after inserting the user's message + firing the email, also call the new `tryAutoReply` server fn. Render messages with `is_auto_reply: true` with a small "🤖 Auto-reply" badge above the bubble.
- `src/routes/inventor.support.tsx`:
  - Add "Auto-reply: On/Off" toggle in header (writes to `site_settings`).
  - Add "Auto-reply rules" section (below Quick Replies) — same edit/delete UX, saved to `site_settings` key `autoreply_rules`.
  - Show auto-reply messages with a distinct color/badge so you can see at a glance what the bot said.

**Rules storage**
Move both quick_replies and autoreply_rules to `site_settings` (JSON) instead of localStorage so they're consistent across your devices. Keep localStorage as a fallback cache.

## Out of scope for this plan (can add later)
- Business-hours-only mode
- Per-conversation "disable auto-reply" toggle
- Feedback thumbs on auto-replies to improve the prompt over time
- Analytics on how often auto-reply resolves vs. hands off

Ready to build when you approve.
