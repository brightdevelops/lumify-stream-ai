export const NGN = (n: number | null | undefined) =>
  `₦${Number(n || 0).toLocaleString()}`;

export const NUM = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString();

export const PACKAGE_NAMES: Record<string, string> = {
  starter: "Starter",
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
};

export const pkgName = (id: string | null | undefined) =>
  id ? (PACKAGE_NAMES[id] ?? id) : "—";

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return "in the future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}
