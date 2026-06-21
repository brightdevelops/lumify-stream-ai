import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminReconcileCryptoByOrderId,
  adminListPendingCryptoForEmail,
} from "@/lib/payments.functions";

export const Route = createFileRoute("/inventor/reconcile")({
  component: ReconcilePage,
});

type ReconcileResult = Awaited<ReturnType<typeof adminReconcileCryptoByOrderId>>;
type EmailLookup = Awaited<ReturnType<typeof adminListPendingCryptoForEmail>>;

function ReconcilePage() {
  const reconcileFn = useServerFn(adminReconcileCryptoByOrderId);
  const lookupFn = useServerFn(adminListPendingCryptoForEmail);

  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [lookup, setLookup] = useState<EmailLookup | null>(null);

  async function runReconcile(id: string) {
    setBusy(id);
    setErr(null);
    setResult(null);
    try {
      const r = await reconcileFn({ data: { orderId: id } });
      setResult(r);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function runLookup() {
    setErr(null);
    setLookup(null);
    setBusy("lookup");
    try {
      const r = await lookupFn({ data: { email: email.trim() } });
      setLookup(r);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Crypto payment reconcile</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Re-checks NOWPayments for the given order and credits the user if the payment is confirmed but our webhook
          was missed. Idempotent — safe to run multiple times.
        </p>
      </div>

      {/* Lookup by order id */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium">Reconcile by Order ID</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Format: <code>lumify_&lt;pack&gt;_&lt;userIdPrefix&gt;_&lt;ts&gt;</code>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="lumify_pro_a1b2c3d4_1781234567890"
            className="flex-1 min-w-[280px] rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => runReconcile(orderId.trim())}
            disabled={!orderId.trim() || busy !== null}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy === orderId.trim() ? "Checking…" : "Reconcile"}
          </button>
        </div>
      </div>

      {/* Lookup by email */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium">Find by user email</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Lists this user's recent crypto invoices. Click reconcile next to the one in question.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="flex-1 min-w-[260px] rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={runLookup}
            disabled={!email.trim() || busy !== null}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
          >
            {busy === "lookup" ? "Loading…" : "Lookup"}
          </button>
        </div>

        {lookup && (
          <div className="mt-4">
            {!lookup.user ? (
              <p className="text-sm text-muted-foreground">No user with that email.</p>
            ) : lookup.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No crypto invoices for {lookup.user.email}.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Pack</th>
                      <th className="px-3 py-2 text-right">Credits</th>
                      <th className="px-3 py-2 text-right">USD</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Order ID</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lookup.invoices.map((inv) => (
                      <tr key={inv.order_id} className="border-t border-border/60">
                        <td className="px-3 py-2 text-muted-foreground">{new Date(inv.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2 capitalize">{inv.pack_id}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inv.credits}</td>
                        <td className="px-3 py-2 text-right tabular-nums">${Number(inv.price_usd).toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              "rounded-full border px-2 py-0.5 text-[10px] " +
                              (inv.status === "paid"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-200")
                            }
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{inv.order_id}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => runReconcile(inv.order_id)}
                            disabled={busy !== null}
                            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted/40 disabled:opacity-50"
                          >
                            {busy === inv.order_id ? "…" : "Reconcile"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {err}
        </div>
      )}

      {result && (
        <div
          className={
            "rounded-lg border p-4 text-sm " +
            (result.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              : "border-amber-500/40 bg-amber-500/10 text-amber-100")
          }
        >
          <div className="font-medium">{result.message}</div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Order</dt>
            <dd className="font-mono">{result.orderId}</dd>
            <dt className="text-muted-foreground">User</dt>
            <dd>{result.userEmail ?? "—"}</dd>
            <dt className="text-muted-foreground">Pack</dt>
            <dd className="capitalize">{result.packId}</dd>
            <dt className="text-muted-foreground">Credits</dt>
            <dd>{result.credits}</dd>
            <dt className="text-muted-foreground">NOWPayments status</dt>
            <dd>{result.paymentStatus}</dd>
            <dt className="text-muted-foreground">USD</dt>
            <dd>${result.paidUsd.toFixed(2)}</dd>
            <dt className="text-muted-foreground">Already credited</dt>
            <dd>{result.alreadyCredited ? "yes" : "no"}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
