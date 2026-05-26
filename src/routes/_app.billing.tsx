import { createFileRoute } from "@tanstack/react-router";
import { StatusBadge } from "./_app.dashboard";

export const Route = createFileRoute("/_app/billing")({
  component: BillingPage,
});

const TXNS = [
  { desc: "Credit purchase — Basic pack", date: "Today, 09:18", credits: 1000, status: "Paid" },
  { desc: "Stream session — Cyberpunk preset", date: "Today, 14:02", credits: -420, status: "Complete" },
  { desc: "Stream session — Anime preset", date: "Yesterday, 21:11", credits: -680, status: "Complete" },
  { desc: "Stream session — Oil Painting", date: "May 24, 17:48", credits: -240, status: "Complete" },
  { desc: "Credit purchase — Starter pack", date: "May 22, 11:03", credits: 500, status: "Paid" },
  { desc: "Stream session — Neon Glow", date: "May 20, 19:30", credits: -360, status: "Complete" },
  { desc: "Credit purchase — Pro pack", date: "May 17, 08:55", credits: 2000, status: "Paid" },
  { desc: "Refund request", date: "May 12, 13:20", credits: 0, status: "Pending" },
];

function BillingPage() {
  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <h1 className="text-3xl">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every purchase and stream session, in one place.</p>

      <div className="grid gap-4 sm:grid-cols-3 mt-8">
        <Stat label="Total Spent" value="₦86,250" hint="Lifetime" />
        <Stat label="Credits Purchased" value="6,500" hint="Lifetime" highlight />
        <Stat label="Transactions" value="24" hint="All time" />
      </div>

      <div className="mt-8 rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg">Transaction history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3 text-right">Credits</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {TXNS.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-6 py-4">{t.desc}</td>
                  <td className="px-6 py-4 text-muted-foreground">{t.date}</td>
                  <td className={`px-6 py-4 text-right font-medium ${t.credits > 0 ? "text-primary" : t.credits < 0 ? "text-muted-foreground" : "text-muted-foreground"}`}>
                    {t.credits > 0 ? "+" : ""}{t.credits ? t.credits.toLocaleString() : "—"}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, highlight }: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-3 text-3xl font-display ${highlight ? "text-primary" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
