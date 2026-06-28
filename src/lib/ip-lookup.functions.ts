import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type IpVisitRow = {
  id: string;
  ip: string | null;
  path: string;
  referrer: string | null;
  user_agent: string | null;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
};

export type IpProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  last_ip: string | null;
  last_country: string | null;
  is_vpn: boolean | null;
  last_seen: string | null;
};

export type IpSearchResult = {
  query: string;
  visit_count: number;
  unique_users: number;
  first_seen: string | null;
  last_seen: string | null;
  visits: IpVisitRow[];
  profiles: IpProfileRow[];
};

async function assertAdmin(context: { userId: string; supabase: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { is_admin: boolean } | null }> } } } } }) {
  const { data } = await context.supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.is_admin) throw new Error("Not authorized");
}

export const inventorSearchIp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(2).max(64), limit: z.number().int().min(1).max(500).optional() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<IpSearchResult> => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.query.trim();
    const limit = data.limit ?? 200;
    const like = `%${q}%`;

    const { data: visits, error: vErr } = await supabaseAdmin
      .from("page_visits")
      .select("id, ip, path, referrer, user_agent, user_id, created_at")
      .ilike("ip", like)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (vErr) throw new Error(vErr.message);

    const userIds = Array.from(new Set((visits ?? []).map((v) => v.user_id).filter(Boolean) as string[]));

    const { data: profMatches } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, last_ip, last_country, is_vpn, last_seen")
      .ilike("last_ip", like)
      .limit(100);

    const allUserIds = Array.from(new Set([...userIds, ...((profMatches ?? []).map((p) => p.id))]));
    const { data: profilesForVisits } = allUserIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, email, full_name, last_ip, last_country, is_vpn, last_seen")
          .in("id", allUserIds)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null; last_ip: string | null; last_country: string | null; is_vpn: boolean | null; last_seen: string | null }> };

    const profMap = new Map((profilesForVisits ?? []).map((p) => [p.id, p]));

    const visitRows: IpVisitRow[] = (visits ?? []).map((v) => ({
      id: v.id,
      ip: v.ip,
      path: v.path,
      referrer: v.referrer,
      user_agent: v.user_agent,
      user_id: v.user_id,
      user_email: v.user_id ? profMap.get(v.user_id)?.email ?? null : null,
      created_at: v.created_at,
    }));

    const mergedProfiles = new Map<string, IpProfileRow>();
    for (const p of profMatches ?? []) {
      mergedProfiles.set(p.id, {
        user_id: p.id, email: p.email, full_name: p.full_name,
        last_ip: p.last_ip, last_country: p.last_country, is_vpn: p.is_vpn, last_seen: p.last_seen,
      });
    }
    for (const uid of userIds) {
      if (mergedProfiles.has(uid)) continue;
      const p = profMap.get(uid);
      if (p) mergedProfiles.set(uid, {
        user_id: p.id, email: p.email, full_name: p.full_name,
        last_ip: p.last_ip, last_country: p.last_country, is_vpn: p.is_vpn, last_seen: p.last_seen,
      });
    }

    const times = visitRows.map((v) => v.created_at).sort();
    return {
      query: q,
      visit_count: visitRows.length,
      unique_users: new Set(visitRows.map((v) => v.user_id).filter(Boolean)).size,
      first_seen: times[0] ?? null,
      last_seen: times[times.length - 1] ?? null,
      visits: visitRows,
      profiles: Array.from(mergedProfiles.values()),
    };
  });
