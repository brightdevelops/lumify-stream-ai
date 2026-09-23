
# Lumify Visual Redesign — Plan

Visual-only redesign of lumifylive.com. All Supabase queries, auth, streaming, recording, Korapay initialize/verify flows, RLS, edge functions, and route paths stay exactly as they are. Only markup, layout, and styling change.

## Design system (src/styles.css)

Replace the current token block with the new palette and typography:

- Colors (as CSS vars on `:root`, mapped through `@theme inline`):
  - `--background: #0b0d0a`, `--sidebar: #101309`, `--card: #14170f`
  - `--border: #262b1c`, `--border-soft: #1e2316`
  - `--primary (accent lime): #c6f24e`, `--primary-foreground: #111406`
  - `--accent-soft: rgba(198,242,78,.12)`, `--accent-glow: rgba(198,242,78,.25)`
  - `--foreground: #f2f4ec`, `--muted-foreground: #9aa08c`, `--faint: #6b7160`
  - `--destructive: #ff7a6b`, `--warning: #ffd28a`
- Fonts: display = Georgia serif (headings, big numbers, logo); body = system sans stack; add `.eyebrow` utility for 11–12px uppercase 0.12em labels.
- Logo: "Lum" in serif + "ify" italic lime (update `Logo.tsx`).
- Utility classes: `.card-lift`, `.status-dot` (with `@keyframes pulseGlow`), `.badge-success/pending/failed`, `.accent-card` (gradient 150deg #1a2010 → #14170f, border #2c3519), `.segmented`, gradient button glow shadow.
- Remove the ogl `SideRays` background (doesn't fit the new tone).

## App shell

- `src/components/AppSidebar.tsx`: rebuild as 225px wide, bg `--sidebar`, Lumify logo top, nav (Dashboard, Start Stream, **Wallet** (rename from Buy Credits), Billing, divider, Settings, Support). Active = lime pill with dark text. Bottom: mini balance card (`760 credits`, `+ Top up` lime link) + Log out. Admin/Inventor links preserved.
- `src/components/MobileNav.tsx`: same rename + new visual style; sidebar hides below 980px.
- `src/routes/_app.tsx`: drop `<SideRays>`, wrap main content at max-width 1220px with 34px side padding.

## Pages

- **Landing** (`src/routes/index.tsx`): full rewrite — sticky blurred nav, hero with pill eyebrow + serif H1 (last two words italic lime), dual-panel browser-frame demo, 4-tile stat strip, How it works (3 numbered cards), Features (6 icon cards), Pricing (3 packs, middle highlighted, real Korapay pack sizes read from existing constants), FAQ accordion, gradient CTA panel, footer.
- **Dashboard** (`src/routes/_app.dashboard.tsx`): new header + "Go live" CTA, 4 stat tiles (Balance accent tile with ≈ time left, Streamed this week, Credits used, Avg session), 2-col grid (Recent sessions table + low-balance warning + Quick actions). All numbers still come from existing `credits` / `transactions` queries.
- **Start Stream** (`src/routes/_app.stream.tsx`): re-layout only. Header + status pill (idle/live pulsing), left column with dual-panel preview card, single control strip (camera select, Realistic|Stylized segmented, realism slider with serif readout, helper text switching by mode), reference image dropzone, action bar with cost/time-left line, collapsed tips accordion. Right rail: accent Balance card with lime progress + amber warning under 10 min, Session card (Status/Model/Quality/Duration/Credits/Cost live-updating), OBS setup card with numbered steps + copy button + regenerate note. Existing `getUserMedia`, Decart connect, `buildPrompt`, deduction, recorder, and OBS token logic untouched.
- **Wallet** (`src/routes/_app.credits.tsx`, path unchanged): new header, 3 stat tiles, "Choose a pack" card with 3 selectable pack tiles + dynamic "Pay ₦X with Korapay" button calling the existing `initKorapay` function, right-side "Recent top-ups" list from existing wallet transactions query.
- **Billing** (`src/routes/_app.billing.tsx`): single ledger card (Date, Type, Reference, Credits ±, Amount ₦, Status badge) + "Export CSV" ghost button using existing data.
- **Settings** (`src/routes/_app.settings.tsx`): two-column — Profile card (existing fields), Streaming defaults with lime toggle switches, OBS access card with code row + red "Regenerate URL" button (wired to existing regenerate call if present, otherwise kept as visual with existing handler).

## Interactions

- 150ms transitions; landing cards hover-lift 2px + brighter border.
- `.status-dot.live` pulses with lime glow ring (1.6s keyframes).
- Session numbers already tick per-second in existing stream code — keep that interval, only restyle the readouts.
- Focus-visible: lime border on inputs/selects (global rule).
- Responsive: sidebar hides <980px (mobile top bar remains), grids collapse to 1 column, landing nav links hide <820px.
- ₦ formatting via `toLocaleString("en-NG")` (already used).

## Non-goals / preserved as-is

- No changes to: auth flow, Turnstile, Supabase schema/RLS, RPCs, edge functions, Korapay init/verify, streaming pipeline (Decart, WebRTC, recorder), admin/inventor pages, email templates, maintenance-mode logic, IP search, support widget.
- Route file names and URLs unchanged (Wallet is a nav-label rename only; the route stays `/credits`).
- Admin/Inventor sidebar links stay conditional on existing role checks.

## Technical notes

- Landing pricing packs will read from the same `PACKS` array already used by `_app.credits.tsx` so numbers stay in sync with what Korapay actually charges.
- All new components live in `src/components/` (e.g. `landing/Hero.tsx`, `landing/Pricing.tsx`, `ui/StatusDot.tsx`, `ui/AccentCard.tsx`) to keep route files readable.
- Tailwind v4: new tokens added under existing `@theme inline` block; no `tailwind.config.js`.
