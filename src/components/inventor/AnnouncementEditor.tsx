import { useEffect, useRef, useState } from "react";
import { Megaphone, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AnnouncementCard } from "@/components/AnnouncementPopup";

type Row = {
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

const EMPTY: Omit<Row, "id" | "updated_at"> = {
  is_active: false,
  tag_text: "",
  title: "",
  body: "",
  button_text: "",
  button_link: "",
  image_url: "",
  starts_at: null,
  ends_at: null,
  frequency: "every_visit",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function AnnouncementEditor() {
  const [row, setRow] = useState<Row | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("singleton_key", "main")
        .maybeSingle();
      if (error) { setErr(error.message); setLoading(false); return; }
      if (data) {
        setRow(data as Row);
        const { id: _i, updated_at: _u, ...rest } = data as Row;
        void _i; void _u;
        setDraft(rest);
      }
      setLoading(false);
    })();
  }, []);

  const patch = (p: Partial<typeof EMPTY>) => setDraft((d) => ({ ...d, ...p }));

  const toggleActive = async () => {
    if (!row) return;
    const next = !draft.is_active;
    patch({ is_active: next });
    const { error } = await supabase
      .from("announcements")
      .update({ is_active: next })
      .eq("id", row.id);
    if (error) { setErr(error.message); patch({ is_active: !next }); }
  };

  const uploadImage = async (file: File) => {
    if (!row) return;
    setUploading(true); setErr(null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `main/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("announcement-images").upload(path, file, {
        cacheControl: "3600", upsert: true, contentType: file.type,
      });
      if (up.error) throw up.error;
      const signed = await supabase.storage
        .from("announcement-images")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 5); // 5 years
      if (signed.error) throw signed.error;
      patch({ image_url: signed.data.signedUrl });
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!row) return;
    setSaving(true); setErr(null); setMsg(null);
    const { error } = await supabase
      .from("announcements")
      .update({ ...draft, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setMsg("Published. Dismissed users will see the new version.");
    setTimeout(() => setMsg(null), 4000);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading announcement…</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Announcement</h2>
        </div>
        <button
          onClick={toggleActive}
          className={
            "shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition " +
            (draft.is_active
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
              : "bg-muted/40 text-muted-foreground border border-border")
          }
        >
          {draft.is_active ? "● LIVE" : "○ OFF"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Tag text">
            <input className={inp} value={draft.tag_text} onChange={(e) => patch({ tag_text: e.target.value })} placeholder="NEW" />
          </Field>
          <Field label="Title">
            <input className={inp} value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Big news!" />
          </Field>
          <Field label="Body">
            <textarea className={inp + " min-h-[90px]"} value={draft.body} onChange={(e) => patch({ body: e.target.value })} placeholder="Tell your users what's new…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Button text">
              <input className={inp} value={draft.button_text} onChange={(e) => patch({ button_text: e.target.value })} placeholder="Learn more" />
            </Field>
            <Field label="Button link">
              <input className={inp} value={draft.button_link} onChange={(e) => patch({ button_link: e.target.value })} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Image">
            <div className="flex items-center gap-3">
              {draft.image_url ? (
                <img src={draft.image_url} alt="" className="h-16 w-24 object-cover rounded border border-border" />
              ) : (
                <div className="h-16 w-24 rounded border border-dashed border-border grid place-items-center text-[10px] text-muted-foreground">No image</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted/70 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {draft.image_url ? "Replace" : "Upload"}
                </button>
                {draft.image_url && (
                  <button
                    onClick={() => patch({ image_url: "" })}
                    className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ""; }}
              />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (optional)">
              <input type="datetime-local" className={inp} value={toLocalInput(draft.starts_at)} onChange={(e) => patch({ starts_at: fromLocalInput(e.target.value) })} />
            </Field>
            <Field label="End (optional)">
              <input type="datetime-local" className={inp} value={toLocalInput(draft.ends_at)} onChange={(e) => patch({ ends_at: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Popup shows on <span className="text-foreground font-medium">every visit</span> while LIVE. Flip the toggle above to turn it off.
          </p>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={publish}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Publish
            </button>
            {msg && <span className="text-xs text-emerald-400">{msg}</span>}
            {err && <span className="text-xs text-destructive">{err}</span>}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Live preview</p>
          <div className="rounded-lg border border-dashed border-border bg-background p-4 grid place-items-center min-h-[300px]">
            <AnnouncementCard a={draft} embedded />
          </div>
        </div>
      </div>
    </div>
  );
}

const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
