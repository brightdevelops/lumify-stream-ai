import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Returns an internal path ("/voice") if the link is same-origin, else null. */
function internalPath(link: string): string | null {
  if (!link) return null;
  if (link.startsWith("/") && !link.startsWith("//")) return link;
  try {
    const url = new URL(link, typeof window !== "undefined" ? window.location.origin : undefined);
    if (typeof window !== "undefined" && url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }
  return null;
}

type Announcement = {
  id: string;
  is_active: boolean;
  tag_text: string;
  title: string;
  body: string;
  button_text: string;
  button_link: string;
  image_url: string;
  starts_at: string | null;
  ends_at: string | null;
  frequency: "once_per_user" | "once_per_day" | "every_visit";
  updated_at: string;
};

function shouldShow(a: Announcement): boolean {
  const now = Date.now();
  if (a.starts_at && new Date(a.starts_at).getTime() > now) return false;
  if (a.ends_at && new Date(a.ends_at).getTime() < now) return false;
  const key = `lumify-ann:${a.id}:${a.updated_at}`;
  if (a.frequency === "every_visit") return true;
  if (a.frequency === "once_per_user") {
    return localStorage.getItem(key) !== "1";
  }
  if (a.frequency === "once_per_day") {
    const today = new Date().toISOString().slice(0, 10);
    return localStorage.getItem(`${key}:${today}`) !== "1";
  }
  return true;
}

function markDismissed(a: Announcement) {
  const key = `lumify-ann:${a.id}:${a.updated_at}`;
  if (a.frequency === "once_per_user") localStorage.setItem(key, "1");
  if (a.frequency === "once_per_day") {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(`${key}:${today}`, "1");
  }
}

export function AnnouncementPopup() {
  const [a, setA] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("announcements")
        .select("*")
        .eq("singleton_key", "main")
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as Announcement;
      if (!row.is_active) return;
      if (!row.title && !row.body) return;
      if (!shouldShow(row)) return;
      setA(row);
      setOpen(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!open || !a) return null;

  const close = () => {
    markDismissed(a);
    setOpen(false);
  };

  return (
    <AnnouncementCard
      a={a}
      onClose={close}
      onAction={() => {
        markDismissed(a);
        setOpen(false);
        const path = internalPath(a.button_link);
        if (path) {
          void navigate({ to: path });
        } else if (a.button_link) {
          window.open(a.button_link, "_blank", "noopener,noreferrer");
        }
      }}
    />
  );
}

export function AnnouncementCard({
  a,
  onClose,
  onAction,
  embedded = false,
}: {
  a: Pick<Announcement, "tag_text" | "title" | "body" | "button_text" | "button_link" | "image_url">;
  onClose?: () => void;
  onAction?: () => void;
  embedded?: boolean;
}) {
  const card = (
    <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
      {a.image_url && (
        <img src={a.image_url} alt="" className="w-full h-40 object-cover" />
      )}
      <div className="p-5 space-y-3">
        {a.tag_text && (
          <span className="inline-block rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-medium">
            {a.tag_text}
          </span>
        )}
        {a.title && <h3 className="text-lg font-semibold leading-tight">{a.title}</h3>}
        {a.body && <p className="text-sm text-muted-foreground whitespace-pre-line">{a.body}</p>}
        {a.button_text && (
          <button
            onClick={onAction}
            className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
          >
            {a.button_text}
          </button>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute top-2 right-2 rounded-md p-1.5 bg-black/40 text-white hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  if (embedded) return card;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {card}
    </div>
  );
}
