import { createFileRoute, Link } from "@tanstack/react-router";
import { Coins, Clock, TrendingUp, Wallet, Video, Plus } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

const stats = [
  { label: "Credits Remaining", value: "1,240", icon: Coins, highlight: true, hint: "≈ 10 min of streaming" },
  { label: "Total Streamed", value: "0h 00m", icon: Clock, hint: "Across 0 sessions" },
  { label: "Credits Used", value: "0", icon: TrendingUp, hint: "Last 30 days" },
  { label: "Total Spent", value: "₦0", icon: Wallet, hint: "Lifetime" },
];

const activity = [
  { desc: "Stream session — Cyberpunk preset", date: "Today, 14:02", credits: -420, status: "Complete" },
  { desc: "Credit purchase — Basic pack", date: "Today, 09:18", credits: 1000, status: "Paid" },
  { desc: "Stream session — Anime preset", date: "Yesterday, 21:11", credits: -680, status: "Complete" },
  { desc: "Stream session — Oil Painting", date: "May 24, 17:48", credits: -240, status: "Complete" },
  { desc: "Credit purchase — Starter pack", date: "May 22, 11:03", credits: 500, status: "Paid" },
];

function Dashboard() {
  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back. Here's your streaming overview.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.highlight ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</span>
              <s.icon className={`h-4 w-4 ${s.highlight ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className={`mt-3 text-3xl font-display ${s.highlight ? "text-primary" : ""}`}>{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <QuickAction
          to="/stream"
          icon={Video}
          title="Start a Stream"
          desc="Open the studio and transform your camera with a prompt."
          cta="Open studio"
        />
        <QuickAction
          to="/credits"
          icon={Plus}
          title="Top Up Credits"
          desc="Add credits to your balance. Pay with Paystack."
          cta="Buy credits"
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg">Recent activity</h2>
          <Link to="/billing" className="text-xs text-primary hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-6 py-3">Description</th><th className="px-6 py-3">Date</th><th className="px-6 py-3 text-right">Credits</th><th className="px-6 py-3">Status</th></tr>
            </thead>
            <tbody>
              {activity.map((a, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-6 py-4">{a.desc}</td>
                  <td className="px-6 py-4 text-muted-foreground">{a.date}</td>
                  <td className={`px-6 py-4 text-right font-medium ${a.credits > 0 ? "text-primary" : "text-foreground"}`}>
                    {a.credits > 0 ? "+" : ""}{a.credits.toLocaleString()}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ to, icon: Icon, title, desc, cta }: { to: "/stream" | "/credits"; icon: typeof Video; title: string; desc: string; cta: string }) {
  return (
    <Link to={to} className="group rounded-xl border border-border bg-card p-6 hover:border-primary transition-colors">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
          <span className="mt-4 inline-block text-sm text-primary group-hover:underline">{cta} →</span>
        </div>
      </div>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const isGreen = status === "Paid" || status === "Complete";
  const isPending = status === "Pending";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${
      isGreen ? "bg-primary/10 text-primary" : isPending ? "bg-yellow-500/10 text-yellow-500" : "bg-secondary text-muted-foreground"
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isGreen ? "bg-primary" : isPending ? "bg-yellow-500" : "bg-muted-foreground"}`} />
      {status}
    </span>
  );
}
