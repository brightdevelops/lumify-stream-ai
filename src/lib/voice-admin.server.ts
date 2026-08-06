// Server-only helpers for the Voice Studio admin page.
export type VoiceRange = "today" | "7d" | "30d" | "all";

export type VoiceUsageRow = {
  id: number;
  user_id: string;
  kind: "generation" | "clone";
  characters: number;
  credits: number;
  voice_id: string | null;
  source: "dashboard" | "api";
  created_at: string;
};

export type VoiceAdminStats = {
  range: VoiceRange;
  start: string | null;
  totals: { generations: number; clones: number; characters: number; credits: number };
  api_generations: number;
  active_users: number;
  new_users: number;
  daily: Array<{ bucket: string; generations: number; credits: number }>;
  users: Array<{
    user_id: string;
    email: string;
    generations: number;
    characters: number;
    credits: number;
    clones: number;
    last_activity: string | null;
  }>;
  recent: Array<VoiceUsageRow & { email: string }>;
};

export function rangeStart(range: VoiceRange): Date | null {
  const now = new Date();
  if (range === "all") return null;
  if (range === "today") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const days = range === "7d" ? 7 : 30;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

export async function loadVoiceAdminStats(range: VoiceRange): Promise<VoiceAdminStats> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const start = rangeStart(range);

  let q = supabaseAdmin
    .from("voice_usage")
    .select("id, user_id, kind, characters, credits, voice_id, source, created_at")
    .order("created_at", { ascending: false })
    .limit(20000);
  if (start) q = q.gte("created_at", start.toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as VoiceUsageRow[];

  // Previous period (for "new vs previous period")
  let prevUsers = new Set<string>();
  if (start) {
    const spanMs = Date.now() - start.getTime();
    const prevStart = new Date(start.getTime() - spanMs);
    const { data: prev } = await supabaseAdmin
      .from("voice_usage")
      .select("user_id")
      .gte("created_at", prevStart.toISOString())
      .lt("created_at", start.toISOString())
      .limit(20000);
    prevUsers = new Set((prev ?? []).map((r) => r.user_id as string));
  }

  const totals = { generations: 0, clones: 0, characters: 0, credits: 0 };
  let api_generations = 0;
  const byUser = new Map<
    string,
    { generations: number; characters: number; credits: number; clones: number; last_activity: string | null }
  >();
  const buckets = new Map<string, { generations: number; credits: number }>();

  const keyOf = (iso: string) =>
    range === "today" ? `${new Date(iso).toISOString().slice(0, 13)}:00` : new Date(iso).toISOString().slice(0, 10);

  for (const r of rows) {
    const credits = Number(r.credits) || 0;
    const chars = Number(r.characters) || 0;
    if (r.kind === "clone") totals.clones += 1;
    else {
      totals.generations += 1;
      if (r.source === "api") api_generations += 1;
    }
    totals.characters += chars;
    totals.credits += credits;

    const u = byUser.get(r.user_id) ?? { generations: 0, characters: 0, credits: 0, clones: 0, last_activity: null };
    if (r.kind === "generation") u.generations += 1;
    u.characters += chars;
    u.credits += credits;
    if (!u.last_activity || r.created_at > u.last_activity) u.last_activity = r.created_at;
    byUser.set(r.user_id, u);

    const k = keyOf(r.created_at);
    const b = buckets.get(k) ?? { generations: 0, credits: 0 };
    if (r.kind === "generation") b.generations += 1;
    b.credits += credits;
    buckets.set(k, b);
  }

  // Fill empty buckets across the range so the chart has a stable axis.
  const filled = new Map<string, { generations: number; credits: number }>();
  if (range === "today") {
    const day = start ?? new Date();
    for (let h = 0; h < 24; h++) {
      const d = new Date(day);
      d.setUTCHours(h, 0, 0, 0);
      filled.set(`${d.toISOString().slice(0, 13)}:00`, { generations: 0, credits: 0 });
    }
  } else if (start) {
    const days = range === "7d" ? 7 : 30;
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      filled.set(d.toISOString().slice(0, 10), { generations: 0, credits: 0 });
    }
  }
  for (const [k, v] of buckets) filled.set(k, v);
  const daily = Array.from(filled.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, v]) => ({ bucket, ...v }));

  const userIds = Array.from(byUser.keys());
  const emails = new Map<string, string>();
  const cloneCounts = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, email").in("id", userIds);
    for (const p of profiles ?? []) emails.set(p.id as string, (p.email as string) ?? "");
    const { data: clones } = await supabaseAdmin
      .from("user_cloned_voices")
      .select("user_id")
      .in("user_id", userIds);
    for (const c of clones ?? []) cloneCounts.set(c.user_id as string, (cloneCounts.get(c.user_id as string) ?? 0) + 1);
  }

  const users = userIds.map((id) => {
    const u = byUser.get(id)!;
    return {
      user_id: id,
      email: emails.get(id) || id.slice(0, 8),
      generations: u.generations,
      characters: u.characters,
      credits: u.credits,
      clones: cloneCounts.get(id) ?? 0,
      last_activity: u.last_activity,
    };
  });
  users.sort((a, b) => b.credits - a.credits);

  const new_users = userIds.filter((id) => !prevUsers.has(id)).length;

  return {
    range,
    start: start ? start.toISOString() : null,
    totals,
    api_generations,
    active_users: userIds.length,
    new_users: start ? new_users : userIds.length,
    daily,
    users,
    recent: rows.slice(0, 50).map((r) => ({ ...r, email: emails.get(r.user_id) || r.user_id.slice(0, 8) })),
  };
}
