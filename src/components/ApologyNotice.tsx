import { useEffect, useState } from "react";

const KEY = "lumify_apology_oct2026_dismissed";

export function ApologyNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const close = () => {
    try { localStorage.setItem(KEY, "1"); } catch {}
    setShow(false);
  };
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm text-foreground">
      <div className="flex-1">
        <p className="font-semibold">We're sorry for the trouble 💜</p>
        <p className="mt-1 text-muted-foreground">
          Some of you recently ran into blank screens and unexpected sign-outs. That's on us, and it's fixed now.
          Thank you for your patience and for sticking with Lumify. If anything still looks wrong, message us through Support.
        </p>
      </div>
      <button type="button" onClick={close} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">✕</button>
    </div>
  );
}
